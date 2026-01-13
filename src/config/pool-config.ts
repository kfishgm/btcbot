/**
 * Pool Configuration Loading and Validation
 *
 * Handles loading pool settings from environment and strategy configuration,
 * with comprehensive validation of percentages and constraints.
 */

import { PoolConfig } from "../types/pool.types";
import Decimal from "decimal.js";
import { logger } from "../utils/logger";

/**
 * YAML Pool Configuration structure
 */
interface YamlPoolConfig {
  enabled?: boolean;
  reinvestmentPercentage?: number;
  fundingWalletPercentage?: number;
  minFundingTransferAmount?: number;
}

/**
 * YAML Strategy Config with reinvestment
 */
interface YamlStrategyWithReinvestment {
  pool?: YamlPoolConfig;
}

/**
 * Config with reinvestment percentage for validation
 */
interface ConfigWithReinvestment {
  isActive: boolean;
  reinvestmentPct?: number;
  timeframe: string;
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG: PoolConfig = {
  enabled: false,
  reinvestmentPercentage: 70,
  fundingWalletPercentage: 30,
  minFundingTransferAmount: 10,
};

/**
 * Validates pool configuration
 *
 * Rules:
 * - enabled: boolean
 * - reinvestmentPercentage + fundingWalletPercentage = 100
 * - Both percentages must be 0-100
 * - minFundingTransferAmount must be > 0
 */
export function validatePoolConfig(config: Partial<PoolConfig>): PoolConfig {
  // Merge with defaults
  const merged: PoolConfig = {
    enabled: config.enabled ?? DEFAULT_POOL_CONFIG.enabled,
    reinvestmentPercentage:
      config.reinvestmentPercentage ??
      DEFAULT_POOL_CONFIG.reinvestmentPercentage,
    fundingWalletPercentage:
      config.fundingWalletPercentage ??
      DEFAULT_POOL_CONFIG.fundingWalletPercentage,
    minFundingTransferAmount:
      config.minFundingTransferAmount ??
      DEFAULT_POOL_CONFIG.minFundingTransferAmount,
  };

  const errors: string[] = [];

  // Validate percentages sum to 100
  const percentageSum = new Decimal(merged.reinvestmentPercentage)
    .add(merged.fundingWalletPercentage)
    .toNumber();

  if (Math.abs(percentageSum - 100) > 0.01) {
    errors.push(
      `Pool percentages must sum to 100. Got: reinvestmentPercentage=${merged.reinvestmentPercentage} + fundingWalletPercentage=${merged.fundingWalletPercentage} = ${percentageSum}`,
    );
  }

  // Validate individual percentages
  if (
    merged.reinvestmentPercentage < 0 ||
    merged.reinvestmentPercentage > 100
  ) {
    errors.push(
      `reinvestmentPercentage must be between 0 and 100, got ${merged.reinvestmentPercentage}`,
    );
  }

  if (
    merged.fundingWalletPercentage < 0 ||
    merged.fundingWalletPercentage > 100
  ) {
    errors.push(
      `fundingWalletPercentage must be between 0 and 100, got ${merged.fundingWalletPercentage}`,
    );
  }

  // Validate minimum transfer amount
  if (merged.minFundingTransferAmount <= 0) {
    errors.push(
      `minFundingTransferAmount must be > 0, got ${merged.minFundingTransferAmount}`,
    );
  }

  if (errors.length > 0) {
    const errorMessage = `Invalid pool configuration:\n${errors.join("\n")}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  return merged;
}

/**
 * Load pool configuration from YAML config object
 *
 * Example YAML:
 * ```yaml
 * pool:
 *   enabled: true
 *   reinvestmentPercentage: 70
 *   fundingWalletPercentage: 30
 *   minFundingTransferAmount: 10
 * ```
 */
export function loadPoolConfigFromYaml(
  yamlConfig: YamlStrategyWithReinvestment,
): PoolConfig {
  if (!yamlConfig || !yamlConfig.pool) {
    logger.info(
      "No pool configuration in strategy.yaml, using defaults (disabled)",
    );
    return DEFAULT_POOL_CONFIG;
  }

  const poolConfig: YamlPoolConfig = yamlConfig.pool;
  return validatePoolConfig({
    enabled: Boolean(poolConfig.enabled),
    reinvestmentPercentage: Number(
      poolConfig.reinvestmentPercentage ??
        DEFAULT_POOL_CONFIG.reinvestmentPercentage,
    ),
    fundingWalletPercentage: Number(
      poolConfig.fundingWalletPercentage ??
        DEFAULT_POOL_CONFIG.fundingWalletPercentage,
    ),
    minFundingTransferAmount: Number(
      poolConfig.minFundingTransferAmount ??
        DEFAULT_POOL_CONFIG.minFundingTransferAmount,
    ),
  });
}

/**
 * Validate reinvestment percentages across active configs
 *
 * If pool is enabled, all active configs must have reinvestmentPct
 * and their sum must equal 100
 */
export function validateReinvestmentPercentages(
  configs: ConfigWithReinvestment[],
  poolEnabled: boolean,
): void {
  if (!poolEnabled) {
    return; // Validation not needed if pool is disabled
  }

  const activeConfigs = configs.filter((c) => c.isActive);

  if (activeConfigs.length === 0) {
    return; // No active configs to validate
  }

  const errors: string[] = [];

  // Check all active configs have reinvestmentPct
  for (const config of activeConfigs) {
    if (
      config.reinvestmentPct === undefined ||
      config.reinvestmentPct === null
    ) {
      errors.push(
        `Config '${config.timeframe}' is active but reinvestmentPct is not set`,
      );
    } else if (config.reinvestmentPct < 0 || config.reinvestmentPct > 100) {
      errors.push(
        `Config '${config.timeframe}' has invalid reinvestmentPct: ${config.reinvestmentPct} (must be 0-100)`,
      );
    }
  }

  // Check sum equals 100
  const totalReinvestmentPct = activeConfigs.reduce(
    (sum, c) => sum + (c.reinvestmentPct ?? 0),
    0,
  );
  if (Math.abs(totalReinvestmentPct - 100) > 0.01) {
    errors.push(
      `Active configs reinvestmentPct must sum to 100, got ${totalReinvestmentPct}. ` +
        `Configs: ${activeConfigs.map((c) => `${c.timeframe}=${c.reinvestmentPct}`).join(", ")}`,
    );
  }

  if (errors.length > 0) {
    const errorMessage = `Invalid reinvestment percentages:\n${errors.join("\n")}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Get the default pool configuration
 */
export function getDefaultPoolConfig(): PoolConfig {
  return { ...DEFAULT_POOL_CONFIG };
}

/**
 * Check if pool is enabled in configuration
 */
export function isPoolEnabled(poolConfig?: PoolConfig): boolean {
  return poolConfig?.enabled ?? DEFAULT_POOL_CONFIG.enabled;
}
