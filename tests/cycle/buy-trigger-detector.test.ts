import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { BuyTriggerDetector } from "../../src/cycle/buy-trigger-detector";
import { BuyAmountCalculator } from "../../src/cycle/buy-amount-calculator";
import { logger } from "../../src/utils/logger";

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

  // Helper to create a valid CycleState with default values
  const createCycleState = (
    overrides: Partial<CycleState> = {},
  ): CycleState => ({
    status: "READY",
    reference_price: 50000,
    purchases_remaining: 5,
    capital_available: 500,
    buy_amount: 100,
    buy_anchor_price: null,
    btc_accumulated: 0,
    buy_grid: null,
    buy_index: 0,
    initial_capital_usdt: 500,
    ...overrides,
  });

  // Helper to create a valid TradingConfig with default values
  const createTradingConfig = (
    overrides: Partial<TradingConfig> = {},
  ): TradingConfig => ({
    dropPercentage: 0.02,
    risePercentage: 0.03,
    minBuyUSDT: 10,
    exchangeMinNotional: 10,
    maxPurchases: 5,
    ...overrides,
  });

  // Helper to create a valid Candle with default values
  const createCandle = (overrides: Partial<Candle> = {}): Candle => ({
    open: 50000,
    high: 51000,
    low: 49000,
    close: 50000,
    volume: 100,
    timestamp: Date.now(),
    ...overrides,
  });

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
      const state = createCycleState({
        buy_grid: [49000, 48000, 47000, 46000, 45000], // Pre-calculated grid
        buy_index: 0,
      });

      const config = createTradingConfig();

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
      expect(result.validations?.strategyActive).toBe(true);
      expect(result.validations?.amountValid).toBe(true);
    });

    it("should trigger buy exactly at threshold", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 3,
        capital_available: 300,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.025, // 2.5% drop
      });

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
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02, // 2% drop
      });

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
      expect(result.reason).toContain("above first grid level");
      expect(result.validations?.priceThresholdMet).toBe(false);
    });
  });

  describe("Pre-Buy Validation Checks", () => {
    it("should skip buy when no purchases remaining", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 0, // No purchases left
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 5, // Very low capital
        buy_amount: 100,
        btc_accumulated: 0,
        buy_grid: [49000, 48000, 47000, 46000, 45000],
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      // With only 5 capital and buy_amount of 100, the calculated amount is too small
      expect(result.reason).toContain("below minimum");
      expect(result.validations).toBeDefined();
      // Note: amountValid may not be set if we return early due to insufficient capital
      expect(result.validations?.strategyActive).toBe(true);
      expect(result.validations?.gridValid).toBe(true);
    });

    it("should skip buy when strategy is PAUSED", () => {
      const state = createCycleState({
        status: "PAUSED", // Strategy paused
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 1,
        capital_available: 5, // Very small capital
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
    it("should trigger buy regardless of balance mismatch (retry handles)", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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

      // Drift no longer blocks trades - retry logic handles balance mismatch
      expect(result.shouldBuy).toBe(true);
    });

    it("should pass drift check when within threshold", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
    });

    it("should calculate drift correctly with zero capital", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 0,
        buy_amount: 100,
        btc_accumulated: 0,
        buy_grid: null, // Grid will trigger to be built first
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

      const candle: Candle = {
        close: 49000, // At trigger level
        high: 49500,
        low: 48900,
        open: 49200,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 10, // Any difference from 0
        btcSpot: 0,
      };

      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(0);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // When capital is 0, it should fail on "below minimum" check
      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("below minimum");
    });

    it("should handle edge case of balance mismatch", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 1000,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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

      // Balance mismatch no longer blocks trades
      expect(result.shouldBuy).toBe(true);
    });
  });

  describe("Decimal Precision and Edge Cases", () => {
    it("should handle high precision decimal calculations", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000.12345678,
        purchases_remaining: 5,
        capital_available: 500.87654321,
        buy_amount: 100.1728395,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02, // 2%
      });

      // Buy threshold = 50000.12345678 * (1 - 0.02) = 49000.12098764
      // But quantized to tick size 0.01: 49000.12
      const candle: Candle = {
        close: 49000.12, // At quantized threshold
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
      const state = createCycleState({
        status: "READY",
        reference_price: null, // No reference price set
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
      expect(result.reason).toContain("No reference price");
    });

    it("should handle null buy amount", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: null, // Not initialized
        btc_accumulated: 0,
        buy_grid: [49000, 48000, 47000, 46000, 45000], // Grid exists
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
        minBuyUSDT: 300, // Higher than available amount
      });

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

      // Mock the buy amount calculator to return an amount
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(200);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("below minimum");
    });

    it("should handle very large numbers", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 1000000,
        purchases_remaining: 10,
        capital_available: 1000000,
        buy_amount: 100000,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.05,
      });

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
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.001, // 0.1% drop
      });

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

  describe("Arithmetic Anchoring Strategy", () => {
    it("should limit first buy to single level when no anchor is set", () => {
      const state = createCycleState({
        buy_grid: [49000, 48000, 47000, 46000, 45000],
        buy_index: 0,
        buy_anchor_price: null, // No anchor set yet (first buy)
        capital_available: 500,
        purchases_remaining: 5,
      });

      const config = createTradingConfig();

      // Price crosses multiple levels (should cross 3 levels: 49000, 48000, 47000)
      const candle = createCandle({ close: 46500 });

      const balances: BalanceInfo = {
        usdtSpot: 500,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // Should only trigger 1 level for first buy
      expect(result.shouldBuy).toBe(true);
      expect(result.levelsTriggered).toBe(1);
      expect(result.buyAmount).toBe(100); // Only 1 x 100
      expect(result.newBuyIndex).toBe(1);
      expect(result.triggeredLevels).toEqual([49000]);
    });

    it("should allow multiple levels after anchor is set", () => {
      const state = createCycleState({
        buy_grid: [49000, 48000, 47000, 46000, 45000],
        buy_index: 1, // Already bought first level
        buy_anchor_price: 49100, // Anchor is set from first buy
        capital_available: 400,
        purchases_remaining: 4,
      });

      const config = createTradingConfig();

      // Price crosses multiple levels (48000, 47000)
      const candle = createCandle({ close: 46500 });

      const balances: BalanceInfo = {
        usdtSpot: 400,
        btcSpot: 0.001,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      // Should trigger multiple levels after first buy
      expect(result.shouldBuy).toBe(true);
      expect(result.levelsTriggered).toBe(2);
      expect(result.buyAmount).toBe(200); // 2 x 100
      expect(result.newBuyIndex).toBe(3);
      expect(result.triggeredLevels).toEqual([48000, 47000]);
    });
  });

  describe("Grid Building with Anchor", () => {
    it("should build grid from anchor price when available", () => {
      const anchorPrice = 48500;
      const config = createTradingConfig({
        dropPercentage: 0.02,
        maxPurchases: 5,
      });

      const grid = detector.buildGridFromAnchor(anchorPrice, config);

      // Grid should be based on anchor price
      expect(grid).toHaveLength(5);
      expect(grid[0]).toBeCloseTo(47530); // 48500 * (1 - 0.02)
      expect(grid[1]).toBeCloseTo(46560); // 48500 * (1 - 0.04)
      expect(grid[2]).toBeCloseTo(45590); // 48500 * (1 - 0.06)
      expect(grid[3]).toBeCloseTo(44620); // 48500 * (1 - 0.08)
      expect(grid[4]).toBeCloseTo(43650); // 48500 * (1 - 0.10)
    });
  });

  describe("Complete Buy Decision Flow", () => {
    it("should return detailed validation results for successful buy", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 3,
        capital_available: 300,
        buy_amount: 100,
        btc_accumulated: 0,
        // No grid yet - will be built dynamically
        buy_grid: null,
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
        maxPurchases: 5,
      });

      const candle: Candle = {
        close: 48500, // Below first grid level (50000 * 0.98 = 49000)
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

      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(100);
      expect(result.levelsTriggered).toBe(1); // First level triggered
      expect(result.newBuyIndex).toBe(1); // Move to next level
      expect(result.triggeredLevels).toEqual([49000]); // First grid level
      expect(result.newGrid).toBeDefined(); // Grid was built dynamically
      expect(result.newGrid?.length).toBe(5); // maxPurchases levels
      expect(result.validations).toMatchObject({
        priceThresholdMet: true,
        capitalAvailable: true,
        strategyActive: true,
        amountValid: true,
        gridValid: true,
      });
    });

    it("should provide clear skip reason for each validation failure", () => {
      // Test each validation failure separately
      const baseState = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const baseConfig = createTradingConfig({
        dropPercentage: 0.02,
      });

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
      // With delayed grid construction, message includes ATH reference
      expect(result.reason).toContain("above first grid level");

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

      // Test 4: Insufficient capital (amount below minimum)
      mockBuyAmountCalculator.getPurchaseAmount.mockReturnValue(50);
      result = detector.checkBuyTrigger(
        { ...baseState, capital_available: 50 },
        baseConfig,
        baseCandle,
        { ...baseBalances, usdtSpot: 50 },
      );
      // With only 50 capital, the amount is below minimum
      expect(result.reason).toContain("below minimum");

      // Test 5: Drift no longer blocks trades (removed)
      // Balance mismatch now handled by retry logic

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
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 1, // Last purchase
        capital_available: 150,
        buy_amount: 100,
        btc_accumulated: 0,
        // No grid yet - will be built dynamically
        buy_grid: null,
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
        maxPurchases: 5,
      });

      const candle: Candle = {
        close: 48000, // Below first grid level to trigger buy
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

      // For last purchase, the implementation uses all capital directly
      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      // When purchases_remaining is 1, should use all available capital
      expect(result.buyAmount).toBe(150);
    });
  });

  describe("STRATEGY.md Compliance", () => {
    it("should follow exact buy condition formula from STRATEGY.md", () => {
      // STRATEGY.md: if (Close ≤ reference_price * (1 - %Drop) AND purchases_remaining > 0 AND capital_available >= buy_amount)
      const state = createCycleState({
        status: "READY",
        reference_price: 60000,
        purchases_remaining: 7,
        capital_available: 700,
        buy_amount: 100,
        btc_accumulated: 0,
        buy_grid: [58200, 56400, 54600, 52800, 51000, 49200, 47400], // Pre-calculated grid
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.03, // 3%
      });

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

    it("should no longer validate drift (handled by retry logic)", () => {
      // STRATEGY.md: drift_usdt = |USDT_SPOT - capital_available| / max(capital_available, 1)
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 1000,
        buy_amount: 200,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
      // Per STRATEGY.md: drift only triggers when insufficient funds (spot < capital)
      const driftTests = [
        { usdtSpot: 1000, expectedDrift: 0, shouldBuy: true }, // Exact match
        { usdtSpot: 1004, expectedDrift: 0, shouldBuy: true }, // Excess funds (no drift)
        { usdtSpot: 995, expectedDrift: 0.005, shouldBuy: false }, // Exactly at threshold (insufficient)
        { usdtSpot: 994, expectedDrift: 0.006, shouldBuy: false }, // Above threshold (insufficient)
        { usdtSpot: 1010, expectedDrift: 0, shouldBuy: true }, // Excess funds (no drift)
      ];

      driftTests.forEach(({ usdtSpot }) => {
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
        // All should trigger - balance mismatch handled by retry logic
        expect(result.shouldBuy).toBe(true);
      });
    });

    it("should validate all pre-buy conditions in correct order", () => {
      // Per STRATEGY.md execution order
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
        strategyActive: true,
        amountValid: true,
        gridValid: true, // Grid validation is now part of the checks
      });
    });
  });

  describe("Logging and Monitoring", () => {
    it("should log decision when buy is triggered", () => {
      const loggerSpy = jest.spyOn(logger, "info").mockImplementation(() => {});

      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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

      // With grid-based implementation, it logs differently
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Grid buy triggered|Building buy grid/),
        expect.objectContaining({
          currentPrice: 48000,
        }),
      );

      loggerSpy.mockRestore();
    });

    it("should log skip reason when buy is not triggered", () => {
      const loggerSpy = jest.spyOn(logger, "info").mockImplementation(() => {});

      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 0,
        capital_available: 500,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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
      expect(loggerSpy).not.toHaveBeenCalled();
      // But the reason should be in the result
      expect(result.reason).toContain("No purchases remaining");

      loggerSpy.mockRestore();
    });
  });

  describe("Helper Methods", () => {
    it("should detect buy trigger at correct threshold", () => {
      // Test that buy triggers at reference_price * (1 - dropPercentage)
      const state = createCycleState({
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_amount: 200, // Add buy_amount for calculation
        buy_grid: [48750, 47500, 46250, 45000, 43750], // Pre-built grid for this test
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.025, // 2.5%
      });

      // At exact threshold
      const candle = createCandle({ close: 48750 });
      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);
      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.levelsTriggered).toBe(1);
    });

    it("should no longer validate drift through checkBuyTrigger", () => {
      const state = createCycleState({
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_amount: 200,
        buy_grid: [49000],
        buy_index: 0,
        btc_accumulated: 0, // No BTC accumulated yet
      });

      const config = createTradingConfig({});

      const candle = createCandle({ close: 49000 });

      // Test USDT drift detection - insufficient funds triggers drift
      const balancesWithDrift: BalanceInfo = {
        usdtSpot: 995, // Insufficient funds - exactly at threshold
        btcSpot: 0,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);
      const result = detector.checkBuyTrigger(
        state,
        config,
        candle,
        balancesWithDrift,
      );

      // Drift no longer blocks trades
      expect(result.shouldBuy).toBe(true);
    });

    it("should handle paused strategy state", () => {
      const state = createCycleState({
        status: "PAUSED",
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_grid: [49000],
        buy_index: 0,
      });

      const config = createTradingConfig();
      const candle = createCandle({ close: 45000 });
      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.reason).toContain("Strategy is PAUSED");
    });
  });

  describe("Delayed Grid Construction", () => {
    it("should build grid dynamically when price drops to first trigger level", () => {
      const state = createCycleState({
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_amount: 200, // Needed for amount calculation
        buy_grid: null, // No grid initially
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02, // 2%
        maxPurchases: 5,
      });

      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);

      // Price below first trigger level (50000 * 0.98 = 49000)
      const candle = createCandle({ close: 48500 });
      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.newGrid).toBeDefined();
      expect(result.newGrid).toHaveLength(5);
      expect(result.newGrid![0]).toBe(49000); // First level at 2% drop
      expect(result.newGrid![1]).toBe(48000); // Second level at 4% drop
      expect(result.newGrid![2]).toBe(47000); // Third level at 6% drop
      expect(result.newGrid![3]).toBe(46000); // Fourth level at 8% drop
      expect(result.newGrid![4]).toBe(45000); // Fifth level at 10% drop
    });

    it("should not build grid when price is above first trigger level", () => {
      const state = createCycleState({
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_grid: null, // No grid initially
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02, // 2%
      });

      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      // Price above first trigger level
      const candle = createCandle({ close: 49500 }); // Above 49000 threshold
      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(false);
      expect(result.newGrid).toBeUndefined();
      expect(result.reason).toContain("above first grid level");
    });

    it("should not rebuild grid if it already exists", () => {
      const existingGrid = [49000, 48000, 47000, 46000, 45000];
      const state = createCycleState({
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_amount: 200, // Add buy_amount
        buy_grid: existingGrid,
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);
      const candle = createCandle({ close: 49000 });
      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.newGrid).toBeUndefined(); // Should not create new grid
      expect(result.levelsTriggered).toBe(1);
    });

    it("should handle multiple levels triggered on grid construction", () => {
      const state = createCycleState({
        reference_price: 50000,
        capital_available: 1000,
        purchases_remaining: 5,
        buy_amount: 200, // Add buy_amount
        buy_grid: null,
        buy_index: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02, // 2% per level
        maxPurchases: 5,
      });

      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      mockBuyAmountCalculator.isAmountValid.mockReturnValue(true);
      // Price has dropped below multiple levels (8% drop)
      const candle = createCandle({ close: 46000 });
      const result = detector.checkBuyTrigger(state, config, candle, balances);

      expect(result.shouldBuy).toBe(true);
      expect(result.newGrid).toBeDefined();
      // First buy is limited to single level
      expect(result.levelsTriggered).toBe(1);
      expect(result.triggeredLevels).toEqual([49000]);
    });
  });

  describe("Integration with Dependencies", () => {
    it("should work with BuyAmountCalculator for regular purchases", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 5,
        capital_available: 500,
        buy_amount: 100,
        buy_anchor_price: 49500, // Anchor is set, not first buy
        buy_grid: [49000, 48000, 47000, 46000, 45000], // Grid already built
        buy_index: 0,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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

      // With grid-based logic, getPurchaseAmount is not called
      // Instead, it calculates directly based on buy_amount or initial_capital/maxPurchases
      expect(mockBuyAmountCalculator.isAmountValid).toHaveBeenCalledWith(
        200, // Combined amount for 2 levels (100 * 2)
        config.minBuyUSDT,
        config.exchangeMinNotional,
      );
      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(200); // 2 levels * 100 each
      expect(result.levelsTriggered).toBe(2);
    });

    it("should work with BuyAmountCalculator for last purchase", () => {
      const state = createCycleState({
        status: "READY",
        reference_price: 50000,
        purchases_remaining: 1,
        capital_available: 175.5,
        buy_amount: 100,
        btc_accumulated: 0,
      });

      const config = createTradingConfig({
        dropPercentage: 0.02,
      });

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

      // For last purchase, all capital is used directly
      // getPurchaseAmount is not called in grid-based logic
      expect(mockBuyAmountCalculator.isAmountValid).toHaveBeenCalledWith(
        175.5, // All remaining capital for last purchase
        config.minBuyUSDT,
        config.exchangeMinNotional,
      );
      expect(result.shouldBuy).toBe(true);
      expect(result.buyAmount).toBe(175.5); // All remaining capital
      expect(result.levelsTriggered).toBe(1);
    });
  });
});
