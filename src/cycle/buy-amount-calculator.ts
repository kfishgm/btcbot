/**
 * Buy Amount Calculator
 *
 * Implements TRD-002: Calculate appropriate buy amounts based on capital and remaining purchases
 *
 * Formula from STRATEGY.md:
 * - At cycle start: buy_amount = floor(InitialCapitalUSDT / MaxPurchases)
 * - For each purchase:
 *   - if (purchases_remaining == 1): use ALL capital_available
 *   - else: use fixed buy_amount
 * - Skip if amount < max(MinBuyUSDT, exchange_minNotional)
 * - Floor to USDT precision (8 decimals)
 */

export interface BuyAmountConfig {
  initialCapitalUSDT: number;
  maxPurchases: number;
  minBuyUSDT: number;
}

export interface CycleState {
  buy_amount: number | null;
  capital_available: number;
  purchases_remaining: number;
}

export interface ValidationConfig {
  minBuyUSDT: number;
  exchangeMinNotional: number;
}

export interface SymbolInfo {
  symbol: string;
  filters: Array<{
    filterType: string;
    minNotional?: string;
    minPrice?: string;
    maxPrice?: string;
    tickSize?: string;
    applyToMarket?: boolean;
    avgPriceMins?: number;
  }>;
}

export interface PurchaseDecision {
  amount: number;
  shouldSkip: boolean;
  skipReason?: string;
  isLastPurchase: boolean;
}

/**
 * Calculator for determining appropriate buy amounts in trading cycles
 */
export class BuyAmountCalculator {
  // Constants from STRATEGY.md
  private static readonly USDT_PRECISION_DECIMALS = 8;

  // Instance configuration
  private config: BuyAmountConfig | null = null;
  private exchangeMinNotional = 0;

  /**
   * Floor a number to specified decimal places
   * @param value Value to floor
   * @param decimals Number of decimal places
   * @returns Floored value
   */
  private static floorToPrecision(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.floor(value * multiplier) / multiplier;
  }

  /**
   * Validate configuration values
   * @param config Configuration to validate
   * @throws Error if configuration is invalid
   */
  private static validateConfig(config: BuyAmountConfig): void {
    if (config.initialCapitalUSDT < 0) {
      throw new Error("Invalid configuration: negative capital");
    }
    if (config.initialCapitalUSDT === 0) {
      throw new Error("Invalid configuration: zero capital");
    }
    if (config.maxPurchases < 0) {
      throw new Error("Invalid configuration: negative max purchases");
    }
    if (config.maxPurchases === 0) {
      throw new Error(
        "Invalid configuration: division by zero (max purchases = 0)",
      );
    }
    if (config.minBuyUSDT < 0) {
      throw new Error("Minimum buy amount cannot be negative");
    }
  }

  /**
   * Validate cycle state
   * @param state Cycle state to validate
   * @throws Error if state is invalid
   */
  private static validateCycleState(state: CycleState): void {
    if (state.capital_available < 0) {
      throw new Error("Invalid state: negative capital available");
    }
    if (state.purchases_remaining < 0) {
      throw new Error("Invalid state: negative purchases remaining");
    }
  }

  /**
   * Calculate initial buy amount at cycle start
   * @param config Buy amount configuration
   * @returns Initial buy amount floored to USDT precision
   */
  public calculateInitialBuyAmount(config: BuyAmountConfig): number {
    BuyAmountCalculator.validateConfig(config);

    // Formula from STRATEGY.md: buy_amount = floor(InitialCapitalUSDT / MaxPurchases)
    const rawAmount = config.initialCapitalUSDT / config.maxPurchases;
    const buyAmount = BuyAmountCalculator.floorToPrecision(
      rawAmount,
      BuyAmountCalculator.USDT_PRECISION_DECIMALS,
    );

    // Validate the calculated amount meets minimum requirement
    if (config.minBuyUSDT > 0 && buyAmount < config.minBuyUSDT) {
      throw new Error(
        `Calculated buy amount (${buyAmount}) is below minimum (${config.minBuyUSDT})`,
      );
    }

    return buyAmount;
  }

