/**
 * Buy Engine Interface
 *
 * Defines the contract for buy engines (arithmetic and geom_modified).
 * Per STRATEGY_V2_DUAL_MODE.md specification.
 */

import type { BuyMode } from "../config/strategy-config-loader.js";

/**
 * Cycle state required by buy engines
 */
export interface BuyEngineCycleState {
  status: "READY" | "HOLDING" | "PAUSED";
  ath_reference_price: number | null;
  sell_reference_price: number | null;
  purchases_remaining: number;
  capital_available: number;
  buy_amount: number | null;
  buy_anchor_price?: number | null;
  btc_accumulated: number;
  btc_dust?: number;
  initial_capital_usdt?: number;

  // Arithmetic-only fields
  buy_grid: number[] | null;
  buy_index: number;

  // GeomModified-only field
  p_last_buy?: number | null;
}

/**
 * Trading configuration for buy decisions
 */
export interface BuyEngineTradingConfig {
  dropPercentage: number;
  risePercentage: number;
  minBuyUSDT: number;
  exchangeMinNotional: number;
  maxPurchases: number;
}

/**
 * Candle data for buy decisions
 */
export interface BuyEngineCandle {
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  timestamp: number;
}

/**
 * Balance information
 */
export interface BuyEngineBalanceInfo {
  usdtSpot: number;
  btcSpot: number;
}

/**
 * Validation results for buy decision
 */
export interface BuyEngineValidations {
  strategyActive: boolean;
  priceThresholdMet: boolean;
  capitalAvailable: boolean;
  amountValid: boolean;
  // Arithmetic-only
  gridValid?: boolean;
  // GeomModified-only
  maxBuysPerCandle?: boolean;
}

/**
 * Result of buy engine check
 *
 * Field usage by mode:
 * - Arithmetic: uses levelsTriggered, newBuyIndex, triggeredLevels, newGrid
 * - GeomModified: uses pLastBuy, thresholdUsed; grid fields MUST be undefined
 */
export interface BuyEngineResult {
  shouldBuy: boolean;
  buyAmount?: number;
  reason?: string;
  validations?: BuyEngineValidations;

  // Arithmetic-only fields (MUST be undefined for geom_modified)
  levelsTriggered?: number; // For geom_modified, always 1 when buying
  newBuyIndex?: number; // undefined for geom_modified
  triggeredLevels?: number[]; // undefined for geom_modified
  newGrid?: number[]; // undefined for geom_modified

  // GeomModified-only fields
  pLastBuy?: number; // New p_last_buy value (set by state updater on confirmed fill)
  thresholdUsed?: number; // Debug: threshold that was used for decision
}

/**
 * Input for buy engine check
 */
export interface BuyEngineInput {
  state: BuyEngineCycleState;
  config: BuyEngineTradingConfig;
  candle: BuyEngineCandle;
  balances: BuyEngineBalanceInfo;
}

/**
 * Buy Engine interface - implemented by arithmetic and geom_modified engines
 */
export interface IBuyEngine {
  /**
   * Check if conditions are met to trigger a buy order
   * @param input Buy engine input with state, config, candle, and balances
   * @returns Buy engine result with decision and details
   */
  checkBuyTrigger(input: BuyEngineInput): Promise<BuyEngineResult>;
}

/**
 * Type guard to check if buy mode is valid
 */
export function isValidBuyMode(
  mode: string | null | undefined,
): mode is BuyMode {
  return mode === "arithmetic" || mode === "geom_modified";
}
