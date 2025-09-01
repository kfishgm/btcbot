import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";
import { logger } from "../utils/logger.js";

export interface CycleStateManagerConfig {
  initialCapitalUSDT: number;
  maxPurchases: number;
  minBuyUSDT: number;
}

export type CycleState = Database["public"]["Tables"]["cycle_state"]["Row"];
export type CycleStateInsert =
  Database["public"]["Tables"]["cycle_state"]["Insert"];
export type CycleStateUpdate =
  Database["public"]["Tables"]["cycle_state"]["Update"];

export interface ValidationError {
  field: string;
  error: string;
  value: unknown;
}

export class CycleStateManager {
  private supabase: SupabaseClient<Database>;
  private config: CycleStateManagerConfig;
  private currentState: CycleState | null = null;

  constructor(
    supabase: SupabaseClient<Database>,
    config: CycleStateManagerConfig,
  ) {
    this.supabase = supabase;
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      const { data: existingState, error } = await this.supabase
        .from("cycle_state")
        .select("*")
        .single();

      if (error && error.code === "PGRST116") {
        await this.createInitialState();
        return;
      }

      if (error) {
        throw new Error(`Failed to query cycle state: ${error.message}`);
      }

      if (existingState) {
        const isValid = await this.validateAndHandleState(existingState);
        if (isValid) {
          this.currentState = existingState;
          logger.info("Recovered existing cycle state", {
            status: existingState.status,
            capital_available: existingState.capital_available,
            btc_accumulated: existingState.btc_accumulated,
          });
        }
      }
    } catch (error) {
      logger.error("Failed to initialize cycle state", { error });
      throw error;
    }
  }

  private async createInitialState(): Promise<void> {
    const buyAmount = Math.floor(
      this.config.initialCapitalUSDT / this.config.maxPurchases,
    );

    const initialState: CycleStateInsert = {
      status: "READY",
      capital_available: this.config.initialCapitalUSDT,
      btc_accumulated: 0,
      purchases_remaining: this.config.maxPurchases,
      reference_price: null,
      cost_accum_usdt: 0,
      btc_accum_net: 0,
      ath_price: null,
      buy_amount: buyAmount,
    };

    const { data, error } = await this.supabase
      .from("cycle_state")
      .insert(initialState)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create initial cycle state: ${error.message}`);
    }

    this.currentState = data;
    logger.info("Created initial cycle state", initialState);

    await this.logBotEvent(
      "CYCLE_STATE_INITIALIZED",
      "info",
      "Initial cycle state created",
      initialState,
    );
  }

  private async validateAndHandleState(state: CycleState): Promise<boolean> {
    const validationErrors = this.getValidationErrors(state);

    if (validationErrors.length > 0) {
      logger.error("Cycle state validation failed", { validationErrors });

      await this.pauseWithCorruption(state, validationErrors);
      return false;
    }

    return true;
  }

  private getValidationErrors(state: CycleState): ValidationError[] {
    const errors: ValidationError[] = [];

    if (state.capital_available < 0) {
      errors.push({
        field: "capital_available",
        error: "Capital available cannot be negative",
        value: state.capital_available,
      });
    }

    const btcAccumulatedValue = state.btc_accumulated ?? 0;
    if (btcAccumulatedValue < 0) {
      errors.push({
        field: "btc_accumulated",
        error: "BTC accumulated cannot be negative",
        value: state.btc_accumulated,
      });
    }

    if (state.purchases_remaining > this.config.maxPurchases) {
      errors.push({
        field: "purchases_remaining",
        error: `Purchases remaining (${state.purchases_remaining}) exceeds max purchases (${this.config.maxPurchases})`,
        value: state.purchases_remaining,
      });
    }

    if (state.purchases_remaining < 0) {
      errors.push({
        field: "purchases_remaining",
        error: "Purchases remaining cannot be negative",
        value: state.purchases_remaining,
      });
    }

    const validStatuses = ["READY", "HOLDING", "PAUSED"];
    if (!validStatuses.includes(state.status)) {
      errors.push({
        field: "status",
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        value: state.status,
      });
    }

    const costAccumUsdtValue = state.cost_accum_usdt ?? 0;
    if (costAccumUsdtValue < 0) {
      errors.push({
        field: "cost_accum_usdt",
        error: "Cost accumulator cannot be negative",
        value: state.cost_accum_usdt,
      });
    }

    const btcAccumNetValue = state.btc_accum_net ?? 0;
    if (btcAccumNetValue < 0) {
      errors.push({
        field: "btc_accum_net",
        error: "BTC accumulator (net) cannot be negative",
        value: state.btc_accum_net,
      });
    }

    const btcAccumCheck = state.btc_accumulated ?? 0;
    if (btcAccumCheck > 0 && !state.reference_price) {
      errors.push({
        field: "reference_price",
        error: "Reference price must be set when holding BTC",
        value: state.reference_price,
      });
    }

    const netValue = state.btc_accum_net ?? 0;
    const costValue = state.cost_accum_usdt ?? 0;
    const accumValue = state.btc_accumulated ?? 0;

    if (netValue > 0 && costValue > 0 && accumValue === 0) {
      errors.push({
        field: "accumulators",
        error:
          "Inconsistent state: accumulators have values but btc_accumulated is zero",
        value: {
          btc_accum_net: state.btc_accum_net,
          cost_accum_usdt: state.cost_accum_usdt,
          btc_accumulated: state.btc_accumulated,
        },
      });
    }

    if (
      state.buy_amount !== null &&
      state.buy_amount < this.config.minBuyUSDT
    ) {
      errors.push({
        field: "buy_amount",
        error: `Buy amount (${state.buy_amount}) is below minimum (${this.config.minBuyUSDT})`,
        value: state.buy_amount,
      });
    }

    return errors;
  }

  private async pauseWithCorruption(
    state: CycleState,
    errors: ValidationError[],
  ): Promise<void> {
    const { error: updateError } = await this.supabase
      .from("cycle_state")
      .update({ status: "PAUSED" })
      .eq("id", state.id);

    if (updateError) {
      logger.error("Failed to pause corrupted state", { error: updateError });
    }

    await this.logBotEvent(
      "CYCLE_STATE_CORRUPTION_DETECTED",
      "error",
      "Cycle state corruption detected. Manual intervention required.",
      {
        state,
        validationErrors: errors,
      },
    );

    this.currentState = { ...state, status: "PAUSED" };
  }

  private async logBotEvent(
    eventType: string,
    severity: "info" | "warning" | "error",
    message: string,
    metadata?: unknown,
  ): Promise<void> {
    try {
      const insertData = {
        event_type: eventType,
        severity,
        message,
        metadata:
          metadata as Database["public"]["Tables"]["bot_events"]["Insert"]["metadata"],
      };
      await this.supabase.from("bot_events").insert(insertData);
    } catch (error) {
      logger.error("Failed to log bot event", { error, eventType, message });
    }
  }

  getCurrentState(): CycleState | null {
    return this.currentState ? { ...this.currentState } : null;
  }

  validateState(state: CycleState): boolean {
    return this.getValidationErrors(state).length === 0;
  }

  async updateConfiguration(
    newConfig: Partial<CycleStateManagerConfig>,
  ): Promise<void> {
    this.config = { ...this.config, ...newConfig };

    if (this.currentState && this.currentState.status === "READY") {
      const newBuyAmount = Math.floor(
        this.config.initialCapitalUSDT / this.config.maxPurchases,
      );

      if (newBuyAmount !== this.currentState.buy_amount) {
        const { data, error } = await this.supabase
          .from("cycle_state")
          .update({ buy_amount: newBuyAmount })
          .eq("id", this.currentState.id)
          .select()
          .single();

        if (error) {
          logger.error("Failed to update buy_amount", { error });
          throw error;
        }

        this.currentState = data;
        logger.info("Updated buy_amount due to configuration change", {
          oldBuyAmount: data.buy_amount,
          newBuyAmount,
        });
      }
    }
  }
}