  /**
   * Calculate buy amount for a specific purchase
   * @param state Current cycle state
   * @returns Buy amount for this purchase
   */
  public calculateBuyAmount(state: CycleState): number {
    BuyAmountCalculator.validateCycleState(state);

    if (state.purchases_remaining === 0) {
      throw new Error("No purchases remaining");
    }

    // Determine which amount to use based on STRATEGY.md rules
    const amountToUse = this.determineAmountToUse(state);

    return BuyAmountCalculator.floorToPrecision(
      amountToUse,
      BuyAmountCalculator.USDT_PRECISION_DECIMALS,
    );
  }

  /**
   * Determine which amount to use based on state
   * @param state Current cycle state
   * @returns Amount to use for purchase
   */
  private determineAmountToUse(state: CycleState): number {
    // Last purchase: use ALL remaining capital (from STRATEGY.md)
    if (state.purchases_remaining === 1) {
      return state.capital_available;
    }

    // Regular purchase: use pre-calculated buy_amount
    if (state.buy_amount === null || state.buy_amount === undefined) {
      throw new Error("Buy amount not initialized");
    }

    return state.buy_amount;
  }

  /**
   * Check if purchase should be skipped due to minimum amount
   * @param amount Buy amount to validate
   * @param config Validation configuration
   * @returns True if purchase should be skipped
   */
  public shouldSkipPurchase(amount: number, config: ValidationConfig): boolean {
    const minimumRequired = Math.max(
      config.minBuyUSDT,
      config.exchangeMinNotional,
    );
    return amount < minimumRequired;
  }

  /**
   * Get complete purchase decision with amount and skip logic
   * Provides comprehensive information for trading decisions
   * @param state Current cycle state
   * @param validationConfig Validation configuration
   * @returns Purchase decision with amount and skip status
   */
  public getPurchaseDecision(
    state: CycleState,
    validationConfig: ValidationConfig,
  ): PurchaseDecision {
    const amount = this.calculateBuyAmount(state);
    const shouldSkip = this.shouldSkipPurchase(amount, validationConfig);
    const isLastPurchase = state.purchases_remaining === 1;

    const decision: PurchaseDecision = {
      amount,
      shouldSkip,
      isLastPurchase,
    };

    if (shouldSkip) {
      decision.skipReason = this.generateSkipReason(amount, validationConfig);
    }

    return decision;
  }

  /**
   * Generate skip reason message
   * @param amount Amount being validated
   * @param config Validation configuration
   * @returns Skip reason message
   */
  private generateSkipReason(amount: number, config: ValidationConfig): string {
    const minimumRequired = Math.max(
      config.minBuyUSDT,
      config.exchangeMinNotional,
    );
    return `Amount ${amount} is below minimum required ${minimumRequired}`;
  }

  /**
   * Set configuration for the calculator
   * @param config Buy amount configuration
   */
  public setConfig(config: BuyAmountConfig): void {
    BuyAmountCalculator.validateConfig(config);
    this.config = config;
  }

  /**
   * Get current configuration
   * @returns Current configuration or null if not set
   */
  public getConfig(): BuyAmountConfig | null {
    return this.config;
  }

  /**
   * Set exchange minimum notional value
   * @param minNotional Minimum notional value from exchange
   */
  public setExchangeMinNotional(minNotional: number): void {
    if (minNotional < 0) {
      throw new Error("Exchange minimum notional cannot be negative");
    }
    this.exchangeMinNotional = minNotional;
  }

  /**
   * Get exchange minimum notional value
   * @returns Exchange minimum notional value
   */
  public getExchangeMinNotional(): number {
    return this.exchangeMinNotional;
  }

  /**
   * Extract minimum notional from exchange symbol info
   * Parses exchange-specific trading rules
   * @param symbolInfo Exchange symbol information
   * @returns Minimum notional value or 0 if not found
   */
  public static extractMinNotional(symbolInfo: SymbolInfo): number {
    const minNotionalFilter = symbolInfo.filters.find(
      (f) => f.filterType === "MIN_NOTIONAL" || f.filterType === "NOTIONAL",
    );

    if (minNotionalFilter?.minNotional) {
      const value = parseFloat(minNotionalFilter.minNotional);
      return isNaN(value) ? 0 : Math.max(0, value); // Ensure non-negative
    }

    return 0;
  }

