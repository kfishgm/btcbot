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
  const mockClient = {
    from: jest.fn((tableName: string) => {
      const tableConfig = config[tableName as keyof MockConfig];

      const queryBuilder = {
        select: jest.fn(() => ({
          single: jest.fn(async () => {
            if (tableConfig && "select" in tableConfig) {
              return tableConfig.select;
            }
            return { data: null, error: null };
          }),
          eq: jest.fn(() => queryBuilder),
          order: jest.fn(() => queryBuilder),
          limit: jest.fn(() => queryBuilder),
        })),
        insert: jest.fn((_data: unknown) => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => {
              if (tableConfig && "insert" in tableConfig) {
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
