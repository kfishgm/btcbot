import { Decimal } from "decimal.js";
import type { TradingRules } from "../exchange/trading-rules";
import type { SymbolTradingRules } from "../exchange/types";

/**
 * Calculates limit order prices with slippage protection according to STRATEGY.md Section 5
 *
 * Buy Order: limit_price_buy = round_to_tick(Close * (1 + SlippageGuardBuyPct))
 * Sell Order: limit_price_sell = round_to_tick(Close * (1 - SlippageGuardSellPct))
 * round_to_tick(price): return floor(price / tick_size) * tick_size
 */
export class OrderPriceCalculator {
  private tradingRules: TradingRules;
  private slippageGuardBuyPct: number;
  private slippageGuardSellPct: number;

  constructor(
    tradingRules: TradingRules,
    slippageGuardBuyPct: number = 0.003,
    slippageGuardSellPct: number = 0.003,
  ) {
    if (!tradingRules) {
      throw new Error("TradingRules is required");
    }

    if (slippageGuardBuyPct < 0 || slippageGuardBuyPct > 0.1) {
      throw new Error("Buy slippage guard must be between 0 and 0.1");
    }

    if (slippageGuardSellPct < 0 || slippageGuardSellPct > 0.1) {
      throw new Error("Sell slippage guard must be between 0 and 0.1");
    }

    this.tradingRules = tradingRules;
    this.slippageGuardBuyPct = slippageGuardBuyPct;
    this.slippageGuardSellPct = slippageGuardSellPct;
  }

  /**
   * Calculate buy limit price with slippage protection
   * Formula: limit_price_buy = round_to_tick(Close * (1 + SlippageGuardBuyPct))
   */
  calculateBuyLimitPrice(currentPrice: Decimal, symbol: string): Decimal {
    if (!currentPrice || currentPrice.lte(0)) {
      throw new Error("Current price must be greater than 0");
    }

    if (!currentPrice.isFinite()) {
      throw new Error("Current price must be a finite number");
    }

    // Get trading rules for the symbol
    const rules = this.getRulesForSymbol(symbol);

    // Calculate limit price with slippage guard (price can go UP for buys)
    const priceWithSlippage = currentPrice.mul(1 + this.slippageGuardBuyPct);

    // Round to tick size
    return this.roundToTick(priceWithSlippage, rules.tickSize);
  }

  /**
   * Calculate sell limit price with slippage protection
   * Formula: limit_price_sell = round_to_tick(Close * (1 - SlippageGuardSellPct))
   */
  calculateSellLimitPrice(currentPrice: Decimal, symbol: string): Decimal {
    if (!currentPrice || currentPrice.lte(0)) {
      throw new Error("Current price must be greater than 0");
    }

    if (!currentPrice.isFinite()) {
      throw new Error("Current price must be a finite number");
    }

    // Get trading rules for the symbol
    const rules = this.getRulesForSymbol(symbol);

    // Calculate limit price with slippage guard (price can go DOWN for sells)
    const priceWithSlippage = currentPrice.mul(1 - this.slippageGuardSellPct);

    // Check if price is too low after slippage
    if (priceWithSlippage.lte(0)) {
      throw new Error("Price too low to apply slippage guard");
    }

    // Round to tick size
    return this.roundToTick(priceWithSlippage, rules.tickSize);
  }

  /**
   * Round price to tick size according to STRATEGY.md
   * Formula: return floor(price / tick_size) * tick_size
   */
  roundToTick(price: Decimal, tickSize: number): Decimal {
    const tickSizeDecimal = new Decimal(tickSize);

    // floor(price / tick_size) * tick_size
    const tickCount = price.div(tickSizeDecimal).floor();
    return tickCount.mul(tickSizeDecimal);
  }

  /**
   * Get tick size for a symbol
   */
  async getTickSize(symbol: string): Promise<number> {
    const rules = await this.tradingRules.getRules(symbol);
    return rules.tickSize;
  }

  /**
   * Calculate both buy and sell prices
   */
  calculateBothPrices(
    currentPrice: Decimal,
    symbol: string,
  ): { buyPrice: Decimal; sellPrice: Decimal } {
    return {
      buyPrice: this.calculateBuyLimitPrice(currentPrice, symbol),
      sellPrice: this.calculateSellLimitPrice(currentPrice, symbol),
    };
  }

  /**
   * Get current slippage settings
   */
  getSlippageSettings(): {
    buySlippage: number;
    sellSlippage: number;
  } {
    return {
      buySlippage: this.slippageGuardBuyPct,
      sellSlippage: this.slippageGuardSellPct,
    };
  }

  /**
   * Get trading rules for symbol, checking cache first
   */
  private getRulesForSymbol(symbol: string): SymbolTradingRules {
    // Try to get cached rules first
    const cachedRules = this.tradingRules.getCachedRules(symbol);
    if (cachedRules) {
      return cachedRules;
    }

    // If no cached rules, throw error (caller should ensure rules are loaded)
    throw new Error(
      `No trading rules cached for ${symbol}. Call getRules() first.`,
    );
  }
}
