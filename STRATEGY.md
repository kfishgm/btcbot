# BTC Trading Bot - Complete Trading Strategy Specification

**⚠️ THIS IS THE SINGLE SOURCE OF TRUTH FOR THE TRADING STRATEGY ⚠️**

All implementation MUST follow these formulas and rules EXACTLY. No deviations allowed.

## Table of Contents

1. [Strategy Parameters](#strategy-parameters)
2. [Core Formulas](#core-formulas)
3. [Execution Order](#execution-order)
4. [Critical Implementation Rules](#critical-implementation-rules)
5. [Complete Pseudocode Reference](#complete-pseudocode-reference)
6. [Testing Requirements](#testing-requirements)
7. [Important Notes](#important-notes)
8. [Change Log](#change-log)

---

## Strategy Parameters

### Configurable Parameters

- `timeframe`: e.g., "4h" (4-hour candles)
- `%Drop`: 0.02 to 0.08 (2–8%) — drop step used for **arithmetic** buy grid from ATH
- `%Rise`: 0.02 to 0.08 (2–8%) — rise threshold vs **average cost** to trigger sell
- `MaxPurchases`: 1 to 30 — maximum purchases allowed per cycle
- `MinBuyUSDT`: ≥ 10.00 — minimum amount per purchase
- `InitialCapitalUSDT`: Starting capital for the cycle (e.g., 300.00)
- `SlippageGuardBuyPct`: 0.003 (0.3% default) — slippage protection for buy orders
- `SlippageGuardSellPct`: 0.003 (0.3% default) — slippage protection for sell orders

### Configurable Parameters (Database Controlled)

- `ath_window`: 10-500 (default 20) — Number of **closed** candles for ATH calculation

### Constants (NEVER CHANGE)

- `DriftHaltThresholdPct = 0.005` (0.5%) — Maximum allowed balance drift before pause
- `ORDER_TYPE = "LIMIT IOC"` — Always use Limit Immediate-Or-Cancel orders

---

## Trading Constraints and Dust Handling

### Binance Trading Minimums (Fetched Live)

The bot fetches current trading constraints from Binance on startup:

- **Minimum Quantity (minQty)**: 0.00001 BTC (current for BTCUSDT as of 2024)
- **Minimum Notional**: $5.00 USD (order value must be ≥ $5)
- **Step Size**: 0.00001 BTC (quantity must be multiple of this)

### Dust Definition and Handling

**Dust** is BTC that cannot be sold due to minimum constraints:

- Amount < minQty (0.00001 BTC), OR
- Value < minimum notional ($5.00)

**Key Principle: Dust is preserved across cycles and accumulates until sellable.**

### Minimum Sellable Calculation

```
min_sellable_qty = MAX(
  minQty,                        // Minimum quantity constraint
  minNotional / current_price    // Minimum value constraint
)

// Round up to nearest stepSize
min_sellable_qty = CEIL(min_sellable_qty / stepSize) * stepSize
```

Example at $115,000 BTC price:

- minQty = 0.00001 BTC
- minNotional / price = $5 / $115,000 = 0.0000435 BTC
- min_sellable = MAX(0.00001, 0.0000435) = 0.0000435
- Rounded up to stepSize: 0.00005 BTC

### Dust Accumulation Strategy

1. **During Sell Orders:**
   - Quantity is rounded DOWN to nearest stepSize
   - Remainder becomes dust
   - Example: Selling 0.00250749 → Sell 0.00250000, dust = 0.00000749

2. **Cycle Reset with Dust:**
   - When btc_accumulated < min_sellable_qty:
     - Status changes to READY
     - btc_accumulated preserves the total including dust
     - **btc_dust** field tracks dust separately from current cycle BTC
     - **btc_accum_net** resets to 0 (tracks only current cycle BTC)
     - cost_accum_usdt resets to 0 (clean profit tracking)
     - Next cycle starts with accumulated dust

3. **Dust Recovery:**
   - Dust accumulates across multiple cycles
   - When dust + new purchases ≥ min_sellable_qty, it gets sold
   - Ensures no profit is permanently lost

4. **Reference Price Calculation (Dust Exclusion):**
   - **CRITICAL**: Reference price = cost_accum_usdt / btc_accum_net
   - **btc_accum_net** tracks ONLY current cycle BTC (excludes dust)
   - **btc_dust** field preserves dust separately
   - This prevents dust from artificially lowering the reference price
   - Ensures accurate cost basis for sell triggers

### Example Dust Flow

```
Cycle 1: Buy 0.00250749 BTC
         Sell 0.00250000 BTC (rounded down)
         Dust: 0.00000749 ($0.86 @ $115k - unsellable)

Cycle 2: Start with 0.00000749 dust
         Buy 0.00150000 BTC
         Total: 0.00150749 BTC
         Sell 0.00150000 BTC
         Dust: 0.00001498 ($1.72 - still unsellable)

Cycle 3: Start with 0.00001498 dust
         Buy 0.00150000 BTC
         Total: 0.00151498 BTC
         Sell 0.00151000 BTC (includes dust!)
         New dust: 0.00000498
```

## Core Formulas

### 1) Dynamic ATH Calculation (100-candle moving window)

```
ATH(N) = max(High[i]) for i in the last N CLOSED candles
where N = ATH_WINDOW = 100

IMPORTANT:
- Exclude the current unclosed candle
- Only calculate when btc_accumulated == 0
- This seeds the buy grid for the new cycle
```

### 2) Buy Grid (ARITHMETIC ANCHORING STRATEGY - DELAYED CONSTRUCTION)

**IMPORTANT: Grid is NOT built immediately. It's built dynamically when price first drops to trigger level.**

**ANCHORING STRATEGY: After the first buy, the grid is rebuilt using the execution price as the anchor.**

**Initial Grid (Before First Buy):**
Let \( \delta = \%Drop \) and \( \text{ATH} \) be the seed price at cycle start.

Level prices:
\[
P_n = \text{ATH}\cdot (1 - n\,\delta)\quad \text{for } n = 1,2,\dots
\]

**Anchored Grid (After First Buy):**
After the first buy executes at price \( P*{anchor} \):
\[
P_n = P*{anchor}\cdot (1 - n\,\delta)\quad \text{for } n = 1,2,\dots
\]

Constraint: \(0 < n\,\delta < 1\). Stop building levels when the constraint fails or when `n == MaxPurchases` (whichever comes first).

**Grid Quantization:**
All grid levels MUST be quantized to tick size (0.01 for BTCUSDT) using floor operation:

```
quantized_level = floor(raw_level / tick_size) * tick_size
```

**Buy Execution Process:**

1. **On cycle start (btc_accumulated == 0):**
   - Calculate ATH from last 100 closed candles
   - Store ATH as `reference_price` and `ath_price`
   - Do NOT build grid yet (buy_grid remains NULL)

2. **On each candle close (while buy_grid is NULL):**
   - Check if price ≤ reference_price × (1 - %Drop)
   - If YES: Build complete arithmetic grid from ATH (quantized) and save to database
   - If NO: Continue waiting (avoids building during upward momentum)

3. **First Buy (Special Handling):**
   - When multiple grid levels are crossed on first candle
   - Execute **ONLY ONE BUY** regardless of levels crossed
   - Set `buy_anchor_price` to the execution price (quantized to tick size)
   - Rebuild grid using anchor price as new reference
   - **CRITICAL: Reset buy_index to 0** (not 1 - grid is completely new from anchor)

4. **Subsequent Buys (Normal Grid Trading):**
   - If multiple levels crossed: Execute ONE buy for combined amount
   - Continue using anchored grid for all remaining buys
   - Grid remains fixed from anchor for entire cycle

**Key points:**

- **First buy protection** prevents over-buying on sharp initial drops
- **Arithmetic anchoring** makes grid more realistic to actual market entry
- **Grid quantization** ensures all levels align with exchange tick size requirements
- **buy_index = 0** after grid rebuild ensures no levels are skipped
- **Average cost** (reference_price) is still used for sell triggers
- If price is at or below multiple levels (after first buy), execute **ONE** buy order for the **combined amount**
- Grid levels are trigger points - actual buy executes at current market price (with slippage guard)

### 3) Sell Reference (Weighted Average with Fees)

Maintain average cost per unit **including buy fees**:

```
avg_cost = cost_accum_usdt / btc_accum_net
where:
  cost_accum_usdt = Σ(total_usdt_paid)            // USDT actually paid
  btc_accum_net   = Σ(net_btc_received)           // BTC received after buy fees (CURRENT CYCLE ONLY)

IMPORTANT: btc_accum_net excludes dust from previous cycles to prevent reference price distortion
```

**Sell trigger price (gross threshold, fee handled by exchange netting):**

```
sell_threshold = avg_cost * (1 + %Rise)
```

- Sell fees are deducted from **USDT proceeds**; avg_cost already reflects buy-side fees via `btc_accum_net`.
- If you need a **net-of-sell-fee** target, apply:
  `sell_price_target = avg_cost * (1 + %Rise) / (1 - fee_sell)`.
- **Dust Exclusion**: Reference price calculation uses only current cycle BTC to maintain accurate cost basis.

### 4) Buy Amount Calculation

```
At cycle start:
buy_amount = floor_to_precision(InitialCapitalUSDT / MaxPurchases)

For each purchase:
if (purchases_remaining == 1):
    amount_to_buy = capital_available   // Use all remaining
else:
    amount_to_buy = buy_amount          // Fixed amount

Skip if amount_to_buy < max(MinBuyUSDT, exchange_minNotional)
```

### 5) Order Price Limits (Slippage Protection)

```
BUY ORDER:
limit_price_buy  = round_to_tick(Close * (1 + SlippageGuardBuyPct))

SELL ORDER:
limit_price_sell = round_to_tick(Close * (1 - SlippageGuardSellPct))

round_to_tick(price):
    return floor(price / tick_size) * tick_size
```

### 6) Profit Calculation (On Complete Sale Only)

```
principal_usdt = avg_cost * total_btc_sold
profit_usdt    = max(0, net_usdt_received - principal_usdt)
capital_available += principal_usdt + profit_usdt

IMPORTANT:
- Profit can NEVER be negative (use max(0, ...))
- Principal is based on avg_cost (not market price)
- Fees are already accounted for in net_usdt_received
```

### 7) Drift Detection (Safety Mechanism)

```
USDT Drift (insufficient funds only):
drift_usdt = max(0, (capital_available - USDT_SPOT) / max(capital_available, 1))

BTC Drift (must match EXACTLY):
drift_btc = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, 0.00000001)

if (drift_usdt >= 0.005 OR drift_btc >= 0.005):
    PAUSE STRATEGY
    SEND ALERT
```

---

## Execution Order

### Per Candle Close (STRICT ORDER)

1. **Update ATH (only when not holding)**

   ```
   if (btc_accumulated == 0 AND reference_price == 0):
       ath_price = compute_ATH(last_100_closed_candles)
       reference_price = ath_price  // Store ATH but DON'T build grid yet
       buy_grid = NULL  // Grid will be built on first trigger
       buy_index = 0
       // avg_cost is undefined until first buy; reference for sells comes from avg_cost
   ```

2. **Check SELL condition FIRST (when holding)**

   ```
   if (btc_accumulated > 0):
       sellThreshold = avg_cost * (1 + %Rise)
       if (Close >= sellThreshold):
           validate_btc_balance()
           check_drift()
           place_sell_order(quantity = btc_accumulated, price = limit_price_sell)
   ```

3. **Check BUY condition (when purchases remaining)**

   ```
   if (purchases_remaining > 0):
       // Build grid dynamically on first trigger if not yet built
       if (buy_grid == NULL AND reference_price > 0):
           first_trigger_level = reference_price * (1 - %Drop)
           if (Close <= first_trigger_level):
               buy_grid = build_arithmetic_grid(reference_price, %Drop, MaxPurchases)
               save_grid_to_database(buy_grid)
               buy_index = 0
           else:
               return  // Price not yet at first trigger level

       // Normal grid trading once grid exists
       if (buy_grid != NULL):
           next_level = buy_grid[buy_index]   // Level anchored to ATH
           if (Close <= next_level):
               validate_usdt_balance()
               check_drift()
               place_buy_order(amount = calculated_amount, price = limit_price_buy)
   ```

4. **Update state after order execution**

   ```
   if buy_executed:
       // Update accumulators (fees handled per exchange rules)
       cost_accum_usdt += quoteQty
       btc_accum_net   += filledQty - feeBTC  // Current cycle BTC only
       btc_accumulated = btc_accum_net + btc_dust  // Total including dust
       capital_available -= quoteQty

       // Recompute avg_cost for future sells (excludes dust)
       avg_cost = cost_accum_usdt / btc_accum_net

       // Advance to next buy level (grid remains anchored to ATH)
       purchases_remaining -= 1
       buy_index += 1
       status = "HOLDING"

   if sell_executed:
       if (btc_accumulated < min_sellable_qty):  // complete sale (with dust)
           principal = avg_cost * btc_sold_total
           profit    = max(0, netUSDTReceived - principal)
           capital_available += principal + profit

           // Reset cycle but preserve dust
           btc_dust = btc_accumulated  // Save remaining as dust
           btc_accum_net = 0  // Reset current cycle BTC
           cost_accum_usdt = 0  // Reset cost for clean tracking
           status = "READY"
   ```

---

## Critical Implementation Rules

### Cycle Management

1. **Delayed Grid Construction:** Grid is built only when price drops to first trigger level, not immediately.
2. **Grid Anchoring:** Buy grid levels are **fixed** from cycle ATH; never recomputed after buys.
3. **Grid Persistence:** Once built, grid is saved to database and remains for entire cycle.
4. **Sell Reference:** Sells compare **market price** against **avg_cost** (not ATH).
5. **No Partial Closure:** Cycle resets only when 100% of cycle BTC is sold.
6. **Capital Compounding:** Profits roll into next cycle's capital.

### Order Execution

1. **Order Type:** ALWAYS use `LIMIT IOC` (no market orders).
2. **Multiple Level Handling:** If price is at/below multiple grid levels, execute ONE buy for the combined amount.
3. **Validation Order:** balances → exchange rules → drift → place order.
4. **Partial Fills:** Count based on levels triggered, update accumulators accordingly.

### Fee Handling

1. **Buy Fees:** Deducted in BTC (net BTC received).
2. **Sell Fees:** Deducted in USDT (net proceeds).
3. **No Double Counting:** `quoteQty` already includes the full USDT spent.

### State Persistence

1. **Write-Before-Execute:** Persist state **before** placing orders.
2. **Atomicity:** Use transactions for multi-field updates.
3. **Recovery:** On restart, validate state consistency before trading.

### Error Handling

1. **Retry with Backoff:** 3 attempts, exponential backoff.
2. **Pause on Drift:** Immediately pause at ≥ 0.5% drift.
3. **Never Lose State:** Maintain consistency during errors.

---

## Complete Pseudocode Reference

```typescript
// Helper function for grid quantization
function quantizeToTick(price: number, tickSize: number = 0.01): number {
  return Math.floor(price / tickSize) * tickSize;
}

// Main trading loop - executes on each candle close
async function onCandleClose(candle: Candle): Promise<void> {
  // Step 1: Seed ATH only when not holding (DON'T build grid yet)
  if (state.btc_accumulated === 0 && state.reference_price === 0) {
    const last100 = await getLastNClosedCandles(100);
    state.reference_price = Math.max(...last100.map((c) => c.high));
    // Grid will be built dynamically on first trigger
    state.buy_grid = null;
    state.buy_index = 0;
  }

  // Step 2: SELL first (when holding)
  if (state.btc_accumulated > 0 && state.btc_accum_net > 0) {
    const avg_cost = state.cost_accum_usdt / state.btc_accum_net;
    const sellThreshold = avg_cost * (1 + config.rise_percentage);
    if (candle.close >= sellThreshold) {
      const limitPrice = roundToTick(
        candle.close * (1 - config.slippage_sell_pct),
      );
      await placeLimitIOCOrder({
        side: "SELL",
        quantity: state.btc_accumulated,
        price: limitPrice,
      });
      // handle fills, compute netUSDT, update accumulators, profit, reset, etc.
    }
  }

  // Step 3: BUY after (if capacity remains)
  if (state.purchases_remaining > 0) {
    // Build grid dynamically on first trigger if needed
    if (state.buy_grid === null && state.reference_price > 0) {
      const firstTriggerLevel = quantizeToTick(state.reference_price * (1 - config.drop_percentage));
      if (candle.close <= firstTriggerLevel) {
        // Build arithmetic buy grid anchored to reference_price (ATH)
        // Or use buy_anchor_price if this is a rebuild after first buy
        const basePrice = state.buy_anchor_price || state.reference_price;
        state.buy_grid = [];
        for (let n = 1; n <= config.max_purchases; n++) {
          const rawLevel = basePrice * (1 - n * config.drop_percentage);
          if (n * config.drop_percentage >= 1) break;
          const quantizedLevel = quantizeToTick(rawLevel); // Floor to tick size
          state.buy_grid.push(quantizedLevel);
        }
        state.buy_index = 0; // Always 0 when grid is built/rebuilt
        await saveGridToDatabase(state.buy_grid);
      } else {
        return; // Price not yet at first trigger level
      }
    }

    // Normal grid trading once grid exists
    if (state.buy_grid !== null && state.buy_index < state.buy_grid.length) {
      // Count how many levels price is at or below
      let levelsTriggered = 0;
      while (
        state.buy_index + levelsTriggered < state.buy_grid.length &&
        candle.close <= state.buy_grid[state.buy_index + levelsTriggered]
      ) {
        levelsTriggered++;
      }

    if (levelsTriggered > 0) {
      const limitPrice = roundToTick(
        candle.close * (1 + config.slippage_buy_pct),
      );

      // Calculate combined amount for all triggered levels
      let amountUSDT = 0;
      const baseAmount = Math.floor(
        state.initial_capital / config.max_purchases,
      );

      for (let i = 0; i < levelsTriggered; i++) {
        if (state.purchases_remaining - i === 1) {
          // Last purchase - use all remaining capital
          amountUSDT = state.capital_available;
          break;
        } else {
          amountUSDT += baseAmount;
        }
      }

      // Handle first buy special case
      const isFirstBuy = !state.buy_anchor_price;
      if (isFirstBuy && levelsTriggered > 1) {
        levelsTriggered = 1; // Limit to single level on first buy
      }

      // Execute ONE buy for combined amount
      await placeLimitIOCOrder({
        side: "BUY",
        quoteAmount: Math.min(amountUSDT, state.capital_available),
        price: limitPrice,
      });
      // handle fills:
      // - update cost_accum_usdt, btc_accum_net, btc_accumulated, capital_available
      // - recompute avg_cost
      // - If first buy: set buy_anchor_price, rebuild grid from anchor, reset buy_index = 0
      // - Otherwise: state.buy_index += levelsTriggered
      // - state.purchases_remaining -= levelsTriggered
    }
  }
}
```

---

## Testing Requirements

1. **ATH Calculation**
   - Max from 100 closed candles only
   - Excludes current unclosed candle
   - Recomputed only when not holding

2. **Arithmetic Buy Grid**
   - Levels match `ATH * (1 - n * %Drop)`
   - Grid remains fixed after buys
   - Stops at `MaxPurchases` or when `n*%Drop >= 1`
   - Only one buy per candle even if multiple levels were crossed

3. **Average Cost for Sells**
   - Correct after single & multiple buys (with buy-side fees)
   - Sell triggers at `avg_cost * (1 + %Rise)`
   - Profit computed as `max(0, netUSDT - avg_cost * btc_sold)`

4. **Cycle Reset**
   - Only after selling 100% of cycle BTC
   - Capital compounding correct
   - Rebuilds buy grid on next cycle

5. **Safety & Limits**
   - Drift checks before every order
   - Slippage guards applied
   - Exchange min/max constraints respected

---

## Balance Mismatch Handling

### Retry-on-Insufficient-Balance Strategy

**IMPORTANT: The bot now uses automatic retry with balance refresh instead of blocking on drift detection.**

When an order fails due to insufficient balance, the bot will:

1. **Refresh balance from exchange** - Get the latest available balance directly from Binance
2. **Calculate safe quantity** - Use minimum of available balance and intended amount
3. **Apply safety factor** - Use 99.5% of available balance to account for fees
4. **Generate unique clientOrderId** - Each retry gets a new ID for idempotency
5. **Retry with adjusted amount** - Place order with recalculated safe quantity

### Retry Configuration

```typescript
// Maximum retries specifically for balance errors
const MAX_BALANCE_RETRIES = 3;

// Safety factor to account for fees and rounding
const BALANCE_SAFETY_FACTOR = 0.995; // 99.5%

// Standard retry configuration (non-balance errors)
const MAX_STANDARD_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Exponential backoff applied
```

### Safe Quantity Calculation

**For Sell Orders (BTC):**

```typescript
// Refresh BTC balance from exchange
const btcBalance = await binanceClient.getBalance("BTC");
const availableBtc = btcBalance.free;

// Calculate safe sell quantity
const safeSellQty = Math.min(availableBtc * BALANCE_SAFETY_FACTOR, intendedQty);

// Quantize to exchange step size
const quantizedQty = Math.floor(safeSellQty / stepSize) * stepSize;

// Validate minimum constraints
if (quantizedQty < minQty || quantizedQty * currentPrice < minNotional) {
  // Skip order - amount too small to trade
  return;
}
```

**For Buy Orders (USDT):**

```typescript
// Refresh USDT balance from exchange
const usdtBalance = await binanceClient.getBalance("USDT");
const availableUsdt = usdtBalance.free;

// Calculate safe buy amount
const safeBuyAmount = Math.min(
  availableUsdt * BALANCE_SAFETY_FACTOR,
  intendedAmount,
);

// Validate minimum constraints
if (safeBuyAmount < minNotional) {
  // Skip order - amount too small to trade
  return;
}
```

### Error Detection Patterns

The bot recognizes insufficient balance errors through:

- Error message contains "insufficient balance"
- Error message contains "account has insufficient"
- Binance error code "-2010" (INSUFFICIENT_BALANCE)

### Retry Flow Example

```typescript
async function placeOrderWithRetry(orderParams) {
  let balanceRetryCount = 0;
  let standardRetryCount = 0;

  while (true) {
    try {
      // Generate unique clientOrderId for this attempt
      const clientOrderId = generateClientOrderId();

      // Place order
      const result = await binanceClient.createOrder({
        ...orderParams,
        clientOrderId,
      });

      return result;
    } catch (error) {
      if (
        isInsufficientBalanceError(error) &&
        balanceRetryCount < MAX_BALANCE_RETRIES
      ) {
        balanceRetryCount++;

        // Refresh balance and recalculate
        const freshBalance = await refreshBalance();
        orderParams = recalculateOrderParams(freshBalance);

        continue; // Retry immediately with fresh balance
      }

      if (
        isRetryableError(error) &&
        standardRetryCount < MAX_STANDARD_RETRIES
      ) {
        standardRetryCount++;
        await sleep(RETRY_DELAY_MS * Math.pow(2, standardRetryCount));
        continue;
      }

      throw error; // Non-retryable or max retries reached
    }
  }
}
```

### Fills-Based Reconciliation

After successful order execution, the bot uses fills data for precise state updates:

```typescript
// Use fills data for exact reconciliation
const totalBtcReceived = fills.reduce(
  (sum, fill) => sum + parseFloat(fill.qty),
  0,
);

const totalUsdtPaid = fills.reduce(
  (sum, fill) => sum + parseFloat(fill.qty) * parseFloat(fill.price),
  0,
);

const totalFeesBtc = fills.reduce(
  (sum, fill) =>
    fill.commissionAsset === "BTC" ? sum + parseFloat(fill.commission) : sum,
  0,
);

// Update state with exact values
state.btc_accum_net += totalBtcReceived - totalFeesBtc;
state.cost_accum_usdt += totalUsdtPaid;
```

### Key Benefits

1. **No blocking on drift** - Trading continues even with temporary balance mismatches
2. **Automatic recovery** - Self-corrects transient balance issues
3. **Precise accounting** - Uses fills data for exact state tracking
4. **Idempotent retries** - Unique clientOrderId prevents duplicate orders
5. **Safety margins** - 99.5% factor prevents edge case failures

## Important Notes

1. **Spot only** — no leverage, no futures.
2. **Single active cycle** per symbol/timeframe.
3. **Respect exchange limits** — `minNotional`, `tickSize`, `stepSize`.
4. **Fees** — BUY in BTC, SELL in USDT (0.1% default unless configured).

---

## Change Log

- **2025-09-24 — Retry-on-Insufficient-Balance Strategy**
  - **NEW STRATEGY**: Replaced drift detection blocking with automatic retry on insufficient balance
  - **BALANCE REFRESH**: Orders retry with fresh balance from exchange on INSUFFICIENT_BALANCE errors
  - **SAFE CALCULATION**: Uses min(available_balance, intended_amount) \* 0.995 for safety
  - **IDEMPOTENT RETRIES**: Unique clientOrderId generated for each retry attempt
  - **FILLS RECONCILIATION**: Precise state updates using fills data from executed orders
  - **NO BLOCKING**: Trading continues even with temporary balance mismatches
  - Maximum 3 retries for balance-specific errors with immediate retry (no delay)
  - Standard retryable errors still use exponential backoff

- **2025-09-22 — ATH Window Made Configurable**
  - **CONFIGURATION CHANGE**: ATH window is now configurable via database (10-500 range)
  - Default value: 20 candles (can be adjusted per deployment requirements)
  - Migration added to support configuration in strategy_config table
  - Allows optimization based on market conditions and timeframe
  - Production currently using 25 candles

- **2025-09-19 — Dust Separation Implementation**
  - **NEW FIELD**: Added btc_dust to track dust separately from current cycle BTC
  - **REFERENCE PRICE FIX**: Reference price now calculated using btc_accum_net (excludes dust)
  - **DATABASE MIGRATION**: Added btc_dust column to cycle_state table
  - Prevents dust from artificially lowering reference price
  - Ensures accurate cost basis for sell triggers
  - btc_accumulated = btc_accum_net + btc_dust (total BTC)
  - btc_accum_net tracks only current cycle BTC for clean reference price

- **2025-09-26 — Arithmetic Anchoring Strategy Bug Fixes**
  - **CRITICAL FIX**: Changed buy_index from 1 to 0 after grid rebuild from anchor
  - **GRID QUANTIZATION**: Added proper tick size quantization (floor to 0.01) for all grid levels
  - **ENHANCED LOGGING**: Added detailed reference price calculation logging showing cost_accum_usdt, btc_accum_net, and formula
  - **DISCORD NOTIFICATIONS**: Added sell threshold and gap to trigger percentage in buy notifications
  - Bug prevented: Grid levels were not properly below anchor price, causing immediate re-buys
  - All grid levels now properly quantized to exchange tick size requirements

- **2025-09-26 — Arithmetic Anchoring Strategy Implementation**
  - **NEW FEATURE**: First buy now limited to single level to prevent over-buying
  - **ANCHORING**: Grid rebuilds from first buy execution price (buy_anchor_price)
  - After first buy, grid uses anchor price: `P_n = P_anchor × (1 - n × %Drop)`
  - Subsequent buys can still trigger multiple levels (combined amount)
  - Prevents excessive capital deployment on sharp initial drops
  - Makes grid more realistic by anchoring to actual market entry point
  - Sell logic unchanged - still uses average cost (reference_price)

- **2025-01-15 — ATH Window Correction and Fee Calculation Fix**
  - **CRITICAL FIX**: Changed ATH_WINDOW from 20 to 100 candles for better trend detection
  - **FEE FIX**: Corrected buy fee calculation - fees are NOT added to cost_accum_usdt
  - Buy fees reduce BTC received (denominator), not added to USDT cost (numerator)
  - This prevents double-counting of fees in average cost calculation
  - Documentation updated to clarify reference_price vs avg_cost distinction

- **2025-09-15 — Dust Handling and Minimum Trading Constraints**
  - Added comprehensive dust handling strategy to preserve unsold BTC across cycles
  - Dust (BTC below minimum sellable quantity) is now preserved in btc_accumulated
  - Implemented minimum notional validation ($5.00 minimum order value)
  - Bot fetches live trading constraints from Binance on startup
  - Dust accumulates until it reaches sellable amount, ensuring no profit loss
  - Updated cycle reset logic to preserve dust for next cycle

- **2025-09-13 — Delayed Grid Construction Implementation**
  - Grid is now built **dynamically** when price first drops to trigger level (ATH × (1 - %Drop))
  - ATH is stored as `reference_price` on cycle start but grid remains NULL until needed
  - Prevents grid creation during upward price momentum
  - Grid is persisted to database once built (buy_grid array, buy_index tracking)
  - Grid remains fixed for entire cycle once constructed

- **2025-09-12 — Buy Reference Updated to Arithmetic from ATH**
  - All **buy triggers** now use an **arithmetic grid anchored to cycle ATH**: `P_n = ATH * (1 - n * %Drop)`.
  - Buy levels **no longer** use weighted average cost and **do not shift** after each buy.
  - **Sell logic unchanged**: uses **average cost (with buy fees)** as reference, `sell ≥ avg_cost * (1 + %Rise)`.
  - **Multiple level handling**: If price triggers multiple grid levels, execute ONE buy for the combined amount.
  - Pseudocode, execution order, and tests updated accordingly.
