/**
 * Sell Trigger Detector
 *
 * Implements sell trigger logic from STRATEGY_UPDATED.md:
 * - SELL CONDITION: if (btc_accumulated > 0 AND Close >= avg_cost * (1 + %Rise))
 * - avg_cost = cost_accum_usdt / btc_accum_net
 * - IMPORTANT: Now using separate fields:
 *   - ath_reference_price = ATH from rolling window (for first buy trigger)
 *   - sell_reference_price = avg_cost when BTC held (for sell trigger)
 *
 * Pre-sell validations:
 * 1. Strategy is not PAUSED
 * 2. BTC accumulated > 0
 * 3. Price meets sell threshold (above avg_cost * (1 + %Rise))
 * 4. Minimum notional value met
 *
 * Critical: ONLY sell btc_accumulated amount (cycle isolation)
 */

import { logger } from "../utils/logger.js";
import type { TradingRules } from "../exchange/trading-rules.js";
import type { CommissionManager } from "../exchange/commission-manager.js";

export interface CycleState {
  status: "READY" | "HOLDING" | "PAUSED";
  sell_reference_price: number | null; // Average cost for sell trigger
  btc_accumulated: number;
  purchases_remaining: number;
  capital_available: number;
}

export interface TradingConfig {
  risePercentage: number; // e.g., 0.03 for 3%
  dropPercentage: number; // e.g., 0.02 for 2%
  exchangeMinNotional: number; // Minimum trade value
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

export interface SellTriggerResult {
  shouldSell: boolean;
  sellAmount?: number;
  reason?: string;
  validations?: {
    strategyActive: boolean;
    hasAccumulatedBTC: boolean;
    priceThresholdMet: boolean;
    minNotionalMet: boolean;
  };
}

export class SellTriggerDetector {
  private baseAssetPrecision: number = 8; // Default BTC precision
  private quoteAssetPrecision: number = 8; // Default USDT precision

  constructor(
    private tradingRules?: TradingRules,
    private commissionManager?: CommissionManager,
  ) {}

  /**
   * Set trading precision values
   */
  public setTradingPrecision(
    baseAssetPrecision: number,
    quoteAssetPrecision: number,
  ): void {
    this.baseAssetPrecision = baseAssetPrecision;
    this.quoteAssetPrecision = quoteAssetPrecision;
  }
  /**
   * Check if conditions are met to trigger a sell order
   * @param state Current cycle state
   * @param config Trading configuration
   * @param candle Current candle data
   * @param balances Current balance information
   * @returns Sell trigger result with decision and validations
   */
  public async checkSellTrigger(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    _balances: BalanceInfo, // Kept for interface compatibility, no longer used for drift check
  ): Promise<SellTriggerResult> {
    // Initialize validations object
    const validations = {
      strategyActive: false,
      hasAccumulatedBTC: false,
      priceThresholdMet: false,
      minNotionalMet: false,
    };

    // 1. Check if strategy is active (not PAUSED)
    validations.strategyActive = this.isStrategyActive(state.status);
    if (!validations.strategyActive) {
      return {
        shouldSell: false,
        reason: "Strategy is PAUSED",
        validations,
      };
    }

    // 2. Check if we have meaningful BTC to sell (not dust)
    validations.hasAccumulatedBTC = state.btc_accumulated > 0;
    if (!validations.hasAccumulatedBTC) {
      return {
        shouldSell: false,
        reason: "No BTC accumulated to sell",
        validations,
      };
    }

    // 2b. Check if accumulated BTC is just dust
    if (this.tradingRules) {
      await this.tradingRules.getRules("BTCUSDT");
      const isDust = this.tradingRules.isDust(state.btc_accumulated, "BTCUSDT");
      if (isDust) {
        return {
          shouldSell: false,
          reason: `BTC amount (${state.btc_accumulated}) is dust (below minimum tradable)`,
          validations,
        };
      }
    }

    // 3. Check if average cost is set (stored as sell_reference_price)
    if (
      state.sell_reference_price === null ||
      state.sell_reference_price === undefined
    ) {
      return {
        shouldSell: false,
        reason: "Average cost is not set (no sell reference price)",
        validations,
      };
    }

    // 4. Check if price meets sell threshold
    const sellThreshold = await this.calculateSellThreshold(
      state.sell_reference_price,
      config.risePercentage,
    );
    validations.priceThresholdMet = candle.close >= sellThreshold;

    if (!validations.priceThresholdMet) {
      return {
        shouldSell: false,
        reason: `Price ${this.formatPrice(candle.close)} below sell threshold ${this.formatPrice(sellThreshold)}`,
        validations,
      };
    }

    // 5. Check minimum notional value
    const notionalValue = state.btc_accumulated * candle.close;
    validations.minNotionalMet = notionalValue >= config.exchangeMinNotional;

    if (!validations.minNotionalMet) {
      return {
        shouldSell: false,
        reason: `Notional value ${this.formatPrice(notionalValue)} below minimum ${this.formatPrice(config.exchangeMinNotional)}`,
        validations,
      };
    }

    // All validations passed - trigger sell
    this.logSellDecision(
      true,
      candle.close,
      sellThreshold,
      state.btc_accumulated,
    );

    return {
      shouldSell: true,
      sellAmount: state.btc_accumulated, // Always sell 100% of cycle BTC
      validations,
    };
  }

