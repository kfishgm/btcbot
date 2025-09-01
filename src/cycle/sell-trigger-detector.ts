/**
 * Sell Trigger Detector
 *
 * Implements TRD-004: Detect when market conditions trigger a sell order
 *
 * Formula from STRATEGY.md:
 * - SELL CONDITION: if (btc_accumulated > 0 AND Close >= reference_price * (1 + %Rise))
 * - Drift check: drift_btc = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)
 * - Must be < 0.005 (0.5%)
 *
 * Pre-sell validations:
 * 1. Strategy is not PAUSED
 * 2. BTC accumulated > 0
 * 3. Price meets sell threshold
 * 4. BTC balance >= btc_accumulated
 * 5. Drift < 0.5%
 *
 * Critical: ONLY sell btc_accumulated amount (cycle isolation)
 */

import { logger } from "../utils/logger.js";

export interface CycleState {
  status: "READY" | "HOLDING" | "PAUSED";
  reference_price: number | null;
  btc_accumulated: number;
  purchases_remaining: number;
  capital_available: number;
}

export interface TradingConfig {
  risePercentage: number; // e.g., 0.03 for 3%
  dropPercentage: number; // e.g., 0.02 for 2%
  driftThresholdPct: number; // 0.005 for 0.5%
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
    balanceSufficient: boolean;
    driftCheck: boolean;
    minNotionalMet: boolean;
  };
}

