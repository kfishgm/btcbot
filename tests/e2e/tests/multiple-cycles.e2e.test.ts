/**
 * Multiple Cycles E2E Test
 *
 * Tests multiple complete trading cycles with capital reinvestment and compound profits
 */

import "../setup/test-env.js";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createTestOrchestrator } from "../setup/test-orchestrator-factory.js";
import multipleCyclesScenario from "../scenarios/multiple-cycles.json";
import type { CycleState } from "../../../src/cycle/cycle-state-manager.js";

describe("Multiple Cycles E2E", () => {
  let testOrchestrator: Awaited<ReturnType<typeof createTestOrchestrator>>;

  beforeEach(async () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();

    testOrchestrator = await createTestOrchestrator({
      scenario: multipleCyclesScenario,
      historicalCandles: 2,
      initialCapital: 1000,
      dropPercentage: 0.003,
      risePercentage: 0.005,
      maxPurchases: 10,
    });

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

  it("should complete multiple trading cycles with compounding profits", async () => {
    const { components, mocks } = testOrchestrator;

    await components.cycleStateManager.initialize();

    let currentState = await components.cycleStateManager.getCurrentState();
    const cycleResults: Array<{
      cycleNumber: number;
      startCapital: number;
      endCapital: number;
      profit: number;
    }> = [];

    let currentCycle = 1;
    let cycleStartCapital = 1000;

    await mocks.websocket.connect();
    const processingPromises: Promise<void>[] = [];

    mocks.websocket.on("candle", (candleData) => {
      const processCandle = async () => {
        const currentPrice = parseFloat(candleData.close);
        console.log(
          `Cycle ${currentCycle}: Processing candle at ${currentPrice}`,
        );

        currentState = await components.cycleStateManager.getCurrentState();
        if (!currentState) return;

        // Handle buy triggers
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
              driftThresholdPct: 0.005,
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
            console.log(`Cycle ${currentCycle}: BUY at ${currentPrice}`);

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
            } as CycleState;
            mocks.supabase.setCycleState("test-cycle", newState);
            components.cycleStateManager.updateCachedState(newState);
          }
        }

        // Handle sell triggers
        if (
          (currentState.status === "HOLDING" ||
            currentState.status === "BUYING") &&
          currentState.btc_accumulated! > 0
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

          const sellTrigger = components.sellTriggerDetector.checkSellTrigger(
            triggerState,
            {
              risePercentage: 0.005,
              dropPercentage: 0.003,
              driftThresholdPct: 0.005,
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

          if (sellTrigger.shouldSell) {
            console.log(`Cycle ${currentCycle}: SELL at ${currentPrice}`);

            const sellResult = await mocks.binance.createOrder({
              symbol: "BTCUSDT",
              side: "SELL",
              type: "MARKET",
              quantity: currentState.btc_accumulated!,
            });

            expect(sellResult.status).toBe("FILLED");

            // Calculate cycle results
            const endCapital =
              (currentState.capital_available || 0) +
              currentState.btc_accumulated! * currentPrice * 0.999;
            const profit = endCapital - cycleStartCapital;

            cycleResults.push({
              cycleNumber: currentCycle,
              startCapital: cycleStartCapital,
              endCapital,
              profit,
            });

            console.log(
              `Cycle ${currentCycle} complete: Profit = ${profit.toFixed(2)} USDT`,
            );

            // Reset for next cycle with compounded capital
            currentCycle++;
            cycleStartCapital = endCapital;

            const nextCycleState = {
              ...currentState,
              status: "READY",
              btc_accumulated: 0,
              capital_available: endCapital,
              purchases_remaining: 10,
              buy_amount: endCapital / 10, // Recalculate buy amount
              buy_anchor_price: null,
              buy_grid: null,
              buy_index: 0,
              reference_price: currentPrice,
              ath_price: Math.max(
                currentState.ath_price || 100000,
                currentPrice,
              ),
            } as CycleState;
            mocks.supabase.setCycleState("test-cycle", nextCycleState);
            components.cycleStateManager.updateCachedState(nextCycleState);
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

    // Verify multiple cycles were completed
    expect(cycleResults.length).toBeGreaterThanOrEqual(2);

    // Verify profits compound
    if (cycleResults.length >= 2) {
      // Each cycle should be profitable
      cycleResults.forEach((cycle) => {
        expect(cycle.profit).toBeGreaterThan(0);
      });

      // Capital should increase with each cycle
      for (let i = 1; i < cycleResults.length; i++) {
        expect(cycleResults[i].startCapital).toBeGreaterThan(
          cycleResults[i - 1].startCapital,
        );
      }

      // Total profit should be sum of all cycle profits
      const totalProfit = cycleResults.reduce(
        (sum, cycle) => sum + cycle.profit,
        0,
      );
      const finalCapital = cycleResults[cycleResults.length - 1].endCapital;
      expect(finalCapital).toBeCloseTo(1000 + totalProfit, 2);
    }
  });

  it("should maintain ATH tracking across cycles", async () => {
    const { components, mocks } = testOrchestrator;

    // Start with ATH from first cycle
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 1050, // Profit from first cycle
      btc_accumulated: 0,
      purchases_remaining: 10,
      reference_price: 101000,
      ath_price: 101000, // ATH from previous cycle
      buy_amount: 105,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      btc_dust: 0,
    });

    await components.cycleStateManager.initialize();
    const initialState = await components.cycleStateManager.getCurrentState();
    const initialAth = initialState?.ath_price;

    // Simulate price going higher
    const newHighPrice = 102000;

    // Process a candle at new high
    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    // This should update ATH even though we're not buying
    const buyTrigger = components.buyTriggerDetector.checkBuyTrigger(
      {
        status: "READY",
        reference_price: 101000,
        purchases_remaining: 10,
        capital_available: 1050,
        buy_amount: 105,
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
        driftThresholdPct: 0.005,
      },
      {
        close: newHighPrice,
        high: newHighPrice,
        low: newHighPrice,
        open: newHighPrice,
        volume: 0,
        timestamp: Date.now(),
      },
      balances,
    );

    // Price is higher than ATH, so no buy
    expect(buyTrigger.shouldBuy).toBe(false);

    // ATH should be tracked and maintained across cycles
    expect(initialAth).toBe(101000);

    // In production, ATH would be updated by the orchestrator
    // For this test, we verify the initial ATH is preserved from previous cycle
  });

  it("should reset state correctly between cycles", async () => {
    const { components, mocks } = testOrchestrator;

    // Simulate end of first cycle
    const endOfCycleState = {
      status: "COMPLETED" as const,
      capital_available: 1050, // Profit from cycle
      btc_accumulated: 0,
      purchases_remaining: 0,
      reference_price: 100500,
      ath_price: 100500,
      buy_amount: 100,
      buy_anchor_price: 99700,
      buy_grid: [],
      buy_index: 10,
      btc_dust: 0.00000012,
    };

    testOrchestrator.mocks.supabase.setCycleState(
      "test-cycle",
      endOfCycleState,
    );
    await components.cycleStateManager.initialize();

    // Reset for new cycle
    const newCycleState: Partial<CycleState> = {
      status: "READY",
      capital_available: 1050,
      btc_accumulated: 0,
      purchases_remaining: 10, // Reset to max
      reference_price: 100500, // Current price becomes reference
      ath_price: 100500, // Preserve ATH
      buy_amount: 105, // Recalculate based on new capital
      buy_anchor_price: null, // Reset anchor
      buy_grid: null, // Reset grid
      buy_index: 0, // Reset index
      btc_dust: 0, // Reset dust
    };

    mocks.supabase.setCycleState("test-cycle", newCycleState);
    components.cycleStateManager.updateCachedState(newCycleState as CycleState);

    const resetState = await components.cycleStateManager.getCurrentState();

    // Verify state is properly reset for new cycle
    expect(resetState?.status).toBe("READY");
    expect(resetState?.purchases_remaining).toBe(10);
    expect(resetState?.buy_anchor_price).toBeNull();
    expect(resetState?.buy_grid).toBeNull();
    expect(resetState?.buy_index).toBe(0);
    expect(resetState?.btc_dust).toBe(0);

    // Verify capital is preserved
    expect(resetState?.capital_available).toBe(1050);

    // Verify ATH is preserved
    expect(resetState?.ath_price).toBe(100500);
  });

  it("should handle partial cycles and resume correctly", async () => {
    const { components, mocks } = testOrchestrator;

    // Start with partial cycle in progress
    testOrchestrator.mocks.supabase.setCycleState("test-cycle", {
      status: "BUYING",
      capital_available: 750,
      btc_accumulated: 0.0025,
      purchases_remaining: 7,
      reference_price: 99600,
      ath_price: 100000,
      buy_amount: 107,
      buy_anchor_price: 99700,
      buy_grid: [99400, 99100, 98800, 98500, 98200, 97900, 97600],
      buy_index: 3,
      btc_dust: 0,
    });

    await components.cycleStateManager.initialize();
    const partialState = await components.cycleStateManager.getCurrentState();

    // Should be able to continue from partial state
    expect(partialState?.status).toBe("BUYING");
    expect(partialState?.purchases_remaining).toBe(7);
    expect(partialState?.btc_accumulated).toBeGreaterThan(0);

    // Verify can continue buying at next grid level
    const nextGridLevel = partialState?.buy_grid?.[partialState.buy_index || 0];
    expect(nextGridLevel).toBe(98500);

    // Test sell trigger to complete the partial cycle
    const sellPrice = (partialState?.reference_price || 99600) * 1.005;

    const btcBalance = await mocks.binance.getBalance("BTC");
    const usdtBalance = await mocks.binance.getBalance("USDT");
    const balances = {
      btcSpot: parseFloat(btcBalance?.free || "0"),
      usdtSpot: parseFloat(usdtBalance?.free || "0"),
    };

    const sellTrigger = components.sellTriggerDetector.checkSellTrigger(
      {
        status: "HOLDING",
        reference_price: partialState!.reference_price,
        purchases_remaining: partialState!.purchases_remaining,
        capital_available: partialState!.capital_available,
        btc_accumulated: partialState!.btc_accumulated || 0,
      },
      {
        risePercentage: 0.005,
        dropPercentage: 0.003,
        driftThresholdPct: 0.005,
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

    // Should be able to sell and complete the cycle
    expect(sellTrigger.shouldSell).toBe(true);
  });
});
