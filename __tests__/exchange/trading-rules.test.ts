import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import type {
  BinanceExchangeInfo,
  BinanceSymbolFilter,
  BinanceSymbolInfo,
  SymbolTradingRules,
} from "../../src/exchange/types";

// Mock the BinanceClient
jest.mock("../../src/exchange/binance-client");

describe("TradingRules", () => {
  let tradingRules: TradingRules;
  let mockBinanceClient: jest.Mocked<BinanceClient>;
  const TEST_SYMBOL = "BTCUSDT";

  beforeEach(() => {
    jest.clearAllMocks();
    mockBinanceClient = new BinanceClient({
      apiKey: "test",
      apiSecret: "test",
      testnet: true,
    }) as jest.Mocked<BinanceClient>;

    tradingRules = new TradingRules(mockBinanceClient);
  });

  describe("Exchange Info Fetching", () => {
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

    it("should fetch exchange info from /api/v3/exchangeInfo endpoint", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      await tradingRules.fetchExchangeInfo();

      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should fetch and store trading rules for a specific symbol", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      const rules = await tradingRules.getRules(TEST_SYMBOL);

      expect(rules).toBeDefined();
      expect(rules.symbol).toBe(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should throw error if symbol not found in exchange info", async () => {
      const emptyExchangeInfo: BinanceExchangeInfo = {
        ...mockExchangeInfo,
        symbols: [],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(emptyExchangeInfo);

      await expect(tradingRules.getRules("INVALIDUSDT")).rejects.toThrow(
        "Symbol INVALIDUSDT not found in exchange info",
      );
    });
  });

  describe("Trading Rules Parsing", () => {
    const mockSymbolInfo: BinanceSymbolInfo = {
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
    };

    it("should parse PRICE_FILTER correctly", async () => {
      const mockExchangeInfo: BinanceExchangeInfo = {
        timezone: "UTC",
        serverTime: Date.now(),
        rateLimits: [],
        symbols: [mockSymbolInfo],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      const rules = await tradingRules.getRules(TEST_SYMBOL);

      expect(rules.minPrice).toBe(0.01);
      expect(rules.maxPrice).toBe(1000000.0);
      expect(rules.tickSize).toBe(0.01);
    });

    it("should parse LOT_SIZE filter correctly", async () => {
      const mockExchangeInfo: BinanceExchangeInfo = {
        timezone: "UTC",
        serverTime: Date.now(),
        rateLimits: [],
        symbols: [mockSymbolInfo],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      const rules = await tradingRules.getRules(TEST_SYMBOL);

      expect(rules.minQty).toBe(0.00001);
      expect(rules.maxQty).toBe(9000.0);
      expect(rules.stepSize).toBe(0.00001);
    });

    it("should parse MIN_NOTIONAL filter correctly", async () => {
      const mockExchangeInfo: BinanceExchangeInfo = {
        timezone: "UTC",
        serverTime: Date.now(),
        rateLimits: [],
        symbols: [mockSymbolInfo],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      const rules = await tradingRules.getRules(TEST_SYMBOL);

      expect(rules.minNotional).toBe(10.0);
    });

    it("should handle missing filters gracefully", async () => {
      const symbolWithNoFilters: BinanceSymbolInfo = {
        ...mockSymbolInfo,
        filters: [],
      };

      const mockExchangeInfo: BinanceExchangeInfo = {
        timezone: "UTC",
        serverTime: Date.now(),
        rateLimits: [],
        symbols: [symbolWithNoFilters],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // Should have default values when filters are missing
      expect(rules.minPrice).toBe(0);
      expect(rules.maxPrice).toBe(Number.MAX_SAFE_INTEGER);
      expect(rules.tickSize).toBe(0.00000001);
      expect(rules.minQty).toBe(0);
      expect(rules.maxQty).toBe(Number.MAX_SAFE_INTEGER);
      expect(rules.stepSize).toBe(0.00000001);
      expect(rules.minNotional).toBe(0);
    });
  });

  describe("Rule Caching with TTL", () => {
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

    it("should cache rules after first fetch", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // First call
      await tradingRules.getRules(TEST_SYMBOL);
      // Second call
      await tradingRules.getRules(TEST_SYMBOL);

      // Should only fetch once due to caching
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should respect 24-hour TTL for cached rules", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // First call
      const rules1 = await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Advance time by 23 hours
      jest.advanceTimersByTime(23 * 60 * 60 * 1000);

      // Should still use cached version
      const rules2 = await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
      expect(rules2).toEqual(rules1);

      // Advance time by 2 more hours (total 25 hours)
      jest.advanceTimersByTime(2 * 60 * 60 * 1000);

      // Should fetch new data after 24 hours
      const rules3 = await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(2);
    });

    it("should invalidate cache when forceRefresh is true", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // First call
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Force refresh
      await tradingRules.getRules(TEST_SYMBOL, true);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(2);
    });

    it("should clear all cached rules when clearCache is called", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // Cache some rules
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Clear cache
      tradingRules.clearCache();

      // Should fetch again after cache clear
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(2);
    });

    it("should return cache status correctly", async () => {
      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // Initially no cache
      expect(tradingRules.isCached(TEST_SYMBOL)).toBe(false);

      // After fetching
      await tradingRules.getRules(TEST_SYMBOL);
      expect(tradingRules.isCached(TEST_SYMBOL)).toBe(true);

      // After cache expires
      jest.advanceTimersByTime(25 * 60 * 60 * 1000);
      expect(tradingRules.isCached(TEST_SYMBOL)).toBe(false);
    });
  });

  describe("Price Rounding Helpers", () => {
    beforeEach(async () => {
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
            ],
            permissions: ["SPOT"],
          },
        ],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);
    });

    it("should round price DOWN to nearest tick size", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // tickSize is 0.01
      const rounded = tradingRules.roundPrice(TEST_SYMBOL, 50123.456789);
      expect(rounded).toBe(50123.45);
    });

    it("should round price to exact tick size when already aligned", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      const rounded = tradingRules.roundPrice(TEST_SYMBOL, 50123.45);
      expect(rounded).toBe(50123.45);
    });

    it("should handle small prices correctly", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      const rounded = tradingRules.roundPrice(TEST_SYMBOL, 0.016);
      expect(rounded).toBe(0.01);
    });

    it("should throw error if rules not cached for symbol", () => {
      expect(() => tradingRules.roundPrice("ETHUSDT", 1234.56)).toThrow(
        "Trading rules not cached for symbol ETHUSDT. Call getRules() first.",
      );
    });

    it("should clamp price to min/max bounds", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // Below minimum
      const tooLow = tradingRules.roundPrice(TEST_SYMBOL, 0.001);
      expect(tooLow).toBe(0.01); // minPrice

      // Above maximum
      const tooHigh = tradingRules.roundPrice(TEST_SYMBOL, 2000000);
      expect(tooHigh).toBe(1000000); // maxPrice
    });
  });

  describe("Quantity Rounding Helpers", () => {
    beforeEach(async () => {
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
                filterType: "LOT_SIZE",
                minQty: "0.00001",
                maxQty: "9000.00",
                stepSize: "0.00001",
              },
            ],
            permissions: ["SPOT"],
          },
        ],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);
    });

    it("should round quantity DOWN to nearest step size", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // stepSize is 0.00001
      const rounded = tradingRules.roundQuantity(TEST_SYMBOL, 1.23456789);
      expect(rounded).toBe(1.23456);
    });

    it("should round quantity to exact step size when already aligned", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      const rounded = tradingRules.roundQuantity(TEST_SYMBOL, 1.23456);
      expect(rounded).toBe(1.23456);
    });

    it("should handle small quantities correctly", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      const rounded = tradingRules.roundQuantity(TEST_SYMBOL, 0.000016);
      expect(rounded).toBe(0.00001);
    });

    it("should throw error if rules not cached for symbol", () => {
      expect(() => tradingRules.roundQuantity("ETHUSDT", 1.234)).toThrow(
        "Trading rules not cached for symbol ETHUSDT. Call getRules() first.",
      );
    });

    it("should clamp quantity to min/max bounds", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // Below minimum
      const tooLow = tradingRules.roundQuantity(TEST_SYMBOL, 0.000001);
      expect(tooLow).toBe(0.00001); // minQty

      // Above maximum
      const tooHigh = tradingRules.roundQuantity(TEST_SYMBOL, 10000);
      expect(tooHigh).toBe(9000); // maxQty
    });
  });

  describe("Minimum Notional Validation", () => {
    beforeEach(async () => {
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

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);
    });

    it("should validate order meets minimum notional value", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // minNotional is 10.00
      const isValid1 = tradingRules.validateNotional(TEST_SYMBOL, 0.001, 50000);
      expect(isValid1).toBe(true); // 0.001 * 50000 = 50 > 10

      const isValid2 = tradingRules.validateNotional(
        TEST_SYMBOL,
        0.0001,
        50000,
      );
      expect(isValid2).toBe(false); // 0.0001 * 50000 = 5 < 10
    });

    it("should calculate minimum quantity for given price", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // minNotional is 10.00
      const minQty = tradingRules.getMinQuantityForPrice(TEST_SYMBOL, 50000);
      expect(minQty).toBeCloseTo(0.0002, 5); // 10 / 50000 = 0.0002
    });

    it("should round minimum quantity up to step size", async () => {
      const rules = await tradingRules.getRules(TEST_SYMBOL);

      // If calculated min is 0.000194, should round UP to 0.00020 to ensure minimum is met
      const minQty = tradingRules.getMinQuantityForPrice(TEST_SYMBOL, 51546);
      expect(minQty).toBe(0.0002); // Rounded up to ensure min notional
    });

    it("should throw error if rules not cached for symbol", () => {
      expect(() => tradingRules.validateNotional("ETHUSDT", 1, 1000)).toThrow(
        "Trading rules not cached for symbol ETHUSDT. Call getRules() first.",
      );
    });
  });

  describe("Automatic Rule Refresh", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should automatically refresh rules after 24 hours", async () => {
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
            filters: [],
            permissions: ["SPOT"],
          },
        ],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // Enable auto-refresh
      tradingRules.enableAutoRefresh(TEST_SYMBOL);

      // Initial fetch
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Advance time by 24 hours
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);

      // Should have triggered auto-refresh
      await Promise.resolve(); // Let pending promises resolve
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(2);
    });

    it("should stop auto-refresh when disabled", async () => {
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
            filters: [],
            permissions: ["SPOT"],
          },
        ],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      // Enable auto-refresh
      tradingRules.enableAutoRefresh(TEST_SYMBOL);

      // Initial fetch
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Disable auto-refresh
      tradingRules.disableAutoRefresh(TEST_SYMBOL);

      // Advance time by 24 hours
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);

      // Should NOT have triggered auto-refresh
      await Promise.resolve();
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should handle refresh errors gracefully", async () => {
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
            filters: [],
            permissions: ["SPOT"],
          },
        ],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValueOnce(mockExchangeInfo)
        .mockRejectedValueOnce(new Error("Network error"));

      // Enable auto-refresh with error callback
      const errorCallback = jest.fn();
      tradingRules.enableAutoRefresh(TEST_SYMBOL, errorCallback);

      // Initial fetch succeeds
      await tradingRules.getRules(TEST_SYMBOL);
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);

      // Advance time by 24 hours
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);

      // Wait for async operations
      await Promise.resolve();
      await Promise.resolve();

      // Should have called error callback
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Network error",
        }),
      );

      // Old rules should still be cached
      expect(tradingRules.isCached(TEST_SYMBOL)).toBe(true);
    });
  });

  describe("Validation Helpers", () => {
    beforeEach(async () => {
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

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      await tradingRules.getRules(TEST_SYMBOL);
    });

    it("should validate complete order parameters", () => {
      const validation = tradingRules.validateOrder(TEST_SYMBOL, {
        quantity: 0.001,
        price: 50000,
      });

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.adjustedQuantity).toBe(0.001);
      expect(validation.adjustedPrice).toBe(50000);
    });

    it("should detect and report multiple validation errors", () => {
      const validation = tradingRules.validateOrder(TEST_SYMBOL, {
        quantity: 0.000001, // Below min
        price: 0.001, // Below min
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain(
        "Quantity below minimum: 0.000001 < 0.00001",
      );
      expect(validation.errors).toContain("Price below minimum: 0.001 < 0.01");
      expect(validation.errors).toContain(
        "Order notional below minimum: 0.000000001 < 10",
      );
    });

    it("should auto-adjust order parameters when requested", () => {
      const validation = tradingRules.validateOrder(
        TEST_SYMBOL,
        {
          quantity: 0.000016, // Will round to 0.00001
          price: 50000.016, // Will round to 50000.01
        },
        true, // autoAdjust
      );

      expect(validation.isValid).toBe(false); // Still invalid due to notional
      expect(validation.adjustedQuantity).toBe(0.00001);
      expect(validation.adjustedPrice).toBe(50000.01);
    });

    it("should suggest minimum valid quantity for price", () => {
      const validation = tradingRules.validateOrder(TEST_SYMBOL, {
        quantity: 0.0001,
        price: 50000,
      });

      expect(validation.isValid).toBe(false);
      expect(validation.suggestedMinQuantity).toBeCloseTo(0.0002, 5);
      expect(validation.errors).toContain(
        expect.stringMatching(/Suggested minimum quantity/),
      );
    });
  });

  describe("Batch Operations", () => {
    it("should fetch rules for multiple symbols in batch", async () => {
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
                filterType: "MIN_NOTIONAL",
                minNotional: "10.00",
                applyToMarket: true,
                avgPriceMins: 5,
              },
            ],
            permissions: ["SPOT"],
          },
          {
            symbol: "ETHUSDT",
            status: "TRADING",
            baseAsset: "ETH",
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

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      const symbols = ["BTCUSDT", "ETHUSDT"];
      const rulesMap = await tradingRules.getBatchRules(symbols);

      expect(rulesMap.size).toBe(2);
      expect(rulesMap.has("BTCUSDT")).toBe(true);
      expect(rulesMap.has("ETHUSDT")).toBe(true);
      // Should only call API once for batch
      expect(mockBinanceClient.getExchangeInfo).toHaveBeenCalledTimes(1);
    });

    it("should prefetch and cache all USDT pairs", async () => {
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
            filters: [],
            permissions: ["SPOT"],
          },
          {
            symbol: "ETHUSDT",
            status: "TRADING",
            baseAsset: "ETH",
            quoteAsset: "USDT",
            baseAssetPrecision: 8,
            quoteAssetPrecision: 8,
            orderTypes: ["LIMIT", "MARKET"],
            icebergAllowed: true,
            ocoAllowed: true,
            isSpotTradingAllowed: true,
            isMarginTradingAllowed: false,
            filters: [],
            permissions: ["SPOT"],
          },
          {
            symbol: "BNBBTC",
            status: "TRADING",
            baseAsset: "BNB",
            quoteAsset: "BTC",
            baseAssetPrecision: 8,
            quoteAssetPrecision: 8,
            orderTypes: ["LIMIT", "MARKET"],
            icebergAllowed: true,
            ocoAllowed: true,
            isSpotTradingAllowed: true,
            isMarginTradingAllowed: false,
            filters: [],
            permissions: ["SPOT"],
          },
        ],
      };

      mockBinanceClient.getExchangeInfo = jest
        .fn()
        .mockResolvedValue(mockExchangeInfo);

      await tradingRules.prefetchAllUSDTPairs();

      // Should cache only USDT pairs
      expect(tradingRules.isCached("BTCUSDT")).toBe(true);
      expect(tradingRules.isCached("ETHUSDT")).toBe(true);
      expect(tradingRules.isCached("BNBBTC")).toBe(false);
    });
  });

  describe("Type Definitions", () => {
    it("should have correct type definitions for SymbolTradingRules", () => {
      const rules: SymbolTradingRules = {
        symbol: "BTCUSDT",
        minPrice: 0.01,
        maxPrice: 1000000,
        tickSize: 0.01,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        baseAssetPrecision: 8,
        quoteAssetPrecision: 8,
        status: "TRADING",
        orderTypes: ["LIMIT", "MARKET"],
        permissions: ["SPOT"],
      };

      expect(rules.symbol).toBe("BTCUSDT");
      expect(rules.minPrice).toBe(0.01);
      expect(rules.tickSize).toBe(0.01);
    });

    it("should have correct type for validation result", () => {
      interface ValidationResult {
        isValid: boolean;
        errors: string[];
        adjustedQuantity?: number;
        adjustedPrice?: number;
        suggestedMinQuantity?: number;
      }

      const result: ValidationResult = {
        isValid: true,
        errors: [],
        adjustedQuantity: 0.001,
        adjustedPrice: 50000,
      };

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
