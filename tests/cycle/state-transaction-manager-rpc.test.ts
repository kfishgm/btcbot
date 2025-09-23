import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StateTransactionManager,
  VersionConflictError,
  DeadlockError,
} from "../../src/cycle/state-transaction-manager";
import type { Database } from "../../types/supabase";
import type { CycleState } from "../../src/cycle/cycle-state-manager";

describe("StateTransactionManager RPC", () => {
  let supabase: SupabaseClient<Database>;
  let stateManager: StateTransactionManager;
  let mockRpc: jest.Mock;

  beforeEach(() => {
    // Create a mock Supabase client
    mockRpc = jest.fn();
    supabase = {
      rpc: mockRpc as unknown as SupabaseClient<Database>["rpc"],
      from: jest.fn(),
    } as unknown as SupabaseClient<Database>;

    stateManager = new StateTransactionManager(supabase);
  });

  describe("updateStateAtomic", () => {
    it("should successfully update state atomically", async () => {
      const botId = "test-bot-id";
      const updates = {
        btc_accumulated: 0.001,
        capital_available: 270,
      };

      const expectedState: Partial<CycleState> = {
        id: botId,
        btc_accumulated: 0.001,
        capital_available: 270,
        status: "HOLDING",
      };

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: expectedState,
        error: null,
      });

      const result = await stateManager.updateStateAtomic(botId, updates);

      expect(mockRpc).toHaveBeenCalledWith("update_state_atomic", {
        p_bot_id: botId,
        p_updates: updates,
        p_expected_version: undefined,
      });
      expect(result).toEqual(expectedState);
    });

    it("should handle RPC errors gracefully", async () => {
      const botId = "test-bot-id";
      const updates = { btc_accumulated: 0.001 };

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "Database connection failed" },
      });

      await expect(
        stateManager.updateStateAtomic(botId, updates),
      ).rejects.toThrow(
        "RPC update_state_atomic failed: Database connection failed",
      );
    });

    it("should handle null data response", async () => {
      const botId = "test-bot-id";
      const updates = { btc_accumulated: 0.001 };

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await expect(
        stateManager.updateStateAtomic(botId, updates),
      ).rejects.toThrow("RPC update_state_atomic failed: No data returned");
    });
  });

  describe("updateStateWithVersion", () => {
    it("should update state with version check", async () => {
      const botId = "test-bot-id";
      const updates = { capital_available: 250 };
      const expectedVersion = 5;

      const expectedState: Partial<CycleState> = {
        id: botId,
        capital_available: 250,
        version: 6,
      };

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: expectedState,
        error: null,
      });

      const result = await stateManager.updateStateWithVersion(
        botId,
        updates,
        expectedVersion,
      );

      expect(mockRpc).toHaveBeenCalledWith("update_state_atomic", {
        p_bot_id: botId,
        p_updates: updates,
        p_expected_version: expectedVersion,
      });
      expect(result).toEqual(expectedState);
    });

    it("should throw VersionConflictError on version mismatch", async () => {
      const botId = "test-bot-id";
      const updates = { capital_available: 250 };
      const expectedVersion = 5;

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: {
          message: "Version conflict: Expected: 5, Current: 7",
        },
      });

      await expect(
        stateManager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow(VersionConflictError);
    });

    it("should handle generic version conflict errors", async () => {
      const botId = "test-bot-id";
      const updates = { capital_available: 250 };
      const expectedVersion = 5;

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: {
          message: "Version conflict detected",
        },
      });

      await expect(
        stateManager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow(VersionConflictError);
    });

    it("should handle non-version errors", async () => {
      const botId = "test-bot-id";
      const updates = { capital_available: 250 };
      const expectedVersion = 5;

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: {
          message: "Connection timeout",
        },
      });

      await expect(
        stateManager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow("State update failed: Connection timeout");
    });
  });

  describe("executeWithWriteAheadLog", () => {
    it("should execute operation with WAL", async () => {
      const botId = "test-bot-id";
      const stateUpdate = { capital_available: 200 };
      const operationMetadata = { operation: "UPDATE_CAPITAL" };

      // Mock WAL creation
      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: { success: true },
        error: null,
      });

      // Mock operation execution
      const mockOperation = jest
        .fn<
          () => Promise<{
            success: boolean;
            data: { capital_available: number };
          }>
        >()
        .mockResolvedValueOnce({
          success: true,
          data: { capital_available: 200 },
        });

      const result = await stateManager.executeWithWriteAheadLog(
        botId,
        stateUpdate,
        mockOperation,
        operationMetadata,
      );

      expect(mockRpc).toHaveBeenCalledWith("execute_with_wal", {
        p_bot_id: botId,
        p_state_update: stateUpdate,
        p_operation_metadata: operationMetadata,
      });
      expect(mockOperation).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: { capital_available: 200 },
      });
    });

    it("should handle WAL creation failure", async () => {
      const botId = "test-bot-id";
      const stateUpdate = { capital_available: 200 };
      const operationMetadata = { operation: "UPDATE_CAPITAL" };

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "WAL creation failed" },
      });

      const mockOperation = jest.fn<() => Promise<unknown>>();

      await expect(
        stateManager.executeWithWriteAheadLog(
          botId,
          stateUpdate,
          mockOperation,
          operationMetadata,
        ),
      ).rejects.toThrow("WAL execution failed: WAL creation failed");

      expect(mockOperation).not.toHaveBeenCalled();
    });
  });

  describe("updateStateWithRetry", () => {
    it("should retry on failure and succeed", async () => {
      const botId = "test-bot-id";
      const updates = { btc_accumulated: 0.001 };
      const retryOptions = {
        maxRetries: 3,
        delayMs: 10,
        backoffMultiplier: 2,
      };

      // First call fails with retriable error, second succeeds
      (mockRpc as ReturnType<typeof jest.fn>)
        .mockResolvedValueOnce({
          data: null,
          error: { message: "deadlock detected" },
        })
        .mockResolvedValueOnce({
          data: { id: botId, btc_accumulated: 0.001 },
          error: null,
        });

      const result = await stateManager.updateStateWithRetry(
        botId,
        updates,
        retryOptions,
      );

      expect(mockRpc).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: botId, btc_accumulated: 0.001 });
    });

    it("should throw after max retries", async () => {
      const botId = "test-bot-id";
      const updates = { btc_accumulated: 0.001 };
      const retryOptions = {
        maxRetries: 2,
        delayMs: 10,
      };

      // Mock RPC to always return retriable error
      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValue({
        data: null,
        error: { message: "deadlock detected" },
      });

      await expect(
        stateManager.updateStateWithRetry(botId, updates, retryOptions),
      ).rejects.toThrow(DeadlockError);

      expect(mockRpc).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-retriable errors", async () => {
      const botId = "test-bot-id";
      const updates = { btc_accumulated: 0.001 };
      const retryOptions = {
        maxRetries: 3,
        delayMs: 10,
      };

      // Non-retriable error (not deadlock/serialization/concurrent)
      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied" },
      });

      await expect(
        stateManager.updateStateWithRetry(botId, updates, retryOptions),
      ).rejects.toThrow(DeadlockError);

      // Should throw immediately without retrying
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });
  });

  describe("batchUpdateState", () => {
    it("should update multiple states in batch", async () => {
      const updates = [
        { botId: "bot-1", changes: { capital_available: 200 } },
        { botId: "bot-2", changes: { capital_available: 300 } },
      ];

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: [
          { id: "bot-1", capital_available: 200 },
          { id: "bot-2", capital_available: 300 },
        ],
        error: null,
      });

      await stateManager.batchUpdateState(updates);

      expect(mockRpc).toHaveBeenCalledWith("batch_update_states", {
        p_updates: [
          { bot_id: "bot-1", changes: { capital_available: 200 } },
          { bot_id: "bot-2", changes: { capital_available: 300 } },
        ],
      });
    });

    it("should handle batch update errors", async () => {
      const updates = [{ botId: "bot-1", changes: { capital_available: 200 } }];

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "Batch update failed" },
      });

      await expect(stateManager.batchUpdateState(updates)).rejects.toThrow(
        "Batch update failed: Batch update failed",
      );
    });
  });

  describe("recoverIncompleteTransactions", () => {
    it("should recover incomplete WAL transactions", async () => {
      const botId = "test-bot-id";

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: { recovered: 2, failed: 0 },
        error: null,
      });

      const result = await stateManager.recoverIncompleteTransactions(botId);

      expect(mockRpc).toHaveBeenCalledWith("recover_incomplete_wal", {
        p_bot_id: botId,
      });
      expect(result).toEqual({ recovered: 2, failed: 0 });
    });

    it("should handle recovery with failures", async () => {
      const botId = "test-bot-id";

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: { recovered: 1, failed: 2 },
        error: null,
      });

      const result = await stateManager.recoverIncompleteTransactions(botId);

      expect(result).toEqual({ recovered: 1, failed: 2 });
    });

    it("should handle recovery errors", async () => {
      const botId = "test-bot-id";

      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: "Recovery failed" },
      });

      await expect(
        stateManager.recoverIncompleteTransactions(botId),
      ).rejects.toThrow("WAL recovery failed: Recovery failed");
    });
  });

  describe("getStateHistory", () => {
    it("should retrieve state history", async () => {
      const botId = "test-bot-id";
      const limit = 50;

      const mockHistory = [
        {
          id: "event-1",
          bot_id: botId,
          event_type: "STATE_UPDATE",
          created_at: new Date().toISOString(),
        },
        {
          id: "event-2",
          bot_id: botId,
          event_type: "BUY_ORDER",
          created_at: new Date().toISOString(),
        },
      ];

      const mockFrom = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        filter: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: (jest.fn() as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
          data: mockHistory,
          error: null,
        }),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockFrom);

      const result = await stateManager.getStateHistory(botId, limit);

      expect(supabase.from).toHaveBeenCalledWith("bot_events");
      expect(mockFrom.or).toHaveBeenCalledWith(
        "event_type.eq.STATE_UPDATE,event_type.eq.CRITICAL_UPDATE,event_type.eq.BATCH_UPDATE",
      );
      expect(mockFrom.filter).toHaveBeenCalledWith(
        "metadata->bot_id",
        "eq",
        botId,
      );
      expect(mockFrom.order).toHaveBeenCalledWith("created_at", {
        ascending: false,
      });
      expect(mockFrom.limit).toHaveBeenCalledWith(limit);
      expect(result).toEqual(mockHistory);
    });
  });

  describe("getCurrentStateWithVersion", () => {
    it("should get current state with version", async () => {
      const botId = "test-bot-id";

      const mockState = {
        id: botId,
        version: 7,
        capital_available: 300,
        btc_accumulated: 0.002,
      };

      const mockFrom = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: (jest.fn() as ReturnType<typeof jest.fn>).mockResolvedValueOnce(
          {
            data: mockState,
            error: null,
          },
        ),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockFrom);

      const result = await stateManager.getCurrentStateWithVersion(botId);

      expect(supabase.from).toHaveBeenCalledWith("cycle_state");
      expect(mockFrom.eq).toHaveBeenCalledWith("id", botId);
      expect(result).toEqual(mockState);
    });

    it("should handle state not found", async () => {
      const botId = "test-bot-id";

      const mockFrom = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: (jest.fn() as ReturnType<typeof jest.fn>).mockResolvedValueOnce(
          {
            data: null,
            error: { message: "State not found" },
          },
        ),
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(mockFrom);

      await expect(
        stateManager.getCurrentStateWithVersion(botId),
      ).rejects.toThrow("Failed to fetch current state: State not found");
    });
  });

  describe("updateStateCritical", () => {
    it("should handle critical updates successfully", async () => {
      const botId = "test-bot-id";
      const updates = { capital_available: 100 };

      // Succeeds on first attempt
      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValueOnce({
        data: { id: botId, capital_available: 100 },
        error: null,
      });

      const result = await stateManager.updateStateCritical(botId, updates);

      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith("update_state_critical", {
        p_bot_id: botId,
        p_updates: updates,
      });
      expect(result).toEqual({ id: botId, capital_available: 100 });
    });

    it("should throw error on critical update failure", async () => {
      const botId = "test-bot-id";
      const updates = { capital_available: 0 };

      // Attempt fails
      (mockRpc as ReturnType<typeof jest.fn>).mockResolvedValue({
        data: null,
        error: { message: "Critical update failed" },
      });

      await expect(
        stateManager.updateStateCritical(botId, updates),
      ).rejects.toThrow("Critical update failed: Critical update failed");

      expect(mockRpc).toHaveBeenCalledTimes(1);
    });
  });
});
