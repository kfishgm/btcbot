import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.describe("Buy Order State Updates", () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    // Navigate to the dashboard
    await page.goto("/dashboard");

    // Mock API responses for initial state
    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "READY",
          capital_available: 1000.0,
          btc_accumulated: 0,
          purchases_remaining: 5,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: 50000.0,
          buy_amount: 200.0,
        },
      });
    });

    // Mock market data
    await page.route("**/api/market-data", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          symbol: "BTCUSDT",
          price: 50000.0,
          volume24h: 1000000000,
          change24h: 2.5,
        },
      });
    });
  });

  test("should update state after successful buy order", async () => {
    // Arrange - Mock successful buy order response
    await page.route("**/api/orders/buy", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "500.00",
          avgPrice: "50000.00",
          feeBTC: "0.00001",
          feeUSDT: "0",
        },
      });
    });

    // Mock updated state after buy
    await page.route("**/api/cycle-state/update", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 500.0,
          btc_accumulated: 0.00999,
          purchases_remaining: 4,
          reference_price: 50150.15,
          cost_accum_usdt: 500.5,
          btc_accum_net: 0.00999,
          ath_price: 50000.0,
          buy_amount: 200.0,
        },
      });
    });

    // Act - Place buy order
    await page.click('[data-testid="buy-button"]');

    // Wait for loading state
    await expect(page.locator('[data-testid="order-loading"]')).toBeVisible();

    // Wait for success state
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({
      timeout: 10000,
    });

    // Assert - Check updated state displays
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "HOLDING",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$500.00");
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.00999",
    );
    await expect(
      page.locator('[data-testid="purchases-remaining"]'),
    ).toContainText("4");
    await expect(page.locator('[data-testid="reference-price"]')).toContainText(
      "$50,150.15",
    );
  });

  test("should show error when insufficient capital", async () => {
    // Arrange - Set low capital
    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "READY",
          capital_available: 5.0, // Less than minimum
          btc_accumulated: 0,
          purchases_remaining: 5,
          reference_price: null,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: 50000.0,
          buy_amount: 200.0,
        },
      });
    });

    await page.reload();

    // Act - Try to place buy order
    await page.click('[data-testid="buy-button"]');

    // Assert - Should show error
    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      "Insufficient capital",
    );
    await expect(page.locator('[data-testid="buy-button"]')).toBeDisabled();
  });

  test("should show error when no purchases remaining", async () => {
    // Arrange - Set no purchases remaining
    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 500.0,
          btc_accumulated: 0.05,
          purchases_remaining: 0, // No purchases left
          reference_price: 50000.0,
          cost_accum_usdt: 2500.0,
          btc_accum_net: 0.05,
          ath_price: 50000.0,
          buy_amount: 200.0,
        },
      });
    });

    await page.reload();

    // Act - Try to place buy order
    await page.click('[data-testid="buy-button"]');

    // Assert - Should show error
    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      "Maximum purchases reached",
    );
  });

  test("should handle partial fills correctly", async () => {
    // Arrange - Mock partial fill response
    await page.route("**/api/orders/buy", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "PARTIALLY_FILLED",
          executedQty: "0.005",
          cummulativeQuoteQty: "250.00",
          avgPrice: "50000.00",
          feeBTC: "0.000005",
          feeUSDT: "0",
        },
      });
    });

    // Act - Place buy order
    await page.click('[data-testid="buy-button"]');

    // Wait for partial fill notification
    await expect(
      page.locator('[data-testid="partial-fill-warning"]'),
    ).toBeVisible();

    // Assert - Check state still updated
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "HOLDING",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$750.00");
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.004995",
    );
  });

  test("should update reference price after buy", async () => {
    // Arrange - Initial state with existing position
    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 500.0,
          btc_accumulated: 0.01,
          purchases_remaining: 3,
          reference_price: 49000.0,
          cost_accum_usdt: 490.0,
          btc_accum_net: 0.01,
          ath_price: 50000.0,
          buy_amount: 200.0,
        },
      });
    });

    await page.reload();

    // Mock buy order that should update reference price
    await page.route("**/api/orders/buy", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12346,
          status: "FILLED",
          executedQty: "0.004",
          cummulativeQuoteQty: "200.00",
          avgPrice: "50000.00",
          feeBTC: "0.000004",
          feeUSDT: "0",
        },
      });
    });

    // Act - Place another buy order
    await page.click('[data-testid="buy-button"]');
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

    // Assert - Reference price should be recalculated
    // New reference = (490 + 200.20) / (0.01 + 0.003996) = 49315.30
    await expect(page.locator('[data-testid="reference-price"]')).toContainText(
      "$49,315.30",
    );
  });

  test("should persist state across page refreshes", async () => {
    // Arrange - Mock state after buy order
    const updatedState = {
      id: "test-cycle",
      status: "HOLDING",
      capital_available: 500.0,
      btc_accumulated: 0.00999,
      purchases_remaining: 4,
      reference_price: 50150.15,
      cost_accum_usdt: 500.5,
      btc_accum_net: 0.00999,
      ath_price: 50000.0,
      buy_amount: 200.0,
    };

    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: updatedState,
      });
    });

    // Act - Refresh the page
    await page.reload();

    // Assert - State should be persisted
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "HOLDING",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$500.00");
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.00999",
    );
  });

  test("should show real-time updates during order processing", async () => {
    // Arrange - Delay order response to see loading states
    await page.route("**/api/orders/buy", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "500.00",
          avgPrice: "50000.00",
          feeBTC: "0.00001",
          feeUSDT: "0",
        },
      });
    });

    // Act - Place buy order
    await page.click('[data-testid="buy-button"]');

    // Assert - Check loading states
    await expect(page.locator('[data-testid="order-loading"]')).toBeVisible();
    await expect(page.locator('[data-testid="loading-message"]')).toContainText(
      "Placing buy order...",
    );

    // Wait for state update loading
    await expect(
      page.locator('[data-testid="state-update-loading"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="loading-message"]')).toContainText(
      "Updating cycle state...",
    );

    // Finally success
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("should handle network errors gracefully", async () => {
    // Arrange - Mock network error
    await page.route("**/api/orders/buy", async (route) => {
      await route.abort("failed");
    });

    // Act - Try to place buy order
    await page.click('[data-testid="buy-button"]');

    // Assert - Should show error and allow retry
    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      "Network error",
    );
    await expect(page.locator('[data-testid="retry-button"]')).toBeVisible();

    // Retry with success
    await page.route("**/api/orders/buy", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "500.00",
          avgPrice: "50000.00",
          feeBTC: "0.00001",
          feeUSDT: "0",
        },
      });
    });

    await page.click('[data-testid="retry-button"]');
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();
  });

  test("should handle very small BTC amounts correctly", async () => {
    // Arrange - Mock order with very small amounts
    await page.route("**/api/orders/buy", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12347,
          status: "FILLED",
          executedQty: "0.00000100",
          cummulativeQuoteQty: "0.05",
          avgPrice: "50000.00",
          feeBTC: "0.00000001",
          feeUSDT: "0",
        },
      });
    });

    // Act - Place buy order
    await page.click('[data-testid="buy-button"]');
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

    // Assert - Should display with proper precision
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.00000099",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$999.95");
  });

  test("should update UI immediately after buy order completion", async () => {
    // Arrange
    let stateUpdateRequested = false;

    await page.route("**/api/orders/buy", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "500.00",
          avgPrice: "50000.00",
          feeBTC: "0.00001",
          feeUSDT: "0",
        },
      });
    });

    await page.route("**/api/cycle-state/update", async (route) => {
      stateUpdateRequested = true;
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 500.0,
          btc_accumulated: 0.00999,
          purchases_remaining: 4,
          reference_price: 50150.15,
          cost_accum_usdt: 500.5,
          btc_accum_net: 0.00999,
          ath_price: 50000.0,
          buy_amount: 200.0,
        },
      });
    });

    // Act
    await page.click('[data-testid="buy-button"]');

    // Assert - State update should be requested
    await page.waitForTimeout(1000);
    expect(stateUpdateRequested).toBe(true);

    // UI should reflect new state
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "HOLDING",
    );
  });
});
