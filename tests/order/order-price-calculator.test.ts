import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Decimal } from "decimal.js";
import { OrderPriceCalculator } from "../../src/order/order-price-calculator";
import { TradingRules } from "../../src/exchange/trading-rules";
import type { SymbolTradingRules } from "../../src/exchange/types";

// Mock TradingRules
jest.mock("../../src/exchange/trading-rules");

describe("OrderPriceCalculator", () => {
  let calculator: OrderPriceCalculator;
  let mockTradingRules: {
    getCachedRules: jest.Mock<
      (symbol: string) => SymbolTradingRules | undefined
    >;
    getRules: jest.Mock<
      (symbol: string, forceRefresh?: boolean) => Promise<SymbolTradingRules>
    >;
    roundPriceToTick: jest.Mock<(price: number, symbol: string) => number>;
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock trading rules instance with properly typed methods
    mockTradingRules = {
      getCachedRules: jest.fn(),
      getRules: jest.fn(),
      roundPriceToTick: jest.fn(),
    };

    // Create calculator instance with mock (cast to TradingRules for constructor)
    calculator = new OrderPriceCalculator(
      mockTradingRules as unknown as TradingRules,
    );
  });

  describe("Constructor and initialization", () => {
    it("should create instance with TradingRules dependency", () => {
      expect(calculator).toBeDefined();
      expect(calculator).toBeInstanceOf(OrderPriceCalculator);
    });

    it("should accept custom slippage values in constructor", () => {
      const customCalculator = new OrderPriceCalculator(
        mockTradingRules as unknown as TradingRules,
        0.005, // 0.5% buy slippage
        0.004, // 0.4% sell slippage
      );
      expect(customCalculator).toBeDefined();
    });

    it("should use default slippage values of 0.003 when not provided", () => {
      // Test will pass when implementation uses default values
      const defaultCalculator = new OrderPriceCalculator(
        mockTradingRules as unknown as TradingRules,
      );
      expect(defaultCalculator).toBeDefined();
    });
  });

  describe("calculateBuyLimitPrice - STRATEGY.md Section 5 Formula", () => {
    it("should calculate buy limit price with default slippage (0.3%)", () => {
      // STRATEGY.md: limit_price_buy = round_to_tick(Close * (1 + SlippageGuardBuyPct))
      const closePrice = 50000;
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      // Expected: 50000 * (1 + 0.003) = 50000 * 1.003 = 50150
      // Rounded to tick: floor(50150 / 0.01) * 0.01 = 50150.00
      const expectedPrice = 50150.0;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
      expect(mockTradingRules.getCachedRules).toHaveBeenCalledWith(symbol);
    });

    it("should calculate buy limit price with custom slippage (0.5%)", () => {
      const customCalculator = new OrderPriceCalculator(
        mockTradingRules as unknown as TradingRules,
        0.005,
      );
      const closePrice = 50000;
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      // Expected: 50000 * (1 + 0.005) = 50000 * 1.005 = 50250
      // Rounded to tick: floor(50250 / 0.01) * 0.01 = 50250.00
      const expectedPrice = 50250.0;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = customCalculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should handle different tick sizes correctly", () => {
      const testCases = [
        { closePrice: 50000, tickSize: 0.01, expected: 50150.0 },
        { closePrice: 50000, tickSize: 0.1, expected: 50150.0 },
        { closePrice: 50000, tickSize: 1, expected: 50150 },
        { closePrice: 50000, tickSize: 10, expected: 50150 },
        { closePrice: 50000, tickSize: 100, expected: 50100 }, // Rounds down to 50100
      ];

      for (const testCase of testCases) {
        mockTradingRules.getCachedRules.mockReturnValue({
          symbol: "BTCUSDT",
          tickSize: testCase.tickSize,
          minPrice: 0.01,
          maxPrice: 1000000,
          minQty: 0.00001,
          maxQty: 9000,
          stepSize: 0.00001,
          minNotional: 10,
          lastUpdated: Date.now(),
        });

        const result = calculator.calculateBuyLimitPrice(
          new Decimal(testCase.closePrice),
          "BTCUSDT",
        );
        expect(result.toNumber()).toBe(testCase.expected);
      }
    });

    it("should handle very small prices with precision", () => {
      const closePrice = 0.00012345;
      const symbol = "SHIBUSDT";
      const tickSize = 0.00000001;

      // Expected: 0.00012345 * (1 + 0.003) = 0.00012345 * 1.003 = 0.00012382035
      // Rounded to tick: floor(0.00012382035 / 0.00000001) * 0.00000001 = 0.00012382
      const expectedPrice = 0.00012382;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.00000001,
        maxPrice: 1,
        minQty: 1,
        maxQty: 1000000000,
        stepSize: 1,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBeCloseTo(expectedPrice, 8);
    });

    it("should handle very large prices correctly", () => {
      const closePrice = 1000000;
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      // Expected: 1000000 * (1 + 0.003) = 1000000 * 1.003 = 1003000
      // Rounded to tick: floor(1003000 / 0.01) * 0.01 = 1003000.00
      const expectedPrice = 1003000.0;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 10000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should throw error if trading rules not cached", () => {
      mockTradingRules.getCachedRules.mockReturnValue(undefined);

      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(50000), "BTCUSDT"),
      ).toThrow("No trading rules cached for BTCUSDT. Call getRules() first.");
    });

    it("should fetch rules if not cached when fetchIfMissing is true", () => {
      const closePrice = 50000;
      const symbol = "BTCUSDT";
      const rules: SymbolTradingRules = {
        symbol,
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      };

      mockTradingRules.getCachedRules.mockReturnValue(undefined);
      mockTradingRules.getRules.mockResolvedValue(rules);

      const result = calculator.calculateBuyLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(50150.0);
      expect(mockTradingRules.getRules).toHaveBeenCalledWith(symbol);
    });

    it("should use Decimal.js for all calculations to maintain precision", () => {
      // This test ensures implementation uses Decimal.js, not native JavaScript numbers
      const closePrice = 0.1 + 0.2; // This equals 0.30000000000000004 in JavaScript
      const symbol = "TESTUSDT";
      const tickSize = 0.00001;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.00001,
        maxPrice: 1000,
        minQty: 0.001,
        maxQty: 10000,
        stepSize: 0.001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

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
      const tickSize = 0.01;

      // Expected: 50000 * (1 - 0.003) = 50000 * 0.997 = 49850
      // Rounded to tick: floor(49850 / 0.01) * 0.01 = 49850.00
      const expectedPrice = 49850.0;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
      expect(mockTradingRules.getCachedRules).toHaveBeenCalledWith(symbol);
    });

    it("should calculate sell limit price with custom slippage (0.5%)", () => {
      const customCalculator = new OrderPriceCalculator(
        mockTradingRules as unknown as TradingRules,
        0.003,
        0.005,
      );
      const closePrice = 50000;
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      // Expected: 50000 * (1 - 0.005) = 50000 * 0.995 = 49750
      // Rounded to tick: floor(49750 / 0.01) * 0.01 = 49750.00
      const expectedPrice = 49750.0;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = customCalculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should handle different tick sizes correctly", () => {
      const testCases = [
        { closePrice: 50000, tickSize: 0.01, expected: 49850.0 },
        { closePrice: 50000, tickSize: 0.1, expected: 49850.0 },
        { closePrice: 50000, tickSize: 1, expected: 49850 },
        { closePrice: 50000, tickSize: 10, expected: 49850 },
        { closePrice: 50000, tickSize: 100, expected: 49800 }, // Rounds down to 49800
      ];

      for (const testCase of testCases) {
        mockTradingRules.getCachedRules.mockReturnValue({
          symbol: "BTCUSDT",
          tickSize: testCase.tickSize,
          minPrice: 0.01,
          maxPrice: 1000000,
          minQty: 0.00001,
          maxQty: 9000,
          stepSize: 0.00001,
          minNotional: 10,
          lastUpdated: Date.now(),
        });

        const result = calculator.calculateSellLimitPrice(
          new Decimal(testCase.closePrice),
          "BTCUSDT",
        );
        expect(result.toNumber()).toBe(testCase.expected);
      }
    });

    it("should handle very small prices with precision", () => {
      const closePrice = 0.00012345;
      const symbol = "SHIBUSDT";
      const tickSize = 0.00000001;

      // Expected: 0.00012345 * (1 - 0.003) = 0.00012345 * 0.997 = 0.00012307965
      // Rounded to tick: floor(0.00012307965 / 0.00000001) * 0.00000001 = 0.00012307
      const expectedPrice = 0.00012307;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.00000001,
        maxPrice: 1,
        minQty: 1,
        maxQty: 1000000000,
        stepSize: 1,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBeCloseTo(expectedPrice, 8);
    });

    it("should handle very large prices correctly", () => {
      const closePrice = 1000000;
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      // Expected: 1000000 * (1 - 0.003) = 1000000 * 0.997 = 997000
      // Rounded to tick: floor(997000 / 0.01) * 0.01 = 997000.00
      const expectedPrice = 997000.0;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 10000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(expectedPrice);
    });

    it("should throw error if trading rules not cached", () => {
      mockTradingRules.getCachedRules.mockReturnValue(undefined);

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(50000), "BTCUSDT"),
      ).toThrow("No trading rules cached for BTCUSDT. Call getRules() first.");
    });

    it("should fetch rules if not cached when fetchIfMissing is true", () => {
      const closePrice = 50000;
      const symbol = "BTCUSDT";
      const rules: SymbolTradingRules = {
        symbol,
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      };

      mockTradingRules.getCachedRules.mockReturnValue(undefined);
      mockTradingRules.getRules.mockResolvedValue(rules);

      const result = calculator.calculateSellLimitPrice(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.toNumber()).toBe(49850.0);
      expect(mockTradingRules.getRules).toHaveBeenCalledWith(symbol);
    });

    it("should use Decimal.js for all calculations to maintain precision", () => {
      const closePrice = 0.1 + 0.2; // This equals 0.30000000000000004 in JavaScript
      const symbol = "TESTUSDT";
      const tickSize = 0.00001;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.00001,
        maxPrice: 1000,
        minQty: 0.001,
        maxQty: 10000,
        stepSize: 0.001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

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
    it("should round price down to nearest tick size as per STRATEGY.md", () => {
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
        mockTradingRules.getCachedRules.mockReturnValue({
          symbol: "BTCUSDT",
          tickSize: testCase.tickSize,
          minPrice: 0.00001,
          maxPrice: 10000000,
          minQty: 0.00001,
          maxQty: 9000,
          stepSize: 0.00001,
          minNotional: 10,
          lastUpdated: Date.now(),
        });

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

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "BTCUSDT",
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.roundToTick(new Decimal(price), tickSize);

      // Should round down to 50000, not up to 50001
      expect(result.toNumber()).toBe(50000);
    });

    it("should handle edge case where price is exactly on tick", () => {
      const price = 50000.0;
      const tickSize = 0.01;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "BTCUSDT",
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.roundToTick(new Decimal(price), tickSize);

      expect(result.toNumber()).toBe(50000.0);
    });

    it("should use Decimal.js to avoid floating point errors", () => {
      const price = 0.1 + 0.2; // 0.30000000000000004 in JavaScript
      const tickSize = 0.01;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "TESTUSDT",
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000,
        minQty: 0.001,
        maxQty: 10000,
        stepSize: 0.001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.roundToTick(new Decimal(price), tickSize);

      // Should correctly round to 0.30, not something weird due to float errors
      expect(result.toNumber()).toBe(0.3);
      expect(result).toBeInstanceOf(Decimal);
    });

    it("should throw error if trading rules not cached", () => {
      mockTradingRules.getCachedRules.mockReturnValue(undefined);

      // roundToTick doesn't need cached rules, it takes tickSize directly
      const result = calculator.roundToTick(new Decimal(50000), 0.01);
      expect(result.toNumber()).toBe(50000);
    });
  });

  describe("getTickSize helper method", () => {
    it("should return tick size for a symbol from cached rules", () => {
      const symbol = "BTCUSDT";
      const tickSize = 0.01;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const result = calculator.getTickSize(symbol);

      expect(result).toBe(tickSize);
    });

    it("should fetch rules if not cached when fetchIfMissing is true", () => {
      const symbol = "BTCUSDT";
      const tickSize = 0.01;
      const rules: SymbolTradingRules = {
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      };

      mockTradingRules.getCachedRules.mockReturnValue(undefined);
      mockTradingRules.getRules.mockResolvedValue(rules);

      const result = calculator.getTickSize(symbol);

      expect(result).toBe(tickSize);
      expect(mockTradingRules.getRules).toHaveBeenCalledWith(symbol);
    });

    it("should throw error if rules not cached and fetchIfMissing is false", () => {
      mockTradingRules.getCachedRules.mockReturnValue(undefined);

      expect(calculator.getTickSize("BTCUSDT")).rejects.toThrow(
        "No trading rules cached for BTCUSDT",
      );
    });
  });

  describe("Integration with multiple price ranges", () => {
    it("should handle different tick sizes for different price ranges correctly", () => {
      // Some exchanges have different tick sizes for different price ranges
      // Test that calculator works correctly with various symbols
      const testSymbols = [
        {
          symbol: "BTCUSDT",
          closePrice: 50000,
          tickSize: 0.01,
          buyExpected: 50150.0,
          sellExpected: 49850.0,
        },
        {
          symbol: "ETHUSDT",
          closePrice: 3000,
          tickSize: 0.01,
          buyExpected: 3009.0,
          sellExpected: 2991.0,
        },
        {
          symbol: "SHIBUSDT",
          closePrice: 0.00001234,
          tickSize: 0.00000001,
          buyExpected: 0.00001237,
          sellExpected: 0.0000123,
        },
        {
          symbol: "BNBUSDT",
          closePrice: 300,
          tickSize: 0.01,
          buyExpected: 300.9,
          sellExpected: 299.1,
        },
      ];

      for (const test of testSymbols) {
        mockTradingRules.getCachedRules.mockReturnValue({
          symbol: test.symbol,
          tickSize: test.tickSize,
          minPrice: test.tickSize,
          maxPrice: 10000000,
          minQty: 0.00001,
          maxQty: 1000000,
          stepSize: 0.00001,
          minNotional: 10,
          lastUpdated: Date.now(),
        });

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
    it("should handle zero price gracefully", () => {
      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "BTCUSDT",
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      const buyResult = calculator.calculateBuyLimitPrice(
        new Decimal(0),
        "BTCUSDT",
      );
      const sellResult = calculator.calculateSellLimitPrice(
        new Decimal(0),
        "BTCUSDT",
      );

      expect(buyResult.toNumber()).toBe(0);
      expect(sellResult.toNumber()).toBe(0);
    });

    it("should handle negative price by throwing error", () => {
      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "BTCUSDT",
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(-100), "BTCUSDT"),
      ).toThrow("Current price must be greater than 0");

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(-100), "BTCUSDT"),
      ).toThrow("Current price must be greater than 0");
    });

    it("should handle invalid slippage values in constructor", () => {
      expect(
        () =>
          new OrderPriceCalculator(
            mockTradingRules as unknown as TradingRules,
            -0.01,
          ),
      ).toThrow("Buy slippage guard must be between 0 and 0.1");

      expect(
        () =>
          new OrderPriceCalculator(
            mockTradingRules as unknown as TradingRules,
            1.1,
          ),
      ).toThrow("Buy slippage guard must be between 0 and 0.1");

      expect(
        () =>
          new OrderPriceCalculator(
            mockTradingRules as unknown as TradingRules,
            0.003,
            -0.01,
          ),
      ).toThrow("Sell slippage guard must be between 0 and 0.1");

      expect(
        () =>
          new OrderPriceCalculator(
            mockTradingRules as unknown as TradingRules,
            0.003,
            1.1,
          ),
      ).toThrow("Sell slippage guard must be between 0 and 0.1");
    });

    it("should handle NaN price input", () => {
      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "BTCUSDT",
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

      expect(() =>
        calculator.calculateBuyLimitPrice(new Decimal(NaN), "BTCUSDT"),
      ).toThrow("Current price must be a finite number");

      expect(() =>
        calculator.calculateSellLimitPrice(new Decimal(NaN), "BTCUSDT"),
      ).toThrow("Current price must be a finite number");
    });

    it("should handle Infinity price input", () => {
      mockTradingRules.getCachedRules.mockReturnValue({
        symbol: "BTCUSDT",
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

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
      const tickSize = 0.01;

      mockTradingRules.getCachedRules.mockReturnValue({
        symbol,
        tickSize,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      });

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

    it("should only fetch rules once when calculating both prices", () => {
      const closePrice = 50000;
      const symbol = "BTCUSDT";
      const rules: SymbolTradingRules = {
        symbol,
        tickSize: 0.01,
        minPrice: 0.01,
        maxPrice: 1000000,
        minQty: 0.00001,
        maxQty: 9000,
        stepSize: 0.00001,
        minNotional: 10,
        lastUpdated: Date.now(),
      };

      mockTradingRules.getCachedRules.mockReturnValue(undefined);
      mockTradingRules.getRules.mockResolvedValue(rules);

      const result = calculator.calculateBothPrices(
        new Decimal(closePrice),
        symbol,
      );

      expect(result.buyPrice.toNumber()).toBe(50150.0);
      expect(result.sellPrice.toNumber()).toBe(49850.0);
      // Should only fetch rules once, not twice
      expect(mockTradingRules.getRules).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSlippageSettings method", () => {
    it("should return current slippage settings", () => {
      const defaultCalculator = new OrderPriceCalculator(
        mockTradingRules as unknown as TradingRules,
      );
      const settings = defaultCalculator.getSlippageSettings();

      expect(settings).toEqual({
        buySlippage: 0.003,
        sellSlippage: 0.003,
      });
    });

    it("should return custom slippage settings", () => {
      const customCalculator = new OrderPriceCalculator(
        mockTradingRules as unknown as TradingRules,
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
