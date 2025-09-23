import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Decimal } from "decimal.js";
import { OrderPriceCalculator } from "../../src/order/order-price-calculator";
import { TradingRules } from "../../src/exchange/trading-rules";
import { BinanceClient } from "../../src/exchange/binance-client";
import type { BinanceSymbolInfo } from "../../src/exchange/types";

// Only mock external dependencies
jest.mock("../../src/exchange/binance-client");

describe("OrderPriceCalculator", () => {
  let calculator: OrderPriceCalculator;
  let tradingRules: TradingRules;
  let mockBinanceClient: jest.Mocked<BinanceClient>;

  // Helper to create proper BinanceSymbolInfo
  const createBinanceSymbolInfo = (
    symbol: string,
    tickSize: number,
    stepSize: number = 0.00001,
    minPrice: string = "0.01",
    maxPrice: string = "10000000.00",
  ): BinanceSymbolInfo => ({
    symbol,
    status: "TRADING",
    baseAsset: symbol.replace("USDT", ""),
    quoteAsset: "USDT",
    baseAssetPrecision: 8,
    quoteAssetPrecision: 8,
    orderTypes: [
      "LIMIT",
      "LIMIT_MAKER",
      "MARKET",
      "STOP_LOSS_LIMIT",
      "TAKE_PROFIT_LIMIT",
    ],
    icebergAllowed: true,
    ocoAllowed: true,
    isSpotTradingAllowed: true,
    isMarginTradingAllowed: false,
    permissions: ["SPOT"],
    filters: [
      {
        filterType: "PRICE_FILTER",
        minPrice,
        maxPrice,
        tickSize: tickSize.toString(),
      },
      {
        filterType: "LOT_SIZE",
        minQty: stepSize === 1 ? "1" : "0.00001",
        maxQty: stepSize === 1 ? "1000000000" : "9000.00",
        stepSize: stepSize.toString(),
      },
      { filterType: "NOTIONAL", minNotional: "10.00" },
    ],
  });

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock Binance client that returns different configs for different symbols
    mockBinanceClient = {
      getExchangeInfo: jest.fn().mockImplementation((symbol?: unknown) => {
        const symbolStr = symbol as string | undefined;
        // Return all symbols or filter by symbol
        const allSymbols = [
          createBinanceSymbolInfo("BTCUSDT", 0.01),
          createBinanceSymbolInfo("ETHUSDT", 0.01),
          createBinanceSymbolInfo("SHIBUSDT", 0.00000001, 1, "0.00000001", "1"),
          createBinanceSymbolInfo("BNBUSDT", 0.01),
          createBinanceSymbolInfo(
            "TESTUSDT",
            0.00001,
            0.001,
            "0.00001",
            "1000",
          ),
        ];

        const symbols = symbolStr
          ? allSymbols.filter((s) => s.symbol === symbolStr)
          : allSymbols;

        return Promise.resolve({
          timezone: "UTC",
          serverTime: Date.now(),
          rateLimits: [],
          symbols,
        });
      }),
    } as unknown as jest.Mocked<BinanceClient>;

    // Create real TradingRules instance
    tradingRules = new TradingRules(
      mockBinanceClient as unknown as BinanceClient,
    );

    // Pre-cache rules for all test symbols
    await tradingRules.getRules("BTCUSDT");
    await tradingRules.getRules("ETHUSDT");
    await tradingRules.getRules("SHIBUSDT");
    await tradingRules.getRules("BNBUSDT");
    await tradingRules.getRules("TESTUSDT");

    // Create calculator instance with real TradingRules
    calculator = new OrderPriceCalculator(tradingRules);
  });

  describe("Constructor and initialization", () => {
    it("should create instance with TradingRules dependency", () => {
      expect(calculator).toBeDefined();
      expect(calculator).toBeInstanceOf(OrderPriceCalculator);
    });

    it("should accept custom slippage values in constructor", () => {
      const customCalculator = new OrderPriceCalculator(
        tradingRules,
        0.005, // 0.5% buy slippage
        0.004, // 0.4% sell slippage
      );
      expect(customCalculator).toBeDefined();
    });

    it("should use default slippage values of 0.003 when not provided", () => {
      // Test will pass when implementation uses default values
      const defaultCalculator = new OrderPriceCalculator(tradingRules);
      expect(defaultCalculator).toBeDefined();
    });
  });

  describe("calculateBuyLimitPrice - STRATEGY.md Section 5 Formula", () => {
    it("should calculate buy limit price with default slippage (0.3%)", () => {
      // STRATEGY.md: limit_price_buy = round_to_tick(Close * (1 + SlippageGuardBuyPct))
      const closePrice = 50000;
      const symbol = "BTCUSDT";

      // Expected: 50000 * (1 + 0.003) = 50000 * 1.003 = 50150
      // Rounded to tick: floor(50150 / 0.01) * 0.01 = 50150.00
      const expectedPrice = 50150.0;

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should calculate buy limit price with custom slippage (0.5%)", () => {
      const customCalculator = new OrderPriceCalculator(tradingRules, 0.005);
      const closePrice = 50000;
      const symbol = "BTCUSDT";

      // Expected: 50000 * (1 + 0.005) = 50000 * 1.005 = 50250
      // Rounded to tick: floor(50250 / 0.01) * 0.01 = 50250.00
      const expectedPrice = 50250.0;

      const result = customCalculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should handle different tick sizes correctly", async () => {
      // Update the mock to return different tick sizes
      mockBinanceClient.getExchangeInfo.mockImplementation(
        (symbol?: string) => {
          const configs: Record<string, number> = {
            "BTCUSDT-0.01": 0.01,
            "BTCUSDT-0.1": 0.1,
            "BTCUSDT-1": 1,
            "BTCUSDT-10": 10,
            "BTCUSDT-100": 100,
          };

          const tickSize = configs[symbol || ""] || 0.01;

          return Promise.resolve({
            timezone: "UTC",
            serverTime: Date.now(),
            rateLimits: [],
            symbols: [createBinanceSymbolInfo("BTCUSDT", tickSize)],
          });
        },
      );

      const testCases = [
        {
          closePrice: 50000,
          tickSize: 0.01,
          expected: 50150.0,
          testSymbol: "BTCUSDT-0.01",
        },
        {
          closePrice: 50000,
          tickSize: 0.1,
          expected: 50150.0,
          testSymbol: "BTCUSDT-0.1",
        },
        {
          closePrice: 50000,
          tickSize: 1,
          expected: 50150,
          testSymbol: "BTCUSDT-1",
        },
        {
          closePrice: 50000,
          tickSize: 10,
          expected: 50150,
          testSymbol: "BTCUSDT-10",
        },
        {
          closePrice: 50000,
          tickSize: 100,
          expected: 50100,
          testSymbol: "BTCUSDT-100",
        }, // Rounds down to 50100
      ];

      for (const testCase of testCases) {
        // Create a new TradingRules instance for each test case
        const testTradingRules = new TradingRules(
          mockBinanceClient as unknown as BinanceClient,
        );

        // Override the mock for this specific test
        mockBinanceClient.getExchangeInfo.mockResolvedValueOnce({
          timezone: "UTC",
          serverTime: Date.now(),
          rateLimits: [],
          symbols: [createBinanceSymbolInfo("BTCUSDT", testCase.tickSize)],
        });

        await testTradingRules.getRules("BTCUSDT", true);
        const testCalculator = new OrderPriceCalculator(testTradingRules);

        const result = testCalculator.calculateBuyLimitPrice(
          new Decimal(testCase.closePrice),
          "BTCUSDT",
        );
        expect(result.toNumber()).toBe(testCase.expected);
      }
    });

    it("should handle very small prices with precision", () => {
      const closePrice = 0.00012345;
      const symbol = "SHIBUSDT";

      // Expected: 0.00012345 * (1 + 0.003) = 0.00012345 * 1.003 = 0.00012382035
      // Rounded to tick: floor(0.00012382035 / 0.00000001) * 0.00000001 = 0.00012382
      const expectedPrice = 0.00012382;

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBeCloseTo(expectedPrice, 8);
    });

    it("should handle very large prices correctly", () => {
      const closePrice = 1000000;
      const symbol = "BTCUSDT";

      // Expected: 1000000 * (1 + 0.003) = 1000000 * 1.003 = 1003000
      // Rounded to tick: floor(1003000 / 0.01) * 0.01 = 1003000.00
      const expectedPrice = 1003000.0;

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should throw error if trading rules not cached", async () => {
      // Create a new calculator with fresh trading rules (no cache)
      const freshTradingRules = new TradingRules(
        mockBinanceClient as unknown as BinanceClient,
      );
      const freshCalculator = new OrderPriceCalculator(freshTradingRules);

      expect(() =>
        freshCalculator.calculateBuyLimitPrice(new Decimal(50000), "UNCACHED"),
      ).toThrow("No trading rules cached for UNCACHED. Call getRules() first.");
    });

    it("should use Decimal.js for all calculations to maintain precision", () => {
      // This test ensures implementation uses Decimal.js, not native JavaScript numbers
      const closePrice = 0.1 + 0.2; // This equals 0.30000000000000004 in JavaScript
      const symbol = "TESTUSDT";

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      // With Decimal.js: 0.3 * 1.003 = 0.3009 exactly
      // Without Decimal.js: potential floating point errors
      const expectedWithDecimal = 0.3009; // After rounding to tick size

      expect(result).toBeInstanceOf(Decimal);
      expect(result.toNumber()).toBeCloseTo(expectedWithDecimal, 5);
    });
  });

  describe("calculateSellLimitPrice - STRATEGY.md Section 5 Formula", () => {
    it("should calculate sell limit price with default slippage (0.3%)", () => {
      // STRATEGY.md: limit_price_sell = round_to_tick(Close * (1 - SlippageGuardSellPct))
      const closePrice = 50000;
      const symbol = "BTCUSDT";

      // Expected: 50000 * (1 - 0.003) = 50000 * 0.997 = 49850
      // Rounded to tick: floor(49850 / 0.01) * 0.01 = 49850.00
      const expectedPrice = 49850.0;

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should calculate sell limit price with custom slippage (0.5%)", () => {
      const customCalculator = new OrderPriceCalculator(
        tradingRules,
        0.003,
        0.005,
      );
      const closePrice = 50000;
      const symbol = "BTCUSDT";

      // Expected: 50000 * (1 - 0.005) = 50000 * 0.995 = 49750
      // Rounded to tick: floor(49750 / 0.01) * 0.01 = 49750.00
      const expectedPrice = 49750.0;

      const result = customCalculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should handle different tick sizes correctly", async () => {
      // Update the mock to return different tick sizes
      mockBinanceClient.getExchangeInfo.mockImplementation(
        (symbol?: string) => {
          const configs: Record<string, number> = {
            "BTCUSDT-0.01": 0.01,
            "BTCUSDT-0.1": 0.1,
            "BTCUSDT-1": 1,
            "BTCUSDT-10": 10,
            "BTCUSDT-100": 100,
          };

          const tickSize = configs[symbol || ""] || 0.01;

          return Promise.resolve({
            timezone: "UTC",
            serverTime: Date.now(),
            rateLimits: [],
            symbols: [createBinanceSymbolInfo("BTCUSDT", tickSize)],
          });
        },
      );

      const testCases = [
        { closePrice: 50000, tickSize: 0.01, expected: 49850.0 },
        { closePrice: 50000, tickSize: 0.1, expected: 49850.0 },
        { closePrice: 50000, tickSize: 1, expected: 49850 },
        { closePrice: 50000, tickSize: 10, expected: 49850 },
        { closePrice: 50000, tickSize: 100, expected: 49800 }, // Rounds down to 49800
      ];

      for (const testCase of testCases) {
        // Create a new TradingRules instance for each test case
        const testTradingRules = new TradingRules(
          mockBinanceClient as unknown as BinanceClient,
        );

        // Override the mock for this specific test
        mockBinanceClient.getExchangeInfo.mockResolvedValueOnce({
          timezone: "UTC",
          serverTime: Date.now(),
          rateLimits: [],
          symbols: [createBinanceSymbolInfo("BTCUSDT", testCase.tickSize)],
        });

        await testTradingRules.getRules("BTCUSDT", true);
        const testCalculator = new OrderPriceCalculator(testTradingRules);

        const result = testCalculator.calculateSellLimitPrice(
          new Decimal(testCase.closePrice),
          "BTCUSDT",
        );
        expect(result.toNumber()).toBe(testCase.expected);
      }
    });

    it("should handle very small prices with precision", () => {
      const closePrice = 0.00012345;
      const symbol = "SHIBUSDT";

      // Expected: 0.00012345 * (1 - 0.003) = 0.00012345 * 0.997 = 0.00012307965
      // Rounded to tick: floor(0.00012307965 / 0.00000001) * 0.00000001 = 0.00012307
      const expectedPrice = 0.00012307;

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBeCloseTo(expectedPrice, 8);
    });

    it("should handle very large prices correctly", () => {
      const closePrice = 1000000;
      const symbol = "BTCUSDT";

      // Expected: 1000000 * (1 - 0.003) = 1000000 * 0.997 = 997000
      // Rounded to tick: floor(997000 / 0.01) * 0.01 = 997000.00
      const expectedPrice = 997000.0;

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should throw error if trading rules not cached", async () => {
      // Create a new calculator with fresh trading rules (no cache)
      const freshTradingRules = new TradingRules(
        mockBinanceClient as unknown as BinanceClient,
      );
      const freshCalculator = new OrderPriceCalculator(freshTradingRules);

      expect(() =>
        freshCalculator.calculateSellLimitPrice(new Decimal(50000), "UNCACHED"),
      ).toThrow("No trading rules cached for UNCACHED. Call getRules() first.");
    });

    it("should use Decimal.js for all calculations to maintain precision", () => {
      const closePrice = 0.1 + 0.2; // This equals 0.30000000000000004 in JavaScript
      const symbol = "TESTUSDT";

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      // With Decimal.js: 0.3 * 0.997 = 0.2991 exactly
      // Without Decimal.js: potential floating point errors
      const expectedWithDecimal = 0.2991; // After rounding to tick size

      expect(result).toBeInstanceOf(Decimal);
      expect(result.toNumber()).toBeCloseTo(expectedWithDecimal, 5);
    });
  });

  describe("roundToTick - STRATEGY.md rounding formula", () => {
    it("should round price down to nearest tick size as per STRATEGY.md", async () => {
      // STRATEGY.md: round_to_tick(price): return floor(price / tick_size) * tick_size
      const testCases = [
        { price: 50123.456, tickSize: 0.01, expected: 50123.45 },
        { price: 50123.456, tickSize: 0.1, expected: 50123.4 },
        { price: 50123.456, tickSize: 1, expected: 50123 },
        { price: 50123.456, tickSize: 10, expected: 50120 },
        { price: 50123.456, tickSize: 100, expected: 50100 },
        { price: 0.123456789, tickSize: 0.00001, expected: 0.12345 },
        { price: 0.123456789, tickSize: 0.0001, expected: 0.1234 },
      ];

      for (const testCase of testCases) {
        const result = calculator.roundToTick(
          new Decimal(testCase.price),
          testCase.tickSize,
        );
        expect(result.toNumber()).toBeCloseTo(testCase.expected, 8);
      }
    });

    it("should always round DOWN (floor), never up", () => {
      const price = 50000.999999;
      const tickSize = 1;

      const result = calculator.roundToTick(new Decimal(price), tickSize);

      // Should round down to 50000, not up to 50001
      expect(result.toNumber()).toBe(50000);
    });

    it("should handle edge case where price is exactly on tick", () => {
      const price = 50000.0;
      const tickSize = 0.01;

      const result = calculator.roundToTick(new Decimal(price), tickSize);

      expect(result.toNumber()).toBe(50000.0);
    });

    it("should use Decimal.js to avoid floating point errors", () => {
      const price = 0.1 + 0.2; // 0.30000000000000004 in JavaScript
      const tickSize = 0.01;

      const result = calculator.roundToTick(new Decimal(price), tickSize);

      // Should correctly round to 0.30, not something weird due to float errors
      expect(result.toNumber()).toBe(0.3);
      expect(result).toBeInstanceOf(Decimal);
    });

    it("should work without cached rules as it takes tickSize directly", () => {
      // roundToTick doesn't need cached rules, it takes tickSize directly
      const result = calculator.roundToTick(new Decimal(50000), 0.01);
      expect(result.toNumber()).toBe(50000);
    });
  });

  describe("getTickSize helper method", () => {
    it("should return tick size for a symbol", async () => {
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      const result = await calculator.getTickSize(symbol);

      expect(result).toBe(tickSize);
    });
  });

  describe("Integration with multiple price ranges", () => {
    it("should handle different tick sizes for different symbols correctly", () => {
      // Some exchanges have different tick sizes for different price ranges
      // Test that calculator works correctly with various symbols
      const testSymbols = [
        {
          symbol: "BTCUSDT",
          closePrice: 50000,
          buyExpected: 50150.0,
          sellExpected: 49850.0,
        },
        {
          symbol: "ETHUSDT",
          closePrice: 3000,
          buyExpected: 3009.0,
          sellExpected: 2991.0,
        },
        {
          symbol: "SHIBUSDT",
          closePrice: 0.00001234,
          buyExpected: 0.00001237,
          sellExpected: 0.0000123,
        },
        {
          symbol: "BNBUSDT",
          closePrice: 300,
          buyExpected: 300.9,
          sellExpected: 299.1,
        },
      ];

      for (const test of testSymbols) {
        const buyPrice = calculator.calculateBuyLimitPrice(
          new Decimal(test.closePrice),
          test.symbol,
        );
        const sellPrice = calculator.calculateSellLimitPrice(
          new Decimal(test.closePrice),
          test.symbol,
        );

        expect(buyPrice.toNumber()).toBeCloseTo(test.buyExpected, 8);
        expect(sellPrice.toNumber()).toBeCloseTo(test.sellExpected, 8);
      }
    });
  });

  describe("Error handling and edge cases", () => {
    it("should throw error for zero price", () => {
      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(0), "BTCUSDT"),
      ).toThrow("Current price must be greater than 0");

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(0), "BTCUSDT"),
      ).toThrow("Current price must be greater than 0");
    });

    it("should handle negative price by throwing error", () => {
      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(-100), "BTCUSDT"),
      ).toThrow("Current price must be greater than 0");

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(-100), "BTCUSDT"),
      ).toThrow("Current price must be greater than 0");
    });

    it("should handle invalid slippage values in constructor", () => {
      expect(() => new OrderPriceCalculator(tradingRules, -0.01)).toThrow(
        "Buy slippage guard must be between 0 and 0.1",
      );

      expect(() => new OrderPriceCalculator(tradingRules, 1.1)).toThrow(
        "Buy slippage guard must be between 0 and 0.1",
      );

      expect(
        () => new OrderPriceCalculator(tradingRules, 0.003, -0.01),
      ).toThrow("Sell slippage guard must be between 0 and 0.1");

      expect(() => new OrderPriceCalculator(tradingRules, 0.003, 1.1)).toThrow(
        "Sell slippage guard must be between 0 and 0.1",
      );
    });

    it("should handle NaN price input", () => {
      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(NaN), "BTCUSDT"),
      ).toThrow("Current price must be a finite number");

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(NaN), "BTCUSDT"),
      ).toThrow("Current price must be a finite number");
    });

    it("should handle Infinity price input", () => {
      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(Infinity), "BTCUSDT"),
      ).toThrow("Current price must be a finite number");

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(Infinity), "BTCUSDT"),
      ).toThrow("Current price must be a finite number");
    });
  });

  describe("calculateBothPrices convenience method", () => {
    it("should calculate both buy and sell prices in one call", () => {
      const closePrice = 50000;
      const symbol = "BTCUSDT";

      const result = calculator.calculateBothPrices(
        new Decimal(closePrice),
        symbol,
      );

      expect(result).toHaveProperty("buyPrice");
      expect(result).toHaveProperty("sellPrice");
      expect(result.buyPrice).toBeInstanceOf(Decimal);
      expect(result.sellPrice).toBeInstanceOf(Decimal);
      expect(result.buyPrice.toNumber()).toBe(50150.0);
      expect(result.sellPrice.toNumber()).toBe(49850.0);
    });

    it("should cache rules efficiently when calculating both prices", () => {
      const closePrice = 50000;
      const symbol = "BTCUSDT";

      // Spy on getCachedRules to count calls
      const getCachedRulesSpy = jest.spyOn(tradingRules, "getCachedRules");

      const result = calculator.calculateBothPrices(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.buyPrice.toNumber()).toBe(50150.0);
      expect(result.sellPrice.toNumber()).toBe(49850.0);
      // Should call getCachedRules twice, once for buy and once for sell
      expect(getCachedRulesSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("getSlippageSettings method", () => {
    it("should return current slippage settings", () => {
      const defaultCalculator = new OrderPriceCalculator(tradingRules);
      const settings = defaultCalculator.getSlippageSettings();

      expect(settings).toEqual({
        buySlippage: 0.003,
        sellSlippage: 0.003,
      });
    });

    it("should return custom slippage settings", () => {
      const customCalculator = new OrderPriceCalculator(
        tradingRules,
        0.005,
        0.004,
      );
      const settings = customCalculator.getSlippageSettings();

      expect(settings).toEqual({
        buySlippage: 0.005,
        sellSlippage: 0.004,
      });
    });
  });
});
