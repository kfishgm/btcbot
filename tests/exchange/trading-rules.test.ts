import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { TradingRules } from "../../src/exchange/trading-rules";
import type { BinanceClient } from "../../src/exchange/binance-client";
import type { BinanceExchangeInfo } from "../../src/exchange/types";

describe("TradingRules", () => {
  let tradingRules: TradingRules;
  let mockBinanceClient: Pick<BinanceClient, "getExchangeInfo">;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Binance client with typical exchange info
    const exchangeInfo: BinanceExchangeInfo = {
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
      symbols: [
        {
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
          permissions: ["SPOT"],
          filters: [
            {
              filterType: "LOT_SIZE",
              minQty: "0.00001",
              maxQty: "9000",
              stepSize: "0.00001",
            },
            {
              filterType: "MIN_NOTIONAL",
              minNotional: "10",
              applyToMarket: true,
              avgPriceMins: 5,
            },
            {
              filterType: "PRICE_FILTER",
              minPrice: "0.01",
              maxPrice: "1000000",
              tickSize: "0.01",
            },
          ],
        },
        {
          symbol: "ETHUSDT",
          status: "TRADING",
          baseAsset: "ETH",
          baseAssetPrecision: 8,
          quoteAsset: "USDT",
          quoteAssetPrecision: 8,
          orderTypes: ["LIMIT", "MARKET"],
          icebergAllowed: true,
          ocoAllowed: true,
          isSpotTradingAllowed: true,
          isMarginTradingAllowed: false,
          permissions: ["SPOT"],
          filters: [
            {
              filterType: "LOT_SIZE",
              minQty: "0.0001",
              maxQty: "10000",
              stepSize: "0.0001",
            },
            {
              filterType: "MIN_NOTIONAL",
              minNotional: "5",
              applyToMarket: true,
              avgPriceMins: 5,
            },
            {
              filterType: "PRICE_FILTER",
              minPrice: "0.01",
              maxPrice: "100000",
              tickSize: "0.01",
            },
          ],
        },
      ],
    };

    mockBinanceClient = {
      getExchangeInfo: jest.fn(() => Promise.resolve(exchangeInfo)),
    };

    tradingRules = new TradingRules(mockBinanceClient as BinanceClient);
  });

  describe("getRules", () => {
    it("should fetch and cache trading rules for a symbol", async () => {
      const rules = await tradingRules.getRules("BTCUSDT");

      expect(rules).toMatchObject({
        symbol: "BTCUSDT",
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        minPrice: 0.01,
        maxPrice: 1000000,
        tickSize: 0.01,
      });

      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should use cached rules on subsequent calls", async () => {
      await tradingRules.getRules("BTCUSDT");
      await tradingRules.getRules("BTCUSDT");

      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should throw error for non-existent symbol", async () => {
      await expect(tradingRules.getRules("INVALID")).rejects.toThrow(
        "Symbol INVALID not found in exchange info",
      );
    });
  });

  describe("isDust", () => {
    it("should return true for amounts below minQty", async () => {
      await tradingRules.getRules("BTCUSDT");

      expect(tradingRules.isDust(0.000001, "BTCUSDT")).toBe(true);
      expect(tradingRules.isDust(0.000009, "BTCUSDT")).toBe(true);
    });

    it("should return false for amounts at or above minQty", async () => {
      await tradingRules.getRules("BTCUSDT");

      expect(tradingRules.isDust(0.00001, "BTCUSDT")).toBe(false);
      expect(tradingRules.isDust(0.00002, "BTCUSDT")).toBe(false);
      expect(tradingRules.isDust(1, "BTCUSDT")).toBe(false);
    });

    it("should work with different symbols having different minQty", async () => {
      await tradingRules.getRules("BTCUSDT");
      await tradingRules.getRules("ETHUSDT");

      // 0.00005 is dust for ETH (minQty=0.0001) but not for BTC (minQty=0.00001)
      expect(tradingRules.isDust(0.00005, "BTCUSDT")).toBe(false);
      expect(tradingRules.isDust(0.00005, "ETHUSDT")).toBe(true);
    });

    it("should throw error if rules not cached", () => {
      expect(() => tradingRules.isDust(0.001, "BTCUSDT")).toThrow(
        "No trading rules cached for BTCUSDT",
      );
    });
  });

  describe("isTradable", () => {
    it("should return true for amounts at or above minQty", async () => {
      await tradingRules.getRules("BTCUSDT");

      expect(tradingRules.isTradable(0.00001, "BTCUSDT")).toBe(true);
      expect(tradingRules.isTradable(0.00002, "BTCUSDT")).toBe(true);
      expect(tradingRules.isTradable(1, "BTCUSDT")).toBe(true);
    });

    it("should return false for amounts below minQty", async () => {
      await tradingRules.getRules("BTCUSDT");

      expect(tradingRules.isTradable(0.000001, "BTCUSDT")).toBe(false);
      expect(tradingRules.isTradable(0.000009, "BTCUSDT")).toBe(false);
    });

    it("should throw error if rules not cached", () => {
      expect(() => tradingRules.isTradable(0.001, "BTCUSDT")).toThrow(
        "No trading rules cached for BTCUSDT",
      );
    });
  });

  describe("getMinTradableAmount", () => {
    it("should return the minQty for a symbol", async () => {
      await tradingRules.getRules("BTCUSDT");

      expect(tradingRules.getMinTradableAmount("BTCUSDT")).toBe(0.00001);
    });

    it("should return different minQty for different symbols", async () => {
      await tradingRules.getRules("BTCUSDT");
      await tradingRules.getRules("ETHUSDT");

      expect(tradingRules.getMinTradableAmount("BTCUSDT")).toBe(0.00001);
      expect(tradingRules.getMinTradableAmount("ETHUSDT")).toBe(0.0001);
    });

    it("should throw error if rules not cached", () => {
      expect(() => tradingRules.getMinTradableAmount("BTCUSDT")).toThrow(
        "No trading rules cached for BTCUSDT",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle very small dust amounts", async () => {
      await tradingRules.getRules("BTCUSDT");

      // Zero is not dust - you're not holding anything
      expect(tradingRules.isDust(0, "BTCUSDT")).toBe(false);
      // Positive amounts below minQty are dust
      expect(tradingRules.isDust(0.00000001, "BTCUSDT")).toBe(true);
      expect(tradingRules.isDust(0.00000278, "BTCUSDT")).toBe(true); // The actual dust from the issue
    });

    it("should handle boundary values correctly", async () => {
      await tradingRules.getRules("BTCUSDT");
      const minQty = 0.00001;

      // Exactly at minQty should be tradable
      expect(tradingRules.isDust(minQty, "BTCUSDT")).toBe(false);
      expect(tradingRules.isTradable(minQty, "BTCUSDT")).toBe(true);

      // Just below minQty should be dust
      expect(tradingRules.isDust(minQty - 0.000001, "BTCUSDT")).toBe(true);
      expect(tradingRules.isTradable(minQty - 0.000001, "BTCUSDT")).toBe(false);
    });
  });

  describe("auto-refresh", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should refresh rules periodically", async () => {
      // Use real timers for this test since fake timers don't work well with setInterval + async
      jest.useRealTimers();

      const now = Date.now();
      await tradingRules.getRules("BTCUSDT");

      // Mock Date.now to make cache expired (25 hours later)
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => now + 25 * 60 * 60 * 1000);

      // Start auto-refresh with very short interval for testing
      const errorCallback = jest.fn();
      tradingRules.startAutoRefresh(100, errorCallback); // 100ms interval

      // Wait for at least one refresh cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have fetched exchange info again (initial + refresh)
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = originalDateNow;

      // Stop auto-refresh
      tradingRules.stopAutoRefresh();
    });

    it("should handle errors during auto-refresh", async () => {
      // Use real timers for this test since fake timers don't work well with setInterval + async
      jest.useRealTimers();

      const now = Date.now();
      await tradingRules.getRules("BTCUSDT");

      // Mock Date.now to make cache expired (25 hours later)
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => now + 25 * 60 * 60 * 1000);

      // Mock error on refresh (after the initial successful call)
      (mockBinanceClient.getExchangeInfo as jest.Mock).mockImplementationOnce(
        () => Promise.reject(new Error("Network error")),
      );

      const errorCallback = jest.fn();
      tradingRules.startAutoRefresh(100, errorCallback); // 100ms interval

      // Wait for at least one refresh cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Network error" }),
      );

      // Restore Date.now
      Date.now = originalDateNow;

      tradingRules.stopAutoRefresh();
    });
  });
});
