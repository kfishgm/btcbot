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
              // If we have state for this table, return a copy (immutable pattern)
              if (tableState[tableName]) {
                return {
                  data: { ...tableState[tableName] },
                  error: null,
                };
              }
              // Otherwise use the configured select response (return copy for immutability)
              if (
                tableConfig &&
                "select" in tableConfig &&
                tableConfig.select
              ) {
                const configuredData = tableConfig.select.data;
                return {
                  data: configuredData ? { ...configuredData } : null,
                  error: tableConfig.select.error || null,
                };
              }
              return { data: null, error: null };
            }),
            eq: jest.fn(() => selectResult),
            in: jest.fn(() => selectResult), // Add .in() support for filtering - returns selectResult for chaining
            order: jest.fn(() => {
              const orderedResult = {
                ...selectResult,
                ...mockQueryResult(), // Add array data support
                limit: jest.fn(() => ({
                  ...selectResult,
                  ...mockQueryResult(), // Add array data support
                  single: selectResult.single, // Support .order().limit().single() chain
                })),
              };
              return orderedResult;
            }),
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
          eq: jest.fn(() => {
            // Store updated data immediately when .eq() is called
            // This handles cases where .select().single() is not chained
            if (
              tableConfig &&
              "update" in tableConfig &&
              tableConfig.update?.data
            ) {
              tableState[tableName] = tableConfig.update.data;
            }

            return {
              select: jest.fn(() => ({
                single: jest.fn(async () => {
                  if (tableConfig && "update" in tableConfig) {
                    return tableConfig.update;
                  }
                  return { data: null, error: null };
                }),
              })),
              // Also return data/error for direct await on .eq()
              then: jest.fn(
                (resolve: (value: MockResponse<unknown>) => void) => {
                  if (tableConfig && "update" in tableConfig) {
                    resolve(tableConfig.update as MockResponse<unknown>);
                  } else {
                    resolve({ data: null, error: null });
                  }
                },
              ),
            };
          }),
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
