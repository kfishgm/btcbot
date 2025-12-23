/**
 * Geometric Modified Buy Engine
 *
 * Implements the geom_modified buy strategy from STRATEGY_V2_DUAL_MODE.md
 * and APPLIED_STRATEGY_geom_mod.md:
 *
 * Core Rules:
 * - NO grid
 * - Max 1 buy per candle
 * - Threshold dynamically anchored to p_last_buy
 * - ATH only used for first trigger
 * - Execution only on closed candles
 *
 * Logic:
 * - First buy: threshold = ATH * (1 - drop_pct)
 * - Subsequent buys: threshold = p_last_buy * (1 - drop_pct)
 * - If close <= threshold AND purchases_remaining > 0: buy
 *
 * INVARIANT: If purchases_remaining == 0, MUST return shouldBuy=false
 */

import { BuyAmountCalculator } from "./buy-amount-calculator.js";
import { logger } from "../utils/logger.js";
import type { StrategyConfig } from "../config/strategy-config-loader.js";
import type {
  IBuyEngine,
  BuyEngineInput,
  BuyEngineResult,
  BuyEngineCycleState,
  BuyEngineTradingConfig,
} from "./buy-engine-interface.js";

export class GeomModifiedBuyEngine implements IBuyEngine {
  constructor(
    private buyAmountCalculator: BuyAmountCalculator,
    private strategyConfig: StrategyConfig,
  ) {}

