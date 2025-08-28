# BTC Trading Bot MVP - Product Requirements Document

## Document Usage Guide for PM Subagent

This PRD is structured for autonomous development using Claude Code. To create GitHub issues:
1. Start with Priority 1 stories (must be completed first)
2. Each story has explicit acceptance criteria for testing
3. Use story points for sprint planning (velocity ~20 pts/week)
4. BDD tests in Section 4 map directly to acceptance criteria
5. Appendix A contains exact implementation formulas - reference in tickets

**Key Sections for PM:**
- Section 3: User Stories (create GitHub issues from these)
- Section 4: BDD Tests (acceptance criteria details)
- Section 6: Story Prioritization Guide (dependency graph)
- Section 7: Development Phases (sprint planning)

## 1. Executive Summary

### Product Vision
A automated BTC/USDT spot trading bot for Binance that implements a DCA (Dollar Cost Averaging) strategy with profit-taking, designed for single-user operation.

### MVP Scope
- Single user (no authentication)
- One trading pair (BTC/USDT)
- One timeframe (configurable, e.g., 4H)
- Automated buy-on-dip, sell-on-rise strategy
- Real money trading on Binance International

## 2. Technical Stack

- **Runtime**: Node.js 20 LTS
- **Language**: TypeScript
- **Database**: Supabase Cloud (PostgreSQL with free tier)
- **Exchange**: Binance International (Spot trading only)
- **Testing**: Jest with BDD-style
- **Deployment**: AWS App Runner (production), Local with Docker (development)
- **Monitoring**: Discord webhooks for notifications

## 3. User Stories (Prioritized with Dependencies)

### Priority 1: Foundation (Must be completed first)
**US-001: Initialize Trading Bot**
- **As a** trader
- **I want** the bot to initialize with default configuration on first run
- **So that** I can start trading without manual database setup
- **Acceptance Criteria:**
  - Creates default strategy_config if none exists
  - Creates initial cycle_state with READY status
  - Validates Binance API connectivity
  - Confirms minimum USDT balance (≥ InitialCapitalUSDT)
- **Dependencies:** None
- **Story Points:** 3

**US-002: Connect to Binance WebSocket**
- **As a** trader
- **I want** the bot to maintain a stable connection to Binance streams
- **So that** I receive real-time price updates
- **Acceptance Criteria:**
  - Connects to kline/candlestick stream for configured timeframe
  - Auto-reconnects within 10 seconds on disconnection
  - Falls back to REST API if WebSocket fails repeatedly
  - Validates data integrity (timestamps, OHLCV values)
- **Dependencies:** US-001
- **Story Points:** 5

### Priority 2: Core Trading Logic
**US-003: Calculate Dynamic ATH**
- **As a** trader
- **I want** the bot to track the 20-candle ATH
- **So that** I have a reference price when not holding
- **Acceptance Criteria:**
  - Maintains rolling window of last 20 closed candles
  - Updates ATH on each new candle close
  - Only uses ATH when btc_accumulated == 0
  - Handles edge case of < 20 candles available
- **Dependencies:** US-002
- **Story Points:** 3

**US-004: Execute Buy Orders**
- **As a** trader
- **I want** the bot to buy BTC when price drops below threshold
- **So that** I accumulate during dips
- **Acceptance Criteria:**
  - Triggers when Close ≤ reference_price * (1 - %Drop)
  - Validates sufficient USDT balance
  - Places LIMIT IOC order with slippage protection
  - Updates reference_price to weighted average after fill
  - Correctly handles partial fills
  - Tracks fees in both base and quote currencies
- **Dependencies:** US-002, US-003
- **Story Points:** 8

**US-005: Execute Sell Orders**
- **As a** trader
- **I want** the bot to sell accumulated BTC when price rises
- **So that** I take profits systematically
- **Acceptance Criteria:**
  - Triggers when Close ≥ reference_price * (1 + %Rise)
  - Only sells BTC from current cycle
  - Places LIMIT IOC order with slippage protection
  - Calculates profit correctly including all fees
  - Resets cycle only on 100% sale
  - Handles partial fills without closing cycle
