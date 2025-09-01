/**
 * Buy Trigger Detector
 *
 * Implements TRD-003: Detect when market conditions trigger a buy order
 *
 * Formula from STRATEGY.md:
 * - BUY CONDITION: if (Close ≤ reference_price * (1 - %Drop) AND
 *                      purchases_remaining > 0 AND
 *                      capital_available >= buy_amount)
 * - Drift check: drift_usdt = |USDT_SPOT - capital_available| / max(capital_available, 1)
 * - Must be < 0.005 (0.5%)
 *
 * Pre-buy validations:
 * 1. Strategy is not PAUSED
 * 2. Price meets buy threshold
 * 3. Purchases remaining > 0
 * 4. Capital available >= buy amount
 * 5. Drift < 0.5%
 * 6. Amount is valid (meets minimums)
 */

import {
  BuyAmountCalculator,
  CycleState as BuyAmountCycleState,
} from "./buy-amount-calculator";

export interface CycleState {
  status: "READY" | "HOLDING" | "PAUSED";
  reference_price: number | null;
  purchases_remaining: number;
  capital_available: number;
  buy_amount: number | null;
  btc_accumulated: number;
}

export interface TradingConfig {
  dropPercentage: number; // e.g., 0.02 for 2%
  risePercentage: number; // e.g., 0.03 for 3%
  minBuyUSDT: number;
  exchangeMinNotional: number;
  driftThresholdPct: number; // 0.005 for 0.5%
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
  reason?: string;
  validations?: {
    priceThresholdMet: boolean;
    capitalAvailable: boolean;
    driftCheck: boolean;
    strategyActive: boolean;
    amountValid: boolean;
  };
}

export class BuyTriggerDetector {
  constructor(private buyAmountCalculator: BuyAmountCalculator) {}

  /**
   * Check if conditions are met to trigger a buy order
   * @param state Current cycle state
   * @param config Trading configuration
   * @param candle Current candle data
   * @param balances Current balance information
   * @returns Buy trigger result with decision and validations
   */
  public checkBuyTrigger(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): BuyTriggerResult {
    // Initialize validations object
    const validations = {
      strategyActive: false,
      priceThresholdMet: false,
      capitalAvailable: false,
      driftCheck: false,
      amountValid: false,
    };

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

    // 3. Check if reference price is set
    if (state.reference_price === null || state.reference_price === undefined) {
      return {
        shouldBuy: false,
        reason: "Reference price is not set",
        validations,
      };
    }

    // 4. Check if price meets buy threshold
    const buyThreshold = this.calculateBuyThreshold(
      state.reference_price,
      config.dropPercentage,
    );
    validations.priceThresholdMet = candle.close <= buyThreshold;

    if (!validations.priceThresholdMet) {
      return {
        shouldBuy: false,
        reason: `Price ${this.formatPrice(candle.close)} above buy threshold ${this.formatPrice(buyThreshold)}`,
        validations,
      };
    }

    // 5. Determine buy amount
    let buyAmount: number;
    try {
      const buyAmountState: BuyAmountCycleState = {
        buy_amount: state.buy_amount,
        capital_available: state.capital_available,
        purchases_remaining: state.purchases_remaining,
      };

      buyAmount = this.buyAmountCalculator.getPurchaseAmount(buyAmountState);
    } catch (error) {
      return {
        shouldBuy: false,
        reason: `Failed to calculate buy amount: ${error instanceof Error ? error.message : "Unknown error"}`,
        validations,
      };
    }

    // 6. Check if capital is available
    validations.capitalAvailable = state.capital_available >= buyAmount;
    if (!validations.capitalAvailable) {
      return {
        shouldBuy: false,
        reason: `Insufficient capital: ${this.formatPrice(state.capital_available)} < ${this.formatPrice(buyAmount)} USDT`,
        validations,
      };
    }

    // 7. Check drift
    const usdtDrift = this.calculateDrift(
      balances.usdtSpot,
      state.capital_available,
    );
    validations.driftCheck = usdtDrift < config.driftThresholdPct;

    if (!validations.driftCheck) {
      return {
        shouldBuy: false,
        reason: `USDT drift ${(usdtDrift * 100).toFixed(3)}% exceeds threshold ${(config.driftThresholdPct * 100).toFixed(1)}%`,
        validations,
      };
    }

    // 8. Check if amount is valid (meets minimums)
    validations.amountValid = this.buyAmountCalculator.isAmountValid(
      buyAmount,
      config.minBuyUSDT,
      config.exchangeMinNotional,
    );

    if (!validations.amountValid) {
      const skipReason = this.buyAmountCalculator.getSkipReason(
        buyAmount,
        config.minBuyUSDT,
        config.exchangeMinNotional,
      );
      return {
        shouldBuy: false,
        reason:
          skipReason || `Amount ${this.formatPrice(buyAmount)} below minimum`,
        validations,
      };
    }

    // All validations passed - trigger buy
    this.logBuyDecision(true, candle.close, buyThreshold, buyAmount);

    return {
      shouldBuy: true,
      buyAmount,
      validations,
    };
  }

