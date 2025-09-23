/**
 * Simple E2E Test to verify infrastructure works
 */

import "../setup/test-env.js";
import { describe, it, expect } from "@jest/globals";
import { MockSupabaseClient } from "../mocks/mock-supabase-client.js";
import { MockDiscordNotifier } from "../mocks/mock-discord-notifier.js";
import { MockBinanceClient } from "../mocks/mock-binance-client.js";
import { MockWebSocketManager } from "../mocks/mock-websocket-manager.js";

describe("E2E Test Infrastructure", () => {
  it("should have test environment configured", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DISCORD_WEBHOOK_URL).toBeFalsy();
    expect(process.env.INITIAL_CAPITAL_USDT).toBe("1000.00");
  });

  it("should create mock instances", () => {
    const mockSupabase = new MockSupabaseClient();
    const mockDiscord = new MockDiscordNotifier();
    const mockBinance = new MockBinanceClient();
    const mockWebSocket = new MockWebSocketManager();

    expect(mockSupabase).toBeDefined();
    expect(mockDiscord).toBeDefined();
    expect(mockBinance).toBeDefined();
    expect(mockWebSocket).toBeDefined();
  });

  it("MockSupabaseClient should handle cycle state", () => {
    const mockSupabase = new MockSupabaseClient();

    // Set cycle state
    mockSupabase.setCycleState("test-cycle", {
      status: "READY",
      capital_available: 1000,
      btc_accumulated: 0,
      purchases_remaining: 10,
    });

    // Get cycle state
    const state = mockSupabase.getCycleState("test-cycle");
    expect(state).toBeDefined();
    expect(state?.status).toBe("READY");
    expect(state?.capital_available).toBe(1000);
  });

  it("MockBinanceClient should execute trades", async () => {
    const mockBinance = new MockBinanceClient({
      initialBalances: { BTC: 0, USDT: 1000 },
    });

    // Check initial balance
    const initialBalances = mockBinance.getMockBalances();
    expect(parseFloat(initialBalances.USDT)).toBe(1000);
    expect(parseFloat(initialBalances.BTC)).toBe(0);

    // Execute a buy order
    mockBinance.setCurrentPrice(100000);
    const order = await mockBinance.createOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.001,
    });

    expect(order).toBeDefined();
    expect(order.status).toBe("FILLED");
    expect(order.side).toBe("BUY");

    // Check balances updated
    const newBalances = mockBinance.getMockBalances();
    expect(parseFloat(newBalances.USDT)).toBeLessThan(1000);
    expect(parseFloat(newBalances.BTC)).toBeGreaterThan(0);
  });

  it("MockWebSocketManager should emit candles", async () => {
    const { MockCandleManager } = await import(
      "../mocks/mock-candle-manager.js"
    );
    const testCandles = [
      {
        openTime: Date.now(),
        open: 100000,
        high: 100100,
        low: 99900,
        close: 100000,
        volume: 10,
        closeTime: Date.now() + 300000,
      },
    ];

    const candleManager = new MockCandleManager(testCandles);
    // All candles will be live (none historical)
    candleManager.setHistoricalCount(0);

    const mockWebSocket = new MockWebSocketManager({
      candleManager: candleManager,
      emitInterval: 0,
    });

    let candleReceived = false;
    mockWebSocket.on("candle", (data) => {
      candleReceived = true;
      expect(data).toBeDefined();
    });

    await mockWebSocket.connect();
    await mockWebSocket.waitForCompletion();

    expect(candleReceived).toBe(true);
  });

  it("MockDiscordNotifier should capture notifications", async () => {
    const mockDiscord = new MockDiscordNotifier();

    // Send notifications
    await mockDiscord.notifyBuyExecution({
      price: 100000,
      amount: 100,
      btcQuantity: 0.001,
      capitalRemaining: 900,
      purchasesRemaining: 9,
      referencePrice: 100000,
    });

    // Check notifications captured
    const notifications = mockDiscord.getNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("buy_execution");
  });
});
