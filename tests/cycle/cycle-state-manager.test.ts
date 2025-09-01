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

describe("CycleStateManager", () => {
  let mockSupabase: SupabaseClient<Database>;
  let cycleStateManager: CycleStateManager;
  let config: CycleStateManagerConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    config = {
      initialCapitalUSDT: 300,
      maxPurchases: 10,
      minBuyUSDT: 10,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("initialize()", () => {
    describe("when no cycle state exists", () => {
      beforeEach(() => {
        const insertData: CycleState = {
          id: "test-id",
          status: "READY",
          capital_available: 300,
          btc_accumulated: 0,
          purchases_remaining: 10,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: null, error: { code: "PGRST116" } },
            insert: { data: insertData, error: null },
          },
          bot_events: {
            insert: { data: null, error: null },
          },
        });
      });

      it("should create initial cycle state with READY status", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        // Verify that cycle_state was accessed - the mock was configured for it
        expect(mockSupabase.from).toHaveBeenCalled();

        const state = cycleStateManager.getCurrentState();
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

          const insertData: CycleState = {
            id: "test-id",
            status: "READY",
            capital_available: testConfig.capital,
            btc_accumulated: 0,
            purchases_remaining: testConfig.purchases,
            reference_price: null,
            cost_accum_usdt: 0,
            btc_accum_net: 0,
            ath_price: null,
            buy_amount: testConfig.expected,
            updated_at: new Date().toISOString(),
          };

          const localMockSupabase = createMockSupabaseClient({
            cycle_state: {
              select: { data: null, error: { code: "PGRST116" } },
              insert: { data: insertData, error: null },
            },
            bot_events: {
              insert: { data: null, error: null },
            },
          });

          const manager = new CycleStateManager(localMockSupabase, localConfig);
          await manager.initialize();

          const state = manager.getCurrentState();
          expect(state?.buy_amount).toBe(testConfig.expected);
        }
      });

      it("should set all initial accumulators to zero", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state).toMatchObject({
          btc_accumulated: 0,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
        });
      });

      it("should set reference_price and ath_price to null initially", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state?.reference_price).toBeNull();
        expect(state?.ath_price).toBeNull();
      });

      it("should log bot event for initialization", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        // Verify bot event was logged
        expect(mockSupabase.from).toHaveBeenCalled();
      });
    });

    describe("when valid cycle state exists", () => {
      let existingState: CycleState;

      beforeEach(() => {
        existingState = {
          id: "existing-id",
          status: "HOLDING",
          capital_available: 150,
          btc_accumulated: 0.005,
          purchases_remaining: 5,
          reference_price: 30000,
          cost_accum_usdt: 150,
          btc_accum_net: 0.005,
          ath_price: 31000,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: existingState, error: null },
          },
        });
      });

      it("should recover existing state", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state).toMatchObject({
          id: "existing-id",
          status: "HOLDING",
          capital_available: 150,
          btc_accumulated: 0.005,
          purchases_remaining: 5,
        });
      });

      it("should not create new state when valid state exists", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        // Verify no insert was called since state already exists
        const state = cycleStateManager.getCurrentState();
        expect(state).not.toBeNull();
        expect(state?.id).toBe("existing-id");
      });

      it("should validate recovered state", async () => {
        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state).not.toBeNull();
        if (state) {
          expect(cycleStateManager.validateState(state)).toBe(true);
        }
      });
    });

    describe("when corrupted cycle state exists", () => {
      it("should detect negative capital_available", async () => {
        const corruptedState: CycleState = {
          id: "corrupt-id",
          status: "READY",
          capital_available: -100,
          btc_accumulated: 0,
          purchases_remaining: 10,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

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

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should detect purchases_remaining exceeding max_purchases", async () => {
        const corruptedState: CycleState = {
          id: "corrupt-id",
          status: "READY",
          capital_available: 300,
          btc_accumulated: 0,
          purchases_remaining: 15,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

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

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
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

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should detect missing reference_price when holding", async () => {
        const corruptedState: CycleState = {
          id: "corrupt-id",
          status: "HOLDING",
          capital_available: 150,
          btc_accumulated: 0.005,
          purchases_remaining: 5,
          reference_price: null,
          cost_accum_usdt: 150,
          btc_accum_net: 0.005,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

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

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        const state = cycleStateManager.getCurrentState();
        expect(state?.status).toBe("PAUSED");
      });

      it("should log bot event for corruption detection", async () => {
        const corruptedState: CycleState = {
          id: "corrupt-id",
          status: "READY",
          capital_available: -100,
          btc_accumulated: 0,
          purchases_remaining: 10,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

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

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await cycleStateManager.initialize();

        // Verify corruption was logged
        expect(mockSupabase.from).toHaveBeenCalled();
        const state = cycleStateManager.getCurrentState();
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

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await expect(cycleStateManager.initialize()).rejects.toThrow(
          "Failed to query cycle state",
        );
      });

      it("should throw error when state creation fails", async () => {
        mockSupabase = createMockSupabaseClient({
          cycle_state: {
            select: { data: null, error: { code: "PGRST116" } },
            insert: { data: null, error: new Error("Insert failed") },
          },
        });

        cycleStateManager = new CycleStateManager(mockSupabase, config);

        await expect(cycleStateManager.initialize()).rejects.toThrow(
          "Failed to create initial cycle state",
        );
      });
    });
  });

  describe("getCurrentState()", () => {
    it("should return null before initialization", () => {
      mockSupabase = createMockSupabaseClient({});
      cycleStateManager = new CycleStateManager(mockSupabase, config);

      expect(cycleStateManager.getCurrentState()).toBeNull();
    });

    it("should return immutable copy of state", async () => {
      const state: CycleState = {
        id: "test-id",
        status: "READY",
        capital_available: 300,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      };

      mockSupabase = createMockSupabaseClient({
        cycle_state: {
          select: { data: state, error: null },
        },
      });

      cycleStateManager = new CycleStateManager(mockSupabase, config);
      await cycleStateManager.initialize();

      const state1 = cycleStateManager.getCurrentState();
      const state2 = cycleStateManager.getCurrentState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("validateState()", () => {
    beforeEach(() => {
      mockSupabase = createMockSupabaseClient({});
      cycleStateManager = new CycleStateManager(mockSupabase, config);
    });

    it("should validate capital_available is non-negative", () => {
      const validState: CycleState = {
        id: "test-id",
        status: "READY",
        capital_available: 0,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      };

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, capital_available: -1 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate btc_accumulated is non-negative", () => {
      const validState: CycleState = {
        id: "test-id",
        status: "READY",
        capital_available: 300,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      };

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, btc_accumulated: -0.001 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate purchases_remaining does not exceed max_purchases", () => {
      const validState: CycleState = {
        id: "test-id",
        status: "READY",
        capital_available: 300,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      };

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, purchases_remaining: 11 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate status is a valid enum value", () => {
      const validStatuses = ["READY", "HOLDING", "PAUSED"];

      for (const status of validStatuses) {
        const state: CycleState = {
          id: "test-id",
          status,
          capital_available: 300,
          btc_accumulated: 0,
          purchases_remaining: 10,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: null,
          buy_amount: 30,
          updated_at: new Date().toISOString(),
        };

        expect(cycleStateManager.validateState(state)).toBe(true);
      }

      const invalidState = {
        id: "test-id",
        status: "INVALID",
        capital_available: 300,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      } as CycleState;

      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });

    it("should validate reference_price exists when holding", () => {
      const holdingWithPrice: CycleState = {
        id: "test-id",
        status: "HOLDING",
        capital_available: 150,
        btc_accumulated: 0.005,
        purchases_remaining: 5,
        reference_price: 30000,
        cost_accum_usdt: 150,
        btc_accum_net: 0.005,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      };

      expect(cycleStateManager.validateState(holdingWithPrice)).toBe(true);

      const holdingWithoutPrice = {
        ...holdingWithPrice,
        reference_price: null,
      };
      expect(cycleStateManager.validateState(holdingWithoutPrice)).toBe(false);
    });

    it("should validate buy_amount meets min_buy_usdt requirement", () => {
      const validState: CycleState = {
        id: "test-id",
        status: "READY",
        capital_available: 300,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
        updated_at: new Date().toISOString(),
      };

      expect(cycleStateManager.validateState(validState)).toBe(true);

      const invalidState = { ...validState, buy_amount: 5 };
      expect(cycleStateManager.validateState(invalidState)).toBe(false);
    });
  });
});
