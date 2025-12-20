import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { BuyOrderStateUpdater } from "../../src/cycle/buy-order-state-updater";
import { BuyTriggerDetector } from "../../src/cycle/buy-trigger-detector";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import type { CycleState } from "../../src/cycle/cycle-state-manager";
import type { OrderResult } from "../../src/order/buy-order-placer";
import type {
  TradingConfig,
  Candle,
  BalanceInfo,
  CycleState as BuyTriggerCycleState,
} from "../../src/cycle/buy-trigger-detector";
import type { StrategyConfig } from "../../src/config/strategy-config-loader";
import { Decimal } from "decimal.js";
import { createMockSupabaseClient } from "../mocks/supabase-mock";
import { BuyAmountCalculator } from "../../src/cycle/buy-amount-calculator";

describe("Buy Anchor Price End-to-End", () => {
  let buyOrderUpdater: BuyOrderStateUpdater;
  let buyTriggerDetector: BuyTriggerDetector;
  let supabase: SupabaseClient<Database>;
  let mockCycleState: CycleState;
  let mockBuyAmountCalculator: jest.Mocked<BuyAmountCalculator>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Supabase client
    supabase = createMockSupabaseClient({
      cycle_state: {
        update: { data: null, error: null },
      },
      bot_events: {
        insert: { data: null, error: null },
      },
    });

    // Setup mock buy amount calculator
    mockBuyAmountCalculator = {
      calculateBuyAmount: jest.fn(
        (cycleState: CycleState, levelCount: number) => {
          // Mock the calculation: buyAmount * levelCount
          return (cycleState.buy_amount || 100) * levelCount;
        },
      ),
      validateBuyAmount: jest.fn(() => ({ isValid: true, reason: "" })),
      isAmountValid: jest.fn(() => true),
    } as unknown as jest.Mocked<BuyAmountCalculator>;

    // Create instances
    const mockStrategyConfig: StrategyConfig = {
      id: "test-config",
      timeframe: "15m",
      dropPercentage: 0.02,
      risePercentage: 0.03,
      maxPurchases: 5,
      minBuyUsdt: 10,
      initialCapitalUsdt: 500,
      slippageBuyPct: 0.003,
      slippageSellPct: 0.003,
      athWindow: 25,
      isActive: true,
      updatedAt: new Date().toISOString(),
    };

    buyOrderUpdater = new BuyOrderStateUpdater(supabase);
    buyTriggerDetector = new BuyTriggerDetector(
      mockBuyAmountCalculator,
      mockStrategyConfig,
    );

    // Setup initial cycle state (no anchor, no grid yet)
    mockCycleState = {
      id: "test-cycle-id",
      status: "READY" as const,
      capital_available: 1000.0,
      btc_accumulated: 0,
      purchases_remaining: 10,
      ath_reference_price: 120000, // ATH
      sell_reference_price: null,
      buy_anchor_price: null, // No anchor yet
      cost_accum_usdt: 0,
      btc_accum_net: 0,
      btc_dust: 0,
      ath_price: 120000,
      buy_amount: 100,
      completed_at: null,
      final_profit: null,
      previous_cycle_id: null,
      strategy_config_id: null,
      updated_at: new Date().toISOString(),
      buy_grid: null, // No grid yet
      buy_index: 0,
      version: 1,
    };
  });

  describe("First Buy Sets Anchor Price", () => {
    it("should set buy_anchor_price on first buy and persist to database", async () => {
      // Spy on StateTransactionManager
      const updateSpy = jest
        .spyOn(StateTransactionManager.prototype, "updateStateAtomic")
        .mockImplementation(
          async (_botId: string, updates: Partial<CycleState>) => {
            // Verify anchor price is being set
            expect(updates.buy_anchor_price).toBeDefined();
            expect(updates.buy_anchor_price).toBeGreaterThan(0);

            return {
              ...mockCycleState,
              ...updates,
            } as CycleState;
          },
        );

      // Create order result for first buy at 117500
      const orderResult: OrderResult = {
        orderId: 12345,
        clientOrderId: "BUY_1234567890_abc123",
        status: "FILLED",
        executedQty: new Decimal("0.001"),
        cummulativeQuoteQty: new Decimal("117.50"),
        avgPrice: new Decimal("117500.00"),
        fills: [],
        feeBTC: new Decimal("0.000001"),
        feeUSDT: new Decimal("0"),
        feeOther: {},
      };

      // Execute the first buy
      const result = await buyOrderUpdater.updateAfterBuyOrder(
        mockCycleState,
        orderResult,
        1, // 1 level triggered
        10, // maxPurchases
      );

      // Verify anchor price was set (quantized to tick size 0.01)
      expect(result.buy_anchor_price).toBe(117500.0);

      // Verify it was passed to the database
      expect(updateSpy).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          buy_anchor_price: 117500.0,
        }),
      );

      updateSpy.mockRestore();
    });

    it("should limit first buy to single level even if multiple crossed", async () => {
      const config: TradingConfig = {
        dropPercentage: 0.03,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      // Price drops significantly below first trigger
      const candle: Candle = {
        close: 112000, // Way below 120000 * 0.97 = 116400
        high: 115000,
        low: 111500,
        open: 115000,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 1000,
        btcSpot: 0,
      };

      const buyTriggerState: BuyTriggerCycleState = {
        status: mockCycleState.status as "READY" | "HOLDING" | "PAUSED",
        ath_reference_price: mockCycleState.ath_reference_price,
        sell_reference_price: mockCycleState.sell_reference_price,
        purchases_remaining: mockCycleState.purchases_remaining,
        capital_available: mockCycleState.capital_available,
        buy_amount: mockCycleState.buy_amount,
        buy_anchor_price: mockCycleState.buy_anchor_price,
        btc_accumulated: mockCycleState.btc_accumulated || 0,
        buy_grid: mockCycleState.buy_grid,
        buy_index: mockCycleState.buy_index || 0,
      };

      const result = await buyTriggerDetector.checkBuyTrigger(
        buyTriggerState,
        config,
        candle,
        balances,
      );

      // Even though price crossed multiple levels, first buy is limited to 1
      expect(result.shouldBuy).toBe(true);
      expect(result.levelsTriggered).toBe(1);
      expect(result.newGrid).toBeDefined(); // Grid built dynamically
      expect(result.newGrid?.length).toBe(10);
    });
  });

  describe("Subsequent Buys After Anchor Set", () => {
    beforeEach(() => {
      // Setup state after first buy with anchor set
      mockCycleState = {
        ...mockCycleState,
        status: "HOLDING" as const,
        buy_anchor_price: 117500, // Anchor from first buy
        buy_grid: [
          113975, 110450, 106925, 103400, 99875, 96350, 92825, 89300, 85775,
          82250,
        ], // Grid from anchor (117500 * (1 - n*0.03))
        buy_index: 1, // Already bought first level
        purchases_remaining: 9,
        capital_available: 900, // Remaining capital after first buy
        btc_accumulated: 0.001,
        cost_accum_usdt: 117.5,
        btc_accum_net: 0.000999,
        sell_reference_price: 117617.62,
      };
    });

    it("should allow multiple levels to be triggered after anchor is set", async () => {
      const config: TradingConfig = {
        dropPercentage: 0.03,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      // Price drops to cross multiple levels
      // buy_index = 1, so next levels are at indices 1 and 2: 110450 and 106925
      const candle: Candle = {
        close: 105000, // Crosses both 110450 and 106925
        high: 110000,
        low: 104500,
        open: 110000,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 900,
        btcSpot: 0.001,
      };

      const buyTriggerState: BuyTriggerCycleState = {
        status: mockCycleState.status as "READY" | "HOLDING" | "PAUSED",
        ath_reference_price: mockCycleState.ath_reference_price,
        sell_reference_price: mockCycleState.sell_reference_price,
        purchases_remaining: mockCycleState.purchases_remaining,
        capital_available: mockCycleState.capital_available,
        buy_amount: mockCycleState.buy_amount,
        buy_anchor_price: mockCycleState.buy_anchor_price,
        btc_accumulated: mockCycleState.btc_accumulated || 0,
        buy_grid: mockCycleState.buy_grid,
        buy_index: mockCycleState.buy_index || 0,
      };

      const result = await buyTriggerDetector.checkBuyTrigger(
        buyTriggerState,
        config,
        candle,
        balances,
      );

      // Should trigger multiple levels since anchor is set
      expect(result.shouldBuy).toBe(true);
      expect(result.levelsTriggered).toBe(2); // Crosses 2 levels
      expect(result.buyAmount).toBe(200); // 2 x 100
      expect(result.newBuyIndex).toBe(3); // Moves from 1 to 3
      expect(result.triggeredLevels).toEqual([110450, 106925]);
    });

    it("should preserve anchor price on subsequent buys", async () => {
      // Set up state after first buy (anchor is set, buy_index updated by BuyTriggerDetector)
      const stateAfterFirstBuy = {
        ...mockCycleState,
        buy_anchor_price: 117500, // Anchor set on first buy
        buy_index: 3, // Already updated by BuyTriggerDetector (1 + 2 levels)
        buy_grid: [
          113975, 110450, 106925, 103400, 99875, 96350, 92825, 89300, 85775,
          82250,
        ],
      };

      const updateSpy = jest
        .spyOn(StateTransactionManager.prototype, "updateStateAtomic")
        .mockImplementation(
          async (_botId: string, updates: Partial<CycleState>) => {
            // Anchor should remain unchanged
            expect(updates.buy_anchor_price).toBe(117500);

            return {
              ...stateAfterFirstBuy,
              ...updates,
            } as CycleState;
          },
        );

      const orderResult: OrderResult = {
        orderId: 12346,
        clientOrderId: "BUY_1234567891_abc124",
        status: "FILLED",
        executedQty: new Decimal("0.002"),
        cummulativeQuoteQty: new Decimal("220.00"),
        avgPrice: new Decimal("110000.00"), // Different price
        fills: [],
        feeBTC: new Decimal("0.000002"),
        feeUSDT: new Decimal("0"),
        feeOther: {},
      };

      const result = await buyOrderUpdater.updateAfterBuyOrder(
        stateAfterFirstBuy, // Use state with anchor and buy_index already set
        orderResult,
        2, // 2 levels triggered
        10, // maxPurchases
      );

      // Anchor should remain at original value
      expect(result.buy_anchor_price).toBe(117500);

      // buy_index should remain as set by BuyTriggerDetector (implementation doesn't increment)
      expect(result.buy_index).toBe(3);

      updateSpy.mockRestore();
    });
  });

  describe("Grid Rebuild from Anchor", () => {
    it("should rebuild grid from anchor after first buy", async () => {
      const config: TradingConfig = {
        dropPercentage: 0.03,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      const anchorPrice = 117500;
      const grid = await buyTriggerDetector.buildGridFromAnchor(
        anchorPrice,
        config,
      );

      // Verify grid is built from anchor with proper quantization
      expect(grid).toHaveLength(10);
      expect(grid[0]).toBe(113975); // 117500 * 0.97 = 113975
      expect(grid[1]).toBe(110450); // 117500 * 0.94 = 110450
      expect(grid[2]).toBe(106925); // 117500 * 0.91 = 106925

      // All levels should be below anchor
      grid.forEach((level) => {
        expect(level).toBeLessThan(anchorPrice);
      });

      // All levels should be quantized to tick size 0.01
      grid.forEach((level) => {
        // Check that level is effectively quantized (within floating point precision)
        const remainder = level % 0.01;
        expect(remainder < 0.00001 || remainder > 0.00999).toBe(true);
      });
    });
  });

  describe("Database Update Verification", () => {
    it("should update buy_index correctly when multiple levels triggered", async () => {
      // Set up state with buy_index already updated by BuyTriggerDetector
      const stateWithUpdatedIndex = {
        ...mockCycleState,
        buy_anchor_price: 117500,
        buy_grid: [113975, 110450, 106925, 103400, 99875],
        buy_index: 5, // Already updated by BuyTriggerDetector (2 + 3 levels)
        purchases_remaining: 8,
      };

      const updateSpy = jest
        .spyOn(StateTransactionManager.prototype, "updateStateAtomic")
        .mockImplementation(
          async (_botId: string, updates: Partial<CycleState>) => {
            // Verify buy_index is passed through as-is (already updated by BuyTriggerDetector)
            expect(updates.buy_index).toBe(5); // Already set before calling updateAfterBuyOrder
            expect(updates.purchases_remaining).toBe(5); // 8 - 3

            return {
              ...stateWithUpdatedIndex,
              ...updates,
            } as CycleState;
          },
        );

      const orderResult: OrderResult = {
        orderId: 12347,
        clientOrderId: "BUY_1234567892_abc125",
        status: "FILLED",
        executedQty: new Decimal("0.003"),
        cummulativeQuoteQty: new Decimal("300.00"),
        avgPrice: new Decimal("100000.00"),
        fills: [],
        feeBTC: new Decimal("0.000003"),
        feeUSDT: new Decimal("0"),
        feeOther: {},
      };

      await buyOrderUpdater.updateAfterBuyOrder(
        stateWithUpdatedIndex, // Use state with buy_index already set
        orderResult,
        3, // 3 levels triggered
        10, // maxPurchases
      );

      expect(updateSpy).toHaveBeenCalledTimes(1);
      updateSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle anchor price quantization correctly", async () => {
      const updateSpy = jest
        .spyOn(StateTransactionManager.prototype, "updateStateAtomic")
        .mockImplementation(
          async (_botId: string, updates: Partial<CycleState>) => {
            // Should quantize to tick size 0.01 using floor
            expect(updates.buy_anchor_price).toBe(117555.55);

            return {
              ...mockCycleState,
              ...updates,
            } as CycleState;
          },
        );

      const orderResult: OrderResult = {
        orderId: 12348,
        clientOrderId: "BUY_1234567893_abc126",
        status: "FILLED",
        executedQty: new Decimal("0.001"),
        cummulativeQuoteQty: new Decimal("117.56"),
        avgPrice: new Decimal("117555.5567"), // Non-quantized price
        fills: [],
        feeBTC: new Decimal("0.000001"),
        feeUSDT: new Decimal("0"),
        feeOther: {},
      };

      await buyOrderUpdater.updateAfterBuyOrder(
        mockCycleState,
        orderResult,
        1,
        10,
      );

      updateSpy.mockRestore();
    });

    it("should handle case where all remaining purchases are triggered", async () => {
      mockCycleState.buy_anchor_price = 117500;
      mockCycleState.buy_grid = [110000, 105000, 100000];
      mockCycleState.buy_index = 0;
      mockCycleState.purchases_remaining = 2; // Only 2 left
      mockCycleState.capital_available = 200; // Capital matching balance

      const config: TradingConfig = {
        dropPercentage: 0.03,
        risePercentage: 0.03,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
        maxPurchases: 10,
      };

      const candle: Candle = {
        close: 95000, // Would cross all 3 levels
        high: 100000,
        low: 94000,
        open: 100000,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances: BalanceInfo = {
        usdtSpot: 200,
        btcSpot: 0.001,
      };

      const buyTriggerState: BuyTriggerCycleState = {
        status: mockCycleState.status as "READY" | "HOLDING" | "PAUSED",
        ath_reference_price: mockCycleState.ath_reference_price,
        sell_reference_price: mockCycleState.sell_reference_price,
        purchases_remaining: mockCycleState.purchases_remaining,
        capital_available: mockCycleState.capital_available,
        buy_amount: mockCycleState.buy_amount,
        buy_anchor_price: mockCycleState.buy_anchor_price,
        btc_accumulated: mockCycleState.btc_accumulated || 0,
        buy_grid: mockCycleState.buy_grid,
        buy_index: mockCycleState.buy_index || 0,
      };

      const result = await buyTriggerDetector.checkBuyTrigger(
        buyTriggerState,
        config,
        candle,
        balances,
      );

      // Should limit to purchases remaining
      expect(result.shouldBuy).toBe(true);
      expect(result.levelsTriggered).toBe(2); // Limited by purchases_remaining
      expect(result.buyAmount).toBe(200); // All remaining capital
    });
  });
});
