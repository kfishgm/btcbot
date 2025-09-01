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

type MockSupabaseClient = {
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
} & Record<string, jest.Mock>;

describe("StrategyConfigLoader", () => {
  let StrategyConfigLoaderClass: new () => StrategyConfigLoaderInterface;
  let mockSupabaseClient: MockSupabaseClient;
  let loader: StrategyConfigLoaderInterface | undefined;

  beforeEach(async () => {
    // Reset modules
    jest.resetModules();

    // Create mock for Supabase client with proper typing
    const mockSingle = jest.fn();
    const mockInsert = jest.fn();
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: mockSingle,
      insert: mockInsert,
      update: jest.fn().mockReturnThis(),
    } as MockSupabaseClient;

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

    // Import the module to test (this will fail initially in TDD Red phase)
    try {
      const module = await import("../../src/config/strategy-config-loader.js");
      StrategyConfigLoaderClass = module.StrategyConfigLoader;
      loader = new StrategyConfigLoaderClass();
    } catch {
      // Module doesn't exist yet - that's expected in TDD Red phase
      loader = undefined;
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("loadConfig()", () => {
    it("should load active configuration from database", async () => {
      // Skip test if module doesn't exist yet (TDD Red phase)
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      mockSupabaseClient.insert.mockResolvedValue({
        data: [defaultConfig],
        error: null,
      });

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
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

    it("should log configuration loaded successfully", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await loader.loadConfig();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Strategy configuration loaded"),
      );

      logSpy.mockRestore();
    });

    it("should handle database connection errors", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      mockSupabaseClient.single.mockResolvedValue({
        data: null,
        error: { code: "CONNECTION_ERROR", message: "Database unavailable" },
      });

      await expect(loader.loadConfig()).rejects.toThrow(/Database unavailable/);
    });

    it("should handle multiple active configurations as error", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      // Mock multiple active configs (which should not happen)
      mockSupabaseClient.eq.mockResolvedValue({
        data: [
          { id: "config1", is_active: true },
          { id: "config2", is_active: true },
        ],
        error: null,
      });

      await expect(loader.loadConfig()).rejects.toThrow(
        /Multiple active configurations found/,
      );
    });
  });

  describe("validateConfig()", () => {
    it("should validate dropPercentage is between 0.02 and 0.08", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

    it("should validate initialCapitalUsdt is greater than 0", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      const zero = { ...validConfig, initialCapitalUsdt: 0 };
      expect(() => loader.validateConfig(zero)).toThrow(
        /initial_capital_usdt must be greater than 0/,
      );

      const negative = { ...validConfig, initialCapitalUsdt: -100 };
      expect(() => loader.validateConfig(negative)).toThrow(
        /initial_capital_usdt must be greater than 0/,
      );
    });

    it("should validate slippage percentages are between 0 and 1", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      const negativeBuy = { ...validConfig, slippageBuyPct: -0.001 };
      expect(() => loader.validateConfig(negativeBuy)).toThrow(
        /slippage_buy_pct must be between 0 and 1/,
      );

      const tooHighSell = { ...validConfig, slippageSellPct: 1.001 };
      expect(() => loader.validateConfig(tooHighSell)).toThrow(
        /slippage_sell_pct must be between 0 and 1/,
      );
    });

    it("should validate timeframe is not empty", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      const emptyTimeframe = { ...validConfig, timeframe: "" };
      expect(() => loader.validateConfig(emptyTimeframe)).toThrow(
        /timeframe cannot be empty/,
      );
    });

    it("should validate all required fields are present", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

    it("should reject configuration with unknown fields", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      const configWithExtra = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        unknownField: "should not be here",
      };

      expect(() => loader.validateConfig(configWithExtra)).toThrow(
        /Unknown configuration field: unknownField/,
      );
    });

    it("should reject non-integer values for maxPurchases", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      const configWithDecimal = {
        timeframe: "4h",
        dropPercentage: 0.05,
        risePercentage: 0.05,
        maxPurchases: 10.5, // Should be integer
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
      };

      expect(() => loader.validateConfig(configWithDecimal)).toThrow(
        /max_purchases must be an integer/,
      );
    });

    it("should reject null or undefined configuration", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      expect(() => loader.validateConfig(null)).toThrow(
        /Configuration cannot be null or undefined/,
      );

      expect(() => loader.validateConfig(undefined)).toThrow(
        /Configuration cannot be null or undefined/,
      );
    });

    it("should reject non-numeric values for numeric fields", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      const configWithString = {
        timeframe: "4h",
        dropPercentage: "0.05", // Should be number
        risePercentage: 0.05,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 300,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
      };

      expect(() => loader.validateConfig(configWithString)).toThrow(
        /dropPercentage must be a number/,
      );
    });

    it("should prevent configuration of constants (ATH_WINDOW, DriftHaltThresholdPct, ORDER_TYPE)", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      const configWithDrift = {
        ...configWithConstants,
        DriftHaltThresholdPct: 0.01,
      };
      const recordDrift = configWithDrift as Record<string, unknown>;
      delete recordDrift.ATH_WINDOW;

      expect(() => loader.validateConfig(configWithDrift)).toThrow(
        /DriftHaltThresholdPct is a constant and cannot be configured/,
      );

      const configWithOrderType = {
        ...configWithConstants,
        ORDER_TYPE: "MARKET",
      };
      const recordOrder = configWithOrderType as Record<string, unknown>;
      delete recordOrder.ATH_WINDOW;

      expect(() => loader.validateConfig(configWithOrderType)).toThrow(
        /ORDER_TYPE is a constant and cannot be configured/,
      );
    });
  });

  describe("Default Configuration", () => {
    it("should use correct default values from STRATEGY.md", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      // Mock no active config found
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      });

      // Spy on insert to check default values
      const insertSpy = jest.fn().mockResolvedValue({
        data: [
          {
            id: "generated-id",
            timeframe: "4h",
            drop_percentage: 0.05,
            rise_percentage: 0.05,
            max_purchases: 10,
            min_buy_usdt: 10,
            initial_capital_usdt: 300,
            slippage_buy_pct: 0.003,
            slippage_sell_pct: 0.003,
            is_active: false,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      });
      mockSupabaseClient.insert = insertSpy;

      mockSupabaseClient.single.mockResolvedValueOnce({
        data: {
          id: "generated-id",
          timeframe: "4h",
          drop_percentage: 0.05,
          rise_percentage: 0.05,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 300,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          is_active: false,
          updated_at: "2025-01-01T00:00:00Z",
        },
        error: null,
      });

      await loader.loadConfig();

      expect(insertSpy).toHaveBeenCalledWith({
        timeframe: "4h",
        drop_percentage: 0.05,
        rise_percentage: 0.05,
        max_purchases: 10,
        min_buy_usdt: 10,
        initial_capital_usdt: 300,
        slippage_buy_pct: 0.003,
        slippage_sell_pct: 0.003,
        is_active: false, // Must be inactive by default
      });
    });

    it("should log when creating default configuration", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

      // Mock no active config found
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      });

      mockSupabaseClient.insert.mockResolvedValue({
        data: [
          {
            id: "generated-id",
            timeframe: "4h",
            drop_percentage: 0.05,
            rise_percentage: 0.05,
            max_purchases: 10,
            min_buy_usdt: 10,
            initial_capital_usdt: 300,
            slippage_buy_pct: 0.003,
            slippage_sell_pct: 0.003,
            is_active: false,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      mockSupabaseClient.single.mockResolvedValueOnce({
        data: {
          id: "generated-id",
          timeframe: "4h",
          drop_percentage: 0.05,
          rise_percentage: 0.05,
          max_purchases: 10,
          min_buy_usdt: 10,
          initial_capital_usdt: 300,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
          is_active: false,
          updated_at: "2025-01-01T00:00:00Z",
        },
        error: null,
      });

      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      await loader.loadConfig();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("No configuration found, creating default"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Default configuration created"),
      );

      logSpy.mockRestore();
    });
  });

  describe("Singleton Pattern", () => {
    it("should only load configuration once (singleton)", async () => {
      if (!loader) {
        expect(loader).toBeDefined();
        return;
      }

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

      const config1 = await loader.loadConfig();
      const config2 = await loader.loadConfig();

      // Should only query database once
      expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1);
      expect(config1).toBe(config2); // Same reference
    });
  });
});
