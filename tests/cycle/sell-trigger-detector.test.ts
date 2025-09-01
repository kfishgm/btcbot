import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { SellTriggerDetector } from "../../src/cycle/sell-trigger-detector";
import { logger } from "../../src/utils/logger";

// Import types that will be defined in the implementation
import type {
  CycleState,
  TradingConfig,
  Candle,
  BalanceInfo,
} from "../../src/cycle/sell-trigger-detector";

describe("SellTriggerDetector", () => {
  let detector: SellTriggerDetector;

  beforeEach(() => {
    detector = new SellTriggerDetector();
  });

  describe("Basic Sell Trigger Detection", () => {
    it("should trigger sell when price rises above threshold", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01, // Holding BTC
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03, // 3% rise
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 51600, // 3.2% above reference price (50000 * 1.03 = 51500)
        high: 51800,
        low: 51400,
        open: 51500,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.01); // Should sell all btc_accumulated
      expect(result.validations?.priceThresholdMet).toBe(true);
      expect(result.validations?.balanceSufficient).toBe(true);
      expect(result.validations?.driftCheck).toBe(true);
      expect(result.validations?.strategyActive).toBe(true);
    });

    it("should trigger sell exactly at threshold", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.005,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.025, // 2.5% rise
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 51250, // Exactly at threshold: 50000 * (1 + 0.025) = 51250
        high: 51300,
        low: 51200,
        open: 51220,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.005,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.005);
    });

    it("should not trigger sell when price is below threshold", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03, // 3% rise
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 51000, // Only 2% above reference price
        high: 51100,
        low: 50900,
        open: 50950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain(
        "Price 51000.00 below sell threshold 51500.00",
      );
      expect(result.validations?.priceThresholdMet).toBe(false);
    });
  });

  describe("Pre-Sell Validation Checks", () => {
    it("should skip sell when no BTC accumulated", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0, // No BTC to sell
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000, // Well above threshold
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("No BTC accumulated to sell");
    });

    it("should skip sell when insufficient BTC balance", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01, // Expecting 0.01 BTC
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.005, // Only 0.005 BTC available
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("Insufficient BTC balance");
      expect(result.validations?.balanceSufficient).toBe(false);
    });

    it("should skip sell when strategy is PAUSED", () => {
      const state: CycleState = {
        status: "PAUSED", // Strategy paused
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("Strategy is PAUSED");
      expect(result.validations?.strategyActive).toBe(false);
    });
  });

  describe("Drift Detection", () => {
    it("should skip sell when BTC drift exceeds threshold", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.0098, // 2% drift from btc_accumulated (0.01)
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain(
        "BTC drift 2.000% exceeds threshold 0.5%",
      );
      expect(result.validations?.driftCheck).toBe(false);
    });

    it("should pass drift check when within threshold", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01004, // 0.4% drift from btc_accumulated (0.01)
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.validations?.driftCheck).toBe(true);
    });

    it("should calculate drift correctly with zero BTC accumulated", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0.0001, // Small amount of BTC when expecting 0
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      // When btc_accumulated is 0, should skip with "No BTC accumulated" message
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("No BTC accumulated to sell");
    });

    it("should handle edge case of exact drift threshold", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.1,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.0995, // Exactly 0.5% drift
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      // Exactly at threshold should fail (>= check)
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain(
        "BTC drift 0.500% exceeds threshold 0.5%",
      );
    });
  });

  describe("Cycle Isolation", () => {
    it("should only sell btc_accumulated amount (cycle isolation)", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01, // Only 0.01 BTC from this cycle
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.05, // Account has more BTC from other sources
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.01); // Only sell cycle's BTC
      expect(result.sellAmount).not.toBe(0.05); // Should NOT sell all BTC in account
    });

    it("should not sell BTC from other sources", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.002, // Small amount from cycle
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 1.002, // Account has 1 BTC from other sources + 0.002 from cycle
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.002); // Only sell cycle amount
      // When shouldSell is true, there's no reason field
    });
  });

  describe("Decimal Precision and Edge Cases", () => {
    it("should handle high precision decimal calculations", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000.12345678,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.00123456789,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03, // 3%
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      // Sell threshold = 50000.12345678 * (1 + 0.03) = 51500.12716148
      const candle: Candle = {
        close: 51500.12716148, // Exactly at threshold
        high: 51600,
        low: 51400,
        open: 51450,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.00123456789,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.00123456789);
    });

    it("should handle null reference price", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: null, // No reference price set
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("Reference price is not set");
    });

    it("should handle very large numbers", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 1000000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 1.5,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.05, // 5%
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 1060000, // 6% rise
        high: 1070000,
        low: 1055000,
        open: 1058000,
        volume: 1000,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 1.5,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(1.5);
    });

    it("should handle very small percentages", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.001, // 0.1% rise
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 50060, // 0.12% rise
        high: 50100,
        low: 50040,
        open: 50050,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
    });

    it("should handle very small BTC amounts", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.0002, // Very small BTC amount
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.0002,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.0002);
    });
  });

  describe("Complete Sell Decision Flow", () => {
    it("should return detailed validation results for successful sell", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01002, // Slight positive drift within threshold
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result).toEqual({
        shouldSell: true,
        sellAmount: 0.01,
        validations: {
          strategyActive: true,
          hasAccumulatedBTC: true,
          priceThresholdMet: true,
          balanceSufficient: true,
          driftCheck: true,
          minNotionalMet: true,
        },
      });
    });

    it("should provide clear skip reason for each validation failure", () => {
      const baseState: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const baseConfig: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const baseCandle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const baseBalances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      // Test 1: Price threshold not met
      let result = detector.checkSellTrigger(
        baseState,
        baseConfig,
        { ...baseCandle, close: 51000 },
        baseBalances,
      );
      expect(result.reason).toContain(
        "Price 51000.00 below sell threshold 51500.00",
      );

      // Test 2: No BTC accumulated
      result = detector.checkSellTrigger(
        { ...baseState, btc_accumulated: 0 },
        baseConfig,
        baseCandle,
        baseBalances,
      );
      expect(result.reason).toContain("No BTC accumulated to sell");

      // Test 3: Strategy paused
      result = detector.checkSellTrigger(
        { ...baseState, status: "PAUSED" },
        baseConfig,
        baseCandle,
        baseBalances,
      );
      expect(result.reason).toContain("Strategy is PAUSED");

      // Test 4: Insufficient BTC balance
      result = detector.checkSellTrigger(baseState, baseConfig, baseCandle, {
        ...baseBalances,
        btcSpot: 0.005,
      });
      expect(result.reason).toContain(
        "Insufficient BTC balance: 0.00500000 < 0.01000000 BTC",
      );

      // Test 5: Drift exceeded
      result = detector.checkSellTrigger(baseState, baseConfig, baseCandle, {
        ...baseBalances,
        btcSpot: 0.0098,
      });
      expect(result.reason).toContain(
        "BTC drift 2.000% exceeds threshold 0.5%",
      );
    });
  });

  describe("STRATEGY.md Compliance", () => {
    it("should follow exact sell condition formula from STRATEGY.md", () => {
      // STRATEGY.md: if (btc_accumulated > 0 AND Close >= reference_price * (1 + %Rise))
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 60000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.015,
      };

      const config: TradingConfig = {
        dropPercentage: 0.03,
        risePercentage: 0.04, // 4%
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      // Sell threshold = 60000 * (1 + 0.04) = 62400
      const testCases = [
        { close: 62400, shouldSell: true }, // Exactly at threshold
        { close: 62401, shouldSell: true }, // Above threshold
        { close: 62399, shouldSell: false }, // Below threshold
        { close: 63000, shouldSell: true }, // Well above threshold
        { close: 61000, shouldSell: false }, // Well below threshold
      ];

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.015,
      };

      testCases.forEach(({ close, shouldSell }) => {
        const candle: Candle = {
          close,
          high: close + 100,
          low: close - 100,
          open: close,
          volume: 100,
          timestamp: Date.now(),
        };

        const result = detector.checkSellTrigger(
          state,
          config,
          candle,
          balances,
        );
        expect(result.shouldSell).toBe(shouldSell);
      });
    });

    it("should validate drift per STRATEGY.md formula", () => {
      // STRATEGY.md: drift_btc = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.1,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      // Test various drift scenarios
      const driftTests = [
        { btcSpot: 0.1, expectedDrift: 0, shouldSell: true },
        { btcSpot: 0.1004, expectedDrift: 0.004, shouldSell: true },
        { btcSpot: 0.0995, expectedDrift: 0.005, shouldSell: false }, // Exactly at threshold
        { btcSpot: 0.0994, expectedDrift: 0.006, shouldSell: false },
        { btcSpot: 0.101, expectedDrift: 0.01, shouldSell: false },
      ];

      driftTests.forEach(({ btcSpot, expectedDrift, shouldSell }) => {
        const balances: BalanceInfo = {
          usdtSpot: 0,
          btcSpot,
        };

        const result = detector.checkSellTrigger(
          state,
          config,
          candle,
          balances,
        );
        expect(result.shouldSell).toBe(shouldSell);

        if (!shouldSell && expectedDrift >= 0.005) {
          expect(result.reason).toContain(`BTC drift`);
          expect(result.reason).toContain(`exceeds threshold`);
        }
      });
    });

    it("should validate all pre-sell conditions in correct order", () => {
      // Per STRATEGY.md execution order
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      // Verify all checks pass in correct order
      expect(result.validations).toEqual({
        strategyActive: true,
        hasAccumulatedBTC: true,
        priceThresholdMet: true,
        balanceSufficient: true,
        driftCheck: true,
        minNotionalMet: true,
      });
    });

    it("should always sell 100% of btc_accumulated (never partial)", () => {
      // STRATEGY.md: SELL ALL btc_accumulated  // NEVER partial, always 100% of cycle BTC
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.025678, // Specific amount accumulated
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.125678, // Has extra BTC from other sources
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.025678); // Exactly btc_accumulated
      // Should never be a partial amount or percentage
      expect(result.sellAmount).not.toBe(0.025678 * 0.5); // Not 50%
      expect(result.sellAmount).not.toBe(0.025678 * 0.75); // Not 75%
      expect(result.sellAmount).not.toBe(0.125678); // Not all BTC in account
    });
  });

  describe("Logging and Monitoring", () => {
    it("should log decision when sell is triggered", () => {
      const loggerSpy = jest.spyOn(logger, "info").mockImplementation(() => {});

      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      detector.checkSellTrigger(state, config, candle, balances);

      expect(loggerSpy).toHaveBeenCalledWith(
        "SELL TRIGGERED",
        expect.objectContaining({
          module: "SellTriggerDetector",
          price: 52000,
          threshold: 51500,
          amount: 0.01,
        }),
      );

      loggerSpy.mockRestore();
    });

    it("should not log when sell is not triggered", () => {
      const loggerSpy = jest.spyOn(logger, "info").mockImplementation(() => {});

      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      // No log should be called when sell is skipped
      expect(loggerSpy).not.toHaveBeenCalled();
      // But the reason should be in the result
      expect(result.reason).toContain("No BTC accumulated");

      loggerSpy.mockRestore();
    });
  });

  describe("Helper Methods", () => {
    it("should calculate sell threshold correctly", () => {
      const referencePrice = 50000;
      const risePercentage = 0.035; // 3.5%

      const threshold = detector.calculateSellThreshold(
        referencePrice,
        risePercentage,
      );

      expect(threshold).toBeCloseTo(51750, 2); // 50000 * (1 + 0.035)
    });

    it("should calculate BTC drift correctly", () => {
      const testCases = [
        {
          spotBalance: 0.1,
          stateBalance: 0.1,
          expectedDrift: 0,
        },
        {
          spotBalance: 0.105,
          stateBalance: 0.1,
          expectedDrift: 0.05,
        },
        {
          spotBalance: 0.095,
          stateBalance: 0.1,
          expectedDrift: 0.05,
        },
        {
          spotBalance: 0.0001,
          stateBalance: 0,
          expectedDrift: 10000, // |0.0001 - 0| / max(0, 0.00000001)
        },
        {
          spotBalance: 0,
          stateBalance: 0,
          expectedDrift: 0,
        },
      ];

      testCases.forEach(({ spotBalance, stateBalance, expectedDrift }) => {
        const drift = detector.calculateDrift(spotBalance, stateBalance);
        expect(drift).toBeCloseTo(expectedDrift, 10);
      });
    });

    it("should format BTC amount for logging", () => {
      const testCases = [
        { amount: 0.01, expected: "0.01000000" },
        { amount: 0.12345678, expected: "0.12345678" },
        { amount: 1, expected: "1.00000000" },
        { amount: 0.00000001, expected: "0.00000001" },
      ];

      testCases.forEach(({ amount, expected }) => {
        const formatted = detector.formatBTC(amount);
        expect(formatted).toBe(expected);
      });
    });

    it("should check if strategy is active", () => {
      expect(detector.isStrategyActive("READY")).toBe(true);
      expect(detector.isStrategyActive("HOLDING")).toBe(true);
      expect(detector.isStrategyActive("PAUSED")).toBe(false);
    });
  });

  describe("Public Interface Methods", () => {
    it("should provide simplified interface via shouldExecuteSell", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const shouldSell = detector.shouldExecuteSell(
        state,
        config,
        candle,
        balances,
      );

      expect(shouldSell).toBe(true);
    });

    it("should provide validation details for debugging", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000,
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const validations = detector.getValidationDetails(
        state,
        config,
        candle,
        balances,
      );

      expect(validations).toEqual({
        strategyActive: true,
        hasAccumulatedBTC: true,
        priceThresholdMet: true,
        balanceSufficient: true,
        driftCheck: true,
        minNotionalMet: true,
      });
    });

    it("should check if conditions would trigger a sell at specific price", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      // Test at different prices
      expect(detector.wouldTriggerAtPrice(state, config, 51500, balances)).toBe(
        true,
      ); // At threshold
      expect(detector.wouldTriggerAtPrice(state, config, 52000, balances)).toBe(
        true,
      ); // Above threshold
      expect(detector.wouldTriggerAtPrice(state, config, 51000, balances)).toBe(
        false,
      ); // Below threshold
    });

    it("should get the next sell threshold price", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 60000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.04, // 4%
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const threshold = detector.getNextSellThreshold(state, config);

      expect(threshold).toBe(62400); // 60000 * 1.04
    });

    it("should return null threshold when no reference price", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: null,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const threshold = detector.getNextSellThreshold(state, config);

      expect(threshold).toBeNull();
    });

    it("should validate state for sell trigger detection", () => {
      const validState: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      let result = detector.validateState(validState);
      expect(result.isValid).toBe(true);

      // Test invalid states
      result = detector.validateState({
        ...validState,
        btc_accumulated: -0.01,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Negative BTC accumulated");

      result = detector.validateState({
        ...validState,
        reference_price: -50000,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Negative reference price");

      result = detector.validateState({
        ...validState,
        capital_available: -100,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Negative capital available");
    });

    it("should validate configuration for sell trigger detection", () => {
      const validConfig: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      let result = detector.validateConfig(validConfig);
      expect(result.isValid).toBe(true);

      // Test invalid configs
      result = detector.validateConfig({
        ...validConfig,
        risePercentage: -0.03,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Rise percentage must be between 0 and 1");

      result = detector.validateConfig({
        ...validConfig,
        risePercentage: 1.5,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Rise percentage must be between 0 and 1");

      result = detector.validateConfig({
        ...validConfig,
        driftThresholdPct: -0.005,
      });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Drift threshold must be between 0 and 1");
    });

    it("should get sell amount for the cycle", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.02345678, // Specific amount
      };

      const amount = detector.getSellAmount(state);

      expect(amount).toBe(0.02345678); // Always returns btc_accumulated
    });
  });

  describe("Skip Conditions", () => {
    it("should skip sell when status is READY (not holding)", () => {
      const state: CycleState = {
        status: "READY", // Not in HOLDING status
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0, // No BTC yet
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000, // Price would trigger sell if holding
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("No BTC accumulated to sell");
    });

    it("should skip sell when minimum notional not met", () => {
      const state: CycleState = {
        status: "HOLDING",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.0001, // Very small amount
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10, // $10 minimum
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 52000, // Would trigger sell
        high: 52100,
        low: 51900,
        open: 51950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.0001,
      };

      const result = detector.checkSellTrigger(state, config, candle, balances);

      // 0.0001 BTC * $52000 = $5.20 < $10 minimum
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain(
        "Notional value 5.20 below minimum 10.00",
      );
    });
  });
});
