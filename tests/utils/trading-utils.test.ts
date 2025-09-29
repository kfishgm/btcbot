import {
  roundToTickSize,
  roundToQuotePrecision,
  floorToTickSize,
  ceilToTickSize,
  isValidPrice,
  getPrecisionFromStep,
} from "../../src/utils/trading-utils";

describe("Trading Utils", () => {
  describe("roundToTickSize", () => {
    it("should round to various tick sizes correctly", () => {
      // Test with 0.01 tick size (typical for BTCUSDT)
      expect(roundToTickSize(100.12345, 0.01)).toBe(100.12);
      expect(roundToTickSize(100.126, 0.01)).toBe(100.13);
      expect(roundToTickSize(100.124, 0.01)).toBe(100.12);

      // Test with 0.1 tick size
      expect(roundToTickSize(100.12345, 0.1)).toBe(100.1);
      expect(roundToTickSize(100.16, 0.1)).toBe(100.2);
      expect(roundToTickSize(100.14, 0.1)).toBe(100.1);

      // Test with 1.0 tick size
      expect(roundToTickSize(100.4, 1)).toBe(100);
      expect(roundToTickSize(100.5, 1)).toBe(101);
      expect(roundToTickSize(100.9, 1)).toBe(101);

      // Test with 10 tick size
      expect(roundToTickSize(104, 10)).toBe(100);
      expect(roundToTickSize(105, 10)).toBe(110);
      expect(roundToTickSize(109, 10)).toBe(110);
    });

    it("should handle different tick sizes to prove no hardcoding", () => {
      const price = 99999.555;

      // Each should produce different results based on tick size
      expect(roundToTickSize(price, 0.001)).toBe(99999.555);
      expect(roundToTickSize(price, 0.01)).toBe(99999.56);
      expect(roundToTickSize(price, 0.1)).toBe(99999.6);
      expect(roundToTickSize(price, 1)).toBe(100000);
      expect(roundToTickSize(price, 10)).toBe(100000);
      expect(roundToTickSize(price, 100)).toBe(100000);

      // If code was hardcoded to 2 decimals, all would be 99999.56
    });

    it("should throw for invalid tick size", () => {
      expect(() => roundToTickSize(100, 0)).toThrow("Invalid tickSize");
      expect(() => roundToTickSize(100, -1)).toThrow("Invalid tickSize");
    });

    it("should handle very small tick sizes", () => {
      expect(roundToTickSize(0.123456789, 0.00001)).toBe(0.12346);
      expect(roundToTickSize(0.123456789, 0.000001)).toBe(0.123457);
    });
  });

  describe("floorToTickSize", () => {
    it("should floor to tick size", () => {
      expect(floorToTickSize(100.126, 0.01)).toBe(100.12);
      expect(floorToTickSize(100.129, 0.01)).toBe(100.12);
      expect(floorToTickSize(100.16, 0.1)).toBe(100.1);
      expect(floorToTickSize(100.99, 1)).toBe(100);
    });

    it("should prove no hardcoding with different tick sizes", () => {
      const price = 12345.6789;

      expect(floorToTickSize(price, 0.0001)).toBe(12345.6789);
      expect(floorToTickSize(price, 0.001)).toBe(12345.678);
      expect(floorToTickSize(price, 0.01)).toBe(12345.67);
      expect(floorToTickSize(price, 0.1)).toBe(12345.6);
      expect(floorToTickSize(price, 1)).toBe(12345);
      expect(floorToTickSize(price, 10)).toBe(12340);
    });
  });

  describe("ceilToTickSize", () => {
    it("should ceil to tick size", () => {
      expect(ceilToTickSize(100.121, 0.01)).toBe(100.13);
      expect(ceilToTickSize(100.12, 0.01)).toBe(100.12);
      expect(ceilToTickSize(100.11, 0.1)).toBe(100.2);
      expect(ceilToTickSize(100.01, 1)).toBe(101);
    });

    it("should prove no hardcoding with different tick sizes", () => {
      const price = 12345.1111;

      expect(ceilToTickSize(price, 0.0001)).toBe(12345.1111);
      expect(ceilToTickSize(price, 0.001)).toBe(12345.112);
      expect(ceilToTickSize(price, 0.01)).toBe(12345.12);
      expect(ceilToTickSize(price, 0.1)).toBe(12345.2);
      expect(ceilToTickSize(price, 1)).toBe(12346);
      expect(ceilToTickSize(price, 10)).toBe(12350);
    });
  });

  describe("roundToQuotePrecision", () => {
    it("should round to various precisions", () => {
      const amount = 123.456789123;

      // Test different precisions (NOT hardcoded to 8)
      expect(roundToQuotePrecision(amount, 0)).toBe(123);
      expect(roundToQuotePrecision(amount, 1)).toBe(123.5);
      expect(roundToQuotePrecision(amount, 2)).toBe(123.46);
      expect(roundToQuotePrecision(amount, 3)).toBe(123.457);
      expect(roundToQuotePrecision(amount, 4)).toBe(123.4568);
      expect(roundToQuotePrecision(amount, 8)).toBe(123.45678912);
      expect(roundToQuotePrecision(amount, 10)).toBe(123.456789123);

      // If hardcoded to 8, would always return 123.45678912
    });

    it("should throw for invalid precision", () => {
      expect(() => roundToQuotePrecision(100, -1)).toThrow("Invalid precision");
      expect(() => roundToQuotePrecision(100, 21)).toThrow("Invalid precision");
    });

    it("should handle edge cases", () => {
      expect(roundToQuotePrecision(0, 8)).toBe(0);
      expect(roundToQuotePrecision(-100.123456789, 4)).toBe(-100.1235);
      expect(roundToQuotePrecision(0.000000001, 8)).toBe(0);
      expect(roundToQuotePrecision(0.000000001, 9)).toBe(0.000000001);
    });
  });

  describe("isValidPrice", () => {
    it("should validate prices against tick size", () => {
      // Valid prices for 0.01 tick
      expect(isValidPrice(100.0, 0.01)).toBe(true);
      expect(isValidPrice(100.01, 0.01)).toBe(true);
      expect(isValidPrice(100.12, 0.01)).toBe(true);

      // Invalid prices for 0.01 tick
      expect(isValidPrice(100.001, 0.01)).toBe(false);
      expect(isValidPrice(100.015, 0.01)).toBe(false);
      expect(isValidPrice(100.123, 0.01)).toBe(false);

      // Valid for 0.1 tick
      expect(isValidPrice(100.0, 0.1)).toBe(true);
      expect(isValidPrice(100.1, 0.1)).toBe(true);
      expect(isValidPrice(100.2, 0.1)).toBe(true);

      // Invalid for 0.1 tick
      expect(isValidPrice(100.01, 0.1)).toBe(false);
      expect(isValidPrice(100.15, 0.1)).toBe(false);
    });

    it("should work with different tick sizes proving no hardcoding", () => {
      const price = 100.111;

      expect(isValidPrice(price, 0.001)).toBe(true); // Valid for 0.001
      expect(isValidPrice(price, 0.01)).toBe(false); // Invalid for 0.01
      expect(isValidPrice(price, 0.1)).toBe(false); // Invalid for 0.1
      expect(isValidPrice(price, 1)).toBe(false); // Invalid for 1
    });
  });

  describe("getPrecisionFromStep", () => {
    it("should calculate precision from step size", () => {
      // Decimal step sizes
      expect(getPrecisionFromStep(0.00001)).toBe(5);
      expect(getPrecisionFromStep(0.0001)).toBe(4);
      expect(getPrecisionFromStep(0.001)).toBe(3);
      expect(getPrecisionFromStep(0.01)).toBe(2);
      expect(getPrecisionFromStep(0.1)).toBe(1);

      // Integer step sizes
      expect(getPrecisionFromStep(1)).toBe(0);
      expect(getPrecisionFromStep(10)).toBe(-1);
      expect(getPrecisionFromStep(100)).toBe(-2);
    });

    it("should throw for invalid step size", () => {
      expect(() => getPrecisionFromStep(0)).toThrow("Invalid stepSize");
      expect(() => getPrecisionFromStep(-1)).toThrow("Invalid stepSize");
    });

    it("should handle edge cases", () => {
      expect(getPrecisionFromStep(0.123)).toBe(3);
      expect(getPrecisionFromStep(5)).toBe(0); // Not a power of 10
      expect(getPrecisionFromStep(0.00000001)).toBe(8); // BTC precision
    });
  });

  describe("Integration: No hardcoded values", () => {
    it("should produce different results with different rules", () => {
      // Simulate different exchange rules
      const btcusdtRules = { tickSize: 0.01, quotePrecision: 8 };
      const ethusdtRules = { tickSize: 0.1, quotePrecision: 6 };
      const bnbusdtRules = { tickSize: 0.001, quotePrecision: 4 };

      const price = 12345.6789;
      const amount = 100.123456789;

      // Each pair should produce different results
      const btcPrice = roundToTickSize(price, btcusdtRules.tickSize);
      const ethPrice = roundToTickSize(price, ethusdtRules.tickSize);
      const bnbPrice = roundToTickSize(price, bnbusdtRules.tickSize);

      expect(btcPrice).toBe(12345.68);
      expect(ethPrice).toBe(12345.7);
      expect(bnbPrice).toBe(12345.679);

      const btcAmount = roundToQuotePrecision(
        amount,
        btcusdtRules.quotePrecision,
      );
      const ethAmount = roundToQuotePrecision(
        amount,
        ethusdtRules.quotePrecision,
      );
      const bnbAmount = roundToQuotePrecision(
        amount,
        bnbusdtRules.quotePrecision,
      );

      expect(btcAmount).toBe(100.12345679);
      expect(ethAmount).toBe(100.123457);
      expect(bnbAmount).toBe(100.1235);

      // If any values were hardcoded, these would be identical
      expect(btcPrice).not.toBe(ethPrice);
      expect(ethPrice).not.toBe(bnbPrice);
      expect(btcAmount).not.toBe(ethAmount);
      expect(ethAmount).not.toBe(bnbAmount);
    });
  });
});
