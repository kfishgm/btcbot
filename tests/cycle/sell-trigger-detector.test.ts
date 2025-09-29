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
    it("should trigger sell when price rises above threshold", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01, // Holding BTC
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03, // 3% rise
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.01); // Should sell all btc_accumulated
      expect(result.validations?.priceThresholdMet).toBe(true);
      // balanceSufficient removed - no longer checked
      expect(result.validations?.strategyActive).toBe(true);
    });

    it("should trigger sell exactly at threshold", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.005,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.025, // 2.5% rise
        exchangeMinNotional: 10,
      };

      const candle: Candle = {
        close: 51302, // At threshold with commission: (50000 * 1.025) / 0.999 = 51301.3
        high: 51350,
        low: 51250,
        open: 51280,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.005,
      };

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.005);
    });

    it("should not trigger sell when price is below threshold", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03, // 3% rise
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("below sell threshold");
      expect(result.validations?.priceThresholdMet).toBe(false);
    });
  });

  describe("Pre-Sell Validation Checks", () => {
    it("should skip sell when no BTC accumulated", async () => {
      const state: CycleState = {
        status: "READY",
        sell_reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0, // No BTC to sell
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("No BTC accumulated to sell");
    });

    it("should skip sell when insufficient BTC balance", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01, // Expecting 0.01 BTC
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // Should still trigger - insufficient balance handled by retry logic
      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.01);
      // balanceSufficient removed - insufficient balance handled by retry logic
    });

    it("should skip sell when strategy is PAUSED", async () => {
      const state: CycleState = {
        status: "PAUSED", // Strategy paused
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("Strategy is PAUSED");
      expect(result.validations?.strategyActive).toBe(false);
    });
  });

  describe("Drift Detection", () => {
    it("should skip sell when BTC drift exceeds threshold (insufficient BTC)", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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
        btcSpot: 0.0098, // 2% insufficient BTC (less than accumulated)
      };

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // Drift no longer blocks trades - retry logic handles balance mismatch
      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.01);
    });

    it("should pass drift check when within threshold", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
    });

    it("should pass drift check with excess BTC (dust amounts)", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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
        btcSpot: 0.01000876, // Excess BTC (dust amount like after sells)
      };

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true); // Should sell (excess BTC is OK)
    });

    it("should calculate drift correctly with zero BTC accumulated", async () => {
      const state: CycleState = {
        status: "READY",
        sell_reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // When btc_accumulated is 0, should skip with "No BTC accumulated" message
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("No BTC accumulated to sell");
    });

    it("should handle edge case of exact drift threshold", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.1,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // Drift no longer blocks trades
      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.1); // Should sell full accumulated amount
    });
  });

  describe("Cycle Isolation", () => {
    it("should only sell btc_accumulated amount (cycle isolation)", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01, // Only 0.01 BTC from this cycle
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.01); // Only sell cycle's BTC
      expect(result.sellAmount).not.toBe(0.05); // Should NOT sell all BTC in account
    });

    it("should not sell BTC from other sources", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.002, // Small amount from cycle
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.002); // Only sell cycle amount
      // When shouldSell is true, there's no reason field
    });
  });

  describe("Decimal Precision and Edge Cases", () => {
    it("should handle high precision decimal calculations", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000.12345678,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.00123456789,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03, // 3%
        exchangeMinNotional: 10,
      };

      // Sell threshold with commission = (50000.12345678 * 1.03) / 0.999 = 51551.67839...
      const candle: Candle = {
        close: 51551.68, // At/above threshold with commission
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.00123456789);
    });

    it("should handle null reference price", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: null, // No reference price set
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("Average cost is not set");
    });

    it("should handle very large numbers", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 1000000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 1.5,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.05, // 5%
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(1.5);
    });

    it("should handle very small percentages", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.001, // 0.1% rise
        exchangeMinNotional: 10,
      };

      const candle: Candle = {
        close: 50101, // With commission: (50000 * 1.001) / 0.999 = 50100.1, so need > 50100
        high: 50150,
        low: 50040,
        open: 50050,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
    });

    it("should handle very small BTC amounts", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.0002, // Very small BTC amount
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.0002);
    });
  });

  describe("Complete Sell Decision Flow", () => {
    it("should return detailed validation results for successful sell", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result).toEqual({
        shouldSell: true,
        sellAmount: 0.01,
        validations: {
          strategyActive: true,
          hasAccumulatedBTC: true,
          priceThresholdMet: true,
          minNotionalMet: true,
        },
      });
    });

    it("should provide clear skip reason for each validation failure", async () => {
      const baseState: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const baseConfig: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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
      let result = await detector.checkSellTrigger(
        baseState,
        baseConfig,
        { ...baseCandle, close: 51000 },
        baseBalances,
      );
      expect(result.reason).toContain("below sell threshold");

      // Test 2: No BTC accumulated
      result = await detector.checkSellTrigger(
        { ...baseState, btc_accumulated: 0 },
        baseConfig,
        baseCandle,
        baseBalances,
      );
      expect(result.reason).toContain("No BTC accumulated to sell");

      // Test 3: Strategy paused
      result = await detector.checkSellTrigger(
        { ...baseState, status: "PAUSED" },
        baseConfig,
        baseCandle,
        baseBalances,
      );
      expect(result.reason).toContain("Strategy is PAUSED");

      // Test 4: Insufficient balance now handled by retry logic
      // (no longer blocks the sell trigger)
      result = await detector.checkSellTrigger(
        baseState,
        baseConfig,
        baseCandle,
        {
          ...baseBalances,
          btcSpot: 0.005,
        },
      );
      // Should still trigger - retry logic handles insufficient balance
      expect(result.shouldSell).toBe(true);

      // Test 5: Drift no longer blocks trades
      result = await detector.checkSellTrigger(
        baseState,
        baseConfig,
        baseCandle,
        {
          ...baseBalances,
          btcSpot: 0.0098,
        },
      );
      // Should still trigger - drift handled by retry logic
      expect(result.shouldSell).toBe(true);
    });
  });

  describe("STRATEGY.md Compliance", () => {
    it("should follow exact sell condition formula from STRATEGY.md", async () => {
      // STRATEGY.md: if (btc_accumulated > 0 AND Close >= sell_reference_price * (1 + %Rise))
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 60000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.015,
      };

      const config: TradingConfig = {
        dropPercentage: 0.03,
        risePercentage: 0.04, // 4%
        exchangeMinNotional: 10,
      };

      // Sell threshold with 0.1% commission = (60000 * 1.04) / 0.999 = 62462.46
      const testCases = [
        { close: 62463, shouldSell: true }, // At/above threshold
        { close: 62500, shouldSell: true }, // Above threshold
        { close: 62462, shouldSell: false }, // Just below threshold
        { close: 63000, shouldSell: true }, // Well above threshold
        { close: 61000, shouldSell: false }, // Well below threshold
      ];

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.015,
      };

      for (const { close, shouldSell: expected } of testCases) {
        const candle: Candle = {
          close,
          high: close + 100,
          low: close - 100,
          open: close,
          volume: 100,
          timestamp: Date.now(),
        };

        const result = await detector.checkSellTrigger(
          state,
          config,
          candle,
          balances,
        );
        expect(result.shouldSell).toBe(expected);
      }
    });

    // Drift test removed - drift no longer blocks trades, handled by retry logic

    it("should validate all pre-sell conditions in correct order", async () => {
      // Per STRATEGY.md execution order
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // Verify all checks pass in correct order (drift/balance checks removed)
      expect(result.validations).toEqual({
        strategyActive: true,
        hasAccumulatedBTC: true,
        priceThresholdMet: true,
        minNotionalMet: true,
      });
    });

    it("should always sell 100% of btc_accumulated (never partial)", async () => {
      // STRATEGY.md: SELL ALL btc_accumulated  // NEVER partial, always 100% of cycle BTC
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.025678, // Specific amount accumulated
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(true);
      expect(result.sellAmount).toBe(0.025678); // Exactly btc_accumulated
      // Should never be a partial amount or percentage
      expect(result.sellAmount).not.toBe(0.025678 * 0.5); // Not 50%
      expect(result.sellAmount).not.toBe(0.025678 * 0.75); // Not 75%
      expect(result.sellAmount).not.toBe(0.125678); // Not all BTC in account
    });
  });

  describe("Logging and Monitoring", () => {
    it("should log decision when sell is triggered", async () => {
      const loggerSpy = jest.spyOn(logger, "info").mockImplementation(() => {});

      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      await detector.checkSellTrigger(state, config, candle, balances);

      expect(loggerSpy).toHaveBeenCalledWith(
        "SELL TRIGGERED",
        expect.objectContaining({
          module: "SellTriggerDetector",
          price: 52000,
          amount: 0.01,
        }),
      );

      loggerSpy.mockRestore();
    });

    it("should not log when sell is not triggered", async () => {
      const loggerSpy = jest.spyOn(logger, "info").mockImplementation(() => {});

      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0, // No BTC, so should not trigger
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
      };

      const candle: Candle = {
        close: 51000, // Changed to be below sell threshold
        high: 51100,
        low: 50900,
        open: 50950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0,
      };

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // No SELL TRIGGERED log should be called when sell is skipped
      expect(loggerSpy).not.toHaveBeenCalledWith(
        "SELL TRIGGERED",
        expect.anything(),
      );
      // But the reason should be in the result
      expect(result.reason).toContain("No BTC accumulated");

      loggerSpy.mockRestore();
    });
  });

  describe("Helper Methods", () => {
    it("should calculate sell threshold correctly", async () => {
      const referencePrice = 50000;
      const risePercentage = 0.035; // 3.5%

      const threshold = await detector.calculateSellThreshold(
        referencePrice,
        risePercentage,
      );

      // With default 0.1% commission: (50000 * 1.035) / (1 - 0.001) = 51801.8
      expect(threshold).toBeCloseTo(51801.8, 1);
    });

    // Drift calculation test removed - drift no longer blocks trades

    it("should format BTC amount for logging", async () => {
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

    it("should check if strategy is active", async () => {
      expect(detector.isStrategyActive("READY")).toBe(true);
      expect(detector.isStrategyActive("HOLDING")).toBe(true);
      expect(detector.isStrategyActive("PAUSED")).toBe(false);
    });
  });

  describe("Public Interface Methods", () => {
    it("should provide simplified interface via shouldExecuteSell", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const shouldSell = await detector.shouldExecuteSell(
        state,
        config,
        candle,
        balances,
      );

      expect(shouldSell).toBe(true);
    });

    it("should provide validation details for debugging", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const validations = await detector.getValidationDetails(
        state,
        config,
        candle,
        balances,
      );

      expect(validations).toEqual({
        strategyActive: true,
        hasAccumulatedBTC: true,
        priceThresholdMet: true,
        minNotionalMet: true,
      });
    });

    it("should check if conditions would trigger a sell at specific price", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
      };

      const balances: BalanceInfo = {
        usdtSpot: 0,
        btcSpot: 0.01,
      };

      // Test at different prices (with 0.1% commission: threshold = (50000 * 1.03) / 0.999 = 51551.55)
      expect(
        await detector.wouldTriggerAtPrice(state, config, 51552, balances),
      ).toBe(true); // At/above threshold
      expect(
        await detector.wouldTriggerAtPrice(state, config, 52000, balances),
      ).toBe(true); // Above threshold
      expect(
        await detector.wouldTriggerAtPrice(state, config, 51551, balances),
      ).toBe(false); // Just below threshold
    });

    it("should get the next sell threshold price", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 60000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.04, // 4%
        exchangeMinNotional: 10,
      };

      const threshold = await detector.getNextSellThreshold(state, config);

      // With 0.1% commission: (60000 * 1.04) / (1 - 0.001) = 62462.46
      expect(threshold).toBeCloseTo(62462.46, 2);
    });

    it("should return null threshold when no reference price", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: null,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.01,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
      };

      const threshold = await detector.getNextSellThreshold(state, config);

      expect(threshold).toBeNull();
    });

    it("should validate state for sell trigger detection", async () => {
      const validState: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
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
        sell_reference_price: -50000,
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

    it("should validate configuration for sell trigger detection", async () => {
      const validConfig: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      // Drift threshold test removed - no longer used
    });

    it("should get sell amount for the cycle", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.02345678, // Specific amount
      };

      const amount = detector.getSellAmount(state);

      expect(amount).toBe(0.02345678); // Always returns btc_accumulated
    });
  });

  describe("Skip Conditions", () => {
    it("should skip sell when status is READY (not holding)", async () => {
      const state: CycleState = {
        status: "READY", // Not in HOLDING status
        sell_reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0, // No BTC yet
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10,
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain("No BTC accumulated to sell");
    });

    it("should skip sell when minimum notional not met", async () => {
      const state: CycleState = {
        status: "HOLDING",
        sell_reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 0,
        btc_accumulated: 0.0001, // Very small amount
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        exchangeMinNotional: 10, // $10 minimum
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

      const result = await detector.checkSellTrigger(
        state,
        config,
        candle,
        balances,
      );

      // 0.0001 BTC * $52000 = $5.20 < $10 minimum
      expect(result.shouldSell).toBe(false);
      expect(result.reason).toContain(
        "Notional value 5.20 below minimum 10.00",
      );
    });
  });
});
