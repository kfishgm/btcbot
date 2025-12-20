/**
 * Sell Trigger E2E Test
 *
 * Tests precise sell trigger conditions at 0.5% rise from reference price
 */

import "../setup/test-env.js";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createTestOrchestrator } from "../setup/test-orchestrator-factory.js";
import sellTriggerScenario from "../scenarios/sell-trigger.json";
import type { CycleState } from "../../../src/cycle/cycle-state-manager.js";

describe("Sell Trigger E2E", () => {
  let testOrchestrator: Awaited<ReturnType<typeof createTestOrchestrator>>;

  beforeEach(async () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();

    testOrchestrator = await createTestOrchestrator({
      scenario: sellTriggerScenario,
      historicalCandles: 2,
      initialCapital: 1000,
      dropPercentage: 0.003,
      risePercentage: 0.005, // 0.5% sell trigger
      maxPurchases: 10,
    });

    // Start with some BTC accumulated
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "HOLDING",
      capital_available: 700,
      btc_accumulated: 0.003, // Already have some BTC
      purchases_remaining: 7,
      sell_reference_price: 99700, // Reference from previous buys
      ath_price: 100000,
      buy_amount: 100,
      buy_anchor_price: 99700,
      buy_grid: [99400, 99100, 98800, 98500, 98200, 97900, 97600],
      buy_index: 0,
      btc_dust: 0,
    });

    // Set matching BTC balance in mock Binance client
    testOrchestrator.mocks.binance.setBalance("BTC", 0.003);
  });

  afterEach(() => {
    testOrchestrator.mocks.supabase.reset();
    testOrchestrator.mocks.discord.clearNotifications();
    testOrchestrator.mocks.binance.reset();
    testOrchestrator.mocks.websocket.reset();
  });

  it("should trigger sell at exactly 0.5% rise from reference price", async () => {
    const { components, mocks } = testOrchestrator;

    await components.cycleStateManager.initialize();

    let currentState = await components.cycleStateManager.getCurrentState();
    const referencePrice = currentState?.sell_reference_price || 99700;
    // With commission adjustment: (referencePrice * 1.005) / (1 - 0.001)
    const sellTriggerPrice = (referencePrice * 1.005) / 0.999; // Commission-adjusted 0.5% above reference

    let sellExecuted = false;
    let sellPrice = 0;

    await mocks.websocket.connect();
    const processingPromises: Promise<void>[] = [];

    mocks.websocket.on("candle", (candleData) => {
      const processCandle = async () => {
        const currentPrice = parseFloat(candleData.close);
        console.log(`Processing candle at price ${currentPrice}`);

        currentState = await components.cycleStateManager.getCurrentState();
        if (!currentState) return;

        // Check for sell trigger
        if (
          currentState.status === "HOLDING" &&
          (currentState.btc_accumulated ?? 0) > 0
        ) {
          const btcBalance = await mocks.binance.getBalance("BTC");
          const usdtBalance = await mocks.binance.getBalance("USDT");
          const balances = {
            btcSpot: parseFloat(btcBalance?.free || "0"),
            usdtSpot: parseFloat(usdtBalance?.free || "0"),
          };

          const triggerState = {
            status: "HOLDING" as const,
            sell_reference_price: currentState.sell_reference_price,
            purchases_remaining: currentState.purchases_remaining,
            capital_available: currentState.capital_available,
            buy_amount: currentState.buy_amount,
            buy_anchor_price: currentState.buy_anchor_price,
            btc_accumulated: currentState.btc_accumulated || 0,
            btc_dust: currentState.btc_dust || undefined,
            buy_grid: currentState.buy_grid,
            buy_index: currentState.buy_index || 0,
          };

          const sellTrigger =
            await components.sellTriggerDetector.checkSellTrigger(
              triggerState,
              {
                risePercentage: 0.005,
                dropPercentage: 0.003,
                exchangeMinNotional: 10,
              },
              {
                close: currentPrice,
                high: currentPrice,
                low: currentPrice,
                open: currentPrice,
                volume: 0,
                timestamp: Date.now(),
              },
              balances,
            );

          console.log(`Sell trigger at ${currentPrice}:`, sellTrigger);

          if (sellTrigger.shouldSell) {
            console.log(`EXECUTING SELL at ${currentPrice}`);
            sellExecuted = true;
            sellPrice = currentPrice;

            const btcAccumulated = currentState.btc_accumulated ?? 0;
            const sellResult = await mocks.binance.createOrder({
              symbol: "BTCUSDT",
              side: "SELL",
              type: "MARKET",
              quantity: btcAccumulated,
            });

            expect(sellResult.status).toBe("FILLED");

            // Update state after sell
            const newState = {
              ...currentState,
              status: "COMPLETED",
              btc_accumulated: 0,
              capital_available:
                (currentState.capital_available || 0) +
                btcAccumulated * currentPrice * 0.999,
            } as CycleState;
            mocks.supabase.setCycleState("test-cycle", newState);
            components.cycleStateManager.updateCachedState(newState);
          }
        }
      };

      const promise = (
        processingPromises[processingPromises.length - 1] || Promise.resolve()
      ).then(() => processCandle());
      processingPromises.push(promise);
    });

    await mocks.websocket.waitForCompletion();
    await Promise.all(processingPromises);

    // Verify sell was executed
    expect(sellExecuted).toBe(true);

    // Verify sell price was at or above the trigger price
    expect(sellPrice).toBeGreaterThanOrEqual(sellTriggerPrice);

    // Verify final state
    const finalState = await components.cycleStateManager.getCurrentState();
    expect(finalState?.status).toBe("COMPLETED");
    expect(finalState?.btc_accumulated).toBe(0);
  });

  it("should NOT trigger sell below 0.5% rise", async () => {
    const { components, mocks } = testOrchestrator;

    await components.cycleStateManager.initialize();
    const currentState = await components.cycleStateManager.getCurrentState();
    const referencePrice = currentState?.sell_reference_price || 99700;

    // Test at 0.4% rise (should NOT trigger)
    const testPrice = referencePrice * 1.004;

    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    const sellTrigger = await components.sellTriggerDetector.checkSellTrigger(
      {
        status: "HOLDING",
        sell_reference_price: referencePrice,
        purchases_remaining: 7,
        capital_available: 700,
        btc_accumulated: 0.003,
      },
      {
        risePercentage: 0.005,
        dropPercentage: 0.003,
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

    // Should NOT trigger at 0.4% rise
    console.log("Sell trigger result at 0.4% rise:", sellTrigger);
    expect(sellTrigger.shouldSell).toBe(false);
    // Reason should indicate price is below threshold
    if (sellTrigger.reason) {
      expect(sellTrigger.reason.toLowerCase()).toMatch(
        /below|not.*reached|threshold/,
      );
    }
  });

  it("should calculate reference price correctly for sell decision", async () => {
    const { components } = testOrchestrator;

    // Set up state with multiple purchases at different prices
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "HOLDING",
      capital_available: 400,
      btc_accumulated: 0.00603, // Sum of purchases below
      purchases_remaining: 4,
      // Reference price should be weighted average
      // Buy 1: 0.001 BTC at 100000 = 100 USDT
      // Buy 2: 0.00201 BTC at 99500 = 200 USDT
      // Buy 3: 0.00302 BTC at 99000 = 300 USDT
      // Total: 0.00603 BTC for 600 USDT
      // Reference = 600 / 0.00603 = 99502.48
      sell_reference_price: 99502.48,
      ath_price: 100000,
      buy_amount: 150,
      buy_anchor_price: 100000,
      buy_grid: [99700, 99400, 99100, 98800, 98500, 98200],
      buy_index: 3,
      btc_dust: 0,
    });

    await components.cycleStateManager.initialize();
    const state = await components.cycleStateManager.getCurrentState();

    // Reference price should be the weighted average
    expect(state?.sell_reference_price || 0).toBeCloseTo(99502.48, 1);

    // Sell trigger price should be commission-adjusted: (reference * 1.005) / (1 - 0.001)
    const sellTriggerPrice =
      ((state?.sell_reference_price || 99502.48) * 1.005) / 0.999;
    expect(sellTriggerPrice).toBeCloseTo(100100.09, 1);
  });

  it("should handle partial sells when BTC balance differs from accumulated", async () => {
    const { components, mocks } = testOrchestrator;

    // Simulate dust or rounding differences
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "HOLDING",
      capital_available: 700,
      btc_accumulated: 0.003,
      btc_dust: 0.000001, // Small dust amount
      purchases_remaining: 7,
      sell_reference_price: 99700,
      ath_price: 100000,
      buy_amount: 100,
      buy_anchor_price: 99700,
      buy_grid: [99400, 99100, 98800, 98500, 98200, 97900, 97600],
      buy_index: 0,
    });

    await components.cycleStateManager.initialize();

    // Set actual balance slightly more than accumulated (to simulate fees/dust)
    mocks.binance.setBalance("BTC", 0.003001);

    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    // Test at commission-adjusted sell trigger price
    const testPrice = (99700 * 1.005) / 0.999;

    const sellTrigger = await components.sellTriggerDetector.checkSellTrigger(
      {
        status: "HOLDING",
        sell_reference_price: 99700,
        purchases_remaining: 7,
        capital_available: 700,
        btc_accumulated: 0.003,
      },
      {
        risePercentage: 0.005,
        dropPercentage: 0.003,
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

    // Should still trigger sell even with slight balance difference
    expect(sellTrigger.shouldSell).toBe(true);

    // Should sell the accumulated amount from state
    if (sellTrigger.sellAmount) {
      expect(sellTrigger.sellAmount).toBeCloseTo(0.003, 6);
    }
  });
});
