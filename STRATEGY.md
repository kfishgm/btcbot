# BTC Trading Bot - Complete Trading Strategy Specification

**⚠️ THIS IS THE SINGLE SOURCE OF TRUTH FOR THE TRADING STRATEGY ⚠️**

All implementation MUST follow these formulas and rules EXACTLY. No deviations allowed.

## Table of Contents

1. [Strategy Parameters](#strategy-parameters)
2. [Core Formulas](#core-formulas)
3. [Execution Order](#execution-order)
4. [Critical Implementation Rules](#critical-implementation-rules)
5. [Complete Pseudocode Reference](#complete-pseudocode-reference)

---

## Strategy Parameters

### Configurable Parameters

- `timeframe`: e.g., "4h" (4-hour candles)
- `%Drop`: 0.02 to 0.08 (2-8%) - drop threshold vs reference_price to trigger buy
- `%Rise`: 0.02 to 0.08 (2-8%) - rise threshold vs reference_price to trigger sell
- `MaxPurchases`: 1 to 30 - maximum purchases allowed per cycle
- `MinBuyUSDT`: ≥ 10.00 - minimum amount per purchase
- `InitialCapitalUSDT`: Starting capital for the cycle (e.g., 300.00)
- `SlippageGuardBuyPct`: 0.003 (0.3% default) - slippage protection for buy orders
- `SlippageGuardSellPct`: 0.003 (0.3% default) - slippage protection for sell orders

### Constants (NEVER CHANGE)

- `ATH_WINDOW = 20` - Number of closed candles for ATH calculation
- `DriftHaltThresholdPct = 0.005` (0.5%) - Maximum allowed balance drift before pause
- `ORDER_TYPE = "LIMIT IOC"` - Always use Limit Immediate-Or-Cancel orders

---

## Core Formulas

### 1. Dynamic ATH Calculation (20-candle moving window)

```
ATH(N) = max(High[i]) for i in the last N CLOSED candles
where N = ATH_WINDOW = 20

IMPORTANT:
- Exclude the current unclosed candle
- Only calculate when btc_accumulated == 0
- This becomes reference_price when not holding
```

### 2. Reference Price (Weighted Average with Fees)

```
reference_price = cost_accum_usdt / btc_accum_net

Where:
cost_accum_usdt = Σ(usdt_fill + fee_quote + fee_base * fill_price)
btc_accum_net   = Σ(btc_fill - fee_base)

CRITICAL:
- Track fees in BOTH base (BTC) and quote (USDT) currencies
- fee_base reduces BTC received
- fee_quote increases USDT spent
- Include fee_base converted to USDT in cost accumulator
```

### 3. Buy Amount Calculation

```
At cycle start:
buy_amount = floor_to_precision(InitialCapitalUSDT / MaxPurchases)

For each purchase:
if (purchases_remaining == 1):
    amount_to_buy = capital_available  // Use all remaining
else:
    amount_to_buy = buy_amount  // Use fixed amount

Skip if amount_to_buy < max(MinBuyUSDT, exchange_minNotional)
```

### 4. Trading Conditions (Evaluated at Candle Close)

```
BUY CONDITION:
if (Close ≤ reference_price * (1 - %Drop) AND
    purchases_remaining > 0 AND
    capital_available >= buy_amount):
    EXECUTE BUY

SELL CONDITION:
if (btc_accumulated > 0 AND
    Close ≥ reference_price * (1 + %Rise)):
    SELL ALL btc_accumulated  // NEVER partial, always 100% of cycle BTC
```

### 5. Order Price Limits (Slippage Protection)

```
BUY ORDER:
limit_price_buy = round_to_tick(Close * (1 + SlippageGuardBuyPct))
// Price can go UP by slippage % to ensure fill

SELL ORDER:
limit_price_sell = round_to_tick(Close * (1 - SlippageGuardSellPct))
// Price can go DOWN by slippage % to ensure fill

round_to_tick(price):
    return floor(price / tick_size) * tick_size
```

### 6. Profit Calculation (On Complete Sale Only)

```
principal_usdt = reference_price * total_btc_sold
profit_usdt = max(0, net_usdt_received - principal_usdt)
capital_available = capital_available + principal_usdt + profit_usdt

IMPORTANT:
- Profit can NEVER be negative (use max(0, ...))
- Principal is based on reference_price, not market price
- Fees are already accounted for in net_usdt_received
```

### 7. Drift Detection (Safety Mechanism)

```
drift_usdt = |USDT_SPOT - capital_available| / max(capital_available, 1)
drift_btc = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)

if (drift_usdt >= 0.005 OR drift_btc >= 0.005):
    PAUSE STRATEGY
    SEND ALERT
    REQUIRE MANUAL INTERVENTION
```

---

## Execution Order

### Per Candle Close (STRICT ORDER)

1. **Update ATH if not holding**

   ```
   if (btc_accumulated == 0):
       ath_price = compute_ATH(last_20_closed_candles)
       reference_price = ath_price
   ```

2. **Check SELL condition FIRST (if holding)**

   ```
   if (btc_accumulated > 0 AND Close >= reference_price * (1 + %Rise)):
       validate_btc_balance()
       check_drift()
       place_sell_order(btc_accumulated)  // Sell ALL from cycle
   ```

3. **Check BUY condition AFTER (if not at max)**

   ```
   if (purchases_remaining > 0 AND Close <= reference_price * (1 - %Drop)):
       validate_usdt_balance()
       check_drift()
       place_buy_order(calculated_amount)
   ```

4. **Update state after order execution**

   ```
   if buy_executed:
       update_accumulators()
       recalculate_reference_price()
       purchases_remaining -= 1
       status = "HOLDING"

   if sell_executed:
       if (btc_accumulated == 0):  // Complete sale
           calculate_profit()
           reset_cycle()
           status = "READY"
   ```

---

## Critical Implementation Rules

### Cycle Management

1. **Cycle Isolation**: Each cycle tracks its own BTC separately from any other BTC in account
2. **No Partial Cycle Closure**: Cycle ONLY resets when 100% of accumulated BTC is sold
3. **Capital Compounding**: Profits from one cycle become capital for the next

### Order Execution

1. **Order Type**: ALWAYS use `LIMIT IOC` (Immediate-Or-Cancel) orders
2. **No Market Orders**: NEVER use market orders, even if faster
3. **Partial Fills**: Handle gracefully but still count as one purchase used
4. **Validation Order**:
   - Check balance sufficiency
   - Validate against exchange rules (minNotional, stepSize, tickSize)
   - Check drift
   - Then place order

### Fee Handling

1. **Dual Currency Fees**: Track fees in both BTC and USDT
2. **Net Calculations**: Always use net amounts (after fees) for state
3. **Fee Impact on Reference**: Include all fees in reference price calculation

### State Persistence

1. **Write-Before-Execute**: Save state to database BEFORE placing orders
2. **Atomic Updates**: Use database transactions for multi-field updates
3. **Recovery Safety**: On restart, validate state consistency before trading

### Error Handling

1. **Retry with Backoff**: 3 attempts with exponential backoff for API failures
2. **Pause on Drift**: Immediately pause if drift exceeds 0.5%
3. **Never Lose State**: Maintain consistency even during errors

---

## Complete Pseudocode Reference

```typescript
// Main trading loop - executes on each candle close
async function onCandleClose(candle: Candle): Promise<void> {
  // Step 1: Update ATH if not holding
  if (state.btc_accumulated === 0) {
    const last20Candles = await getLastNClosedCandles(20);
    state.ath_price = Math.max(...last20Candles.map((c) => c.high));
    state.reference_price = state.ath_price;
  }

  // Step 2: Check SELL condition first (only if holding)
  if (state.btc_accumulated > 0) {
    const sellThreshold = state.reference_price * (1 + config.rise_percentage);

    if (candle.close >= sellThreshold) {
      // Validate we actually have the BTC
      const btcBalance = await getBTCBalance();
      if (btcBalance < state.btc_accumulated) {
        await pauseStrategy("BTC balance mismatch");
        return;
      }

      // Check drift
      const btcDrift =
        Math.abs(btcBalance - state.btc_accumulated) /
        Math.max(state.btc_accumulated, 0.00000001);
      if (btcDrift >= 0.005) {
        await pauseStrategy("BTC drift exceeded");
        return;
      }

      // Place sell order for ALL accumulated BTC
      const limitPrice = roundToTick(
        candle.close * (1 - config.slippage_sell_pct),
        "sell",
      );

      const result = await placeLimitIOCOrder({
        side: "SELL",
        quantity: state.btc_accumulated,
        price: limitPrice,
      });

      if (result.filled_quantity > 0) {
        const usdtReceived = result.quote_quantity - result.fees_usdt;
        const btcSold = result.filled_quantity;

        // Update state
        state.btc_accumulated -= btcSold;

        // If completely sold, calculate profit and reset
        if (state.btc_accumulated < 0.00000001) {
          const principal = state.reference_price * btcSold;
          const profit = Math.max(0, usdtReceived - principal);

          state.capital_available += principal + profit;

          // Reset cycle
          state.btc_accumulated = 0;
          state.cost_accum_usdt = 0;
          state.btc_accum_net = 0;
          state.purchases_remaining = config.max_purchases;
          state.buy_amount = Math.floor(
            state.capital_available / config.max_purchases,
          );
          state.reference_price = state.ath_price;
          state.status = "READY";

          await saveState(state);
          await sendNotification(`Cycle complete. Profit: ${profit}`);
        }
      }
    }
  }

  // Step 3: Check BUY condition (only if not at max purchases)
  if (state.purchases_remaining > 0) {
    const buyThreshold = state.reference_price * (1 - config.drop_percentage);

    if (candle.close <= buyThreshold) {
      // Determine buy amount
      let buyAmountUSDT = state.buy_amount;
      if (state.purchases_remaining === 1) {
        buyAmountUSDT = state.capital_available;
      }

      // Skip if too small
      if (buyAmountUSDT < Math.max(config.min_buy_usdt, 10)) {
        return;
      }

      // Validate USDT balance
      const usdtBalance = await getUSDTBalance();
      if (usdtBalance < buyAmountUSDT) {
        return; // Skip, insufficient funds
      }

      // Check drift
      const usdtDrift =
        Math.abs(usdtBalance - state.capital_available) /
        Math.max(state.capital_available, 1);
      if (usdtDrift >= 0.005) {
        await pauseStrategy("USDT drift exceeded");
        return;
      }

      // Place buy order
      const limitPrice = roundToTick(
        candle.close * (1 + config.slippage_buy_pct),
        "buy",
      );

      const quantity = buyAmountUSDT / limitPrice;
      const roundedQty = roundToStepSize(quantity);

      const result = await placeLimitIOCOrder({
        side: "BUY",
        quantity: roundedQty,
        price: limitPrice,
      });

      if (result.filled_quantity > 0) {
        // Update accumulators including fees
        const totalCostUSDT = result.quote_quantity + result.fees_usdt;
        const netBTCReceived = result.filled_quantity - result.fees_btc;

        state.cost_accum_usdt +=
          totalCostUSDT + result.fees_btc * result.avg_price;
        state.btc_accum_net += netBTCReceived;
        state.btc_accumulated += netBTCReceived;
        state.capital_available -= totalCostUSDT;

        // Recalculate reference price
        state.reference_price = state.cost_accum_usdt / state.btc_accum_net;

        state.purchases_remaining -= 1;
        state.status = "HOLDING";

        await saveState(state);
        await sendNotification(`Buy executed at ${result.avg_price}`);
      }
    }
  }
}

// Helper functions
function roundToTick(price: number, side: "buy" | "sell"): number {
  const tickSize = 0.01; // Get from exchange info
  return Math.floor(price / tickSize) * tickSize;
}

function roundToStepSize(quantity: number): number {
  const stepSize = 0.00001; // Get from exchange info
  return Math.floor(quantity / stepSize) * stepSize;
}
```

---

## Testing Requirements

Every implementation MUST pass these test scenarios:

1. **ATH Calculation**
   - Correctly identifies max from 20 candles
   - Handles < 20 candles gracefully
   - Excludes current unclosed candle
   - Only updates when btc_accumulated == 0

2. **Reference Price**
   - Equals ATH when no purchases
   - Correctly weighted after single purchase
   - Correctly weighted after multiple purchases
   - Includes all fees in calculation

3. **Buy Execution**
   - Triggers at exact threshold
   - Respects purchases_remaining
   - Uses all capital on last purchase
   - Handles partial fills correctly

4. **Sell Execution**
   - Triggers at exact threshold
   - Always sells 100% of cycle BTC
   - Never sells non-cycle BTC
   - Calculates profit correctly

5. **Cycle Reset**
   - Only on 100% sale
   - Compounds profit into capital
   - Resets all accumulators
   - Recalculates buy_amount

6. **Drift Detection**
   - Pauses at 0.5% drift
   - Checks before every order
   - Handles edge cases (zero balances)

---

## Important Notes

1. **This strategy is designed for spot trading only** - no leverage, no futures
2. **One cycle at a time** - never run parallel cycles
3. **Real money consequences** - test thoroughly with small amounts first
4. **Exchange limits matter** - always respect minNotional, min quantities
5. **Fees can vary** - some trades have BNB fees, some have USDT/BTC fees

---

**Document Version**: 1.0
**Last Updated**: 2024
**Status**: FINAL - DO NOT MODIFY WITHOUT APPROVAL

## References

- Original PRD: `/docs/PRD.md` (Appendix A)
- Database Schema: `/docs/PRD.md` (Section 6)
- BDD Tests: `/docs/PRD.md` (Section 4)
