import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { WebSocketServer } from "ws";

// Mock WebSocket server for testing
class MockBinanceServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  async start(port: number): Promise<void> {
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);

      ws.on("close", () => {
        this.clients.delete(ws);
      });
    });
  }

  async stop(): Promise<void> {
    this.clients.forEach((client) => client.close());
    this.clients.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss?.close(() => resolve());
      });
      this.wss = null;
    }
  }

  sendKlineMessage(klineData: unknown): void {
    const message = JSON.stringify(klineData);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  sendClosedCandle(price: string): void {
    const now = Date.now();
    this.sendKlineMessage({
      e: "kline",
      E: now,
      s: "BTCUSDT",
      k: {
        t: now - 60000,
        T: now,
        s: "BTCUSDT",
        i: "1m",
        f: 100,
        L: 200,
        o: price,
        c: price,
        h: price,
        l: price,
        v: "10.50000",
        n: 100,
        x: true, // Closed candle
        q: "525000.00",
        V: "5.25000",
        Q: "262500.00",
        B: "0",
      },
    });
  }

  sendOpenCandle(price: string): void {
    const now = Date.now();
    this.sendKlineMessage({
      e: "kline",
      E: now,
      s: "BTCUSDT",
      k: {
        t: now - 30000,
        T: now + 30000,
        s: "BTCUSDT",
        i: "1m",
        f: 100,
        L: 150,
        o: price,
        c: price,
        h: price,
        l: price,
        v: "5.25000",
        n: 50,
        x: false, // Open candle
        q: "262500.00",
        V: "2.625",
        Q: "131250.00",
        B: "0",
      },
    });
  }

  sendInvalidCandle(): void {
    const now = Date.now();
    this.sendKlineMessage({
      e: "kline",
      E: now,
      s: "BTCUSDT",
      k: {
        t: now - 60000,
        T: now,
        s: "BTCUSDT",
        i: "1m",
        f: 100,
        L: 200,
        o: "-50000.00", // Invalid negative price
        c: "50100.00",
        h: "50150.00",
        l: "49950.00",
        v: "10.50000",
        n: 100,
        x: false,
        q: "525000.00",
        V: "5.25000",
        Q: "262500.00",
        B: "0",
      },
    });
  }
}

