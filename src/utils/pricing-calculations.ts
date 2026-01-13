/**
 * Shared pricing calculation utilities
 * Single source of truth for pricing formulas used across the bot
 */

/**
 * Calculate the sell threshold price based on average buy price and rise percentage.
 * Target represents market movement, NOT net profit after fees.
 *
 * Formula: Reference Price × (1 + %Rise)
 *
 * @param referencePrice - The average buy price (cost_accum_usdt / btc_accum_net)
 * @param risePercentage - The target profit percentage (e.g., 0.005 for 0.5%)
 * @param _commissionRate - DEPRECATED: No longer used for target calculation (kept for backward compatibility)
 * @returns The sell threshold price
 *
 * @example
 * // 0.5% profit target
 * calculateSellThreshold(100, 0.005, 0)
 * // Returns: 100.5 (avg_buy × 1.005)
 */
export function calculateSellThreshold(
  referencePrice: number,
  risePercentage: number,
  _commissionRate: number,
): number {
  // Target = avg_buy_price × (1 + rise%)
  // Fees do NOT alter the target - it represents market movement, not net profit
  return referencePrice * (1 + risePercentage);
}
