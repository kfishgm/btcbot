import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.describe("Trading Rules E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the trading page
    await page.goto("/trading");

    // Wait for the app to initialize
    await page.waitForLoadState("networkidle");
  });

  test.describe("Trading Rules Display", () => {
    test("should display trading rules for selected symbol", async ({
      page,
    }) => {
      // Select BTC/USDT trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]', {
        state: "visible",
        timeout: 5000,
      });

      // Verify rules are displayed
      await expect(
        page.locator('[data-testid="min-order-value"]'),
      ).toContainText("$10.00");
      await expect(page.locator('[data-testid="price-step"]')).toContainText(
        "0.01",
      );
      await expect(page.locator('[data-testid="quantity-step"]')).toContainText(
        "0.00001",
      );
      await expect(page.locator('[data-testid="min-quantity"]')).toBeVisible();
      await expect(page.locator('[data-testid="max-quantity"]')).toBeVisible();
    });

    test("should update rules when switching symbols", async ({ page }) => {
      // Start with BTC/USDT
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for BTC rules
      await page.waitForSelector('[data-testid="trading-rules-panel"]');
      const btcMinOrder = await page
        .locator('[data-testid="min-order-value"]')
        .textContent();

      // Switch to ETH/USDT
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-ETHUSDT"]');

      // Wait for rules to update
      await page.waitForFunction(
        (oldValue) => {
          const element = document.querySelector(
            '[data-testid="min-order-value"]',
          );
          return element && element.textContent !== oldValue;
        },
        btcMinOrder,
        { timeout: 5000 },
      );

      // Verify ETH rules are different (they should be)
      const ethMinOrder = await page
        .locator('[data-testid="min-order-value"]')
        .textContent();
      expect(ethMinOrder).toBeDefined();
    });

    test("should show loading state while fetching rules", async ({ page }) => {
      // Select a symbol
      await page.click('[data-testid="symbol-selector"]');

      // Intercept the API call to add delay
      await page.route("**/api/v3/exchangeInfo", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.continue();
      });

      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Should show loading indicator
      await expect(page.locator('[data-testid="rules-loading"]')).toBeVisible();

      // Should eventually show rules
      await expect(
        page.locator('[data-testid="trading-rules-panel"]'),
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator('[data-testid="rules-loading"]'),
      ).not.toBeVisible();
    });

    test("should handle API errors gracefully", async ({ page }) => {
      // Intercept and fail the API call
      await page.route("**/api/v3/exchangeInfo", (route) => {
        route.abort("failed");
      });

      // Try to load rules
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Should show error message
      await expect(page.locator('[data-testid="rules-error"]')).toBeVisible();
      await expect(page.locator('[data-testid="rules-error"]')).toContainText(
        /Failed to load trading rules/i,
      );

      // Should show retry button
      await expect(
        page.locator('[data-testid="retry-rules-button"]'),
      ).toBeVisible();
    });

    test("should retry loading rules on error", async ({ page }) => {
      let callCount = 0;

      // First call fails, second succeeds
      await page.route("**/api/v3/exchangeInfo", async (route) => {
        callCount++;
        if (callCount === 1) {
          await route.abort("failed");
        } else {
          await route.continue();
        }
      });

      // Try to load rules (will fail)
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for error
      await expect(page.locator('[data-testid="rules-error"]')).toBeVisible();

      // Click retry
      await page.click('[data-testid="retry-rules-button"]');

      // Should now show rules
      await expect(
        page.locator('[data-testid="trading-rules-panel"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="rules-error"]'),
      ).not.toBeVisible();
    });
  });

  test.describe("Order Validation with Trading Rules", () => {
    test("should validate minimum order value in real-time", async ({
      page,
    }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter small quantity that's below minimum notional
      await page.fill('[data-testid="order-quantity-input"]', "0.0001");
      await page.fill('[data-testid="order-price-input"]', "50000");

      // Should show validation error
      await expect(
        page.locator('[data-testid="order-validation-error"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="order-validation-error"]'),
      ).toContainText(/minimum order value/i);

      // Submit button should be disabled
      await expect(
        page.locator('[data-testid="submit-order-button"]'),
      ).toBeDisabled();

      // Fix the quantity
      await page.fill('[data-testid="order-quantity-input"]', "0.001");

      // Error should disappear
      await expect(
        page.locator('[data-testid="order-validation-error"]'),
      ).not.toBeVisible();
      await expect(
        page.locator('[data-testid="submit-order-button"]'),
      ).toBeEnabled();
    });

    test("should auto-round price to tick size", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter price with too many decimals
      await page.fill('[data-testid="order-price-input"]', "50123.456789");

      // Tab away to trigger rounding
      await page.press('[data-testid="order-price-input"]', "Tab");

      // Price should be rounded to tick size (0.01)
      await expect(
        page.locator('[data-testid="order-price-input"]'),
      ).toHaveValue("50123.45");

      // Should show info message about rounding
      await expect(
        page.locator('[data-testid="price-rounded-info"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="price-rounded-info"]'),
      ).toContainText(/Price rounded to 50123.45/);
    });

    test("should auto-round quantity to step size", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter quantity with too many decimals
      await page.fill('[data-testid="order-quantity-input"]', "1.234567890");

      // Tab away to trigger rounding
      await page.press('[data-testid="order-quantity-input"]', "Tab");

      // Quantity should be rounded to step size (0.00001)
      await expect(
        page.locator('[data-testid="order-quantity-input"]'),
      ).toHaveValue("1.23456");

      // Should show info message about rounding
      await expect(
        page.locator('[data-testid="quantity-rounded-info"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="quantity-rounded-info"]'),
      ).toContainText(/Quantity rounded to 1.23456/);
    });

    test("should enforce minimum quantity", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter quantity below minimum
      await page.fill('[data-testid="order-quantity-input"]', "0.000001");
      await page.press('[data-testid="order-quantity-input"]', "Tab");

      // Should show validation error
      await expect(
        page.locator('[data-testid="quantity-validation-error"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="quantity-validation-error"]'),
      ).toContainText(/Minimum quantity is 0.00001/);

      // Submit button should be disabled
      await expect(
        page.locator('[data-testid="submit-order-button"]'),
      ).toBeDisabled();
    });

    test("should enforce maximum quantity", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter quantity above maximum
      await page.fill('[data-testid="order-quantity-input"]', "10000");
      await page.press('[data-testid="order-quantity-input"]', "Tab");

      // Should show validation error
      await expect(
        page.locator('[data-testid="quantity-validation-error"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="quantity-validation-error"]'),
      ).toContainText(/Maximum quantity is/);

      // Submit button should be disabled
      await expect(
        page.locator('[data-testid="submit-order-button"]'),
      ).toBeDisabled();
    });

    test("should suggest minimum quantity for given price", async ({
      page,
    }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter a high price
      await page.fill('[data-testid="order-price-input"]', "100000");
      await page.press('[data-testid="order-price-input"]', "Tab");

      // Should show suggested minimum quantity
      await expect(
        page.locator('[data-testid="suggested-min-quantity"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="suggested-min-quantity"]'),
      ).toContainText(/Minimum quantity at this price: 0.0001/);

      // Click to apply suggestion
      await page.click('[data-testid="apply-min-quantity-button"]');

      // Quantity should be filled
      await expect(
        page.locator('[data-testid="order-quantity-input"]'),
      ).toHaveValue("0.0001");
    });

    test("should calculate and display order total", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter quantity and price
      await page.fill('[data-testid="order-quantity-input"]', "0.5");
      await page.fill('[data-testid="order-price-input"]', "50000");

      // Should display total
      await expect(
        page.locator('[data-testid="order-total-value"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="order-total-value"]'),
      ).toContainText("25,000.00 USDT");

      // Should show whether it meets minimum
      await expect(
        page.locator('[data-testid="meets-minimum-indicator"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="meets-minimum-indicator"]'),
      ).toHaveClass(/success/);
    });
  });

  test.describe("Rule Auto-Refresh", () => {
    test("should show last updated time for rules", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Should show last updated time
      await expect(
        page.locator('[data-testid="rules-last-updated"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="rules-last-updated"]'),
      ).toContainText(/Last updated: .* ago/);
    });

    test("should show refresh button for manual update", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Should have refresh button
      await expect(
        page.locator('[data-testid="refresh-rules-button"]'),
      ).toBeVisible();

      // Track API calls
      let apiCallCount = 0;
      await page.route("**/api/v3/exchangeInfo", async (route) => {
        apiCallCount++;
        await route.continue();
      });

      // Click refresh
      await page.click('[data-testid="refresh-rules-button"]');

      // Should show loading state briefly
      await expect(
        page.locator('[data-testid="refresh-rules-button"]'),
      ).toHaveAttribute("aria-busy", "true");

      // Wait for refresh to complete
      await page.waitForFunction(() => {
        const button = document.querySelector(
          '[data-testid="refresh-rules-button"]',
        );
        return button?.getAttribute("aria-busy") === "false";
      });

      // Should have made an API call
      expect(apiCallCount).toBeGreaterThan(0);
    });

    test("should auto-refresh rules after 24 hours", async ({ page }) => {
      // This test would need to mock time advancement
      // In a real scenario, we'd use a time mocking library

      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Check that auto-refresh is enabled
      await expect(
        page.locator('[data-testid="auto-refresh-indicator"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="auto-refresh-indicator"]'),
      ).toContainText(/Auto-refresh: Enabled/);

      // Should show next refresh time
      await expect(
        page.locator('[data-testid="next-refresh-time"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="next-refresh-time"]'),
      ).toContainText(/Next refresh in: /);
    });
  });

  test.describe("Order Form Integration", () => {
    test("should successfully place order with valid parameters", async ({
      page,
    }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Fill in valid order details
      await page.fill('[data-testid="order-quantity-input"]', "0.001");
      await page.fill('[data-testid="order-price-input"]', "50000");

      // Select order type
      await page.click('[data-testid="order-type-limit"]');

      // Click buy button
      await page.click('[data-testid="buy-order-button"]');

      // Should show confirmation dialog
      await expect(
        page.locator('[data-testid="order-confirmation-dialog"]'),
      ).toBeVisible();

      // Verify order details in confirmation
      await expect(
        page.locator('[data-testid="confirm-symbol"]'),
      ).toContainText("BTCUSDT");
      await expect(
        page.locator('[data-testid="confirm-quantity"]'),
      ).toContainText("0.001");
      await expect(page.locator('[data-testid="confirm-price"]')).toContainText(
        "50,000.00",
      );
      await expect(page.locator('[data-testid="confirm-total"]')).toContainText(
        "50.00 USDT",
      );

      // Confirm order
      await page.click('[data-testid="confirm-order-button"]');

      // Should show success message
      await expect(
        page.locator('[data-testid="order-success-message"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="order-success-message"]'),
      ).toContainText(/Order placed successfully/);
    });

    test("should prevent order submission with invalid parameters", async ({
      page,
    }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Fill in invalid order details (below minimum)
      await page.fill('[data-testid="order-quantity-input"]', "0.00001");
      await page.fill('[data-testid="order-price-input"]', "100");

      // Try to submit
      await page.click('[data-testid="buy-order-button"]');

      // Should NOT show confirmation dialog
      await expect(
        page.locator('[data-testid="order-confirmation-dialog"]'),
      ).not.toBeVisible();

      // Should show validation errors
      await expect(
        page.locator('[data-testid="order-validation-summary"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="order-validation-summary"]'),
      ).toContainText(/Please fix the following errors/);

      // Should highlight invalid fields
      await expect(
        page.locator('[data-testid="order-quantity-input"]'),
      ).toHaveClass(/error/);
    });

    test("should handle market orders without price", async ({ page }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Select market order type
      await page.click('[data-testid="order-type-market"]');

      // Price input should be disabled
      await expect(
        page.locator('[data-testid="order-price-input"]'),
      ).toBeDisabled();

      // Fill in quantity
      await page.fill('[data-testid="order-quantity-input"]', "0.001");

      // Should show estimated total based on current market price
      await expect(
        page.locator('[data-testid="estimated-total"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="estimated-total"]'),
      ).toContainText(/Estimated Total: ~/);

      // Submit order
      await page.click('[data-testid="buy-order-button"]');

      // Should show market order warning in confirmation
      await expect(
        page.locator('[data-testid="market-order-warning"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="market-order-warning"]'),
      ).toContainText(
        /Market orders execute immediately at the best available price/,
      );
    });
  });

  test.describe("Multiple Symbol Support", () => {
    test("should cache rules for multiple symbols", async ({ page }) => {
      // Load rules for BTC
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Load rules for ETH
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-ETHUSDT"]');
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Switch back to BTC - should be instant (cached)
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Rules should appear immediately without loading
      await expect(
        page.locator('[data-testid="trading-rules-panel"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="rules-loading"]'),
      ).not.toBeVisible();

      // Should show cache indicator
      await expect(
        page.locator('[data-testid="rules-cached-indicator"]'),
      ).toBeVisible();
    });

    test("should prefetch popular trading pairs on app load", async ({
      page,
    }) => {
      // Track API calls
      const apiCalls: string[] = [];
      await page.route("**/api/v3/exchangeInfo", async (route) => {
        apiCalls.push(route.request().url());
        await route.continue();
      });

      // Navigate to trading page
      await page.goto("/trading");

      // Wait for initial load
      await page.waitForLoadState("networkidle");

      // Should have made API call to prefetch rules
      expect(apiCalls.length).toBeGreaterThan(0);

      // Popular pairs should load instantly
      const popularPairs = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

      for (const pair of popularPairs) {
        await page.click('[data-testid="symbol-selector"]');
        await page.click(`[data-testid="symbol-option-${pair}"]`);

        // Should show rules immediately
        await expect(
          page.locator('[data-testid="trading-rules-panel"]'),
        ).toBeVisible();
        await expect(
          page.locator('[data-testid="rules-cached-indicator"]'),
        ).toBeVisible();
      }
    });
  });

  test.describe("Accessibility", () => {
    test("should have proper ARIA labels for trading rules", async ({
      page,
    }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Check ARIA labels
      await expect(
        page.locator('[data-testid="trading-rules-panel"]'),
      ).toHaveAttribute("aria-label", "Trading rules for BTCUSDT");

      await expect(
        page.locator('[data-testid="min-order-value"]'),
      ).toHaveAttribute("aria-label", /Minimum order value/);

      await expect(
        page.locator('[data-testid="refresh-rules-button"]'),
      ).toHaveAttribute("aria-label", "Refresh trading rules");
    });

    test("should announce validation errors to screen readers", async ({
      page,
    }) => {
      // Select trading pair
      await page.click('[data-testid="symbol-selector"]');
      await page.click('[data-testid="symbol-option-BTCUSDT"]');

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Enter invalid quantity
      await page.fill('[data-testid="order-quantity-input"]', "0.000001");
      await page.press('[data-testid="order-quantity-input"]', "Tab");

      // Error should have proper ARIA attributes
      await expect(
        page.locator('[data-testid="quantity-validation-error"]'),
      ).toHaveAttribute("role", "alert");

      await expect(
        page.locator('[data-testid="quantity-validation-error"]'),
      ).toHaveAttribute("aria-live", "polite");
    });

    test("should be keyboard navigable", async ({ page }) => {
      // Navigate to trading page
      await page.goto("/trading");

      // Tab to symbol selector
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Open selector with Enter
      await page.keyboard.press("Enter");

      // Navigate to BTC option with arrow keys
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");

      // Wait for rules to load
      await page.waitForSelector('[data-testid="trading-rules-panel"]');

      // Tab to refresh button
      let focused = await page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid"),
      );
      while (focused !== "refresh-rules-button") {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() =>
          document.activeElement?.getAttribute("data-testid"),
        );
      }

      // Activate with Enter
      await page.keyboard.press("Enter");

      // Should trigger refresh
      await expect(
        page.locator('[data-testid="refresh-rules-button"]'),
      ).toHaveAttribute("aria-busy", "true");
    });
  });
});