test.describe("Candle Processing User Flow", () => {
  let mockServer: MockBinanceServer;

  test.beforeAll(async () => {
    mockServer = new MockBinanceServer();
    await mockServer.start(8080); // Use a test port
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test("user can monitor real-time candle data", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Verify connection status
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send a test candle from mock server
    mockServer.sendOpenCandle("50000.00");

    // Verify candle data appears on dashboard
    await expect(page.locator('[data-testid="current-price"]')).toContainText(
      "50,000.00",
    );
    await expect(page.locator('[data-testid="candle-status"]')).toContainText(
      "Open",
    );

    // Send a closed candle
    mockServer.sendClosedCandle("50100.00");

    // Verify closed candle notification
    await expect(
      page.locator('[data-testid="candle-closed-notification"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="candle-closed-notification"]'),
    ).toContainText("Candle closed at 50,100.00");
  });

  test("system handles invalid candle data gracefully", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send invalid candle data
    mockServer.sendInvalidCandle();

    // System should show error but remain operational
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      "Invalid candle data received",
    );

    // Send valid candle after error
    mockServer.sendOpenCandle("50200.00");

    // System should recover and process valid data
    await expect(page.locator('[data-testid="current-price"]')).toContainText(
      "50,200.00",
    );
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");
  });

  test("user can view candle history", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send multiple candles
    const prices = ["50000.00", "50100.00", "50200.00", "50150.00", "50250.00"];

    for (let i = 0; i < prices.length; i++) {
      if (i % 2 === 0) {
        mockServer.sendClosedCandle(prices[i]);
      } else {
        mockServer.sendOpenCandle(prices[i]);
      }
      // Wait a bit between candles
      await page.waitForTimeout(100);
    }

    // Check candle history table
    const historyRows = page.locator('[data-testid="candle-history-table"] tr');
    await expect(historyRows).toHaveCount(5);

    // Verify last closed candle is highlighted
    const lastClosedRow = page
      .locator('[data-testid="candle-history-table"] tr.closed')
      .last();
    await expect(lastClosedRow).toContainText("50,250.00");
  });

  test("system displays real-time statistics", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send multiple candles with different prices
    mockServer.sendClosedCandle("50000.00");
    await page.waitForTimeout(100);
    mockServer.sendClosedCandle("50500.00");
    await page.waitForTimeout(100);
    mockServer.sendClosedCandle("49500.00");
    await page.waitForTimeout(100);

    // Check statistics are updated
    await expect(page.locator('[data-testid="high-price"]')).toContainText(
      "50,500.00",
    );
    await expect(page.locator('[data-testid="low-price"]')).toContainText(
      "49,500.00",
    );
    await expect(
      page.locator('[data-testid="candles-processed"]'),
    ).toContainText("3");

    // Send an invalid candle
    mockServer.sendInvalidCandle();
    await page.waitForTimeout(100);

    // Error count should update
    await expect(page.locator('[data-testid="error-count"]')).toContainText(
      "1",
    );
    await expect(
      page.locator('[data-testid="candles-processed"]'),
    ).toContainText("4");
  });

  test("user can filter candle data by status", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send mixed candles
    mockServer.sendClosedCandle("50000.00");
    await page.waitForTimeout(50);
    mockServer.sendOpenCandle("50100.00");
    await page.waitForTimeout(50);
    mockServer.sendClosedCandle("50200.00");
    await page.waitForTimeout(50);
    mockServer.sendOpenCandle("50300.00");
    await page.waitForTimeout(50);

    // Filter to show only closed candles
    await page.click('[data-testid="filter-closed-only"]');

    const visibleRows = page.locator(
      '[data-testid="candle-history-table"] tr:visible',
    );
    await expect(visibleRows).toHaveCount(2);

    // All visible rows should be closed candles
    const closedBadges = page.locator(
      '[data-testid="candle-history-table"] tr:visible [data-testid="status-badge"]',
    );
    for (let i = 0; i < (await closedBadges.count()); i++) {
      await expect(closedBadges.nth(i)).toContainText("Closed");
    }

    // Filter to show only open candles
    await page.click('[data-testid="filter-open-only"]');

    await expect(visibleRows).toHaveCount(2);

    // All visible rows should be open candles
    const openBadges = page.locator(
      '[data-testid="candle-history-table"] tr:visible [data-testid="status-badge"]',
    );
    for (let i = 0; i < (await openBadges.count()); i++) {
      await expect(openBadges.nth(i)).toContainText("Open");
    }
  });

  test("system reconnects and resumes processing after disconnection", async ({
    page,
  }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send initial candle
    mockServer.sendClosedCandle("50000.00");
    await expect(page.locator('[data-testid="current-price"]')).toContainText(
      "50,000.00",
    );

    // Simulate disconnection
    await mockServer.stop();

    // Status should show disconnected
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Disconnected");

    // Restart server
    await mockServer.start(8080);

    // System should auto-reconnect
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected", { timeout: 10000 });

    // Send new candle after reconnection
    mockServer.sendClosedCandle("50100.00");

    // Processing should resume
    await expect(page.locator('[data-testid="current-price"]')).toContainText(
      "50,100.00",
    );
  });

  test("user can export candle data", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send multiple candles
    for (let i = 0; i < 5; i++) {
      mockServer.sendClosedCandle(`${50000 + i * 100}.00`);
      await page.waitForTimeout(50);
    }

    // Wait for candles to be processed
    await expect(
      page.locator('[data-testid="candles-processed"]'),
    ).toContainText("5");

    // Click export button
    const downloadPromise = page.waitForEvent("download");
    await page.click('[data-testid="export-candles-button"]');

    // Verify download
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("candles");
    expect(download.suggestedFilename()).toContain(".csv");
  });

  test("system displays processing performance metrics", async ({ page }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send many candles quickly
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        mockServer.sendClosedCandle(`${50000 + i}.00`);
      } else {
        mockServer.sendOpenCandle(`${50000 + i}.00`);
      }
    }

    // Wait for processing
    await page.waitForTimeout(1000);

    // Check performance metrics
    await expect(
      page.locator('[data-testid="candles-per-second"]'),
    ).toBeVisible();
    const cpsText = await page
      .locator('[data-testid="candles-per-second"]')
      .textContent();
    const cpsValue = parseFloat(cpsText?.replace(/[^0-9.]/g, "") || "0");

    // Should process at least 50 candles per second
    expect(cpsValue).toBeGreaterThan(50);

    // Check memory usage display
    await expect(page.locator('[data-testid="memory-usage"]')).toBeVisible();
    await expect(page.locator('[data-testid="memory-usage"]')).toContainText(
      "MB",
    );
  });

  test("user receives alerts for significant price movements", async ({
    page,
  }) => {
    // This will fail - dashboard page doesn't exist yet
    await page.goto("/dashboard");

    // Set alert threshold
    await page.fill('[data-testid="price-alert-threshold"]', "2"); // 2% threshold
    await page.click('[data-testid="enable-alerts-checkbox"]');

    // Connect to WebSocket
    await page.click('[data-testid="connect-websocket-button"]');

    // Wait for connection
    await expect(
      page.locator('[data-testid="connection-status"]'),
    ).toContainText("Connected");

    // Send baseline candle
    mockServer.sendClosedCandle("50000.00");
    await page.waitForTimeout(100);

    // Send candle with significant price increase (> 2%)
    mockServer.sendClosedCandle("51500.00"); // 3% increase

    // Alert should appear
    await expect(page.locator('[data-testid="price-alert"]')).toBeVisible();
    await expect(page.locator('[data-testid="price-alert"]')).toContainText(
      "Price increased by 3.00%",
    );

    // Send candle with significant price decrease
    mockServer.sendClosedCandle("49000.00"); // > 2% decrease from 51500

    // New alert should appear
    await expect(
      page.locator('[data-testid="price-alert"]').last(),
    ).toContainText("Price decreased");
  });
});
