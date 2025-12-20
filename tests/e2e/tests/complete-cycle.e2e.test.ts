/**
 * Complete Trading Cycle E2E Test
 *
 * Tests a full trading cycle from multiple grid buys through accumulation to sell
 * using real bot logic components with mocked external services.
 */

import "../setup/test-env.js";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createTestOrchestrator } from "../setup/test-orchestrator-factory.js";
import completeCycleScenario from "../scenarios/complete-cycle.json";
import type { CycleState } from "../../../src/cycle/cycle-state-manager.js";

describe("Complete Trading Cycle E2E", () => {
  let testOrchestrator: Awaited<ReturnType<typeof createTestOrchestrator>>;

  beforeEach(async () => {
    // Verify test environment
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();

    // Create test orchestrator with real components
    testOrchestrator = await createTestOrchestrator({
      scenario: completeCycleScenario,
      historicalCandles: 2, // Only first 2 candles are historical (ATH establishment)
      initialCapital: 1000,
      dropPercentage: 0.003, // 0.3% grid
      risePercentage: 0.005, // 0.5% sell trigger
      maxPurchases: 10,
    });

    // Set up initial cycle state with all required fields
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      purchases_remaining: 10,
      ath_reference_price: 100000, // Set initial reference price for grid
      ath_price: 100000, // Set ATH from historical candles
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

  it("should process complete trading cycle with real bot logic", async () => {
    const { components, mocks } = testOrchestrator;

    // Initialize components
    await components.cycleStateManager.initialize();

    // Get historical candles (simulates bot startup)
    const historicalKlines = await mocks.binance.getKlines("BTCUSDT", "5m", 25);
    expect(historicalKlines.length).toBeGreaterThan(0);

    // Process each live candle through real bot components
    let currentState = await components.cycleStateManager.getCurrentState();
    const candlesProcessed: number[] = [];

    // Connect websocket to emit live candles
    await mocks.websocket.connect();

    // Track candle processing promises to ensure sequential processing
    const processingPromises: Promise<void>[] = [];

    // Listen for candle events
    mocks.websocket.on("candle", (candleData) => {
      const processCandle = async () => {
        const currentPrice = parseFloat(candleData.close);
        candlesProcessed.push(currentPrice);
        console.log(`Processing candle at price ${currentPrice}`);

        // Get current state
        currentState = await components.cycleStateManager.getCurrentState();
        if (!currentState) return;
        console.log(
          `State: ${currentState.status}, BTC: ${currentState.btc_accumulated}`,
        );

        // Check for buy trigger using real detector
        if (
          currentState.status === "READY" ||
          currentState.status === "BUYING"
        ) {
          // Get current balances for the trigger check
          const btcBalance = await mocks.binance.getBalance("BTC");
          const usdtBalance = await mocks.binance.getBalance("USDT");
          const balances = {
            btcSpot: parseFloat(btcBalance?.free || "0"),
            usdtSpot: parseFloat(usdtBalance?.free || "0"),
          };

          // Convert database state to trigger detector format
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

          console.log(`Buy trigger result:`, buyTrigger);
          if (buyTrigger.shouldBuy && buyTrigger.buyAmount) {
            console.log(
              `EXECUTING BUY at ${currentPrice} for ${buyTrigger.buyAmount} USDT`,
            );
            // Execute buy with real order placer logic
            const buyResult = await mocks.binance.createOrder({
              symbol: "BTCUSDT",
              side: "BUY",
              type: "MARKET",
              quantity: buyTrigger.buyAmount / currentPrice,
            });

            expect(buyResult.status).toBe("FILLED");

            // Update state after buy (simulating what the bot would do)
            const newBtcAccum =
              (currentState.btc_accumulated || 0) +
              (buyTrigger.buyAmount / currentPrice) * 0.999; // Account for fees
            const newCapital =
              (currentState.capital_available || 0) - buyTrigger.buyAmount;
            const newPurchases = (currentState.purchases_remaining || 0) - 1;

            // Calculate new reference price if we have accumulated BTC
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
            } as CycleState;
            mocks.supabase.setCycleState("test-cycle", newState);
            components.cycleStateManager.updateCachedState(newState);
          }
        }

        // Check for sell trigger using real detector
        if (
          (currentState.status === "HOLDING" ||
            currentState.status === "BUYING") &&
          (currentState.btc_accumulated ?? 0) > 0
        ) {
          // Get current balances for the trigger check
          const btcBalance = await mocks.binance.getBalance("BTC");
          const usdtBalance = await mocks.binance.getBalance("USDT");
          const balances = {
            btcSpot: parseFloat(btcBalance?.free || "0"),
            usdtSpot: parseFloat(usdtBalance?.free || "0"),
          };

          // Convert database state to trigger detector format
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

          console.log(`Sell trigger result:`, sellTrigger);
          if (sellTrigger.shouldSell) {
            console.log(`EXECUTING SELL at ${currentPrice}`);
            // Execute sell with real order placer logic
            const btcAccumulated = currentState.btc_accumulated ?? 0;
            const sellResult = await mocks.binance.createOrder({
              symbol: "BTCUSDT",
              side: "SELL",
              type: "MARKET",
              quantity: btcAccumulated,
            });

            expect(sellResult.status).toBe("FILLED");

            // Update state after sell (cycle complete)
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

      // Process candles sequentially
      const promise = (
        processingPromises[processingPromises.length - 1] || Promise.resolve()
      ).then(() => processCandle());
      processingPromises.push(promise);
    });

    // Wait for all candles to be processed
    await mocks.websocket.waitForCompletion();

    // Wait for all candle processing to complete
    await Promise.all(processingPromises);

    // Verify the cycle completed successfully
    const finalState = await components.cycleStateManager.getCurrentState();
    expect(finalState?.status).toBe("COMPLETED");

    // Verify we made a profit
    const finalCapital = finalState?.capital_available || 0;
    expect(finalCapital).toBeGreaterThan(1000);

    // Verify we processed the expected candles
    expect(candlesProcessed.length).toBe(8); // 8 live candles (10 total - 2 historical)

    // Verify buy orders were placed at grid levels
    // Note: When price drops through multiple grid levels quickly, they are combined into fewer orders
    const buyOrders = mocks.binance
      .getExecutedOrders()
      .filter((o) => o.side === "BUY");
    expect(buyOrders.length).toBeGreaterThanOrEqual(2); // At least 2 buy orders (levels may be combined)

    // Verify sell order was executed
    const sellOrders = mocks.binance
      .getExecutedOrders()
      .filter((o) => o.side === "SELL");
    expect(sellOrders.length).toBe(1);
  });

  it("should handle multiple grid buys correctly", async () => {
    const buyPrices = [99700, 99400, 99100, 98800];
    let totalBTC = 0;

    for (const price of buyPrices) {
      testOrchestrator.mocks.binance.setCurrentPrice(price);
      const order = await testOrchestrator.mocks.binance.createOrder({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: 100 / price, // Buy $100 worth
      });
      expect(order.status).toBe("FILLED");
      totalBTC += (100 / price) * 0.999; // Account for fees
    }

    const btcBalance = await testOrchestrator.mocks.binance.getBalance("BTC");
    expect(parseFloat(btcBalance?.free || "0")).toBeCloseTo(totalBTC, 6);
  });

  it("should emit only live candles from scenario", async () => {
    let candleCount = 0;
    testOrchestrator.mocks.websocket.on("candle", () => {
      candleCount++;
    });

    await testOrchestrator.mocks.websocket.connect();
    await testOrchestrator.mocks.websocket.waitForCompletion();

    // Should emit only the live candles (not the historical ones)
    const expectedLiveCandles = completeCycleScenario.candles.length - 2;
    expect(candleCount).toBe(expectedLiveCandles);
  });

  it("should track state transitions correctly", async () => {
    const { components, mocks } = testOrchestrator;

    // Initialize the state manager
    await components.cycleStateManager.initialize();

    // Test state transitions
    const states: Array<CycleState["status"]> = [
      "READY",
      "BUYING",
      "HOLDING",
      "SELLING",
      "COMPLETED",
    ];

    for (const state of states) {
      const currentState = await components.cycleStateManager.getCurrentState();
      if (!currentState) {
        throw new Error("No current state found");
      }
      const updatedState = { ...currentState, status: state } as CycleState;
      mocks.supabase.setCycleState("test-cycle", updatedState);
      components.cycleStateManager.updateCachedState(updatedState);
      const cycleState = await components.cycleStateManager.getCurrentState();
      expect(cycleState?.status).toBe(state);
    }
  });

  it("should calculate reference price correctly", async () => {
    // Create a reference price calculator instance
    const { ReferencePriceCalculator } = await import(
      "../../../src/cycle/reference-price-calculator.js"
    );
    const referencePriceCalculator = new ReferencePriceCalculator(100000);

    // Use the Purchase interface format expected by the calculator
    const purchases = [
      {
        usdt_spent: 100,
        btc_filled: 0.001,
        fee_usdt: 0,
        fee_btc: 0.000001, // 0.1% fee in BTC
        fill_price: 100000,
      },
      {
        usdt_spent: 99.7,
        btc_filled: 0.001,
        fee_usdt: 0,
        fee_btc: 0.000001, // 0.1% fee in BTC
        fill_price: 99700,
      },
    ];

    const result = referencePriceCalculator.calculateReferencePrice(purchases);

    // Per spec Section 3: When commissionAsset = BASE (BTC), cost = usdt_spent + fee_usdt
    // BTC fees are NOT converted and added to cost
    // Purchase 1: cost = 100 + 0 = 100, btc_net = 0.001 - 0.000001 = 0.000999
    // Purchase 2: cost = 99.7 + 0 = 99.7, btc_net = 0.001 - 0.000001 = 0.000999
    // Total USDT cost: 100 + 99.7 = 199.7
    // Total BTC net (after fees): 0.000999 + 0.000999 = 0.001998
    // Reference price = 199.7 / 0.001998 = 99949.949...
    const expectedRef = (100 + 99.7) / 0.001998;
    expect(result).toBeCloseTo(expectedRef, 1);
  });

  it("should not send Discord notifications in test environment", async () => {
    // Process a complete cycle
    await testOrchestrator.mocks.websocket.connect();
    await testOrchestrator.mocks.websocket.waitForCompletion();

    // Verify no Discord notifications were sent
    expect(testOrchestrator.mocks.discord.getNotificationCount()).toBe(0);
  });
});
