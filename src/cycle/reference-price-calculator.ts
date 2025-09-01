/**
 * Reference Price Calculator
 * Implements TRD-001: Calculate weighted average reference price including fees
 * Formula from STRATEGY.md:
 * reference_price = cost_accum_usdt / btc_accum_net
 */

export interface Purchase {
  usdt_spent: number;
  btc_filled: number;
  fee_usdt: number;
  fee_btc: number;
  fill_price: number;
}

export class ReferencePriceCalculator {
  private costAccumUsdt: number = 0;
  private btcAccumNet: number = 0;
  private athPrice: number = 0;
  private hasPurchases: boolean = false;

  constructor(athPrice: number = 0) {
    this.athPrice = athPrice;
  }

  /**
   * Get initial reference price (returns ATH when no BTC held)
   * @param athPrice ATH price to use as initial reference
   * @returns Initial reference price
   */
  public getInitialReferencePrice(athPrice: number): number {
    return athPrice;
  }

  /**
   * Calculate reference price from an array of purchases (instance method)
   * @param purchases Array of purchase transactions
   * @param athPrice Optional ATH price override
   * @returns Reference price
   */
  public calculateReferencePrice(
    purchases: Purchase[],
    athPrice?: number,
  ): number {
    const ath = athPrice !== undefined ? athPrice : this.athPrice;
    return ReferencePriceCalculator.calculateReferencePrice(purchases, ath);
  }

  /**
   * Calculate reference price from an array of purchases (static method)
   * @param purchases Array of purchase transactions
   * @param athPrice ATH price to use when no BTC is accumulated
   * @returns Reference price
   */
  public static calculateReferencePrice(
    purchases: Purchase[],
    _athPrice: number = 0,
  ): number {
    // Throw error for empty purchases array
    if (!purchases || purchases.length === 0) {
      throw new Error(
        "Cannot calculate reference price: no purchases provided",
      );
    }

    let costAccumUsdt = 0;
    let btcAccumNet = 0;

    for (const purchase of purchases) {
      // Validate input
      if (
        purchase.usdt_spent < 0 ||
        purchase.btc_filled < 0 ||
        purchase.fee_usdt < 0 ||
        purchase.fee_btc < 0 ||
        purchase.fill_price < 0
      ) {
        throw new Error("Invalid purchase data: negative values not allowed");
      }

      // Calculate cost accumulator
      // cost_accum_usdt = Σ(usdt_spent + fee_usdt + fee_btc * fill_price)
      costAccumUsdt +=
        purchase.usdt_spent +
        purchase.fee_usdt +
        purchase.fee_btc * purchase.fill_price;

      // Calculate net BTC
      // btc_accum_net = Σ(btc_filled - fee_btc)
      btcAccumNet += purchase.btc_filled - purchase.fee_btc;
    }

    // Handle division by zero
    if (btcAccumNet === 0) {
      throw new Error(
        "Cannot calculate reference price: net BTC accumulated is zero",
      );
    }

    // Calculate and return reference price
    return costAccumUsdt / btcAccumNet;
  }

  /**
   * Add a purchase to the running calculation (incremental calculation)
   * @param purchase Purchase transaction to add
   */
  public addPurchase(purchase: Purchase): void {
    // Validate input
    if (
      purchase.usdt_spent < 0 ||
      purchase.btc_filled < 0 ||
      purchase.fee_usdt < 0 ||
      purchase.fee_btc < 0 ||
      purchase.fill_price < 0
    ) {
      throw new Error("Invalid purchase data: negative values not allowed");
    }

    // Update cost accumulator
    this.costAccumUsdt +=
      purchase.usdt_spent +
      purchase.fee_usdt +
      purchase.fee_btc * purchase.fill_price;

    // Update net BTC
    this.btcAccumNet += purchase.btc_filled - purchase.fee_btc;

    // Mark that we have purchases
    this.hasPurchases = true;
  }

  /**
   * Get current reference price based on accumulated values
   * @returns Current reference price
   */
  public getCurrentReferencePrice(): number {
    // If no purchases have been made and we've been reset, throw error
    if (!this.hasPurchases && this.btcAccumNet === 0 && this.athPrice === 0) {
      throw new Error(
        "Cannot calculate reference price: no purchases in current cycle",
      );
    }

    // Return ATH if no BTC accumulated
    if (this.btcAccumNet === 0) {
      return this.athPrice;
    }

    // Calculate reference price
    return this.costAccumUsdt / this.btcAccumNet;
  }

  /**
   * Reset the calculator for a new cycle
   * @param athPrice Optional new ATH price to set
   */
  public reset(athPrice?: number): void {
    this.costAccumUsdt = 0;
    this.btcAccumNet = 0;
    this.hasPurchases = false;
    if (athPrice !== undefined) {
      this.athPrice = athPrice;
    } else {
      // Clear ATH on reset without new value to force error if accessed
      this.athPrice = 0;
    }
  }

  /**
   * Get total cost accumulated in USDT
   * @returns Total cost in USDT including all fees
   */
  public getTotalCostUsdt(): number {
    return this.costAccumUsdt;
  }

  /**
   * Get total cost accumulated in USDT (alternative naming)
   * @returns Total cost in USDT including all fees
   */
  public getTotalCostUSDT(): number {
    return this.costAccumUsdt;
  }

  /**
   * Get net BTC accumulated (after fees)
   * @returns Net BTC amount
   */
  public getNetBtcAccumulated(): number {
    return this.btcAccumNet;
  }

  /**
   * Get net BTC accumulated (alternative naming)
   * @returns Net BTC amount
   */
  public getNetBTCAccumulated(): number {
    return this.btcAccumNet;
  }

  /**
   * Update ATH price
   * @param athPrice New ATH price
   */
  public setAthPrice(athPrice: number): void {
    this.athPrice = athPrice;
  }
}
