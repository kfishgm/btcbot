/**
 * Arithmetic Buy Engine - Grid-Based Strategy
 *
 * Implements arithmetic buy grid strategy from STRATEGY_UPDATED.md:
 * - Pre-calculated grid levels: P_n = ATH * (1 - n * %Drop)
 * - Grid levels are trigger points, not buy prices
 * - If multiple levels crossed, execute ONE buy for combined amount
 * - Actual buy executes at current market price
 *
 * CRITICAL: This engine's behavior MUST NOT change.
 * Any behavior change is a regression bug.
 */

import {
  BuyAmountCalculator,
  CycleState as BuyAmountCycleState,
} from "./buy-amount-calculator.js";
import { logger } from "../utils/logger.js";
import type { TradingRules } from "../exchange/trading-rules.js";
import type { StrategyConfig } from "../config/strategy-config-loader.js";
import type {
  IBuyEngine,
  BuyEngineInput,
  BuyEngineResult,
  BuyEngineCycleState,
  BuyEngineTradingConfig,
} from "./buy-engine-interface.js";

export class ArithmeticBuyEngine implements IBuyEngine {
  private tickSize: number | null = null;

  constructor(
    private buyAmountCalculator: BuyAmountCalculator,
    private strategyConfig: StrategyConfig,
    private tradingRules?: TradingRules,
  ) {}

  /**
   * Get tick size from trading rules or use default
   */
  private async getTickSize(): Promise<number> {
    if (this.tickSize !== null) {
      return this.tickSize;
    }

    if (this.tradingRules) {
      try {
        const rules = await this.tradingRules.getRules("BTCUSDT");
        this.tickSize = rules.tickSize;
        return rules.tickSize;
      } catch (error) {
        logger.warn("Failed to fetch trading rules, using default tickSize", {
          timeframe: this.strategyConfig.timeframe,
          error,
        });
      }
    }

    // Default tickSize for BTCUSDT
    return 0.01;
  }