- **Dependencies:** US-004
- **Story Points:** 8

### Priority 3: Safety & Monitoring
**US-006: Implement Drift Detection**
- **As a** trader
- **I want** the bot to detect balance discrepancies
- **So that** I'm protected from calculation errors
- **Acceptance Criteria:**
  - Checks drift before every order
  - Pauses if USDT drift ≥ 0.5%
  - Pauses if BTC drift ≥ 0.5%
  - Sends Discord alert on pause
  - Logs detailed drift information
- **Dependencies:** US-004, US-005
- **Story Points:** 5

**US-007: Send Discord Notifications**
- **As a** trader
- **I want** to receive Discord notifications for all events
- **So that** I can monitor bot activity remotely
- **Acceptance Criteria:**
  - Notifies on successful trades (buy/sell)
  - Alerts on errors and pauses
  - Includes relevant details (price, amount, profit)
  - Rate limits notifications (max 1 per second)
  - Handles Discord webhook failures gracefully
- **Dependencies:** US-001
- **Story Points:** 3

### Priority 4: Robustness
**US-008: Handle Exchange Errors**
- **As a** trader
- **I want** the bot to gracefully handle API failures
- **So that** temporary issues don't crash the bot
- **Acceptance Criteria:**
  - Implements exponential backoff retry (3 attempts)
  - Distinguishes between retryable and fatal errors
  - Maintains state consistency during retries
  - Logs all error details
  - Pauses on repeated failures
- **Dependencies:** US-004, US-005
- **Story Points:** 5

**US-009: Persist State Changes**
- **As a** trader
- **I want** all state changes saved immediately
- **So that** I can recover from crashes
- **Acceptance Criteria:**
  - Saves to database before order execution
  - Uses transactions for atomic updates
  - Validates state on startup
  - Handles database connection failures
  - Implements write-ahead logging pattern
- **Dependencies:** US-001
- **Story Points:** 5

## 4. BDD Test Specifications

### 4.1 Strategy Core Tests

