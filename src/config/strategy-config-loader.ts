import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./index.js";
import { logger } from "../utils/logger.js";

// Buy mode type - determines which buy engine to use
export type BuyMode = "arithmetic" | "geom_modified";

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
  athWindow: number;
  isActive: boolean;
  updatedAt: string;
  capitalAllocationPct?: number; // Optional percentage 0-100
  buyMode: BuyMode; // Buy mode: arithmetic (default) or geom_modified
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
  ath_window: number;
  is_active: boolean;
  updated_at: string;
  capital_allocation_pct: number | null;
  buy_mode: string | null;
}

// Configuration error class
export class StrategyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyConfigError";
  }
}

// Multi-config validation constraints
const MAX_ACTIVE_CONFIGS = 10;
const CAPITAL_SAFETY_BUFFER = 0.05; // 5% safety buffer for account balance

// Strategy configuration loader class
export class StrategyConfigLoader {
  private client: SupabaseClient;

  constructor() {
    const config = getConfig();
    this.client = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
    );
  }

  /**
   * Load all active strategy configurations from database
   * Validates multi-config constraints (max count, unique timeframes, capital allocation)
   * @param accountBalance - Optional account balance for capital validation
   */
  async loadAllActiveConfigs(
    accountBalance?: number,
  ): Promise<StrategyConfig[]> {
    try {
      // Load all active configurations
      const { data: configs, error } = await this.client
        .from("strategy_config")
        .select("*")
        .eq("is_active", true)
        .order("timeframe", { ascending: true });

      if (error) {
        throw new StrategyConfigError(`Database error: ${error.message}`);
      }

      // No active configs - create default
      if (!configs || configs.length === 0) {
        const defaultConfig = await this.createDefaultConfig();
        return [defaultConfig];
      }

      // Convert from database format
      const convertedConfigs = configs.map((c) =>
        this.convertFromDatabase(c as DatabaseStrategyConfig),
      );

      // If percentages are set, calculate initial capital from account balance
      const hasPercentages = convertedConfigs.some(
        (c) => c.capitalAllocationPct !== undefined,
      );
      if (hasPercentages && accountBalance !== undefined) {
        // Validate all configs have percentages
        const missingPct = convertedConfigs.filter(
          (c) => c.capitalAllocationPct === undefined,
        );
        if (missingPct.length > 0) {
          throw new StrategyConfigError(
            `All active configs must have capital_allocation_pct set if any config uses it. ` +
              `Missing for timeframes: ${missingPct.map((c) => c.timeframe).join(", ")}`,
          );
        }

        // Calculate capital from percentages
        for (const config of convertedConfigs) {
          if (config.capitalAllocationPct !== undefined) {
            config.initialCapitalUsdt =
              accountBalance * (config.capitalAllocationPct / 100);
          }
        }

        logger.info("Calculated capital allocation from percentages", {
          accountBalance,
          allocations: convertedConfigs.map((c) => ({
            timeframe: c.timeframe,
            pct: c.capitalAllocationPct,
            capital: c.initialCapitalUsdt.toFixed(2),
          })),
        });
      }

      // Validate each configuration
      for (const config of convertedConfigs) {
        this.validateConfig(config);
      }

      // Validate multi-config constraints
      this.validateMultiConfigConstraints(convertedConfigs, accountBalance);

      return convertedConfigs;
    } catch (error) {
      if (error instanceof StrategyConfigError) {
        throw error;
      }
      throw new StrategyConfigError(
        `Failed to load configurations: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Load strategy configuration from database (backwards compatible - loads first active config)
   * Creates default if none exists
   * Validates configuration before returning
   * @deprecated Use loadAllActiveConfigs() for multi-config support
   */
  async loadConfig(): Promise<StrategyConfig> {
    const configs = await this.loadAllActiveConfigs();
    if (configs.length > 1) {
      logger.warn(
        `Multiple active configs found (${configs.length}). Using first one for backwards compatibility.`,
      );
    }
    return configs[0];
  }

  /**
   * Validate multi-config constraints
   * - Max 10 active configs
   * - Unique timeframes across configs
   * - Total allocated capital doesn't exceed account balance
   */
  private validateMultiConfigConstraints(
    configs: StrategyConfig[],
    accountBalance?: number,
  ): void {
    // Check max config count
    if (configs.length > MAX_ACTIVE_CONFIGS) {
      throw new StrategyConfigError(
        `Maximum ${MAX_ACTIVE_CONFIGS} active configs allowed. Found ${configs.length}`,
      );
    }

    // Check unique timeframes
    const timeframes = configs.map((c) => c.timeframe);
    const uniqueTimeframes = new Set(timeframes);
    if (uniqueTimeframes.size !== timeframes.length) {
      const duplicates = timeframes.filter(
        (tf, index) => timeframes.indexOf(tf) !== index,
      );
      throw new StrategyConfigError(
        `Duplicate timeframes found: ${duplicates.join(", ")}. Each active config must have a unique timeframe.`,
      );
    }

    // Check total capital allocation if account balance provided
    if (accountBalance !== undefined) {
      const totalAllocated = configs.reduce(
        (sum, c) => sum + c.initialCapitalUsdt,
        0,
      );

      // When using percentage-based allocation, allow up to 100% (percentages are explicitly controlled)
      // When using fixed database values, enforce 95% safety buffer
      const usingPercentages = configs.some(
        (c) => c.capitalAllocationPct !== undefined,
      );
      const maxAllowed = usingPercentages
        ? accountBalance
        : accountBalance * (1 - CAPITAL_SAFETY_BUFFER);

      if (totalAllocated > maxAllowed) {
        const bufferPct = usingPercentages
          ? 100
          : (1 - CAPITAL_SAFETY_BUFFER) * 100;
        throw new StrategyConfigError(
          `Total allocated capital ($${totalAllocated.toFixed(2)}) exceeds ${bufferPct}% of account balance ($${maxAllowed.toFixed(2)}). ` +
            `Account balance: $${accountBalance.toFixed(2)}`,
        );
      }
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
      "athWindow",
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
    const allowedFields = [
      ...requiredFields,
      "id",
      "isActive",
      "updatedAt",
      "capitalAllocationPct",
      "buyMode",
    ];
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

    // Validate dropPercentage (0.0015 to 0.08) - lowered minimum for testing
    const dropPct = cfg.dropPercentage as number;
    if (dropPct < 0.0015 || dropPct > 0.08) {
      throw new StrategyConfigError(
        "drop_percentage must be between 0.0015 and 0.08",
      );
    }

    // Validate risePercentage (0.0015 to 0.08) - lowered minimum for testing
    const risePct = cfg.risePercentage as number;
    if (risePct < 0.0015 || risePct > 0.08) {
      throw new StrategyConfigError(
        "rise_percentage must be between 0.0015 and 0.08",
      );
    }

    // Validate maxPurchases (must be between 1 and 30, integer)
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

    // Validate athWindow (10 to 500)
    const athWindow = cfg.athWindow as number;
    if (athWindow < 10 || athWindow > 500) {
      throw new StrategyConfigError("ath_window must be between 10 and 500");
    }
  }

  /**
   * Create default configuration per STRATEGY.md
   */
  private async createDefaultConfig(): Promise<StrategyConfig> {
    const defaultConfig: Omit<DatabaseStrategyConfig, "id" | "updated_at"> = {
      timeframe: "4h",
      drop_percentage: 0.03,
      rise_percentage: 0.03,
      max_purchases: 10,
      min_buy_usdt: 10,
      initial_capital_usdt: parseFloat(
        process.env.INITIAL_CAPITAL_USDT || "300",
      ),
      slippage_buy_pct: 0.003,
      slippage_sell_pct: 0.003,
      ath_window: 20, // Default value (configurable 10-500)
      is_active: true, // Auto-activate for convenience
      capital_allocation_pct: null, // Default to null (use initial_capital_usdt instead)
      buy_mode: "arithmetic", // Default to arithmetic grid strategy
    };

    // Insert default configuration
    const { error: insertError } = await this.client
      .from("strategy_config")
      .insert(defaultConfig);

    if (insertError) {
      throw new StrategyConfigError(
        `Failed to create default configuration: ${(insertError as { message?: string }).message || "Unknown error"}`,
      );
    }

    // Fetch the inserted configuration
    const { data: createdConfigs, error: fetchError } = await this.client
      .from("strategy_config")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (fetchError) {
      throw new StrategyConfigError(
        `Failed to fetch created configuration: ${(fetchError as { message?: string }).message || "Unknown error"}`,
      );
    }

    const createdConfig = createdConfigs?.[0] || null;

    if (!createdConfig) {
      throw new StrategyConfigError("Failed to fetch created configuration");
    }

    // Default configuration created with is_active=false
    return this.convertFromDatabase(createdConfig as DatabaseStrategyConfig);
  }

  /**
   * Convert database format (snake_case) to application format (camelCase)
   */
  private convertFromDatabase(
    dbConfig: DatabaseStrategyConfig,
  ): StrategyConfig {
    // Default to "arithmetic" if buy_mode is null/undefined (backward compatibility)
    const buyMode: BuyMode =
      dbConfig.buy_mode === "geom_modified" ? "geom_modified" : "arithmetic";

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
      athWindow: dbConfig.ath_window,
      isActive: dbConfig.is_active,
      updatedAt: dbConfig.updated_at,
      capitalAllocationPct: dbConfig.capital_allocation_pct ?? undefined,
      buyMode,
    };
  }
}
