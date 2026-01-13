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
import type { CommissionManager } from "../exchange/commission-manager";
import type { StrategyConfig } from "../config/strategy-config-loader";
import { calculateSellThreshold } from "../utils/pricing-calculations";

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
  sell_reference_price: number | null;
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
  private commissionManager?: CommissionManager;
  private tradingRules: TradingRules;
  private strategyConfig?: StrategyConfig;
  private baseAssetPrecision: number;

  constructor(
    supabase: SupabaseClient<Database>,
    _config: SellOrderStateUpdaterConfig, // Prefix with _ to indicate unused
    discordNotifier: DiscordNotifier | undefined,
    tradingRules: TradingRules,
    commissionManager?: CommissionManager,
    baseAssetPrecision: number = 8, // Default BTC precision
    strategyConfig?: StrategyConfig,
  ) {
    super();
    this.supabase = supabase;
    this.transactionManager = new StateTransactionManager(supabase);
    // Note: config parameter is kept for API compatibility but not currently used
    this.discordNotifier = discordNotifier;
    this.tradingRules = tradingRules;
    this.commissionManager = commissionManager;
    this.strategyConfig = strategyConfig;
    this.baseAssetPrecision = baseAssetPrecision;
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
    risePercentage?: number,
    initialCapital?: number,
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
        logger.info("[SELL] Cycle complete", {
          timeframe: this.strategyConfig?.timeframe || "unknown",
          cycleId: currentState.id,
          profit: updateResult.completionData.finalProfit.toFixed(2),
          carryCapital: updateResult.completionData.carryOverCapital.toFixed(2),
        });

        // Send Discord notification for cycle completion (full sell)
        if (this.discordNotifier) {
          try {
            // Get dynamic commission rate
            let commissionRate = 0.001; // Default 0.1%
            if (this.commissionManager) {
              try {
                commissionRate =
                  await this.commissionManager.getTakerCommission();
              } catch (error) {
                logger.warn(
                  "Failed to get commission rate for notification, using default 0.1%",
                  {
                    timeframe: this.strategyConfig?.timeframe || "unknown",
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                );
              }
            }

            // Use provided initialCapital or fall back to total cost
            const totalCost = currentState.cost_accum_usdt || 0;
            const actualInitialCapital =
              initialCapital ?? (totalCost > 0 ? totalCost : 1000);
            const profitPercentage =
              (updateResult.completionData.finalProfit / actualInitialCapital) *
              100;

            // Calculate target price using shared utility
            const actualRisePercentage = risePercentage ?? 0.03;
            const targetPrice = currentState.sell_reference_price
              ? calculateSellThreshold(
                  currentState.sell_reference_price,
                  actualRisePercentage,
                  commissionRate,
                )
              : null;

            const fields = [
              {
                name: "⏱️ Timeframe",
                value: this.strategyConfig?.timeframe || "Unknown",
                inline: true,
              },
              {
                name: "🔧 Mode",
                value:
                  this.strategyConfig?.buyMode === "geom_modified"
                    ? "Geometric Modified"
                    : "Arithmetic",
                inline: true,
              },
              {
                name: "💰 Sell Price",
                value: `$${orderResult.avgPrice.toFixed(2)}`,
                inline: false,
              },
              {
                name: "📦 BTC Sold",
                value: `${orderResult.executedQty.toFixed(this.baseAssetPrecision)} BTC`,
                inline: false,
              },
              {
                name: "💵 USDT Received",
                value: `$${orderResult.cummulativeQuoteQty.toFixed(2)}`,
                inline: false,
              },
              {
                name: "💹 Avg Buy Price",
                value: currentState.sell_reference_price
                  ? `$${currentState.sell_reference_price.toFixed(2)}`
                  : "Not set",
                inline: false,
              },
              {
                name: "🎯 Target Price (was)",
                value: targetPrice ? `$${targetPrice.toFixed(2)}` : "Not set",
                inline: false,
              },
              {
                name: `📈 ATH (${this.strategyConfig?.athWindow || 20}-candle lookback)`,
                value: currentState.ath_reference_price
                  ? `$${currentState.ath_reference_price.toFixed(2)}`
                  : "Not set",
                inline: false,
              },
              {
                name:
                  this.strategyConfig?.buyMode === "geom_modified"
                    ? "📊 Last Buy Price (p_last_buy)"
                    : "📊 Buy Anchor (grid base)",
                value:
                  this.strategyConfig?.buyMode === "geom_modified"
                    ? currentState.p_last_buy
                      ? `$${currentState.p_last_buy.toFixed(2)}`
                      : "Not set"
                    : currentState.buy_anchor_price
                      ? `$${currentState.buy_anchor_price.toFixed(2)}`
                      : "Not set",
                inline: false,
              },
              {
                name: "📊 Profit",
                value: `$${updateResult.completionData.finalProfit.toFixed(2)} (${profitPercentage.toFixed(2)}%)`,
                inline: false,
              },
              {
                name: "💰 Initial Capital",
                value: `$${actualInitialCapital.toFixed(2)}`,
                inline: false,
              },
              {
                name: "💼 Final Capital",
                value: `$${updateResult.completionData.carryOverCapital.toFixed(2)}`,
                inline: false,
              },
              {
                name: "🔄 Cycle",
                value: "COMPLETE ✅",
                inline: false,
              },
            ];
            await this.discordNotifier.sendSellNotification(fields);
          } catch (error) {
            logger.error("Failed to send Discord notification", {
              timeframe: this.strategyConfig?.timeframe || "unknown",
              error,
            });
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
      logger.info("[SELL] Partial sale, cycle continues", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        cycleId: currentState.id,
        orderId: orderResult.orderId,
        btcRemaining: updates.btc_accumulated.toFixed(8),
        capitalAvailable: updates.capital_available.toFixed(2),
      });

      // Log to database
      await this.logStateUpdate(currentState.id, orderResult.orderId, updates);

      // Send Discord notifications for partial sale
      if (this.discordNotifier) {
        try {
          // Get dynamic commission rate
          let commissionRate = 0.001; // Default 0.1%
          if (this.commissionManager) {
            try {
              commissionRate =
                await this.commissionManager.getTakerCommission();
            } catch (error) {
              logger.warn(
                "Failed to get commission rate for notification, using default 0.1%",
                {
                  timeframe: this.strategyConfig?.timeframe || "unknown",
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            }
          }

          // Regular sell notification
          // For partial sell (should not happen in current strategy, but handle gracefully)
          const grossProceeds = orderResult.cummulativeQuoteQty.toNumber();
          const netProceeds = usdtReceived; // Already calculated as net

          // Calculate current profit if possible
          const totalCost = currentState.cost_accum_usdt || 0;
          const totalRevenue = netProceeds;
          const currentProfit = totalRevenue - totalCost;
          const actualInitialCapital =
            initialCapital ?? (totalCost > 0 ? totalCost : 1000);
          const profitPercentage =
            totalCost > 0 ? (currentProfit / totalCost) * 100 : 0;

          // Calculate target price using shared utility
          const actualRisePercentage = risePercentage ?? 0.03;
          const targetPrice = currentState.sell_reference_price
            ? calculateSellThreshold(
                currentState.sell_reference_price,
                actualRisePercentage,
                commissionRate,
              )
            : null;

          const fields = [
            {
              name: "⏱️ Timeframe",
              value: this.strategyConfig?.timeframe || "Unknown",
              inline: true,
            },
            {
              name: "🔧 Mode",
              value:
                this.strategyConfig?.buyMode === "geom_modified"
                  ? "Geometric Modified"
                  : "Arithmetic",
              inline: true,
            },
            {
              name: "💰 Sell Price",
              value: `$${orderResult.avgPrice.toFixed(2)}`,
              inline: false,
            },
            {
              name: "📦 BTC Sold",
              value: `${orderResult.executedQty.toFixed(8)} BTC`,
              inline: false,
            },
            {
              name: "💵 USDT Received",
              value: `$${grossProceeds.toFixed(2)}`,
              inline: false,
            },
            {
              name: "💹 Avg Buy Price",
              value: currentState.sell_reference_price
                ? `$${currentState.sell_reference_price.toFixed(2)}`
                : "Not set",
              inline: false,
            },
            {
              name: "🎯 Target Price (was)",
              value: targetPrice ? `$${targetPrice.toFixed(2)}` : "Not set",
              inline: false,
            },
            {
              name: `📈 ATH (${this.strategyConfig?.athWindow || 20}-candle lookback)`,
              value: currentState.ath_reference_price
                ? `$${currentState.ath_reference_price.toFixed(2)}`
                : "Not set",
              inline: false,
            },
            {
              name:
                this.strategyConfig?.buyMode === "geom_modified"
                  ? "📊 Last Buy Price (p_last_buy)"
                  : "📊 Buy Anchor (grid base)",
              value:
                this.strategyConfig?.buyMode === "geom_modified"
                  ? currentState.p_last_buy
                    ? `$${currentState.p_last_buy.toFixed(2)}`
                    : "Not set"
                  : currentState.buy_anchor_price
                    ? `$${currentState.buy_anchor_price.toFixed(2)}`
                    : "Not set",
              inline: false,
            },
            {
              name: "📊 Profit",
              value: `$${currentProfit.toFixed(2)} (${profitPercentage.toFixed(2)}%)`,
              inline: false,
            },
            {
              name: "💰 Initial Capital",
              value: `$${actualInitialCapital.toFixed(2)}`,
              inline: false,
            },
            {
              name: "💼 Final Capital",
              value: `$${updates.capital_available.toFixed(2)}`,
              inline: false,
            },
            {
              name: "🔄 Cycle",
              value:
                updates.btc_accumulated > 0.00000001
                  ? "PARTIAL (Dust Remaining)"
                  : "COMPLETE ✅",
              inline: false,
            },
          ];
          await this.discordNotifier.sendSellNotification(fields);
        } catch (error) {
          logger.error("Failed to send Discord notification", {
            timeframe: this.strategyConfig?.timeframe || "unknown",
            error,
          });
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
        timeframe: this.strategyConfig?.timeframe || "unknown",
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
    } else {
      // Fallback to reported values if no fills
      actualBtcSold = orderResult.executedQty;
      actualUsdtReceived = orderResult.cummulativeQuoteQty;
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
      const referencePrice = currentState.sell_reference_price ?? 0;
      const principal = new Decimal(referencePrice).mul(actualBtcSold);
      const profit = Decimal.max(0, netUsdtReceived.sub(principal));

      // Update capital (per STRATEGY.md line 118)
      const currentCapital = new Decimal(currentState.capital_available);
      const newCapitalAvailable = currentCapital
        .add(principal)
        .add(profit)
        .toNumber();

      // Return signal to create new cycle
      logger.info("[SELL] Signaling new cycle - all BTC sold", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        cycleId: currentState.id,
        profit: profit.toNumber().toFixed(2),
        dust: newBtcAccumulated.toFixed(8),
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
          sell_reference_price: currentState.sell_reference_price,
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
      logger.error("Failed to fetch cycle state", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        cycleId,
        error,
      });
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
      logger.error("Failed to log state update event", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        error,
      });
    }
  }
}
