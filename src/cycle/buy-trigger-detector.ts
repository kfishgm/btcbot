/**
 * Buy Trigger Detector - Dispatcher for Buy Engines
 *
 * Routes buy trigger checks to the appropriate engine based on buy_mode:
 * - "arithmetic": Grid-based strategy (default)
 * - "geom_modified": Dynamic threshold strategy
 *
 * Per STRATEGY_V2_DUAL_MODE.md specification.
 */

import { BuyAmountCalculator } from "./buy-amount-calculator.js";
import { logger } from "../utils/logger.js";
import type { TradingRules } from "../exchange/trading-rules.js";
import type {
  StrategyConfig,
  BuyMode,
} from "../config/strategy-config-loader.js";
import { ArithmeticBuyEngine } from "./buy-engine-arithmetic.js";
import { GeomModifiedBuyEngine } from "./buy-engine-geom-modified.js";
import type {
  BuyEngineResult,
  BuyEngineCycleState,
  BuyEngineTradingConfig,
  BuyEngineCandle,
  BuyEngineBalanceInfo,
} from "./buy-engine-interface.js";

// Re-export types for backward compatibility
export type CycleState = BuyEngineCycleState;
export type TradingConfig = BuyEngineTradingConfig;
export type Candle = BuyEngineCandle;
export type BalanceInfo = BuyEngineBalanceInfo;
export type BuyTriggerResult = BuyEngineResult;

export class BuyTriggerDetector {
  private arithmeticEngine: ArithmeticBuyEngine;
  private geomModifiedEngine: GeomModifiedBuyEngine;
  private buyMode: BuyMode;

  constructor(
    buyAmountCalculator: BuyAmountCalculator,
    strategyConfig: StrategyConfig,
    tradingRules?: TradingRules,
  ) {
    // Determine buy mode - default to arithmetic if not set
    this.buyMode = strategyConfig.buyMode || "arithmetic";

    // Initialize both engines
    this.arithmeticEngine = new ArithmeticBuyEngine(
      buyAmountCalculator,
      strategyConfig,
      tradingRules,
    );

    this.geomModifiedEngine = new GeomModifiedBuyEngine(
      buyAmountCalculator,
      strategyConfig,
    );

    logger.info("BuyTriggerDetector initialized", {
      timeframe: strategyConfig.timeframe,
      buyMode: this.buyMode,
    });
  }

  /**
   * Check if conditions are met to trigger a buy order
   * Dispatches to appropriate engine based on buy_mode
   */
  public async checkBuyTrigger(
    state: CycleState,
    config: TradingConfig,
    candle: Candle,
    balances: BalanceInfo,
  ): Promise<BuyTriggerResult> {
    const input = { state, config, candle, balances };

    switch (this.buyMode) {
      case "geom_modified":
        return this.geomModifiedEngine.checkBuyTrigger(input);

      case "arithmetic":
      default:
        return this.arithmeticEngine.checkBuyTrigger(input);
    }
  }

  /**
   * Build grid from anchor price after first buy
   * Only used by arithmetic mode
   */
  public async buildGridFromAnchor(
    anchorPrice: number,
    config: TradingConfig,
  ): Promise<number[]> {
    return this.arithmeticEngine.buildGridFromAnchor(anchorPrice, config);
  }

  /**
   * Calculate buy amount for a specific state
   * Delegates to arithmetic engine (same logic for both modes)
   */
  public calculateBuyAmount(state: CycleState): number {
    return this.arithmeticEngine.calculateBuyAmount(state);
  }

  /**
   * Get the current buy mode
   */
  public getBuyMode(): BuyMode {
    return this.buyMode;
  }
}
