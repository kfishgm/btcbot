import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { BuyOrderStateUpdater } from "../../src/cycle/buy-order-state-updater";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import type { CycleState } from "../../src/cycle/cycle-state-manager";
import type { OrderResult } from "../../src/order/buy-order-placer";
import { Decimal } from "decimal.js";
import { createMockSupabaseClient } from "../mocks/supabase-mock";

jest.mock("../../src/cycle/state-transaction-manager");

describe("BuyOrderStateUpdater", () => {
  let updater: BuyOrderStateUpdater;
  let supabase: SupabaseClient<Database>;
  let mockTransactionManager: jest.Mocked<StateTransactionManager>;
  let mockCycleState: CycleState;
  let mockOrderResult: OrderResult;

  beforeEach(() => {
    // Setup mock Supabase client
    supabase = createMockSupabaseClient();

    // Setup mock transaction manager
    mockTransactionManager = {
      executeTransaction: jest.fn(),
    } as unknown as jest.Mocked<StateTransactionManager>;
    (StateTransactionManager as jest.Mock).mockImplementation(
      () => mockTransactionManager,
    );

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
      created_at: new Date().toISOString(),
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

  describe("updateAfterBuyOrder", () => {
    it("should update btc_accumulated correctly (filled - fee)", async () => {
      // Arrange
      const expectedBtcAccumulated = 0.00999; // 0.01 - 0.00001

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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
      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.status).toBe("HOLDING");
      expect(result.btc_accumulated).toBe(0.01499); // 0.005 + 0.00999
      expect(result.cost_accum_usdt).toBe(750.5); // 250 + 500.50
      expect(result.btc_accum_net).toBe(0.01494); // 0.00495 + 0.00999
    });

    it("should handle orders with USDT fees", async () => {
      // Arrange
      mockOrderResult.feeUSDT = new Decimal("2.50");
      mockOrderResult.feeBTC = new Decimal("0");

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.cost_accum_usdt).toBe(502.5); // 500 + 2.50
      expect(result.btc_accumulated).toBe(0.01); // No BTC fee
      expect(result.btc_accum_net).toBe(0.01); // No BTC fee
    });

    it("should handle orders with both BTC and USDT fees", async () => {
      // Arrange
      mockOrderResult.feeUSDT = new Decimal("1.50");
      mockOrderResult.feeBTC = new Decimal("0.00001");

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      // USDT: 500 + 1.50 + (0.00001 * 50000) = 502.00
      expect(result.cost_accum_usdt).toBe(502.0);
      expect(result.btc_accumulated).toBe(0.00999);
      expect(result.btc_accum_net).toBe(0.00999);
    });

    it("should handle very small BTC amounts with precision", async () => {
      // Arrange
      mockOrderResult.executedQty = new Decimal("0.00000100");
      mockOrderResult.feeBTC = new Decimal("0.00000001");
      mockOrderResult.cummulativeQuoteQty = new Decimal("0.05");

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.btc_accumulated).toBe(0.00499); // 0.005 - 0.00001
      expect(result.capital_available).toBe(750.0); // 1000 - 250
      expect(result.purchases_remaining).toBe(4); // Still count as one purchase used
    });

    it("should use database transaction for atomic updates", async () => {
      // Arrange
      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      await updater.updateAfterBuyOrder(mockCycleState, mockOrderResult);

      // Assert
      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledTimes(
        1,
      );
      expect(mockTransactionManager.executeTransaction).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("should rollback on database error", async () => {
      // Arrange
      mockTransactionManager.executeTransaction.mockRejectedValue(
        new Error("Database error"),
      );

      // Act & Assert
      await expect(
        updater.updateAfterBuyOrder(mockCycleState, mockOrderResult),
      ).rejects.toThrow("Database error");
    });

    it("should preserve other cycle state fields unchanged", async () => {
      // Arrange
      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      expect(result.id).toBe(mockCycleState.id);
      expect(result.ath_price).toBe(mockCycleState.ath_price);
      expect(result.buy_amount).toBe(mockCycleState.buy_amount);
      expect(result.created_at).toBe(mockCycleState.created_at);
    });

    it("should handle orders with other fee currencies", async () => {
      // Arrange
      mockOrderResult.feeOther = {
        BNB: new Decimal("0.001"),
      };

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      // Should still update correctly, ignoring non-BTC/USDT fees for accumulator
      expect(result.cost_accum_usdt).toBe(500.5);
      expect(result.btc_accumulated).toBe(0.00999);
    });

    it("should round reference price to 2 decimal places", async () => {
      // Arrange
      mockOrderResult.executedQty = new Decimal("0.00333333");
      mockOrderResult.feeBTC = new Decimal("0.00000033");
      mockOrderResult.cummulativeQuoteQty = new Decimal("166.6665");

      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

      // Act
      const result = await updater.updateAfterBuyOrder(
        mockCycleState,
        mockOrderResult,
      );

      // Assert
      const expectedReferencePrice = 50016.31; // Properly rounded to 2 decimals
      expect(result.reference_price).toBe(expectedReferencePrice);
    });

    it("should emit events for monitoring", async () => {
      // Arrange
      const emitSpy = jest.spyOn(updater, "emit");
      mockTransactionManager.executeTransaction.mockImplementation(
        async (callback) => {
          const result = await callback();
          return result;
        },
      );

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
      mockTransactionManager.executeTransaction.mockRejectedValue(error);
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
      expect(updates.reference_price).toBe(50150.15);
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
