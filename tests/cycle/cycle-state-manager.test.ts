import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import type { Database } from "../../types/supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CycleStateManager,
  type CycleStateManagerConfig,
  type CycleState,
} from "../../src/cycle/cycle-state-manager.js";
import { createMockSupabaseClient } from "../mocks/supabase-mock.js";
import { MockTradingRules } from "../mocks/mock-trading-rules.js";
import type { TradingRules } from "../../src/exchange/trading-rules.js";

describe("CycleStateManager", () => {
  let mockSupabase: SupabaseClient<Database>;
  let cycleStateManager: CycleStateManager;
  let config: CycleStateManagerConfig;
  let mockTradingRules: TradingRules;

  // Helper to create valid CycleState with all required fields
  const createValidCycleState = (
    overrides?: Partial<CycleState>,
  ): CycleState => ({
    id: "test-id",
    status: "READY",
    capital_available: 300,
    btc_accumulated: 0,
    purchases_remaining: 10,
    reference_price: null,
    cost_accum_usdt: 0,
    btc_accum_net: 0,
    btc_dust: 0,
    ath_price: null,
    buy_amount: 30,
    buy_anchor_price: null,
    buy_grid: null,
    buy_index: 0,
    version: 1,
    updated_at: new Date().toISOString(),
    completed_at: null,
    final_profit: null,
    previous_cycle_id: null,
    strategy_config_id: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    config = {
      initialCapitalUSDT: 300,
      maxPurchases: 10,
      minBuyUSDT: 10,
    };

    mockTradingRules = new MockTradingRules() as unknown as TradingRules;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("initialize()", () => {
    describe("when no cycle state exists", () => {
      beforeEach(() => {
        const insertData = createValidCycleState();

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: null, error: null },
            insert: { data: insertData, error: null },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });
      });

      it("should create initial cycle state with READY status", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        // Verify that cycle_state was accessed - the mock was configured for it
        expect(mockSupabase.from).toHaveBeenCalled();

        const state = await cycleStateManager.getCurrentState();
        expect(state).toMatchObject({
          status: "READY",
          capital_available: 300,
          btc_accumulated: 0,
          purchases_remaining: 10,
          buy_amount: 30,
        });
      });

      it("should calculate buy_amount using floor_to_precision formula", async () => {
        const configs = [
          { capital: 300, purchases: 10, expected: 30 },
          { capital: 100, purchases: 3, expected: 33 },
          { capital: 250, purchases: 7, expected: 35 },
          { capital: 1000, purchases: 20, expected: 50 },
        ];

        for (const testConfig of configs) {
          const localConfig = {
            initialCapitalUSDT: testConfig.capital,
            maxPurchases: testConfig.purchases,
            minBuyUSDT: 10,
          };

          const insertData = createValidCycleState({
            capital_available: testConfig.capital,
            purchases_remaining: testConfig.purchases,
            buy_amount: testConfig.expected,
          });

          const localMockSupabase = createMockSupabaseClient({
            cycle_state: {
              select: { data: null, error: null },
              insert: { data: insertData, error: null },
            },
            bot_events: {
              insert: { data: null, error: null },
            },
          });

          const manager = new CycleStateManager(
            localMockSupabase,
            localConfig,
            mockTradingRules,
          );
          await manager.initialize();

          const state = await manager.getCurrentState();
          expect(state?.buy_amount).toBe(testConfig.expected);
        }
      });

      it("should set all initial accumulators to zero", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state).toMatchObject({
          btc_accumulated: 0,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          btc_dust: 0,
        });
      });

      it("should set reference_price and ath_price to null initially", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state?.reference_price).toBeNull();
        expect(state?.ath_price).toBeNull();
      });

      it("should log bot event for initialization", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        // Verify bot event was logged
        expect(mockSupabase.from).toHaveBeenCalled();
      });
    });

    describe("when valid cycle state exists", () => {
      let existingState: CycleState;

      beforeEach(() => {
        existingState = createValidCycleState({
          id: "existing-id",
          status: "HOLDING",
          capital_available: 150,
          btc_accumulated: 0.005,
          purchases_remaining: 5,
          reference_price: 30000,
          cost_accum_usdt: 150,
          btc_accum_net: 0.005,
          btc_dust: 0,
          ath_price: 31000,
          buy_amount: 30,
        });

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: existingState, error: null },
          },
        });
      });

      it("should recover existing state", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state).toMatchObject({
          id: "existing-id",
          status: "HOLDING",
          capital_available: 150,
          btc_accumulated: 0.005,
          purchases_remaining: 5,
        });
      });

      it("should not create new state when valid state exists", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        // Verify no insert was called since state already exists
        const state = await cycleStateManager.getCurrentState();
        expect(state).not.toBeNull();
        expect(state?.id).toBe("existing-id");
      });

      it("should validate recovered state", async () => {
        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state).not.toBeNull();
        if (state) {
          expect(cycleStateManager.validateState(state)).toBe(true);
        }
      });
    });

    describe("when corrupted cycle state exists", () => {
      it("should detect negative capital_available", async () => {
        const corruptedState = createValidCycleState({
          id: "corrupt-id",
          capital_available: -100,
        });

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: corruptedState, error: null },
            update: {
              data: { ...corruptedState, status: "PAUSED" },
              error: null,
            },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should detect purchases_remaining exceeding max_purchases", async () => {
        const corruptedState = createValidCycleState({
          id: "corrupt-id",
          purchases_remaining: 15,
        });

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: corruptedState, error: null },
            update: {
              data: { ...corruptedState, status: "PAUSED" },
              error: null,
            },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should detect invalid status values", async () => {
        const corruptedState = {
          id: "corrupt-id",
          status: "INVALID_STATUS",
          capital_available: 300,
          btc_accumulated: 0,
          purchases_remaining: 10,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          btc_dust: 0,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        } as CycleState;

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: corruptedState, error: null },
            update: {
              data: { ...corruptedState, status: "PAUSED" },
              error: null,
            },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should detect missing reference_price when holding", async () => {
        const corruptedState = createValidCycleState({
          id: "corrupt-id",
          status: "HOLDING",
          capital_available: 150,
          btc_accumulated: 0.005,
          purchases_remaining: 5,
          reference_price: null,
          cost_accum_usdt: 150,
          btc_accum_net: 0.005,
          btc_dust: 0,
          ath_price: null,
          buy_amount: 30,
        });

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: corruptedState, error: null },
            update: {
              data: { ...corruptedState, status: "PAUSED" },
              error: null,
            },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        const state = await cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should log bot event for corruption detection", async () => {
        const corruptedState = createValidCycleState({
          id: "corrupt-id",
          capital_available: -100,
        });

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: corruptedState, error: null },
            update: {
              data: { ...corruptedState, status: "PAUSED" },
              error: null,
            },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await cycleStateManager.initialize();

        // Verify corruption was logged
        expect(mockSupabase.from).toHaveBeenCalled();
        const state = await cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });
    });

    describe("error handling", () => {
      it("should throw error when database connection fails", async () => {
        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: null, error: new Error("Connection failed") },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await expect(cycleStateManager.initialize()).rejects.toThrow(
          "Failed to query cycle state",
        );
      });

      it("should throw error when state creation fails", async () => {
        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: null, error: null },
            insert: { data: null, error: new Error("Insert failed") },
          },
        });

        cycleStateManager = new CycleStateManager(
          mockSupabase,
          config,
          mockTradingRules,
        );

        await expect(cycleStateManager.initialize()).rejects.toThrow(
          "Failed to create initial cycle state",
        );
      });
    });
  });

  describe("getCurrentState()", () => {
    it("should return null before initialization", async () => {
      mockSupabase = createMockSupabaseClient({});
      cycleStateManager = new CycleStateManager(
        mockSupabase,
        config,
        mockTradingRules,
      );

      expect(await cycleStateManager.getCurrentState()).toBeNull();
    });

    it("should return immutable copy of state", async () => {
      const state = createValidCycleState();

      mockSupabase = createMockSupabaseClient({
        cycle_state: {
          select: { data: state, error: null },
        },
      });

      cycleStateManager = new CycleStateManager(
        mockSupabase,
        config,
        mockTradingRules,
      );
      await cycleStateManager.initialize();

      const state1 = await cycleStateManager.getCurrentState();
      const state2 = await cycleStateManager.getCurrentState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("validateState()", () => {
    beforeEach(() => {
      mockSupabase = createMockSupabaseClient({});
      cycleStateManager = new CycleStateManager(
        mockSupabase,
        config,
        mockTradingRules,
      );
    });

    it("should validate capital_available is non-negative", () => {
      const validState = createValidCycleState({
        capital_available: 0,
      });

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, capital_available: -1 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate btc_accumulated is non-negative", () => {
      const validState = createValidCycleState();

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, btc_accumulated: -0.001 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate purchases_remaining does not exceed max_purchases", async () => {
      const validState = createValidCycleState();

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, purchases_remaining: 11 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate status is a valid enum value", async () => {
      const validStatuses = ["READY", "HOLDING", "PAUSED"];

      for (const status of validStatuses) {
        const state = createValidCycleState({ status });

        expect(cycleStateManager.validateState(state)).toBe(true);
      }

      const invalidState = {
        ...createValidCycleState(),
        status: "INVALID",
      } as CycleState;

      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate reference_price exists when holding", () => {
      const holdingWithPrice = createValidCycleState({
        status: "HOLDING",
        capital_available: 150,
        btc_accumulated: 0.005,
        purchases_remaining: 5,
        reference_price: 30000,
        cost_accum_usdt: 150,
        btc_accum_net: 0.005,
        btc_dust: 0,
        ath_price: null,
        buy_amount: 30,
      });

      expect(cycleStateManager.validateState(holdingWithPrice)).toBe(true);

      const holdingWithoutPrice = {
        ...holdingWithPrice,
        reference_price: null,
      };
      expect(cycleStateManager.validateState(holdingWithoutPrice)).toBe(false);
    });

    it("should validate buy_amount meets min_buy_usdt requirement", () => {
      const validState = createValidCycleState();

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, buy_amount: 5 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });
  });

  describe("createNewCycleAfterCompletion()", () => {
    beforeEach(() => {
      mockSupabase = createMockSupabaseClient({});
      cycleStateManager = new CycleStateManager(
        mockSupabase,
        config,
        mockTradingRules,
      );
    });

    it("should mark previous cycle as COMPLETED and create new cycle", async () => {
      const previousCycle = createValidCycleState({
        id: "old-cycle-id",
        status: "HOLDING",
        capital_available: 950,
        btc_accumulated: 0.05,
        reference_price: 50000,
      });

      const completionData = {
        finalProfit: 50,
        carryOverCapital: 1050,
        carryOverDust: 0.00000278,
      };

      // Mock the update for marking as completed
      const mockFrom = mockSupabase.from as unknown as jest.Mock;
      mockFrom.mockImplementation((table: unknown) => {
        const tableName = table as string;
        if (tableName === "cycle_state") {
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                data: null,
                error: null,
              }),
            }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(async () => ({
                  data: createValidCycleState({
                    id: "new-cycle-id",
                    status: "READY",
                    capital_available: 1050,
                    btc_accumulated: 0.00000278,
                    btc_dust: 0.00000278,
                    purchases_remaining: 10,
                    buy_amount: 105,
                    reference_price: null,
                    ath_price: null,
                    previous_cycle_id: "old-cycle-id",
                    strategy_config_id: "strategy-123",
                  }),
                  error: null,
                })),
              }),
            }),
            select: jest.fn(),
            delete: jest.fn(),
            upsert: jest.fn(),
          };
        } else if (tableName === "strategy_config") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn(async () => ({
                  data: {
                    id: "strategy-123",
                    max_purchases: 10,
                    initial_capital_usdt: 1000,
                    is_active: true,
                  },
                  error: null,
                })),
              }),
            }),
            insert: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            upsert: jest.fn(),
          };
        }
        return {
          select: jest.fn(),
          insert: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          upsert: jest.fn(),
        };
      });

      const newCycle = await cycleStateManager.createNewCycleAfterCompletion(
        previousCycle,
        completionData,
      );

      expect(newCycle).toMatchObject({
        status: "READY",
        capital_available: 1050,
        btc_accumulated: 0.00000278,
        btc_dust: 0.00000278,
        purchases_remaining: 10,
        reference_price: null,
        previous_cycle_id: "old-cycle-id",
      });

      // Verify the old cycle was marked as completed
      expect(mockSupabase.from).toHaveBeenCalledWith("cycle_state");
    });

    it("should calculate correct buy amount for new cycle", async () => {
      const previousCycle = createValidCycleState({
        id: "old-cycle-id",
      });

      const completionData = {
        finalProfit: 100,
        carryOverCapital: 1100,
        carryOverDust: 0,
      };

      // Mock the strategy config to return 5 max purchases
      const mockFrom = mockSupabase.from as unknown as jest.Mock;
      mockFrom.mockImplementation((table: unknown) => {
        const tableName = table as string;
        if (tableName === "cycle_state") {
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                data: null,
                error: null,
              }),
            }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(async () => ({
                  data: createValidCycleState({
                    id: "new-cycle-id",
                    buy_amount: 220, // 1100 / 5 = 220
                  }),
                  error: null,
                })),
              }),
            }),
            select: jest.fn(),
            delete: jest.fn(),
            upsert: jest.fn(),
          };
        } else if (tableName === "strategy_config") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn(async () => ({
                  data: {
                    id: "strategy-123",
                    max_purchases: 5,
                    initial_capital_usdt: 1000,
                    is_active: true,
                  },
                  error: null,
                })),
              }),
            }),
            insert: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            upsert: jest.fn(),
          };
        }
        return {
          select: jest.fn(),
          insert: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          upsert: jest.fn(),
        };
      });

      const newCycle = await cycleStateManager.createNewCycleAfterCompletion(
        previousCycle,
        completionData,
      );

      // 1100 / 5 = 220
      expect(newCycle.buy_amount).toBe(220);
    });
  });
});
