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

    it("should NOT detect drift when spot balance is higher (excess funds OK)", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1010,
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 1010)) / max(1000, 1) = 0 / 1000 = 0%
      // Excess funds are allowed
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
      expect(result.asset).toBe("USDT");
    });

    it("should detect drift when insufficient funds (spot < capital)", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 990,
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 990)) / max(1000, 1) = 10 / 1000 = 0.01 (1%)
      expect(result.driftPercentage).toBe(0.01);
      expect(result.status).toBe("exceeded");
    });

    it("should NOT detect drift when excess funds (spot > capital)", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1005,
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 1005)) / 1000 = 0 / 1000 = 0%
      // Excess funds are allowed
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should NOT detect drift with large excess funds", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 10000,
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 10000)) / 1000 = 0 / 1000 = 0%
      // Large excess is still OK
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle zero capital available with excess funds", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 10,
        capitalAvailable: 0,
      });

      // drift = max(0, (0 - 10)) / max(0, 1) = 0 / 1 = 0
      // When capital_available is 0, any positive spot balance is excess
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle both values at zero", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 0,
        capitalAvailable: 0,
      });

      // drift = max(0, (0 - 0)) / max(0, 1) = 0 / 1 = 0
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should detect drift at exactly 0.5% threshold", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 995,
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 995)) / 1000 = 5 / 1000 = 0.005 (0.5%)
      expect(result.driftPercentage).toBe(0.005);
      expect(result.status).toBe("exceeded"); // >= 0.005 triggers
    });

    it("should handle very small capital values", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 0.01,
        capitalAvailable: 0.01,
      });

      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle negative capital values gracefully", () => {
      // Negative values shouldn't happen in production but we handle them
      const result = detector.checkUSDTDrift({
        spotBalance: 100,
        capitalAvailable: -100,
      });

      // drift = max(0, (-100 - 100)) / max(-100, 1) = 0 / 1 = 0
      // With negative capital, positive spot balance is still treated as excess
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should maintain precision for small excess amounts", () => {
      const result = detector.checkUSDTDrift({
        spotBalance: 1000.001,
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 1000.001)) / 1000 = 0 / 1000 = 0
      // Small excess is still OK
      expect(result.driftPercentage).toBe(0);
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

    it("should NOT detect drift when spot balance is higher (excess BTC OK)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.01,
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 1.01)) / max(1, 0.00000001) = 0 / 1 = 0%
      // Excess BTC is allowed (like dust amounts)
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should detect drift when insufficient BTC (spot < accumulated)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.99,
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 0.99)) / max(1, 0.00000001) = 0.01 / 1 = 0.01 (1%)
      expect(result.driftPercentage).toBeCloseTo(0.01, 10);
      expect(result.status).toBe("exceeded");
    });

    it("should NOT detect drift with excess at threshold (0.5%)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.0050000001, // Excess BTC
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 1.0050000001)) / 1 = 0 / 1 = 0%
      // Excess is OK, no drift
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should detect drift at exactly 0.5% threshold when insufficient", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.995,
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 0.995)) / 1 = 0.005 / 1 = 0.005 (0.5%)
      expect(result.driftPercentage).toBeCloseTo(0.005, 10);
      expect(result.status).toBe("exceeded"); // >= 0.005 triggers
    });

    it("should handle just below threshold when insufficient", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.99501,
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 0.99501)) / 1 = 0.00499 (0.499%)
      expect(result.driftPercentage).toBeCloseTo(0.00499, 10);
      expect(result.status).toBe("ok");
    });

    it("should handle zero BTC accumulated with excess (edge case)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.001,
        btcAccumulated: 0,
      });

      // drift = max(0, (0 - 0.001)) / max(0, 0.00000001) = 0 / 0.00000001 = 0
      // When accumulated is 0, any positive spot balance is excess
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
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

      // drift = max(0, (-0.1 - 0.1)) / max(-0.1, 0.00000001) = 0 / 0.00000001 = 0
      // With negative accumulated, positive spot balance is treated as excess
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should handle dust amounts (very small excess BTC)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 1.00000876, // Dust amount excess
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 1.00000876)) / 1 = 0 / 1 = 0
      // Dust amounts are OK
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should maintain precision for very small insufficient amounts", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 0.99999999,
        btcAccumulated: 1,
      });

      // drift = max(0, (1 - 0.99999999)) / 1 = 0.00000001
      expect(result.driftPercentage).toBeCloseTo(0.00000001, 10);
      expect(result.status).toBe("ok");
    });

    it("should NOT detect drift with large excess BTC amounts", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 100.5,
        btcAccumulated: 100,
      });

      // drift = max(0, (100 - 100.5)) / 100 = 0 / 100 = 0%
      // Excess is OK
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
    });

    it("should detect drift with large insufficient BTC amounts", () => {
      const result = detector.checkBTCDrift({
        spotBalance: 99.5,
        btcAccumulated: 100,
      });

      // drift = max(0, (100 - 99.5)) / 100 = 0.5 / 100 = 0.005 (0.5%)
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

    it("should detect USDT drift exceeded (insufficient) while BTC is ok", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 990, // Insufficient funds
        capitalAvailable: 1000,
        btcSpotBalance: 0.5,
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("exceeded");
      expect(result.btc.status).toBe("ok");
    });

    it("should NOT detect BTC drift with excess while USDT is ok", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1000,
        capitalAvailable: 1000,
        btcSpotBalance: 0.51, // Excess BTC
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("ok");
      expect(result.btc.status).toBe("ok"); // Excess is OK
    });

    it("should detect BTC drift with insufficient while USDT is ok", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 1000,
        capitalAvailable: 1000,
        btcSpotBalance: 0.49, // Insufficient BTC
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("ok");
      expect(result.btc.status).toBe("exceeded"); // Insufficient triggers drift
    });

    it("should detect only USDT drift when both have issues", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 990, // Insufficient USDT
        capitalAvailable: 1000,
        btcSpotBalance: 0.51, // Excess BTC (OK)
        btcAccumulated: 0.5,
      });

      expect(result.usdt.status).toBe("exceeded");
      expect(result.btc.status).toBe("ok"); // Excess BTC is OK
    });

    it("should detect both drifts exceeded when both insufficient", () => {
      const result = detector.checkDrift({
        usdtSpotBalance: 990, // Insufficient USDT
        capitalAvailable: 1000,
        btcSpotBalance: 0.49, // Insufficient BTC
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

    it("should handle Infinity inputs for BTC as excess (OK)", () => {
      const result = detector.checkBTCDrift({
        spotBalance: Infinity,
        btcAccumulated: 1,
      });

      // Infinity spot balance means excess, which is OK
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
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
      // drift = max(0, (0 - 0.5)) / max(0, 0.00000001) = 0 / 0.00000001 = 0
      // When accumulated is 0, positive spot balance is excess (OK)
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
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
        spotBalance: 1007, // Excess funds
        capitalAvailable: 1000,
      });

      // drift = max(0, (1000 - 1007)) / 1000 = 0 (excess is OK)
      expect(result.driftPercentage).toBe(0);
      expect(result.status).toBe("ok");
      expect(result.threshold).toBe(0.01);
    });

    it("should apply custom threshold to BTC as well", () => {
      const customDetector = new DriftDetector(0.01); // 1% threshold

      // Test with excess (should be OK)
      const excessResult = customDetector.checkBTCDrift({
        spotBalance: 0.507, // Excess BTC
        btcAccumulated: 0.5,
      });
      expect(excessResult.driftPercentage).toBe(0);
      expect(excessResult.status).toBe("ok");
      expect(excessResult.threshold).toBe(0.01);

      // Test with insufficient exceeding 1%
      const insufficientResult = customDetector.checkBTCDrift({
        spotBalance: 0.493, // 1.4% insufficient
        btcAccumulated: 0.5,
      });
      // drift = max(0, (0.5 - 0.493)) / 0.5 = 0.007 / 0.5 = 0.014 (1.4%)
      expect(insufficientResult.driftPercentage).toBeCloseTo(0.014, 10);
      expect(insufficientResult.status).toBe("exceeded");
      expect(insufficientResult.threshold).toBe(0.01);
    });
  });
});
