import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Type definitions for what we expect
export interface StrategyConfig {
  id: string;
  timeframe: string;
  dropPercentage: number;
  risePercentage: number;
  maxPurchases: number;
  minBuyUsdt: number;
  initialCapitalUsdt: number;
  slippageBuyPct: number;
  slippageSellPct: number;
  isActive: boolean;
  updatedAt: string;
}

interface StrategyConfigLoaderInterface {
  loadConfig(): Promise<StrategyConfig>;
  validateConfig(config: unknown): void;
}

// Mock type for the Supabase client chain
type MockSupabaseClient = {
  from: jest.MockedFunction<(table: string) => MockSupabaseClient>;
  select: jest.MockedFunction<(columns: string) => MockSupabaseClient>;
  eq: jest.MockedFunction<
    (column: string, value: unknown) => MockSupabaseClient
  >;
  single: jest.MockedFunction<() => Promise<{ data: unknown; error: unknown }>>;
  insert: jest.MockedFunction<
    (data: unknown) => Promise<{ data: unknown; error: unknown }>
  >;
  update: jest.MockedFunction<(data: unknown) => MockSupabaseClient>;
  order: jest.MockedFunction<
    (column: string, options?: unknown) => MockSupabaseClient
  >;
  limit: jest.MockedFunction<(count: number) => MockSupabaseClient>;
  data?: unknown;
  error?: unknown;
};