  /**
   * Calculate the sell threshold price accounting for commission
   * @param referencePrice Average cost (sell_reference_price = cost_accum_usdt / btc_accum_net)
   * @param risePercentage Rise percentage (e.g., 0.03 for 3%)
   * @returns Sell threshold price adjusted for commission
   */
  public async calculateSellThreshold(
    referencePrice: number,
    risePercentage: number,
  ): Promise<number> {
    // Get current taker commission rate (for market orders)
    let commissionRate = 0.001; // Default 0.1%

    if (this.commissionManager) {
      try {
        commissionRate = await this.commissionManager.getTakerCommission();
      } catch (error) {
        logger.warn("Failed to get commission rate, using default 0.1%", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // New formula: (Reference Price × (1 + %Rise)) / (1 - fee_sell)
    // This ensures that after selling and paying commission, we achieve the target %Rise
    const targetGrossPrice = referencePrice * (1 + risePercentage);
    const adjustedSellPrice = targetGrossPrice / (1 - commissionRate);

    logger.debug("Sell threshold calculated with commission adjustment", {
      referencePrice,
      risePercentage,
      commissionRate,
      targetNetPrice: targetGrossPrice,
      adjustedSellPrice,
      adjustment: adjustedSellPrice - targetGrossPrice,
    });

    return adjustedSellPrice;
  }

  /**
   * Check if strategy is active (not PAUSED)
   * @param status Current strategy status
   * @returns True if strategy is active
   */
  public isStrategyActive(status: string): boolean {
    return status !== "PAUSED";
  }

  /**
   * Format price for logging
   * @param price Price to format
   * @returns Formatted price string
   */
  public formatPrice(price: number): string {
    if (price === null || price === undefined || isNaN(price)) {
      return "0.00";
    }
    // Use dynamic precision based on quote asset
    const precision = Math.min(2, this.quoteAssetPrecision);
    return price.toFixed(precision);
  }

  /**
   * Format BTC amount for logging
   * @param btc BTC amount to format
   * @returns Formatted BTC string
   */
  public formatBTC(btc: number): string {
    if (btc === null || btc === undefined || isNaN(btc)) {
      return "0".padEnd(this.baseAssetPrecision + 1, "0");
    }
    // Use dynamic precision based on base asset
    return btc.toFixed(this.baseAssetPrecision);
  }

  /**
   * Log sell decision
   * @param shouldSell Whether sell was triggered
   * @param currentPrice Current market price
   * @param threshold Sell threshold price (avg_cost * (1 + %Rise))
   * @param amount BTC amount to sell
   */
  private logSellDecision(
    shouldSell: boolean,
    currentPrice: number,
    threshold: number,
    amount: number,
  ): void {
    if (shouldSell) {
      logger.info("SELL TRIGGERED", {
        module: "SellTriggerDetector",
        price: currentPrice,
        sellThreshold: threshold,
        amount: amount,
        message: `Price ${this.formatPrice(currentPrice)} >= Sell Threshold ${this.formatPrice(threshold)} (avg_cost * rise%), Amount: ${this.formatBTC(amount)} BTC`,
      });
    }
    // Don't log when not triggered to avoid spam
  }

  /**
   * Check sell conditions following STRATEGY.md execution order
   * This method provides a simplified interface for the main trading loop
   * @param state Current cycle state
   * @param config Trading configuration
   * @param candle Current candle
   * @param balances Current balances
   * @returns True if sell should be executed
   */
  public async shouldExecuteSell(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): Promise<boolean> {
    const result = await this.checkSellTrigger(state, config, candle, balances);
    return result.shouldSell;
  }

  /**
   * Get detailed validation results for debugging
   * @param state Current cycle state
   * @param config Trading configuration
   * @param candle Current candle
   * @param balances Current balances
   * @returns Detailed validation results
   */
  public async getValidationDetails(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): Promise<SellTriggerResult["validations"]> {
    const result = await this.checkSellTrigger(state, config, candle, balances);
    return result.validations;
  }

  /**
   * Get the amount of BTC to sell (always btc_accumulated for cycle isolation)
   * @param state Current cycle state
   * @returns Amount of BTC to sell
   */
  public getSellAmount(state: CycleState): number {
    // Always sell 100% of accumulated BTC (never partial, per STRATEGY.md)
    return state.btc_accumulated;
  }

  /**
   * Check if conditions would trigger a sell at a specific price
   * Useful for backtesting and analysis
   * @param state Current cycle state
   * @param config Trading configuration
   * @param testPrice Price to test
   * @param balances Current balances
   * @returns True if sell would trigger at test price
   */
  public async wouldTriggerAtPrice(
    state: CycleState,
    config: TradingConfig,
    testPrice: number,
    balances: BalanceInfo,
  ): Promise<boolean> {
    const testCandle: Candle = {
      close: testPrice,
      high: testPrice,
      low: testPrice,
      open: testPrice,
      volume: 0,
      timestamp: Date.now(),
    };

    const result = await this.checkSellTrigger(
      state,
      config,
      testCandle,
      balances,
    );
    return result.shouldSell;
  }

  /**
   * Get the next sell threshold price
   * @param state Current cycle state
   * @param config Trading configuration
   * @returns Next sell threshold price or null if no reference price
   */
  public async getNextSellThreshold(
    state: CycleState,
    config: TradingConfig,
  ): Promise<number | null> {
    if (state.sell_reference_price === null) {
      return null;
    }

    return await this.calculateSellThreshold(
      state.sell_reference_price,
      config.risePercentage,
    );
  }

  /**
   * Validate state for sell trigger detection
   * @param state State to validate
   * @returns Validation result with error message if invalid
   */
  public validateState(state: CycleState): {
    isValid: boolean;
    error?: string;
  } {
    if (state.capital_available < 0) {
      return { isValid: false, error: "Negative capital available" };
    }

    if (state.purchases_remaining < 0) {
      return { isValid: false, error: "Negative purchases remaining" };
    }

    if (state.btc_accumulated < 0) {
      return { isValid: false, error: "Negative BTC accumulated" };
    }

    if (state.sell_reference_price !== null && state.sell_reference_price < 0) {
      return { isValid: false, error: "Negative sell reference price" };
    }

    return { isValid: true };
  }

  /**
   * Validate configuration for sell trigger detection
   * @param config Configuration to validate
   * @returns Validation result with error message if invalid
   */
  public validateConfig(config: TradingConfig): {
    isValid: boolean;
    error?: string;
  } {
    if (config.risePercentage < 0 || config.risePercentage > 1) {
      return {
        isValid: false,
        error: "Rise percentage must be between 0 and 1",
      };
    }

    if (config.exchangeMinNotional < 0) {
      return {
        isValid: false,
        error: "Exchange minimum notional cannot be negative",
      };
    }

    return { isValid: true };
  }

  /**
   * Check if we're holding meaningful BTC (not dust)
   * @param state Current cycle state
   * @returns True if holding BTC above dust threshold
   */
  public isHoldingBTC(state: CycleState): boolean {
    if (state.btc_accumulated <= 0 || state.status !== "HOLDING") {
      return false;
    }

    // If we have TradingRules, check if it's dust
    if (this.tradingRules) {
      try {
        // Note: This is a synchronous check, rules should already be cached
        const isDust = this.tradingRules.isDust(
          state.btc_accumulated,
          "BTCUSDT",
        );
        return !isDust;
      } catch {
        // If rules aren't cached, fall back to simple check
        return state.btc_accumulated > 0;
      }
    }

    return state.btc_accumulated > 0;
  }

  /**
   * Calculate notional value of the sell
   * @param btcAmount BTC amount to sell
   * @param price Current price
   * @returns Notional value in USDT
   */
  public calculateNotionalValue(btcAmount: number, price: number): number {
    return btcAmount * price;
  }
}
