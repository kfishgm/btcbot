/**
 * Trading utility functions for handling Binance trading rules
 * These functions ensure all values conform to exchange requirements
 */

/**
 * Round a price to the nearest valid tick size
 *
 * Binance requires prices to be multiples of tickSize from PRICE_FILTER
 * For example, if tickSize is 0.01, valid prices are 100.00, 100.01, 100.02, etc.
 *
 * @param price - The price to round
 * @param tickSize - The tick size from Binance PRICE_FILTER
 * @returns Price rounded to nearest tick size
 */
export function roundToTickSize(price: number, tickSize: number): number {
  if (tickSize <= 0) {
    throw new Error(`Invalid tickSize: ${tickSize}`);
  }

  // Round to nearest tick
  const ticks = Math.round(price / tickSize);

  // Calculate precision needed for the tick size
  // e.g., tickSize 0.01 needs 2 decimal places
  const tickString = tickSize.toString();
  const decimalIndex = tickString.indexOf(".");
  const precision =
    decimalIndex === -1 ? 0 : tickString.length - decimalIndex - 1;

  // Use toFixed to avoid floating point errors
  return parseFloat((ticks * tickSize).toFixed(precision));
}

/**
 * Round a USDT amount to the specified precision
 *
 * @param amount - The USDT amount to round
 * @param precision - The quote asset precision from Binance (typically 8 for USDT)
 * @returns Amount rounded to specified precision
 */
export function roundToQuotePrecision(
  amount: number,
  precision: number,
): number {
  if (precision < 0 || precision > 20) {
    throw new Error(`Invalid precision: ${precision}`);
  }

  return parseFloat(amount.toFixed(precision));
}

/**
 * Round a price down to the nearest tick size (floor)
 * Useful for buy orders to ensure we don't overpay
 *
 * @param price - The price to round
 * @param tickSize - The tick size from Binance PRICE_FILTER
 * @returns Price floored to tick size
 */
export function floorToTickSize(price: number, tickSize: number): number {
  if (tickSize <= 0) {
    throw new Error(`Invalid tickSize: ${tickSize}`);
  }

  // Floor to tick
  const ticks = Math.floor(price / tickSize);

  // Calculate precision
  const tickString = tickSize.toString();
  const decimalIndex = tickString.indexOf(".");
  const precision =
    decimalIndex === -1 ? 0 : tickString.length - decimalIndex - 1;

  return parseFloat((ticks * tickSize).toFixed(precision));
}

/**
 * Round a price up to the nearest tick size (ceil)
 * Useful for sell orders to ensure we don't undersell
 *
 * @param price - The price to round
 * @param tickSize - The tick size from Binance PRICE_FILTER
 * @returns Price ceiling to tick size
 */
export function ceilToTickSize(price: number, tickSize: number): number {
  if (tickSize <= 0) {
    throw new Error(`Invalid tickSize: ${tickSize}`);
  }

  // Ceil to tick
  const ticks = Math.ceil(price / tickSize);

  // Calculate precision
  const tickString = tickSize.toString();
  const decimalIndex = tickString.indexOf(".");
  const precision =
    decimalIndex === -1 ? 0 : tickString.length - decimalIndex - 1;

  return parseFloat((ticks * tickSize).toFixed(precision));
}

/**
 * Validate if a price conforms to tick size requirements
 *
 * @param price - The price to validate
 * @param tickSize - The tick size from Binance PRICE_FILTER
 * @returns True if price is valid
 */
export function isValidPrice(price: number, tickSize: number): boolean {
  if (tickSize <= 0) return false;

  const rounded = roundToTickSize(price, tickSize);

  // Check if price equals rounded version (within floating point tolerance)
  return Math.abs(price - rounded) < tickSize * 0.0001;
}

/**
 * Calculate the precision (decimal places) from a step/tick size
 *
 * @param stepSize - The step or tick size
 * @returns Number of decimal places
 */
export function getPrecisionFromStep(stepSize: number): number {
  if (stepSize <= 0) {
    throw new Error(`Invalid stepSize: ${stepSize}`);
  }

  // For integers >= 1, count trailing zeros
  if (stepSize >= 1) {
    let zeros = 0;
    let temp = stepSize;

    // Only count if it's a clean multiple of 10
    if (Math.floor(stepSize) === stepSize) {
      while (temp >= 10 && temp % 10 === 0) {
        zeros--;
        temp /= 10;
      }
    }
    return zeros;
  }

  // For decimals, count significant decimal places
  // Use a string approach but handle scientific notation
  const str = stepSize.toString();

  // Handle scientific notation (e.g., 1e-8)
  if (str.includes("e-")) {
    const parts = str.split("e-");
    const exp = parseInt(parts[1]);
    return exp;
  }

  // Regular decimal notation
  const decimalIndex = str.indexOf(".");
  if (decimalIndex === -1) {
    return 0;
  }

  // Find the last non-zero digit after decimal
  let lastNonZeroIndex = str.length - 1;
  while (lastNonZeroIndex > decimalIndex && str[lastNonZeroIndex] === "0") {
    lastNonZeroIndex--;
  }

  // Count decimal places up to last non-zero digit
  if (lastNonZeroIndex > decimalIndex) {
    return lastNonZeroIndex - decimalIndex;
  }

  return 0;
}
