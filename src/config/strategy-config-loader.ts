import { DatabaseConnectionManager } from "../database/connection-manager.js";

// Strategy configuration interface matching database schema
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

// Database record interface (snake_case from database)
interface DatabaseStrategyConfig {
  id: string;
  timeframe: string;
  drop_percentage: number;
  rise_percentage: number;
  max_purchases: number;
  min_buy_usdt: number;
  initial_capital_usdt: number;
  slippage_buy_pct: number;
  slippage_sell_pct: number;
  is_active: boolean;
  updated_at: string;
}

// Configuration error class
export class StrategyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyConfigError";
  }
}

// Strategy configuration loader class
export class StrategyConfigLoader {
  private dbManager: DatabaseConnectionManager;
  private cachedConfig: StrategyConfig | null = null;

  constructor() {
    this.dbManager = new DatabaseConnectionManager();
  }

  /**
   * Load strategy configuration from database
   * Creates default if none exists
   * Validates configuration before returning
   */
  async loadConfig(): Promise<StrategyConfig> {
    // Return cached config if available (singleton pattern)
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const client = await this.dbManager.getClient();

    try {
      // Try to load active configuration
      const { data, error } = await client
        .from("strategy_config")
        .select("*")
        .eq("is_active", true)
        .single();

      if (error && error.code === "PGRST116") {
        // No configuration found, create default
        console.log("No configuration found, creating default configuration");
        const defaultConfig = await this.createDefaultConfig(client);
        this.cachedConfig = defaultConfig;
        return defaultConfig;
      }

      if (error) {
        throw new StrategyConfigError(`Database error: ${error.message}`);
      }

      // Check for multiple active configs (should not happen)
      if (Array.isArray(data)) {
        throw new StrategyConfigError(
          "Multiple active configurations found. Please ensure only one configuration is active.",
        );
      }

      // Convert from database format to application format
      const config = this.convertFromDatabase(data as DatabaseStrategyConfig);

      // Validate configuration
      this.validateConfig(config);

      console.log("Strategy configuration loaded successfully");
      this.cachedConfig = config;
      return config;
    } catch (error) {
      if (error instanceof StrategyConfigError) {
        throw error;
      }
      throw new StrategyConfigError(
        `Failed to load configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Validate configuration against STRATEGY.md requirements
   */
  validateConfig(config: unknown): void {
    // Check null/undefined
    if (config === null || config === undefined) {
      throw new StrategyConfigError(
        "Configuration cannot be null or undefined",
      );
    }

    // Type check
    if (typeof config !== "object") {
      throw new StrategyConfigError("Configuration must be an object");
    }

    const cfg = config as Record<string, unknown>;

    // Required fields
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
      if (!(field in cfg)) {
        throw new StrategyConfigError(`${field} is required`);
      }
    }

    // Check for constants that should not be configurable
    const forbiddenConstants = [
      "ATH_WINDOW",
      "DriftHaltThresholdPct",
      "ORDER_TYPE",
    ];
    for (const constant of forbiddenConstants) {
      if (constant in cfg) {
        throw new StrategyConfigError(
          `${constant} is a constant and cannot be configured`,
        );
      }
    }

    // Check for unknown fields
    const allowedFields = [...requiredFields, "id", "isActive", "updatedAt"];
    for (const field in cfg) {
      if (!allowedFields.includes(field)) {
        throw new StrategyConfigError(`Unknown configuration field: ${field}`);
      }
    }

    // Validate timeframe
    if (typeof cfg.timeframe !== "string") {
      throw new StrategyConfigError("timeframe must be a string");
    }
    if (cfg.timeframe === "") {
      throw new StrategyConfigError("timeframe cannot be empty");
    }

    // Validate numeric fields
    const numericFields = [
      "dropPercentage",
      "risePercentage",
      "maxPurchases",
      "minBuyUsdt",
      "initialCapitalUsdt",
      "slippageBuyPct",
      "slippageSellPct",
    ];

    for (const field of numericFields) {
      if (typeof cfg[field] !== "number") {
        throw new StrategyConfigError(`${field} must be a number`);
      }
    }

    // Validate dropPercentage (0.02 to 0.08)
    const dropPct = cfg.dropPercentage as number;
    if (dropPct < 0.02 || dropPct > 0.08) {
      throw new StrategyConfigError(
        "drop_percentage must be between 0.02 and 0.08",
      );
    }

    // Validate risePercentage (0.02 to 0.08)
    const risePct = cfg.risePercentage as number;
    if (risePct < 0.02 || risePct > 0.08) {
      throw new StrategyConfigError(
        "rise_percentage must be between 0.02 and 0.08",
      );
    }

    // Validate maxPurchases (1 to 30, integer)
    const maxPurchases = cfg.maxPurchases as number;
    if (maxPurchases < 1 || maxPurchases > 30) {
      throw new StrategyConfigError("max_purchases must be between 1 and 30");
    }
    if (!Number.isInteger(maxPurchases)) {
      throw new StrategyConfigError("max_purchases must be an integer");
    }

    // Validate minBuyUsdt (>= 10)
    const minBuyUsdt = cfg.minBuyUsdt as number;
    if (minBuyUsdt < 10) {
      throw new StrategyConfigError("min_buy_usdt must be at least 10");
    }

    // Validate initialCapitalUsdt (> 0)
    const initialCapital = cfg.initialCapitalUsdt as number;
    if (initialCapital <= 0) {
      throw new StrategyConfigError(
        "initial_capital_usdt must be greater than 0",
      );
    }

    // Validate slippage percentages (0 to 1)
    const slippageBuy = cfg.slippageBuyPct as number;
    if (slippageBuy < 0 || slippageBuy > 1) {
      throw new StrategyConfigError("slippage_buy_pct must be between 0 and 1");
    }

    const slippageSell = cfg.slippageSellPct as number;
    if (slippageSell < 0 || slippageSell > 1) {
      throw new StrategyConfigError(
        "slippage_sell_pct must be between 0 and 1",
      );
    }
  }

  /**
   * Create default configuration per STRATEGY.md
   */
  private async createDefaultConfig(client: unknown): Promise<StrategyConfig> {
    const defaultConfig: Omit<DatabaseStrategyConfig, "id" | "updated_at"> = {
      timeframe: "4h",
      drop_percentage: 0.05,
      rise_percentage: 0.05,
      max_purchases: 10,
      min_buy_usdt: 10,
      initial_capital_usdt: 300,
      slippage_buy_pct: 0.003,
      slippage_sell_pct: 0.003,
      is_active: false, // MUST be inactive by default
    };

    const supabaseClient = client as {
      from: (table: string) => {
        insert: (data: unknown) => Promise<{ data: unknown; error: unknown }>;
        select: (columns: string) => {
          eq: (
            column: string,
            value: unknown,
          ) => {
            single: () => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };

    // Insert default configuration
    const { data: insertedData, error: insertError } = await supabaseClient
      .from("strategy_config")
      .insert(defaultConfig);

    if (insertError) {
      throw new StrategyConfigError(
        `Failed to create default configuration: ${(insertError as { message?: string }).message || "Unknown error"}`,
      );
    }

    // Fetch the inserted configuration
    const { data: createdConfig, error: fetchError } = await supabaseClient
      .from("strategy_config")
      .select("*")
      .eq("is_active", false)
      .single();

    if (fetchError) {
      throw new StrategyConfigError(
        `Failed to fetch created configuration: ${(fetchError as { message?: string }).message || "Unknown error"}`,
      );
    }

    console.log("Default configuration created with is_active=false");
    return this.convertFromDatabase(createdConfig as DatabaseStrategyConfig);
  }

  /**
   * Convert database format (snake_case) to application format (camelCase)
   */
  private convertFromDatabase(
    dbConfig: DatabaseStrategyConfig,
  ): StrategyConfig {
    return {
      id: dbConfig.id,
      timeframe: dbConfig.timeframe,
      dropPercentage: dbConfig.drop_percentage,
      risePercentage: dbConfig.rise_percentage,
      maxPurchases: dbConfig.max_purchases,
      minBuyUsdt: dbConfig.min_buy_usdt,
      initialCapitalUsdt: dbConfig.initial_capital_usdt,
      slippageBuyPct: dbConfig.slippage_buy_pct,
      slippageSellPct: dbConfig.slippage_sell_pct,
      isActive: dbConfig.is_active,
      updatedAt: dbConfig.updated_at,
    };
  }
}
