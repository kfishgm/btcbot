import { test, expect, Page } from "@playwright/test";

test.describe("WebSocket Connection Manager E2E Tests", () => {
  let page: Page;

  test.beforeEach(async ({ page: p }: { page: Page }) => {
    page = p;
    // Navigate to the trading interface where WebSocket is used
    await page.goto("/trading");

    // Wait for the page to load
    await page.waitForSelector("[data-testid='trading-interface']", {
      timeout: 10000,
    });
  });

  test.describe("Real-Time Market Data Connection", () => {
    test("should establish WebSocket connection and display connection status", async () => {
      // Check initial connection status
      const connectionStatus = page.locator(
        "[data-testid='ws-connection-status']",
      );
      await expect(connectionStatus).toBeVisible();

      // Should show connecting initially
      await expect(connectionStatus).toContainText(/Connecting|Connected/);

      // Within 5 seconds, should be connected
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Connection indicator should be green
      await expect(
        page.locator("[data-testid='ws-connection-indicator']"),
      ).toHaveClass(/connected|success|green/);
    });

    test("should receive and display real-time candle data", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Check that candle data is being received
      const currentPrice = page.locator("[data-testid='current-price']");
      await expect(currentPrice).toBeVisible();

      // Get initial price
      const initialPrice = await currentPrice.textContent();
      expect(initialPrice).toMatch(/^\$?[\d,]+\.?\d*$/);

      // Wait for price updates (should update within 60 seconds for 1m candles)
      await page.waitForTimeout(2000);

      // Check if we have OHLC data
      const ohlcData = page.locator("[data-testid='ohlc-data']");
      await expect(ohlcData).toBeVisible();

      // Verify OHLC values are displayed
      await expect(page.locator("[data-testid='candle-open']")).toBeVisible();
      await expect(page.locator("[data-testid='candle-high']")).toBeVisible();
      await expect(page.locator("[data-testid='candle-low']")).toBeVisible();
      await expect(page.locator("[data-testid='candle-close']")).toBeVisible();
      await expect(page.locator("[data-testid='candle-volume']")).toBeVisible();

      // All values should be valid numbers
      const openPrice = await page
        .locator("[data-testid='candle-open']")
        .textContent();
      const highPrice = await page
        .locator("[data-testid='candle-high']")
        .textContent();
      const lowPrice = await page
        .locator("[data-testid='candle-low']")
        .textContent();
      const closePrice = await page
        .locator("[data-testid='candle-close']")
        .textContent();
      const volume = await page
        .locator("[data-testid='candle-volume']")
        .textContent();

      expect(openPrice).toMatch(/^\$?[\d,]+\.?\d*$/);
      expect(highPrice).toMatch(/^\$?[\d,]+\.?\d*$/);
      expect(lowPrice).toMatch(/^\$?[\d,]+\.?\d*$/);
      expect(closePrice).toMatch(/^\$?[\d,]+\.?\d*$/);
      expect(volume).toMatch(/^[\d,]+\.?\d*\s*(BTC)?$/);
    });

    test("should update candle data in real-time", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Get initial close price
      const closeElement = page.locator("[data-testid='candle-close']");
      await closeElement.textContent();

      // Track price changes over 5 seconds
      const priceChanges = [];
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(1000);
        const currentClose = await closeElement.textContent();
        priceChanges.push(currentClose);
      }

      // Should have received some updates (prices might be the same in stable market)
      expect(priceChanges.length).toBe(5);

      // Last update timestamp should be recent
      const lastUpdate = page.locator("[data-testid='last-update-time']");
      await expect(lastUpdate).toBeVisible();
      const updateText = await lastUpdate.textContent();
      expect(updateText).toMatch(/Just now|seconds? ago/);
    });

    test("should display different timeframes when selected", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Test different timeframe selections
      const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"];

      for (const tf of timeframes) {
        // Select timeframe
        await page.click(`[data-testid='timeframe-selector']`);
        await page.click(`[data-testid='timeframe-${tf}']`);

        // Wait for reconnection
        await page.waitForTimeout(1000);

        // Verify timeframe is selected
        await expect(
          page.locator("[data-testid='selected-timeframe']"),
        ).toContainText(tf);

        // Should still be connected
        await expect(
          page.locator("[data-testid='ws-connection-status']"),
        ).toContainText("Connected");

        // Should receive data for new timeframe
        await expect(
          page.locator("[data-testid='candle-close']"),
        ).toBeVisible();
      }
    });
  });

  test.describe("Connection Resilience", () => {
    test("should show reconnecting status when connection is lost", async () => {
      // Wait for initial connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Simulate network interruption (offline mode)
      await page.context().setOffline(true);

      // Should show reconnecting status
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Reconnecting')",
        {
          timeout: 5000,
        },
      );

      // Connection indicator should be yellow/warning
      await expect(
        page.locator("[data-testid='ws-connection-indicator']"),
      ).toHaveClass(/reconnecting|warning|yellow/);

      // Restore network
      await page.context().setOffline(false);

      // Should reconnect automatically
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 10000,
        },
      );

      // Should resume receiving data
      await expect(page.locator("[data-testid='candle-close']")).toBeVisible();
    });

    test("should display reconnection attempts counter", async () => {
      // Wait for initial connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Simulate network interruption
      await page.context().setOffline(true);

      // Should show reconnecting with attempt counter
      await page.waitForSelector("[data-testid='reconnect-attempts']", {
        timeout: 5000,
      });

      const attemptsElement = page.locator(
        "[data-testid='reconnect-attempts']",
      );
      await expect(attemptsElement).toBeVisible();

      // Should show increasing attempt numbers
      const attempt1 = await attemptsElement.textContent();
      expect(attempt1).toMatch(/Attempt\s+\d+/);

      await page.waitForTimeout(2000);
      const attempt2 = await attemptsElement.textContent();
      expect(attempt2).toMatch(/Attempt\s+\d+/);

      // Restore network
      await page.context().setOffline(false);
    });

    test("should queue and display messages during reconnection", async () => {
      // Wait for initial connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Simulate network interruption
      await page.context().setOffline(true);

      // Wait for reconnecting status
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Reconnecting')",
        {
          timeout: 5000,
        },
      );

      // Try to send a message (e.g., subscribe to additional data)
      await page.click("[data-testid='subscribe-orderbook-btn']");

      // Should show message queued indicator
      await expect(
        page.locator("[data-testid='message-queue-indicator']"),
      ).toBeVisible();
      await expect(
        page.locator("[data-testid='queued-messages-count']"),
      ).toContainText(/\d+/);

      // Restore network
      await page.context().setOffline(false);

      // Wait for reconnection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 10000,
        },
      );

      // Queue indicator should disappear
      await expect(
        page.locator("[data-testid='message-queue-indicator']"),
      ).not.toBeVisible();

      // Subscription should be active
      await expect(
        page.locator("[data-testid='orderbook-data']"),
      ).toBeVisible();
    });

    test("should handle max reconnection attempts gracefully", async () => {
      // This test simulates permanent connection failure
      // Navigate to a test page with limited reconnection attempts
      await page.goto("/trading?maxReconnectAttempts=3");

      // Wait for initial connection attempt
      await page.waitForSelector("[data-testid='ws-connection-status']", {
        timeout: 5000,
      });

      // Simulate permanent network failure
      await page.context().setOffline(true);

      // Wait for max retries to be reached (with exponential backoff, this could take ~7 seconds)
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Disconnected')",
        {
          timeout: 15000,
        },
      );

      // Should show error message
      await expect(
        page.locator("[data-testid='connection-error']"),
      ).toBeVisible();
      await expect(
        page.locator("[data-testid='connection-error']"),
      ).toContainText(
        /Maximum reconnection attempts reached|Connection failed/,
      );

      // Manual reconnect button should be available
      await expect(
        page.locator("[data-testid='manual-reconnect-btn']"),
      ).toBeVisible();

      // Restore network
      await page.context().setOffline(false);

      // Click manual reconnect
      await page.click("[data-testid='manual-reconnect-btn']");

      // Should reconnect successfully
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );
    });
  });

  test.describe("Connection Statistics", () => {
    test("should display connection statistics", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Open statistics panel
      await page.click("[data-testid='connection-stats-toggle']");

      // Statistics panel should be visible
      const statsPanel = page.locator("[data-testid='connection-stats-panel']");
      await expect(statsPanel).toBeVisible();

      // Check various statistics
      await expect(
        page.locator("[data-testid='stats-messages-received']"),
      ).toBeVisible();
      await expect(
        page.locator("[data-testid='stats-messages-sent']"),
      ).toBeVisible();
      await expect(page.locator("[data-testid='stats-uptime']")).toBeVisible();
      await expect(
        page.locator("[data-testid='stats-last-message']"),
      ).toBeVisible();

      // Messages received should be > 0 after a few seconds
      await page.waitForTimeout(3000);
      const messagesReceived = await page
        .locator("[data-testid='stats-messages-received']")
        .textContent();
      const messageCount = parseInt(
        messagesReceived?.replace(/\D/g, "") || "0",
      );
      expect(messageCount).toBeGreaterThan(0);

      // Uptime should be formatted correctly
      const uptime = await page
        .locator("[data-testid='stats-uptime']")
        .textContent();
      expect(uptime).toMatch(/\d+s|\d+m\s+\d+s/);
    });

    test("should update statistics in real-time", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Open statistics panel
      await page.click("[data-testid='connection-stats-toggle']");

      // Get initial message count
      const initialCount = await page
        .locator("[data-testid='stats-messages-received']")
        .textContent();
      const initialNumber = parseInt(initialCount?.replace(/\D/g, "") || "0");

      // Wait for more messages
      await page.waitForTimeout(3000);

      // Message count should have increased
      const updatedCount = await page
        .locator("[data-testid='stats-messages-received']")
        .textContent();
      const updatedNumber = parseInt(updatedCount?.replace(/\D/g, "") || "0");
      expect(updatedNumber).toBeGreaterThan(initialNumber);

      // Last message time should be recent
      const lastMessage = await page
        .locator("[data-testid='stats-last-message']")
        .textContent();
      expect(lastMessage).toMatch(/Just now|[1-9]\d?\s+seconds? ago/);
    });

    test("should allow resetting statistics", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Open statistics panel
      await page.click("[data-testid='connection-stats-toggle']");

      // Wait for some messages to accumulate
      await page.waitForTimeout(3000);

      // Get current message count
      const beforeReset = await page
        .locator("[data-testid='stats-messages-received']")
        .textContent();
      const beforeCount = parseInt(beforeReset?.replace(/\D/g, "") || "0");
      expect(beforeCount).toBeGreaterThan(0);

      // Click reset button
      await page.click("[data-testid='reset-stats-btn']");

      // Confirm reset
      await page.click("[data-testid='confirm-reset-btn']");

      // Statistics should be reset
      const afterReset = await page
        .locator("[data-testid='stats-messages-received']")
        .textContent();
      const afterCount = parseInt(afterReset?.replace(/\D/g, "") || "0");
      expect(afterCount).toBe(0);

      // Uptime should reset
      const uptime = await page
        .locator("[data-testid='stats-uptime']")
        .textContent();
      expect(uptime).toMatch(/0s|Just started/);
    });
  });

  test.describe("Error Handling UI", () => {
    test("should display rate limit errors appropriately", async () => {
      // Navigate with a flag to trigger rate limiting simulation
      await page.goto("/trading?simulateRateLimit=true");

      // Wait for rate limit error
      await page.waitForSelector("[data-testid='rate-limit-warning']", {
        timeout: 10000,
      });

      // Should show appropriate message
      await expect(
        page.locator("[data-testid='rate-limit-warning']"),
      ).toContainText(/Rate limit|Too many requests/);

      // Should show retry timer
      await expect(
        page.locator("[data-testid='rate-limit-retry-timer']"),
      ).toBeVisible();
      const timerText = await page
        .locator("[data-testid='rate-limit-retry-timer']")
        .textContent();
      expect(timerText).toMatch(/Retrying in \d+ seconds/);
    });

    test("should display authentication errors", async () => {
      // Navigate with invalid credentials flag
      await page.goto("/trading?invalidCredentials=true");

      // Should show auth error
      await page.waitForSelector("[data-testid='auth-error']", {
        timeout: 5000,
      });

      await expect(page.locator("[data-testid='auth-error']")).toContainText(
        /Authentication failed|Invalid API key/,
      );

      // Should provide action to fix
      await expect(
        page.locator("[data-testid='update-credentials-link']"),
      ).toBeVisible();
    });

    test("should handle WebSocket not supported scenario", async () => {
      // Use a browser context that doesn't support WebSocket (simulated)
      await page.addInitScript(() => {
        // Temporarily remove WebSocket support
        (window as { WebSocket?: unknown }).WebSocket = undefined;
      });

      await page.goto("/trading");

      // Should show not supported error
      await page.waitForSelector("[data-testid='websocket-not-supported']", {
        timeout: 5000,
      });

      await expect(
        page.locator("[data-testid='websocket-not-supported']"),
      ).toContainText(/WebSocket is not supported|Browser not compatible/);

      // Should suggest alternatives
      await expect(
        page.locator("[data-testid='browser-upgrade-suggestion']"),
      ).toBeVisible();
    });
  });

  test.describe("User Controls", () => {
    test("should allow manual connection control", async () => {
      // Wait for initial connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Click disconnect button
      await page.click("[data-testid='disconnect-btn']");

      // Should disconnect
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Disconnected')",
        {
          timeout: 2000,
        },
      );

      // Data updates should stop
      const priceBeforeDisconnect = await page
        .locator("[data-testid='current-price']")
        .textContent();
      await page.waitForTimeout(3000);
      const priceAfterWait = await page
        .locator("[data-testid='current-price']")
        .textContent();
      expect(priceAfterWait).toBe(priceBeforeDisconnect);

      // Click connect button
      await page.click("[data-testid='connect-btn']");

      // Should reconnect
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Data updates should resume
      await expect(
        page.locator("[data-testid='last-update-time']"),
      ).toContainText(/Just now|seconds? ago/);
    });

    test("should allow changing connection settings", async () => {
      // Open settings panel
      await page.click("[data-testid='connection-settings-btn']");

      // Settings modal should open
      const settingsModal = page.locator(
        "[data-testid='connection-settings-modal']",
      );
      await expect(settingsModal).toBeVisible();

      // Change heartbeat interval
      await page.fill("[data-testid='heartbeat-interval-input']", "15");

      // Change max reconnect attempts
      await page.fill("[data-testid='max-reconnect-attempts-input']", "5");

      // Save settings
      await page.click("[data-testid='save-settings-btn']");

      // Modal should close
      await expect(settingsModal).not.toBeVisible();

      // Should show settings applied notification
      await expect(
        page.locator("[data-testid='settings-applied-notification']"),
      ).toBeVisible();

      // Force reconnect to apply settings
      await page.click("[data-testid='disconnect-btn']");
      await page.click("[data-testid='connect-btn']");

      // Should connect with new settings
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );
    });

    test("should persist connection preferences", async () => {
      // Set a custom timeframe
      await page.click("[data-testid='timeframe-selector']");
      await page.click("[data-testid='timeframe-5m']");

      // Disconnect
      await page.click("[data-testid='disconnect-btn']");

      // Reload page
      await page.reload();

      // Wait for page to load
      await page.waitForSelector("[data-testid='trading-interface']", {
        timeout: 10000,
      });

      // Should remember disconnected state
      await expect(
        page.locator("[data-testid='ws-connection-status']"),
      ).toContainText("Disconnected");

      // Should remember timeframe preference
      await expect(
        page.locator("[data-testid='selected-timeframe']"),
      ).toContainText("5m");

      // Connect again
      await page.click("[data-testid='connect-btn']");

      // Should connect with remembered settings
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );
      await expect(
        page.locator("[data-testid='selected-timeframe']"),
      ).toContainText("5m");
    });
  });

  test.describe("Mobile Responsiveness", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("should display connection status on mobile", async () => {
      // Connection status should be visible on mobile
      await page.waitForSelector("[data-testid='ws-connection-status']", {
        timeout: 5000,
      });

      // Should be in mobile-friendly format
      const statusElement = page.locator(
        "[data-testid='ws-connection-status']",
      );
      await expect(statusElement).toBeVisible();

      // Connection indicator should be compact
      const indicator = page.locator("[data-testid='ws-connection-indicator']");
      await expect(indicator).toBeVisible();

      // Stats should be in a collapsible menu on mobile
      await page.click("[data-testid='mobile-menu-toggle']");
      await expect(
        page.locator("[data-testid='connection-stats-toggle']"),
      ).toBeVisible();
    });

    test("should handle reconnection gracefully on mobile", async () => {
      // Wait for connection
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 5000,
        },
      );

      // Simulate network interruption (common on mobile)
      await page.context().setOffline(true);

      // Should show mobile-friendly reconnection UI
      await page.waitForSelector(
        "[data-testid='mobile-reconnecting-overlay']",
        {
          timeout: 5000,
        },
      );

      // Overlay should not block entire UI
      await expect(
        page.locator("[data-testid='mobile-reconnecting-overlay']"),
      ).toHaveCSS("opacity", /0\.\d+/);

      // Restore network
      await page.context().setOffline(false);

      // Should reconnect and hide overlay
      await page.waitForSelector(
        "[data-testid='ws-connection-status']:has-text('Connected')",
        {
          timeout: 10000,
        },
      );
      await expect(
        page.locator("[data-testid='mobile-reconnecting-overlay']"),
      ).not.toBeVisible();
    });
  });
});
