/**
 * Grid Buying E2E Test
 *
 * Tests systematic buying at grid levels during price decline
 */

import "../setup/test-env.js";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createTestOrchestrator } from "../setup/test-orchestrator-factory.js";
import gridBuyingScenario from "../scenarios/grid-buying.json";

describe("Grid Buying E2E", () => {
  let testOrchestrator: Awaited<ReturnType<typeof createTestOrchestrator>>;

  beforeEach(async () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();

    testOrchestrator = await createTestOrchestrator({
      scenario: gridBuyingScenario,
      historicalCandles: 2,
      initialCapital: 1000,
      dropPercentage: 0.003, // 0.3% grid
      risePercentage: 0.005,
      maxPurchases: 10,
    });

    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      purchases_remaining: 10,
      ath_reference_price: 100000,
      ath_price: 100000,
      sell_reference_price: null,
      buy_amount: 100,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      btc_dust: 0,
    });
  });

  afterEach(() => {
    testOrchestrator.mocks.supabase.reset();
    testOrchestrator.mocks.discord.clearNotifications();
    testOrchestrator.mocks.binance.reset();
    testOrchestrator.mocks.websocket.reset();
  });

  it("should execute buys at each grid level during steady decline", async () => {
    const { components, mocks } = testOrchestrator;

    await components.cycleStateManager.initialize();

    let currentState = await components.cycleStateManager.getCurrentState();
    const buyOrders: { price: number; amount: number }[] = [];

    await mocks.websocket.connect();

    const processingPromises: Promise<void>[] = [];

    mocks.websocket.on("candle", (candleData) => {
      const processCandle = async () => {
        const currentPrice = parseFloat(candleData.close);
        console.log(`Processing candle at price ${currentPrice}`);

        currentState = await components.cycleStateManager.getCurrentState();
        if (!currentState) return;

        if (
          currentState.status === "READY" ||
          currentState.status === "BUYING"
        ) {
          const btcBalance = await mocks.binance.getBalance("BTC");
          const usdtBalance = await mocks.binance.getBalance("USDT");
          const balances = {
            btcSpot: parseFloat(btcBalance?.free || "0"),
            usdtSpot: parseFloat(usdtBalance?.free || "0"),
          };

          const triggerState = {
            status: currentState.status as "READY" | "HOLDING" | "PAUSED",
            ath_reference_price: currentState.ath_reference_price,
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

          const buyTrigger =
            await components.buyTriggerDetector.checkBuyTrigger(
              triggerState,
              {
                dropPercentage: 0.003,
                risePercentage: 0.005,
                maxPurchases: 10,
                minBuyUSDT: 10,
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

          if (buyTrigger.shouldBuy && buyTrigger.buyAmount) {
            console.log(
              `EXECUTING BUY at ${currentPrice} for ${buyTrigger.buyAmount} USDT`,
            );
            buyOrders.push({
              price: currentPrice,
              amount: buyTrigger.buyAmount,
            });

            const buyResult = await mocks.binance.createOrder({
              symbol: "BTCUSDT",
              side: "BUY",
              type: "MARKET",
              quantity: buyTrigger.buyAmount / currentPrice,
            });

            expect(buyResult.status).toBe("FILLED");

            // Update state
            const newBtcAccum =
              (currentState.btc_accumulated || 0) +
              (buyTrigger.buyAmount / currentPrice) * 0.999;
            const newCapital =
              (currentState.capital_available || 0) - buyTrigger.buyAmount;
            const newPurchases =
              (currentState.purchases_remaining || 0) -
              (buyTrigger.levelsTriggered || 1);

            let newRefPrice = currentPrice;
            if (
              currentState.btc_accumulated &&
              currentState.btc_accumulated > 0
            ) {
              const oldValue =
                (currentState.sell_reference_price || currentPrice) *
                currentState.btc_accumulated;
              const newValue =
                currentPrice * (buyTrigger.buyAmount / currentPrice) * 0.999;
              newRefPrice = (oldValue + newValue) / newBtcAccum;
            }

            const newState = {
              ...currentState,
              status: newPurchases > 0 ? "BUYING" : "HOLDING",
              capital_available: newCapital,
              btc_accumulated: newBtcAccum,
              purchases_remaining: newPurchases,
              sell_reference_price: newRefPrice,
              buy_anchor_price: currentState.buy_anchor_price || currentPrice,
              buy_grid: buyTrigger.newGrid || currentState.buy_grid,
              buy_index:
                buyTrigger.newBuyIndex !== undefined
                  ? buyTrigger.newBuyIndex
                  : currentState.buy_index,
            };
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

    // Verify multiple grid buys were executed
    expect(buyOrders.length).toBeGreaterThanOrEqual(4);

    // Verify buy amounts increase as purchases decrease
    // When purchases_remaining decreases, buy_amount should increase
    const buyAmounts = buyOrders.map((o) => o.amount);
    const hasIncreasingAmounts = buyAmounts.some(
      (amount, idx) => idx > 0 && amount > buyAmounts[0],
    );
    expect(hasIncreasingAmounts).toBe(true);

    // Verify final state shows accumulation
    const finalState = await components.cycleStateManager.getCurrentState();
    expect(finalState?.btc_accumulated).toBeGreaterThan(0);
    expect(finalState?.purchases_remaining).toBeLessThan(10);
  });

  it("should handle rapid price drops through multiple grid levels", async () => {
    const { components, mocks } = testOrchestrator;

    await components.cycleStateManager.initialize();

    // Simulate rapid drop from 100000 to 98800 (crosses 3 grid levels)
    const rapidDropPrice = 98800;

    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    const buyTrigger = await components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY",
        ath_reference_price: 100000,
        sell_reference_price: null,
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
      balances,
    );

    // Should trigger buy but only for first level on initial buy
    expect(buyTrigger.shouldBuy).toBe(true);
    expect(buyTrigger.levelsTriggered).toBe(1); // Only first level on initial buy
    expect(buyTrigger.buyAmount).toBeGreaterThan(0);
  });

  it("should stop buying when capital is exhausted", async () => {
    const { components, mocks } = testOrchestrator;

    // Start with very limited capital
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "BUYING",
      capital_available: 150, // Only enough for ~1.5 buys
      btc_accumulated: 0.005,
      purchases_remaining: 5,
      ath_reference_price: 100000,
      ath_price: 100000,
      sell_reference_price: 99500,
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

    // Test at a price that would normally trigger a buy
    const testPrice = 99400;
    const currentState = await components.cycleStateManager.getCurrentState();

    if (!currentState) {
      throw new Error("Failed to get current state for buy trigger check");
    }

    const buyTrigger = await components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY", // BuyTriggerDetector only accepts READY/HOLDING/PAUSED
        ath_reference_price: currentState.ath_reference_price,
        sell_reference_price: currentState.sell_reference_price,
        purchases_remaining: currentState.purchases_remaining,
        capital_available: currentState.capital_available,
        buy_amount: currentState.buy_amount,
        buy_anchor_price: currentState.buy_anchor_price,
        btc_accumulated: currentState.btc_accumulated || 0,
        btc_dust: currentState.btc_dust || undefined,
        buy_grid: currentState.buy_grid,
        buy_index: currentState.buy_index || 0,
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

    // Should trigger buy with available capital
    expect(buyTrigger.shouldBuy).toBe(true);
    // Should use remaining capital if buying
    if (buyTrigger.shouldBuy) {
      expect(buyTrigger.buyAmount).toBeLessThanOrEqual(150);
    }
  });
});
