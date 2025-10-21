# Code Review: Reference Price and Sell Target Price Logic

**Reviewer:** Claude Code
**Date:** 2025-10-21
**Scope:** Reference price calculation and sell target price logic

---

## Executive Summary

This review examines how reference price and sell target price are calculated and set in the BTC trading bot. A **CRITICAL BUG** was identified in the reference price calculation that violates STRATEGY.md specifications.

### Overall Assessment: ❌ **CRITICAL ISSUES FOUND**

**Production Readiness:** NOT READY - Critical bug must be fixed before deployment

---

## Components Reviewed

1. **src/cycle/reference-price-calculator.ts** - Reference price calculation logic
2. **src/cycle/sell-trigger-detector.ts** - Sell threshold calculation
3. **src/cycle/buy-order-state-updater.ts** - Reference price updates after buy orders
4. **src/app/main-orchestrator.ts** - Initial ATH/reference price setting
5. **tests/cycle/reference-price-calculator.test.ts** - Test specifications

---

## Critical Findings

### 🔴 CRITICAL BUG #1: Incorrect Fee Handling in Reference Price Calculation

**Location:** `src/cycle/reference-price-calculator.ts:66-72`

**Issue:**
The `calculatePurchaseCost()` method is **adding fees to the cost**, which contradicts STRATEGY.md:

```typescript
// CURRENT IMPLEMENTATION (INCORRECT)
private static calculatePurchaseCost(purchase: Purchase): number {
  return (
    purchase.usdt_spent +
    purchase.fee_usdt +           // ❌ WRONG: Adding USDT fee
    purchase.fee_btc * purchase.fill_price  // ❌ WRONG: Adding BTC fee as USDT
  );
}
```

**What STRATEGY.md Says:**

From STRATEGY.md lines 209-218:

```
Formula from STRATEGY.md:
- avg_cost = cost_accum_usdt / btc_accum_net
- cost_accum_usdt = Σ(usdt_spent)  // No fee addition - fees already reflected
- btc_accum_net = Σ(btc_filled - fee_btc)  // BTC fees reduce net amount

Fee handling:
- Buy fees in BTC: Reduce btc_accum_net (denominator)
- Sell fees in USDT: Reduce proceeds (not added to cost)
- NO double-counting: fee_btc * fill_price should NOT be added to cost
```

**Impact:**

1. **Reference price is artificially inflated** by adding fees to numerator
2. **Double-counting fees**: Fees are counted both in cost (numerator) AND in reduced BTC (denominator)
3. **Sell triggers fire later than intended** because threshold is higher
4. **Profit calculations are incorrect**

**Evidence from buy-order-state-updater.ts:210-211:**

```typescript
// For Binance: BUY orders only have BTC fees (deducted from received amount)
// The USDT cost is already the full amount paid (cummulativeQuoteQty)
// DO NOT add fees - they're already reflected in reduced BTC quantity
const totalCostUsdt = usdtSpent; // No fee addition - fees handled via reduced BTC
```

**Correct Implementation Should Be:**

```typescript
private static calculatePurchaseCost(purchase: Purchase): number {
  // USDT spent is the ONLY cost - fees already reflected in reduced BTC
  return purchase.usdt_spent;
}
```

**Test Impact:**
All tests in `tests/cycle/reference-price-calculator.test.ts` have **INCORRECT EXPECTATIONS** and need to be updated. For example:

Line 43-46 (INCORRECT):

```typescript
// cost_accum_usdt = 500 + 0.5 + 0 * 50000 = 500.5  // ❌ WRONG
// btc_accum_net = 0.01 - 0 = 0.01
// reference_price = 500.5 / 0.01 = 50050
expect(result).toBe(50050);
```

Should be (CORRECT):

```typescript
// cost_accum_usdt = 500  // ✅ CORRECT - just usdt_spent
// btc_accum_net = 0.01 - 0 = 0.01
// reference_price = 500 / 0.01 = 50000
expect(result).toBe(50000);
```

---

### 🔴 CRITICAL BUG #2: Inconsistent Implementation

**Issue:** The bug only exists in `ReferencePriceCalculator` class. The `BuyOrderStateUpdater` correctly implements the logic:

**Location:** `src/cycle/buy-order-state-updater.ts:195-211`

```typescript
// ✅ CORRECT IMPLEMENTATION in buy-order-state-updater.ts
const totalCostUsdt = usdtSpent; // No fee addition - fees handled via reduced BTC
```

**Problem:** Two different parts of the codebase calculate reference price differently, creating **inconsistency risk**.

---

## Other Findings

### ✅ CORRECT: Sell Target Price Calculation

**Location:** `src/cycle/sell-trigger-detector.ts:228-235`

```typescript
public calculateSellThreshold(
  referencePrice: number,
  risePercentage: number,
): number {
  // Formula from STRATEGY_UPDATED.md: avg_cost * (1 + %Rise)
  // where avg_cost is stored as reference_price
  return referencePrice * (1 + risePercentage);
}
```

**Assessment:** ✅ This correctly implements STRATEGY.md formula: `sell_threshold = avg_cost * (1 + %Rise)`

---

### ✅ CORRECT: ATH-Based Initial Reference Price

**Location:** `src/app/main-orchestrator.ts:337-360`

```typescript
if (!workingState.btc_accumulated || workingState.btc_accumulated === 0) {
  logger.info("Not holding BTC, updating ATH");

  const athPrice = this.config.historicalCandleManager.calculateATH({
    excludeUnclosed: true,
  });

  if (athPrice > 0) {
    workingState.ath_price = athPrice;
    workingState.reference_price = athPrice; // ✅ Correct
    logger.info(`Updated ATH to ${athPrice} from 20 candles`);
  }
}
```

