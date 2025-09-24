import { EventEmitter } from "events";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../types/supabase";
import type { CycleState } from "./cycle-state-manager";
import type { OrderResult } from "../order/buy-order-placer";
import { StateTransactionManager } from "./state-transaction-manager";
import { Decimal } from "decimal.js";
import { logger } from "../utils/logger";
import type { DiscordNotifier } from "../notifications/discord-notifier";

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
  reference_price: number;
  status: "READY" | "HOLDING" | "PAUSED";
  buy_index?: number;
  buy_grid?: number[] | null;
  buy_anchor_price?: number | null;
  ath_price?: number | null;
}

export class BuyOrderStateUpdater extends EventEmitter {
  private supabase: SupabaseClient<Database>;
  private transactionManager: StateTransactionManager;
  private discordNotifier?: DiscordNotifier;

  constructor(
    supabase: SupabaseClient<Database>,
    discordNotifier?: DiscordNotifier,
  ) {
    super();
    this.supabase = supabase;
    this.transactionManager = new StateTransactionManager(supabase);
    this.discordNotifier = discordNotifier;
  }

  async updateAfterBuyOrder(
    currentState: CycleState,
    orderResult: OrderResult,
    levelsTriggered: number = 1,
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

      logger.info("Calculating state updates", { levelsTriggered });
      // Calculate all updates
      const updates = this.calculateUpdates(
        currentState,
        orderResult,
        levelsTriggered,
      );

      logger.info("Calculated updates", {
        btc_accumulated: updates.btc_accumulated,
        reference_price: updates.reference_price,
        capital_available: updates.capital_available,
      });

      // Execute update atomically
      logger.debug("Executing atomic state update", {
        id: currentState.id,
        idType: typeof currentState.id,
        hasId: !!currentState.id,
        fullState: JSON.stringify(currentState),
      });

      if (!currentState.id) {
        throw new Error("Current state has no ID - cannot update");
      }

      // Log the exact updates being sent
      logger.debug("Sending updates to updateStateAtomic", {
        botId: currentState.id,
        updates: JSON.stringify(updates),
        updateKeys: Object.keys(updates),
        buyGridType: Array.isArray(updates.buy_grid)
          ? "array"
          : typeof updates.buy_grid,
        buyGridLength: Array.isArray(updates.buy_grid)
          ? updates.buy_grid.length
          : null,
      });

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
          newReferencePrice: updates.reference_price,
          purchasesUsed: levelsTriggered,
        },
      };

      // Log successful update
      logger.info("Buy order state update completed", {
        cycleId: currentState.id,
        orderId: orderResult.orderId,
        updates,
      });

      // Send Discord notification
      if (this.discordNotifier) {
        try {
          const fields = [
            {
              name: "📉 Buy Price",
              value: `$${orderResult.avgPrice.toFixed(2)}`,
              inline: false,
            },
            {
              name: "🔢 Quantity",
              value: `${orderResult.executedQty.toFixed(8)} BTC`,
              inline: false,
            },
            {
              name: "💵 Total Cost",
              value: `${orderResult.cummulativeQuoteQty.toFixed(2)} USDT`,
              inline: false,
            },
            {
              name: "📊 New Reference Price",
              value: `$${updates.reference_price.toFixed(2)}`,
              inline: false,
            },
            {
              name: "🛒 Purchases Remaining",
              value: updates.purchases_remaining.toString(),
              inline: false,
            },
            {
              name: "📈 BTC Accumulated",
              value: `${updates.btc_accumulated.toFixed(8)} BTC`,
              inline: false,
            },
          ];
          await this.discordNotifier.sendBuyNotification(fields);
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
      logger.error("Failed to update state after buy order", {
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

    logger.info("Order validation passed", {
      status: orderResult.status,
      executedQty: orderResult.executedQty.toString(),
      cummulativeQuoteQty: orderResult.cummulativeQuoteQty.toString(),
    });
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
  ): StateUpdateData {
    // Calculate BTC amounts
    const btcFilled = orderResult.executedQty;
    const btcFee = orderResult.feeBTC;
    const netBtcReceived = btcFilled.sub(btcFee);

    // Calculate USDT amounts
    const usdtSpent = orderResult.cummulativeQuoteQty;
    const usdtFee = orderResult.feeUSDT;
    // For Binance: BUY orders only have BTC fees (deducted from received amount)
    // The USDT cost is already the full amount paid (cummulativeQuoteQty)
    // DO NOT add fees - they're already reflected in reduced BTC quantity
    const totalCostUsdt = usdtSpent; // No fee addition - fees handled via reduced BTC

    // Debug logging for reference price calculation
    logger.debug("Reference price calculation inputs:", {
      btcFilled: btcFilled.toString(),
      btcFee: btcFee.toString(),
      netBtcReceived: netBtcReceived.toString(),
      usdtSpent: usdtSpent.toString(),
      usdtFee: usdtFee.toString(),
      totalCostUsdt: totalCostUsdt.toString(),
      avgPrice: orderResult.avgPrice.toString(),
      currentBtcAccum: currentState.btc_accumulated || 0,
      currentCostAccum: currentState.cost_accum_usdt || 0,
      currentBtcNet: currentState.btc_accum_net || 0,
      currentDust: currentState.btc_dust || 0,
    });

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

    // Calculate new reference price using ONLY current cycle BTC (excludes dust)
    // This ensures reference price reflects actual cost basis without dilution from dust
    const referencePrice = this.calculateReferencePrice(
      newCostAccumUsdt,
      newBtcAccumNet, // Excludes dust - only current cycle BTC
    );

    // More debug logging
    logger.debug("Reference price calculation results:", {
      newBtcAccumulated,
      newCostAccumUsdt,
      newBtcAccumNet,
      dustAmount: currentState.btc_dust || 0,
      calculatedReferencePrice: referencePrice,
      expectedWithFee: (
        totalCostUsdt.toNumber() / netBtcReceived.toNumber()
      ).toFixed(2),
      avgPriceFromOrder: orderResult.avgPrice.toString(),
      note: "Reference price excludes dust for accurate cost basis",
    });

    // Verify reference price accounts for fees
    const avgPriceNumber = orderResult.avgPrice.toNumber();
    const priceDifferencePercent =
      (Math.abs(referencePrice - avgPriceNumber) / avgPriceNumber) * 100;

    if (priceDifferencePercent < 0.05) {
      logger.warn(
        "⚠️ Reference price is suspiciously close to average price!",
        {
          new_reference_price: referencePrice,
          cost_accum_usdt: newCostAccumUsdt,
          btc_accum_net: newBtcAccumNet,
          formula: `${newCostAccumUsdt} / ${newBtcAccumNet} = ${referencePrice}`,
          avgPrice: avgPriceNumber,
          differencePercent: priceDifferencePercent.toFixed(4),
          expectation: "Reference price should be ~0.1% higher due to BTC fees",
        },
      );
    } else {
      logger.info("✅ Reference price calculated with fee accounting", {
        new_reference_price: referencePrice,
        cost_accum_usdt: newCostAccumUsdt,
        btc_accum_net: newBtcAccumNet,
        formula: `${newCostAccumUsdt} / ${newBtcAccumNet} = ${referencePrice}`,
        avgPrice: avgPriceNumber,
        differencePercent: priceDifferencePercent.toFixed(4),
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
    const newBuyIndex =
      currentState.buy_grid &&
      currentState.buy_index !== null &&
      currentState.buy_index !== undefined
        ? currentState.buy_index + levelsTriggered
        : (currentState.buy_index ?? 0);

    // Set anchor price on first buy (when it's not set yet)
    const isFirstBuy = !currentState.buy_anchor_price;

    // Quantize anchor price to tickSize (0.01) using floor operation
    const tickSize = 0.01;
    const rawAnchorPrice = orderResult.avgPrice.toNumber();
    const quantizedAnchorPrice =
      Math.floor(rawAnchorPrice / tickSize) * tickSize;

    const buyAnchorPrice = isFirstBuy
      ? quantizedAnchorPrice
      : currentState.buy_anchor_price;

    if (isFirstBuy) {
      logger.info("Setting buy anchor price on first buy (quantized)", {
        rawExecutionPrice: rawAnchorPrice,
        quantizedAnchorPrice: buyAnchorPrice,
        tickSize,
        athPrice: currentState.ath_price,
        referencePrice: currentState.reference_price,
      });
    }

    return {
      btc_accumulated: newBtcAccumulated,
      cost_accum_usdt: newCostAccumUsdt,
      btc_accum_net: newBtcAccumNet,
      btc_dust: currentState.btc_dust, // Preserve dust from previous cycles
      capital_available: newCapitalAvailable,
      purchases_remaining: newPurchasesRemaining,
      reference_price: referencePrice,
      buy_anchor_price: buyAnchorPrice,
      ath_price: currentState.ath_price, // Preserve ATH price
      status: newStatus,
      buy_index: newBuyIndex,
      buy_grid: currentState.buy_grid, // Preserve buy_grid
    };
  }

  private calculateReferencePrice(
    costAccumUsdt: number,
    btcAccumNet: number,
  ): number {
    if (btcAccumNet === 0) {
      logger.warn("btcAccumNet is 0, returning 0 for reference price");
      return 0;
    }

    // Calculate reference price and round to 2 decimal places
    const referencePrice = costAccumUsdt / btcAccumNet;
    const rounded = Math.round(referencePrice * 100) / 100;

    logger.debug("calculateReferencePrice details:", {
      costAccumUsdt,
      btcAccumNet,
      rawReferencePrice: referencePrice,
      roundedReferencePrice: rounded,
      formula: `${costAccumUsdt} / ${btcAccumNet} = ${referencePrice}`,
    });

    return rounded;
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
      logger.error("Failed to log state update event", { error });
    }
  }
}
