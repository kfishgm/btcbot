import { test, expect } from "@playwright/test";

test.describe("State Transaction Manager E2E", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to bot management page
    await page.goto("/bot-management");

    // Ensure we have a test bot running
    const hasBotRunning = await page
      .locator('[data-testid="bot-status-running"]')
      .isVisible();
    if (!hasBotRunning) {
      await page.click('[data-testid="create-bot-button"]');
      await page.fill('[data-testid="bot-name-input"]', "Test Transaction Bot");
      await page.click('[data-testid="bot-create-submit"]');
      await page.click('[data-testid="bot-start-button"]');
    }
  });

  test.describe("Atomic State Updates", () => {
    test("should update bot state atomically when trading", async ({
      page,
    }) => {
      // Navigate to trading interface
      await page.click('[data-testid="bot-trading-view"]');

      // Place a trade order
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Verify state was updated atomically
      await expect(
        page.locator('[data-testid="bot-position-type"]'),
      ).toContainText("LONG");
      await expect(
        page.locator('[data-testid="bot-position-size"]'),
      ).toContainText("0.001");
      await expect(
        page.locator('[data-testid="bot-entry-price"]'),
      ).toContainText("50000");

      // All fields should update together, not partially
      const updateTime = await page
        .locator('[data-testid="state-update-time"]')
        .textContent();
      expect(updateTime).toBeTruthy();
    });

    test("should rollback all changes if update fails", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Get current state
      const initialPrice = await page
        .locator('[data-testid="bot-current-price"]')
        .textContent();
      const initialPosition = await page
        .locator('[data-testid="bot-position-type"]')
        .textContent();

      // Try to place an invalid trade (e.g., negative amount)
      await page.fill('[data-testid="trade-amount-input"]', "-1");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should show error
      await expect(page.locator('[data-testid="error-message"]')).toContainText(
        "Invalid trade amount",
      );

      // State should remain unchanged
      await expect(
        page.locator('[data-testid="bot-current-price"]'),
      ).toContainText(initialPrice ?? "");
      await expect(
        page.locator('[data-testid="bot-position-type"]'),
      ).toContainText(initialPosition ?? "");
    });
  });

  test.describe("Write-Ahead Logging", () => {
    test("should save state before placing orders", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Enable debug mode to see WAL entries
      await page.click('[data-testid="debug-mode-toggle"]');

      // Place a trade
      await page.fill('[data-testid="trade-amount-input"]', "0.002");
      await page.fill('[data-testid="trade-price-input"]', "51000");
      await page.click('[data-testid="trade-submit-button"]');

      // Check WAL entry was created
      await page.click('[data-testid="view-wal-logs"]');
      await expect(
        page.locator('[data-testid="wal-entry-latest"]'),
      ).toContainText("write_ahead_log");
      await expect(
        page.locator('[data-testid="wal-status-latest"]'),
      ).toContainText("completed");

      // Verify order was placed after WAL
      const walTime = await page
        .locator('[data-testid="wal-timestamp-latest"]')
        .getAttribute("data-timestamp");
      const orderTime = await page
        .locator('[data-testid="order-timestamp-latest"]')
        .getAttribute("data-timestamp");

      expect(Number(walTime)).toBeLessThan(Number(orderTime));
    });

    test("should recover from incomplete WAL on restart", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Simulate a crash during order placement
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "52000");

      // Use special test mode to simulate crash
      await page.evaluate(() => {
        window.localStorage.setItem("test-mode-crash-on-order", "true");
      });

      await page.click('[data-testid="trade-submit-button"]');

      // Bot should show as crashed
      await expect(page.locator('[data-testid="bot-status"]')).toContainText(
        "crashed",
      );

      // Restart the bot
      await page.click('[data-testid="bot-restart-button"]');

      // Should recover and show WAL recovery message
      await expect(
        page.locator('[data-testid="recovery-message"]'),
      ).toContainText("Recovered from incomplete transaction");

      // WAL should be marked as abandoned
      await page.click('[data-testid="view-wal-logs"]');
      await expect(
        page.locator('[data-testid="wal-status-latest"]'),
      ).toContainText("abandoned");
    });
  });

  test.describe("Optimistic Locking", () => {
    test("should handle concurrent updates with version control", async ({
      page,
      context,
    }) => {
      // Open two tabs to simulate concurrent access
      const page2 = await context.newPage();

      // Navigate both to the same bot
      await page.goto("/bot-management");
      await page2.goto("/bot-management");

      await page.click('[data-testid="bot-trading-view"]');
      await page2.click('[data-testid="bot-trading-view"]');

      // Try to update from both tabs simultaneously
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");

      await page2.fill('[data-testid="trade-amount-input"]', "0.002");
      await page2.fill('[data-testid="trade-price-input"]', "51000");

      // Submit both at nearly the same time
      await Promise.all([
        page.click('[data-testid="trade-submit-button"]'),
        page2.click('[data-testid="trade-submit-button"]'),
      ]);

      // One should succeed, one should fail with version conflict
      const page1Error = await page
        .locator('[data-testid="error-message"]')
        .isVisible();
      const page2Error = await page2
        .locator('[data-testid="error-message"]')
        .isVisible();

      // Exactly one should have an error
      expect(page1Error !== page2Error).toBeTruthy();

      if (page1Error) {
        await expect(
          page.locator('[data-testid="error-message"]'),
        ).toContainText("version conflict");
      } else {
        await expect(
          page2.locator('[data-testid="error-message"]'),
        ).toContainText("version conflict");
      }

      // Check version was incremented for successful update
      const version = await page
        .locator('[data-testid="state-version"]')
        .textContent();
      expect(Number(version)).toBeGreaterThan(0);
    });

    test("should retry on version conflict", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Enable auto-retry mode
      await page.click('[data-testid="settings-button"]');
      await page.check('[data-testid="auto-retry-conflicts"]');
      await page.click('[data-testid="settings-save"]');

      // Simulate a version conflict scenario
      await page.evaluate(() => {
        window.localStorage.setItem("test-mode-force-version-conflict", "once");
      });

      // Place trade
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should show retry indicator briefly
      await expect(
        page.locator('[data-testid="retry-indicator"]'),
      ).toBeVisible();

      // But should ultimately succeed
      await expect(
        page.locator('[data-testid="success-message"]'),
      ).toContainText("Trade placed successfully");
      await expect(
        page.locator('[data-testid="bot-position-size"]'),
      ).toContainText("0.001");
    });
  });

  test.describe("Retry Logic", () => {
    test("should retry on deadlock with exponential backoff", async ({
      page,
    }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Enable retry monitoring
      await page.click('[data-testid="debug-mode-toggle"]');

      // Simulate deadlock scenario
      await page.evaluate(() => {
        window.localStorage.setItem("test-mode-deadlock-count", "2");
      });

      const startTime = Date.now();

      // Place trade
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should show retry attempts
      await expect(
        page.locator('[data-testid="retry-attempt-1"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="retry-attempt-2"]'),
      ).toBeVisible();

      // Should eventually succeed
      await expect(
        page.locator('[data-testid="success-message"]'),
      ).toContainText("Trade placed successfully");

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should have taken time for exponential backoff (at least 300ms for 2 retries with 100ms initial)
      expect(duration).toBeGreaterThan(300);
    });

    test("should fail after max retries exceeded", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Simulate persistent deadlock
      await page.evaluate(() => {
        window.localStorage.setItem("test-mode-persistent-deadlock", "true");
      });

      // Set max retries to 3
      await page.click('[data-testid="settings-button"]');
      await page.fill('[data-testid="max-retries-input"]', "3");
      await page.click('[data-testid="settings-save"]');

      // Try to place trade
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should show all retry attempts
      await expect(
        page.locator('[data-testid="retry-attempt-1"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="retry-attempt-2"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="retry-attempt-3"]'),
      ).toBeVisible();

      // Should fail with max retries error
      await expect(page.locator('[data-testid="error-message"]')).toContainText(
        "Max retries exceeded",
      );

      // Clear test mode
      await page.evaluate(() => {
        window.localStorage.removeItem("test-mode-persistent-deadlock");
      });
    });
  });

  test.describe("Audit Trail", () => {
    test("should log all state changes", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Place a trade
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // View audit log
      await page.click('[data-testid="view-audit-log"]');

      // Should have state change entry
      await expect(
        page.locator('[data-testid="audit-entry-latest"]'),
      ).toContainText("state_change");

      // Should show before and after values
      await page.click('[data-testid="audit-entry-latest"]');
      await expect(
        page.locator('[data-testid="audit-details-before"]'),
      ).toContainText("positionType: NONE");
      await expect(
        page.locator('[data-testid="audit-details-after"]'),
      ).toContainText("positionType: LONG");
      await expect(
        page.locator('[data-testid="audit-details-changes"]'),
      ).toContainText("positionSize: 0.001");
    });

    test("should log failed attempts and rollbacks", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Try invalid trade
      await page.fill('[data-testid="trade-amount-input"]', "-1");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // View audit log
      await page.click('[data-testid="view-audit-log"]');

      // Should have failed attempt entry
      await expect(
        page.locator('[data-testid="audit-entry-latest"]'),
      ).toContainText("state_change_failed");

      // Should show error details
      await page.click('[data-testid="audit-entry-latest"]');
      await expect(
        page.locator('[data-testid="audit-error-message"]'),
      ).toContainText("Invalid trade amount");
      await expect(
        page.locator('[data-testid="audit-rollback-status"]'),
      ).toContainText("rolled back");
    });

    test("should log version conflicts", async ({ page, context }) => {
      // Create concurrent update scenario
      const page2 = await context.newPage();

      await page.goto("/bot-management");
      await page2.goto("/bot-management");

      await page.click('[data-testid="bot-trading-view"]');
      await page2.click('[data-testid="bot-trading-view"]');

      // Submit conflicting updates
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page2.fill('[data-testid="trade-amount-input"]', "0.002");

      await Promise.all([
        page.click('[data-testid="trade-submit-button"]'),
        page2.click('[data-testid="trade-submit-button"]'),
      ]);

      // View audit log
      await page.click('[data-testid="view-audit-log"]');

      // Should have version conflict entry
      const entries = await page
        .locator('[data-testid^="audit-entry-"]')
        .count();
      let hasVersionConflict = false;

      for (let i = 0; i < entries; i++) {
        const text = await page
          .locator(`[data-testid="audit-entry-${i}"]`)
          .textContent();
        if (text?.includes("version_conflict")) {
          hasVersionConflict = true;
          break;
        }
      }

      expect(hasVersionConflict).toBeTruthy();
    });
  });

  test.describe("Transaction Isolation", () => {
    test("should use proper isolation for critical updates", async ({
      page,
    }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Enable critical mode for high-value trades
      await page.click('[data-testid="settings-button"]');
      await page.check('[data-testid="critical-mode"]');
      await page.click('[data-testid="settings-save"]');

      // Place a high-value trade
      await page.fill('[data-testid="trade-amount-input"]', "1.0");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should show serializable isolation indicator
      await expect(
        page.locator('[data-testid="isolation-level"]'),
      ).toContainText("SERIALIZABLE");

      // Trade should complete successfully
      await expect(
        page.locator('[data-testid="success-message"]'),
      ).toContainText("Trade placed successfully");
    });

    test("should handle serialization failures gracefully", async ({
      page,
    }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Simulate serialization failure
      await page.evaluate(() => {
        window.localStorage.setItem("test-mode-serialization-failure", "once");
      });

      // Enable critical mode
      await page.click('[data-testid="settings-button"]');
      await page.check('[data-testid="critical-mode"]');
      await page.click('[data-testid="settings-save"]');

      // Place trade
      await page.fill('[data-testid="trade-amount-input"]', "0.5");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should retry and succeed
      await expect(
        page.locator('[data-testid="retry-indicator"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="success-message"]'),
      ).toContainText("Trade placed successfully");
    });
  });

  test.describe("Performance Features", () => {
    test("should batch multiple updates efficiently", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Enable batch mode
      await page.click('[data-testid="batch-mode-toggle"]');

      // Queue multiple updates
      await page.fill('[data-testid="batch-trade-1-amount"]', "0.001");
      await page.fill('[data-testid="batch-trade-1-price"]', "50000");

      await page.fill('[data-testid="batch-trade-2-amount"]', "0.002");
      await page.fill('[data-testid="batch-trade-2-price"]', "51000");

      await page.fill('[data-testid="batch-trade-3-amount"]', "0.003");
      await page.fill('[data-testid="batch-trade-3-price"]', "52000");

      // Submit batch
      const startTime = Date.now();
      await page.click('[data-testid="batch-submit-button"]');

      // Should process as single transaction
      await expect(page.locator('[data-testid="batch-status"]')).toContainText(
        "Processed 3 trades in 1 transaction",
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should be faster than individual transactions (less than 1 second)
      expect(duration).toBeLessThan(1000);

      // All trades should be reflected
      await expect(
        page.locator('[data-testid="total-position-size"]'),
      ).toContainText("0.006");
    });

    test("should use prepared statements for repeated operations", async ({
      page,
    }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Enable performance monitoring
      await page.click('[data-testid="debug-mode-toggle"]');

      // Place multiple similar trades
      for (let i = 0; i < 3; i++) {
        await page.fill('[data-testid="trade-amount-input"]', "0.001");
        await page.fill(
          '[data-testid="trade-price-input"]',
          String(50000 + i * 1000),
        );
        await page.click('[data-testid="trade-submit-button"]');

        // Wait for completion
        await expect(
          page.locator('[data-testid="success-message"]'),
        ).toBeVisible();
        await page.click('[data-testid="clear-message"]');
      }

      // Check performance stats
      await page.click('[data-testid="view-performance-stats"]');

      // Should show prepared statement usage
      await expect(
        page.locator('[data-testid="prepared-statements-used"]'),
      ).toContainText("Yes");
      await expect(
        page.locator('[data-testid="statement-reuse-count"]'),
      ).toContainText("3");
    });
  });

  test.describe("Recovery and Resilience", () => {
    test("should recover state after unexpected shutdown", async ({ page }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Get current state
      const initialState = await page
        .locator('[data-testid="bot-state-json"]')
        .getAttribute("data-state");

      // Start a trade but simulate crash before completion
      await page.fill('[data-testid="trade-amount-input"]', "0.005");
      await page.fill('[data-testid="trade-price-input"]', "55000");

      await page.evaluate(() => {
        window.localStorage.setItem("test-mode-crash-before-commit", "true");
      });

      await page.click('[data-testid="trade-submit-button"]');

      // Bot should crash
      await expect(page.locator('[data-testid="bot-status"]')).toContainText(
        "crashed",
      );

      // Restart and verify recovery
      await page.click('[data-testid="bot-restart-button"]');

      // Should recover to previous state
      const recoveredState = await page
        .locator('[data-testid="bot-state-json"]')
        .getAttribute("data-state");
      expect(recoveredState).toEqual(initialState);

      // Should show recovery message
      await expect(
        page.locator('[data-testid="recovery-message"]'),
      ).toContainText("State recovered successfully");
    });

    test("should handle database connection loss gracefully", async ({
      page,
    }) => {
      await page.click('[data-testid="bot-trading-view"]');

      // Simulate connection loss
      await page.evaluate(() => {
        window.localStorage.setItem(
          "test-mode-db-connection-loss",
          "temporary",
        );
      });

      // Try to place trade
      await page.fill('[data-testid="trade-amount-input"]', "0.001");
      await page.fill('[data-testid="trade-price-input"]', "50000");
      await page.click('[data-testid="trade-submit-button"]');

      // Should show connection error and retry
      await expect(
        page.locator('[data-testid="connection-error"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="reconnecting-indicator"]'),
      ).toBeVisible();

      // Clear connection issue
      await page.evaluate(() => {
        window.localStorage.removeItem("test-mode-db-connection-loss");
      });

      // Should reconnect and complete
      await expect(
        page.locator('[data-testid="connection-restored"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="success-message"]'),
      ).toContainText("Trade placed successfully");
    });
  });
});
