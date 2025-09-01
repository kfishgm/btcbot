import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { SellOrderStateUpdater } from "../../src/cycle/sell-order-state-updater";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager";
import type { CycleState } from "../../src/cycle/cycle-state-manager";
import type { OrderResult } from "../../src/order/buy-order-placer";
import type { Database } from "../../types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";

// Mock StateTransactionManager
jest.mock("../../src/cycle/state-transaction-manager");

describe("SellOrderStateUpdater", () => {
  let updater: SellOrderStateUpdater;
  let mockSupabase: SupabaseClient<Database>;
  let mockUpdateStateAtomic: jest.SpiedFunction<
    typeof StateTransactionManager.prototype.updateStateAtomic
  >;

  const createCycleState = (overrides?: Partial<CycleState>): CycleState => ({
    id: "test-cycle-id",
    status: "HOLDING",
    btc_accumulated: 0.01,
    btc_accum_net: 0.01,
    cost_accum_usdt: 500,
    capital_available: 500,
    purchases_remaining: 4,
    reference_price: 50000,
    buy_amount: 200,
    ath_price: 52000,
    updated_at: new Date().toISOString(),
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
          cost_accum_usdt: 0,
          capital_available: 1025,
          purchases_remaining: 5,
        });
      });

    const config = { maxPurchases: 5 };
    updater = new SellOrderStateUpdater(mockSupabase, config);
  });

  describe("updateAfterSellOrder", () => {
    it("should handle partial sale correctly (btc_accumulated > 0 after sale)", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.02, // Has 0.02 BTC
        btc_accum_net: 0.02,
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

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.01,
          capital_available: 1024.475,
          status: "HOLDING", // Should remain HOLDING
        }),
      );
      expect(result.status).toBe("HOLDING");
      expect(result.btc_accumulated).toBe(0.01);
    });

    it("should handle complete sale with profit correctly", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        btc_accum_net: 0.01,
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

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0,
          btc_accum_net: 0,
          cost_accum_usdt: 0,
          // principal = 50000 * 0.01 = 500
          // net_received = 525 - 0.525 = 524.475
          // profit = max(0, 524.475 - 500) = 24.475
          // capital = 500 + 500 + 24.475 = 1024.475
          capital_available: 1024.475,
          purchases_remaining: 5,
          reference_price: 52000, // Reset to ATH
          buy_amount: 204, // floor(1024.475 / 5) = 204
          status: "READY",
        }),
      );

      expect(result.updateSummary).toEqual({
        btcSold: 0.01,
        usdtReceived: 524.475,
        principal: 500,
        profit: expect.closeTo(24.475, 5), // Handle floating point precision
        cycleComplete: true,
      });
    });

    it("should handle complete sale with loss (profit = 0)", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        btc_accum_net: 0.01,
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

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0,
          // principal = 50000 * 0.01 = 500
          // net_received = 480 - 0.48 = 479.52
          // profit = max(0, 479.52 - 500) = 0 (never negative)
          // capital = 500 + 500 + 0 = 1000
          capital_available: 1000,
          status: "READY",
        }),
      );

      expect(result.updateSummary?.profit).toBe(0);
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

      // Assert
      expect(result.status).toBe("HOLDING");
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.005, // 0.01 - 0.005
          status: "HOLDING",
        }),
      );
    });

    it("should handle BTC fees correctly", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });
      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
        cummulativeQuoteQty: new Decimal(525),
        feeBTC: new Decimal(0.00001), // Fee in BTC
        feeUSDT: new Decimal(0),
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.00001, // Should account for BTC fee (0.01 - 0.01 + 0.00001)
        }),
      );
    });

    it("should recalculate buy_amount after cycle reset", async () => {
      // Arrange
      const customUpdater = new SellOrderStateUpdater(mockSupabase, {
        maxPurchases: 3,
      });
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
          // buy_amount = floor(1099.475 / 3) = 366
          buy_amount: 366,
        }),
      );
    });

    it("should set reference_price to ATH on cycle reset", async () => {
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
          reference_price: 55000,
        }),
      );
    });

    it("should reset purchases_remaining to max_purchases on cycle complete", async () => {
      // Arrange
      const customUpdater = new SellOrderStateUpdater(mockSupabase, {
        maxPurchases: 10,
      });
      const currentState = createCycleState({
        btc_accumulated: 0.01,
        purchases_remaining: 1,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
      });

      // Act
      await customUpdater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          purchases_remaining: 10,
        }),
      );
    });

    it("should handle very small BTC amounts correctly", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.000001,
        btc_accum_net: 0.000001,
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

      // Assert
      expect(result.btc_accumulated).toBe(0.0000005);
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

    it("should handle mixed fee assets correctly", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.01),
        cummulativeQuoteQty: new Decimal(525),
        feeBTC: new Decimal(0.00001),
        feeUSDT: new Decimal(0.525),
        feeOther: { BNB: new Decimal(0.001) },
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.00001, // Account for BTC fee
          // capital should account for USDT fee but not other fees
        }),
      );
    });

    it("should detect when cycle is complete (btc_accumulated < 0.00000001)", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.009999995), // Will leave 0.000000005 which is < 0.00000001
        feeBTC: new Decimal(0),
      });

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert - Should reset cycle because remaining is < 0.00000001
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0,
          status: "READY",
        }),
      );
    });

    it("should not reset cycle if btc_accumulated >= 0.00000001", async () => {
      // Arrange
      const currentState = createCycleState({
        btc_accumulated: 0.01,
      });

      const orderResult = createOrderResult({
        executedQty: new Decimal(0.00999999),
      });

      mockUpdateStateAtomic.mockResolvedValue(
        createCycleState({
          btc_accumulated: 0.00000001,
          status: "HOLDING",
        }),
      );

      // Act
      await updater.updateAfterSellOrder(currentState, orderResult);

      // Assert - Should NOT reset cycle
      expect(mockUpdateStateAtomic).toHaveBeenCalledWith(
        "test-cycle-id",
        expect.objectContaining({
          btc_accumulated: 0.00000001,
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
