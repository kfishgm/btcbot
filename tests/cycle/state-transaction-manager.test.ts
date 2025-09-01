import type {
  StateTransactionManager,
  StateTransactionManagerConfig,
  RetryOptions,
} from "../../src/cycle/state-transaction-manager.js";
import type { CycleState } from "../../src/cycle/cycle-state-manager.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";

// Mock Supabase client
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(),
}));

// Type definitions for the manager's error classes
interface StateTransactionError extends Error {
  context?: {
    botId: string;
    updates?: Partial<CycleState>;
    operation: string;
  };
}

describe("StateTransactionManager", () => {
  let manager: StateTransactionManager;
  let mockSupabase: jest.Mocked<SupabaseClient<Database>>;
  let mockTransaction: {
    commit: jest.Mock;
    rollback: jest.Mock;
    from: jest.Mock;
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    eq: jest.Mock;
    single: jest.Mock;
  };

  beforeEach(() => {
    // Setup mock transaction
    mockTransaction = {
      commit: jest.fn().mockResolvedValue({ error: null }),
      rollback: jest.fn().mockResolvedValue({ error: null }),
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    // Setup mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      transaction: jest.fn((callback) => callback(mockTransaction)),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as jest.Mocked<SupabaseClient<Database>>;

    (createClient as jest.Mock).mockReturnValue(mockSupabase);

    manager = new StateTransactionManager(mockSupabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Atomic Updates", () => {
    it("should wrap state changes in a database transaction", async () => {
      const botId = "bot-123";
      const newState: Partial<CycleState> = {
        currentPrice: 50000,
        positionType: "LONG",
        lastUpdateTime: Date.now(),
      };

      await manager.updateStateAtomic(botId, newState);

      expect(mockSupabase.transaction).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it("should update multiple state fields atomically", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
        positionType: "LONG",
        positionSize: 0.001,
        entryPrice: 49500,
        lastUpdateTime: Date.now(),
      };

      await manager.updateStateAtomic(botId, updates);

      // All updates should happen within the same transaction
      expect(mockSupabase.transaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.from).toHaveBeenCalledWith("bot_states");
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining(updates),
        }),
      );
    });

    it("should fail all updates if any update fails", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
        positionType: "LONG",
      };

      mockTransaction.update.mockRejectedValueOnce(
        new Error("Validation failed"),
      );

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow(
        "Validation failed",
      );
      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });
  });

  describe("Write-Ahead Logging", () => {
    it("should save state to database BEFORE placing orders", async () => {
      const botId = "bot-123";
      const orderDetails = {
        symbol: "BTC/USDT",
        side: "buy" as const,
        amount: 0.001,
        price: 50000,
      };
      const stateUpdate: Partial<CycleState> = {
        pendingOrderId: "order-456",
        positionType: "LONG",
      };

      const callOrder: string[] = [];

      // Mock to track call order
      mockTransaction.insert.mockImplementation(() => {
        callOrder.push("state-saved");
        return mockTransaction;
      });

      const mockOrderCallback = jest.fn(() => {
        callOrder.push("order-placed");
        return Promise.resolve({ id: "order-456", status: "filled" });
      });

      await manager.executeWithWriteAheadLog(
        botId,
        stateUpdate,
        mockOrderCallback,
        orderDetails,
      );

      // Verify write-ahead log was written first
      expect(callOrder).toEqual(["state-saved", "order-placed"]);
      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "write_ahead_log",
          details: expect.objectContaining({
            state_update: stateUpdate,
            order_details: orderDetails,
          }),
        }),
      );
    });

    it("should not place order if state save fails", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        pendingOrderId: "order-456",
      };

      mockTransaction.insert.mockRejectedValueOnce(new Error("Database error"));
      const mockOrderCallback = jest.fn();

      await expect(
        manager.executeWithWriteAheadLog(
          botId,
          stateUpdate,
          mockOrderCallback,
          {},
        ),
      ).rejects.toThrow("Database error");

      expect(mockOrderCallback).not.toHaveBeenCalled();
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it("should mark write-ahead log as completed after successful order", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        positionType: "LONG",
      };

      const mockOrderCallback = jest
        .fn()
        .mockResolvedValue({ id: "order-456" });

      await manager.executeWithWriteAheadLog(
        botId,
        stateUpdate,
        mockOrderCallback,
        {},
      );

      // Should update the write-ahead log entry to completed
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "completed",
          completed_at: expect.any(String),
        }),
      );
    });
  });

  describe("Rollback on Failure", () => {
    it("should rollback transaction on state update failure", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: -1, // Invalid price
      };

      mockTransaction.update.mockRejectedValueOnce(new Error("Invalid price"));

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow(
        "Invalid price",
      );
      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });

    it("should preserve previous state after rollback", async () => {
      const botId = "bot-123";
      const originalState: CycleState = {
        currentPrice: 45000,
        positionType: "LONG",
        positionSize: 0.001,
        entryPrice: 44000,
        lastUpdateTime: Date.now(),
        athPrice: 50000,
        dipThreshold: 48000,
        stopLossPrice: 43000,
        pendingOrderId: null,
        version: 5,
      };

      // First, get the current state
      (mockSupabase.from().select().single as jest.Mock).mockResolvedValueOnce({
        data: { state: originalState },
        error: null,
      });

      const currentState = await manager.getState(botId);
      expect(currentState).toEqual(originalState);

      // Try to update with invalid data
      mockTransaction.update.mockRejectedValueOnce(new Error("Update failed"));

      await expect(
        manager.updateStateAtomic(botId, { currentPrice: -1 }),
      ).rejects.toThrow("Update failed");

      // Verify state is unchanged after rollback
      (mockSupabase.from().select().single as jest.Mock).mockResolvedValueOnce({
        data: { state: originalState },
        error: null,
      });

      const stateAfterRollback = await manager.getState(botId);
      expect(stateAfterRollback).toEqual(originalState);
    });

    it("should rollback all changes in a multi-step transaction", async () => {
      const botId = "bot-123";

      const operations = [
        { type: "update_state", data: { currentPrice: 50000 } },
        { type: "log_event", data: { event: "price_updated" } },
        { type: "update_metrics", data: { profit: 100 } },
      ];

      // Make the third operation fail
      let operationCount = 0;
      mockTransaction.insert.mockImplementation(() => {
        operationCount++;
        if (operationCount === 3) {
          throw new Error("Metrics update failed");
        }
        return mockTransaction;
      });

      await expect(
        manager.executeMultipleOperations(botId, operations),
      ).rejects.toThrow("Metrics update failed");

      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });
  });

  describe("Optimistic Locking", () => {
    it("should use version field for optimistic locking", async () => {
      const botId = "bot-123";
      const currentVersion = 5;
      const updates: Partial<CycleState> = {
        currentPrice: 51000,
      };

      await manager.updateStateWithVersion(botId, updates, currentVersion);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining(updates),
          version: currentVersion + 1,
        }),
      );

      // Should check version in WHERE clause
      expect(mockTransaction.eq).toHaveBeenCalledWith(
        "version",
        currentVersion,
      );
    });

    it("should fail update if version has changed (concurrent update)", async () => {
      const botId = "bot-123";
      const expectedVersion = 5;
      const updates: Partial<CycleState> = {
        currentPrice: 51000,
      };

      // Simulate no rows updated (version mismatch)
      (mockTransaction.update().eq() as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });

      await expect(
        manager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow("Concurrent update detected");
    });

    it("should handle concurrent updates from multiple instances", async () => {
      const botId = "bot-123";
      const initialVersion = 5;

      // Simulate two concurrent update attempts
      const update1 = { currentPrice: 51000 };
      const update2 = { currentPrice: 52000 };

      // First update succeeds
      (mockTransaction.update().eq() as jest.Mock).mockResolvedValueOnce({
        data: { version: initialVersion + 1 },
        error: null,
        count: 1,
      });

      // Second update fails due to version mismatch
      (mockTransaction.update().eq() as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });

      const result1 = await manager.updateStateWithVersion(
        botId,
        update1,
        initialVersion,
      );
      expect(result1.version).toBe(initialVersion + 1);

      await expect(
        manager.updateStateWithVersion(botId, update2, initialVersion),
      ).rejects.toThrow("Concurrent update detected");
    });

    it("should automatically increment version on successful update", async () => {
      const botId = "bot-123";
      const currentVersion = 10;
      const updates: Partial<CycleState> = {
        positionType: "SHORT",
      };

      (mockTransaction.update().eq() as jest.Mock).mockResolvedValueOnce({
        data: {
          state: { ...updates },
          version: currentVersion + 1,
        },
        error: null,
        count: 1,
      });

      const result = await manager.updateStateWithVersion(
        botId,
        updates,
        currentVersion,
      );

      expect(result.version).toBe(currentVersion + 1);
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          version: currentVersion + 1,
        }),
      );
    });
  });

  describe("Retry Logic", () => {
    it("should retry on deadlock errors", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      let attemptCount = 0;
      mockTransaction.update.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("deadlock detected");
        }
        return mockTransaction;
      });

      const retryOptions: RetryOptions = { maxRetries: 3 };
      await manager.updateStateWithRetry(botId, updates, retryOptions);

      expect(attemptCount).toBe(2);
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it("should use exponential backoff for retries", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      let attemptCount = 0;
      const attemptTimes: number[] = [];

      mockTransaction.update.mockImplementation(() => {
        attemptCount++;
        attemptTimes.push(Date.now());
        if (attemptCount < 3) {
          throw new Error("deadlock detected");
        }
        return mockTransaction;
      });

      const retryOptions: RetryOptions = {
        maxRetries: 3,
        initialDelayMs: 100,
      };
      await manager.updateStateWithRetry(botId, updates, retryOptions);

      // Check exponential backoff delays
      expect(attemptCount).toBe(3);
      if (attemptTimes.length >= 3) {
        const delay1 = attemptTimes[1] - attemptTimes[0];
        const delay2 = attemptTimes[2] - attemptTimes[1];

        // Second retry should have longer delay than first (exponential backoff)
        expect(delay2).toBeGreaterThan(delay1);
        expect(delay1).toBeGreaterThanOrEqual(100);
        expect(delay2).toBeGreaterThanOrEqual(200);
      }
    });

    it("should fail after max retries exceeded", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      mockTransaction.update.mockImplementation(() => {
        throw new Error("deadlock detected");
      });

      const retryOptions: RetryOptions = { maxRetries: 3 };
      await expect(
        manager.updateStateWithRetry(botId, updates, retryOptions),
      ).rejects.toThrow("Max retries exceeded");

      // Should have attempted 3 times + 1 initial attempt
      expect(mockTransaction.update).toHaveBeenCalledTimes(4);
    });

    it("should only retry on retryable errors", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      mockTransaction.update.mockImplementation(() => {
        throw new Error("Invalid input data");
      });

      const retryOptions: RetryOptions = { maxRetries: 3 };
      await expect(
        manager.updateStateWithRetry(botId, updates, retryOptions),
      ).rejects.toThrow("Invalid input data");

      // Should not retry for non-retryable errors
      expect(mockTransaction.update).toHaveBeenCalledTimes(1);
    });

    it("should handle timeout errors with retry", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      let attemptCount = 0;
      mockTransaction.update.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Connection timeout");
        }
        return mockTransaction;
      });

      const retryOptions: RetryOptions = { maxRetries: 3 };
      await manager.updateStateWithRetry(botId, updates, retryOptions);

      expect(attemptCount).toBe(2);
      expect(mockTransaction.commit).toHaveBeenCalled();
    });
  });

  describe("Audit Trail", () => {
    it("should log all state changes to bot_events table", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
        positionType: "LONG",
      };

      await manager.updateStateAtomic(botId, updates);

      expect(mockTransaction.from).toHaveBeenCalledWith("bot_events");
      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "state_change",
          details: expect.objectContaining({
            changes: updates,
            timestamp: expect.any(String),
          }),
        }),
      );
    });

    it("should include before and after state in audit log", async () => {
      const botId = "bot-123";
      const beforeState: CycleState = {
        currentPrice: 45000,
        positionType: "NONE",
        positionSize: 0,
        entryPrice: 0,
        lastUpdateTime: Date.now() - 10000,
        athPrice: 45000,
        dipThreshold: 43000,
        stopLossPrice: 0,
        pendingOrderId: null,
        version: 1,
      };

      const updates: Partial<CycleState> = {
        currentPrice: 50000,
        positionType: "LONG",
        positionSize: 0.001,
      };

      // Mock getting current state
      (
        mockTransaction.from().select().single as jest.Mock
      ).mockResolvedValueOnce({
        data: { state: beforeState },
        error: null,
      });

      await manager.updateStateAtomic(botId, updates);

      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "state_change",
          details: expect.objectContaining({
            before: beforeState,
            after: expect.objectContaining({
              ...beforeState,
              ...updates,
            }),
            changes: updates,
          }),
        }),
      );
    });

    it("should log failed state change attempts", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: -1, // Invalid
      };

      mockTransaction.update.mockRejectedValueOnce(new Error("Invalid price"));

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow();

      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "state_change_failed",
          details: expect.objectContaining({
            attempted_changes: updates,
            error: "Invalid price",
          }),
        }),
      );
    });

    it("should log rollback events", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      mockTransaction.update.mockRejectedValueOnce(new Error("Database error"));

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow();

      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "transaction_rollback",
          details: expect.objectContaining({
            reason: "Database error",
            attempted_changes: updates,
          }),
        }),
      );
    });

    it("should create audit trail for version conflicts", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };
      const expectedVersion = 5;

      // Simulate version mismatch
      (mockTransaction.update().eq() as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });

      await expect(
        manager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow("Concurrent update detected");

      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "version_conflict",
          details: expect.objectContaining({
            expected_version: expectedVersion,
            attempted_changes: updates,
          }),
        }),
      );
    });

    it("should log write-ahead log lifecycle events", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        positionType: "LONG",
      };

      const mockOrderCallback = jest
        .fn()
        .mockResolvedValue({ id: "order-456" });

      await manager.executeWithWriteAheadLog(
        botId,
        stateUpdate,
        mockOrderCallback,
        {},
      );

      // Should log WAL creation
      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "write_ahead_log",
        }),
      );

      // Should log WAL completion
      expect(mockTransaction.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          bot_id: botId,
          event_type: "write_ahead_log_completed",
        }),
      );
    });
  });

  describe("Transaction Isolation", () => {
    it("should use SERIALIZABLE isolation level for critical updates", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        positionType: "LONG",
        positionSize: 0.001,
      };

      await manager.updateStateCritical(botId, updates);

      expect(mockSupabase.transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "serializable" },
      );
    });

    it("should handle serialization failures with retry", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      let attemptCount = 0;
      mockTransaction.update.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("could not serialize access");
        }
        return mockTransaction;
      });

      await manager.updateStateCritical(botId, updates);

      expect(attemptCount).toBe(2);
      expect(mockTransaction.commit).toHaveBeenCalled();
    });
  });

  describe("State Recovery", () => {
    it("should recover from incomplete write-ahead logs on startup", async () => {
      const botId = "bot-123";

      // Mock incomplete WAL entries
      (mockSupabase.from().select().eq() as jest.Mock).mockResolvedValueOnce({
        data: [
          {
            id: "wal-1",
            bot_id: botId,
            state_update: { positionType: "LONG" },
            status: "pending",
            created_at: new Date(Date.now() - 60000).toISOString(),
          },
        ],
        error: null,
      });

      await manager.recoverIncompleteTransactions(botId);

      // Should mark old WAL entries as abandoned
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "abandoned",
          abandoned_at: expect.any(String),
        }),
      );
    });

    it("should apply pending write-ahead logs in order", async () => {
      const botId = "bot-123";

      const pendingWALs = [
        {
          id: "wal-1",
          state_update: { currentPrice: 45000 },
          created_at: "2024-01-01T10:00:00Z",
        },
        {
          id: "wal-2",
          state_update: { currentPrice: 46000 },
          created_at: "2024-01-01T10:01:00Z",
        },
      ];

      (mockSupabase.from().select().eq() as jest.Mock).mockResolvedValueOnce({
        data: pendingWALs,
        error: null,
      });

      await manager.recoverIncompleteTransactions(botId);

      // Should apply in chronological order
      expect(mockTransaction.update).toHaveBeenCalledTimes(2);
      expect(mockTransaction.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          state: expect.objectContaining({ currentPrice: 45000 }),
        }),
      );
      expect(mockTransaction.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          state: expect.objectContaining({ currentPrice: 46000 }),
        }),
      );
    });
  });

  describe("Error Handling", () => {
    it("should throw specific error types for different failures", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      // Version conflict error
      (mockTransaction.update().eq() as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: null,
        count: 0,
      });

      await expect(
        manager.updateStateWithVersion(botId, updates, 5),
      ).rejects.toThrow("VersionConflictError");

      // Deadlock error
      mockTransaction.update.mockRejectedValueOnce(
        new Error("deadlock detected"),
      );

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow(
        "DeadlockError",
      );

      // Transaction rollback error
      mockTransaction.commit.mockRejectedValueOnce(new Error("commit failed"));

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow(
        "TransactionRollbackError",
      );
    });

    it("should provide detailed error context", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
        positionType: "LONG",
      };

      mockTransaction.update.mockRejectedValueOnce(
        new Error("Database connection lost"),
      );

      try {
        await manager.updateStateAtomic(botId, updates);
        fail("Should have thrown an error");
      } catch (error) {
        const stateError = error as StateTransactionError;
        expect(stateError.message).toContain("Database connection lost");
        expect(stateError.context).toEqual({
          botId,
          updates,
          operation: "updateStateAtomic",
        });
      }
    });
  });

  describe("Performance Optimizations", () => {
    it("should batch multiple state updates when possible", async () => {
      const botId = "bot-123";
      const updates = [
        { currentPrice: 50000 },
        { positionType: "LONG" },
        { positionSize: 0.001 },
      ];

      await manager.batchUpdateState(botId, updates);

      // Should combine into single transaction
      expect(mockSupabase.transaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction.update).toHaveBeenCalledTimes(1);
      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({
            currentPrice: 50000,
            positionType: "LONG",
            positionSize: 0.001,
          }),
        }),
      );
    });

    it("should use prepared statements for repeated operations", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        currentPrice: 50000,
      };

      // Multiple updates with same structure
      await manager.updateStateAtomic(botId, updates);
      await manager.updateStateAtomic(botId, { currentPrice: 51000 });
      await manager.updateStateAtomic(botId, { currentPrice: 52000 });

      // Should reuse prepared statement (mock verification)
      expect(manager.hasPreparedStatement("updateState")).toBe(true);
    });
  });
});
