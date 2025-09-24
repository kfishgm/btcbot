/**
 * Buy Trigger Detector - Grid-Based Strategy
 *
 * Implements arithmetic buy grid strategy from STRATEGY_UPDATED.md:
 * - Pre-calculated grid levels: P_n = ATH * (1 - n * %Drop)
 * - Grid levels are trigger points, not buy prices
 * - If multiple levels crossed, execute ONE buy for combined amount
 * - Actual buy executes at current market price
 *
 * Pre-buy validations:
 * 1. Strategy is not PAUSED
 * 2. Grid levels exist and buy_index is valid
 * 3. Price is at or below next grid level(s)
 * 4. Purchases remaining > 0
 * 5. Capital available >= buy amount
 * 6. Amount is valid (meets minimums)
 */

import {
  BuyAmountCalculator,
  CycleState as BuyAmountCycleState,
} from "./buy-amount-calculator.js";
import { logger } from "../utils/logger.js";

export interface CycleState {
  status: "READY" | "HOLDING" | "PAUSED";
  reference_price: number | null;
  purchases_remaining: number;
  capital_available: number;
  buy_amount: number | null;
  buy_anchor_price?: number | null;
  btc_accumulated: number;
  btc_dust?: number;
  buy_grid: number[] | null;
  buy_index: number;
  initial_capital_usdt?: number;
}

export interface TradingConfig {
  dropPercentage: number; // e.g., 0.02 for 2%
  risePercentage: number; // e.g., 0.03 for 3%
  minBuyUSDT: number;
  exchangeMinNotional: number;
  maxPurchases: number;
}

export interface Candle {
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  timestamp: number;
}

export interface BalanceInfo {
  usdtSpot: number;
  btcSpot: number;
}

export interface BuyTriggerResult {
  shouldBuy: boolean;
  buyAmount?: number;
  levelsTriggered?: number;
  newBuyIndex?: number;
  triggeredLevels?: number[];
  reason?: string;
  validations?: {
    priceThresholdMet: boolean;
    capitalAvailable: boolean;
    strategyActive: boolean;
    amountValid: boolean;
    gridValid: boolean;
  };
  newGrid?: number[]; // Grid to be stored if built dynamically
}

export class BuyTriggerDetector {
  constructor(private buyAmountCalculator: BuyAmountCalculator) {}

