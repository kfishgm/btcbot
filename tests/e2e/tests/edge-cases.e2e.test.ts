/**
 * Edge Cases E2E Test
 *
 * Tests edge conditions and boundary cases in the trading system
 */

import "../setup/test-env.js";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createTestOrchestrator } from "../setup/test-orchestrator-factory.js";
import edgeCasesData from "../scenarios/edge-cases.json";

describe("Edge Cases E2E", () => {
  let testOrchestrator: Awaited<ReturnType<typeof createTestOrchestrator>>;

  beforeEach(async () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();

    // Use the first scenario's candles for the orchestrator
    // Since edge-cases.json has multiple scenarios, we'll use a simple candle set
    const defaultCandles = [
      {
        openTime: 1704067200000,
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100000,
        volume: 10,
        closeTime: 1704067559999,
      },
      {
        openTime: 1704067560000,
        open: 100000,
        high: 100000,
        low: 99650,
        close: 99700,
        volume: 15,
        closeTime: 1704068159999,
      },
    ];

    testOrchestrator = await createTestOrchestrator({
      scenario: {
        name: edgeCasesData.name,
        description: edgeCasesData.description,
        symbol: edgeCasesData.symbol,
        interval: edgeCasesData.interval,
        candles: defaultCandles,
      },
      historicalCandles: 2,
      initialCapital: 1000,
      dropPercentage: 0.003,
      risePercentage: 0.005,
      maxPurchases: 10,
    });
  });

  afterEach(() => {
    testOrchestrator.mocks.supabase.reset();
    testOrchestrator.mocks.discord.clearNotifications();
    testOrchestrator.mocks.binance.reset();
    testOrchestrator.mocks.websocket.reset();
  });

  it("should handle maximum purchases reached", async () => {
    const { components, mocks } = testOrchestrator;

    // Start with 9 purchases already made, 1 remaining
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 100, // Only enough for 1 more purchase
      btc_accumulated: 0.009,
      purchases_remaining: 1, // Last purchase available
      sell_reference_price: 98500,
      ath_price: 100000,
      buy_amount: 100,
      buy_anchor_price: 99700,
      buy_grid: [
        99400, 99100, 98800, 98500, 98200, 97900, 97600, 97300, 97000, 96700,
      ], // Full grid
      buy_index: 8, // Next level is index 8 (97000)
      btc_dust: 0,
    });

    await components.cycleStateManager.initialize();

    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    // Test at a price that triggers the last buy
    const testPrice = 97000;

    const buyTrigger = await components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY",
        ath_reference_price: 100000,
        sell_reference_price: 98500,
        purchases_remaining: 1,
        capital_available: 100,
        buy_amount: 100,
        buy_anchor_price: 99700,
        btc_accumulated: 0.009,
        btc_dust: undefined,
        buy_grid: [
          99400, 99100, 98800, 98500, 98200, 97900, 97600, 97300, 97000, 96700,
        ],
        buy_index: 8,
      },
      {
        dropPercentage: 0.003,
        risePercentage: 0.005,
        maxPurchases: 10,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
      },
      {
        close: testPrice,
        high: testPrice,
        low: testPrice,
        open: testPrice,
        volume: 0,
        timestamp: Date.now(),
      },
      balances,
    );

    // Debug output
    console.log("Buy trigger result:", buyTrigger);

    // Should trigger the last buy using all remaining capital
    expect(buyTrigger.shouldBuy).toBe(true);
    expect(buyTrigger.buyAmount).toBe(100); // All remaining capital

    // After this buy, status should change to HOLDING
    if (buyTrigger.shouldBuy) {
      const newPurchasesRemaining = 1 - (buyTrigger.levelsTriggered || 1);
      expect(newPurchasesRemaining).toBe(0);
    }
  });

  it("should handle insufficient capital gracefully", async () => {
    const { components, mocks } = testOrchestrator;

    // Very low capital, less than minimum buy
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 5, // Below minimum buy amount
      btc_accumulated: 0.001,
      purchases_remaining: 5,
      sell_reference_price: 99500,
      ath_price: 100000,
      buy_amount: 100,
      buy_anchor_price: 99700,
      buy_grid: [99400, 99100, 98800, 98500, 98200],
      buy_index: 0,
      btc_dust: 0,
    });

    await components.cycleStateManager.initialize();

    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    const testPrice = 99400; // Should trigger grid level

    const buyTrigger = await components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY",
        ath_reference_price: 100000,
        sell_reference_price: 99500,
        purchases_remaining: 5,
        capital_available: 5, // Below minimum
        buy_amount: 100,
        buy_anchor_price: 99700,
        btc_accumulated: 0.001,
        btc_dust: undefined,
        buy_grid: [99400, 99100, 98800, 98500, 98200],
        buy_index: 0,
      },
      {
        dropPercentage: 0.003,
        risePercentage: 0.005,
        maxPurchases: 10,
        minBuyUSDT: 10, // Minimum buy is 10 USDT
        exchangeMinNotional: 10,
      },
      {
        close: testPrice,
        high: testPrice,
        low: testPrice,
        open: testPrice,
        volume: 0,
        timestamp: Date.now(),
      },
      balances,
    );

    // Should NOT trigger buy due to insufficient capital
    expect(buyTrigger.shouldBuy).toBe(false);
    expect(buyTrigger.reason).toContain("below minimum");
  });

  it("should handle BTC dust accumulation", async () => {
    const { components, mocks } = testOrchestrator;

    // Set up state with accumulated dust
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "HOLDING",
      capital_available: 500,
      btc_accumulated: 0.01, // Increased to meet minimum notional
      btc_dust: 0.00000123, // Dust from fees/rounding
      purchases_remaining: 5,
      sell_reference_price: 99500,
      ath_price: 100000,
      buy_amount: 100,
      buy_anchor_price: 99700,
      buy_grid: [99400, 99100, 98800, 98500, 98200],
      buy_index: 5,
    });

    await components.cycleStateManager.initialize();
    const state = await components.cycleStateManager.getCurrentState();

    // BTC dust should be tracked separately
    expect(state?.btc_dust).toBe(0.00000123);

    // Total BTC for sell should include dust
    const totalBtc = (state?.btc_accumulated || 0) + (state?.btc_dust || 0);
    expect(totalBtc).toBeCloseTo(0.01000123, 8);

    // Set up BTC balance in mock Binance to match state
    mocks.binance.setBalance("BTC", 0.01000123);

    // When checking sell trigger, dust should be considered
    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    // Commission-adjusted trigger price: (referencePrice * (1 + rise)) / (1 - commission)
    // 99500 * 1.005 / 0.999 = 100097.6
    const sellPrice = 100100; // Above commission-adjusted threshold

    const sellTrigger = await components.sellTriggerDetector.checkSellTrigger(
      {
        status: "HOLDING",
        sell_reference_price: 99500,
        purchases_remaining: 5,
        capital_available: 500,
        btc_accumulated: 0.01,
      },
      {
        risePercentage: 0.005,
        dropPercentage: 0.003,
        exchangeMinNotional: 10,
      },
      {
        close: sellPrice,
        high: sellPrice,
        low: sellPrice,
        open: sellPrice,
        volume: 0,
        timestamp: Date.now(),
      },
      balances,
    );

    expect(sellTrigger.shouldSell).toBe(true);
  });

  it("should respect minimum order size constraints", async () => {
    const { components } = testOrchestrator;

    // Trading rules are already set in MockBinanceClient
    // The mock uses default trading rules with minNotional: 10

    // Try to buy with amount that would result in order below minNotional
    const btcPrice = 100000;
    const buyAmount = 9; // Below $10 minimum

    // Calculate expected BTC quantity
    const btcQty = buyAmount / btcPrice; // 0.00009 BTC

    // This should fail minimum notional check
    const orderValue = btcQty * btcPrice; // $9
    expect(orderValue).toBeLessThan(10);

    // Buy trigger should recognize this constraint
    const buyTrigger = await components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY",
        ath_reference_price: 100000,
        sell_reference_price: 100000,
        purchases_remaining: 10,
        capital_available: 9, // Only $9 available
        buy_amount: 9,
        buy_anchor_price: null,
        btc_accumulated: 0,
        btc_dust: undefined,
        buy_grid: null,
        buy_index: 0,
      },
      {
        dropPercentage: 0.003,
        risePercentage: 0.005,
        maxPurchases: 10,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
      },
      {
        close: 99700, // Trigger price
        high: 99700,
        low: 99700,
        open: 99700,
        volume: 0,
        timestamp: Date.now(),
      },
      {
        btcSpot: 0,
        usdtSpot: 9,
      },
    );

    // Should not buy due to minimum constraints
    expect(buyTrigger.shouldBuy).toBe(false);
  });

  it("should handle rapid price movements through multiple grid levels", async () => {
    const { components } = testOrchestrator;

    // Set up initial state
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      purchases_remaining: 10,
      sell_reference_price: 100000,
      ath_price: 100000,
      buy_amount: 100,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      btc_dust: 0,
    });

    await components.cycleStateManager.initialize();

    // Simulate rapid drop from 100000 to 97000 (crosses 10 grid levels)
    const rapidDropPrice = 97000;

    const buyTrigger = await components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY",
        ath_reference_price: 100000,
        sell_reference_price: 100000,
        purchases_remaining: 10,
        capital_available: 1000,
        buy_amount: 100,
        buy_anchor_price: null,
        btc_accumulated: 0,
        btc_dust: undefined,
        buy_grid: null,
        buy_index: 0,
      },
      {
        dropPercentage: 0.003,
        risePercentage: 0.005,
        maxPurchases: 10,
        minBuyUSDT: 10,
        exchangeMinNotional: 10,
      },
      {
        close: rapidDropPrice,
        high: rapidDropPrice,
        low: rapidDropPrice,
        open: rapidDropPrice,
        volume: 0,
        timestamp: Date.now(),
      },
      {
        btcSpot: 0,
        usdtSpot: 1000,
      },
    );

    // Should trigger buy but only for first level on initial buy
    expect(buyTrigger.shouldBuy).toBe(true);

    // First buy only triggers one level even if price crossed multiple
    expect(buyTrigger.levelsTriggered).toBe(1);

    // Should build full grid from anchor
    expect(buyTrigger.newGrid).toBeDefined();
    expect(buyTrigger.newGrid?.length).toBe(10);
  });

  it("should handle state recovery after interruption", async () => {
    const { components } = testOrchestrator;

    // Simulate bot restart with partial state
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 650,
      btc_accumulated: 0.0035,
      purchases_remaining: 6,
      sell_reference_price: 99200,
      ath_price: 100000,
      buy_amount: 108.33, // Adjusted for remaining purchases
      buy_anchor_price: 99700,
      buy_grid: [99400, 99100, 98800, 98500, 98200, 97900],
      buy_index: 4, // Already bought 4 levels
      btc_dust: 0.00000045,
    });

    // Initialize after "restart"
    await components.cycleStateManager.initialize();
    const recoveredState = await components.cycleStateManager.getCurrentState();

    // State should be fully recovered
    expect(recoveredState).toBeDefined();
    expect(recoveredState?.status).toBe("READY");
    expect(recoveredState?.btc_accumulated).toBe(0.0035);
    expect(recoveredState?.purchases_remaining).toBe(6);
    expect(recoveredState?.buy_index).toBe(4);

    // Grid should be intact
    expect(recoveredState?.buy_grid).toBeDefined();
    expect(recoveredState?.buy_grid?.length).toBe(6);

    // Should be able to continue trading from this state
    const nextGridLevel =
      recoveredState?.buy_grid?.[recoveredState.buy_index || 0];
    expect(nextGridLevel).toBe(98200);
  });
});
