/**
 * Drift Detection Calculator
 *
 * Implements SAF-001: Detect when balances drift from expected state
 *
 * Formulas from STRATEGY.md Section 7:
 * - drift_usdt = max(0, (capital_available - USDT_SPOT) / max(capital_available, 1))
 *   Only triggers when insufficient funds (allows excess)
 * - drift_btc = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)
 *   Must match exactly
 *
 * Pauses strategy if drift >= 0.5% (configurable threshold)
 * Handles edge cases with zero balances using max(value, epsilon) approach
 */

export type DriftStatus = "ok" | "exceeded";

export interface DriftResult {
  asset: "USDT" | "BTC";
  driftPercentage: number;
  status: DriftStatus;
  threshold: number;
}

export interface USDTDriftParams {
  spotBalance: number;
  capitalAvailable: number;
}

export interface BTCDriftParams {
  spotBalance: number;
  btcAccumulated: number;
}

export interface CombinedDriftParams {
  usdtSpotBalance: number;
  capitalAvailable: number;
  btcSpotBalance: number;
  btcAccumulated: number;
}

export interface CombinedDriftResult {
  usdt: DriftResult;
  btc: DriftResult;
  overallStatus: DriftStatus;
}

export class DriftDetector {
  private readonly threshold: number;
  private static readonly USDT_EPSILON = 1;
  private static readonly BTC_EPSILON = 0.00000001;
  private static readonly DEFAULT_THRESHOLD = 0.005; // 0.5% as per STRATEGY.md

  constructor(threshold?: number) {
    this.threshold = threshold ?? DriftDetector.DEFAULT_THRESHOLD;
  }

  /**
   * Check USDT balance drift
   * Formula: drift_usdt = max(0, (capital_available - USDT_SPOT) / max(capital_available, 1))
   * Only triggers when insufficient funds (spot < capital_available)
   * Allows excess funds in account (spot > capital_available is OK)
   */
  checkUSDTDrift(params: USDTDriftParams): DriftResult {
    let { spotBalance, capitalAvailable } = params;

    // Handle undefined/null - coerce to number
    // undefined becomes NaN, null becomes 0
    spotBalance = Number(spotBalance);
    capitalAvailable = Number(capitalAvailable);

    // Handle invalid inputs
    if (!Number.isFinite(spotBalance) || !Number.isFinite(capitalAvailable)) {
      // For NaN or Infinity inputs, return NaN drift percentage
      return {
        asset: "USDT",
        driftPercentage: Number.NaN,
        status: "exceeded",
        threshold: this.threshold,
      };
    }

    // Calculate drift using updated formula from STRATEGY.md
    // Only triggers drift when insufficient funds (allows excess)
    const insufficientAmount = Math.max(0, capitalAvailable - spotBalance);
    const denominator = Math.max(capitalAvailable, DriftDetector.USDT_EPSILON);
    const driftPercentage = insufficientAmount / denominator;

    return {
      asset: "USDT",
      driftPercentage,
      status: driftPercentage >= this.threshold ? "exceeded" : "ok",
      threshold: this.threshold,
    };
  }

  /**
   * Check BTC balance drift
   * Formula: drift_btc = max(0, (btc_accumulated - BTC_SPOT)) / max(btc_accumulated, 0.00000001)
   * Only triggers when insufficient BTC (spot < btc_accumulated)
   * Allows excess BTC (dust amounts) without triggering drift
   */
  checkBTCDrift(params: BTCDriftParams): DriftResult {
    let { spotBalance, btcAccumulated } = params;

    // Handle undefined/null - coerce to number
    // undefined becomes NaN, null becomes 0
    spotBalance = Number(spotBalance);
    btcAccumulated = Number(btcAccumulated);

    // Handle invalid inputs
    if (!Number.isFinite(spotBalance)) {
      // For Infinity inputs, return Infinity drift percentage
      if (spotBalance === Infinity) {
        // Infinity spot balance means excess, which is OK
        return {
          asset: "BTC",
          driftPercentage: 0,
          status: "ok",
          threshold: this.threshold,
        };
      }
      // For NaN inputs
      return {
        asset: "BTC",
        driftPercentage: Number.NaN,
        status: "exceeded",
        threshold: this.threshold,
      };
    }

    if (!Number.isFinite(btcAccumulated)) {
      // Handle NaN or Infinity
      return {
        asset: "BTC",
        driftPercentage: Number.NaN,
        status: "exceeded",
        threshold: this.threshold,
      };
    }

    // Calculate drift using tolerance formula (like USDT)
    // Only triggers drift when insufficient BTC (allows excess/dust)
    const insufficientAmount = Math.max(0, btcAccumulated - spotBalance);
    const denominator = Math.max(btcAccumulated, DriftDetector.BTC_EPSILON);
    const driftPercentage = insufficientAmount / denominator;

    return {
      asset: "BTC",
      driftPercentage,
      status: driftPercentage >= this.threshold ? "exceeded" : "ok",
      threshold: this.threshold,
    };
  }

  /**
   * Check both USDT and BTC drift in one call
   * Returns individual results and overall status
   */
  checkDrift(params: CombinedDriftParams): CombinedDriftResult {
    const usdtResult = this.checkUSDTDrift({
      spotBalance: params.usdtSpotBalance,
      capitalAvailable: params.capitalAvailable,
    });

    const btcResult = this.checkBTCDrift({
      spotBalance: params.btcSpotBalance,
      btcAccumulated: params.btcAccumulated,
    });

    // Overall status is exceeded if either asset drift is exceeded
    const overallStatus: DriftStatus =
      usdtResult.status === "exceeded" || btcResult.status === "exceeded"
        ? "exceeded"
        : "ok";

    return {
      usdt: usdtResult,
      btc: btcResult,
      overallStatus,
    };
  }

  /**
   * Get the current threshold value
   */
  getThreshold(): number {
    return this.threshold;
  }
}