```typescript
describe('Trading Strategy Core', () => {
  describe('ATH Calculation', () => {
    it('should calculate ATH from last 20 closed candles', () => {});
    it('should update ATH when new candle closes', () => {});
    it('should handle less than 20 candles gracefully', () => {});
    it('should only use ATH when btc_accumulated equals zero', () => {});
    it('should exclude current unclosed candle from ATH', () => {});
  });

  describe('Reference Price Calculation', () => {
    it('should equal ATH when no purchases made', () => {});
    it('should calculate weighted average including fees after first buy', () => {});
    it('should update correctly after multiple purchases', () => {});
    it('should account for base currency fees in calculation', () => {});
    it('should account for quote currency fees in calculation', () => {});
  });

  describe('Buy Amount Determination', () => {
    it('should divide initial capital equally by max purchases',() => {});
    it('should maintain fixed amount for all but last purchase', () => {});
    it('should use all remaining capital for last purchase', () => {});
    it('should skip last purchase if below MinBuyUSDT', () => {});
    it('should skip purchase if below exchange minNotional', () => {});
  });
});

describe('Buy Order Execution', () => {
  describe('When price drops below threshold', () => {
    it('should trigger buy when Close <= reference_price * (1 - %Drop)', () => {});
    it('should not trigger if purchases_remaining is zero', () => {});
    it('should not trigger if insufficient USDT balance', () => {});
    it('should not trigger if drift exceeds 0.5%', () => {});
  });

  describe('Order Placement', () => {
    it('should place LIMIT IOC order type', () => {});
    it('should add slippage protection to limit price', () => {});
    it('should round price to exchange tick size', () => {});
    it('should round quantity to exchange step size', () => {});
    it('should validate against minimum notional value', () => {});
  });

  describe('After Successful Buy', () => {
    it('should decrease capital_available by exact USDT spent', () => {});
    it('should increase btc_accumulated by net BTC received', () => {});
    it('should update cost_accum_usdt with fees included', () => {});
    it('should recalculate reference_price as weighted average', () => {});
    it('should decrease purchases_remaining by one', () => {});
    it('should change status from READY to HOLDING', () => {});
    it('should persist all state changes to database', () => {});
  });

  describe('Partial Fill Handling', () => {
    it('should process partial fills correctly', () => {});
    it('should update quantities based on actual filled amount', () => {});
    it('should still count as one purchase used', () => {});
  });
});

describe('Sell Order Execution', () => {
  describe('When price rises above threshold', () => {
    it('should trigger sell when Close >= reference_price * (1 + %Rise)', () => {});
    it('should only trigger if btc_accumulated > 0', () => {});
    it('should not trigger if BTC balance insufficient', () => {});
    it('should not trigger if drift exceeds 0.5%', () => {});
  });

  describe('Order Placement', () => {
    it('should attempt to sell ALL btc_accumulated', () => {});
    it('should never sell BTC not from current cycle', () => {});
    it('should place LIMIT IOC order type', () => {});
    it('should apply slippage protection to limit price', () => {});
  });

  describe('Complete Sale (100% filled)', () => {
    it('should calculate principal as reference_price * btc_sold', () => {});
    it('should calculate profit as received_usdt - fees - principal', () => {});
    it('should set profit to zero if calculation is negative', () => {});
    it('should add principal + profit to capital_available', () => {});
    it('should reset btc_accumulated to zero', () => {});
    it('should reset purchases_remaining to MaxPurchases', () => {});
    it('should reset cost accumulators to zero', () => {});
    it('should set reference_price back to ATH', () => {});
    it('should change status from HOLDING to READY', () => {});
    it('should calculate new buy_amount from new capital', () => {});
  });

  describe('Partial Sale Handling', () => {
    it('should reduce btc_accumulated by amount sold', () => {});
    it('should NOT reset cycle on partial sale', () => {});
    it('should NOT reset purchases_remaining', () => {});
    it('should keep same reference_price', () => {});
    it('should attempt to sell remainder on next candle', () => {});
  });
});

describe('Drift Detection', () => {
  describe('USDT Balance Drift', () => {
    it('should calculate drift as |actual - expected| / expected', () => {});
    it('should pause strategy if drift >= 0.5%', () => {});
    it('should check before every buy order', () => {});
    it('should send Discord alert when pausing', () => {});
  });

  describe('BTC Balance Drift', () => {
    it('should calculate drift correctly for BTC', () => {});
    it('should pause strategy if drift >= 0.5%', () => {});
    it('should check before every sell order', () => {});
    it('should use satoshi as minimum divisor', () => {});
  });
});

describe('Cycle Management', () => {
  describe('Cycle Initialization', () => {
    it('should start with status READY', () => {});
    it('should set capital_available to InitialCapitalUSDT', () => {});
    it('should set purchases_remaining to MaxPurchases', () => {});
    it('should set btc_accumulated to zero', () => {});
  });

  describe('Within Cycle', () => {
    it('should maintain cycle through multiple buys', () => {});
    it('should maintain cycle through partial sells', () => {});
    it('should track all fees cumulatively', () => {});
  });

  describe('Cycle Completion', () => {
    it('should only complete on 100% BTC sale', () => {});
    it('should compound profits into next cycle', () => {});
    it('should increase buy amounts if capital grew', () => {});
    it('should decrease buy amounts if capital shrunk', () => {});
  });
});

describe('Edge Cases and Error Scenarios', () => {
  describe('Insufficient Funds', () => {
    it('should skip buy if USDT balance too low', () => {});
    it('should skip last buy if amount below minimum', () => {});
    it('should handle zero capital_available gracefully', () => {});
  });

  describe('API Failures', () => {
    it('should retry failed orders with exponential backoff', () => {});
    it('should pause after 3 consecutive failures', () => {});
    it('should not lose state during retries', () => {});
  });

  describe('Invalid Market Data', () => {
    it('should reject candles with invalid timestamps', () => {});
    it('should reject candles with zero or negative prices', () => {});
    it('should handle missing candles in ATH calculation', () => {});
  });

  describe('Startup Recovery', () => {
    it('should recover state from database on restart', () => {});
    it('should validate recovered state for consistency', () => {});
    it('should resume from exact point of interruption', () => {});
  });
});

describe('Integration Tests', () => {
  describe('Complete Trading Cycle', () => {
    it('should execute full cycle: 3 buys, 1 sell, reset', () => {});
    it('should handle real Binance testnet orders', () => {});
    it('should correctly account for actual exchange fees', () => {});
  });

  describe('24-Hour Operation', () => {
    it('should maintain WebSocket connection for 24 hours', () => {});
    it('should handle Binance maintenance windows', () => {});
    it('should not leak memory over extended operation', () => {});
  });
});
```

