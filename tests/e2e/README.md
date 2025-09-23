# E2E Testing Infrastructure

## Overview

This E2E testing infrastructure uses Jest to run true end-to-end tests of the BTC Trading Bot. The tests use the **real production code** with only external APIs (Binance, Supabase, Discord) mocked.

## Key Principles

1. **No Logic Duplication**: Tests use the real `MainOrchestrator` and all production components
2. **Mock Only External APIs**: Binance, Supabase, and Discord are mocked
3. **Test Isolation**: Tests run with `.env.test` to avoid contaminating local/production databases
4. **Current Strategy Testing**: All scenarios use current 5m/0.3%/0.5% thresholds

## Directory Structure

```
/tests/e2e/
├── setup/
│   └── test-env.ts          # Test environment configuration
├── mocks/
│   ├── mock-supabase-client.ts
│   ├── mock-discord-notifier.ts
│   ├── mock-binance-client.ts  # TODO: Needs implementation
│   └── mock-websocket-manager.ts # TODO: Needs implementation
├── scenarios/
│   ├── grid-buying.json     # 0.3% grid level tests
│   ├── buy-anchor.json      # Buy anchor price mechanism
│   ├── sell-trigger.json    # 0.5% sell threshold
│   ├── complete-cycle.json  # Full trading cycle
│   ├── multiple-cycles.json # Multiple cycles with reinvestment
│   └── edge-cases.json      # Edge conditions
└── tests/
    ├── complete-cycle.e2e.test.ts
    └── [other test files]
```

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Watch mode for development
npm run test:e2e:watch

# Run with coverage
npm run test:e2e:coverage

# Run specific test
npm run test:e2e:single "Complete Trading Cycle"
```

## Test Scenarios

All scenarios use current production strategy parameters:

- **Timeframe**: 5m
- **Drop Grid**: 0.3% per level
- **Sell Trigger**: 0.5% rise from reference price
- **Initial Capital**: $1000
- **Max Purchases**: 10

### 1. Grid Buying (`grid-buying.json`)

Tests multiple 0.3% grid levels triggering appropriate buy orders

### 2. Buy Anchor Mechanism (`buy-anchor.json`)

Tests that first buy sets `buy_anchor_price` and grid rebuilds from anchor

### 3. Sell Trigger Precision (`sell-trigger.json`)

Tests exact 0.5% sell threshold - no sell at 0.49%, sell at 0.5%

### 4. Complete Cycle (`complete-cycle.json`)

Full cycle from accumulation through profitable exit

### 5. Multiple Cycles (`multiple-cycles.json`)

Multiple complete cycles with capital reinvestment

### 6. Edge Cases (`edge-cases.json`)

- Maximum purchases reached
- Dust amounts below minimum trade
- Insufficient capital scenarios
- Rapid price oscillations

## Environment Variables

The `.env.test` file ensures complete test isolation:

```bash
NODE_ENV=test
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54322  # Mock URL
DISCORD_WEBHOOK_URL=  # Empty = no Discord notifications
INITIAL_CAPITAL_USDT=1000.00
```

## Safety Features

1. **Environment Validation**: Tests verify they're in test mode before running
2. **Discord Disabled**: Ensures no test notifications are sent
3. **Database Isolation**: Uses mock Supabase client, no real DB access
4. **Clean State**: Each test starts with fresh mocks

## Implementation Status

### ✅ Completed

- Test directory structure
- Test environment setup
- Discord mock
- Supabase mock (basic)
- Test scenarios (JSON)
- Jest configuration
- Package.json scripts

### ⚠️ TODO

To fully implement E2E tests, the following mocks need to be created:

1. **MockBinanceClient**: Simulates order execution with configurable slippage and fees
2. **MockWebSocketManager**: Emits candles from test scenarios
3. **MockBalanceManager**: Tracks balance changes from trades

These should be based on the original implementations but simplified for testing.

## Writing New Tests

```typescript
import "../setup/test-env.js";
import { describe, it, expect } from "@jest/globals";

describe("Your E2E Test", () => {
  let orchestrator: MainOrchestrator;

  beforeEach(async () => {
    // Set up mocks with test scenario
    // Initialize real MainOrchestrator
    // Start orchestrator
  });

  afterEach(async () => {
    // Stop orchestrator
    // Clean up mocks
  });

  it("should test specific behavior", async () => {
    // Feed candles through mock WebSocket
    // Assert on outcomes (trades, state, profits)
    // Verify no Discord notifications
  });
});
```

## Benefits

1. **True E2E Testing**: Tests actual production logic
2. **No Mock Logic**: No duplicate implementations to maintain
3. **Fast Execution**: No real API calls or database access
4. **CI/CD Ready**: Can run in GitHub Actions
5. **Regression Prevention**: Catches breaking changes
6. **Current Strategy**: Always tests with actual strategy parameters