  /**
   * Check if conditions are met to trigger a buy order based on grid levels
   * @param state Current cycle state with buy_grid and buy_index
   * @param config Trading configuration
   * @param candle Current candle data
   * @param balances Current balance information
   * @returns Buy trigger result with decision, combined amount, and levels triggered
   */
  public checkBuyTrigger(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    _balances: BalanceInfo, // Kept for interface compatibility, no longer used for drift check
  ): BuyTriggerResult {
    // Initialize validations object
    const validations = {
      strategyActive: false,
      gridValid: false,
      priceThresholdMet: false,
      capitalAvailable: false,
      amountValid: false,
    };

    // Track if we build a new grid in this call
    let gridBuiltInThisCall = false;

    // 1. Check if strategy is active (not PAUSED)
    validations.strategyActive = this.isStrategyActive(state.status);
    if (!validations.strategyActive) {
      return {
        shouldBuy: false,
        reason: "Strategy is PAUSED",
        validations,
      };
    }

    // 2. Check if we have purchases remaining
    if (state.purchases_remaining <= 0) {
      return {
        shouldBuy: false,
        reason: "No purchases remaining",
        validations,
      };
    }

    // 3. Check if buy grid is valid and we have levels to check
    // If grid is not initialized and we have a reference price, check if we should build it
    if (!state.buy_grid || state.buy_grid.length === 0) {
      // Need reference price (ATH) to build grid
      if (!state.reference_price || state.reference_price <= 0) {
        return {
          shouldBuy: false,
          reason: "No reference price (ATH) available to build grid",
          validations,
        };
      }

      // Check if current price has dropped to first grid level
      const firstGridLevel =
        state.reference_price * (1 - config.dropPercentage);

      if (candle.close > firstGridLevel) {
        return {
          shouldBuy: false,
          reason: `Price ${this.formatPrice(candle.close)} above first grid level ${this.formatPrice(firstGridLevel)}`,
          validations,
        };
      }

      // Price has reached first grid level - build the grid dynamically
      // Use anchor if available, otherwise use ATH
      const newGrid = this.buildBuyGrid(
        state.reference_price,
        config,
        state.buy_anchor_price,
      );
      const basePrice = state.buy_anchor_price || state.reference_price;
      logger.info(
        `🏗️ Building buy grid from ${state.buy_anchor_price ? "anchor" : "ATH"} price: ${basePrice.toFixed(2)}`,
        {
          athPrice: state.reference_price,
          anchorPrice: state.buy_anchor_price,
          basePrice,
          dropPercentage: config.dropPercentage,
          gridLevels: newGrid.map((level) => level.toFixed(2)),
          currentPrice: candle.close,
          maxPurchases: config.maxPurchases,
          gridType: state.buy_anchor_price ? "ANCHORED" : "INITIAL",
          triggerReason: "Price reached first trigger level",
        },
      );

      // Use the newly built grid for this buy check
      // Note: The grid will be saved to state by the caller
      state.buy_grid = newGrid;
      state.buy_index = 0;
      validations.gridValid = true;
      gridBuiltInThisCall = true;
    } else if (state.buy_index >= state.buy_grid.length) {
      return {
        shouldBuy: false,
        reason: "All grid levels already crossed",
        validations,
      };
    } else {
      validations.gridValid = true;
    }

    // 4. Count how many grid levels the current price is at or below
    let levelsTriggered = 0;
    const triggeredLevels: number[] = [];
    let newBuyIndex = state.buy_index;

    // Check if this is the first buy (no anchor price set yet)
    const isFirstBuy = !state.buy_anchor_price;

    while (
      newBuyIndex < state.buy_grid.length &&
      candle.close <= state.buy_grid[newBuyIndex]
    ) {
      triggeredLevels.push(state.buy_grid[newBuyIndex]);
      levelsTriggered++;
      newBuyIndex++;

      // For first buy, only trigger ONE level regardless of how many are crossed
      if (isFirstBuy) {
        logger.info("🎯 First buy detected - limiting to single level", {
          totalLevelsCrossed: levelsTriggered,
          currentPrice: candle.close,
          anchorPrice: state.buy_anchor_price,
          gridLevel: this.formatPrice(state.buy_grid[state.buy_index]),
          note: "Grid will be rebuilt after this buy executes",
        });
        break;
      }

      // Don't trigger more levels than purchases remaining
      if (levelsTriggered >= state.purchases_remaining) {
        break;
      }
    }

    validations.priceThresholdMet = levelsTriggered > 0;

    if (!validations.priceThresholdMet) {
      const nextLevel = state.buy_grid[state.buy_index];
      return {
        shouldBuy: false,
        reason: `Price ${this.formatPrice(candle.close)} above next grid level ${this.formatPrice(nextLevel)}`,
        validations,
      };
    }

    // 5. Calculate combined buy amount for all triggered levels
    let totalBuyAmount = 0;
    const baseAmount = this.calculateBaseAmount(state, config);

    for (let i = 0; i < levelsTriggered; i++) {
      const remainingAfterThis = state.purchases_remaining - i;

      if (remainingAfterThis === 1) {
        // Last purchase - use all remaining capital
        totalBuyAmount = state.capital_available;
        break;
      } else {
        // Use base amount for this level
        totalBuyAmount += baseAmount;
      }
    }

    // Cap at available capital
    totalBuyAmount = Math.min(totalBuyAmount, state.capital_available);

    // 6. Check if capital is available
    validations.capitalAvailable = state.capital_available >= totalBuyAmount;
    if (!validations.capitalAvailable) {
      return {
        shouldBuy: false,
        reason: `Insufficient capital: ${this.formatPrice(state.capital_available)} < ${this.formatPrice(totalBuyAmount)} USDT`,
        validations,
      };
    }

    // 6. Check if amount is valid (meets minimums)
    validations.amountValid = this.buyAmountCalculator.isAmountValid(
      totalBuyAmount,
      config.minBuyUSDT,
      config.exchangeMinNotional,
    );

    if (!validations.amountValid) {
      const skipReason = this.buyAmountCalculator.getSkipReason(
        totalBuyAmount,
        config.minBuyUSDT,
        config.exchangeMinNotional,
      );
      return {
        shouldBuy: false,
        reason:
          skipReason ||
          `Amount ${this.formatPrice(totalBuyAmount)} below minimum`,
        validations,
      };
    }

    // All checks passed - trigger buy
    logger.info(`Grid buy triggered: ${levelsTriggered} level(s) crossed`, {
      currentPrice: candle.close,
      triggeredLevels,
      levelsTriggered,
      combinedAmount: totalBuyAmount,
      currentBuyIndex: state.buy_index,
      newBuyIndex,
    });

    // Include the new grid if it was built dynamically
    const result: BuyTriggerResult = {
      shouldBuy: true,
      buyAmount: totalBuyAmount,
      levelsTriggered,
      newBuyIndex,
      triggeredLevels,
      validations,
    };

    // If we built a new grid in this call, include it in the result
    if (gridBuiltInThisCall && state.buy_grid) {
      result.newGrid = state.buy_grid;
    }

    return result;
  }