### 4.2 Test Data Requirements

```typescript
// Test fixtures needed
interface TestFixtures {
  mockCandles: {
    trending_up: Candle[];      // 20 candles with rising prices
    trending_down: Candle[];     // 20 candles with falling prices
    volatile: Candle[];          // High volatility test data
    edge_cases: Candle[];        // Gaps, zero volume, etc.
  };
  
  mockOrders: {
    full_fill: OrderResult;      // 100% filled order
    partial_fill: OrderResult;   // 50% filled order
    no_fill: OrderResult;        // 0% filled (cancelled)
  };
  
  mockBalances: {
    sufficient: Balance;         // Enough for all operations
    insufficient: Balance;       // Too low for operations
    with_drift: Balance;         // Has drift > 0.5%
  };
}
```

### 4.1 Strategy Engine
- Monitor BTC/USDT price on configured timeframe (e.g., 4H candles)
- Calculate dynamic ATH from 20-candle moving window
- Execute buys when price drops below reference_price * (1 - %Drop)
- Execute sells when price rises above reference_price * (1 + %Rise)
- Track cycle state (READY, HOLDING, PAUSED)
- Implement slippage protection on all orders

### 4.2 Order Management
- Place LIMIT IOC (Immediate-Or-Cancel) orders only
- Validate against Binance trading rules (minNotional, stepSize, tickSize)
- Handle partial fills correctly
- Track fees in both base (BTC) and quote (USDT) currencies

### 4.3 Capital Management
- Track capital_available (USDT not invested)
- Track btc_accumulated (BTC from current cycle only)
- Calculate weighted average reference_price including fees
- Implement drift detection (pause if balance deviation > 0.5%)

### 4.4 Error Handling
- Automatic retry with exponential backoff for API failures
- Pause strategy on critical errors
- Maintain state consistency across restarts
- Log all decisions and errors

### 4.5 Initial Setup
- On first run, create default configuration in database
- Initialize cycle state with status 'READY'
- Validate Binance API connectivity
- Verify minimum balance requirements

## 5. Non-Functional Requirements

### 5.1 Performance
- Process candle closes within 1 second
- Handle Binance API rate limits (weight: 1200/min, orders: 10/sec)
- Reconnect WebSocket streams automatically

### 5.2 Reliability
- Persist all state changes to database immediately
- Recover from crashes without losing cycle state
- Validate database state on startup

### 5.3 Security
- Binance API keys in environment variables (local) / AWS Secrets Manager (production)
- Supabase connection string in environment variables (includes SSL)
- No exposed endpoints (internal operation only)

## 6. Database Schema

