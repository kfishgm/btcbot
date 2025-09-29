import {
  calculateTradeableBTC,
  calculateDustBTC,
  calculateReferencePriceWithTradeable,
} from "../../src/utils/btc-utils";

describe("BTC Utils", () => {
  describe("calculateTradeableBTC", () => {
    it("should calculate tradeable BTC correctly with stepSize 0.00001", () => {
      const stepSize = 0.00001;

      // Test case from the Spanish feedback
      expect(calculateTradeableBTC(0.00087912, stepSize)).toBe(0.00087);

      // More test cases
      expect(calculateTradeableBTC(0.12345678, stepSize)).toBe(0.12345);
      expect(calculateTradeableBTC(1.00000001, stepSize)).toBe(1.0);
      expect(calculateTradeableBTC(0.00000999, stepSize)).toBe(0);
    });

    it("should handle edge cases", () => {
      expect(calculateTradeableBTC(0, 0.00001)).toBe(0);
      expect(calculateTradeableBTC(-1, 0.00001)).toBe(0);
      expect(calculateTradeableBTC(1, 0)).toBe(0);
    });

    it("should work with different step sizes", () => {
      expect(calculateTradeableBTC(0.123456, 0.001)).toBe(0.123);
      expect(calculateTradeableBTC(0.123456, 0.01)).toBe(0.12);
      expect(calculateTradeableBTC(0.123456, 0.1)).toBe(0.1);
    });
  });

  describe("calculateDustBTC", () => {
    it("should calculate dust correctly", () => {
      const stepSize = 0.00001;

      // Test case from the Spanish feedback
      expect(calculateDustBTC(0.00087912, stepSize)).toBeCloseTo(0.00000912, 8);

      // More test cases
      expect(calculateDustBTC(0.12345678, stepSize)).toBeCloseTo(0.00000678, 8);
      expect(calculateDustBTC(1.0, stepSize)).toBe(0);
    });
  });

  describe("calculateReferencePriceWithTradeable", () => {
    it("should calculate reference price using only tradeable BTC", () => {
      const stepSize = 0.00001;

      // Test case from Spanish feedback:
      // Buy 0.00087912 BTC for $100
      // Tradeable: 0.00087, Dust: 0.00000912
      // Reference price should be $100 / 0.00087 = $114,942.53
      const result = calculateReferencePriceWithTradeable(
        100,
        0.00087912,
        stepSize,
      );
      expect(result).toBeCloseTo(114942.53, 2);
    });

    it("should return null when all BTC is dust", () => {
      const stepSize = 0.00001;
      const result = calculateReferencePriceWithTradeable(
        100,
        0.00000999,
        stepSize,
      );
      expect(result).toBeNull();
    });

    it("should handle perfect step size multiples", () => {
      const stepSize = 0.00001;
      const result = calculateReferencePriceWithTradeable(
        100000,
        1.0,
        stepSize,
      );
      expect(result).toBe(100000);
    });

    it("should handle multiple purchases correctly", () => {
      const stepSize = 0.00001;

      // Example: 3 purchases totaling $300, BTC accumulated 0.00262912
      // Tradeable BTC: 0.00262
      // Reference price: $300 / 0.00262 = $114,503.82
      const result = calculateReferencePriceWithTradeable(
        300,
        0.00262912,
        stepSize,
      );
      expect(result).toBeCloseTo(114503.82, 2);
    });
  });
});
