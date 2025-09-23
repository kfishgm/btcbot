import { EventEmitter } from "events";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../types/supabase";
import type { CycleState } from "./cycle-state-manager";
import type { OrderResult } from "../order/buy-order-placer";
import { StateTransactionManager } from "./state-transaction-manager";
import { Decimal } from "decimal.js";
import { logger } from "../utils/logger";

export interface StateUpdateResult extends CycleState {
  updateSummary?: {
    btcSold: number;
    usdtReceived: number;
    principal?: number;
    profit?: number;
    cycleComplete: boolean;
  };
}

export interface StateUpdateData {
  btc_accumulated: number;
  btc_accum_net: number;
  btc_dust?: number;
  cost_accum_usdt: number;
  capital_available: number;
  purchases_remaining: number;
  reference_price: number | null;
  buy_amount: number | null;
  status: "READY" | "HOLDING" | "PAUSED";
  ath_price?: number | null;
  buy_grid?: number[] | null;
  buy_index?: number | null;
}

export interface SellOrderStateUpdaterConfig {
  maxPurchases: number;
}

export class SellOrderStateUpdater extends EventEmitter {
  private supabase: SupabaseClient<Database>;
  private transactionManager: StateTransactionManager;
  private config: SellOrderStateUpdaterConfig;

  constructor(
    supabase: SupabaseClient<Database>,
    config: SellOrderStateUpdaterConfig,
  ) {
    super();
    this.supabase = supabase;
    this.transactionManager = new StateTransactionManager(supabase);
    this.config = config;
  }

  async updateAfterSellOrder(
    currentState: CycleState,
    orderResult: OrderResult,
  ): Promise<StateUpdateResult> {
    // Emit start event
    this.emit("stateUpdateStarted", {
      cycleId: currentState.id,
      orderId: orderResult.orderId,
    });

    try {
      // Validate inputs
      this.validateOrderResult(orderResult);
      this.validateCycleState(currentState, orderResult);

      // Calculate all updates
      const updates = this.calculateUpdates(currentState, orderResult);

      // Execute update atomically
      const updatedState = await this.transactionManager.updateStateAtomic(
        currentState.id,
        updates,
      );

      // Create result with summary
      const btcSold = orderResult.executedQty
        .sub(orderResult.feeBTC)
        .toNumber();
      const usdtReceived = orderResult.cummulativeQuoteQty
        .sub(orderResult.feeUSDT)
        .toNumber();
      const cycleComplete = updates.btc_accumulated < 0.00001;

      let principal: number | undefined;
      let profit: number | undefined;

      if (cycleComplete && currentState.reference_price) {
        // Per STRATEGY.md line 116-118
        principal =
          currentState.reference_price * orderResult.executedQty.toNumber();
        const netUsdtReceived = orderResult.cummulativeQuoteQty
          .sub(orderResult.feeUSDT)
          .toNumber();
        profit = Math.max(0, netUsdtReceived - principal);
      }

      const result: StateUpdateResult = {
        ...updatedState,
        updateSummary: {
          btcSold,
          usdtReceived,
          principal,
          profit,
          cycleComplete,
        },
      };

      // Log successful update
      logger.info(
        `Sell order state update completed. Cycle complete: ${cycleComplete}, ATH: ${currentState.ath_price}, New ref price: ${updates.reference_price}`,
        {
          cycleId: currentState.id,
          orderId: orderResult.orderId,
          updates,
          cycleComplete,
          currentAthPrice: currentState.ath_price,
          newReferencePrice: updates.reference_price,
        },
      );

      // Log to database
      await this.logStateUpdate(currentState.id, orderResult.orderId, updates);

      // Emit completion event
      this.emit("stateUpdateCompleted", {
        cycleId: currentState.id,
        updates,
        result,
      });

      return result;
    } catch (error) {
      // Log and emit error
      logger.error("Failed to update state after sell order", {
        cycleId: currentState.id,
        orderId: orderResult.orderId,
        error,
      });

      this.emit("stateUpdateFailed", {
        cycleId: currentState.id,
        error,
      });

      throw error;
    }
  }

  validateOrderResult(orderResult: OrderResult): void {
    // Check if order was filled or partially filled
    if (
      orderResult.status !== "FILLED" &&
      orderResult.status !== "PARTIALLY_FILLED"
    ) {
      throw new Error(
        `Cannot update state for non-filled order: ${orderResult.status}`,
      );
    }

    // Check executed quantity
    if (orderResult.executedQty.lte(0)) {
      throw new Error("Order has no executed quantity");
    }

    // Check cumulative quote quantity
    if (orderResult.cummulativeQuoteQty.lte(0)) {
      throw new Error("Order has no cumulative quote quantity");
    }
  }

  private validateCycleState(
    currentState: CycleState,
    orderResult: OrderResult,
  ): void {
    // Check if we have BTC to sell
    const btcAccumulated = currentState.btc_accumulated ?? 0;
    if (btcAccumulated <= 0) {
      throw new Error("Cannot sell: no BTC accumulated");
    }

    // Check if we're trying to sell more than we have
    const btcToSell = orderResult.executedQty.toNumber();
    if (btcToSell > btcAccumulated) {
      throw new Error(
        `Cannot sell more than accumulated: have ${btcAccumulated}, selling ${btcToSell}`,
      );
    }
  }

