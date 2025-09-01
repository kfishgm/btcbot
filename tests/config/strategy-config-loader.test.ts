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

      mockSupabaseClient.single.mockResolvedValue({
        data: mockConfig,
        error: null,
      });

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
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      });

      // Mock successful insert of default config
      const defaultConfig = {
        id: "generated-id",
        timeframe: "4h",
        drop_percentage: 0.05,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 10,
        initial_capital_usdt: 300,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        is_active: false, // MUST be false for default
        updated_at: "2025-01-01T00:00:00Z",
      };

      // Mock the insert - it doesn't return data, just error status
      mockSupabaseClient.insert.mockResolvedValue({
        data: null,
        error: null,
      });

      // Mock single for the fetch after insert
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: defaultConfig,
        error: null,
      });

      const config = await loader.loadConfig();

      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          timeframe: "4h",
          drop_percentage: 0.05,
          rise_percentage: 0.05,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 300,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          is_active: false,
        }),
      );
      expect(config.isActive).toBe(false);
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
        is_active: true,
        updated_at: "2025-01-01T00:00:00Z",
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: invalidConfig,
        error: null,
      });

      await expect(loader.loadConfig()).rejects.toThrow(
        /drop_percentage must be between 0.02 and 0.08/,
      );
    });

    it("should handle database connection errors", async () => {
      mockSupabaseClient.single.mockResolvedValue({
        data: null,
        error: { code: "CONNECTION_ERROR", message: "Database unavailable" },
      });

      await expect(loader.loadConfig()).rejects.toThrow(/Database unavailable/);
    });
  });

  describe("validateConfig()", () => {
    it("should validate dropPercentage is between 0.02 and 0.08", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, dropPercentage: 0.019 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /drop_percentage must be between 0.02 and 0.08/,
      );

      const tooHigh = { ...validConfig, dropPercentage: 0.081 };
      expect(() => loader.validateConfig(tooHigh)).toThrow(
        /drop_percentage must be between 0.02 and 0.08/,
      );
    });

    it("should validate risePercentage is between 0.02 and 0.08", async () => {
      const validConfig = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
      };

      expect(() => loader.validateConfig(validConfig)).not.toThrow();

      const tooLow = { ...validConfig, risePercentage: 0.019 };
      expect(() => loader.validateConfig(tooLow)).toThrow(
        /rise_percentage must be between 0.02 and 0.08/,
      );

      const tooHigh = { ...validConfig, risePercentage: 0.081 };
      expect(() => loader.validateConfig(tooHigh)).toThrow(
        /rise_percentage must be between 0.02 and 0.08/,
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

    it("should prevent configuration of constants", async () => {
      const configWithConstants = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        ATH_WINDOW: 30, // Should not be configurable
      };

      expect(() => loader.validateConfig(configWithConstants)).toThrow(
        /ATH_WINDOW is a constant and cannot be configured/,
      );
    });
  });
});
