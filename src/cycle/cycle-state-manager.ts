import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";
import { logger } from "../utils/logger.js";
import type { TradingRules } from "../exchange/trading-rules.js";

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
  private tradingRules: TradingRules;
  private strategyConfigId: string;
  private timeframe: string;

  constructor(
    supabase: SupabaseClient<Database>,
    config: CycleStateManagerConfig,
    tradingRules: TradingRules,
    strategyConfigId: string,
    timeframe: string,
  ) {
    this.supabase = supabase;
    this.config = config;
    this.tradingRules = tradingRules;
    this.strategyConfigId = strategyConfigId;
    this.timeframe = timeframe;
  }

  async initialize(): Promise<void> {
    try {
      // First, check if any active cycle states exist for this strategy config
      // Only load READY, HOLDING, or PAUSED cycles (skip COMPLETED)
      const { data: allStates, error: countError } = await this.supabase
        .from("cycle_state")
        .select("*")
        .eq("strategy_config_id", this.strategyConfigId)
        .in("status", ["READY", "HOLDING", "PAUSED"])
        .order("updated_at", { ascending: false })
        .limit(10);

      if (countError) {
        const errorMessage =
          (countError as { message?: string }).message ||
          (countError as { code?: string }).code ||
          String(countError);
        throw new Error(`Failed to query cycle states: ${errorMessage}`);
      }

      // Handle multiple rows case
      if (allStates && allStates.length > 1) {
        logger.warn(
          `Found ${allStates.length} cycle_state rows for config ${this.strategyConfigId}. Using most recent.`,
          { timeframe: this.timeframe },
        );

        // Use the most recently updated state
        const existingState = allStates[0];
        const isValid = await this.validateAndHandleState(existingState);
        if (isValid) {
          this.currentState = existingState;
        }
        return;
      }

      // Single row case
      const existingState = allStates?.[0] || null;

      if (!existingState) {
        await this.createInitialState();
        return;
      }

      // Process the single existing state
      const isValid = await this.validateAndHandleState(existingState);
      if (isValid) {
        this.currentState = existingState;
        logger.info(
          `Recovered cycle state [${this.strategyConfigId}]: ${existingState.status} - ${existingState.btc_accumulated} BTC, ${existingState.purchases_remaining} purchases remaining`,
          { timeframe: this.timeframe },
        );
      }
    } catch (error) {
      logger.error("Failed to initialize cycle state", {
        error,
        timeframe: this.timeframe,
      });
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
      sell_reference_price: null,
      ath_reference_price: null,
      cost_accum_usdt: 0,
      btc_accum_net: 0,
      btc_dust: 0,
      ath_price: null,
      buy_amount: buyAmount,
      strategy_config_id: this.strategyConfigId,
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
    logger.info(
      `Created initial cycle state [${this.strategyConfigId}]: ${this.config.initialCapitalUSDT} USDT, ${this.config.maxPurchases} purchases`,
      { timeframe: this.timeframe },
    );

    await this.logBotEvent(
      "CYCLE_STATE_INITIALIZED",
      "info",
      "Initial cycle state created",
      initialState,
    );
  }

  private async validateAndHandleState(state: CycleState): Promise<boolean> {
    const validationErrors = await this.getValidationErrors(state);

    if (validationErrors.length > 0) {
      logger.error("Cycle state validation failed", {
        validationErrors,
        timeframe: this.timeframe,
      });

      await this.pauseWithCorruption(state, validationErrors);
      return false;
    }

    return true;
  }

  private async getValidationErrors(
    state: CycleState,
  ): Promise<ValidationError[]> {
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

    // Check reference price requirement using trading rules
    const btcAccumulated = state.btc_accumulated ?? 0;
    const btcDust = state.btc_dust ?? 0;
    const meaningfulBtc = btcAccumulated - btcDust;

    if (meaningfulBtc > 0) {
      // Ensure we have trading rules cached for BTCUSDT
      try {
        await this.tradingRules.getRules("BTCUSDT");
        const isTradable = this.tradingRules.isTradable(
          meaningfulBtc,
          "BTCUSDT",
        );

        if (isTradable && !state.sell_reference_price) {
          const minTradable = this.tradingRules.getMinTradableAmount("BTCUSDT");
          errors.push({
            field: "sell_reference_price",
            error: `Sell reference price must be set when holding tradable BTC (≥ ${minTradable} BTC)`,
            value: state.sell_reference_price,
          });
        }
      } catch (error) {
        // If we can't get trading rules, fall back to a reasonable default
        logger.warn(
          "Could not fetch trading rules for validation, using fallback",
          { error, timeframe: this.timeframe },
        );
        if (meaningfulBtc >= 0.00001 && !state.sell_reference_price) {
          errors.push({
            field: "sell_reference_price",
            error: "Sell reference price must be set when holding tradable BTC",
            value: state.sell_reference_price,
          });
        }
      }
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
      logger.error("Failed to pause corrupted state", {
        error: updateError,
        timeframe: this.timeframe,
      });
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
      logger.error("Failed to log bot event", {
        error,
        eventType,
        message,
        timeframe: this.timeframe,
      });
    }
  }

  async getCurrentState(): Promise<CycleState | null> {
    // Always fetch fresh from database to avoid stale cache issues
    const { data, error } = await this.supabase
      .from("cycle_state")
      .select("*")
      .eq("strategy_config_id", this.strategyConfigId)
      .in("status", ["READY", "HOLDING", "PAUSED"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      logger.error(`Failed to fetch cycle state [${this.strategyConfigId}]`, {
        error,
        timeframe: this.timeframe,
      });
      return null;
    }

    if (data) {
      // Update cache with fresh data
      this.currentState = data;
    }

    return data;
  }

  /**
   * Updates the cached state with new values.
   * This is needed when external components (like BuyOrderStateUpdater) modify the database.
   */
  updateCachedState(newState: CycleState): void {
    this.currentState = newState;
  }

  async validateState(state: CycleState): Promise<boolean> {
    const errors = await this.getValidationErrors(state);
    return errors.length === 0;
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
          logger.error(
            `Failed to update buy_amount [${this.strategyConfigId}]`,
            { error, timeframe: this.timeframe },
          );
          throw error;
        }

        this.currentState = data;
      }
    }
  }

  /**
   * Create a new cycle after the previous one completes
   * @param previousCycle The cycle that just completed
   * @param completionData Data from the completed cycle
   * @returns The newly created cycle
   */
  async createNewCycleAfterCompletion(
    previousCycle: CycleState,
    completionData: {
      finalProfit: number;
      carryOverCapital: number;
      carryOverDust: number;
    },
  ): Promise<CycleState> {
    // Mark previous cycle as COMPLETED
    // Note: COMPLETED status will be available after migration is run
    const completedStatus = "COMPLETED" as CycleState["status"];
    const { error: updateError } = await this.supabase
      .from("cycle_state")
      .update({
        status: completedStatus,
        completed_at: new Date().toISOString(),
        final_profit: completionData.finalProfit,
        updated_at: new Date().toISOString(),
      })
      .eq("id", previousCycle.id);

    if (updateError) {
      logger.error(
        `Failed to mark previous cycle as completed [${this.strategyConfigId}]`,
        { error: updateError, timeframe: this.timeframe },
      );
      throw new Error(
        `Failed to complete previous cycle: ${updateError.message}`,
      );
    }

    // Get strategy config for this cycle
    const { data: strategyConfig, error: configError } = await this.supabase
      .from("strategy_config")
      .select("*")
      .eq("id", this.strategyConfigId)
      .single();

    if (configError || !strategyConfig) {
      throw new Error("No active strategy configuration found");
    }

    // Calculate buy amount for new cycle with proper precision
    const buyAmount =
      Math.floor(
        (completionData.carryOverCapital / strategyConfig.max_purchases) *
          100000000,
      ) / 100000000;

    // Create new cycle with fresh ID
    const newCycleData: CycleStateInsert = {
      status: "READY",
      capital_available: completionData.carryOverCapital,
      btc_accumulated: completionData.carryOverDust,
      btc_dust: completionData.carryOverDust,
      btc_accum_net: 0,
      cost_accum_usdt: 0,
      purchases_remaining: strategyConfig.max_purchases,
      buy_amount: buyAmount,
      sell_reference_price: null,
      ath_reference_price: null,
      ath_price: null,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      strategy_config_id: strategyConfig.id,
      previous_cycle_id: previousCycle.id,
      updated_at: new Date().toISOString(),
    };

    const { data: newCycle, error: insertError } = await this.supabase
      .from("cycle_state")
      .insert(newCycleData)
      .select()
      .single();

    if (insertError || !newCycle) {
      logger.error(`Failed to create new cycle [${this.strategyConfigId}]`, {
        error: insertError,
        timeframe: this.timeframe,
      });
      throw new Error(`Failed to create new cycle: ${insertError?.message}`);
    }

    logger.info(
      `New cycle created [${this.strategyConfigId}]: profit ${completionData.finalProfit}, carryover ${completionData.carryOverCapital} USDT`,
      { timeframe: this.timeframe },
    );

    // Update cached state
    this.currentState = newCycle;

    return newCycle;
  }
}