  /**
   * Calculate the base buy amount per grid level
   */
  private calculateBaseAmount(
    state: CycleState,
    config: TradingConfig,
  ): number {
    // If buy_amount is already calculated, use it
    if (state.buy_amount && state.buy_amount > 0) {
      return state.buy_amount;
    }

    // Calculate from initial capital / max purchases
    const initialCapital =
      state.initial_capital_usdt || state.capital_available;
    return Math.floor(initialCapital / config.maxPurchases);
  }

  /**
   * Check if the strategy is active
   */
  private isStrategyActive(status: string): boolean {
    return status !== "PAUSED";
  }

  /**
   * Format price for display
   */
  private formatPrice(price: number): string {
    return price.toFixed(2);
  }

  /**
   * Calculate buy amount for a specific state
   * This delegates to BuyAmountCalculator for consistency
   */
  public calculateBuyAmount(state: CycleState): number {
    const buyAmountState: BuyAmountCycleState = {
      buy_amount: state.buy_amount,
      capital_available: state.capital_available,
      purchases_remaining: state.purchases_remaining,
    };

    return this.buyAmountCalculator.calculateBuyAmount(buyAmountState);
  }

  /**
   * Quantize a value to tick size (floor operation as per Binance rules)
   * @param value The value to quantize
   * @param tickSize The tick size (default 0.01 for BTCUSDT)
   */
  private quantizeToTick(value: number, tickSize: number = 0.01): number {
    return Math.floor(value / tickSize) * tickSize;
  }

  /**
   * Build the buy grid based on anchor price (if available) or ATH
   * Grid levels: P_n = anchorPrice * (1 - n * %Drop) for n = 1 to maxPurchases
   * If no anchor price, uses ATH as the reference
   * All levels are quantized to tickSize
   */
  private buildBuyGrid(
    athPrice: number,
    config: TradingConfig,
    anchorPrice?: number | null,
  ): number[] {
    const grid: number[] = [];
    const basePrice = anchorPrice || athPrice;
    const tickSize = 0.01; // BTCUSDT tick size

    for (let n = 1; n <= config.maxPurchases; n++) {
      const rawLevel = basePrice * (1 - n * config.dropPercentage);
      const quantizedLevel = this.quantizeToTick(rawLevel, tickSize);
      grid.push(quantizedLevel);
    }

    logger.debug(
      `📊 Grid levels calculated from ${anchorPrice ? "anchor" : "ATH"}`,
      {
        basePrice: this.formatPrice(basePrice),
        dropPercentage: config.dropPercentage,
        maxPurchases: config.maxPurchases,
        gridLevels: grid.map((level, index) => ({
          level: index + 1,
          price: this.formatPrice(level),
          dropFromBase: `${((1 - level / basePrice) * 100).toFixed(2)}%`,
        })),
      },
    );

    return grid;
  }

  /**
   * Build grid from anchor price after first buy
   * Called when anchor price is set and grid needs to be rebuilt
   * All levels are quantized to tickSize
   */
  public buildGridFromAnchor(
    anchorPrice: number,
    config: TradingConfig,
  ): number[] {
    const grid: number[] = [];
    const tickSize = 0.01; // BTCUSDT tick size

    // Start from n = 1 since we've already executed the first buy
    // Each level is n * dropPercentage below the anchor
    for (let n = 1; n <= config.maxPurchases; n++) {
      const rawLevel = anchorPrice * (1 - n * config.dropPercentage);
      const quantizedLevel = this.quantizeToTick(rawLevel, tickSize);
      grid.push(quantizedLevel);
    }

    // Verify first level is below anchor
    const firstLevelBelowAnchor = grid[0] && grid[0] < anchorPrice;

    logger.info(
      `🔄 Rebuilding grid from anchor price ${anchorPrice.toFixed(2)}`,
      {
        anchorPrice: this.formatPrice(anchorPrice),
        dropPercentage: config.dropPercentage,
        maxPurchases: config.maxPurchases,
        tickSize,
        gridLevels: grid.map((level) => this.formatPrice(level)),
        firstLevel: grid[0] ? this.formatPrice(grid[0]) : "N/A",
        firstLevelBelowAnchor,
        gapFromAnchor: grid[0]
          ? `${(((anchorPrice - grid[0]) / anchorPrice) * 100).toFixed(3)}%`
          : "N/A",
        rebuiltReason: "First buy executed - anchoring to execution price",
      },
    );

    if (!firstLevelBelowAnchor) {
      logger.warn("⚠️ First grid level is NOT below anchor price!", {
        anchor: anchorPrice,
        firstLevel: grid[0],
      });
    }

    return grid;
  }
}