```sql
-- Strategy configuration (single row for MVP)
CREATE TABLE strategy_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeframe TEXT NOT NULL, -- '1h', '4h', etc.
  drop_percentage DECIMAL(5,4) NOT NULL, -- 0.0200 to 0.0800
  rise_percentage DECIMAL(5,4) NOT NULL, -- 0.0200 to 0.0800
  max_purchases INTEGER NOT NULL, -- 1 to 30
  min_buy_usdt DECIMAL(20,8) NOT NULL, -- >= 10.00
  initial_capital_usdt DECIMAL(20,8) NOT NULL,
  slippage_buy_pct DECIMAL(5,4) DEFAULT 0.0030,
  slippage_sell_pct DECIMAL(5,4) DEFAULT 0.0030,
  is_active BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Current cycle state
CREATE TABLE cycle_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL, -- 'READY', 'HOLDING', 'PAUSED'
  capital_available DECIMAL(20,8) NOT NULL,
  btc_accumulated DECIMAL(20,8) DEFAULT 0,
  purchases_remaining INTEGER NOT NULL,
  reference_price DECIMAL(20,8),
  cost_accum_usdt DECIMAL(20,8) DEFAULT 0,
  btc_accum_net DECIMAL(20,8) DEFAULT 0,
  ath_price DECIMAL(20,8),
  buy_amount DECIMAL(20,8),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Trade history
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID REFERENCES cycle_state(id),
  type TEXT NOT NULL, -- 'BUY', 'SELL'
  order_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'FILLED', 'PARTIAL', 'CANCELLED'
  price DECIMAL(20,8) NOT NULL,
  quantity DECIMAL(20,8) NOT NULL,
  quote_quantity DECIMAL(20,8) NOT NULL,
  fee_asset TEXT,
  fee_amount DECIMAL(20,8),
  executed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- System events for monitoring
CREATE TABLE bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- 'START', 'STOP', 'ERROR', 'DRIFT_HALT', etc.
  severity TEXT NOT NULL, -- 'INFO', 'WARNING', 'ERROR'
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 7. Development Phases (Story-Based Sprints)

### Sprint 1: Foundation & Infrastructure (Week 1)
**Goal:** Establish project base and core connectivity
- [ ] **US-001**: Initialize Trading Bot (3 pts)
  - Database migrations via Supabase CLI
  - Configuration management
  - Startup validation
- [ ] **US-002**: Connect to Binance WebSocket (5 pts)
  - WebSocket client with auto-reconnect
  - REST API fallback
  - Data validation
- [ ] **Setup**: Project structure, TypeScript, Jest, Docker
- [ ] **Setup**: BDD test framework and fixtures

### Sprint 2: Core Trading Logic (Week 2)
**Goal:** Implement buy/sell decision engine
- [ ] **US-003**: Calculate Dynamic ATH (3 pts)
- [ ] **US-004**: Execute Buy Orders (8 pts)
  - Order validation
  - Fee tracking
  - State updates
- [ ] **US-005**: Execute Sell Orders (8 pts)
  - Profit calculation
  - Cycle reset logic

### Sprint 3: Safety & Monitoring (Week 3)
**Goal:** Add protection mechanisms and visibility
- [ ] **US-006**: Implement Drift Detection (5 pts)
- [ ] **US-007**: Send Discord Notifications (3 pts)
- [ ] **US-008**: Handle Exchange Errors (5 pts)
- [ ] **US-009**: Persist State Changes (5 pts)

### Sprint 4: Testing & Production (Week 4)
**Goal:** Comprehensive testing and deployment
- [ ] Complete BDD test suite (>90% coverage)
- [ ] Integration tests with Binance Testnet
- [ ] Docker containerization
- [ ] AWS App Runner deployment
- [ ] Production configuration & secrets
- [ ] Operational runbook & documentation

### Backlog (Post-MVP)
- [ ] Web dashboard for monitoring
- [ ] Historical performance analytics
- [ ] Multiple timeframe support
- [ ] Additional trading pairs
- [ ] Tax reporting exports

## 8. Testing Strategy

### BDD Test Structure (Jest)
```typescript
describe('Trading Bot Strategy', () => {
  describe('When price drops below threshold', () => {
    it('should place a buy order with correct amount', () => {});
    it('should update reference price after successful buy', () => {});
    it('should respect maximum purchases limit', () => {});
  });
  
  describe('When price rises above threshold', () => {
    it('should sell all accumulated BTC from cycle', () => {});
    it('should calculate profit correctly including fees', () => {});
    it('should reset cycle after complete sale', () => {});
  });
});
```

### Test Coverage Requirements
- Unit tests for all calculations (reference price, ATH, profits)
- Integration tests for Binance API interactions
- End-to-end tests for complete trading cycles
- Error scenario testing (API failures, partial fills, drift)

## 9. Success Metrics

- Bot runs 24/7 without manual intervention
- All trades execute within strategy parameters
- Correct profit calculations and capital compounding
- Zero loss of funds due to bugs
- Complete audit trail of all decisions

## 10. Out of Scope for MVP

- Multiple users / authentication
- Multiple trading pairs
- Multiple simultaneous strategies
- Web frontend
- Historical performance analytics
- Tax reporting
- Paper trading mode

## 11. Configuration Example

```typescript
// Default configuration created on first run
{
  timeframe: '4h',  // Default, configurable via database
  drop_percentage: 0.03,  // 3%
  rise_percentage: 0.03,  // 3%
  max_purchases: 3,
  min_buy_usdt: 10.00,
  initial_capital_usdt: 300.00,
  slippage_buy_pct: 0.003,  // 0.3%
  slippage_sell_pct: 0.003,  // 0.3%
  is_active: false  // Must be manually activated after setup
}
```

## 12. Environment Variables

```bash
# Local Development (.env)
NODE_ENV=development
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
BINANCE_API_KEY=your-api-key
BINANCE_API_SECRET=your-api-secret
DISCORD_WEBHOOK_URL=your-discord-webhook

