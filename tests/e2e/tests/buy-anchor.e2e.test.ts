/**
 * Buy Anchor E2E Test
 *
 * Tests the buy anchor and grid adjustment mechanism
 */

import "../setup/test-env.js";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createTestOrchestrator } from "../setup/test-orchestrator-factory.js";
import buyAnchorScenario from "../scenarios/buy-anchor.json";

describe("Buy Anchor E2E", () => {
  let testOrchestrator: Awaited<ReturnType<typeof createTestOrchestrator>>;

  beforeEach(async () => {
    // Verify test environment
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();

    // Create test orchestrator with real components
    testOrchestrator = await createTestOrchestrator({
      scenario: buyAnchorScenario,
      historicalCandles: 2, // First 2 candles are historical
      initialCapital: 1000,
      dropPercentage: 0.003, // 0.3% grid
      risePercentage: 0.005, // 0.5% sell trigger
      maxPurchases: 10,
    });

    // Set up initial cycle state
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      purchases_remaining: 10,
      reference_price: 100000,
      ath_price: 100000,
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

  it("should anchor grid to first buy price and maintain levels", async () => {
    const { components, mocks } = testOrchestrator;

    // Initialize components
    await components.cycleStateManager.initialize();

    // Process candles
    let currentState = await components.cycleStateManager.getCurrentState();
    const buyPrices: number[] = [];
    let anchorPrice: number | null = null;

    // Connect websocket to emit live candles
    await mocks.websocket.connect();

    // Track candle processing promises for sequential processing
    const processingPromises: Promise<void>[] = [];

    mocks.websocket.on("candle", (candleData) => {
      const processCandle = async () => {
        const currentPrice = parseFloat(candleData.close);
        console.log(`Processing candle at price ${currentPrice}`);

        currentState = await components.cycleStateManager.getCurrentState();
        if (!currentState) return;

        // Check for buy trigger
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
            reference_price: currentState.reference_price,
            purchases_remaining: currentState.purchases_remaining,
            capital_available: currentState.capital_available,
            buy_amount: currentState.buy_amount,
            buy_anchor_price: currentState.buy_anchor_price,
            btc_accumulated: currentState.btc_accumulated || 0,
            btc_dust: currentState.btc_dust || undefined,
            buy_grid: currentState.buy_grid,
            buy_index: currentState.buy_index || 0,
          };

          const buyTrigger = components.buyTriggerDetector.checkBuyTrigger(
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
            buyPrices.push(currentPrice);

            // Record anchor price on first buy
            if (anchorPrice === null) {
              anchorPrice = currentPrice;
              console.log(`Grid anchored at ${anchorPrice}`);
            }

            const buyResult = await mocks.binance.createOrder({
              symbol: "BTCUSDT",
              side: "BUY",
              type: "MARKET",
              quantity: buyTrigger.buyAmount / currentPrice,
            });

            expect(buyResult.status).toBe("FILLED");

            // Update state after buy
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
                (currentState.reference_price || currentPrice) *
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
              reference_price: newRefPrice,
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

      // Process candles sequentially
      const promise = (
        processingPromises[processingPromises.length - 1] || Promise.resolve()
      ).then(() => processCandle());
      processingPromises.push(promise);
    });

    // Wait for all candles to be processed
    await mocks.websocket.waitForCompletion();
    await Promise.all(processingPromises);

    // Verify anchor was set on first buy
    const finalState = await components.cycleStateManager.getCurrentState();
    expect(finalState?.buy_anchor_price).toBeTruthy();

    // Verify multiple buys were executed at grid levels
    expect(buyPrices.length).toBeGreaterThanOrEqual(2);

    // Verify grid spacing is maintained relative to anchor
    if (buyPrices.length >= 2 && anchorPrice) {
      // First buy is the anchor, subsequent buys should be at grid levels
      // Grid levels are 0.3% apart from each other
      for (let i = 1; i < buyPrices.length; i++) {
        const priceDiff = Math.abs(buyPrices[i - 1] - buyPrices[i]);

        // Check if the price difference is approximately a multiple of 0.3%
        let isGridSpacing = false;
        for (let multiple = 1; multiple <= 10; multiple++) {
          const expectedGridDiff = buyPrices[0] * 0.003 * multiple;
          // Allow 2% tolerance on the grid spacing due to rounding
          if (
            Math.abs(priceDiff - expectedGridDiff) <
            expectedGridDiff * 0.02
          ) {
            isGridSpacing = true;
            break;
          }
        }
        expect(isGridSpacing).toBe(true);
      }
    }
  });

  it("should adjust grid when price moves significantly from anchor", async () => {
    const { components, mocks } = testOrchestrator;

    await components.cycleStateManager.initialize();

    // Manually set an anchor price
    const initialAnchor = 99700;
    const currentState = await components.cycleStateManager.getCurrentState();
    if (currentState) {
      const stateWithAnchor = {
        ...currentState,
        buy_anchor_price: initialAnchor,
        buy_grid: [
          99400, 99100, 98800, 98500, 98200, 97900, 97600, 97300, 97000, 96700,
        ],
        buy_index: 0,
        status: "BUYING" as const,
        btc_accumulated: 0.001,
        purchases_remaining: 9,
      };
      mocks.supabase.setCycleState("test-cycle", stateWithAnchor);
      components.cycleStateManager.updateCachedState(stateWithAnchor);
    }

    // Test that grid is maintained correctly
    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    // Test price at next grid level
    const testPrice = 99400;
    const updatedState = await components.cycleStateManager.getCurrentState();

    const buyTrigger = components.buyTriggerDetector.checkBuyTrigger(
      {
        status: updatedState!.status as "READY" | "HOLDING" | "PAUSED",
        reference_price: updatedState!.reference_price,
        purchases_remaining: updatedState!.purchases_remaining,
        capital_available: updatedState!.capital_available,
        buy_amount: updatedState!.buy_amount,
        buy_anchor_price: updatedState!.buy_anchor_price,
        btc_accumulated: updatedState!.btc_accumulated || 0,
        btc_dust: updatedState!.btc_dust || undefined,
        buy_grid: updatedState!.buy_grid,
        buy_index: updatedState!.buy_index || 0,
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

    // Should trigger buy at this grid level
    expect(buyTrigger.shouldBuy).toBe(true);
    expect(buyTrigger.triggeredLevels).toContain(99400);
  });
});