  /**
   * Check if conditions are met to trigger a buy order using dynamic threshold
   *
   * Per APPLIED_STRATEGY_geom_mod.md:
   * 1. First trigger from ATH: threshold = ATH * (1 - drop_pct)
   * 2. Subsequent triggers from p_last_buy: threshold = p_last_buy * (1 - drop_pct)
   * 3. Max 1 buy per candle (enforced by design - single check per candle)
   */
  public async checkBuyTrigger(
    input: BuyEngineInput,
  ): Promise<BuyEngineResult> {
    const { state, config, candle } = input;

    // Initialize validations object
    const validations = {
      strategyActive: false,
      priceThresholdMet: false,
      capitalAvailable: false,
      amountValid: false,
      maxBuysPerCandle: true, // Always true - enforced by design (1 check per candle)
    };

    // 1. Check if strategy is active (not PAUSED)
    validations.strategyActive = state.status !== "PAUSED";
    if (!validations.strategyActive) {
      return {
        shouldBuy: false,
        reason: "Strategy is PAUSED",
        validations,
      };
    }

    // 2. INVARIANT: Check purchases_remaining > 0
    // Even if threshold is met, purchases_remaining == 0 → NO BUY
    if (state.purchases_remaining <= 0) {
      return {
        shouldBuy: false,
        reason: "No purchases remaining",
        validations,
      };
    }

    // 3. Calculate threshold based on p_last_buy or ATH
    let threshold: number;
    let thresholdSource: string;

    // Debug log to trace p_last_buy value
    logger.debug("[GEOM_MOD] State check", {
      timeframe: this.strategyConfig.timeframe,
      p_last_buy: state.p_last_buy,
      p_last_buy_type: typeof state.p_last_buy,
      ath_reference_price: state.ath_reference_price,
      purchases_remaining: state.purchases_remaining,
    });

    if (state.p_last_buy === null || state.p_last_buy === undefined) {
      // First buy - use ATH reference price
      if (!state.ath_reference_price || state.ath_reference_price <= 0) {
        return {
          shouldBuy: false,
          reason: "No ATH reference price available for first buy threshold",
          validations,
        };
      }
      threshold = state.ath_reference_price * (1 - config.dropPercentage);
      thresholdSource = "ATH";
    } else {
      // Subsequent buy - use p_last_buy
      threshold = state.p_last_buy * (1 - config.dropPercentage);
      thresholdSource = "p_last_buy";

      // GUARD: Prevent buying if current price is above p_last_buy
      // This prevents consecutive buys at increasing prices
      if (candle.close >= state.p_last_buy) {
        return {
          shouldBuy: false,
          reason: `Price ${this.formatPrice(candle.close)} >= p_last_buy ${this.formatPrice(state.p_last_buy)} - waiting for drop`,
          validations,
          thresholdUsed: threshold,
        };
      }
    }

    // Log threshold calculation
    logger.debug("[GEOM_MOD] Threshold calculated", {
      timeframe: this.strategyConfig.timeframe,
      thresholdSource,
      threshold,
      p_last_buy: state.p_last_buy,
      ath_reference_price: state.ath_reference_price,
      dropPercentage: config.dropPercentage,
    });

    // 4. Check if price triggers buy
    validations.priceThresholdMet = candle.close <= threshold;

    if (!validations.priceThresholdMet) {
      return {
        shouldBuy: false,
        reason: `Price ${this.formatPrice(candle.close)} above threshold ${this.formatPrice(threshold)} (from ${thresholdSource})`,
        validations,
        thresholdUsed: threshold,
      };
    }

    // 5. Calculate buy amount
    const buyAmount = this.calculateBuyAmount(state, config);

    // 6. Check if capital is available
    validations.capitalAvailable = state.capital_available >= buyAmount;
    if (!validations.capitalAvailable) {
      return {
        shouldBuy: false,
        reason: `Insufficient capital: ${this.formatPrice(state.capital_available)} < ${this.formatPrice(buyAmount)} USDT`,
        validations,
        thresholdUsed: threshold,
      };
    }

    // 7. Check if amount is valid (meets minimums)
    validations.amountValid = this.buyAmountCalculator.isAmountValid(
      buyAmount,
      config.minBuyUSDT,
      config.exchangeMinNotional,
    );

    if (!validations.amountValid) {
      const skipReason = this.buyAmountCalculator.getSkipReason(
        buyAmount,
        config.minBuyUSDT,
        config.exchangeMinNotional,
      );
      return {
        shouldBuy: false,
        reason:
          skipReason || `Amount ${this.formatPrice(buyAmount)} below minimum`,
        validations,
        thresholdUsed: threshold,
      };
    }

    // All checks passed - trigger buy
    logger.info("[GEOM_MOD] Buy triggered", {
      timeframe: this.strategyConfig.timeframe,
      close: candle.close,
      threshold,
      thresholdSource,
      pLastBuy: state.p_last_buy,
      athRef: state.ath_reference_price,
      buyAmount,
    });

    return {
      shouldBuy: true,
      buyAmount,
      levelsTriggered: 1, // Always 1 for geom_modified
      thresholdUsed: threshold,
      // NOTE: pLastBuy is NOT set here - it's set by state updater on confirmed fill
      validations,
      // Grid fields are undefined for geom_modified (per spec)
      newBuyIndex: undefined,
      triggeredLevels: undefined,
      newGrid: undefined,
    };
  }

  /**
   * Calculate buy amount for geom_modified mode
   *
   * Same logic as arithmetic: base_amount = initial_capital / max_purchases
   * Last purchase uses all remaining capital
   */
  private calculateBuyAmount(
    state: BuyEngineCycleState,
    config: BuyEngineTradingConfig,
  ): number {
    // Last purchase - use all remaining capital
    if (state.purchases_remaining === 1) {
      return state.capital_available;
    }

    // If buy_amount is already calculated, use it
    if (state.buy_amount && state.buy_amount > 0) {
      return Math.min(state.buy_amount, state.capital_available);
    }

    // Calculate from initial capital / max purchases
    const initialCapital =
      state.initial_capital_usdt || state.capital_available;
    const baseAmount = Math.floor(initialCapital / config.maxPurchases);

    return Math.min(baseAmount, state.capital_available);
  }

  /**
   * Format price for display
   */
  private formatPrice(price: number): string {
    return price.toFixed(2);
  }
}