  /**
   * Check if conditions are met to trigger a buy order based on grid levels
   */
  public async checkBuyTrigger(
    input: BuyEngineInput,
  ): Promise<BuyEngineResult> {
    const { state, config, candle } = input;

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

    // Work with a mutable copy of state for grid building
    const workingState = { ...state };

    // 1. Check if strategy is active (not PAUSED)
    validations.strategyActive = this.isStrategyActive(workingState.status);
    if (!validations.strategyActive) {
      return {
        shouldBuy: false,
        reason: "Strategy is PAUSED",
        validations,
      };
    }

    // 2. Check if we have purchases remaining
    if (workingState.purchases_remaining <= 0) {
      return {
        shouldBuy: false,
        reason: "No purchases remaining",
        validations,
      };
    }

    // 3. Check if buy grid is valid and we have levels to check
    if (!workingState.buy_grid || workingState.buy_grid.length === 0) {
      // Need ATH reference price to build initial grid
      if (
        !workingState.ath_reference_price ||
        workingState.ath_reference_price <= 0
      ) {
        return {
          shouldBuy: false,
          reason: "No ATH reference price available to build grid",
          validations,
        };
      }

      // Check if current price has dropped to first grid level
      const firstGridLevel =
        workingState.ath_reference_price * (1 - config.dropPercentage);

      if (candle.close > firstGridLevel) {
        return {
          shouldBuy: false,
          reason: `Price ${this.formatPrice(candle.close)} above first grid level ${this.formatPrice(firstGridLevel)}`,
          validations,
        };
      }

      // Price has reached first grid level - build the grid dynamically
      const newGrid = await this.buildBuyGrid(
        workingState.ath_reference_price,
        config,
        workingState.buy_anchor_price,
      );

      workingState.buy_grid = newGrid;
      workingState.buy_index = 0;
      validations.gridValid = true;
      gridBuiltInThisCall = true;
    } else if (workingState.buy_index >= workingState.buy_grid.length) {
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
    let newBuyIndex = workingState.buy_index;

    // Check if this is the first buy (no anchor price set yet)
    const isFirstBuy = !workingState.buy_anchor_price;

    while (
      newBuyIndex < workingState.buy_grid.length &&
      candle.close <= workingState.buy_grid[newBuyIndex]
    ) {
      triggeredLevels.push(workingState.buy_grid[newBuyIndex]);
      levelsTriggered++;
      newBuyIndex++;

      // For first buy, only trigger ONE level regardless of how many are crossed
      if (isFirstBuy) {
        break;
      }

      // Don't trigger more levels than purchases remaining
      if (levelsTriggered >= workingState.purchases_remaining) {
        break;
      }
    }

    validations.priceThresholdMet = levelsTriggered > 0;

    if (!validations.priceThresholdMet) {
      const nextLevel = workingState.buy_grid[workingState.buy_index];
      return {
        shouldBuy: false,
        reason: `Price ${this.formatPrice(candle.close)} above next grid level ${this.formatPrice(nextLevel)}`,
        validations,
      };
    }

    // 5. Calculate combined buy amount for all triggered levels
    let totalBuyAmount = 0;
    const baseAmount = this.calculateBaseAmount(workingState, config);

    for (let i = 0; i < levelsTriggered; i++) {
      const remainingAfterThis = workingState.purchases_remaining - i;

      if (remainingAfterThis === 1) {
        // Last purchase - use all remaining capital
        totalBuyAmount = workingState.capital_available;
        break;
      } else {
        // Use base amount for this level
        totalBuyAmount += baseAmount;
      }
    }

    // Cap at available capital
    totalBuyAmount = Math.min(totalBuyAmount, workingState.capital_available);

    // 6. Check if capital is available
    validations.capitalAvailable =
      workingState.capital_available >= totalBuyAmount;
    if (!validations.capitalAvailable) {
      return {
        shouldBuy: false,
        reason: `Insufficient capital: ${this.formatPrice(workingState.capital_available)} < ${this.formatPrice(totalBuyAmount)} USDT`,
        validations,
      };
    }

    // 7. Check if amount is valid (meets minimums)
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
    const result: BuyEngineResult = {
      shouldBuy: true,
      buyAmount: totalBuyAmount,
      levelsTriggered,
      newBuyIndex,
      triggeredLevels,
      validations,
    };

    // If we built a new grid in this call, include it in the result
    if (gridBuiltInThisCall && workingState.buy_grid) {
      result.newGrid = workingState.buy_grid;
    }

    return result;
  }

  /**
   * Calculate the base buy amount per grid level
   */
  private calculateBaseAmount(
    state: BuyEngineCycleState,
    config: BuyEngineTradingConfig,
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
   */
  public calculateBuyAmount(state: BuyEngineCycleState): number {
    const buyAmountState: BuyAmountCycleState = {
      buy_amount: state.buy_amount,
      capital_available: state.capital_available,
      purchases_remaining: state.purchases_remaining,
    };

    return this.buyAmountCalculator.calculateBuyAmount(buyAmountState);
  }

  /**
   * Quantize a value to tick size (floor operation as per Binance rules)
   */
  private quantizeToTick(value: number, tickSize: number): number {
    return Math.floor(value / tickSize) * tickSize;
  }

  /**
   * Build the buy grid based on anchor price (if available) or ATH
   * Grid levels: P_n = anchorPrice * (1 - n * %Drop) for n = 1 to maxPurchases
   */
  private async buildBuyGrid(
    athPrice: number,
    config: BuyEngineTradingConfig,
    anchorPrice?: number | null,
  ): Promise<number[]> {
    const grid: number[] = [];
    const basePrice = anchorPrice || athPrice;
    const tickSize = await this.getTickSize();

    for (let n = 1; n <= config.maxPurchases; n++) {
      const rawLevel = basePrice * (1 - n * config.dropPercentage);
      const quantizedLevel = this.quantizeToTick(rawLevel, tickSize);
      grid.push(quantizedLevel);
    }

    return grid;
  }

  /**
   * Build grid from anchor price after first buy
   * Called when anchor price is set and grid needs to be rebuilt
   */
  public async buildGridFromAnchor(
    anchorPrice: number,
    config: BuyEngineTradingConfig,
  ): Promise<number[]> {
    const grid: number[] = [];
    const tickSize = await this.getTickSize();

    for (let n = 1; n <= config.maxPurchases; n++) {
      const rawLevel = anchorPrice * (1 - n * config.dropPercentage);
      const quantizedLevel = this.quantizeToTick(rawLevel, tickSize);
      grid.push(quantizedLevel);
    }

    // Verify first level is below anchor
    const firstLevelBelowAnchor = grid[0] && grid[0] < anchorPrice;

    if (!firstLevelBelowAnchor) {
      logger.warn("First grid level is NOT below anchor price", {
        timeframe: this.strategyConfig.timeframe,
        anchor: anchorPrice,
        firstLevel: grid[0],
      });
    }

    return grid;
  }
}
