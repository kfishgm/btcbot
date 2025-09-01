import { StateTransactionManager } from "../../src/cycle/state-transaction-manager.js";
import type { CycleState } from "../../src/cycle/cycle-state-manager.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";

// Mock Supabase client
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(),
}));

// Define mock query builder interface
interface MockQueryBuilder {
  from: jest.Mock;
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
  filter: jest.Mock;
  or: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  single: jest.Mock;
}

describe("StateTransactionManager", () => {
  let manager: StateTransactionManager;
  let mockSupabase: unknown;
  let mockQueryBuilder: MockQueryBuilder;

  beforeEach(() => {
    // Setup mock query builder
    mockQueryBuilder = {
      from: jest.fn(),
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      eq: jest.fn(),
      filter: jest.fn(),
      or: jest.fn(),
      order: jest.fn(),
      limit: jest.fn(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    // Chain methods together
    mockQueryBuilder.from.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.insert.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.update.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.eq.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.filter.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.or.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.order.mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.limit.mockReturnValue(mockQueryBuilder);

    // Setup mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    (createClient as jest.Mock).mockReturnValue(mockSupabase);

    manager = new StateTransactionManager(
      mockSupabase as SupabaseClient<Database>,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Atomic Updates", () => {
    it("should wrap state changes in a database transaction", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 50000,
        purchases_remaining: 5,
      };

      // Mock successful transaction
      const mockState = {
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

      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: mockState, error: null }) // select current state
        .mockResolvedValueOnce({ data: mockState, error: null }); // update state

      await manager.updateStateAtomic(botId, updates);

      // Should start transaction
      expect((mockSupabase as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith(
        "begin_transaction",
      );
      // Should commit transaction
      expect((mockSupabase as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith(
        "commit_transaction",
      );
    });

    it("should rollback on failure", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: -1000, // Invalid negative value
      };

      // Mock transaction failure
      mockQueryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { message: "Invalid value" },
      });

      await expect(manager.updateStateAtomic(botId, updates)).rejects.toThrow();

      // Should rollback transaction
      expect((mockSupabase as { rpc: jest.Mock }).rpc).toHaveBeenCalledWith(
        "rollback_transaction",
      );
    });
  });

  describe("Write-Ahead Logging", () => {
    it("should save state before executing operation", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        capital_available: 45000,
      };

      const mockOperation = jest.fn().mockResolvedValue({ success: true });

      // Mock successful WAL entry
      mockQueryBuilder.single.mockResolvedValueOnce({
        data: { id: "wal-123" },
        error: null,
      });

      await manager.executeWithWriteAheadLog(
        botId,
        stateUpdate,
        mockOperation,
        { type: "test" },
      );

      // Should insert WAL entry
      expect(mockQueryBuilder.insert).toHaveBeenCalled();
      // Should execute operation
      expect(mockOperation).toHaveBeenCalled();
    });

    it("should not execute operation if WAL fails", async () => {
      const botId = "bot-123";
      const stateUpdate: Partial<CycleState> = {
        capital_available: 45000,
      };

      const mockOperation = jest.fn();

      // Mock WAL failure
      mockQueryBuilder.single.mockResolvedValueOnce({
        data: null,
        error: { message: "WAL failed" },
      });

      await expect(
        manager.executeWithWriteAheadLog(botId, stateUpdate, mockOperation, {}),
      ).rejects.toThrow();

      // Operation should not be called
      expect(mockOperation).not.toHaveBeenCalled();
    });
  });

  describe("Optimistic Locking", () => {
    it("should use version for concurrent update detection", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 60000,
      };
      const expectedVersion = Date.now();

      // Mock current state with version
      const currentState = {
        id: botId,
        capital_available: 50000,
        updated_at: new Date(expectedVersion).toISOString(),
        status: "READY",
        purchases_remaining: 5,
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
      };

      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: currentState, error: null })
        .mockResolvedValueOnce({
          data: { ...currentState, ...updates },
          error: null,
        });

      await manager.updateStateWithVersion(botId, updates, expectedVersion);

      // Should check version in update
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith(
        "updated_at",
        currentState.updated_at,
      );
    });

    it("should throw VersionConflictError on version mismatch", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 60000,
      };
      const expectedVersion = Date.now() - 10000; // Old version

      // Mock current state with newer version
      const currentState = {
        id: botId,
        updated_at: new Date().toISOString(), // Newer version
        capital_available: 50000,
        status: "READY",
        purchases_remaining: 5,
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
      };

      mockQueryBuilder.single.mockResolvedValueOnce({
        data: currentState,
        error: null,
      });

      await expect(
        manager.updateStateWithVersion(botId, updates, expectedVersion),
      ).rejects.toThrow("Version conflict");
    });
  });

  describe("Retry Logic", () => {
    it("should retry on deadlock", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 55000,
      };

      let attempts = 0;
      const mockRpc = mockSupabase as { rpc: jest.Mock };

      // Mock deadlock on first attempt, success on second
      mockRpc.rpc.mockImplementation((method) => {
        if (method === "begin_transaction") {
          attempts++;
          if (attempts === 1) {
            return Promise.resolve({
              data: null,
              error: { message: "deadlock detected" },
            });
          }
        }
        return Promise.resolve({ data: null, error: null });
      });

      const mockState = {
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

      mockQueryBuilder.single.mockResolvedValue({
        data: mockState,
        error: null,
      });

      await manager.updateStateWithRetry(botId, updates, {
        maxRetries: 3,
        delayMs: 10,
      });

      // Should be called twice (failed once, succeeded once)
      expect(attempts).toBe(2);
    });

    it("should throw DeadlockError after max retries", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 55000,
      };

      // Always return deadlock error
      const mockRpc = mockSupabase as { rpc: jest.Mock };
      mockRpc.rpc.mockResolvedValue({
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
    it("should log state changes to bot_events", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 45000,
        purchases_remaining: 4,
      };

      const mockState = {
        id: botId,
        capital_available: 45000,
        purchases_remaining: 4,
        status: "READY",
        btc_accumulated: 0,
        ath_price: null,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        buy_amount: 10000,
        updated_at: new Date().toISOString(),
      };

      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: mockState, error: null })
        .mockResolvedValueOnce({ data: mockState, error: null });

      await manager.updateStateAtomic(botId, updates);

      // Should insert audit log
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STATE_UPDATE",
          severity: "info",
        }),
      );
    });

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

      mockQueryBuilder.limit.mockReturnValue({
        data: mockHistory,
        error: null,
      });

      const history = await manager.getStateHistory(botId, 10);

      expect(history).toEqual(mockHistory);
      expect(mockQueryBuilder.filter).toHaveBeenCalledWith(
        "metadata->bot_id",
        "eq",
        botId,
      );
    });
  });

  describe("Transaction Recovery", () => {
    it("should recover incomplete transactions on startup", async () => {
      const botId = "bot-123";

      const incompleteWALs = [
        {
          id: "wal-1",
          event_type: "write_ahead_log",
          severity: "info",
          metadata: {
            bot_id: botId,
            status: "pending",
            state_update: { capital_available: 40000 },
          },
          created_at: new Date().toISOString(),
        },
      ];

      // Mock finding incomplete WALs
      mockQueryBuilder.order.mockReturnValue({
        data: incompleteWALs,
        error: null,
      });

      await manager.recoverIncompleteTransactions(botId);

      // Should update WAL entries to rolled_back
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            status: "rolled_back",
          }),
        }),
      );
    });
  });

  describe("Batch Updates", () => {
    it("should update multiple bots in single transaction", async () => {
      const updates = [
        { botId: "bot-1", changes: { capital_available: 50000 } },
        { botId: "bot-2", changes: { capital_available: 60000 } },
        { botId: "bot-3", changes: { capital_available: 70000 } },
      ];

      await manager.batchUpdateState(updates);

      // Should start single transaction
      const mockRpc = mockSupabase as { rpc: jest.Mock };
      expect(mockRpc.rpc).toHaveBeenCalledWith("begin_transaction");
      expect(mockRpc.rpc).toHaveBeenCalledWith("commit_transaction");

      // Should update each bot
      expect(mockQueryBuilder.update).toHaveBeenCalledTimes(3);
    });

    it("should rollback all updates if any fails", async () => {
      const updates = [
        { botId: "bot-1", changes: { capital_available: 50000 } },
        { botId: "bot-2", changes: { capital_available: -1000 } }, // Invalid
      ];

      // Make second update fail
      let updateCount = 0;
      mockQueryBuilder.eq.mockImplementation(() => {
        updateCount++;
        if (updateCount === 2) {
          return {
            data: null,
            error: { message: "Invalid value" },
          };
        }
        return mockQueryBuilder;
      });

      await expect(manager.batchUpdateState(updates)).rejects.toThrow();

      // Should rollback
      const mockRpc = mockSupabase as { rpc: jest.Mock };
      expect(mockRpc.rpc).toHaveBeenCalledWith("rollback_transaction");
    });
  });

  describe("Critical Updates", () => {
    it("should use SERIALIZABLE isolation for critical updates", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: 100000, // Critical financial update
      };

      const mockState = {
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

      mockQueryBuilder.single
        .mockResolvedValueOnce({ data: mockState, error: null })
        .mockResolvedValueOnce({ data: mockState, error: null });

      await manager.updateStateCritical(botId, updates);

      // Should use serializable transaction
      const mockRpc = mockSupabase as { rpc: jest.Mock };
      expect(mockRpc.rpc).toHaveBeenCalledWith(
        "begin_transaction_serializable",
      );
    });

    it("should validate critical conditions", async () => {
      const botId = "bot-123";
      const updates: Partial<CycleState> = {
        capital_available: -5000, // Invalid negative capital
      };

      // Mock getting current state
      mockQueryBuilder.single.mockResolvedValueOnce({
        data: {
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
        },
        error: null,
      });

      await expect(manager.updateStateCritical(botId, updates)).rejects.toThrow(
        "Cannot set negative capital",
      );
    });
  });
});
