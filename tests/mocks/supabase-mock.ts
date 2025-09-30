import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";
import { jest } from "@jest/globals";

interface MockResponse<T> {
  data: T | null;
  error: unknown;
}

interface MockConfig {
  cycle_state?: {
    select?: MockResponse<Database["public"]["Tables"]["cycle_state"]["Row"]>;
    insert?: MockResponse<Database["public"]["Tables"]["cycle_state"]["Row"]>;
    update?: MockResponse<Database["public"]["Tables"]["cycle_state"]["Row"]>;
  };
  bot_events?: {
    insert?: MockResponse<Database["public"]["Tables"]["bot_events"]["Row"]>;
  };
  strategy_config?: {
    select?: MockResponse<
      Database["public"]["Tables"]["strategy_config"]["Row"]
    >;
  };
  trades?: {
    select?: MockResponse<Database["public"]["Tables"]["trades"]["Row"][]>;
    insert?: MockResponse<Database["public"]["Tables"]["trades"]["Row"]>;
  };
}

export function createMockSupabaseClient(
  config: MockConfig,
): SupabaseClient<Database> {
  // Track inserted/updated state for each table
  const tableState: Record<string, unknown> = {};

  const mockClient = {
    from: jest.fn((tableName: string) => {
      const tableConfig = config[tableName as keyof MockConfig];

      // Build mock query result object
      const mockQueryResult = () => {
        // If we have state for this table (from previous insert/update), return it
        if (tableState[tableName]) {
          return {
            data: [tableState[tableName]],
            error: null,
          };
        }
        // Otherwise determine result based on table config
        if (tableConfig && "select" in tableConfig && tableConfig.select) {
          // For queries expecting arrays (e.g., .order().limit())
          return {
            data: tableConfig.select.data ? [tableConfig.select.data] : null,
            error: tableConfig.select.error || null,
          };
        }
        return { data: null, error: null };
      };

      const queryBuilder = {
        select: jest.fn(() => {
          const selectResult = {
            single: jest.fn(async () => {
              // If we have state for this table, return it
              if (tableState[tableName]) {
                return { data: tableState[tableName], error: null };
              }
              // Otherwise use the configured select response
              if (tableConfig && "select" in tableConfig) {
                return tableConfig.select;
              }
              return { data: null, error: null };
            }),
            eq: jest.fn(() => selectResult),
            in: jest.fn(() => selectResult), // Add .in() support for filtering - returns selectResult for chaining
            order: jest.fn(() => ({
              ...selectResult,
              limit: jest.fn(() => ({
                ...selectResult,
                single: selectResult.single, // Support .order().limit().single() chain
              })),
            })),
            limit: jest.fn(() => ({
              ...selectResult,
              single: selectResult.single, // Support .limit().single() chain
            })),
            ...mockQueryResult(), // Direct access for simple select
          };
          return selectResult;
        }),
        insert: jest.fn((_data: unknown) => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => {
              if (tableConfig && "insert" in tableConfig) {
                // Store the inserted data in tableState for subsequent selects
                if (tableConfig.insert?.data) {
                  tableState[tableName] = tableConfig.insert.data;
                }
                return tableConfig.insert;
              }
              return { data: null, error: null };
            }),
          })),
        })),
        update: jest.fn((_data: unknown) => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(async () => {
                if (tableConfig && "update" in tableConfig) {
                  // Store the updated data in tableState for subsequent selects
                  if (tableConfig.update?.data) {
                    tableState[tableName] = tableConfig.update.data;
                  }
                  return tableConfig.update;
                }
                return { data: null, error: null };
              }),
            })),
          })),
        })),
        delete: jest.fn(() => ({
          eq: jest.fn(() => queryBuilder),
        })),
        upsert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => {
              return { data: null, error: null };
            }),
          })),
        })),
      };

      return queryBuilder;
    }),
  } as unknown as SupabaseClient<Database>;

  return mockClient;
}