  /**
   * Calculate buy amount for a regular purchase (not first, not last)
   * @param buyAmount Pre-calculated buy amount
   * @returns Buy amount floored to USDT precision
   */
  public calculateRegularBuyAmount(buyAmount: number): number {
    if (buyAmount <= 0) {
      throw new Error("Buy amount must be greater than zero");
    }

    return BuyAmountCalculator.floorToPrecision(
      buyAmount,
      BuyAmountCalculator.USDT_PRECISION_DECIMALS,
    );
  }

  /**
   * Calculate buy amount for the last purchase
   * @param capitalAvailable All remaining capital
   * @returns Capital available floored to USDT precision
   */
  public calculateLastBuyAmount(capitalAvailable: number): number {
    if (capitalAvailable < 0) {
      throw new Error("Capital available cannot be negative");
    }

    // Last purchase uses ALL remaining capital
    return BuyAmountCalculator.floorToPrecision(
      capitalAvailable,
      BuyAmountCalculator.USDT_PRECISION_DECIMALS,
    );
  }

  /**
   * Validate buy amount against minimums
   * Ensures compliance with both platform and exchange requirements
   * @param amount Amount to validate
   * @param minBuyUSDT Minimum buy amount in USDT
   * @param exchangeMinNotional Exchange minimum notional
   * @returns Validation result with reason if invalid
   */
  public validateBuyAmount(
    amount: number,
    minBuyUSDT: number,
    exchangeMinNotional: number,
  ): { isValid: boolean; reason?: string } {
    const minimumRequired = Math.max(minBuyUSDT, exchangeMinNotional);

    if (amount < minimumRequired) {
      return {
        isValid: false,
        reason: `Amount ${amount} is below minimum required ${minimumRequired}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Reset calculator state
   */
  public reset(): void {
    this.config = null;
    this.exchangeMinNotional = 0;
  }

  /**
   * Get USDT precision decimals constant
   * @returns Number of decimal places for USDT precision
   */
  public static getUSDTPrecisionDecimals(): number {
    return BuyAmountCalculator.USDT_PRECISION_DECIMALS;
  }

  /**
   * Alias for calculateBuyAmount to match test expectations
   * @param state Current cycle state
   * @returns Buy amount for this purchase
   */
  public getPurchaseAmount(state: CycleState): number {
    return this.calculateBuyAmount(state);
  }

  /**
   * Check if amount is valid (meets minimum requirements)
   * @param amount Amount to validate
   * @param minBuyUSDT Minimum buy amount
   * @param exchangeMinNotional Exchange minimum notional
   * @returns True if amount is valid
   */
  public isAmountValid(
    amount: number,
    minBuyUSDT: number,
    exchangeMinNotional: number,
  ): boolean {
    const validation = this.validateBuyAmount(
      amount,
      minBuyUSDT,
      exchangeMinNotional,
    );
    return validation.isValid;
  }

  /**
   * Get skip reason for an amount
   * @param amount Amount to check
   * @param minBuyUSDT Minimum buy amount
   * @param exchangeMinNotional Exchange minimum notional
   * @returns Skip reason or null if valid
   */
  public getSkipReason(
    amount: number,
    minBuyUSDT: number,
    exchangeMinNotional: number,
  ): string | null {
    const minimumRequired = Math.max(minBuyUSDT, exchangeMinNotional);

    if (amount < minimumRequired) {
      if (exchangeMinNotional > minBuyUSDT) {
        return `Amount ${amount} is below exchange minimum ${exchangeMinNotional} USDT`;
      } else {
        return `Amount ${amount} is below minimum ${minBuyUSDT} USDT`;
      }
    }

    return null;
  }

  /**
   * Floor to USDT precision (exposed for testing)
   * @param value Value to floor
   * @returns Floored value
   */
  public floorToPrecision(value: number): number {
    return BuyAmountCalculator.floorToPrecision(
      value,
      BuyAmountCalculator.USDT_PRECISION_DECIMALS,
    );
  }

  /**
   * Extract minimum notional (instance method wrapper)
   * @param symbolInfo Symbol information
   * @returns Minimum notional value
   */
  public extractMinNotional(symbolInfo: SymbolInfo): number {
    return BuyAmountCalculator.extractMinNotional(symbolInfo);
  }
}
