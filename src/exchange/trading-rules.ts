import { logger } from "../utils/logger";
import type { BinanceClient } from "./binance-client";
import type {
  BinanceExchangeInfo,
  BinanceSymbolInfo,
  BinanceSymbolFilter,
  SymbolTradingRules,
} from "./types";

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
  adjustedPrice?: number;
  adjustedQuantity?: number;
  suggestedMinQuantity?: number;
}

export class TradingRules {
  private client: BinanceClient;
  private rulesCache: Map<string, SymbolTradingRules> = new Map();
  private autoRefreshInterval?: NodeJS.Timeout;
  private onErrorCallback?: (error: Error) => void;
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  constructor(client: BinanceClient) {
    this.client = client;
  }

  async fetchExchangeInfo(): Promise<BinanceExchangeInfo> {
    return this.client.getExchangeInfo();
  }

  async getRules(
    symbol: string,
    forceRefresh = false,
  ): Promise<SymbolTradingRules> {
    const cached = this.rulesCache.get(symbol);

    // Check if we have cached rules and they're not expired
    if (!forceRefresh && cached && !this.isExpired(cached)) {
      return cached;
    }

    // Fetch fresh exchange info for the symbol
    const exchangeInfo = await this.client.getExchangeInfo(symbol);
    const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);

    if (!symbolInfo) {
      throw new Error(`Symbol ${symbol} not found in exchange info`);
    }

    const rules = this.parseSymbolRules(symbolInfo);
    this.rulesCache.set(symbol, rules);

