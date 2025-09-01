import {
  jest,
  describe,
  it,
  beforeEach,
  afterEach,
  expect,
} from "@jest/globals";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager.js";
import type { CycleState } from "../../src/cycle/cycle-state-manager.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";

// Type for RPC response
type RPCResponse<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

describe("StateTransactionManager", () => {
  let manager: StateTransactionManager;
  let mockSupabase: SupabaseClient<Database>;
  let mockRpc: jest.MockedFunction<
    (...args: unknown[]) => Promise<RPCResponse>
  >;
  let mockFrom: jest.Mock;
  let mockSelect: jest.Mock;
  let mockEq: jest.Mock;
  let mockOr: jest.Mock;
  let mockFilter: jest.Mock;
  let mockOrder: jest.Mock;
  let mockLimit: jest.Mock;
  let mockSingle: jest.MockedFunction<() => Promise<RPCResponse>>;

  beforeEach(() => {
    // Setup mock chain
    mockSingle = jest.fn() as jest.MockedFunction<() => Promise<RPCResponse>>;
    mockLimit = jest
      .fn()
      .mockReturnValue({ data: [], error: null }) as jest.Mock;
    mockOrder = jest.fn().mockReturnThis() as jest.Mock;
    mockFilter = jest.fn().mockReturnThis() as jest.Mock;
    mockOr = jest.fn().mockReturnThis() as jest.Mock;
    mockEq = jest.fn().mockReturnThis() as jest.Mock;
    mockSelect = jest.fn().mockReturnThis() as jest.Mock;
    mockFrom = jest.fn() as jest.Mock;
    mockRpc = jest.fn() as jest.MockedFunction<
      (...args: unknown[]) => Promise<RPCResponse>
    >;

    // Chain methods properly
    const queryBuilder = {
      select: mockSelect,
      eq: mockEq,
      or: mockOr,
      filter: mockFilter,
      order: mockOrder,
      limit: mockLimit,
      single: mockSingle,
    };

    mockSelect.mockReturnValue(queryBuilder);
    mockEq.mockReturnValue(queryBuilder);
    mockOr.mockReturnValue(queryBuilder);
    mockFilter.mockReturnValue(queryBuilder);
    mockOrder.mockReturnValue(queryBuilder);
    mockLimit.mockReturnValue(queryBuilder);
    mockFrom.mockReturnValue(queryBuilder);

    // Setup mock Supabase client
    mockSupabase = {
      rpc: mockRpc,
      from: mockFrom,
    } as unknown as SupabaseClient<Database>;

    manager = new StateTransactionManager(mockSupabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Atomic Updates", () => {
    it("should update state atomically using RPC function", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 50000,
        purchases_remaining: 5,
      };

      const mockState: CycleState = {
        id: botId,
        capital_available: 50000,
        purchases_remaining: 5,
        status: "READY",
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
        updated_at: new Date().toISOString(),
      };

      mockRpc.mockResolvedValueOnce({
        data: mockState,
        error: null,
      });

      const result = await manager.updateStateAtomic(botId, updates);

      expect(mockRpc).toHaveBeenCalledWith("update_state_atomic", {
        p_bot_id: botId,
        p_updates: updates,
        p_expected_version: null,
      });
      expect(result).toEqual(mockState);
    });

    it("should throw error if RPC call fails", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 50000,
      };

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Database error" },
      });

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow(
        "State update failed: Database error",
      );
    });
  });

  describe("Write-Ahead Logging", () => {
    it("should execute operation with WAL", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        capital_available: 45000,
      };

      const mockOperation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockResolvedValue({ success: true });

      mockRpc.mockResolvedValueOnce({
        data: { wal_id: "wal-123", state: {}, success: true },
        error: null,
      });

      const result = await manager.executeWithWriteAheadLog(
        botId,
        stateUpdate,
        mockOperation,
        { type: "test" },
      );

      expect(mockRpc).toHaveBeenCalledWith("execute_with_wal", {
        p_bot_id: botId,
        p_state_update: stateUpdate,
        p_operation_metadata: { type: "test" },
      });
      expect(mockOperation).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("should propagate operation errors", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        capital_available: 45000,
      };

      const mockOperation = jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error("Operation failed"));

      mockRpc.mockResolvedValueOnce({
        data: { wal_id: "wal-123" },
        error: null,
      });

      await expect(
        manager.executeWithWriteAheadLog(botId, stateUpdate, mockOperation, {}),
      ).rejects.toThrow("Operation failed");
    });
  });

  describe("Optimistic Locking", () => {
    it("should use version for concurrent update detection", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 60000,
      };
      const expectedVersion = 5;

      const updatedState: CycleState = {
        id: botId,
        capital_available: 60000,
        status: "READY",
        purchases_remaining: 5,
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
        updated_at: new Date().toISOString(),
      };

      mockRpc.mockResolvedValueOnce({
        data: updatedState,
        error: null,
      });

      const result = await manager.updateStateWithVersion(
        botId,
        updates,
        expectedVersion,
      );

      expect(mockRpc).toHaveBeenCalledWith("update_state_atomic", {
        p_bot_id: botId,
        p_updates: updates,
        p_expected_version: expectedVersion,
      });
      expect(result).toEqual(updatedState);
    });

    it("should throw VersionConflictError on version mismatch", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 60000,
      };
      const expectedVersion = 5;

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Version conflict. Expected: 5, Current: 7" },
      });

      await expect(
        manager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow("Version conflict: expected 5, got 7");
    });
  });

  describe("Retry Logic", () => {
    it("should retry on deadlock", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 55000,
      };

      const mockState: CycleState = {
        id: botId,
        capital_available: 55000,
        status: "READY",
        purchases_remaining: 5,
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
        updated_at: new Date().toISOString(),
      };

      // First call fails with deadlock, second succeeds
      mockRpc
        .mockResolvedValueOnce({
          data: null,
          error: { message: "deadlock detected" },
        })
        .mockResolvedValueOnce({ data: mockState, error: null });

      const result = await manager.updateStateWithRetry(botId, updates, {
        maxRetries: 3,
        delayMs: 10,
      });

      expect(mockRpc).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockState);
    });

    it("should throw DeadlockError after max retries", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 55000,
      };

      // Always return deadlock error
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "deadlock detected" },
      });

      await expect(
        manager.updateStateWithRetry(botId, updates, {
          maxRetries: 2,
          delayMs: 10,
        }),
      ).rejects.toThrow("Failed after 2 retries");
    });
  });

  describe("Audit Trail", () => {
    it("should retrieve state history from audit trail", async () => {
      const botId = "bot-123";

      const mockHistory = [
        {
          id: "event-1",
          event_type: "STATE_UPDATE",
          severity: "info",
          message: "State change: STATE_UPDATE",
          metadata: { bot_id: botId, changes: { capital_available: 50000 } },
          created_at: new Date().toISOString(),
        },
        {
          id: "event-2",
          event_type: "CRITICAL_UPDATE",
          severity: "warning",
          message: "State change: CRITICAL_UPDATE",
          metadata: { bot_id: botId, changes: { status: "PAUSED" } },
          created_at: new Date().toISOString(),
        },
      ];

      mockLimit.mockReturnValue({ data: mockHistory, error: null });

      const history = await manager.getStateHistory(botId, 10);

      expect(mockFrom).toHaveBeenCalledWith("bot_events");
      expect(mockFilter).toHaveBeenCalledWith("metadata->bot_id", "eq", botId);
      expect(history).toEqual(mockHistory);
    });
  });

  describe("Transaction Recovery", () => {
    it("should recover incomplete transactions on startup", async () => {
      const botId = "bot-123";

      mockRpc.mockResolvedValueOnce({
        data: { recovered: 2, failed: 1, total: 3 },
        error: null,
      });

      const result = await manager.recoverIncompleteTransactions(botId);

      expect(mockRpc).toHaveBeenCalledWith("recover_incomplete_wal", {
        p_bot_id: botId,
      });
      expect(result).toEqual({ recovered: 2, failed: 1 });
    });

    it("should return zeros if recovery returns no data", async () => {
      const botId = "bot-123";

      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await manager.recoverIncompleteTransactions(botId);

      expect(result).toEqual({ recovered: 0, failed: 0 });
    });
  });

  describe("Batch Updates", () => {
    it("should update multiple bots in single transaction", async () => {
      const updates = [
        { botId: "bot-1", changes: { capital_available: 50000 } },
        { botId: "bot-2", changes: { capital_available: 60000 } },
        { botId: "bot-3", changes: { capital_available: 70000 } },
      ];

      mockRpc.mockResolvedValueOnce({
        data: { success: true },
        error: null,
      });

      await manager.batchUpdateState(updates);

      expect(mockRpc).toHaveBeenCalledWith("batch_update_states", {
        p_updates: [
          { bot_id: "bot-1", changes: { capital_available: 50000 } },
          { bot_id: "bot-2", changes: { capital_available: 60000 } },
          { bot_id: "bot-3", changes: { capital_available: 70000 } },
        ],
      });
    });

    it("should throw error if batch update fails", async () => {
      const updates = [
        { botId: "bot-1", changes: { capital_available: 50000 } },
      ];

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Batch update error" },
      });

      await expect(manager.batchUpdateState(updates)).rejects.toThrow(
        "Batch update failed: Batch update error",
      );
    });
  });

  describe("Critical Updates", () => {
    it("should use SERIALIZABLE isolation for critical updates", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 100000,
      };

      const mockState: CycleState = {
        id: botId,
        capital_available: 100000,
        status: "READY",
        purchases_remaining: 5,
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 20000,
        updated_at: new Date().toISOString(),
      };

      mockRpc.mockResolvedValueOnce({
        data: mockState,
        error: null,
      });

      const result = await manager.updateStateCritical(botId, updates);

      expect(mockRpc).toHaveBeenCalledWith("update_state_critical", {
        p_bot_id: botId,
        p_updates: updates,
      });
      expect(result).toEqual(mockState);
    });

    it("should validate critical conditions", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: -5000,
      };

      await expect(manager.updateStateCritical(botId, updates)).rejects.toThrow(
        "Cannot set negative capital",
      );

      // Should not call RPC if validation fails
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("should validate negative purchases remaining", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        purchases_remaining: -1,
      };

      await expect(manager.updateStateCritical(botId, updates)).rejects.toThrow(
        "Cannot set negative purchases remaining",
      );

      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe("Get Current State with Version", () => {
    it("should fetch current state with version field", async () => {
      const botId = "bot-123";

      const mockState = {
        id: botId,
        capital_available: 50000,
        status: "READY",
        purchases_remaining: 5,
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
        updated_at: new Date().toISOString(),
        version: 7,
      };

      mockSingle.mockResolvedValueOnce({
        data: mockState,
        error: null,
      });

      const result = await manager.getCurrentStateWithVersion(botId);

      expect(mockFrom).toHaveBeenCalledWith("cycle_state");
      expect(mockEq).toHaveBeenCalledWith("id", botId);
      expect(result).toEqual(mockState);
    });

    it("should throw error if state not found", async () => {
      const botId = "bot-123";

      mockSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      await expect(manager.getCurrentStateWithVersion(botId)).rejects.toThrow(
        `Bot state not found: ${botId}`,
      );
    });
  });
});
