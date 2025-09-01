import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { BuyOrderStateUpdater } from "../../src/cycle/buy-order-state-updater";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import type { CycleState } from "../../src/cycle/cycle-state-manager";
import type { OrderResult } from "../../src/order/buy-order-placer";
import { Decimal } from "decimal.js";
import { createMockSupabaseClient } from "../mocks/supabase-mock";

describe("BuyOrderStateUpdater", () => {
  let updater: BuyOrderStateUpdater;
  let supabase: SupabaseClient<Database>;
  let mockCycleState: CycleState;
  let mockOrderResult: OrderResult;
  let mockUpdateStateAtomic: jest.SpiedFunction<
    typeof StateTransactionManager.prototype.updateStateAtomic
  >;

  beforeEach(() => {
    // Clear the mock implementation
    jest.clearAllMocks();

    // Spy on the StateTransactionManager's updateStateAtomic method
    mockUpdateStateAtomic = jest
      .spyOn(StateTransactionManager.prototype, "updateStateAtomic")
      .mockImplementation(async () => {
        // Return undefined by default, tests will override as needed
        return {} as CycleState;
      });

    // Setup mock Supabase client
    supabase = createMockSupabaseClient({
      cycle_state: {
        update: { data: null, error: null },
      },
      bot_events: {
        insert: { data: null, error: null },
      },
    });

    // Setup initial cycle state
    mockCycleState = {
      id: "test-cycle-id",
      status: "READY",
      capital_available: 1000.0,
      btc_accumulated: 0,
      purchases_remaining: 5,
      reference_price: null,
      cost_accum_usdt: 0,
      btc_accum_net: 0,
      ath_price: 50000.0,
      buy_amount: 200.0,
      updated_at: new Date().toISOString(),
    };

    // Setup mock order result
    mockOrderResult = {
      orderId: 12345,
      clientOrderId: "BUY_1234567890_abc123",
      status: "FILLED",
      executedQty: new Decimal("0.01"),
      cummulativeQuoteQty: new Decimal("500.00"),
      avgPrice: new Decimal("50000.00"),
      fills: [
        {
          price: "50000.00",
          qty: "0.01",
          commission: "0.00001",
          commissionAsset: "BTC",
        },
      ],
      feeBTC: new Decimal("0.00001"),
      feeUSDT: new Decimal("0"),
      feeOther: {},
    };

    // Create the updater instance
    updater = new BuyOrderStateUpdater(supabase);
  });

  afterEach(() => {
    // Restore the spy
    mockUpdateStateAtomic.mockRestore();
  });

  describe("updateAfterBuyOrder", () => {
    it("should update btc_accumulated correctly (filled - fee)", async () => {
      // Arrange
      const expectedBtcAccumulated = 0.00999; // 0.01 - 0.00001
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: expectedBtcAccumulated,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.btc_accumulated).toBe(expectedBtcAccumulated);
    });

    it("should update cost_accum_usdt correctly (usdt_spent + all_fees_in_usdt)", async () => {
      // Arrange
      // USDT spent = 500.00
      // BTC fee in USDT = 0.00001 * 50000 = 0.50
      // Total = 500.50
      const expectedCostAccum = 500.5;
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: expectedCostAccum,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.cost_accum_usdt).toBe(expectedCostAccum);
    });

    it("should update btc_accum_net correctly (filled - fee)", async () => {
      // Arrange
      const expectedBtcAccumNet = 0.00999; // 0.01 - 0.00001
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: expectedBtcAccumNet,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.btc_accum_net).toBe(expectedBtcAccumNet);
    });

    it("should decrease capital_available by usdt_spent", async () => {
      // Arrange
      const expectedCapital = 500.0; // 1000 - 500
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: expectedCapital,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.capital_available).toBe(expectedCapital);
    });

    it("should decrease purchases_remaining by 1", async () => {
      // Arrange
      const expectedPurchasesRemaining = 4; // 5 - 1
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: expectedPurchasesRemaining,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.purchases_remaining).toBe(expectedPurchasesRemaining);
    });

    it("should change status from READY to HOLDING", async () => {
      // Arrange
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.status).toBe("HOLDING");
    });

    it("should recalculate reference_price correctly", async () => {
      // Arrange
      // cost_accum_usdt = 500.50
      // btc_accum_net = 0.00999
      // reference_price = 500.50 / 0.00999 = 50150.15 (rounded to 2 decimals)
      const expectedReferencePrice = 50150.15;
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: expectedReferencePrice,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.reference_price).toBe(expectedReferencePrice);
    });

    it("should handle subsequent buy orders (already HOLDING)", async () => {
      // Arrange
      mockCycleState.status = "HOLDING";
      mockCycleState.btc_accumulated = 0.005;
      mockCycleState.cost_accum_usdt = 250.0;
      mockCycleState.btc_accum_net = 0.00495;
      mockCycleState.reference_price = 50505.05;

      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.01499, // 0.005 + 0.00999
        cost_accum_usdt: 750.5, // 250 + 500.50
        btc_accum_net: 0.01494, // 0.00495 + 0.00999
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50234.48, // recalculated
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.status).toBe("HOLDING");
      expect(result.btc_accumulated).toBe(0.01499);
      expect(result.cost_accum_usdt).toBe(750.5);
      expect(result.btc_accum_net).toBe(0.01494);
    });

    it("should handle orders with USDT fees", async () => {
      // Arrange
      mockOrderResult.feeUSDT = new Decimal("2.50");
      mockOrderResult.feeBTC = new Decimal("0");

      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.01, // No BTC fee
        cost_accum_usdt: 502.5, // 500 + 2.50
        btc_accum_net: 0.01, // No BTC fee
        capital_available: 497.5, // 1000 - 500 - 2.50 (includes USDT fee)
        purchases_remaining: 4,
        reference_price: 50250.0,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.cost_accum_usdt).toBe(502.5);
      expect(result.btc_accumulated).toBe(0.01);
      expect(result.btc_accum_net).toBe(0.01);
    });

    it("should handle orders with both BTC and USDT fees", async () => {
      // Arrange
      mockOrderResult.feeUSDT = new Decimal("1.50");
      mockOrderResult.feeBTC = new Decimal("0.00001");

      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 502.0, // 500 + 1.50 + (0.00001 * 50000) = 502.00
        btc_accum_net: 0.00999,
        capital_available: 498.5, // 1000 - 500 - 1.50 (includes USDT fee)
        purchases_remaining: 4,
        reference_price: 50250.25,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.cost_accum_usdt).toBe(502.0);
      expect(result.btc_accumulated).toBe(0.00999);
      expect(result.btc_accum_net).toBe(0.00999);
    });

    it("should handle very small BTC amounts with precision", async () => {
      // Arrange
      mockOrderResult.executedQty = new Decimal("0.00000100");
      mockOrderResult.feeBTC = new Decimal("0.00000001");
      mockOrderResult.cummulativeQuoteQty = new Decimal("0.05");

      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00000099,
        cost_accum_usdt: 0.0505, // 0.05 + (0.00000001 * 50000)
        btc_accum_net: 0.00000099,
        capital_available: 999.95,
        purchases_remaining: 4,
        reference_price: 51010.1,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.btc_accumulated).toBe(0.00000099);
      expect(result.btc_accum_net).toBe(0.00000099);
    });

    it("should throw error if purchases_remaining is already 0", async () => {
      // Arrange
      mockCycleState.purchases_remaining = 0;

      // Act & Assert
      await expect(
        updater.updateAfterBuyOrder(mockCycleState, mockOrderResult),
      ).rejects.toThrow("Cannot update state: no purchases remaining");
    });

    it("should throw error if capital_available is insufficient", async () => {
      // Arrange
      mockCycleState.capital_available = 100.0; // Less than order cost of 500

      // Act & Assert
      await expect(
        updater.updateAfterBuyOrder(mockCycleState, mockOrderResult),
      ).rejects.toThrow("Insufficient capital");
    });

    it("should throw error if order status is not FILLED", async () => {
      // Arrange
      mockOrderResult.status = "CANCELED";

      // Act & Assert
      await expect(
        updater.updateAfterBuyOrder(mockCycleState, mockOrderResult),
      ).rejects.toThrow("Cannot update state for non-filled order");
    });

    it("should handle partial fills correctly", async () => {
      // Arrange
      mockOrderResult.status = "PARTIALLY_FILLED";
      mockOrderResult.executedQty = new Decimal("0.005");
      mockOrderResult.cummulativeQuoteQty = new Decimal("250.00");

      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00499, // 0.005 - 0.00001
        cost_accum_usdt: 250.5, // 250 + (0.00001 * 50000)
        btc_accum_net: 0.00499,
        capital_available: 750.0, // 1000 - 250
        purchases_remaining: 4, // Still count as one purchase used
        reference_price: 50200.4,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.btc_accumulated).toBe(0.00499);
      expect(result.capital_available).toBe(750.0);
      expect(result.purchases_remaining).toBe(4);
    });

    it("should use database transaction for atomic updates", async () => {
      // Arrange
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      await updater.updateAfterBuyOrder(mockCycleState, mockOrderResult);

      // Assert
      expect(mockUpdateStateAtomic).toHaveBeenCalledTimes(1);
      expect(mockUpdateStateAtomic).toHaveBeenCalled();
    });

    it("should rollback on database error", async () => {
      // Arrange
      mockUpdateStateAtomic.mockRejectedValue(new Error("Database error"));

      // Act & Assert
      await expect(
        updater.updateAfterBuyOrder(mockCycleState, mockOrderResult),
      ).rejects.toThrow("Database error");
    });

    it("should preserve other cycle state fields unchanged", async () => {
      // Arrange
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.id).toBe(mockCycleState.id);
      expect(result.ath_price).toBe(mockCycleState.ath_price);
      expect(result.buy_amount).toBe(mockCycleState.buy_amount);
      expect(result.updated_at).toBe(mockCycleState.updated_at);
    });

    it("should handle orders with other fee currencies", async () => {
      // Arrange
      mockOrderResult.feeOther = {
        BNB: new Decimal("0.001"),
      };

      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5, // Should still update correctly, ignoring non-BTC/USDT fees
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.cost_accum_usdt).toBe(500.5);
      expect(result.btc_accumulated).toBe(0.00999);
    });

    it("should round reference price to 2 decimal places", async () => {
      // Arrange
      mockOrderResult.executedQty = new Decimal("0.00333333");
      mockOrderResult.feeBTC = new Decimal("0.00000033");
      mockOrderResult.cummulativeQuoteQty = new Decimal("166.6665");

      const expectedReferencePrice = 50016.31; // Properly rounded to 2 decimals
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.003333,
        cost_accum_usdt: 166.683, // 166.6665 + (0.00000033 * 50000)
        btc_accum_net: 0.003333,
        capital_available: 833.3335,
        purchases_remaining: 4,
        reference_price: expectedReferencePrice,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.reference_price).toBe(expectedReferencePrice);
    });

    it("should emit events for monitoring", async () => {
      // Arrange
      const emitSpy = jest.spyOn(updater, "emit");
      const expectedUpdatedState = {
        ...mockCycleState,
        btc_accumulated: 0.00999,
        cost_accum_usdt: 500.5,
        btc_accum_net: 0.00999,
        capital_available: 500.0,
        purchases_remaining: 4,
        reference_price: 50150.15,
        status: "HOLDING" as const,
      };

      mockUpdateStateAtomic.mockResolvedValue(expectedUpdatedState);

      // Act
      await updater.updateAfterBuyOrder(mockCycleState, mockOrderResult);

      // Assert
      expect(emitSpy).toHaveBeenCalledWith("stateUpdateStarted", {
        cycleId: mockCycleState.id,
        orderId: mockOrderResult.orderId,
      });
      expect(emitSpy).toHaveBeenCalledWith(
        "stateUpdateCompleted",
        expect.objectContaining({
          cycleId: mockCycleState.id,
          updates: expect.any(Object),
        }),
      );
    });

    it("should log errors when update fails", async () => {
      // Arrange
      const error = new Error("Update failed");
      mockUpdateStateAtomic.mockRejectedValue(error);
      const emitSpy = jest.spyOn(updater, "emit");

      // Act & Assert
      await expect(
        updater.updateAfterBuyOrder(mockCycleState, mockOrderResult),
      ).rejects.toThrow("Update failed");

      expect(emitSpy).toHaveBeenCalledWith("stateUpdateFailed", {
        cycleId: mockCycleState.id,
        error,
      });
    });
  });

  describe("validateOrderResult", () => {
    it("should validate order has executed quantity", () => {
      // Arrange
      const invalidOrder = {
        ...mockOrderResult,
        executedQty: new Decimal("0"),
      };

      // Act & Assert
      expect(() => updater.validateOrderResult(invalidOrder)).toThrow(
        "Order has no executed quantity",
      );
    });

    it("should validate order has positive cumulative quote", () => {
      // Arrange
      const invalidOrder = {
        ...mockOrderResult,
        cummulativeQuoteQty: new Decimal("0"),
      };

      // Act & Assert
      expect(() => updater.validateOrderResult(invalidOrder)).toThrow(
        "Order has no cumulative quote quantity",
      );
    });

    it("should pass validation for valid order", () => {
      // Act & Assert
      expect(() => updater.validateOrderResult(mockOrderResult)).not.toThrow();
    });
  });

  describe("calculateUpdates", () => {
    it("should calculate all updates correctly", () => {
      // Act
      const updates = updater.calculateUpdates(mockCycleState, mockOrderResult);

      // Assert
      expect(updates.btc_accumulated).toBe(0.00999);
      expect(updates.cost_accum_usdt).toBe(500.5);
      expect(updates.btc_accum_net).toBe(0.00999);
      expect(updates.capital_available).toBe(500.0);
      expect(updates.purchases_remaining).toBe(4);
      expect(updates.reference_price).toBe(50100.1);
      expect(updates.status).toBe("HOLDING");
    });

    it("should maintain existing accumulators", () => {
      // Arrange
      mockCycleState.btc_accumulated = 0.01;
      mockCycleState.cost_accum_usdt = 500.0;
      mockCycleState.btc_accum_net = 0.0099;

      // Act
      const updates = updater.calculateUpdates(mockCycleState, mockOrderResult);

      // Assert
      expect(updates.btc_accumulated).toBe(0.01999); // 0.01 + 0.00999
      expect(updates.cost_accum_usdt).toBe(1000.5); // 500 + 500.5
      expect(updates.btc_accum_net).toBe(0.01989); // 0.0099 + 0.00999
    });
  });
});
