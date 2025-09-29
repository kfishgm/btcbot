import { EventEmitter } from "events";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../types/supabase";
import type { CycleState } from "./cycle-state-manager";
import type { OrderResult } from "../order/buy-order-placer";
import { StateTransactionManager } from "./state-transaction-manager";
import { Decimal } from "decimal.js";
import { logger } from "../utils/logger";
import type { DiscordNotifier } from "../notifications/discord-notifier";
import type { TradingRules } from "../exchange/trading-rules";

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
  buy_anchor_price?: number | null;
}

export interface SellOrderStateUpdaterConfig {
  maxPurchases: number;
}

export interface NewCycleSignal {
  type: "CREATE_NEW_CYCLE";
  previousCycleId: string;
  completionData: {
    finalProfit: number;
    carryOverCapital: number;
    carryOverDust: number;
  };
}

export interface CycleUpdateSignal {
  type: "UPDATE_CYCLE";
  updates: StateUpdateData;
}

export class SellOrderStateUpdater extends EventEmitter {
  private supabase: SupabaseClient<Database>;
  private transactionManager: StateTransactionManager;
  private discordNotifier?: DiscordNotifier;
  private tradingRules: TradingRules;

  constructor(
    supabase: SupabaseClient<Database>,
    _config: SellOrderStateUpdaterConfig, // Prefix with _ to indicate unused
    discordNotifier: DiscordNotifier | undefined,
    tradingRules: TradingRules,
  ) {
    super();
    this.supabase = supabase;
    this.transactionManager = new StateTransactionManager(supabase);
    // Note: config parameter is kept for API compatibility but not currently used
    this.discordNotifier = discordNotifier;
    this.tradingRules = tradingRules;
  }

  /**
   * Get the TradingRules instance for dust checking
   * Used by orchestrator to check if amounts are dust
   */
  getTradingRules(): TradingRules {
    return this.tradingRules;
  }

