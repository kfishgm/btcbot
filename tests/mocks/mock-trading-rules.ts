import type { TradingRules } from "../../src/exchange/trading-rules";
import type { SymbolTradingRules } from "../../src/exchange/types";

export class MockTradingRules implements Partial<TradingRules> {
  private rules = new Map<string, SymbolTradingRules>();

  constructor() {
    // Set default rules for BTCUSDT
    this.rules.set("BTCUSDT", {
      symbol: "BTCUSDT",
      minQty: 0.00001,
      maxQty: 9000,
      stepSize: 0.00001,
      minPrice: 0.01,
      maxPrice: 1000000,
      tickSize: 0.01,
      minNotional: 10,
      lastUpdated: Date.now(),
    });
  }

  async getRules(symbol: string): Promise<SymbolTradingRules> {
    const rules = this.rules.get(symbol);
    if (!rules) {
      throw new Error(`No rules configured for ${symbol}`);
    }
    return rules;
  }

  isDust(amount: number, symbol: string): boolean {
    const rules = this.rules.get(symbol);
    if (!rules) {
      throw new Error(`No rules configured for ${symbol}`);
    }
    return amount < rules.minQty;
  }

  isTradable(amount: number, symbol: string): boolean {
    const rules = this.rules.get(symbol);
    if (!rules) {
      throw new Error(`No rules configured for ${symbol}`);
    }
    return amount >= rules.minQty;
  }

  getMinTradableAmount(symbol: string): number {
    const rules = this.rules.get(symbol);
    if (!rules) {
      throw new Error(`No rules configured for ${symbol}`);
    }
    return rules.minQty;
  }

  quantityToPrecision(symbol: string, quantity: number): string {
    const rules = this.rules.get(symbol);
    if (!rules) {
      throw new Error(`No rules configured for ${symbol}`);
    }
    const factor = 1 / rules.stepSize;
    return (Math.floor(quantity * factor) / factor).toFixed(8);
  }

  priceToPrecision(symbol: string, price: number): string {
    const rules = this.rules.get(symbol);
    if (!rules) {
      throw new Error(`No rules configured for ${symbol}`);
    }
    const factor = 1 / rules.tickSize;
    return (Math.floor(price * factor) / factor).toFixed(2);
  }

  startAutoRefresh(): void {
    // No-op for tests
  }

  stopAutoRefresh(): void {
    // No-op for tests
  }

  // This is used when accessed through SellOrderStateUpdater.getTradingRules()
  // but our mock is already the TradingRules instance
}
