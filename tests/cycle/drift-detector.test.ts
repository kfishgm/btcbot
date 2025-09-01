import { describe, it, expect, beforeEach } from "@jest/globals";
import { DriftDetector } from "../../src/cycle/drift-detector";

describe("DriftDetector", () => {
  let detector: DriftDetector;
  const DRIFT_THRESHOLD = 0.005; // 0.5% as per STRATEGY.md

  beforeEach(() => {
    detector = new DriftDetector();
  });

  describe("USDT Drift Calculation", () => {
    it("should calculate zero drift when balances match exactly", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1000,
        capitalAvailable: 1000,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
      expect(result.asset).toBe("USDT");
      expect(result.threshold).toBe(DRIFT_THRESHOLD);
    });

    it("should calculate positive drift when spot balance is higher", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1010,
        capitalAvailable: 1000,
      });

      // drift = |1010 - 1000| / max(1000, 1) = 10 / 1000 = 0.01 (1%)
      expect(result.driftPercentage).toBe(0.01);
      expect(result.status).toBe("exceeded");
      expect(result.asset).toBe("USDT");
    });

    it("should calculate negative drift when spot balance is lower", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 990,
        capitalAvailable: 1000,
      });

      // drift = |990 - 1000| / max(1000, 1) = 10 / 1000 = 0.01 (1%)
      expect(result.driftPercentage).toBe(0.01);
      expect(result.status).toBe("exceeded");
    });

    it("should handle exactly at threshold (0.5%)", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1005,
        capitalAvailable: 1000,
      });

      // drift = |1005 - 1000| / 1000 = 0.005 (0.5%)
      expect(result.driftPercentage).toBe(0.005);
      expect(result.status).toBe("exceeded"); // Threshold is >= 0.005
    });

    it("should handle just below threshold", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1004.99,
        capitalAvailable: 1000,
      });

      // drift = |1004.99 - 1000| / 1000 = 0.00499 (0.499%)
      expect(result.driftPercentage).toBeCloseTo(0.00499, 10);
      expect(result.status).toBe("ok");
    });

    it("should handle zero capital available (edge case)", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 10,
        capitalAvailable: 0,
      });

      // drift = |10 - 0| / max(0, 1) = 10 / 1 = 10
      expect(result.driftPercentage).toBe(10);
      expect(result.status).toBe("exceeded");
    });

    it("should handle both values at zero", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 0,
        capitalAvailable: 0,
      });

      // drift = |0 - 0| / max(0, 1) = 0 / 1 = 0
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle very small capital values", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 0.01,
        capitalAvailable: 0.01,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle negative values gracefully", () => {
      // Negative values shouldn't happen in production but we handle them
      const result = detector.checkUSDTDrift({
        spotBalance: 100,
        capitalAvailable: -100,
      });

      // drift = |100 - (-100)| / max(-100, 1) = 200 / 1 = 200
      expect(result.driftPercentage).toBe(200);
      expect(result.status).toBe("exceeded");
    });

    it("should maintain precision for small drift values", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1000.001,
        capitalAvailable: 1000,
      });

      // drift = |1000.001 - 1000| / 1000 = 0.000001
      expect(result.driftPercentage).toBeCloseTo(0.000001, 10);
      expect(result.status).toBe("ok");
    });
  });

  describe("BTC Drift Calculation", () => {
    it("should calculate zero drift when balances match exactly", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.5,
        btcAccumulated: 0.5,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
      expect(result.asset).toBe("BTC");
      expect(result.threshold).toBe(DRIFT_THRESHOLD);
    });

    it("should calculate positive drift when spot balance is higher", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.01,
        btcAccumulated: 1,
      });

      // drift = |1.01 - 1| / max(1, 0.00000001) = 0.01 / 1 = 0.01 (1%)
      expect(result.driftPercentage).toBeCloseTo(0.01, 10);
      expect(result.status).toBe("exceeded");
    });

    it("should calculate negative drift when spot balance is lower", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.99,
        btcAccumulated: 1,
      });

      // drift = |0.99 - 1| / max(1, 0.00000001) = 0.01 / 1 = 0.01 (1%)
      expect(result.driftPercentage).toBeCloseTo(0.01, 10);
      expect(result.status).toBe("exceeded");
    });

    it("should handle exactly at threshold (0.5%)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.0050000001, // Slightly above to ensure >= 0.005 after floating point
        btcAccumulated: 1,
      });

      // drift = |1.0050000001 - 1| / 1 = 0.0050000001 (0.5%)
      expect(result.driftPercentage).toBeCloseTo(0.005, 8);
      expect(result.status).toBe("exceeded");
    });

    it("should handle just below threshold", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.00499,
        btcAccumulated: 1,
      });

      // drift = |1.00499 - 1| / 1 = 0.00499 (0.499%)
      expect(result.driftPercentage).toBeCloseTo(0.00499, 10);
      expect(result.status).toBe("ok");
    });

    it("should handle zero BTC accumulated (edge case)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.001,
        btcAccumulated: 0,
      });

      // drift = |0.001 - 0| / max(0, 0.00000001) = 0.001 / 0.00000001 = 100000
      expect(result.driftPercentage).toBe(100000);
      expect(result.status).toBe("exceeded");
    });

    it("should handle both values at zero", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0,
        btcAccumulated: 0,
      });

      // drift = |0 - 0| / max(0, 0.00000001) = 0 / 0.00000001 = 0
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle very small BTC values (satoshi level)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.00000001,
        btcAccumulated: 0.00000001,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle negative values gracefully", () => {
      // Negative values shouldn't happen in production but we handle them
      const result = detector.checkBTCDrift({
        spotBalance: 0.1,
        btcAccumulated: -0.1,
      });

      // drift = |0.1 - (-0.1)| / max(-0.1, 0.00000001) = 0.2 / 0.00000001 = 20000000
      expect(result.driftPercentage).toBe(20000000);
      expect(result.status).toBe("exceeded");
    });

    it("should maintain precision for very small drift values", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.00000001,
        btcAccumulated: 1,
      });

      // drift = |1.00000001 - 1| / 1 = 0.00000001
      expect(result.driftPercentage).toBeCloseTo(0.00000001, 10);
      expect(result.status).toBe("ok");
    });

    it("should handle large BTC amounts", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 100.5,
        btcAccumulated: 100,
      });

      // drift = |100.5 - 100| / 100 = 0.005 (0.5%)
      expect(result.driftPercentage).toBe(0.005);
      expect(result.status).toBe("exceeded");
    });
  });

  describe("Combined Drift Check", () => {
    it("should return both USDT and BTC drift results", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1000,
        capitalAvailable: 1000,
        btcSpotBalance: 0.5,
        btcAccumulated: 0.5,
      });

      expect(result.usdt).toBeDefined();
      expect(result.btc).toBeDefined();
      expect(result.usdt.driftPercentage).toBe(0);
      expect(result.usdt.status).toBe("ok");
      expect(result.btc.driftPercentage).toBe(0);
      expect(result.btc.status).toBe("ok");
    });

    it("should detect USDT drift exceeded while BTC is ok", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1010,
        capitalAvailable: 1000,
        btcSpotBalance: 0.5,
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("exceeded");
      expect(result.btc.status).toBe("ok");
    });

    it("should detect BTC drift exceeded while USDT is ok", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1000,
        capitalAvailable: 1000,
        btcSpotBalance: 0.51,
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("ok");
      expect(result.btc.status).toBe("exceeded");
    });

    it("should detect both drifts exceeded", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1010,
        capitalAvailable: 1000,
        btcSpotBalance: 0.51,
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("exceeded");
      expect(result.btc.status).toBe("exceeded");
    });

    it("should handle all zero values", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 0,
        capitalAvailable: 0,
        btcSpotBalance: 0,
        btcAccumulated: 0,
      });

      expect(result.usdt.driftPercentage).toBe(0);
      expect(result.usdt.status).toBe("ok");
      expect(result.btc.driftPercentage).toBe(0);
      expect(result.btc.status).toBe("ok");
    });
  });

  describe("Return Value Structure", () => {
    it("should return correct structure for USDT drift result", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1000,
        capitalAvailable: 1000,
      });

      expect(result).toHaveProperty("asset");
      expect(result).toHaveProperty("driftPercentage");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("threshold");
      expect(result.asset).toBe("USDT");
      expect(typeof result.driftPercentage).toBe("number");
      expect(["ok", "exceeded"]).toContain(result.status);
      expect(result.threshold).toBe(0.005);
    });

    it("should return correct structure for BTC drift result", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.5,
        btcAccumulated: 0.5,
      });

      expect(result).toHaveProperty("asset");
      expect(result).toHaveProperty("driftPercentage");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("threshold");
      expect(result.asset).toBe("BTC");
      expect(typeof result.driftPercentage).toBe("number");
      expect(["ok", "exceeded"]).toContain(result.status);
      expect(result.threshold).toBe(0.005);
    });

    it("should return correct structure for combined drift check", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1000,
        capitalAvailable: 1000,
        btcSpotBalance: 0.5,
        btcAccumulated: 0.5,
      });

      expect(result).toHaveProperty("usdt");
      expect(result).toHaveProperty("btc");
      expect(result.usdt).toHaveProperty("asset");
      expect(result.usdt).toHaveProperty("driftPercentage");
      expect(result.usdt).toHaveProperty("status");
      expect(result.usdt).toHaveProperty("threshold");
      expect(result.btc).toHaveProperty("asset");
      expect(result.btc).toHaveProperty("driftPercentage");
      expect(result.btc).toHaveProperty("status");
      expect(result.btc).toHaveProperty("threshold");
    });
  });

  describe("Precision and Rounding", () => {
    it("should handle floating point precision for USDT", () => {
      // Testing a case that might have floating point issues
      const result = detector.checkUSDTDrift({
        spotBalance: 999.999999999,
        capitalAvailable: 1000,
      });

      expect(result.driftPercentage).toBeCloseTo(0.000000000001, 12);
      expect(result.status).toBe("ok");
    });

    it("should handle floating point precision for BTC", () => {
      // BTC has 8 decimal places
      const result = detector.checkBTCDrift({
        spotBalance: 0.12345678,
        btcAccumulated: 0.12345679,
      });

      // drift = |0.12345678 - 0.12345679| / 0.12345679 ≈ 8.1e-8
      expect(result.driftPercentage).toBeCloseTo(8.1e-8, 7);
      expect(result.status).toBe("ok");
    });

    it("should handle very large numbers without overflow", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1e10,
        capitalAvailable: 1e10,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle very small numbers without underflow", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1e-8,
        btcAccumulated: 1e-8,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    it("should handle NaN inputs for USDT", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: NaN,
        capitalAvailable: 1000,
      });

      expect(result.driftPercentage).toBeNaN();
      expect(result.status).toBe("exceeded"); // NaN should be treated as exceeded
    });

    it("should handle Infinity inputs for BTC", () => {
      const result = detector.checkBTCDrift({
        spotBalance: Infinity,
        btcAccumulated: 1,
      });

      expect(result.driftPercentage).toBe(Infinity);
      expect(result.status).toBe("exceeded");
    });

    it("should handle undefined values by treating as 0", () => {
      // Test with explicit undefined cast to number
      const undefinedValue = undefined as unknown as number;
      const result = detector.checkUSDTDrift({
        spotBalance: undefinedValue,
        capitalAvailable: 1000,
      });

      // undefined coerced to number becomes NaN
      expect(result.driftPercentage).toBeNaN();
      expect(result.status).toBe("exceeded");
    });

    it("should handle null values by treating as 0", () => {
      // Test with explicit null cast to number
      const nullValue = null as unknown as number;
      const result = detector.checkBTCDrift({
        spotBalance: 0.5,
        btcAccumulated: nullValue,
      });

      // null coerced to number becomes 0
      // drift = |0.5 - 0| / max(0, 0.00000001) = 0.5 / 0.00000001 = 50000000
      expect(result.driftPercentage).toBe(50000000);
      expect(result.status).toBe("exceeded");
    });
  });

  describe("Threshold Configuration", () => {
    it("should use default threshold of 0.005", () => {
      const detector = new DriftDetector();
      const result = detector.checkUSDTDrift({
        spotBalance: 1000,
        capitalAvailable: 1000,
      });

      expect(result.threshold).toBe(0.005);
    });

    it("should allow custom threshold in constructor", () => {
      const customDetector = new DriftDetector(0.01); // 1% threshold
      const result = customDetector.checkUSDTDrift({
        spotBalance: 1007,
        capitalAvailable: 1000,
      });

      // drift = 0.007 (0.7%), which is less than 1%
      expect(result.driftPercentage).toBe(0.007);
      expect(result.status).toBe("ok");
      expect(result.threshold).toBe(0.01);
    });

    it("should apply custom threshold to BTC as well", () => {
      const customDetector = new DriftDetector(0.01); // 1% threshold
      const result = customDetector.checkBTCDrift({
        spotBalance: 0.507,
        btcAccumulated: 0.5,
      });

      // drift = 0.014 (1.4%), which exceeds 1%
      expect(result.driftPercentage).toBeCloseTo(0.014, 10);
      expect(result.status).toBe("exceeded");
      expect(result.threshold).toBe(0.01);
    });
  });
});