describe("StrategyConfigLoader", () => {
  let StrategyConfigLoaderClass: new () => StrategyConfigLoaderInterface;
  let mockSupabaseClient: MockSupabaseClient;
  let loader: StrategyConfigLoaderInterface;

  beforeEach(async () => {
    // Reset modules
    jest.resetModules();

    // Create mock for Supabase client
    mockSupabaseClient = {
      from: jest.fn(() => mockSupabaseClient) as MockSupabaseClient["from"],
      select: jest.fn(() => mockSupabaseClient) as MockSupabaseClient["select"],
      eq: jest.fn(() => mockSupabaseClient) as MockSupabaseClient["eq"],
      single: jest.fn() as MockSupabaseClient["single"],
      insert: jest.fn() as MockSupabaseClient["insert"],
      update: jest.fn(() => mockSupabaseClient) as MockSupabaseClient["update"],
      order: jest.fn(() => mockSupabaseClient) as MockSupabaseClient["order"],
      limit: jest.fn(() => mockSupabaseClient) as MockSupabaseClient["limit"],
    };

    // Mock Supabase client
    jest.unstable_mockModule("@supabase/supabase-js", () => ({
      createClient: jest.fn().mockReturnValue(mockSupabaseClient),
    }));

    // Mock config module
    jest.unstable_mockModule("../../src/config/index.js", () => ({
      getConfig: jest.fn().mockReturnValue({
        supabase: {
          url: "https://test.supabase.co",
          serviceRoleKey: "test-key",
        },
      }),
    }));

    // Import the module to test
    const module = await import("../../src/config/strategy-config-loader.js");
    StrategyConfigLoaderClass = module.StrategyConfigLoader;
    loader = new StrategyConfigLoaderClass();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("loadConfig()", () => {
    it("should load active configuration from database", async () => {
      const mockConfig = {
        id: "test-id",
        timeframe: "4h",
        drop_percentage: 0.05,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 10,
        initial_capital_usdt: 300,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        is_active: true,
        updated_at: "2025-01-01T00:00:00Z",
      };

      // Mock the return for order().limit() chain
      mockSupabaseClient.limit.mockReturnValue({
        ...mockSupabaseClient,
        data: [mockConfig],
        error: null,
      } as unknown as MockSupabaseClient);

      const config = await loader.loadConfig();

      expect(mockSupabaseClient.from).toHaveBeenCalledWith("strategy_config");
      expect(mockSupabaseClient.select).toHaveBeenCalledWith("*");
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith("is_active", true);
      expect(config).toEqual({
        id: "test-id",
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        isActive: true,
        updatedAt: "2025-01-01T00:00:00Z",
      });
    });

    it("should create default configuration if none exists", async () => {
      // Mock no active config found
      mockSupabaseClient.limit.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: null,
        error: null,
      } as unknown as MockSupabaseClient);

      // Mock successful insert of default config
      const defaultConfig = {
        id: "generated-id",
        timeframe: "4h",
        drop_percentage: 0.03,
        rise_percentage: 0.03,
        max_purchases: 10,
        min_buy_usdt: 10,
        initial_capital_usdt: 300,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        is_active: true, // Default is created with is_active: true
        updated_at: "2025-01-01T00:00:00Z",
        ath_window: 20,
      };

      // Mock the insert - it doesn't return data, just error status
      mockSupabaseClient.insert.mockResolvedValue({
        data: null,
        error: null,
      });

      // Mock limit for the fetch after insert
      mockSupabaseClient.limit.mockReturnValueOnce({
        ...mockSupabaseClient,
        data: [defaultConfig],
        error: null,
      } as unknown as MockSupabaseClient);

      const config = await loader.loadConfig();

      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 300,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
        }),
      );
      expect(config.isActive).toBe(true);
    });

    it("should fail startup if configuration values are invalid", async () => {
      const invalidConfig = {
        id: "test-id",
        timeframe: "4h",
        drop_percentage: 0.001, // Invalid: less than 0.02
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 10,
        initial_capital_usdt: 300,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        ath_window: 20,
        is_active: true,
        updated_at: "2025-01-01T00:00:00Z",
      };

      mockSupabaseClient.limit.mockReturnValue({
        ...mockSupabaseClient,
        data: [invalidConfig],
        error: null,
      } as unknown as MockSupabaseClient);

      await expect(loader.loadConfig()).rejects.toThrow(
        /drop_percentage must be between 0.0015 and 0.08/,
      );
    });

    it("should handle database connection errors", async () => {
      mockSupabaseClient.limit.mockReturnValue({
        ...mockSupabaseClient,
        data: null,
        error: { code: "CONNECTION_ERROR", message: "Database unavailable" },
      } as unknown as MockSupabaseClient);

      await expect(loader.loadConfig()).rejects.toThrow(/Database unavailable/);
    });
  });

  describe("validateConfig()", () => {
    it("should validate dropPercentage is between 0.0015 and 0.08", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        athWindow: 20,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, dropPercentage: 0.0014 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /drop_percentage must be between 0.0015 and 0.08/,
      );

      const tooHigh = { ...validConfig, dropPercentage: 0.081 };
      expect(() => loader.validateConfig(tooHigh)).toThrow(
        /drop_percentage must be between 0.0015 and 0.08/,
      );
    });

    it("should validate risePercentage is between 0.0015 and 0.08", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        athWindow: 20,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, risePercentage: 0.0014 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /rise_percentage must be between 0.0015 and 0.08/,
      );

      const tooHigh = { ...validConfig, risePercentage: 0.081 };
      expect(() => loader.validateConfig(tooHigh)).toThrow(
        /rise_percentage must be between 0.0015 and 0.08/,
      );
    });

    it("should validate maxPurchases is between 1 and 30", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        athWindow: 20,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, maxPurchases: 0 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /max_purchases must be between 1 and 30/,
      );

      const tooHigh = { ...validConfig, maxPurchases: 31 };
      expect(() => loader.validateConfig(tooHigh)).toThrow(
        /max_purchases must be between 1 and 30/,
      );
    });

    it("should validate minBuyUsdt is at least 10", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        athWindow: 20,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, minBuyUsdt: 9.99 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /min_buy_usdt must be at least 10/,
      );
    });

    it("should validate all required fields are present", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        athWindow: 20,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      // Test each missing field
      const requiredFields = [
        "timeframe",
        "dropPercentage",
        "risePercentage",
        "maxPurchases",
        "minBuyUsdt",
        "initialCapitalUsdt",
        "slippageBuyPct",
        "slippageSellPct",
        "athWindow",
      ];

      for (const field of requiredFields) {
        const configWithoutField = { ...validConfig };
        const recordConfig = configWithoutField as Record<string, unknown>;
        delete recordConfig[field];
        expect(() => loader.validateConfig(configWithoutField)).toThrow(
          new RegExp(`${field}.*required`),
        );
      }
    });

    it("should reject null or undefined configuration", async () => {
      expect(() => loader.validateConfig(null)).toThrow(
        /Configuration cannot be null or undefined/,
      );

      expect(() => loader.validateConfig(undefined)).toThrow(
        /Configuration cannot be null or undefined/,
      );
    });

    it("should validate athWindow range", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        athWindow: 100, // Valid range: 10-500
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, athWindow: 9 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /ath_window must be between 10 and 500/,
      );

      const tooHigh = { ...validConfig, athWindow: 501 };
      expect(() => loader.validateConfig(tooHigh)).toThrow(
        /ath_window must be between 10 and 500/,
      );
    });
  });
});