# Production (AWS Secrets Manager)
# Same variables stored securely in AWS
```

## 13. Risk Acknowledgments

- This bot trades with real money on Binance
- Market conditions can result in losses
- Technical failures could impact trading
- Requires continuous monitoring despite automation

## 14. Cost Considerations

**Estimated Monthly Costs:**
- **Supabase**: Free tier (up to 500MB database, 2GB bandwidth)
- **AWS App Runner**: ~$5-10/month (0.25 vCPU, 0.5 GB memory)
- **AWS Secrets Manager**: ~$0.40/month per secret
- **Total**: ~$6-11/month

---

## Appendix A: Detailed Strategy Specification

*The following technical specification provides implementation-level details for the trading strategy. All formulas, calculations, and logic flows described here must be implemented exactly as specified.*

### Strategy Parameters

**Configurable**  
- `timeframe`: e.g., 4H  
- `%Drop` (0.02–0.08 suggested): drop threshold vs `reference_price` to buy  
- `%Rise` (0.02–0.08 suggested): rise threshold vs `reference_price` to sell  
- `MaxPurchases` (1..30): maximum purchases per cycle  
- `MinBuyUSDT` (≥ 10.00): minimum per purchase  
- `InitialCapitalUSDT`: initial capital allocated to cycle  
- `SlippageGuardBuyPct` / `SlippageGuardSellPct`: 0.30% default

**Constants**  
- `ATH_WINDOW = 20` candles (moving window)  
- `DriftHaltThresholdPct = 0.5%` (strict stop for capital deviation)

### Core Formulas

#### Dynamic ATH (moving window)
```
ATH(N) = max(High[i]) for i in the last N CLOSED candles
```

#### Reference Price (weighted average with fees)
```
reference_price = cost_accum_usdt / btc_accum_net
cost_accum_usdt = Σ(usdt_fill + fee_quote + fee_base * fill_price)
btc_accum_net   = Σ(btc_fill - fee_base)
```

#### Buy Amount Calculation
```
// At cycle start
buy_amount = floor_to_precision( InitialCapitalUSDT / MaxPurchases )

