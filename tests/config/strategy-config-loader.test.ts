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
  capitalAllocationPct?: number;
}

interface StrategyConfigLoaderInterface {
  loadConfig(): Promise<StrategyConfig>;
  validateConfig(config: unknown): void;
  loadAllActiveConfigs(accountBalance?: number): Promise<StrategyConfig[]>;
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
    (
      column: string,
      options?: unknown,
    ) => MockSupabaseClient & Promise<{ data: unknown; error: unknown }>
  >;
  limit: jest.MockedFunction<
    (count: number) => Promise<{ data: unknown; error: unknown }>
  >;
  data?: unknown;
  error?: unknown;
  then?: unknown;
};

describe("StrategyConfigLoader", () => {
  let StrategyConfigLoaderClass: new () => StrategyConfigLoaderInterface;
  let mockSupabaseClient: MockSupabaseClient;
  let loader: StrategyConfigLoaderInterface;

  beforeEach(async () => {
    // Reset modules
    jest.resetModules();

    // Create mock for Supabase client
    // Start with a base object that will become our mock client
    const baseClient = {
      from: jest.fn() as MockSupabaseClient["from"],
      select: jest.fn() as MockSupabaseClient["select"],
      eq: jest.fn() as MockSupabaseClient["eq"],
      single: jest.fn() as MockSupabaseClient["single"],
      insert: jest.fn() as MockSupabaseClient["insert"],
      update: jest.fn() as MockSupabaseClient["update"],
      order: jest.fn() as unknown as MockSupabaseClient["order"],
      limit: jest.fn() as MockSupabaseClient["limit"],
    } as unknown as MockSupabaseClient;

    // Set up chainable methods for from, select, eq, update
    (baseClient.from as jest.Mock).mockImplementation(() => baseClient);
    (baseClient.select as jest.Mock).mockImplementation(() => baseClient);
    (baseClient.eq as jest.Mock).mockImplementation(() => baseClient);
    (baseClient.update as jest.Mock).mockImplementation(() => baseClient);

    // order() needs special handling: it should return something that is both
    // thenable (can be awaited) AND chainable (has .limit() method)
    (baseClient.order as jest.Mock).mockImplementation(() => {
      // Get the configured return value for order (set via mockResolvedValue)
      const orderMock = baseClient.order as jest.Mock;
      // Note: We'll capture the resolved value via a wrapper around mockResolvedValue
      const configuredReturnValue =
        (orderMock as unknown as Record<string, unknown>)._mockResolvedValue ??
        null;

      // Create a wrapper that can act like a Promise when awaited
      // and also has methods when chained to
      const wrapper: unknown = Object.create(baseClient);

      // Make it thenable
      Object.defineProperty(wrapper, "then", {
        value: (
          onFulfilled: ((val: unknown) => unknown) | undefined,
          onRejected: ((err: unknown) => unknown) | undefined,
        ) => {
          if (
            configuredReturnValue &&
            typeof configuredReturnValue === "object" &&
            "data" in (configuredReturnValue as Record<string, unknown>)
          ) {
            return Promise.resolve(configuredReturnValue).then(
              onFulfilled,
              onRejected,
            );
          }
          return Promise.resolve({ data: null, error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
        enumerable: false,
      });

      return wrapper;
    });

    // Wrapper for mockResolvedValue to capture the value
    const mockObj = baseClient.order as unknown as Record<string, unknown>;
    const originalMockResolvedValue = mockObj.mockResolvedValue as (
      value: unknown,
    ) => unknown;
    mockObj.mockResolvedValue = function (value: unknown) {
      (this as unknown as Record<string, unknown>)._mockResolvedValue = value;
      return originalMockResolvedValue.call(this, value);
    };

    // Wrapper for mockResolvedValueOnce to capture the value
    const originalMockResolvedValueOnce = mockObj.mockResolvedValueOnce as (
      value: unknown,
    ) => unknown;
    mockObj.mockResolvedValueOnce = function (value: unknown) {
      (this as unknown as Record<string, unknown>)._mockResolvedValue = value;
      return originalMockResolvedValueOnce.call(this, value);
    };

    mockSupabaseClient = baseClient;

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
        ath_window: 25,
        is_active: true,
        updated_at: "2025-01-01T00:00:00Z",
        buy_mode: "arithmetic",
        capital_allocation_pct: null,
      };

      // Mock the return for order() chain (final method that returns Promise)
      mockSupabaseClient.order.mockResolvedValue({
        data: [mockConfig],
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
        athWindow: 25,
        isActive: true,
        updatedAt: "2025-01-01T00:00:00Z",
        buyMode: "arithmetic",
        capitalAllocationPct: undefined, // null from DB converts to undefined in JS
      });
    });

    it("should create default configuration if none exists", async () => {
      // Mock no active config found - order() returns empty
      mockSupabaseClient.order.mockResolvedValueOnce({
        data: null,
        error: null,
      });

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

      // Mock limit for the fetch after insert (second query in createDefaultConfig)
      mockSupabaseClient.limit.mockResolvedValueOnce({
        data: [defaultConfig],
        error: null,
      });

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

      mockSupabaseClient.order.mockResolvedValue({
        data: [invalidConfig],
        error: null,
      });

      await expect(loader.loadConfig()).rejects.toThrow(
        /drop_percentage must be between 0.0015 and 0.08/,
      );
    });

    it("should handle database connection errors", async () => {
      mockSupabaseClient.order.mockResolvedValue({
        data: null,
        error: { code: "CONNECTION_ERROR", message: "Database unavailable" },
      });

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

  describe("loadAllActiveConfigs() - Capital Allocation Percentages", () => {
    let mockLogger: {
      info: jest.MockedFunction<(...args: unknown[]) => void>;
      warn: jest.MockedFunction<(...args: unknown[]) => void>;
      error: jest.MockedFunction<(...args: unknown[]) => void>;
    };

    beforeEach(() => {
      // Mock the logger
      mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      // Mock the logger module
      jest.unstable_mockModule("../../src/utils/logger.js", () => ({
        logger: mockLogger,
      }));
    });

    it("should calculate capital from percentages when provided", async () => {
      const mockConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000, // Will be overridden by percentage
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 45, // 45% (reduced to stay under 95% safety limit)
        },
        {
          id: "config-2",
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000, // Will be overridden by percentage
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 30, // 30%
        },
        {
          id: "config-3",
          timeframe: "1d",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000, // Will be overridden by percentage
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 20, // 20% (total = 95%, exactly at limit)
        },
      ];

      // Mock the Supabase query to return multiple configs with percentages
      mockSupabaseClient.order.mockResolvedValue({
        data: mockConfigs,
        error: null,
      });

      // Re-import the module to get fresh instance with mocked logger
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      // Load configs with account balance
      const accountBalance = 1000;
      const configs = await loader.loadAllActiveConfigs(accountBalance);

      // Verify correct number of configs
      expect(configs).toHaveLength(3);

      // Verify capital is calculated from percentages
      expect(configs[0].initialCapitalUsdt).toBe(450); // 45% of 1000
      expect(configs[0].capitalAllocationPct).toBe(45);
      expect(configs[0].timeframe).toBe("1h");

      expect(configs[1].initialCapitalUsdt).toBe(300); // 30% of 1000
      expect(configs[1].capitalAllocationPct).toBe(30);
      expect(configs[1].timeframe).toBe("4h");

      expect(configs[2].initialCapitalUsdt).toBe(200); // 20% of 1000
      expect(configs[2].capitalAllocationPct).toBe(20);
      expect(configs[2].timeframe).toBe("1d");

      // Verify logger was called with allocation details
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Calculated capital allocation from percentages",
        expect.objectContaining({
          accountBalance: 1000,
          allocations: expect.arrayContaining([
            expect.objectContaining({
              timeframe: "1h",
              pct: 45,
              capital: "450.00",
            }),
            expect.objectContaining({
              timeframe: "4h",
              pct: 30,
              capital: "300.00",
            }),
            expect.objectContaining({
              timeframe: "1d",
              pct: 20,
              capital: "200.00",
            }),
          ]),
        }),
      );
    });

    it("should fail if some configs have percentages and others don't", async () => {
      const mockConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 500,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 50, // Has percentage
        },
        {
          id: "config-2",
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
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: null, // No percentage
        },
      ];

      // Mock the Supabase query
      mockSupabaseClient.order.mockResolvedValue({
        data: mockConfigs,
        error: null,
      });

      // Re-import the module to get fresh instance
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      // Should throw an error when mixing percentage and non-percentage configs
      await expect(loader.loadAllActiveConfigs(1000)).rejects.toThrow(
        "All active configs must have capital_allocation_pct set if any config uses it",
      );

      // Should also include the problematic timeframe
      await expect(loader.loadAllActiveConfigs(1000)).rejects.toThrow("4h");
    });

    it("should use database capital when percentages are not set", async () => {
      const mockConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 500, // Direct value from database
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: null, // No percentage
        },
        {
          id: "config-2",
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 300, // Direct value from database
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: null, // No percentage
        },
      ];

      // Mock the Supabase query
      mockSupabaseClient.order.mockResolvedValue({
        data: mockConfigs,
        error: null,
      });

      // Re-import the module to get fresh instance
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      // Load configs with account balance (should not affect capital)
      const configs = await loader.loadAllActiveConfigs(1000);

      // Verify capital uses database values
      expect(configs[0].initialCapitalUsdt).toBe(500);
      expect(configs[0].capitalAllocationPct).toBeUndefined();

      expect(configs[1].initialCapitalUsdt).toBe(300);
      expect(configs[1].capitalAllocationPct).toBeUndefined();

      // Logger should NOT be called for allocation details
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        "Calculated capital allocation from percentages",
        expect.anything(),
      );
    });

    it("should log calculated allocations when using percentages", async () => {
      const mockConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 55, // 55% (reduced to stay under 95% limit)
        },
        {
          id: "config-2",
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 35, // 35% (total = 90%, under 95% limit)
        },
      ];

      // Mock the Supabase query
      mockSupabaseClient.order.mockResolvedValue({
        data: mockConfigs,
        error: null,
      });

      // Re-import the module to get fresh instance with mocked logger
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      // Load configs with account balance
      const accountBalance = 2000;
      const configs = await loader.loadAllActiveConfigs(accountBalance);

      // Verify logger was called
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Calculated capital allocation from percentages",
        {
          accountBalance: 2000,
          allocations: [
            {
              timeframe: "1h",
              pct: 55,
              capital: "1100.00", // 55% of 2000
            },
            {
              timeframe: "4h",
              pct: 35,
              capital: "700.00", // 35% of 2000
            },
          ],
        },
      );

      // Verify actual capital values
      expect(configs[0].initialCapitalUsdt).toBe(1100);
      expect(configs[1].initialCapitalUsdt).toBe(700);
    });

    it("should handle edge case with 95% allocation to single config", async () => {
      const mockConfig = {
        id: "config-1",
        timeframe: "1h",
        drop_percentage: 0.03,
        rise_percentage: 0.03,
        max_purchases: 10,
        min_buy_usdt: 10,
        initial_capital_usdt: 500,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        ath_window: 20,
        is_active: true,
        updated_at: "2025-01-01T00:00:00Z",
        capital_allocation_pct: 95, // 95% allocation (maximum allowed)
      };

      // Mock the Supabase query
      mockSupabaseClient.order.mockResolvedValue({
        data: [mockConfig],
        error: null,
      });

      // Re-import the module
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      const accountBalance = 5000;
      const configs = await loader.loadAllActiveConfigs(accountBalance);

      // Verify 95% allocation works correctly (maximum allowed)
      expect(configs).toHaveLength(1);
      expect(configs[0].initialCapitalUsdt).toBe(4750); // 95% of 5000
      expect(configs[0].capitalAllocationPct).toBe(95);
    });

    it("should calculate capital correctly with decimal percentages", async () => {
      const mockConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 33.33, // 33.33%
        },
        {
          id: "config-2",
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 1000,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 61.67, // 61.67% (total = 95%, at safety limit)
        },
      ];

      // Mock the Supabase query
      mockSupabaseClient.order.mockResolvedValue({
        data: mockConfigs,
        error: null,
      });

      // Re-import the module
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      const accountBalance = 1500;
      const configs = await loader.loadAllActiveConfigs(accountBalance);

      // Verify decimal percentages work correctly
      expect(configs[0].initialCapitalUsdt).toBeCloseTo(499.95, 2); // 33.33% of 1500
      expect(configs[1].initialCapitalUsdt).toBeCloseTo(925.05, 2); // 61.67% of 1500
    });

    it("should allow 100% allocation with percentages but enforce 95% for fixed values", async () => {
      // Test 1: Percentage-based allocation allows 100%
      const percentageConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 500,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 60, // 60%
        },
        {
          id: "config-2",
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 400,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 40, // 40% (total = 100%, should be allowed)
        },
      ];

      // Mock the Supabase query for percentage configs
      mockSupabaseClient.order.mockResolvedValueOnce({
        data: percentageConfigs,
        error: null,
      });

      // Re-import the module
      jest.resetModules();
      let module = await import("../../src/config/strategy-config-loader.js");
      let StrategyConfigLoaderClass = module.StrategyConfigLoader;
      let loader = new StrategyConfigLoaderClass();

      // Should NOT throw - percentage-based allows 100%
      const configs = await loader.loadAllActiveConfigs(1000);
      expect(configs).toHaveLength(2);
      expect(configs[0].initialCapitalUsdt).toBeCloseTo(600); // 60% of 1000
      expect(configs[1].initialCapitalUsdt).toBeCloseTo(400); // 40% of 1000

      // Test 2: Fixed database values enforce 95% safety buffer
      const fixedConfigs = [
        {
          id: "config-3",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 500,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: null, // No percentage
        },
        {
          id: "config-4",
          timeframe: "4h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 500,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: null, // No percentage
        },
      ];

      // Mock the Supabase query for fixed configs
      mockSupabaseClient.order.mockResolvedValueOnce({
        data: fixedConfigs,
        error: null,
      });

      // Re-import the module again
      jest.resetModules();
      module = await import("../../src/config/strategy-config-loader.js");
      StrategyConfigLoaderClass = module.StrategyConfigLoader;
      loader = new StrategyConfigLoaderClass();

      // Should throw - total (1000) exceeds 95% of 1000 (950)
      await expect(loader.loadAllActiveConfigs(1000)).rejects.toThrow(
        "Total allocated capital ($1000.00) exceeds 95% of account balance ($950.00)",
      );
    });

    it("should not calculate from percentages when accountBalance is undefined", async () => {
      const mockConfigs = [
        {
          id: "config-1",
          timeframe: "1h",
          drop_percentage: 0.03,
          rise_percentage: 0.03,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 750, // Should use this value
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          ath_window: 20,
          is_active: true,
          updated_at: "2025-01-01T00:00:00Z",
          capital_allocation_pct: 50, // Has percentage but no account balance
        },
      ];

      // Mock the Supabase query
      mockSupabaseClient.order.mockResolvedValue({
        data: mockConfigs,
        error: null,
      });

      // Re-import the module
      jest.resetModules();
      const module = await import("../../src/config/strategy-config-loader.js");
      const StrategyConfigLoaderClass = module.StrategyConfigLoader;
      const loader = new StrategyConfigLoaderClass();

      // Load without account balance
      const configs = await loader.loadAllActiveConfigs(); // undefined balance

      // Should use database value, not calculate from percentage
      expect(configs[0].initialCapitalUsdt).toBe(750);
      expect(configs[0].capitalAllocationPct).toBe(50); // Still present but not used

      // Logger should NOT be called since we didn't calculate
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        "Calculated capital allocation from percentages",
        expect.anything(),
      );
    });
  });
});
