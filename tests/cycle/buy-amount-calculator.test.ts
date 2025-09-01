import { BuyAmountCalculator } from "../../src/cycle/buy-amount-calculator";

// Define proper types for the tests
interface BuyAmountConfig {
  initialCapitalUSDT: number;
  maxPurchases: number;
  minBuyUSDT: number;
}

interface CycleState {
  buy_amount: number | null;
  capital_available: number;
  purchases_remaining: number;
}

interface ValidationConfig {
  minBuyUSDT: number;
  exchangeMinNotional: number;
}

interface SymbolInfo {
  symbol: string;
  filters: Array<{
    filterType: string;
    minNotional?: string;
    minPrice?: string;
    maxPrice?: string;
    tickSize?: string;
    applyToMarket?: boolean;
    avgPriceMins?: number;
  }>;
}

describe("BuyAmountCalculator", () => {
  let calculator: BuyAmountCalculator;

  beforeEach(() => {
    calculator = new BuyAmountCalculator();
  });

  describe("Initial Buy Amount Calculation", () => {
    it("should calculate initial buy amount at cycle start", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 10,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // buy_amount = floor(1000 / 10) = 100
      expect(result).toBe(100);
    });

    it("should floor to USDT precision (8 decimals)", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000.123456789,
        maxPurchases: 3,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // buy_amount = floor(1000.123456789 / 3) = floor(333.374586297) = 333.37458629
      expect(result).toBe(333.37458629);
    });

    it("should handle capital that divides evenly", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 500,
        maxPurchases: 5,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // buy_amount = floor(500 / 5) = 100
      expect(result).toBe(100);
    });

    it("should handle very small capital amounts", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 30,
        maxPurchases: 3,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // buy_amount = floor(30 / 3) = 10
      expect(result).toBe(10);
    });

    it("should handle large capital amounts", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000000,
        maxPurchases: 100,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // buy_amount = floor(1000000 / 100) = 10000
      expect(result).toBe(10000);
    });

    it("should validate that buy amount meets minimum requirement", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 25,
        maxPurchases: 10,
        minBuyUSDT: 10,
      };

      // buy_amount = floor(25 / 10) = 2.5 which is < minBuyUSDT
      expect(() => calculator.calculateInitialBuyAmount(config)).toThrow(
        "Calculated buy amount (2.5) is below minimum (10)",
      );
    });
  });

  describe("Regular Purchase Amount", () => {
    it("should return pre-calculated buy amount for regular purchases", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 500,
        purchases_remaining: 5,
      };

      const result = calculator.getPurchaseAmount(state);

      expect(result).toBe(100);
    });

    it("should use buy_amount when multiple purchases remain", () => {
      const state: CycleState = {
        buy_amount: 50.12345678,
        capital_available: 200,
        purchases_remaining: 3,
      };

      const result = calculator.getPurchaseAmount(state);

      expect(result).toBe(50.12345678);
    });

    it("should handle zero buy_amount (should not happen in practice)", () => {
      const state: CycleState = {
        buy_amount: 0,
        capital_available: 100,
        purchases_remaining: 2,
      };

      const result = calculator.getPurchaseAmount(state);

      expect(result).toBe(0);
    });
  });

  describe("Last Purchase Amount", () => {
    it("should use ALL remaining capital for last purchase", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 150.75,
        purchases_remaining: 1,
      };

      const result = calculator.getPurchaseAmount(state);

      // Should use all capital_available, not buy_amount
      expect(result).toBe(150.75);
    });

    it("should use all capital even if less than regular buy_amount", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 75.5,
        purchases_remaining: 1,
      };

      const result = calculator.getPurchaseAmount(state);

      expect(result).toBe(75.5);
    });

    it("should use all capital even if more than regular buy_amount", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 250.12345678,
        purchases_remaining: 1,
      };

      const result = calculator.getPurchaseAmount(state);

      expect(result).toBe(250.12345678);
    });

    it("should handle very small remaining capital", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 0.00000001,
        purchases_remaining: 1,
      };

      const result = calculator.getPurchaseAmount(state);

      expect(result).toBe(0.00000001);
    });
  });

  describe("Minimum Amount Validation", () => {
    it("should validate against minimum buy amount", () => {
      const amount = 5;
      const minBuyUSDT = 10;
      const exchangeMinNotional = 5;

      const result = calculator.isAmountValid(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe(false);
    });

    it("should validate against exchange minNotional", () => {
      const amount = 8;
      const minBuyUSDT = 5;
      const exchangeMinNotional = 10;

      const result = calculator.isAmountValid(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe(false);
    });

    it("should pass validation when amount meets both minimums", () => {
      const amount = 15;
      const minBuyUSDT = 10;
      const exchangeMinNotional = 12;

      const result = calculator.isAmountValid(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe(true);
    });

    it("should pass validation when amount exactly equals minimum", () => {
      const amount = 10;
      const minBuyUSDT = 10;
      const exchangeMinNotional = 5;

      const result = calculator.isAmountValid(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe(true);
    });

    it("should handle zero minimums (edge case)", () => {
      const amount = 0.001;
      const minBuyUSDT = 0;
      const exchangeMinNotional = 0;

      const result = calculator.isAmountValid(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe(true);
    });

    it("should return skip reason when amount is too small", () => {
      const amount = 5;
      const minBuyUSDT = 10;
      const exchangeMinNotional = 8;

      const result = calculator.getSkipReason(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe("Amount 5 is below minimum 10 USDT");
    });

    it("should return skip reason for exchange minimum", () => {
      const amount = 9;
      const minBuyUSDT = 5;
      const exchangeMinNotional = 10;

      const result = calculator.getSkipReason(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBe("Amount 9 is below exchange minimum 10 USDT");
    });

    it("should return null when amount is valid", () => {
      const amount = 20;
      const minBuyUSDT = 10;
      const exchangeMinNotional = 15;

      const result = calculator.getSkipReason(
        amount,
        minBuyUSDT,
        exchangeMinNotional,
      );

      expect(result).toBeNull();
    });
  });

  describe("Precision Handling", () => {
    it("should floor amounts to 8 decimal places", () => {
      const value = 123.123456789123;

      const result = calculator.floorToPrecision(value);

      expect(result).toBe(123.12345678);
    });

    it("should handle values with fewer than 8 decimals", () => {
      const value = 100.5;

      const result = calculator.floorToPrecision(value);

      expect(result).toBe(100.5);
    });

    it("should handle whole numbers", () => {
      const value = 500;

      const result = calculator.floorToPrecision(value);

      expect(result).toBe(500);
    });

    it("should handle very small values", () => {
      const value = 0.000000001;

      const result = calculator.floorToPrecision(value);

      expect(result).toBe(0);
    });

    it("should handle negative values (edge case)", () => {
      const value = -123.123456789;

      const result = calculator.floorToPrecision(value);

      expect(result).toBe(-123.12345679); // Floor for negative goes more negative
    });

    it("should maintain precision for calculation results", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 333.333333333,
        maxPurchases: 3,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // Should be floored to 8 decimals
      expect(result).toBe(111.11111111);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle zero capital", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 0,
        maxPurchases: 10,
        minBuyUSDT: 10,
      };

      expect(() => calculator.calculateInitialBuyAmount(config)).toThrow(
        "Calculated buy amount (0) is below minimum (10)",
      );
    });

    it("should handle negative capital (validation)", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: -100,
        maxPurchases: 10,
        minBuyUSDT: 10,
      };

      expect(() => calculator.calculateInitialBuyAmount(config)).toThrow(
        "Invalid configuration: negative values not allowed",
      );
    });

    it("should handle zero max purchases (division by zero)", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 0,
        minBuyUSDT: 10,
      };

      expect(() => calculator.calculateInitialBuyAmount(config)).toThrow(
        "Invalid configuration: maxPurchases must be greater than 0",
      );
    });

    it("should handle negative max purchases", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: -5,
        minBuyUSDT: 10,
      };

      expect(() => calculator.calculateInitialBuyAmount(config)).toThrow(
        "Invalid configuration: negative values not allowed",
      );
    });

    it("should handle null buy_amount in state", () => {
      const state: CycleState = {
        buy_amount: null,
        capital_available: 100,
        purchases_remaining: 3,
      };

      expect(() => calculator.getPurchaseAmount(state)).toThrow(
        "Buy amount not initialized",
      );
    });

    it("should handle zero purchases remaining", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 500,
        purchases_remaining: 0,
      };

      expect(() => calculator.getPurchaseAmount(state)).toThrow(
        "No purchases remaining",
      );
    });

    it("should handle negative purchases remaining", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 500,
        purchases_remaining: -1,
      };

      expect(() => calculator.getPurchaseAmount(state)).toThrow(
        "Invalid state: negative purchases remaining",
      );
    });

    it("should handle negative capital available", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: -50,
        purchases_remaining: 2,
      };

      expect(() => calculator.getPurchaseAmount(state)).toThrow(
        "Invalid state: negative capital available",
      );
    });
  });

  describe("Complete Purchase Flow", () => {
    it("should handle a complete cycle of purchases", () => {
      // Initialize calculator with config
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 4,
        minBuyUSDT: 10,
      };

      const initialBuyAmount = calculator.calculateInitialBuyAmount(config);
      expect(initialBuyAmount).toBe(250); // floor(1000/4)

      // Create state with calculated buy amount
      let state: CycleState = {
        buy_amount: initialBuyAmount,
        capital_available: 1000,
        purchases_remaining: 4,
      };

      // First purchase - regular amount
      let amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(250);

      // Update state after first purchase
      state = {
        buy_amount: initialBuyAmount,
        capital_available: 750,
        purchases_remaining: 3,
      };

      // Second purchase - regular amount
      amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(250);

      // Update state after second purchase
      state = {
        buy_amount: initialBuyAmount,
        capital_available: 500,
        purchases_remaining: 2,
      };

      // Third purchase - regular amount
      amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(250);

      // Update state after third purchase
      state = {
        buy_amount: initialBuyAmount,
        capital_available: 250,
        purchases_remaining: 1,
      };

      // Last purchase - use all remaining capital
      amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(250); // All remaining capital
    });

    it("should handle uneven division with last purchase adjustment", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 3,
        minBuyUSDT: 10,
      };

      const initialBuyAmount = calculator.calculateInitialBuyAmount(config);
      expect(initialBuyAmount).toBe(333.33333333); // floor to 8 decimals

      // Simulate purchases
      let state: CycleState = {
        buy_amount: initialBuyAmount,
        capital_available: 1000,
        purchases_remaining: 3,
      };

      // First purchase
      let amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(333.33333333);

      // After first purchase
      state.capital_available = 666.66666667;
      state.purchases_remaining = 2;

      // Second purchase
      amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(333.33333333);

      // After second purchase - rounding accumulation
      state.capital_available = 333.33333334;
      state.purchases_remaining = 1;

      // Last purchase - use ALL remaining (including rounding difference)
      amount = calculator.getPurchaseAmount(state);
      expect(amount).toBe(333.33333334);
    });
  });

  describe("Interface Requirements", () => {
    it("should provide method to check if purchase should be skipped", () => {
      const state: CycleState = {
        buy_amount: 5,
        capital_available: 5,
        purchases_remaining: 1,
      };

      const config: ValidationConfig = {
        minBuyUSDT: 10,
        exchangeMinNotional: 8,
      };

      const result = calculator.shouldSkipPurchase(state, config);

      expect(result).toBe(true);
    });

    it("should not skip valid purchase amounts", () => {
      const state: CycleState = {
        buy_amount: 50,
        capital_available: 200,
        purchases_remaining: 3,
      };

      const config: ValidationConfig = {
        minBuyUSDT: 10,
        exchangeMinNotional: 15,
      };

      const result = calculator.shouldSkipPurchase(state, config);

      expect(result).toBe(false);
    });

    it("should provide detailed purchase decision", () => {
      const state: CycleState = {
        buy_amount: 100,
        capital_available: 150,
        purchases_remaining: 1,
      };

      const config: ValidationConfig = {
        minBuyUSDT: 10,
        exchangeMinNotional: 5,
      };

      const decision = calculator.getPurchaseDecision(state, config);

      expect(decision).toEqual({
        shouldPurchase: true,
        amount: 150,
        isLastPurchase: true,
        skipReason: null,
      });
    });

    it("should provide skip decision with reason", () => {
      const state: CycleState = {
        buy_amount: 8,
        capital_available: 100,
        purchases_remaining: 5,
      };

      const config: ValidationConfig = {
        minBuyUSDT: 10,
        exchangeMinNotional: 5,
      };

      const decision = calculator.getPurchaseDecision(state, config);

      expect(decision).toEqual({
        shouldPurchase: false,
        amount: 8,
        isLastPurchase: false,
        skipReason: "Amount 8 is below minimum 10 USDT",
      });
    });

    it("should be able to recalculate buy amount on config change", () => {
      const oldConfig: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 10,
        minBuyUSDT: 10,
      };

      const oldBuyAmount = calculator.calculateInitialBuyAmount(oldConfig);
      expect(oldBuyAmount).toBe(100);

      // Config changes (e.g., user adjusts max_purchases)
      const newConfig: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 20,
        minBuyUSDT: 10,
      };

      const newBuyAmount = calculator.calculateInitialBuyAmount(newConfig);
      expect(newBuyAmount).toBe(50);
    });

    it("should validate exchange minimum from symbol info", () => {
      const symbolInfo: SymbolInfo = {
        symbol: "BTCUSDT",
        filters: [
          {
            filterType: "MIN_NOTIONAL",
            minNotional: "10.00000000",
            applyToMarket: true,
            avgPriceMins: 5,
          },
        ],
      };

      const minNotional = calculator.extractMinNotional(symbolInfo);
      expect(minNotional).toBe(10);
    });

    it("should handle missing MIN_NOTIONAL filter", () => {
      const symbolInfo: SymbolInfo = {
        symbol: "BTCUSDT",
        filters: [
          {
            filterType: "PRICE_FILTER",
            minPrice: "0.01000000",
            maxPrice: "1000000.00000000",
            tickSize: "0.01000000",
          },
        ],
      };

      const minNotional = calculator.extractMinNotional(symbolInfo);
      expect(minNotional).toBe(0); // Default when not found
    });

    it("should return correct type for all methods", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 10,
        minBuyUSDT: 10,
      };

      const buyAmount = calculator.calculateInitialBuyAmount(config);
      expect(typeof buyAmount).toBe("number");
      expect(isNaN(buyAmount)).toBe(false);
      expect(isFinite(buyAmount)).toBe(true);

      const flooredValue = calculator.floorToPrecision(123.456789012);
      expect(typeof flooredValue).toBe("number");

      const isValid = calculator.isAmountValid(100, 10, 5);
      expect(typeof isValid).toBe("boolean");
    });
  });

  describe("Formula Verification", () => {
    it("should match STRATEGY.md formula: buy_amount = floor(capital_available / max_purchases)", () => {
      // Direct formula verification
      const testCases = [
        { capital: 1000, purchases: 10, expected: 100 },
        { capital: 500, purchases: 7, expected: 71.42857142 },
        { capital: 333.33, purchases: 3, expected: 111.11 },
        { capital: 999.99, purchases: 9, expected: 111.11 },
      ];

      testCases.forEach(({ capital, purchases, expected }) => {
        const config: BuyAmountConfig = {
          initialCapitalUSDT: capital,
          maxPurchases: purchases,
          minBuyUSDT: 0.01, // Very low to not interfere
        };

        const result = calculator.calculateInitialBuyAmount(config);
        expect(result).toBeCloseTo(expected, 8);
      });
    });

    it("should correctly apply floor function per STRATEGY.md", () => {
      const config: BuyAmountConfig = {
        initialCapitalUSDT: 1000,
        maxPurchases: 7,
        minBuyUSDT: 10,
      };

      const result = calculator.calculateInitialBuyAmount(config);

      // 1000 / 7 = 142.857142857...
      // floor to 8 decimals = 142.85714285
      expect(result).toBe(142.85714285);
    });

    it("should use all capital for last purchase as per STRATEGY.md", () => {
      // STRATEGY.md: "if (purchases_remaining == 1): amount_to_buy = capital_available"
      const testCases = [
        { capital: 123.45, buyAmount: 100, expected: 123.45 },
        { capital: 99.99999999, buyAmount: 100, expected: 99.99999999 },
        { capital: 200, buyAmount: 50, expected: 200 },
      ];

      testCases.forEach(({ capital, buyAmount, expected }) => {
        const state: CycleState = {
          buy_amount: buyAmount,
          capital_available: capital,
          purchases_remaining: 1,
        };

        const result = calculator.getPurchaseAmount(state);
        expect(result).toBe(expected);
      });
    });

    it("should skip when amount < max(MinBuyUSDT, exchange_minNotional)", () => {
      // STRATEGY.md: "Skip if amount_to_buy < max(MinBuyUSDT, exchange_minNotional)"
      const testCases = [
        { amount: 5, minBuy: 10, minNotional: 8, shouldSkip: true },
        { amount: 9, minBuy: 8, minNotional: 10, shouldSkip: true },
        { amount: 10, minBuy: 10, minNotional: 10, shouldSkip: false },
        { amount: 11, minBuy: 10, minNotional: 5, shouldSkip: false },
      ];

      testCases.forEach(({ amount, minBuy, minNotional, shouldSkip }) => {
        const isValid = calculator.isAmountValid(amount, minBuy, minNotional);
        expect(isValid).toBe(!shouldSkip);
      });
    });
  });
});
