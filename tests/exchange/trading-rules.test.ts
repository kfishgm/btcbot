import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import type { BinanceExchangeInfo } from "../../src/exchange/types";

// Mock the BinanceClient module
jest.mock("../../src/exchange/binance-client");

describe("TradingRules", () => {
  let tradingRules: TradingRules;
  let mockClient: {
    getExchangeInfo: jest.Mock;
  };
  const TEST_SYMBOL = "BTCUSDT";

  const mockExchangeInfo: BinanceExchangeInfo = {
    timezone: "UTC",
    serverTime: Date.now(),
    rateLimits: [],
    symbols: [
      {
        symbol: "BTCUSDT",
        status: "TRADING",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        baseAssetPrecision: 8,
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
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock client with properly typed mock
    mockClient = {
      getExchangeInfo: jest.fn(() => Promise.resolve(mockExchangeInfo)),
    };

    // Create TradingRules instance with mock client
    tradingRules = new TradingRules(mockClient as unknown as BinanceClient);
  });

  describe("Exchange Info Fetching", () => {
    it("should fetch exchange info from the client", async () => {
      const info = await tradingRules.fetchExchangeInfo();

      expect(info).toEqual(mockExchangeInfo);
      expect(mockClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should fetch and parse trading rules for a symbol", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      expect(rules).toBeDefined();
      expect(rules.symbol).toBe(TEST_SYMBOL);
      expect(rules.minPrice).toBe(0.01);
      expect(rules.maxPrice).toBe(1000000);
      expect(rules.tickSize).toBe(0.01);
      expect(rules.minQty).toBe(0.00001);
      expect(rules.maxQty).toBe(9000);
      expect(rules.stepSize).toBe(0.00001);
      expect(rules.minNotional).toBe(10);
    });

    it("should throw error if symbol not found", async () => {
      await expect(tradingRules.getRules("INVALIDUSDT")).rejects.toThrow(
        "Symbol INVALIDUSDT not found in exchange info",
      );
    });
  });

  describe("Rule Caching", () => {
    it("should cache rules after first fetch", async () => {
      // First call
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should force refresh when requested", async () => {
      // First call
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Force refresh
      await tradingRules.getRules(TEST_SYMBOL, true);
      expect(mockClient.getExchangeInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe("Price Rounding", () => {
    beforeEach(async () => {
      await tradingRules.getRules(TEST_SYMBOL);
    });

    it("should round price to tick size", () => {
      const rounded = tradingRules.roundPriceToTick(50123.456, TEST_SYMBOL);
      expect(rounded).toBe(50123.45);
    });

    it("should clamp price to min/max bounds", () => {
      const tooLow = tradingRules.roundPriceToTick(0.001, TEST_SYMBOL);
      expect(tooLow).toBe(0.01); // minPrice

      const tooHigh = tradingRules.roundPriceToTick(2000000, TEST_SYMBOL);
      expect(tooHigh).toBe(1000000); // maxPrice
    });
  });

  describe("Quantity Rounding", () => {
    beforeEach(async () => {
      await tradingRules.getRules(TEST_SYMBOL);
    });

    it("should round quantity to step size", () => {
      const rounded = tradingRules.roundQuantityToStep(1.234567, TEST_SYMBOL);
      expect(rounded).toBe(1.23456);
    });

    it("should clamp quantity to min/max bounds", () => {
      const tooSmall = tradingRules.roundQuantityToStep(0.000001, TEST_SYMBOL);
      expect(tooSmall).toBe(0.00001); // minQty

      const tooLarge = tradingRules.roundQuantityToStep(10000, TEST_SYMBOL);
      expect(tooLarge).toBe(9000); // maxQty
    });
  });

  describe("Minimum Notional Validation", () => {
    beforeEach(async () => {
      await tradingRules.getRules(TEST_SYMBOL);
    });

    it("should validate minimum notional", () => {
      // Valid: 50000 * 0.001 = 50 > 10
      const valid = tradingRules.validateMinNotional(50000, 0.001, TEST_SYMBOL);
      expect(valid).toBe(true);

      // Invalid: 50000 * 0.0001 = 5 < 10
      const invalid = tradingRules.validateMinNotional(
        50000,
        0.0001,
        TEST_SYMBOL,
      );
      expect(invalid).toBe(false);
    });

    it("should calculate minimum quantity for price", () => {
      const minQty = tradingRules.getMinQuantityForPrice(50000, TEST_SYMBOL);
      expect(minQty).toBeCloseTo(0.0002, 5);
    });
  });

  describe("Order Validation", () => {
    beforeEach(async () => {
      await tradingRules.getRules(TEST_SYMBOL);
    });

    it("should validate valid order", () => {
      const result = tradingRules.validateOrder(
        TEST_SYMBOL,
        50000,
        0.001,
        "LIMIT",
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect invalid order", () => {
      const result = tradingRules.validateOrder(
        TEST_SYMBOL,
        0.001,
        0.000001,
        "LIMIT",
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should suggest minimum quantity when below notional", () => {
      const result = tradingRules.validateOrder(
        TEST_SYMBOL,
        50000,
        0.0001,
        "LIMIT",
      );

      expect(result.valid).toBe(false);
      expect(result.suggestedMinQuantity).toBeDefined();
      expect(result.suggestedMinQuantity).toBeGreaterThanOrEqual(0.0002);
    });
  });

  describe("Minimum Sellable Quantity (Dust Handling)", () => {
    beforeEach(async () => {
      await tradingRules.getRules(TEST_SYMBOL);
    });

    it("should calculate minimum sellable quantity based on notional value", () => {
      // At $50,000 per BTC, minimum $10 notional requires 0.0002 BTC
      const minQty = tradingRules.getMinimumSellableQuantity(
        50000,
        TEST_SYMBOL,
      );
      expect(minQty).toBe(0.0002);
    });

    it("should round up to step size for minimum sellable quantity", () => {
      // At $115,000 per BTC, $10 notional = 0.00008695... BTC
      // Should round up to 0.00009 (9 * stepSize of 0.00001)
      const minQty = tradingRules.getMinimumSellableQuantity(
        115000,
        TEST_SYMBOL,
      );
      expect(minQty).toBe(0.00009);
    });

    it("should respect minQty even if notional allows less", () => {
      // At very high price, notional might allow < minQty
      // But result should still be at least minQty
      const minQty = tradingRules.getMinimumSellableQuantity(
        10000000,
        TEST_SYMBOL,
      );
      expect(minQty).toBeGreaterThanOrEqual(0.00001);
    });

    it("should handle NOTIONAL filter type (Binance spot trading)", async () => {
      // Create exchange info with NOTIONAL instead of MIN_NOTIONAL
      const spotExchangeInfo: BinanceExchangeInfo = {
        ...mockExchangeInfo,
        symbols: [
          {
            ...mockExchangeInfo.symbols[0],
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
                filterType: "NOTIONAL",
                minNotional: "5.00",
                applyToMarket: true,
                avgPriceMins: 5,
              },
            ],
          },
        ],
      };

      mockClient.getExchangeInfo = jest.fn(() =>
        Promise.resolve(spotExchangeInfo),
      );

      // Force refresh to get new rules
      const rules = await tradingRules.getRules(TEST_SYMBOL, true);

      // Should parse NOTIONAL filter correctly
      expect(rules.minNotional).toBe(5);

      // At $100,000 per BTC, $5 notional = 0.00005 BTC
      const minQty = tradingRules.getMinimumSellableQuantity(
        100000,
        TEST_SYMBOL,
      );
      expect(minQty).toBe(0.00005);
    });
  });
});
