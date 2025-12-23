import { EventEmitter } from "events";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../types/supabase";
import type { CycleState } from "./cycle-state-manager";
import type { OrderResult } from "../order/buy-order-placer";
import { StateTransactionManager } from "./state-transaction-manager";
import { Decimal } from "decimal.js";
import { logger } from "../utils/logger";
import type { DiscordNotifier } from "../notifications/discord-notifier";
import type { CommissionManager } from "../exchange/commission-manager";
import type { StrategyConfig, BuyMode } from "../config/strategy-config-loader";
import { calculateTradeableBTC } from "../utils/btc-utils";
import { calculateSellThreshold } from "../utils/pricing-calculations";

export interface StateUpdateResult extends CycleState {
  updateSummary?: {
    btcAdded: number;
    usdtSpent: number;
    newReferencePrice: number;
    purchasesUsed: number;
  };
}

export interface StateUpdateData {
  btc_accumulated: number;
  cost_accum_usdt: number;
  btc_accum_net: number;
  btc_dust?: number | null;
  capital_available: number;
  purchases_remaining: number;
  sell_reference_price: number; // Average cost basis for sells
  status: "READY" | "HOLDING" | "PAUSED";
  buy_index?: number;
  buy_grid?: number[] | null;
  buy_anchor_price?: number | null;
  ath_price?: number | null;
  // GeomModified only - set on confirmed fill
  p_last_buy?: number | null;
}

export class BuyOrderStateUpdater extends EventEmitter {
  private supabase: SupabaseClient<Database>;
  private transactionManager: StateTransactionManager;
  private discordNotifier?: DiscordNotifier;
  private commissionManager?: CommissionManager;
  private strategyConfig?: StrategyConfig;
  private stepSize: number;
  private baseAssetPrecision: number;
  private tickSize: number;

  constructor(
    supabase: SupabaseClient<Database>,
    discordNotifier?: DiscordNotifier,
    commissionManager?: CommissionManager,
    stepSize: number = 0.00001, // Default BTCUSDT stepSize
    baseAssetPrecision: number = 8, // Default BTC precision
    tickSize: number = 0.01, // Default BTCUSDT tickSize
    strategyConfig?: StrategyConfig,
  ) {
    super();
    this.supabase = supabase;
    this.transactionManager = new StateTransactionManager(supabase);
    this.discordNotifier = discordNotifier;
    this.commissionManager = commissionManager;
    this.strategyConfig = strategyConfig;
    this.stepSize = stepSize;
    this.baseAssetPrecision = baseAssetPrecision;
    this.tickSize = tickSize;
  }

  setTradingRules(
    stepSize: number,
    baseAssetPrecision: number,
    tickSize: number,
  ): void {
    this.stepSize = stepSize;
    this.baseAssetPrecision = baseAssetPrecision;
    this.tickSize = tickSize;
  }

  async updateAfterBuyOrder(
    currentState: CycleState,
    orderResult: OrderResult,
    levelsTriggered: number = 1,
    maxPurchases?: number,
    risePercentage?: number,
    dropPercentage?: number,
    buyMode?: BuyMode,
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
      const updates = this.calculateUpdates(
        currentState,
        orderResult,
        levelsTriggered,
        maxPurchases,
        risePercentage,
        dropPercentage,
        buyMode,
      );

      if (!currentState.id) {
        throw new Error("Current state has no ID - cannot update");
      }

      const updatedState = await this.transactionManager.updateStateAtomic(
        currentState.id,
        updates,
      );

      // Create result with summary
      const result: StateUpdateResult = {
        ...updatedState,
        updateSummary: {
          btcAdded: orderResult.executedQty.sub(orderResult.feeBTC).toNumber(),
          usdtSpent: orderResult.cummulativeQuoteQty.toNumber(),
          newReferencePrice: updates.sell_reference_price,
          purchasesUsed: levelsTriggered,
        },
      };

      // Log successful update
      logger.info("[BUY] State updated", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        cycleId: currentState.id,
        orderId: orderResult.orderId,
        btcAdded: orderResult.executedQty.sub(orderResult.feeBTC).toFixed(8),
        srp: updates.sell_reference_price.toFixed(2),
        capitalLeft: updates.capital_available.toFixed(2),
      });

      // Send Discord notification
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

          // Calculate target sell price using shared utility
          const actualRisePercentage = risePercentage ?? 0.03; // Default to 3% if not provided
          const targetSellPrice = calculateSellThreshold(
            updates.sell_reference_price,
            actualRisePercentage,
            commissionRate,
          );