// Last purchase uses all remaining capital if valid
```

#### Trading Conditions (evaluated at candle close)
```
// BUY
If Close ≤ reference_price * (1 - %Drop) AND purchases_remaining > 0 → Buy

// SELL (only cycle BTC)
If btc_accumulated > 0 AND Close ≥ reference_price * (1 + %Rise) → Sell ALL
```

#### Order Price Limits (slippage protection)
```
limit_price_buy  = round_to_tick( Close * (1 + SlippageGuardBuyPct) )
limit_price_sell = round_to_tick( Close * (1 - SlippageGuardSellPct) )
```

#### Profit Calculation (on complete sale)
```
principal_usdt = reference_price * total_btc_sold
profit_usdt    = max(0, net_usdt_received - principal_usdt)
capital_available = capital_available + principal_usdt + profit_usdt
```

#### Drift Detection
```
drift_usdt = |USDT_SPOT - capital_available| / max(capital_available, 1)
drift_btc  = |BTC_SPOT - btc_accumulated| / max(btc_accumulated, satoshi)
If either ≥ 0.5% → PAUSE strategy
```

### Execution Order (per candle)

1. If `btc_accumulated == 0` → recalculate ATH, set `reference_price = ATH`
2. Check SELL condition first (if holding BTC)
3. Check BUY condition after (if purchases remaining)
4. Update accumulators and reference price
5. If sold 100% → reset cycle

### Critical Implementation Rules

1. **Cycle Isolation**: Each cycle tracks its own BTC separately
2. **No Partial Closure**: Cycle only resets when 100% of BTC sold
3. **Fee Accounting**: Track fees in both base and quote currencies
4. **Order Type**: Always use LIMIT IOC (Immediate-Or-Cancel)
5. **Validation Order**: Check balance, validate exchange rules, then place order
6. **State Persistence**: Save state after every change before proceeding

### Pseudocode Reference

```typescript
onCloseCandle():
  // 1) Dynamic ATH if no positions
  if (btc_accumulated == 0):
    ath_price = compute_ATH(last_20_closed_candles)
    reference_price = ath_price

  // 2) SELL first - ONLY CYCLE BTC
  if (btc_accumulated > 0 && Close >= reference_price * (1 + pct_rise)):
    validateBalance(BTC_SPOT >= btc_accumulated)
    validateDrift(drift_btc < 0.005)
    
    result = place_LIMIT_IOC_SELL(
      btc_accumulated,
      limit = round_tick(Close * (1 - slip_sell_pct))
    )
    
    if (result.btc_sold > 0):
      principal = reference_price * result.btc_sold
      profit = max(0, result.usdt_received - result.fees - principal)
      
      btc_accumulated -= result.btc_sold
      if (btc_accumulated == 0):  // Complete sale
        capital_available += principal + profit
        resetCycle()

  // 3) BUY after
  if (purchases_remaining > 0 && Close <= reference_price * (1 - pct_drop)):
    amount = (purchases_remaining == 1) ? capital_available : buy_amount
    validateBalance(USDT_SPOT >= amount)
    validateDrift(drift_usdt < 0.005)
    
    result = place_LIMIT_IOC_BUY(
      amount,
      limit = round_tick(Close * (1 + slip_buy_pct))
    )
    
    if (result.usdt_filled >= max(MinBuyUSDT, minNotional)):
      updateAccumulators(result)
      reference_price = cost_accum_usdt / btc_accum_net
      purchases_remaining -= 1
      status = HOLDING
```

---

**Document Version**: 2.0  
**Last Updated**: August 28, 2025  
**Status**: Ready for Autonomous Implementation

## Implementation Note
This bot must be developed using Test-Driven Development (TDD) with the BDD tests in Section 4. Write tests first, then implement to make them pass. This ensures the strategy works correctly with real money.