  /**
   * Calculate the buy threshold price
   * @param referencePrice Reference price for calculations
   * @param dropPercentage Drop percentage (e.g., 0.02 for 2%)
   * @returns Buy threshold price
   */
  public calculateBuyThreshold(
    referencePrice: number,
    dropPercentage: number,
  ): number {
    // Formula from STRATEGY.md: reference_price * (1 - %Drop)
    return referencePrice * (1 - dropPercentage);
  }

  /**
   * Calculate drift percentage
   * @param spotBalance Spot balance from exchange
   * @param expectedBalance Expected balance in state
   * @returns Drift percentage
   */
  public calculateDrift(spotBalance: number, expectedBalance: number): number {
    // Formula from STRATEGY.md: |SPOT - expected| / max(expected, 1)
    const denominator = Math.max(expectedBalance, 1);
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
   * Log buy decision
   * @param shouldBuy Whether buy was triggered
   * @param currentPrice Current market price
   * @param threshold Buy threshold price
   * @param amount Buy amount (if triggered)
   */
  private logBuyDecision(
    shouldBuy: boolean,
    currentPrice: number,
    threshold: number,
    amount?: number,
  ): void {
    // In production, this would use a proper logging service
    // For now, using console.log for development
    if (shouldBuy && amount !== undefined) {
      console.log(
        `BUY TRIGGERED: Price ${this.formatPrice(currentPrice)} <= Threshold ${this.formatPrice(threshold)}, Amount: ${this.formatPrice(amount)} USDT`,
      );
    }
    // Don't log when not triggered to avoid spam
  }

  /**
   * Check buy conditions following STRATEGY.md execution order
   * This method provides a simplified interface for the main trading loop
   * @param state Current cycle state
   * @param config Trading configuration
   * @param candle Current candle
   * @param balances Current balances
   * @returns True if buy should be executed
   */
  public shouldExecuteBuy(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): boolean {
    const result = this.checkBuyTrigger(state, config, candle, balances);
    return result.shouldBuy;
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
  ): BuyTriggerResult["validations"] {
    const result = this.checkBuyTrigger(state, config, candle, balances);
    return result.validations;
  }

  /**
   * Calculate how much capital would be used for a purchase
   * Helper method for pre-trade analysis
   * @param state Current cycle state
   * @returns Amount that would be used for purchase
   */
  public calculatePurchaseAmount(state: CycleState): number {
    const buyAmountState: BuyAmountCycleState = {
      buy_amount: state.buy_amount,
      capital_available: state.capital_available,
      purchases_remaining: state.purchases_remaining,
    };

    return this.buyAmountCalculator.getPurchaseAmount(buyAmountState);
  }

  /**
   * Check if conditions would trigger a buy at a specific price
   * Useful for backtesting and analysis
   * @param state Current cycle state
   * @param config Trading configuration
   * @param testPrice Price to test
   * @param balances Current balances
   * @returns True if buy would trigger at test price
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

    const result = this.checkBuyTrigger(state, config, testCandle, balances);
    return result.shouldBuy;
  }

  /**
   * Get the next buy threshold price
   * @param state Current cycle state
   * @param config Trading configuration
   * @returns Next buy threshold price or null if no reference price
   */
  public getNextBuyThreshold(
    state: CycleState,
    config: TradingConfig,
  ): number | null {
    if (state.reference_price === null) {
      return null;
    }

    return this.calculateBuyThreshold(
      state.reference_price,
      config.dropPercentage,
    );
  }

  /**
   * Validate state for buy trigger detection
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

    if (state.buy_amount !== null && state.buy_amount < 0) {
      return { isValid: false, error: "Negative buy amount" };
    }

    return { isValid: true };
  }

  /**
   * Validate configuration for buy trigger detection
   * @param config Configuration to validate
   * @returns Validation result with error message if invalid
   */
  public validateConfig(config: TradingConfig): {
    isValid: boolean;
    error?: string;
  } {
    if (config.dropPercentage < 0 || config.dropPercentage > 1) {
      return {
        isValid: false,
        error: "Drop percentage must be between 0 and 1",
      };
    }

    if (config.driftThresholdPct < 0 || config.driftThresholdPct > 1) {
      return {
        isValid: false,
        error: "Drift threshold must be between 0 and 1",
      };
    }

    if (config.minBuyUSDT < 0) {
      return { isValid: false, error: "Minimum buy USDT cannot be negative" };
    }

    if (config.exchangeMinNotional < 0) {
      return {
        isValid: false,
        error: "Exchange minimum notional cannot be negative",
      };
    }

    return { isValid: true };
  }
}