          // Calculate purchases completed
          // If maxPurchases is provided, use it; otherwise fall back to calculating from purchases_remaining
          const totalPurchases =
            maxPurchases ?? currentState.purchases_remaining + levelsTriggered;
          const purchasesCompleted =
            totalPurchases - updates.purchases_remaining;

          // Calculate values for notification display (per spec Section 9)
          // Note: updates.btc_dust is carried-over dust from previous cycles
          // Current cycle's dust must be calculated from btc_accum_net
          const tradeableBTC = calculateTradeableBTC(
            updates.btc_accum_net,
            this.stepSize,
            this.baseAssetPrecision,
          );
          const currentCycleDust = updates.btc_accum_net - tradeableBTC;

          // Calculate net BTC received and total cost (per spec Section 3)
          const btcFilled = orderResult.executedQty;
          const btcFee = orderResult.feeBTC;
          const netBtcReceived = btcFilled.sub(btcFee);
          const usdtSpent = orderResult.cummulativeQuoteQty;
          const usdtFee = orderResult.feeUSDT;
          const totalCostUsdt = usdtSpent.add(usdtFee);

          // Determine which fee was charged (per spec Section 3)
          const feeBTC = orderResult.feeBTC;
          const feeUSDT = orderResult.feeUSDT;
          let feeDisplay = "";
          if (feeBTC.gt(0) && feeUSDT.gt(0)) {
            feeDisplay = `${feeBTC.toFixed(this.baseAssetPrecision)} BTC + ${feeUSDT.toFixed(2)} USDT`;
          } else if (feeBTC.gt(0)) {
            feeDisplay = `${feeBTC.toFixed(this.baseAssetPrecision)} BTC`;
          } else if (feeUSDT.gt(0)) {
            feeDisplay = `${feeUSDT.toFixed(2)} USDT`;
          } else {
            feeDisplay = "0 (BNB or other)";
          }

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
              name: "💰 Buy Price",
              value: `$${orderResult.avgPrice.toFixed(2)}`,
              inline: false,
            },
            {
              name: "🔢 BASE Bought",
              value: `${orderResult.executedQty.toFixed(this.baseAssetPrecision)} BTC`,
              inline: false,
            },
            {
              name: "💸 Fee Paid",
              value: feeDisplay,
              inline: false,
            },
            {
              name: "📉 BASE Net",
              value: `${netBtcReceived.toFixed(this.baseAssetPrecision)} BTC`,
              inline: false,
            },
            {
              name: "💵 Total Cost (executed)",
              value: `$${totalCostUsdt.toFixed(2)} USDT`,
              inline: false,
            },
            {
              name: "⚖️ Sell Reference Price (SRP)",
              value: `$${updates.sell_reference_price.toFixed(2)} USDT/BTC`,
              inline: false,
            },
            {
              name: "📊 SRP Calculation",
              value: `(total USDT + fees) / tradeable BTC`,
              inline: false,
            },
            {
              name: "📈 ATH (20-candle lookback)",
              value: currentState.ath_reference_price
                ? `$${currentState.ath_reference_price.toFixed(2)}`
                : "Not set",
              inline: false,
            },
            {
              name: "📊 Buy Anchor (cycle base)",
              value: updates.buy_anchor_price
                ? `$${updates.buy_anchor_price.toFixed(2)}`
                : "Not set",
              inline: false,
            },
            {
              name: "🎯 Target Sell Price",
              value: `$${targetSellPrice.toFixed(2)} (+${(actualRisePercentage * 100).toFixed(1)}% after est. fees)`,
              inline: false,
            },
            {
              name: "📘 Target Formula",
              value: `SRP × (1 + rise%) / (1 - fee%)`,
              inline: false,
            },
            {
              name: "🧮 Tradeable | Dust",
              value: `${tradeableBTC.toFixed(this.baseAssetPrecision)} BTC | ${currentCycleDust.toFixed(this.baseAssetPrecision)} BTC`,
              inline: false,
            },
            {
              name: "💼 Capital Remaining",
              value: `$${updates.capital_available.toFixed(2)} USDT`,
              inline: false,
            },
            {
              name: "🧾 Purchases in Cycle",
              value: `${purchasesCompleted} / ${totalPurchases}`,
              inline: false,
            },
            {
              name: "🔄 Cycle Status",
              value: updates.status,
              inline: false,
            },
          ];
          await this.discordNotifier.sendBuyNotification(fields);
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
      logger.error("Failed to update state after buy order", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        cycleId: currentState.id,
        orderId: orderResult.orderId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        fullError: error,
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
    // Check purchases remaining
    if (currentState.purchases_remaining <= 0) {
      throw new Error("Cannot update state: no purchases remaining");
    }

    // Check capital availability
    const usdtSpent = orderResult.cummulativeQuoteQty.toNumber();
    if (currentState.capital_available < usdtSpent) {
      throw new Error(
        `Insufficient capital: available ${currentState.capital_available}, needed ${usdtSpent}`,
      );
    }
  }

  calculateUpdates(
    currentState: CycleState,
    orderResult: OrderResult,
    levelsTriggered: number = 1,
    maxPurchases?: number,
    _risePercentage?: number, // Not used in this method, but passed through from updateAfterBuyOrder
    dropPercentage?: number,
    buyMode?: BuyMode,
  ): StateUpdateData {
    // Calculate BTC amounts according to client's formula:
    // btc_accum_net = executedQty - feeBTC
    const btcFilled = orderResult.executedQty;
    const btcFee = orderResult.feeBTC;
    const netBtcReceived = btcFilled.sub(btcFee);

    // Calculate USDT amounts per spec Section 3 (Buy Fill Normalization):
    // - If commissionAsset = BASE (BTC): cost = cummQuote
    // - If commissionAsset = QUOTE (USDT): cost = cummQuote + commission
    // - If commissionAsset = other (BNB): cost = cummQuote
    const usdtSpent = orderResult.cummulativeQuoteQty;
    const usdtFee = orderResult.feeUSDT;

    // Add USDT fees to cost per spec Section 3
    // If fees are in BTC or BNB, feeUSDT will be 0 and this correctly equals usdtSpent
    const totalCostUsdt = usdtSpent.add(usdtFee);

    // Update accumulators
    // btc_accum_net only tracks BTC from current cycle (excludes dust)
    const newBtcAccumNet = new Decimal(currentState.btc_accum_net || 0)
      .add(netBtcReceived)
      .toNumber();

    // Total BTC = current cycle BTC + dust from previous cycles
    const newBtcAccumulated = new Decimal(newBtcAccumNet)
      .add(currentState.btc_dust || 0)
      .toNumber();

    const newCostAccumUsdt = new Decimal(currentState.cost_accum_usdt || 0)
      .add(totalCostUsdt)
      .toNumber();

    // Update capital and purchases
    // capital_available -= totalCostUSDT (the actual USDT spent)
    const newCapitalAvailable = new Decimal(currentState.capital_available)
      .sub(totalCostUsdt)
      .toNumber();

    const newPurchasesRemaining =
      currentState.purchases_remaining - levelsTriggered;

    // Calculate new reference price using ONLY tradeable BTC (excludes dust)
    // This ensures reference price reflects actual cost basis without dilution from dust
    const referencePrice = this.calculateReferencePrice(
      newCostAccumUsdt,
      newBtcAccumNet, // Excludes dust - only current cycle BTC
    );

    // Verify reference price accounts for fees
    const avgPriceNumber = orderResult.avgPrice.toNumber();
    const priceDifferencePercent =
      (Math.abs(referencePrice - avgPriceNumber) / avgPriceNumber) * 100;

    if (priceDifferencePercent < 0.05) {
      logger.warn("[BUY] Reference price unusually close to fill price", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        srp: referencePrice.toFixed(2),
        fillPrice: avgPriceNumber.toFixed(2),
        diffPercent: priceDifferencePercent.toFixed(4),
      });
    }

    // Determine status - only change from READY to HOLDING
    let newStatus: "READY" | "HOLDING" | "PAUSED";
    if (currentState.status === "READY") {
      newStatus = "HOLDING";
    } else {
      newStatus = currentState.status as "READY" | "HOLDING" | "PAUSED";
    }

    // Update buy_index if grid exists
    // The buy_index passed in has already been updated by the buy trigger detector
    // So we should just use it as-is, not add levelsTriggered
    const newBuyIndex = currentState.buy_index ?? 0;

    // Set anchor price on first buy (when it's not set yet)
    const isFirstBuy = !currentState.buy_anchor_price;

    // Quantize anchor price to tickSize using floor operation
    const rawAnchorPrice = orderResult.avgPrice.toNumber();
    const quantizedAnchorPrice =
      Math.floor(rawAnchorPrice / this.tickSize) * this.tickSize;

    const buyAnchorPrice = isFirstBuy
      ? quantizedAnchorPrice
      : currentState.buy_anchor_price;

    // Rebuild grid from anchor after first buy (per STRATEGY.md lines 159-195)
    let rebuildGrid: number[] | null = null;
    let rebuildBuyIndex = newBuyIndex;

    if (isFirstBuy) {
      // Rebuild grid from anchor price after first buy (per STRATEGY.md)
      if (buyAnchorPrice && maxPurchases) {
        const actualDropPercentage = dropPercentage || 0.003;
        rebuildGrid = this.buildGridFromAnchor(
          buyAnchorPrice,
          maxPurchases,
          actualDropPercentage,
        );
        rebuildBuyIndex = 0;

        logger.info("[BUY] First buy - grid rebuilt from anchor", {
          timeframe: this.strategyConfig?.timeframe || "unknown",
          anchorPrice: buyAnchorPrice.toFixed(2),
          dropPercent: (actualDropPercentage * 100).toFixed(1),
          gridLevels: rebuildGrid.length,
        });
      }
    }

    // For geom_modified mode, set p_last_buy to the execution price
    // CRITICAL: Only set on confirmed fill (this method is only called after confirmed fill)
    const pLastBuy =
      buyMode === "geom_modified"
        ? orderResult.avgPrice.toNumber()
        : currentState.p_last_buy;

    if (buyMode === "geom_modified") {
      logger.info("[GEOM_MOD] p_last_buy updated on confirmed fill", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        previousPLastBuy: currentState.p_last_buy,
        newPLastBuy: pLastBuy,
        avgPrice: orderResult.avgPrice.toFixed(2),
      });
    }

    return {
      btc_accumulated: newBtcAccumulated,
      cost_accum_usdt: newCostAccumUsdt,
      btc_accum_net: newBtcAccumNet,
      btc_dust: currentState.btc_dust || 0, // Preserve carried-over dust from previous cycles
      capital_available: newCapitalAvailable,
      purchases_remaining: newPurchasesRemaining,
      sell_reference_price: referencePrice, // This is the average cost basis
      buy_anchor_price: buyAnchorPrice,
      ath_price: currentState.ath_price, // Preserve ATH price
      status: newStatus,
      buy_index: rebuildBuyIndex, // Use rebuilt index if grid was rebuilt
      buy_grid: rebuildGrid || currentState.buy_grid || null, // Use rebuilt grid if available
      p_last_buy: pLastBuy, // GeomModified: set on confirmed fill
    };
  }

  private calculateReferencePrice(
    costAccumUsdt: number,
    btcAccumNet: number,
  ): number {
    // Calculate tradeable BTC (exclude dust) using Binance's precision
    const tradeableBTC = calculateTradeableBTC(
      btcAccumNet,
      this.stepSize,
      this.baseAssetPrecision,
    );

    if (tradeableBTC === 0) {
      logger.warn("[BUY] All BTC is dust, reference price = 0", {
        timeframe: this.strategyConfig?.timeframe || "unknown",
        btcNet: btcAccumNet,
      });
      return 0;
    }

    const referencePrice = costAccumUsdt / tradeableBTC;
    return Math.round(referencePrice * 100) / 100;
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

  /**
   * Build grid from anchor price after first buy
   * Per STRATEGY.md lines 159-195: After first buy, rebuild grid using execution price as anchor
   * All levels are quantized to tickSize
   */
  private buildGridFromAnchor(
    anchorPrice: number,
    maxPurchases: number,
    dropPercentage: number,
  ): number[] {
    const grid: number[] = [];

    // Start from n = 1 since we've already executed the first buy
    // Each level is n * dropPercentage below the anchor
    for (let n = 1; n <= maxPurchases; n++) {
      const rawLevel = anchorPrice * (1 - n * dropPercentage);
      const quantizedLevel =
        Math.floor(rawLevel / this.tickSize) * this.tickSize;
      grid.push(quantizedLevel);
    }

    return grid;
  }

  async logStateUpdate(
    cycleId: string,
    orderId: number,
    updates: StateUpdateData,
  ): Promise<void> {
    try {
      await this.supabase.from("bot_events").insert({
        event_type: "BUY_ORDER_STATE_UPDATE",
        severity: "info",
        message: `State updated after buy order ${orderId}`,
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
