/**
 * Shared pricing calculation utilities
 * Single source of truth for pricing formulas used across the bot
 */

/**
 * Calculate the sell threshold price that accounts for commission fees
 * This ensures that after selling and paying commission, the net proceeds
 * achieve the target rise percentage above the reference price.
 *
 * Formula: (Reference Price × (1 + %Rise)) / (1 - fee_sell)
 *
 * @param referencePrice - The reference price (average cost basis)
 * @param risePercentage - The target profit percentage (e.g., 0.005 for 0.5%)
 * @param commissionRate - The exchange commission rate (e.g., 0.001 for 0.1%)
 * @returns The adjusted sell price that accounts for commission
 *
 * @example
 * // 0.5% profit target with 0.1% commission
 * calculateSellThreshold(100, 0.005, 0.001)
 * // Returns: ~100.601 (ensures 0.5% net profit after 0.1% commission)
 */
export function calculateSellThreshold(
  referencePrice: number,
  risePercentage: number,
  commissionRate: number,
): number {
  const targetGrossPrice = referencePrice * (1 + risePercentage);
  const adjustedSellPrice = targetGrossPrice / (1 - commissionRate);
  return adjustedSellPrice;
}
