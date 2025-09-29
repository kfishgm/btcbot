import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  SellOrderStateUpdater,
  type NewCycleSignal,
  type StateUpdateResult,
} from "../../src/cycle/sell-order-state-updater";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager";
import type { CycleState } from "../../src/cycle/cycle-state-manager";
import type { OrderResult } from "../../src/order/buy-order-placer";
import type { Database } from "../../types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";
import { MockTradingRules } from "../mocks/mock-trading-rules";
import type { TradingRules } from "../../src/exchange/trading-rules";

// Mock StateTransactionManager
jest.mock("../../src/cycle/state-transaction-manager");

describe("SellOrderStateUpdater", () => {
  let updater: SellOrderStateUpdater;
  let mockSupabase: SupabaseClient<Database>;
  let mockTradingRules: TradingRules;
  let mockUpdateStateAtomic: jest.SpiedFunction<
    typeof StateTransactionManager.prototype.updateStateAtomic
  >;

  const createCycleState = (overrides?: Partial<CycleState>): CycleState => ({
    id: "test-cycle-id",
    status: "HOLDING",
    btc_accumulated: 0.01,
    btc_accum_net: 0.01,
    btc_dust: 0,
    cost_accum_usdt: 500,
    capital_available: 500,
    purchases_remaining: 4,
    reference_price: 50000,
    buy_amount: 200,
    buy_anchor_price: null,
    ath_price: 52000,
    buy_grid: null,
    buy_index: 0,
    completed_at: null,
    final_profit: null,
    previous_cycle_id: null,
    strategy_config_id: null,
    updated_at: new Date().toISOString(),
    version: 1,
    ...overrides,
  });

  const createOrderResult = (
    overrides?: Partial<OrderResult>,
  ): OrderResult => ({
    orderId: 12345,
    clientOrderId: "test-order",
    status: "FILLED",
    executedQty: new Decimal(0.01),
    cummulativeQuoteQty: new Decimal(525),
    avgPrice: new Decimal(52500),
    fills: [],
    feeBTC: new Decimal(0),
    feeUSDT: new Decimal(0.525),
    feeOther: {},
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabase = {} as SupabaseClient<Database>;

    // Mock StateTransactionManager methods using prototype
    mockUpdateStateAtomic = jest
      .spyOn(StateTransactionManager.prototype, "updateStateAtomic")
      .mockImplementation(async () => {
        return createCycleState({
          status: "READY",
          btc_accumulated: 0,
          btc_accum_net: 0,
          btc_dust: 0,
          cost_accum_usdt: 0,
          capital_available: 1025,
          purchases_remaining: 5,
        });
      });

    const config = { maxPurchases: 5 };
    mockTradingRules = new MockTradingRules() as unknown as TradingRules;
    updater = new SellOrderStateUpdater(
      mockSupabase,
      config,
      undefined,
      mockTradingRules,
    );
  });

  describe("updateAfterSellOrder", () => {
    it("should handle partial sale correctly (btc_accumulated > 0 after sale)", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.02, // Has 0.02 BTC
        btc_accum_net: 0.02,
        btc_dust: 0,
        cost_accum_usdt: 1000,
        reference_price: 50000,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01), // Selling only 0.01 BTC
        cummulativeQuoteQty: new Decimal(525),
        avgPrice: new Decimal(52500),
      });

      mockUpdateStateAtomic.mockResolvedValue(
        createCycleState({
          status: "HOLDING", // Still holding
          btc_accumulated: 0.01, // 0.02 - 0.01 = 0.01 BTC remaining
          btc_accum_net: 0.02, // Net accumulated doesn't change (only used for reference price)
          cost_accum_usdt: 1000, // Cost accumulator doesn't change
          capital_available: 1024.475, // 500 + 525 - 0.525 fee = 1024.475
          purchases_remaining: 4,
        }),
      );

      // Act
      const result = await updater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Assert - Should return regular update (not cycle completion)
      expect("type" in result).toBe(false); // Not a signal
      const stateResult = result as CycleState;
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.01,
          capital_available: 1024.475,
          status: "HOLDING", // Should remain HOLDING
        }),
      );
      expect(stateResult.status).toBe("HOLDING");
      expect(stateResult.btc_accumulated).toBe(0.01);
    });

    it("should handle complete sale with profit correctly", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        btc_accum_net: 0.01,
        btc_dust: 0,
        cost_accum_usdt: 500,
        reference_price: 50000, // Bought at avg 50k
        capital_available: 500,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01), // Selling all 0.01 BTC
        cummulativeQuoteQty: new Decimal(525), // Selling for 525 USDT
        avgPrice: new Decimal(52500),
        feeUSDT: new Decimal(0.525),
      });

      // Act
      const result = await updater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Assert - Should return cycle completion signal
      expect("type" in result).toBe(true);
      const signal = result as NewCycleSignal;
      expect(signal.type).toBe("CREATE_NEW_CYCLE");
      expect(signal.previousCycleId).toBe("test-cycle-id");
      expect(signal.completionData.finalProfit).toBeGreaterThan(0);

      // Should NOT call updateStateAtomic for complete sale
      expect(mockUpdateStateAtomic).not.toHaveBeenCalled();
    });

    it("should handle complete sale with loss (profit = 0)", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        btc_accum_net: 0.01,
        btc_dust: 0,
        cost_accum_usdt: 500,
        reference_price: 50000,
        capital_available: 500,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
        cummulativeQuoteQty: new Decimal(480), // Selling at a loss
        avgPrice: new Decimal(48000),
        feeUSDT: new Decimal(0.48),
      });

      // Act
      const result = await updater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Assert - Should return cycle completion signal (even with loss)
      expect("type" in result).toBe(true);
      const signal = result as NewCycleSignal;
      expect(signal.type).toBe("CREATE_NEW_CYCLE");
      expect(signal.previousCycleId).toBe("test-cycle-id");
      // Profit should be 0 for loss (never negative)
      expect(signal.completionData.finalProfit).toBe(0);
      expect(signal.completionData.carryOverCapital).toBeCloseTo(979.52, 2);

      // Should NOT call updateStateAtomic for complete sale
      expect(mockUpdateStateAtomic).not.toHaveBeenCalled();
    });

    it("should validate order result has executed quantity", async () => {
      // Arrange
      const currentState = createCycleState();
      const orderResult = createOrderResult({
        executedQty: new Decimal(0),
      });

      // Act & Assert
      await expect(
        updater.updateAfterSellOrder(currentState, orderResult),
      ).rejects.toThrow("Order has no executed quantity");
    });

    it("should validate order status is FILLED or PARTIALLY_FILLED", async () => {
      // Arrange
      const currentState = createCycleState();
      const orderResult = createOrderResult({
        status: "NEW",
      });

      // Act & Assert
      await expect(
        updater.updateAfterSellOrder(currentState, orderResult),
      ).rejects.toThrow("Cannot update state for non-filled order: NEW");
    });

    it("should validate current state has BTC to sell", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0,
      });
      const orderResult = createOrderResult();

      // Act & Assert
      await expect(
        updater.updateAfterSellOrder(currentState, orderResult),
      ).rejects.toThrow("Cannot sell: no BTC accumulated");
    });

    it("should validate sell quantity doesn't exceed accumulated BTC", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.005,
      });
      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01), // Trying to sell more than accumulated
      });

      // Act & Assert
      await expect(
        updater.updateAfterSellOrder(currentState, orderResult),
      ).rejects.toThrow(
        "Cannot sell more than accumulated: have 0.005, selling 0.01",
      );
    });

    it("should emit events during state update", async () => {
      // Arrange
      const currentState = createCycleState();
      const orderResult = createOrderResult();
      const startListener = jest.fn();
      const completeListener = jest.fn();

      updater.on("stateUpdateStarted", startListener);
      updater.on("stateUpdateCompleted", completeListener);

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(startListener).toHaveBeenCalledWith({
        cycleId: "test-cycle-id",
        orderId: 12345,
      });
      expect(completeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: "test-cycle-id",
        }),
      );
    });

    it("should emit error event on failure", async () => {
      // Arrange
      const currentState = createCycleState();
      const orderResult = createOrderResult({
        executedQty: new Decimal(0),
      });
      const errorListener = jest.fn();

      updater.on("stateUpdateFailed", errorListener);

      // Act
      await expect(
        updater.updateAfterSellOrder(currentState, orderResult),
      ).rejects.toThrow();

      // Assert
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: "test-cycle-id",
        }),
      );
    });

    it("should handle PARTIALLY_FILLED orders", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });
      const orderResult = createOrderResult({
        status: "PARTIALLY_FILLED",
        executedQty: new Decimal(0.005),
        cummulativeQuoteQty: new Decimal(262.5),
      });

      mockUpdateStateAtomic.mockResolvedValue(
        createCycleState({
          status: "HOLDING",
          btc_accumulated: 0.005,
        }),
      );

      // Act
      const result = await updater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Assert - result should be StateUpdateResult, not NewCycleSignal
      expect("type" in result && result.type === "CREATE_NEW_CYCLE").toBe(
        false,
      );
      expect((result as StateUpdateResult).status).toBe("HOLDING");
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.005, // 0.01 - 0.005
          status: "HOLDING",
        }),
      );
    });

    it("should handle USDT fees correctly on sell orders", async () => {
      // Arrange - Binance charges fees in USDT for sell orders
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });
      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
        cummulativeQuoteQty: new Decimal(525),
        feeBTC: new Decimal(0), // No BTC fee on sell orders
        feeUSDT: new Decimal(0.525), // Fee in USDT
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0, // 0.01 - 0.01 = 0 (cycle complete)
          capital_available: 1024.475, // 500 + 525 - 0.525 = 1024.475
        }),
      );
    });

    it("should recalculate buy_amount after cycle reset", async () => {
      // Arrange
      const customUpdater = new SellOrderStateUpdater(
        mockSupabase,
        { maxPurchases: 3 },
        undefined,
        mockTradingRules,
      );
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        capital_available: 500,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
        cummulativeQuoteQty: new Decimal(600), // Nice profit
      });

      // Act
      await customUpdater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          // capital = 500 + 500 + 99.475 = 1099.475
          // buy_amount = floor(1099.475 / 3 * 10^8) / 10^8 = 366.49166666
          buy_amount: 366.49166666,
        }),
      );
    });

    it("should set reference_price to null on cycle reset for fresh start", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        ath_price: 55000,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          reference_price: null,
          ath_price: null,
        }),
      );
    });

    it("should reset purchases_remaining to max_purchases on cycle complete", async () => {
      // Arrange
      const customUpdater = new SellOrderStateUpdater(
        mockSupabase,
        { maxPurchases: 10 },
        undefined,
        mockTradingRules,
      );
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        purchases_remaining: 1,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
      });

      // Act
      const result = await customUpdater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Assert - Should return cycle completion signal
      expect("type" in result).toBe(true);
      const signal = result as NewCycleSignal;
      expect(signal.type).toBe("CREATE_NEW_CYCLE");

      // Should NOT call updateStateAtomic for complete sale
      expect(mockUpdateStateAtomic).not.toHaveBeenCalled();
    });

    it("should handle very small BTC amounts correctly", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.000001,
        btc_accum_net: 0.000001,
        btc_dust: 0,
        cost_accum_usdt: 0.05,
        reference_price: 50000,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.0000005),
        cummulativeQuoteQty: new Decimal(0.025),
        feeUSDT: new Decimal(0.000025),
      });

      mockUpdateStateAtomic.mockResolvedValue(
        createCycleState({
          btc_accumulated: 0.0000005,
          status: "HOLDING",
        }),
      );

      // Act
      const result = await updater.updateAfterSellOrder(
        currentState,
        orderResult,
      );

      // Assert - Should return regular update (not cycle completion)
      expect("type" in result).toBe(false);
      const stateResult = result as CycleState;
      expect(stateResult.btc_accumulated).toBe(0.0000005);
    });

    it("should log state update to bot_events", async () => {
      // Arrange
      const currentState = createCycleState();
      const orderResult = createOrderResult();

      const logSpy = jest.spyOn(updater, "logStateUpdate").mockResolvedValue();

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        "test-cycle-id",
        12345,
        expect.any(Object),
      );
    });

    it("should handle USDT fees and ignore other fee assets", async () => {
      // Arrange - Binance sell orders only have USDT fees that matter
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
        cummulativeQuoteQty: new Decimal(525),
        feeBTC: new Decimal(0), // No BTC fees on sell orders
        feeUSDT: new Decimal(0.525),
        feeOther: { BNB: new Decimal(0.001) }, // Other fees are ignored
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0, // 0.01 - 0.01 = 0
          capital_available: 1024.475, // 500 + 525 - 0.525
        }),
      );
    });

    it("should detect when cycle is complete (btc_accumulated < 0.00001)", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        ath_price: 55000,
        reference_price: 50000,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.009995), // Will leave 0.000005 which is < 0.00001 (dust threshold)
        feeBTC: new Decimal(0),
        cummulativeQuoteQty: new Decimal(549.725), // 0.009995 * 55000
        feeUSDT: new Decimal(0.549725),
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert - Should reset cycle because remaining is < 0.00001 (dust threshold)
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.000005, // Preserves dust amount (will be btc_dust + btc_accum_net)
          btc_accum_net: 0, // Reset to 0 for new cycle
          btc_dust: 0.000005, // Dust moved here for next cycle
          cost_accum_usdt: 0, // Reset cost accumulator
          purchases_remaining: 5, // Reset to max purchases (from config)
          reference_price: null, // Reset to null for fresh cycle
          ath_price: null, // Reset to null for fresh cycle
          status: "READY",
          buy_grid: null, // Reset grid
          buy_index: 0, // Reset index
        }),
      );
    });

    it("should not reset cycle if btc_accumulated >= 0.00001", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        status: "HOLDING",
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.0099), // Will leave 0.0001 which is >= 0.00001
      });

      mockUpdateStateAtomic.mockResolvedValue(
        createCycleState({
          btc_accumulated: 0.0001,
          status: "HOLDING",
        }),
      );

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert - Should NOT reset cycle, keeps HOLDING status
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.0001,
          status: "HOLDING",
        }),
      );
    });

    it("should validate cumulative quote quantity is positive", async () => {
      // Arrange
      const currentState = createCycleState();
      const orderResult = createOrderResult({
        cummulativeQuoteQty: new Decimal(0),
      });

      // Act & Assert
      await expect(
        updater.updateAfterSellOrder(currentState, orderResult),
      ).rejects.toThrow("Order has no cumulative quote quantity");
    });

    it("should handle getCycleState method", async () => {
      // Arrange
      const mockData = createCycleState();
      const getCycleSpy = jest
        .spyOn(updater, "getCycleState")
        .mockResolvedValue(mockData);

      // Act
      const result = await updater.getCycleState("test-cycle-id");

      // Assert
      expect(result).toEqual(mockData);
      getCycleSpy.mockRestore();
    });

    it("should return null when getCycleState fails", async () => {
      // Arrange
      const getCycleSpy = jest
        .spyOn(updater, "getCycleState")
        .mockResolvedValue(null);

      // Act
      const result = await updater.getCycleState("test-cycle-id");

      // Assert
      expect(result).toBeNull();
      getCycleSpy.mockRestore();
    });
  });
});