export class SellTriggerDetector {
  /**
   * Check if conditions are met to trigger a sell order
   * @param state Current cycle state
   * @param config Trading configuration
   * @param candle Current candle data
   * @param balances Current balance information
   * @returns Sell trigger result with decision and validations
   */
  public checkSellTrigger(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): SellTriggerResult {
    // Initialize validations object
    const validations = {
      strategyActive: false,
      hasAccumulatedBTC: false,
      priceThresholdMet: false,
      balanceSufficient: false,
      driftCheck: false,
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

    // 2. Check if we have BTC to sell
    validations.hasAccumulatedBTC = state.btc_accumulated > 0;
    if (!validations.hasAccumulatedBTC) {
      return {
        shouldSell: false,
        reason: "No BTC accumulated to sell",
        validations,
      };
    }

    // 3. Check if reference price is set
    if (state.reference_price === null || state.reference_price === undefined) {
      return {
        shouldSell: false,
        reason: "Reference price is not set",
        validations,
      };
    }

    // 4. Check if price meets sell threshold
    const sellThreshold = this.calculateSellThreshold(
      state.reference_price,
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

    // 5. Check if we have sufficient BTC balance
    validations.balanceSufficient = balances.btcSpot >= state.btc_accumulated;

    // 6. Check drift (using absolute value as per STRATEGY.md formula)
    const btcDrift = this.calculateDrift(
      balances.btcSpot,
      state.btc_accumulated,
    );
    validations.driftCheck = btcDrift < config.driftThresholdPct;

    // Handle insufficient balance vs drift errors
    if (!validations.balanceSufficient) {
      // When balance is insufficient, check if it's a small drift or major shortage
      // Report as insufficient balance for major shortages (user-friendly)
      // Report as drift for small discrepancies within accounting tolerance
      if (btcDrift >= config.driftThresholdPct && btcDrift > 0.1) {
        // Major shortage (>10% drift) - report as insufficient balance
        return {
          shouldSell: false,
          reason: `Insufficient BTC balance: ${this.formatBTC(balances.btcSpot)} < ${this.formatBTC(state.btc_accumulated)}`,
          validations,
        };
      } else if (!validations.driftCheck) {
        // Small drift but exceeds threshold - report as drift
        return {
          shouldSell: false,
          reason: `BTC drift ${(btcDrift * 100).toFixed(3)}% exceeds threshold ${(config.driftThresholdPct * 100).toFixed(1)}%`,
          validations,
        };
      } else {
        // Drift is OK but still insufficient - report as insufficient
        return {
          shouldSell: false,
          reason: `Insufficient BTC balance: ${this.formatBTC(balances.btcSpot)} < ${this.formatBTC(state.btc_accumulated)}`,
          validations,
        };
      }
    }

    // Check drift even when balance is sufficient (could have too much)
    if (!validations.driftCheck) {
      return {
        shouldSell: false,
        reason: `BTC drift ${(btcDrift * 100).toFixed(3)}% exceeds threshold ${(config.driftThresholdPct * 100).toFixed(1)}%`,
        validations,
      };
    }

    // 7. Check minimum notional value
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
   * Calculate the sell threshold price
   * @param referencePrice Reference price for calculations
   * @param risePercentage Rise percentage (e.g., 0.03 for 3%)
   * @returns Sell threshold price
   */
  public calculateSellThreshold(
    referencePrice: number,
    risePercentage: number,
  ): number {
    // Formula from STRATEGY.md: reference_price * (1 + %Rise)
    return referencePrice * (1 + risePercentage);
  }

  /**
   * Calculate drift percentage for BTC
   * @param spotBalance BTC spot balance from exchange
   * @param expectedBalance Expected BTC balance in state
   * @returns Drift percentage
   */
  public calculateDrift(spotBalance: number, expectedBalance: number): number {
    // Formula from STRATEGY.md: |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)
    const denominator = Math.max(expectedBalance, 0.00000001);
    return Math.abs(spotBalance - expectedBalance) / denominator;
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
    return price.toFixed(2);
  }

  /**
   * Format BTC amount for logging
   * @param btc BTC amount to format
   * @returns Formatted BTC string
   */
  public formatBTC(btc: number): string {
    if (btc === null || btc === undefined || isNaN(btc)) {
      return "0.00000000";
    }
    return btc.toFixed(8);
  }

  /**
   * Log sell decision
   * @param shouldSell Whether sell was triggered
   * @param currentPrice Current market price
   * @param threshold Sell threshold price
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
        threshold: threshold,
        amount: amount,
        message: `Price ${this.formatPrice(currentPrice)} >= Threshold ${this.formatPrice(threshold)}, Amount: ${this.formatBTC(amount)} BTC`,
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
  public shouldExecuteSell(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): boolean {
    const result = this.checkSellTrigger(state, config, candle, balances);
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
  public getValidationDetails(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): SellTriggerResult["validations"] {
    const result = this.checkSellTrigger(state, config, candle, balances);
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
  public wouldTriggerAtPrice(
    state: CycleState,
    config: TradingConfig,
    testPrice: number,
    balances: BalanceInfo,
  ): boolean {
    const testCandle: Candle = {
      close: testPrice,
      high: testPrice,
      low: testPrice,
      open: testPrice,
      volume: 0,
      timestamp: Date.now(),
    };

    const result = this.checkSellTrigger(state, config, testCandle, balances);
    return result.shouldSell;
  }

  /**
   * Get the next sell threshold price
   * @param state Current cycle state
   * @param config Trading configuration
   * @returns Next sell threshold price or null if no reference price
   */
  public getNextSellThreshold(
    state: CycleState,
    config: TradingConfig,
  ): number | null {
    if (state.reference_price === null) {
      return null;
    }

    return this.calculateSellThreshold(
      state.reference_price,
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

    if (state.reference_price !== null && state.reference_price < 0) {
      return { isValid: false, error: "Negative reference price" };
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

    if (config.driftThresholdPct < 0 || config.driftThresholdPct > 1) {
      return {
        isValid: false,
        error: "Drift threshold must be between 0 and 1",
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
   * Check if we're holding BTC (cycle status)
   * @param state Current cycle state
   * @returns True if holding BTC
   */
  public isHoldingBTC(state: CycleState): boolean {
    return state.btc_accumulated > 0 && state.status === "HOLDING";
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