  async updateAfterSellOrder(
    currentState: CycleState,
    orderResult: OrderResult,
  ): Promise<StateUpdateResult | NewCycleSignal> {
    // Emit start event
    this.emit("stateUpdateStarted", {
      cycleId: currentState.id,
      orderId: orderResult.orderId,
    });

    try {
      // Validate inputs
      this.validateOrderResult(orderResult);
      this.validateCycleState(currentState, orderResult);

      // Calculate all updates or signal for new cycle
      const updateResult = await this.calculateUpdates(
        currentState,
        orderResult,
      );

      // Check if this is a cycle completion signal
      if ("type" in updateResult && updateResult.type === "CREATE_NEW_CYCLE") {
        // Don't update the current cycle, just return the signal
        logger.info(
          "Cycle completion detected, signaling for new cycle creation",
          {
            previousCycleId: updateResult.previousCycleId,
            profit: updateResult.completionData.finalProfit,
          },
        );

        // Send Discord notification for cycle completion
        if (this.discordNotifier) {
          try {
            const fields = [
              {
                name: "💰 Realized P&L",
                value: `$${updateResult.completionData.finalProfit.toFixed(2)}`,
                inline: false,
              },
              {
                name: "📦 BTC Remaining (Dust)",
                value: `${updateResult.completionData.carryOverDust.toFixed(8)} BTC`,
                inline: false,
              },
              {
                name: "💵 New Capital",
                value: `$${updateResult.completionData.carryOverCapital.toFixed(2)}`,
                inline: false,
              },
              {
                name: "🔄 Cycle Reset",
                value: "✅ New cycle will be created",
                inline: false,
              },
            ];
            await this.discordNotifier.sendCycleCompleteNotification(fields);
          } catch (error) {
            logger.error("Failed to send Discord notification", { error });
          }
        }

        return updateResult;
      }

      // Regular partial sale update
      const updates = updateResult.updates;

      // Execute update atomically
      const updatedState = await this.transactionManager.updateStateAtomic(
        currentState.id,
        updates,
      );

      // Create result with summary
      const btcSold = orderResult.executedQty
        .sub(orderResult.feeBTC)
        .toNumber();
      const usdtReceivedDecimal = orderResult.cummulativeQuoteQty.sub(
        orderResult.feeUSDT,
      );
      const usdtReceived = usdtReceivedDecimal.toNumber();

      const result: StateUpdateResult = {
        ...updatedState,
        updateSummary: {
          btcSold,
          usdtReceived,
          principal: undefined,
          profit: undefined,
          cycleComplete: false,
        },
      };

      // Log successful update
      logger.info(
        `Sell order state update completed. Partial sale, cycle continues`,
        {
          cycleId: currentState.id,
          orderId: orderResult.orderId,
          updates,
          cycleComplete: false,
          currentAthPrice: currentState.ath_price,
          newReferencePrice: updates.reference_price,
        },
      );

      // Log to database
      await this.logStateUpdate(currentState.id, orderResult.orderId, updates);

      // Send Discord notifications for partial sale
      if (this.discordNotifier) {
        try {
          // Regular sell notification
          const grossProceeds = orderResult.cummulativeQuoteQty.toNumber();
          const commissionUSDT = orderResult.feeUSDT.toNumber();
          const netProceeds = usdtReceived; // Already calculated as net

          const fields = [
            {
              name: "💵 Sell Price",
              value: `$${orderResult.avgPrice.toFixed(2)}`,
              inline: false,
            },
            {
              name: "🔢 Quantity Sold",
              value: `${orderResult.executedQty.toFixed(8)} BTC`,
              inline: false,
            },
            {
              name: "💰 Gross Proceeds",
              value: `${grossProceeds.toFixed(2)} USDT`,
              inline: false,
            },
            {
              name: "💸 Commission Paid",
              value: `${commissionUSDT.toFixed(2)} USDT`,
              inline: false,
            },
            {
              name: "📊 Net Proceeds",
              value: `${netProceeds.toFixed(2)} USDT`,
              inline: false,
            },
            {
              name: "📉 BTC Remaining",
              value:
                updates.btc_accumulated > 0.00000001
                  ? `${updates.btc_accumulated.toFixed(8)} BTC (Dust)`
                  : `${updates.btc_accumulated.toFixed(8)} BTC`,
              inline: false,
            },
            {
              name: "🏦 Capital Available",
              value: `${updates.capital_available.toFixed(2)} USDT`,
              inline: false,
            },
          ];
          await this.discordNotifier.sendSellNotification(fields);
        } catch (error) {
          logger.error("Failed to send Discord notification", { error });
        }
      }

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

  async calculateUpdates(
    currentState: CycleState,
    orderResult: OrderResult,
  ): Promise<CycleUpdateSignal | NewCycleSignal> {
    // Calculate actual BTC sold from fills
    let actualBtcSold = new Decimal(0);
    let actualUsdtReceived = new Decimal(0);

    // Use fills data for precise reconciliation
    if (orderResult.fills && orderResult.fills.length > 0) {
      for (const fill of orderResult.fills) {
        const fillQty = new Decimal(fill.qty);
        const fillPrice = new Decimal(fill.price);
        actualBtcSold = actualBtcSold.add(fillQty);
        actualUsdtReceived = actualUsdtReceived.add(fillQty.mul(fillPrice));
      }

      logger.info("Post-trade reconciliation from fills", {
        fillCount: orderResult.fills.length,
        actualBtcSold: actualBtcSold.toString(),
        actualUsdtReceived: actualUsdtReceived.toString(),
        reportedExecutedQty: orderResult.executedQty.toString(),
        reportedQuoteQty: orderResult.cummulativeQuoteQty.toString(),
      });
    } else {
      // Fallback to reported values if no fills
      actualBtcSold = orderResult.executedQty;
      actualUsdtReceived = orderResult.cummulativeQuoteQty;
      logger.warn("No fills data available, using reported values");
    }

    // Update BTC accumulated based on actual sold amount
    const currentBtcAccumulated = new Decimal(
      currentState.btc_accumulated ?? 0,
    );
    const newBtcAccumulated = currentBtcAccumulated
      .sub(actualBtcSold)
      .toNumber();

    // Calculate USDT amounts using actual values from fills
    const usdtReceived = actualUsdtReceived;
    const usdtFee = orderResult.feeUSDT;
    const netUsdtReceived = usdtReceived.sub(usdtFee);

    // Check if this is a complete sale (cycle reset)
    // Use trading rules to determine if remaining BTC is just dust
    await this.tradingRules.getRules("BTCUSDT"); // Ensure rules are cached
    const isCycleComplete = this.tradingRules.isDust(
      newBtcAccumulated,
      "BTCUSDT",
    );

    if (isCycleComplete) {
      // CYCLE COMPLETE - Return signal to create new cycle

      // Calculate profit using actual BTC sold (per STRATEGY.md lines 116-118)
      const referencePrice = currentState.reference_price ?? 0;
      const principal = new Decimal(referencePrice).mul(actualBtcSold);
      const profit = Decimal.max(0, netUsdtReceived.sub(principal));

      // Update capital (per STRATEGY.md line 118)
      const currentCapital = new Decimal(currentState.capital_available);
      const newCapitalAvailable = currentCapital
        .add(principal)
        .add(profit)
        .toNumber();

      // Log dust preservation
      if (newBtcAccumulated > 0) {
        logger.info("Preserving dust for next cycle", {
          dustAmount: newBtcAccumulated,
          dustValue: newBtcAccumulated * (currentState.reference_price || 0),
          minTradable: this.tradingRules.getMinTradableAmount("BTCUSDT"),
        });
      }

      // Return signal to create new cycle
      logger.info("🔄 Cycle complete, signaling for new cycle creation", {
        previousCycleId: currentState.id,
        finalProfit: profit.toNumber(),
        carryOverCapital: newCapitalAvailable,
        carryOverDust: newBtcAccumulated,
      });

      return {
        type: "CREATE_NEW_CYCLE",
        previousCycleId: currentState.id,
        completionData: {
          finalProfit: profit.toNumber(),
          carryOverCapital: newCapitalAvailable,
          carryOverDust: newBtcAccumulated,
        },
      };
    } else {
      // PARTIAL SALE - Cycle continues

      // Just update capital with the USDT received
      const newCapitalAvailable = new Decimal(currentState.capital_available)
        .add(netUsdtReceived)
        .toNumber();

      // Keep current btc_accum_net and cost_accum_usdt as they track the full cycle
      return {
        type: "UPDATE_CYCLE",
        updates: {
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
        },
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
