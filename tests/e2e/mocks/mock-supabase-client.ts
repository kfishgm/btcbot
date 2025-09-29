/**
 * Mock Supabase Client for E2E Tests
 *
 * Simulates database operations without real database connection
 */

import type { Database } from "../../../types/supabase.js";

type CycleState = Database["public"]["Tables"]["cycle_state"]["Row"];
type StrategyConfig = Database["public"]["Tables"]["strategy_config"]["Row"];
type Trade = Database["public"]["Tables"]["trades"]["Row"];
type BotEvent = Database["public"]["Tables"]["bot_events"]["Row"];

interface MockData {
  cycle_state: Map<string, CycleState>;
  strategy_config: Map<string, StrategyConfig>;
  trades: Trade[];
  bot_events: BotEvent[];
}

export class MockSupabaseClient {
  private mockData: MockData = {
    cycle_state: new Map(),
    strategy_config: new Map(),
    trades: [],
    bot_events: [],
  };

  private rpcResults = new Map<string, unknown>();

  constructor() {
    // Initialize with default test data
    this.initializeTestData();
  }

  private initializeTestData() {
    // Default strategy config for tests
    const defaultStrategy: StrategyConfig = {
      id: "test-strategy",
      timeframe: "5m",
      drop_percentage: 0.003,
      rise_percentage: 0.005,
      max_purchases: 10,
      min_buy_usdt: 10,
      initial_capital_usdt: 1000,
      slippage_buy_pct: 0.003,
      slippage_sell_pct: 0.003,
      ath_window: 25,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    this.mockData.strategy_config.set("test-strategy", defaultStrategy);

    // Default cycle state for tests
    const defaultCycle: CycleState = {
      id: "test-cycle",
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      btc_accum_net: 0,
      btc_dust: null,
      cost_accum_usdt: 0,
      purchases_remaining: 10,
      ath_reference_price: null,
      sell_reference_price: null,
      ath_price: null,
      buy_amount: 100,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      completed_at: null,
      final_profit: null,
      previous_cycle_id: null,
      strategy_config_id: null,
      updated_at: new Date().toISOString(),
      version: 1,
    };
    this.mockData.cycle_state.set("test-cycle", defaultCycle);
  }

  from(table: keyof MockData) {
    const tableData = this.mockData[table];

    return {
      select: (_columns = "*") => ({
        eq: (_column: string, value: unknown) => ({
          single: async () => {
            if (table === "cycle_state" || table === "strategy_config") {
              const data = (tableData as Map<string, unknown>).get(
                value as string,
              );
              return { data, error: null };
            }
            return { data: null, error: null };
          },
        }),
        single: async () => {
          if (table === "cycle_state" || table === "strategy_config") {
            const values = Array.from(
              (tableData as Map<string, unknown>).values(),
            );
            return { data: values[0] || null, error: null };
          }
          return { data: null, error: null };
        },
        order: (_column: string, _options?: { ascending?: boolean }) => ({
          limit: (_count: number) => ({
            single: async () => {
              if (table === "cycle_state" || table === "strategy_config") {
                const values = Array.from(
                  (tableData as Map<string, unknown>).values(),
                );
                // Return first value as single result
                return { data: values[0] || null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),

      insert: (data: unknown | unknown[]) => {
        const insertData = Array.isArray(data) ? data : [data];
        let finalData = insertData;

        if (table === "bot_events") {
          (tableData as BotEvent[]).push(...(insertData as BotEvent[]));
        } else if (table === "trades") {
          (tableData as Trade[]).push(...(insertData as Trade[]));
        } else if (table === "cycle_state") {
          // Handle cycle_state inserts
          const cycleData = insertData[0] as CycleState;
          const id = cycleData.id || `cycle_${Date.now()}`;
          const newCycleState = {
            ...cycleData,
            id,
            updated_at: new Date().toISOString(),
          } as CycleState;
          (tableData as Map<string, CycleState>).set(id, newCycleState);
          finalData = [newCycleState];
        }

        return {
          data: finalData,
          error: null,
          select: () => ({
            single: async () => ({ data: finalData[0], error: null }),
          }),
        };
      },

      update: (updates: Partial<unknown>) => ({
        eq: (_column: string, value: unknown) => ({
          select: () => ({
            single: async () => {
              if (table === "cycle_state") {
                const existing = (tableData as Map<string, CycleState>).get(
                  value as string,
                );
                if (existing) {
                  const updated = {
                    ...existing,
                    ...updates,
                    updated_at: new Date().toISOString(),
                  };
                  (tableData as Map<string, CycleState>).set(
                    value as string,
                    updated as CycleState,
                  );
                  return { data: updated, error: null };
                }
              }
              return { data: null, error: { message: "Not found" } };
            },
          }),
        }),
      }),
    };
  }

  rpc(functionName: string, _params?: Record<string, unknown>) {
    // Mock RPC calls for state transitions
    const mockResult = this.rpcResults.get(functionName) || { success: true };

    return {
      data: mockResult,
      error: null,
    };
  }

  // Helper methods for testing
  setCycleState(id: string, state: Partial<CycleState>) {
    const existing = this.mockData.cycle_state.get(id);
    const updated = {
      ...(existing || this.getDefaultCycleState()),
      ...state,
      id,
      updated_at: new Date().toISOString(),
    } as CycleState;
    this.mockData.cycle_state.set(id, updated);
  }

  setStrategyConfig(id: string, config: Partial<StrategyConfig>) {
    const existing = this.mockData.strategy_config.get(id);
    const updated = {
      ...(existing || this.getDefaultStrategyConfig()),
      ...config,
      id,
      updated_at: new Date().toISOString(),
    } as StrategyConfig;
    this.mockData.strategy_config.set(id, updated);
  }

  getCycleState(id: string): CycleState | undefined {
    return this.mockData.cycle_state.get(id);
  }

  getTrades(): Trade[] {
    return [...this.mockData.trades];
  }

  getBotEvents(): BotEvent[] {
    return [...this.mockData.bot_events];
  }

  setRpcResult(functionName: string, result: unknown) {
    this.rpcResults.set(functionName, result);
  }

  private getDefaultCycleState(): CycleState {
    return {
      id: "test-cycle",
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      btc_accum_net: 0,
      btc_dust: null,
      cost_accum_usdt: 0,
      purchases_remaining: 10,
      ath_reference_price: null,
      sell_reference_price: null,
      ath_price: null,
      buy_amount: 100,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      completed_at: null,
      final_profit: null,
      previous_cycle_id: null,
      strategy_config_id: null,
      version: 1,
      updated_at: new Date().toISOString(),
    };
  }

  private getDefaultStrategyConfig(): StrategyConfig {
    return {
      id: "test-strategy",
      timeframe: "5m",
      drop_percentage: 0.003,
      rise_percentage: 0.005,
      max_purchases: 10,
      min_buy_usdt: 10,
      initial_capital_usdt: 1000,
      slippage_buy_pct: 0.003,
      slippage_sell_pct: 0.003,
      ath_window: 25,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
  }

  reset() {
    this.mockData = {
      cycle_state: new Map(),
      strategy_config: new Map(),
      trades: [],
      bot_events: [],
    };
    this.rpcResults.clear();
    this.initializeTestData();
  }
}