    return rules;
  }

  async getRulesForMultipleSymbols(
    symbols: string[],
  ): Promise<Map<string, SymbolTradingRules>> {
    const result = new Map<string, SymbolTradingRules>();

    // Get all symbols that need fresh data
    const symbolsToFetch: string[] = [];
    for (const symbol of symbols) {
      const cached = this.rulesCache.get(symbol);
      if (cached && !this.isExpired(cached)) {
        result.set(symbol, cached);
      } else {
        symbolsToFetch.push(symbol);
      }
    }

    // If all symbols are cached and valid, return early
    if (symbolsToFetch.length === 0) {
      return result;
    }

    // Fetch exchange info for all symbols at once
    const exchangeInfo = await this.client.getExchangeInfo();

    for (const symbol of symbolsToFetch) {
      const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
      if (symbolInfo) {
        const rules = this.parseSymbolRules(symbolInfo);
        this.rulesCache.set(symbol, rules);
        result.set(symbol, rules);
      }
    }

    return result;
  }

  async prefetchAllUSDTPairs(): Promise<void> {
    const exchangeInfo = await this.client.getExchangeInfo();
    const usdtPairs = exchangeInfo.symbols.filter(
      (s) => s.quoteAsset === "USDT" && s.status === "TRADING",
    );

    for (const symbolInfo of usdtPairs) {
      const rules = this.parseSymbolRules(symbolInfo);
      this.rulesCache.set(symbolInfo.symbol, rules);
    }
  }

  private parseSymbolRules(symbolInfo: BinanceSymbolInfo): SymbolTradingRules {
    const priceFilter = symbolInfo.filters.find(
      (f) => f.filterType === "PRICE_FILTER",
    ) as BinanceSymbolFilter;
    const lotSizeFilter = symbolInfo.filters.find(
      (f) => f.filterType === "LOT_SIZE",
    ) as BinanceSymbolFilter;
    // Check for both NOTIONAL and MIN_NOTIONAL (Binance uses NOTIONAL for spot)
    const minNotionalFilter = symbolInfo.filters.find(
      (f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL",
    ) as BinanceSymbolFilter;

    // Require all critical filters to be present
    if (
      !priceFilter ||
      !priceFilter.minPrice ||
      !priceFilter.maxPrice ||
      !priceFilter.tickSize
    ) {
      throw new Error(`Missing PRICE_FILTER for ${symbolInfo.symbol}`);
    }
    if (
      !lotSizeFilter ||
      !lotSizeFilter.minQty ||
      !lotSizeFilter.maxQty ||
      !lotSizeFilter.stepSize
    ) {
      throw new Error(`Missing LOT_SIZE filter for ${symbolInfo.symbol}`);
    }
    if (!minNotionalFilter || !minNotionalFilter.minNotional) {
      throw new Error(`Missing MIN_NOTIONAL filter for ${symbolInfo.symbol}`);
    }

    const rules = {
      symbol: symbolInfo.symbol,
      minPrice: parseFloat(priceFilter.minPrice),
      maxPrice: parseFloat(priceFilter.maxPrice),
      tickSize: parseFloat(priceFilter.tickSize),
      minQty: parseFloat(lotSizeFilter.minQty),
      maxQty: parseFloat(lotSizeFilter.maxQty),
      stepSize: parseFloat(lotSizeFilter.stepSize),
      minNotional: parseFloat(minNotionalFilter.minNotional),
      lastUpdated: Date.now(),
    };

    // Log the actual stepSize being used for BTCUSDT
    if (symbolInfo.symbol === "BTCUSDT") {
      logger.info("BTCUSDT trading rules loaded:", {
        stepSize: rules.stepSize,
        minQty: rules.minQty,
        minNotional: rules.minNotional,
        rawStepSize: lotSizeFilter?.stepSize,
      });
    }

    return rules;
  }

  private isExpired(rules: SymbolTradingRules): boolean {
    return Date.now() - rules.lastUpdated > this.CACHE_TTL;
  }

  isCached(symbol: string): boolean {
    const cached = this.rulesCache.get(symbol);
    return cached !== undefined && !this.isExpired(cached);
  }

  clearCache(): void {
    this.rulesCache.clear();
  }

  async forceRefresh(symbol: string): Promise<SymbolTradingRules> {
    return this.getRules(symbol, true);
  }

  // Validation helper functions

  roundPriceToTick(price: number, symbol: string): number {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }

    const tickSize = rules.tickSize;
    // Use parseFloat and toFixed to handle precision issues
    const tickCount = Math.floor(price / tickSize);
    const rounded = parseFloat((tickCount * tickSize).toFixed(8));

    // Clamp to min/max bounds
    return Math.max(rules.minPrice, Math.min(rules.maxPrice, rounded));
  }

  roundQuantityToStep(quantity: number, symbol: string): number {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }

    const stepSize = rules.stepSize;
    // Use parseFloat and toFixed to handle precision issues
    const stepCount = Math.floor(quantity / stepSize);
    const rawProduct = stepCount * stepSize;
    const fixedString = rawProduct.toFixed(8);
    const rounded = parseFloat(fixedString);

    // Log the quantization for debugging
    if (quantity !== rounded) {
      const quantizationDiff = quantity - rounded;
      logger.info(`Quantity quantization for ${symbol}:`, {
        original: quantity,
        stepSize,
        stepCount,
        rawProduct,
        fixedString,
        rounded,
        difference: quantizationDiff,
        differencePercent:
          ((quantizationDiff / quantity) * 100).toFixed(4) + "%",
        minQty: rules.minQty,
        maxQty: rules.maxQty,
      });

      // Warn if we're losing significant amount due to quantization
      if (quantizationDiff > stepSize) {
        logger.warn(
          `Quantization removed ${quantizationDiff.toFixed(8)} BTC (more than one step size)`,
          {
            symbol,
            stepSize,
            quantizationDiff,
          },
        );
      }
    }

    // Clamp to min/max bounds
    return Math.max(rules.minQty, Math.min(rules.maxQty, rounded));
  }

  /**
   * Smart rounding for buy orders to maximize capital utilization
   * Rounds UP when it results in better spend efficiency
   * @param availableCapital Optional - if provided, ensures we don't exceed this amount
   */
  roundQuantityForBuyOrder(
    quantity: number,
    targetSpendUSDT: number,
    currentPriceBTC: number,
    symbol: string,
    availableCapital?: number,
  ): number {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }

    const stepSize = rules.stepSize;

    // Calculate both rounding options
    const stepCountDown = Math.floor(quantity / stepSize);
    const stepCountUp = Math.ceil(quantity / stepSize);

    const roundedDown = parseFloat((stepCountDown * stepSize).toFixed(8));
    const roundedUp = parseFloat((stepCountUp * stepSize).toFixed(8));

    // Calculate actual spend for each option
    const spendDown = roundedDown * currentPriceBTC;
    const spendUp = roundedUp * currentPriceBTC;

    // Calculate efficiency (how close to target)
    const efficiencyUp = spendUp / targetSpendUSDT;

    // Decision logic:
    // 1. If availableCapital is provided, never exceed it
    // 2. If rounding up exceeds target by less than 0.5%, do it
    // 3. Otherwise, round down to avoid overspending
    const maxOverspendRatio = 1.005; // Allow up to 0.5% overspend

    let finalQuantity: number;

    // Check if rounding up would exceed available capital
    const exceedsAvailableCapital =
      availableCapital && spendUp > availableCapital;

    if (!exceedsAvailableCapital && efficiencyUp <= maxOverspendRatio) {
      // Round UP for better capital utilization
      finalQuantity = roundedUp;
      logger.debug(
        `Smart rounding UP: ${quantity.toFixed(8)} -> ${roundedUp.toFixed(8)} BTC (spend: $${spendUp.toFixed(2)})`,
      );
    } else {
      // Round DOWN to avoid excessive overspend or exceeding capital
      finalQuantity = roundedDown;
      logger.debug(
        `Smart rounding DOWN: ${quantity.toFixed(8)} -> ${roundedDown.toFixed(8)} BTC (spend: $${spendDown.toFixed(2)})${exceedsAvailableCapital ? " (capital limit)" : ""}`,
      );
    }

    // Clamp to min/max bounds
    return Math.max(rules.minQty, Math.min(rules.maxQty, finalQuantity));
  }

  validateMinNotional(
    price: number,
    quantity: number,
    symbol: string,
  ): boolean {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }

    const orderValue = price * quantity;
    return orderValue >= rules.minNotional;
  }

  getMinQuantityForPrice(price: number, symbol: string): number {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }

    // Calculate minimum quantity needed to meet notional requirement
    const minQtyForNotional =
      Math.ceil(rules.minNotional / price / rules.stepSize) * rules.stepSize;

    // Return the larger of minQty rule or calculated minimum
    return Math.max(rules.minQty, minQtyForNotional);
  }

  // Calculate the minimum quantity that can be sold at current price
  // This considers both minQty and minNotional requirements
  getMinimumSellableQuantity(price: number, symbol: string): number {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }

    // Log the trading rules for transparency
    logger.info("Calculating minimum sellable quantity", {
      symbol,
      price,
      minQty: rules.minQty,
      minNotional: rules.minNotional,
      stepSize: rules.stepSize,
    });

    // Minimum based on notional value requirement
    const minQtyForNotional = rules.minNotional / price;

    // Must meet both minQty and minNotional requirements
    const minSellableQty = Math.max(rules.minQty, minQtyForNotional);

    // Round up to nearest step size to ensure it's valid
    const steps = Math.ceil(minSellableQty / rules.stepSize);
    const result = parseFloat((steps * rules.stepSize).toFixed(8));

    logger.info("Minimum sellable quantity calculated", {
      minQtyForNotional,
      minSellableQty,
      rounded: result,
    });

    return result;
  }

  validateOrder(
    symbol: string,
    price: number | undefined,
    quantity: number,
    orderType: "MARKET" | "LIMIT" = "LIMIT",
  ): OrderValidationResult {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      return {
        valid: false,
        errors: [
          `No trading rules cached for ${symbol}. Call getRules() first.`,
        ],
      };
    }

    const errors: string[] = [];
    let adjustedPrice = price;
    let adjustedQuantity = quantity;

    // For limit orders, validate and adjust price
    if (orderType === "LIMIT" && price !== undefined) {
      adjustedPrice = this.roundPriceToTick(price, symbol);

      if (adjustedPrice !== price) {
        errors.push(
          `Price adjusted from ${price} to ${adjustedPrice} to match tick size ${rules.tickSize}`,
        );
      }

      if (adjustedPrice < rules.minPrice) {
        errors.push(
          `Price ${adjustedPrice} is below minimum ${rules.minPrice}`,
        );
      }

      if (adjustedPrice > rules.maxPrice) {
        errors.push(
          `Price ${adjustedPrice} is above maximum ${rules.maxPrice}`,
        );
      }
    }

    // Validate and adjust quantity
    adjustedQuantity = this.roundQuantityToStep(quantity, symbol);

    if (adjustedQuantity !== quantity) {
      errors.push(
        `Quantity adjusted from ${quantity} to ${adjustedQuantity} to match step size ${rules.stepSize}`,
      );
    }

    if (adjustedQuantity < rules.minQty) {
      errors.push(
        `Quantity ${adjustedQuantity} is below minimum ${rules.minQty}`,
      );
    }

    if (adjustedQuantity > rules.maxQty) {
      errors.push(
        `Quantity ${adjustedQuantity} is above maximum ${rules.maxQty}`,
      );
    }

    // Validate minimum notional for limit orders
    if (orderType === "LIMIT" && adjustedPrice !== undefined) {
      const orderValue = adjustedPrice * adjustedQuantity;
      if (orderValue < rules.minNotional) {
        errors.push(
          `Order value ${orderValue.toFixed(2)} USDT is below minimum notional ${rules.minNotional} USDT`,
        );

        // Calculate suggested minimum quantity
        const suggestedMinQty = this.getMinQuantityForPrice(
          adjustedPrice,
          symbol,
        );
        return {
          valid: false,
          errors,
          adjustedPrice,
          adjustedQuantity,
          suggestedMinQuantity: suggestedMinQty,
        };
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      adjustedPrice,
      adjustedQuantity,
    };
  }

  // Auto-refresh functionality

  startAutoRefresh(
    intervalMs = this.CACHE_TTL,
    onError?: (error: Error) => void,
  ): void {
    this.stopAutoRefresh(); // Clear any existing interval

    this.onErrorCallback = onError;

    this.autoRefreshInterval = setInterval(async () => {
      try {
        // Refresh all cached symbols
        const symbols = Array.from(this.rulesCache.keys());
        for (const symbol of symbols) {
          const cached = this.rulesCache.get(symbol);
          if (cached && this.isExpired(cached)) {
            await this.getRules(symbol, true);
          }
        }
      } catch (error) {
        if (this.onErrorCallback) {
          this.onErrorCallback(error as Error);
        }
      }
    }, intervalMs);
  }

  stopAutoRefresh(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = undefined;
    }
  }

  isAutoRefreshEnabled(): boolean {
    return this.autoRefreshInterval !== undefined;
  }

  getCachedRules(symbol: string): SymbolTradingRules | undefined {
    return this.rulesCache.get(symbol);
  }

  getAllCachedRules(): Map<string, SymbolTradingRules> {
    return new Map(this.rulesCache);
  }

  /**
   * Check if an amount is considered dust (below minimum tradable)
   * @param amount BTC amount to check
   * @param symbol Trading symbol (e.g., 'BTCUSDT')
   * @returns true if amount is below minimum tradable quantity
   */
  isDust(amount: number, symbol: string): boolean {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }
    // Zero is not dust - dust is a small positive amount below minimum tradeable
    return amount > 0 && amount < rules.minQty;
  }

  /**
   * Check if an amount is tradable (meets minimum requirements)
   * @param amount BTC amount to check
   * @param symbol Trading symbol (e.g., 'BTCUSDT')
   * @returns true if amount meets minimum trading requirements
   */
  isTradable(amount: number, symbol: string): boolean {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }
    return amount >= rules.minQty;
  }

  /**
   * Get the minimum tradable amount for a symbol
   * @param symbol Trading symbol (e.g., 'BTCUSDT')
   * @returns Minimum quantity that can be traded
   */
  getMinTradableAmount(symbol: string): number {
    const rules = this.rulesCache.get(symbol);
    if (!rules) {
      throw new Error(
        `No trading rules cached for ${symbol}. Call getRules() first.`,
      );
    }
    return rules.minQty;
  }
}
