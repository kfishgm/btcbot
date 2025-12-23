# 📘 STRATEGY_V2_DUAL_MODE.md

## TriBot Buy Engine v2  
**Dual Buy Mode: Arithmetic + Geometric Modified (geo_mod)**

---

## 1. Purpose

This document is the **single source of truth** for TriBot buy logic going forward.

It consolidates:
- The **existing arithmetic grid strategy** (unchanged)
- The **new geometric modified strategy (geo_mod)**

Both modes coexist under a single engine via `buy_mode`.

---

## 2. High-Level Principle

TriBot implements **one strategy** with **two buy modes**:

| Mode | Description |
|----|----|
| `arithmetic` | Fixed grid from ATH, multi-level buys |
| `geom_modified` | Dynamic threshold anchored to last buy, 1 buy per candle |

Sell logic, fees, dust, and capital management are **shared and unchanged**.

---

## 3. StrategyConfig Contract

```ts
type BuyMode = "arithmetic" | "geom_modified";

interface StrategyConfig {
  buy_mode?: BuyMode; // default: "arithmetic"
  drop_pct: number;
  tp_pct: number;
  max_compras: number;
  timeframe: "4H" | "1D" | "1W";
}
```

Backward compatible: missing `buy_mode` defaults to `arithmetic`.

---

## 4. CycleState v2

```ts
interface CycleState {
  state_version: 2;

  // shared
  capital_available: number;
  btc_accum_net: number;
  btc_dust: number;
  avg_cost: number;

  // arithmetic only
  buy_grid?: number[];
  buy_index?: number;

  // geom_modified only
  p_last_buy?: number | null;
}
```

---

## 5. Buy Engine Dispatch

```ts
switch (config.buy_mode) {
  case "arithmetic":
    return arithmeticBuyEngine(...);

  case "geom_modified":
    return geomModifiedBuyEngine(...);
}
```

---

## 6. Buy Logic — Arithmetic Mode (UNCHANGED)

- Grid built from ATH
- Grid delayed until first trigger
- First buy anchors grid
- Multi-level buys allowed
- buy_index advances normally

⚠️ Any behavior change here is a **regression bug**.

---

## 7. Buy Logic — Geometric Modified Mode

### Core Rules

- No grid
- Max **1 buy per candle**
- Threshold recalculated from **last buy price**
- ATH used only for the **first trigger**
- Execution only on **closed candles**

---

### Exact Logic

#### First Buy (from ATH)

```ts
if (p_last_buy == null) {
  threshold = ATH * (1 - drop_pct);
  if (close <= threshold) {
    executeBuy(close);
    p_last_buy = close;
  }
}
```

#### Subsequent Buys

```ts
threshold = p_last_buy * (1 - drop_pct);
if (close <= threshold) {
  executeBuy(close);
  p_last_buy = close;
}
```

---

## 8. Sell Logic (Shared)

- Sell only if `close >= avg_cost * (1 + tp_pct)`
- Full position exit
- Dust handled per existing rules

---

## 9. Database Migration

```sql
ALTER TABLE strategy_config
ADD COLUMN buy_mode TEXT DEFAULT 'arithmetic';

ALTER TABLE cycle_state
ADD COLUMN p_last_buy NUMERIC NULL,
ADD COLUMN state_version INT DEFAULT 2;
```

---

## 10. Backtester Requirements

- Support `buy_mode`
- Enforce `one_fill_per_candle` for geo_mod
- Arithmetic results must remain identical
- geo_mod must produce different curves (expected)

---

## 11. Mandatory Tests

### geo_mod Unit Tests
- Deep gap → single buy
- Dynamic threshold behavior
- Max 1 buy per candle
- max_compras respected

### Regression
- Arithmetic unchanged

### Integration
- Both modes run in parallel
- Sell logic identical
- State integrity preserved

---

## 12. Acceptance Criteria

Implementation is **NOT DONE** if:
- Arithmetic behavior changes
- geo_mod allows multi-buys per candle
- Grid logic leaks into geo_mod
- Tests are missing
- Backtesting fails

---

## 13. Final Note

This architecture:
- Preserves all existing behavior
- Enables A/B testing
- Allows future buy modes
- Avoids technical debt

This is the **canonical strategy specification** for TriBot v2.
