/**
 * BTC utility functions for handling Binance trading rules
 */

/**
 * Default precision for BTC (8 decimal places = 1 satoshi)
 * This is standard across all exchanges but can be overridden
 */
export const DEFAULT_BTC_PRECISION = 8;

/**
 * Calculate the tradeable BTC amount based on Binance's LOT_SIZE filter
 *
 * Binance only allows trading in multiples of stepSize (LOT_SIZE filter).
 * Any amount below the stepSize multiple is considered "dust" and cannot be traded.
 *
 * @param totalBTC - The total BTC amount including dust
 * @param stepSize - The LOT_SIZE stepSize from Binance (e.g., 0.00001 for BTCUSDT)
 * @returns The tradeable BTC amount (floor to nearest stepSize)
 */
export function calculateTradeableBTC(
  totalBTC: number,
  stepSize: number,
  precision: number = DEFAULT_BTC_PRECISION,
): number {
  if (totalBTC <= 0 || stepSize <= 0) {
    return 0;
  }

  // Add small epsilon to handle floating point precision before floor
  // This ensures 1.0 / 0.00001 = 100000 instead of 99999.99999...
  const steps = Math.floor((totalBTC + stepSize * 0.0001) / stepSize);
  // Use parseFloat and toFixed to handle precision issues
  const result = parseFloat((steps * stepSize).toFixed(precision));

  // Ensure we don't return more than the original amount
  return result > totalBTC ? parseFloat(totalBTC.toFixed(precision)) : result;
}

/**
 * Calculate the dust amount (non-tradeable BTC)
 *
 * @param totalBTC - The total BTC amount including dust
 * @param stepSize - The LOT_SIZE stepSize from Binance
 * @returns The dust amount that cannot be traded
 */
export function calculateDustBTC(
  totalBTC: number,
  stepSize: number,
  precision: number = DEFAULT_BTC_PRECISION,
): number {
  const tradeable = calculateTradeableBTC(totalBTC, stepSize, precision);
  // Use parseFloat and toFixed to handle precision issues
  return parseFloat((totalBTC - tradeable).toFixed(precision));
}

/**
 * Calculate reference price using only tradeable BTC
 *
 * This ensures the reference price accurately reflects the cost basis
 * of BTC that can actually be sold on the exchange.
 *
 * @param costAccumUSDT - Total USDT spent
 * @param btcAccumNet - Total BTC accumulated (including dust)
 * @param stepSize - The LOT_SIZE stepSize from Binance
 * @returns The reference price based on tradeable BTC only
 */
export function calculateReferencePriceWithTradeable(
  costAccumUSDT: number,
  btcAccumNet: number,
  stepSize: number,
  precision: number = DEFAULT_BTC_PRECISION,
): number | null {
  const tradeableBTC = calculateTradeableBTC(btcAccumNet, stepSize, precision);

  // If no tradeable BTC, return null (can't calculate reference price)
  if (tradeableBTC <= 0) {
    return null;
  }

  return costAccumUSDT / tradeableBTC;
}