  calculateUpdates(
    currentState: CycleState,
    orderResult: OrderResult,
  ): StateUpdateData {
    // Calculate BTC amounts
    const btcSold = orderResult.executedQty;

    // Update BTC accumulated
    // For SELL orders on Binance: fee is in USDT, not BTC
    // So we sell the full executedQty and don't need to adjust for BTC fees
    const currentBtcAccumulated = new Decimal(
      currentState.btc_accumulated ?? 0,
    );
    const newBtcAccumulated = currentBtcAccumulated.sub(btcSold).toNumber();

    // Calculate USDT amounts
    const usdtReceived = orderResult.cummulativeQuoteQty;
    const usdtFee = orderResult.feeUSDT;
    const netUsdtReceived = usdtReceived.sub(usdtFee);

    // Check if this is a complete sale (cycle reset)
    // Dust is BTC that cannot be sold due to minimum constraints
    // We consider the cycle complete when remaining BTC is below minQty (0.00001)
    const isCycleComplete = newBtcAccumulated < 0.00001;

    if (isCycleComplete) {
      // CYCLE RESET - Per STRATEGY.md lines 279-295

      // Calculate profit (per STRATEGY.md lines 116-118)
      const referencePrice = currentState.reference_price ?? 0;
      const principal = new Decimal(referencePrice).mul(btcSold);
      const profit = Decimal.max(0, netUsdtReceived.sub(principal));

      // Update capital (per STRATEGY.md line 118)
      const currentCapital = new Decimal(currentState.capital_available);
      const newCapitalAvailable = currentCapital
        .add(principal)
        .add(profit)
        .toNumber();

      // Recalculate buy amount (per STRATEGY.md line 293)
      const newBuyAmount = Math.floor(
        newCapitalAvailable / this.config.maxPurchases,
      );

      // Use ATH price as new reference, but validate it first
      const newReferencePrice =
        currentState.ath_price && currentState.ath_price > 0
          ? currentState.ath_price
          : currentState.reference_price || 0; // Fallback to current reference if ATH is invalid

      if (!currentState.ath_price || currentState.ath_price === 0) {
        logger.warn(
          "⚠️ ATH price is null/zero during cycle reset, using current reference price as fallback",
          {
            ath_price: currentState.ath_price,
            reference_price: currentState.reference_price,
            newReferencePrice,
          },
        );
      }

      // Log dust preservation
      if (newBtcAccumulated > 0) {
        logger.info("Preserving dust for next cycle", {
          dustAmount: newBtcAccumulated,
          dustValue: newBtcAccumulated * (currentState.reference_price || 0),
        });
      }

      return {
        btc_accumulated: newBtcAccumulated, // Total BTC including dust
        btc_accum_net: 0, // Reset to 0 for new cycle - only tracks current cycle BTC
        btc_dust: newBtcAccumulated, // Save dust separately to exclude from reference price
        cost_accum_usdt: 0, // Reset cost accumulator for clean profit tracking
        capital_available: newCapitalAvailable,
        purchases_remaining: this.config.maxPurchases,
        reference_price: newReferencePrice, // Reset to ATH (per STRATEGY.md line 294)
        ath_price: currentState.ath_price, // Preserve ATH price
        buy_amount: newBuyAmount,
        status: "READY",
        buy_grid: null, // Reset grid for new cycle
        buy_index: 0, // Reset index for new cycle
      };
    } else {
      // PARTIAL SALE - Cycle continues

      // Just update capital with the USDT received
      const newCapitalAvailable = new Decimal(currentState.capital_available)
        .add(netUsdtReceived)
        .toNumber();

      // Keep current btc_accum_net and cost_accum_usdt as they track the full cycle
      return {
        btc_accumulated: newBtcAccumulated,
        btc_accum_net: currentState.btc_accum_net ?? 0,
        cost_accum_usdt: currentState.cost_accum_usdt ?? 0,
        capital_available: newCapitalAvailable,
        purchases_remaining: currentState.purchases_remaining,
        reference_price: currentState.reference_price,
        ath_price: currentState.ath_price, // Preserve ATH price
        buy_amount: currentState.buy_amount,
        status: "HOLDING", // Still holding some BTC
        buy_grid: currentState.buy_grid, // Preserve buy_grid
        buy_index: currentState.buy_index ?? undefined, // Preserve buy_index
      };
    }
  }

  async getCycleState(cycleId: string): Promise<CycleState | null> {
    const { data, error } = await this.supabase
      .from("cycle_state")
      .select("*")
      .eq("id", cycleId)
      .single();

    if (error) {
      logger.error("Failed to fetch cycle state", { cycleId, error });
      return null;
    }

    return data;
  }

  async logStateUpdate(
    cycleId: string,
    orderId: number,
    updates: StateUpdateData,
  ): Promise<void> {
    try {
      await this.supabase.from("bot_events").insert({
        event_type: "SELL_ORDER_STATE_UPDATE",
        severity: "info",
        message: `State updated after sell order ${orderId}`,
        metadata: {
          cycle_id: cycleId,
          order_id: orderId,
          updates,
        } as unknown as Json,
      });
    } catch (error) {
      logger.error("Failed to log state update event", { error });
    }
  }
}
