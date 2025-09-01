import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { BuyTriggerDetector } from "../../src/cycle/buy-trigger-detector";
import { BuyAmountCalculator } from "../../src/cycle/buy-amount-calculator";

// Import types from the implementation
import type {
  CycleState,
  TradingConfig,
  Candle,
  BalanceInfo,
} from "../../src/cycle/buy-trigger-detector";

describe("BuyTriggerDetector", () => {
  let detector: BuyTriggerDetector;
  let mockBuyAmountCalculator: jest.Mocked<BuyAmountCalculator>;

  beforeEach(() => {
    // Create mock dependencies with proper typing
    mockBuyAmountCalculator = {
      calculateInitialBuyAmount: jest.fn(),
      calculateBuyAmount: jest.fn(),
      getPurchaseAmount: jest.fn(),
      isAmountValid: jest.fn(),
      getSkipReason: jest.fn(),
      floorToPrecision: jest.fn(),
      shouldSkipPurchase: jest.fn(),
      getPurchaseDecision: jest.fn(),
      extractMinNotional: jest.fn(),
      setConfig: jest.fn(),
      getConfig: jest.fn(),
      setExchangeMinNotional: jest.fn(),
      getExchangeMinNotional: jest.fn(),
      calculateRegularBuyAmount: jest.fn(),
      calculateLastBuyAmount: jest.fn(),
      validateBuyAmount: jest.fn(),
      reset: jest.fn(),
    } as unknown as jest.Mocked<BuyAmountCalculator>;

    detector = new BuyTriggerDetector(mockBuyAmountCalculator);
  });

  describe("Basic Buy Trigger Detection", () => {
    it("should trigger buy when price drops below threshold", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02, // 2% drop
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48900, // 2.2% below reference price (50000 * 0.98 = 49000)
        high: 49500,
        low: 48800,
        open: 49200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(100);
      expect(result.validations?.priceThresholdMet).toBe(true);
      expect(result.validations?.capitalAvailable).toBe(true);
      expect(result.validations?.driftCheck).toBe(true);
      expect(result.validations?.strategyActive).toBe(true);
      expect(result.validations?.amountValid).toBe(true);
    });

    it("should trigger buy exactly at threshold", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 3,
        capital_available: 300,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.025, // 2.5% drop
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48750, // Exactly at threshold: 50000 * (1 - 0.025) = 48750
        high: 49000,
        low: 48700,
        open: 48900,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 300,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(100);
    });

    it("should not trigger buy when price is above threshold", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02, // 2% drop
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 49500, // Only 1% below reference price
        high: 50000,
        low: 49400,
        open: 49800,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain(
        "Price 49500.00 above buy threshold 49000.00",
      );
      expect(result.validations?.priceThresholdMet).toBe(false);
    });
  });

  describe("Pre-Buy Validation Checks", () => {
    it("should skip buy when no purchases remaining", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 0, // No purchases left
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000, // Well below threshold
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("No purchases remaining");
    });

    it("should skip buy when insufficient capital", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 50, // Less than buy_amount
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 50,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("Insufficient capital");
      expect(result.validations?.capitalAvailable).toBe(false);
    });

    it("should skip buy when strategy is PAUSED", () => {
      const state: CycleState = {
        status: "PAUSED", // Strategy paused
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("Strategy is PAUSED");
      expect(result.validations?.strategyActive).toBe(false);
    });

    it("should skip buy when amount below minimum", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 1,
        capital_available: 5, // Very small capital
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 5,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(5);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(false);
      mockBuyAmountCalculator.getSkipReason.mockReturnValue(
        "Amount 5 is below minimum 10 USDT",
      );

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("Amount 5 is below minimum 10 USDT");
      expect(result.validations?.amountValid).toBe(false);
    });
  });

  describe("Drift Detection", () => {
    it("should skip buy when USDT drift exceeds threshold", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 490, // 2% drift from capital_available (500)
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain(
        "USDT drift 2.000% exceeds threshold 0.5%",
      );
      expect(result.validations?.driftCheck).toBe(false);
    });

    it("should pass drift check when within threshold", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 498, // 0.4% drift from capital_available (500)
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.validations?.driftCheck).toBe(true);
    });

    it("should calculate drift correctly with zero capital", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 0,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 10, // Any difference from 0
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(0);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // When capital is 0 and buy amount is 0, drift check happens first
      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("USDT drift");
    });

    it("should handle edge case of exact drift threshold", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 1000,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 995, // Exactly 0.5% drift
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // Exactly at threshold should fail (>= check)
      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain(
        "USDT drift 0.500% exceeds threshold 0.5%",
      );
    });
  });

  describe("Decimal Precision and Edge Cases", () => {
    it("should handle high precision decimal calculations", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000.12345678,
        purchases_remaining: 5,
        capital_available: 500.87654321,
        buy_amount: 100.1728395,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02, // 2%
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      // Buy threshold = 50000.12345678 * (1 - 0.02) = 49000.12098764
      const candle: Candle = {
        close: 49000.12098764, // Exactly at threshold
        high: 49500,
        low: 48900,
        open: 49200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500.87654321,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100.1728395);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(100.1728395);
    });

    it("should handle null reference price", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: null, // No reference price set
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("Reference price is not set");
    });

    it("should handle null buy amount", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: null, // Not initialized
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      // Mock the buy amount calculator to throw an error for null buy_amount
      mockBuyAmountCalculator.getPurchaseAmount.mockImplementation(() => {
        throw new Error("Buy amount not initialized");
      });

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("Failed to calculate buy amount");
    });

    it("should handle very large numbers", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 1000000,
        purchases_remaining: 10,
        capital_available: 1000000,
        buy_amount: 100000,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.05,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 940000, // 6% drop
        high: 960000,
        low: 935000,
        open: 950000,
        volume: 1000,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 1000000,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100000);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(100000);
    });

    it("should handle very small percentages", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.001, // 0.1% drop
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 49940, // 0.12% drop
        high: 50000,
        low: 49900,
        open: 49950,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
    });
  });

  describe("Complete Buy Decision Flow", () => {
    it("should return detailed validation results for successful buy", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 3,
        capital_available: 300,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48500,
        high: 49000,
        low: 48400,
        open: 48800,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 299,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result).toEqual({
        shouldBuy: true,
        buyAmount: 100,
        validations: {
          priceThresholdMet: true,
          capitalAvailable: true,
          driftCheck: true,
          strategyActive: true,
          amountValid: true,
        },
      });
    });

    it("should provide clear skip reason for each validation failure", () => {
      // Test each validation failure separately
      const baseState: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const baseConfig: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const baseCandle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const baseBalances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      // Test 1: Price threshold not met
      let result = detector.checkBuyTrigger(
        baseState,
        baseConfig,
        { ...baseCandle, close: 49500 },
        baseBalances,
      );
      expect(result.reason).toContain(
        "Price 49500.00 above buy threshold 49000.00",
      );

      // Test 2: No purchases remaining
      result = detector.checkBuyTrigger(
        { ...baseState, purchases_remaining: 0 },
        baseConfig,
        baseCandle,
        baseBalances,
      );
      expect(result.reason).toContain("No purchases remaining");

      // Test 3: Strategy paused
      result = detector.checkBuyTrigger(
        { ...baseState, status: "PAUSED" },
        baseConfig,
        baseCandle,
        baseBalances,
      );
      expect(result.reason).toContain("Strategy is PAUSED");

      // Test 4: Insufficient capital
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      result = detector.checkBuyTrigger(
        { ...baseState, capital_available: 50 },
        baseConfig,
        baseCandle,
        { ...baseBalances, usdtSpot: 50 },
      );
      expect(result.reason).toContain(
        "Insufficient capital: 50.00 < 100.00 USDT",
      );

      // Test 5: Drift exceeded
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);
      result = detector.checkBuyTrigger(baseState, baseConfig, baseCandle, {
        ...baseBalances,
        usdtSpot: 490,
      });
      expect(result.reason).toContain(
        "USDT drift 2.000% exceeds threshold 0.5%",
      );

      // Test 6: Amount below minimum
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(5);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(false);
      mockBuyAmountCalculator.getSkipReason.mockReturnValue(
        "Amount 5 is below minimum 10 USDT",
      );
      result = detector.checkBuyTrigger(
        { ...baseState, capital_available: 5, buy_amount: 5 },
        baseConfig,
        baseCandle,
        { ...baseBalances, usdtSpot: 5 },
      );
      expect(result.reason).toContain("Amount 5 is below minimum 10 USDT");
    });

    it("should use all capital for last purchase", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 1, // Last purchase
        capital_available: 150,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 150,
        btcSpot: 0,
      };

      // For last purchase, should use all capital
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(150);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(150);
      expect(mockBuyAmountCalculator.getPurchaseAmount).toHaveBeenCalledWith({
        buy_amount: state.buy_amount,
        capital_available: state.capital_available,
        purchases_remaining: state.purchases_remaining,
      });
    });
  });

  describe("STRATEGY.md Compliance", () => {
    it("should follow exact buy condition formula from STRATEGY.md", () => {
      // STRATEGY.md: if (Close ≤ reference_price * (1 - %Drop) AND purchases_remaining > 0 AND capital_available >= buy_amount)
      const state: CycleState = {
        status: "READY",
        reference_price: 60000,
        purchases_remaining: 7,
        capital_available: 700,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.03, // 3%
        risePercentage: 0.04,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      // Buy threshold = 60000 * (1 - 0.03) = 58200
      const testCases = [
        { close: 58200, shouldBuy: true }, // Exactly at threshold
        { close: 58199, shouldBuy: true }, // Below threshold
        { close: 58201, shouldBuy: false }, // Above threshold
        { close: 58000, shouldBuy: true }, // Well below threshold
        { close: 59000, shouldBuy: false }, // Well above threshold
      ];

      const balances: BalanceInfo = {
        usdtSpot: 700,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      testCases.forEach(({ close, shouldBuy }) => {
        const candle: Candle = {
          close,
          high: close + 100,
          low: close - 100,
          open: close,
          volume: 100,
          timestamp: Date.now(),
        };

        const result = detector.checkBuyTrigger(
          state,
          config,
          candle,
          balances,
        );
        expect(result.shouldBuy).toBe(shouldBuy);
      });
    });

    it("should validate drift per STRATEGY.md formula", () => {
      // STRATEGY.md: drift_usdt = |USDT_SPOT - capital_available| / max(capital_available, 1)
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 1000,
        buy_amount: 200,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005, // 0.5%
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(200);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      // Test various drift scenarios
      const driftTests = [
        { usdtSpot: 1000, expectedDrift: 0, shouldBuy: true },
        { usdtSpot: 1004, expectedDrift: 0.004, shouldBuy: true },
        { usdtSpot: 995, expectedDrift: 0.005, shouldBuy: false }, // Exactly at threshold
        { usdtSpot: 994, expectedDrift: 0.006, shouldBuy: false },
        { usdtSpot: 1010, expectedDrift: 0.01, shouldBuy: false },
      ];

      driftTests.forEach(({ usdtSpot, expectedDrift, shouldBuy }) => {
        const balances: BalanceInfo = {
          usdtSpot,
          btcSpot: 0,
        };

        const result = detector.checkBuyTrigger(
          state,
          config,
          candle,
          balances,
        );
        expect(result.shouldBuy).toBe(shouldBuy);

        if (!shouldBuy && expectedDrift >= 0.005) {
          expect(result.reason).toContain(`USDT drift`);
          expect(result.reason).toContain(`exceeds threshold`);
        }
      });
    });

    it("should validate all pre-buy conditions in correct order", () => {
      // Per STRATEGY.md execution order
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // Verify all checks pass in correct order
      expect(result.validations).toEqual({
        priceThresholdMet: true,
        capitalAvailable: true,
        driftCheck: true,
        strategyActive: true,
        amountValid: true,
      });
    });
  });

  describe("Logging and Monitoring", () => {
    it("should log decision when buy is triggered", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      detector.checkBuyTrigger(state, config, candle, balances);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "BUY TRIGGERED: Price 48000.00 <= Threshold 49000.00, Amount: 100.00 USDT",
        ),
      );

      consoleSpy.mockRestore();
    });

    it("should log skip reason when buy is not triggered", () => {
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // No log should be called when buy is skipped
      expect(consoleSpy).not.toHaveBeenCalled();
      // But the reason should be in the result
      expect(result.reason).toContain("No purchases remaining");

      consoleSpy.mockRestore();
    });
  });

  describe("Helper Methods", () => {
    it("should calculate buy threshold correctly", () => {
      const referencePrice = 50000;
      const dropPercentage = 0.025; // 2.5%

      const threshold = detector.calculateBuyThreshold(
        referencePrice,
        dropPercentage,
      );

      expect(threshold).toBe(48750); // 50000 * (1 - 0.025)
    });

    it("should calculate drift correctly", () => {
      const testCases = [
        {
          spotBalance: 100,
          stateBalance: 100,
          expectedDrift: 0,
        },
        {
          spotBalance: 105,
          stateBalance: 100,
          expectedDrift: 0.05,
        },
        {
          spotBalance: 95,
          stateBalance: 100,
          expectedDrift: 0.05,
        },
        {
          spotBalance: 10,
          stateBalance: 0,
          expectedDrift: 10, // |10 - 0| / max(0, 1) = 10
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

    it("should format price for logging", () => {
      const testCases = [
        { price: 50000, expected: "50000.00" },
        { price: 49999.12345678, expected: "49999.12" },
        { price: 0.123456, expected: "0.12" },
        { price: 1000000, expected: "1000000.00" },
      ];

      testCases.forEach(({ price, expected }) => {
        const formatted = detector.formatPrice(price);
        expect(formatted).toBe(expected);
      });
    });

    it("should check if strategy is active", () => {
      expect(detector.isStrategyActive("READY")).toBe(true);
      expect(detector.isStrategyActive("HOLDING")).toBe(true);
      expect(detector.isStrategyActive("PAUSED")).toBe(false);
    });
  });

  describe("Integration with Dependencies", () => {
    it("should work with BuyAmountCalculator for regular purchases", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(100);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(mockBuyAmountCalculator.getPurchaseAmount).toHaveBeenCalledWith({
        buy_amount: state.buy_amount,
        capital_available: state.capital_available,
        purchases_remaining: state.purchases_remaining,
      });
      expect(mockBuyAmountCalculator.isAmountValid).toHaveBeenCalledWith(
        100,
        config.minBuyUSDT,
        config.exchangeMinNotional,
      );
      expect(result.buyAmount).toBe(100);
    });

    it("should work with BuyAmountCalculator for last purchase", () => {
      const state: CycleState = {
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 1,
        capital_available: 175.5,
        buy_amount: 100,
        btc_accumulated: 0,
      };

      const config: TradingConfig = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        driftThresholdPct: 0.005,
      };

      const candle: Candle = {
        close: 48000,
        high: 48500,
        low: 47900,
        open: 48200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 175.5,
        btcSpot: 0,
      };

      // Last purchase should use all capital
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(175.5);
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(mockBuyAmountCalculator.getPurchaseAmount).toHaveBeenCalledWith({
        buy_amount: state.buy_amount,
        capital_available: state.capital_available,
        purchases_remaining: state.purchases_remaining,
      });
      expect(result.buyAmount).toBe(175.5);
    });
  });
});