**Assessment:** ✅ Correctly sets reference_price = ATH when not holding BTC

---

### ✅ CORRECT: Reference Price Update After Buy

**Location:** `src/cycle/buy-order-state-updater.ts:254-257`

```typescript
// Calculate new reference price using ONLY current cycle BTC (excludes dust)
const referencePrice = this.calculateReferencePrice(
  newCostAccumUsdt,
  newBtcAccumNet, // Excludes dust - only current cycle BTC
);
```

**Assessment:** ✅ Correctly excludes dust from reference price calculation

---

### ⚠️ WARNING: Reference Price Rounding

**Location:** `src/cycle/buy-order-state-updater.ts:366-378`

```typescript
private calculateReferencePrice(
  costAccumUsdt: number,
  btcAccumNet: number,
): number {
  if (btcAccumNet === 0) {
    logger.warn("btcAccumNet is 0, returning 0 for reference price");
    return 0;
  }

  // Calculate reference price and round to 2 decimal places
  const referencePrice = costAccumUsdt / btcAccumNet;
  const rounded = Math.round(referencePrice * 100) / 100;  // ⚠️ Rounding
```

**Concern:** Rounding to 2 decimal places might accumulate errors over multiple cycles. Consider using higher precision internally and only rounding for display.

**Recommendation:** Use full precision for calculations, round only for logging/display.

---

## Code Quality Observations

### ✅ Strengths:

1. **Clear separation of concerns** - Different classes handle different aspects
2. **Good logging** - Comprehensive debug logging for troubleshooting
3. **Dust handling** - Properly separates dust from current cycle BTC
4. **Validation** - Good input validation in sell trigger detector
5. **Documentation** - Good inline comments explaining logic

### ⚠️ Areas for Improvement:

1. **Inconsistent implementations** - ReferencePriceCalculator vs BuyOrderStateUpdater
2. **Test expectations don't match spec** - Tests encode the bug
3. **Naming confusion** - "reference_price" has dual meaning (ATH vs avg_cost)
4. **Precision loss** - Rounding to 2 decimals may accumulate errors

---

## Required Fixes

### Priority 1: CRITICAL (Must Fix Before Production)

1. **Fix ReferencePriceCalculator.calculatePurchaseCost()**
   - Remove fee additions
   - Change to: `return purchase.usdt_spent;`
   - Location: `src/cycle/reference-price-calculator.ts:66-72`

2. **Update ALL tests in reference-price-calculator.test.ts**
   - Recalculate all expected values
   - Remove fee additions from expectations
   - Verify tests still provide good coverage

3. **Add validation test**
   - Verify ReferencePriceCalculator matches BuyOrderStateUpdater results
   - Create cross-validation test to catch future inconsistencies

### Priority 2: RECOMMENDED

4. **Consider removing ReferencePriceCalculator class**
   - Only BuyOrderStateUpdater uses correct logic in production
   - Reduce code duplication and inconsistency risk
   - If keeping class, ensure it's only used for testing

5. **Improve precision handling**
   - Use full precision internally
   - Round only for display/logging
   - Consider using Decimal.js throughout

6. **Clarify naming**
   - Document dual use of "reference_price" field
   - Consider separate fields: ath_price and avg_cost

---

## Testing Recommendations

### Required Tests (Missing):

1. **Cross-validation test**

   ```typescript
   it("should produce same results as BuyOrderStateUpdater", () => {
     // Compare ReferencePriceCalculator vs BuyOrderStateUpdater
     // on identical input
   });
   ```

2. **Integration test for fee handling**

   ```typescript
   it("should not double-count fees", () => {
     // Verify fees only reduce BTC, not increase cost
   });
   ```

3. **Sell threshold accuracy test**
   ```typescript
   it("should trigger sell at exactly %Rise above avg_cost", () => {
     // Verify sell triggers at correct price
   });
   ```

---

## Conclusion

### Summary of Issues:

| Issue                                           | Severity    | Status    | Impact                                         |
| ----------------------------------------------- | ----------- | --------- | ---------------------------------------------- |
| Fee double-counting in ReferencePriceCalculator | 🔴 CRITICAL | NOT FIXED | Incorrect pricing, delayed sells, wrong profit |
| Inconsistent implementations                    | 🔴 CRITICAL | NOT FIXED | Confusion, maintenance burden                  |
| Test expectations wrong                         | 🔴 CRITICAL | NOT FIXED | Tests validate incorrect behavior              |
| Precision rounding                              | ⚠️ WARNING  | NOT FIXED | Potential accumulation of errors               |

### Recommendations:

1. **IMMEDIATE:** Fix `calculatePurchaseCost()` to remove fee additions
2. **IMMEDIATE:** Update all test expectations
3. **IMMEDIATE:** Add cross-validation test
4. **SOON:** Consider consolidating to single implementation
5. **SOON:** Improve precision handling

### READY FOR PRODUCTION? **NO**

The fee double-counting bug causes incorrect reference prices, which impacts:

- When sells are triggered (delayed)
- Profit calculations (overstated costs)
- Trading strategy effectiveness

This **MUST** be fixed before production deployment.

---

## References

- **STRATEGY.md** - Lines 130-229 (Reference Price Formula)
- **STRATEGY.md** - Lines 600-605 (Fee Calculation Fix changelog)
- **src/cycle/reference-price-calculator.ts**
- **src/cycle/buy-order-state-updater.ts** - Lines 195-300
- **src/cycle/sell-trigger-detector.ts**
- **tests/cycle/reference-price-calculator.test.ts**

---

**END OF REVIEW**
