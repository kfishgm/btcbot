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
    const minNotionalFilter = symbolInfo.filters.find(
      (f) => f.filterType === "MIN_NOTIONAL",
    ) as BinanceSymbolFilter;

    return {
      symbol: symbolInfo.symbol,
      minPrice: priceFilter?.minPrice ? parseFloat(priceFilter.minPrice) : 0,
      maxPrice: priceFilter?.maxPrice
        ? parseFloat(priceFilter.maxPrice)
        : Number.MAX_SAFE_INTEGER,
      tickSize: priceFilter?.tickSize ? parseFloat(priceFilter.tickSize) : 0.01,
      minQty: lotSizeFilter?.minQty ? parseFloat(lotSizeFilter.minQty) : 0,
      maxQty: lotSizeFilter?.maxQty
        ? parseFloat(lotSizeFilter.maxQty)
        : Number.MAX_SAFE_INTEGER,
      stepSize: lotSizeFilter?.stepSize
        ? parseFloat(lotSizeFilter.stepSize)
        : 0.00001,
      minNotional: minNotionalFilter?.minNotional
        ? parseFloat(minNotionalFilter.minNotional)
        : 10,
      lastUpdated: Date.now(),
    };
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
    const rounded = Math.floor(price / tickSize) * tickSize;

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
    const rounded = Math.floor(quantity / stepSize) * stepSize;

    // Clamp to min/max bounds
    return Math.max(rules.minQty, Math.min(rules.maxQty, rounded));
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
}
