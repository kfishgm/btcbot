/**
 * Mock Binance Client for E2E Tests
 *
 * Simulates Binance API responses without making real API calls
 */

import { Decimal } from "decimal.js";
import type {
  BinanceOrder,
  BinanceBalance,
  BinanceKline,
  CreateOrderParams,
  BinanceExchangeInfo,
  BinanceSymbolInfo,
} from "../../../src/exchange/types.js";
import { MockCandleManager } from "./mock-candle-manager.js";

export interface MockBalance {
  asset: string;
  free: Decimal;
  locked: Decimal;
}

export interface MockConfig {
  initialBalances: {
    BTC: number;
    USDT: number;
  };
  feeRate: number; // 0.001 = 0.1%
  slippage: number; // 0.001 = 0.1% slippage simulation
  candleManager?: MockCandleManager; // Shared candle manager for scenario data
}

export class MockBinanceClient {
  private balances: Map<string, MockBalance>;
  private orderIdCounter: number = 1000;
  private currentPrice: Decimal = new Decimal(100000);
  private feeRate: Decimal;
  private slippage: Decimal;
  private executedOrders: BinanceOrder[] = [];
  private mockConfig: MockConfig;
  private candleManager: MockCandleManager;

  constructor(config?: Partial<MockConfig>) {
    this.mockConfig = {
      initialBalances: {
        BTC: config?.initialBalances?.BTC || 0,
        USDT: config?.initialBalances?.USDT || 1000,
      },
      feeRate: config?.feeRate || 0.001,
      slippage: config?.slippage || 0.001,
      candleManager: config?.candleManager,
    };

    this.feeRate = new Decimal(this.mockConfig.feeRate);
    this.slippage = new Decimal(this.mockConfig.slippage);
    this.candleManager =
      this.mockConfig.candleManager || new MockCandleManager();

    // Set initial price from candle manager
    this.currentPrice = new Decimal(this.candleManager.getCurrentPrice());

    // Initialize balances
    this.balances = new Map();
    this.balances.set("BTC", {
      asset: "BTC",
      free: new Decimal(this.mockConfig.initialBalances.BTC),
      locked: new Decimal(0),
    });
    this.balances.set("USDT", {
      asset: "USDT",
      free: new Decimal(this.mockConfig.initialBalances.USDT),
      locked: new Decimal(0),
    });
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async getServerTime(): Promise<number> {
    return Date.now();
  }

  async getAccountInfo(): Promise<{ balances: BinanceBalance[] }> {
    const balances: BinanceBalance[] = [];
    for (const [asset, balance] of this.balances) {
      balances.push({
        asset,
        free: balance.free.toString(),
        locked: balance.locked.toString(),
      });
    }
    return { balances };
  }

  async getBalance(asset: string): Promise<BinanceBalance | null> {
    const balance = this.balances.get(asset);
    if (!balance) return null;
    return {
      asset: balance.asset,
      free: balance.free.toString(),
      locked: balance.locked.toString(),
    };
  }

  async get24hrTicker(_symbol: string): Promise<{ lastPrice: string }> {
    return { lastPrice: this.currentPrice.toString() };
  }

  async getKlines(
    _symbol: string,
    _interval: string,
    limit: number,
  ): Promise<BinanceKline[]> {
    // Get historical candles from the candle manager
    const historicalCandles = this.candleManager.getHistoricalCandles(limit);
    const klines: BinanceKline[] = [];

    if (historicalCandles.length > 0) {
      // Convert scenario candles to BinanceKline format
      for (const candle of historicalCandles) {
        klines.push({
          openTime: candle.openTime,
          open: candle.open.toString(),
          high: candle.high.toString(),
          low: candle.low.toString(),
          close: candle.close.toString(),
          volume: candle.volume.toString(),
          closeTime: candle.closeTime,
          quoteAssetVolume: (candle.volume * candle.close).toString(),
          numberOfTrades: 100,
          takerBuyBaseAssetVolume: (candle.volume * 0.5).toString(),
          takerBuyQuoteAssetVolume: (
            candle.volume *
            candle.close *
            0.5
          ).toString(),
        });
      }
    } else {
      // Fallback to generated candles if no scenario data
      const now = Date.now();
      for (let i = 0; i < limit; i++) {
        const openTime = now - (limit - i) * 300000;
        klines.push({
          openTime: openTime,
          open: this.currentPrice.toString(),
          high: this.currentPrice.plus(100).toString(),
          low: this.currentPrice.minus(100).toString(),
          close: this.currentPrice.toString(),
          volume: "10",
          closeTime: openTime + 300000 - 1,
          quoteAssetVolume: "0",
          numberOfTrades: 10,
          takerBuyBaseAssetVolume: "0",
          takerBuyQuoteAssetVolume: "0",
        });
      }
    }

    return klines;
  }

  async createOrder(params: CreateOrderParams): Promise<BinanceOrder> {
    const orderId = this.orderIdCounter++;
    const symbol = params.symbol;
    const side = params.side;
    const type = params.type || "MARKET";
    const quantity = new Decimal(params.quantity || 0);

    // Simulate slippage
    let executionPrice = this.currentPrice;
    if (side === "BUY") {
      executionPrice = executionPrice.mul(new Decimal(1).plus(this.slippage));
    } else {
      executionPrice = executionPrice.mul(new Decimal(1).minus(this.slippage));
    }

    // Calculate values
    const quoteQuantity = quantity.mul(executionPrice);
    const fee = quantity.mul(this.feeRate);
    const netQuantity = quantity.minus(fee);

    // Update balances
    if (side === "BUY") {
      const usdtBalance = this.balances.get("USDT")!;
      const btcBalance = this.balances.get("BTC")!;

      if (usdtBalance.free.lt(quoteQuantity)) {
        throw new Error("Insufficient USDT balance");
      }

      usdtBalance.free = usdtBalance.free.minus(quoteQuantity);
      btcBalance.free = btcBalance.free.plus(netQuantity);
    } else if (side === "SELL") {
      const btcBalance = this.balances.get("BTC")!;
      const usdtBalance = this.balances.get("USDT")!;

      if (btcBalance.free.lt(quantity)) {
        throw new Error("Insufficient BTC balance");
      }

      btcBalance.free = btcBalance.free.minus(quantity);
      const usdtReceived = quoteQuantity.minus(quoteQuantity.mul(this.feeRate));
      usdtBalance.free = usdtBalance.free.plus(usdtReceived);
    }

    const order: BinanceOrder = {
      symbol,
      orderId: orderId,
      orderListId: -1,
      clientOrderId: `mock_${orderId}`,
      price: executionPrice.toString(),
      origQty: quantity.toString(),
      executedQty: quantity.toString(),
      cummulativeQuoteQty: quoteQuantity.toString(),
      status: "FILLED",
      timeInForce: "GTC",
      type,
      side,
      stopPrice: "0",
      icebergQty: "0",
      time: Date.now(),
      updateTime: Date.now(),
      isWorking: true,
      origQuoteOrderQty: quoteQuantity.toString(),
      fills: [
        {
          price: executionPrice.toString(),
          qty: quantity.toString(),
          commission: fee.toString(),
          commissionAsset: side === "BUY" ? "BTC" : "USDT",
          tradeId: orderId * 1000,
        },
      ],
    };

    this.executedOrders.push(order);
    return order;
  }

  async getOrder(
    _symbol: string,
    orderId: number,
  ): Promise<BinanceOrder | null> {
    return this.executedOrders.find((o) => o.orderId === orderId) || null;
  }

  async getExchangeInfo(): Promise<BinanceExchangeInfo> {
    const symbolInfo: BinanceSymbolInfo = {
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      baseAssetPrecision: 8,
      quoteAsset: "USDT",
      quoteAssetPrecision: 8,
      orderTypes: ["LIMIT", "MARKET"],
      icebergAllowed: true,
      ocoAllowed: true,
      isSpotTradingAllowed: true,
      isMarginTradingAllowed: false,
      filters: [
        {
          filterType: "PRICE_FILTER",
          minPrice: "0.01",
          maxPrice: "1000000.00",
          tickSize: "0.01",
        },
        {
          filterType: "LOT_SIZE",
          minQty: "0.00001",
          maxQty: "9000.00",
          stepSize: "0.00001",
        },
        {
          filterType: "MIN_NOTIONAL",
          minNotional: "10.00",
          applyToMarket: true,
          avgPriceMins: 5,
        },
      ],
      permissions: ["SPOT"],
    };

    return {
      timezone: "UTC",
      serverTime: Date.now(),
      rateLimits: [
        {
          rateLimitType: "REQUEST_WEIGHT",
          interval: "MINUTE",
          intervalNum: 1,
          limit: 1200,
        },
      ],
      symbols: [symbolInfo],
    };
  }

  // Test helper methods
  setCurrentPrice(price: number): void {
    this.currentPrice = new Decimal(price);
  }

  // Set candle manager for coordinated testing
  setCandleManager(candleManager: MockCandleManager): void {
    this.candleManager = candleManager;
    this.currentPrice = new Decimal(candleManager.getCurrentPrice());
  }

  // Update price from candle manager (called when WebSocket emits a new candle)
  updatePriceFromCandleManager(): void {
    this.currentPrice = new Decimal(this.candleManager.getCurrentPrice());
  }

  getMockBalances(): { BTC: string; USDT: string } {
    return {
      BTC: this.balances.get("BTC")!.free.toString(),
      USDT: this.balances.get("USDT")!.free.toString(),
    };
  }

  getExecutedOrders(): BinanceOrder[] {
    return [...this.executedOrders];
  }

  reset(): void {
    this.balances.get("BTC")!.free = new Decimal(
      this.mockConfig.initialBalances.BTC,
    );
    this.balances.get("USDT")!.free = new Decimal(
      this.mockConfig.initialBalances.USDT,
    );
    this.executedOrders = [];
    this.orderIdCounter = 1000;
  }

  // Helper method for tests to set balance
  setBalance(asset: string, amount: number): void {
    const balance = this.balances.get(asset);
    if (balance) {
      balance.free = new Decimal(amount);
    } else {
      this.balances.set(asset, {
        asset,
        free: new Decimal(amount),
        locked: new Decimal(0),
      });
    }
  }
}
