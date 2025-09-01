import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

test.describe("Sell Order State Updates", () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    // Navigate to the dashboard
    await page.goto("/dashboard");

    // Mock API responses for initial state with BTC holdings
    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 500.0,
          btc_accumulated: 0.01,
          purchases_remaining: 3,
          reference_price: 50000.0,
          cost_accum_usdt: 500.0,
          btc_accum_net: 0.01,
          ath_price: 52000.0,
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
          price: 52500.0,
          volume24h: 1000000000,
          change24h: 5.0,
        },
      });
    });
  });

  test("should update state after successful sell order", async () => {
    // Arrange - Mock successful sell order response
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    // Mock updated state after sell (complete cycle reset)
    await page.route("**/api/cycle-state/update", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "READY",
          capital_available: 1024.475,
          btc_accumulated: 0,
          purchases_remaining: 5,
          reference_price: 52000.0,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: 52000.0,
          buy_amount: 204.0,
        },
      });
    });

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Wait for loading state
    await expect(page.locator('[data-testid="order-loading"]')).toBeVisible();

    // Wait for success state
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({
      timeout: 10000,
    });

    // Assert - Check updated state displays
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "READY",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$1,024.48");
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.00000",
    );
    await expect(
      page.locator('[data-testid="purchases-remaining"]'),
    ).toContainText("5");
    await expect(page.locator('[data-testid="reference-price"]')).toContainText(
      "$52,000.00",
    );
  });

  test("should show profit summary after complete sale", async () => {
    // Arrange - Mock successful sell with profit
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    await page.route("**/api/profit-summary", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          principal: 500.0,
          revenue: 524.475,
          profit: 24.475,
          profitPercentage: 4.895,
        },
      });
    });

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Wait for success
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

    // Assert - Check profit summary
    await expect(page.locator('[data-testid="profit-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="profit-amount"]')).toContainText(
      "$24.48",
    );
    await expect(
      page.locator('[data-testid="profit-percentage"]'),
    ).toContainText("4.90%");
    await expect(
      page.locator('[data-testid="cycle-complete-badge"]'),
    ).toContainText("Cycle Complete");
  });

  test("should handle partial sell correctly", async () => {
    // Arrange - Initial state with more BTC
    await page.route("**/api/cycle-state", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 300.0,
          btc_accumulated: 0.02,
          purchases_remaining: 2,
          reference_price: 50000.0,
          cost_accum_usdt: 1000.0,
          btc_accum_net: 0.02,
          ath_price: 52000.0,
          buy_amount: 200.0,
        },
      });
    });

    // Mock partial sell order
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "PARTIALLY_FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    // Mock updated state after partial sell
    await page.route("**/api/cycle-state/update", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "HOLDING",
          capital_available: 824.475,
          btc_accumulated: 0.01,
          purchases_remaining: 2,
          reference_price: 50000.0,
          cost_accum_usdt: 1000.0,
          btc_accum_net: 0.02,
          ath_price: 52000.0,
          buy_amount: 200.0,
        },
      });
    });

    await page.reload();

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Wait for partial fill notification
    await expect(
      page.locator('[data-testid="partial-fill-warning"]'),
    ).toBeVisible();

    // Assert - Check state still shows HOLDING
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "HOLDING",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$824.48");
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.01000",
    );
  });

  test("should validate sell conditions before placing order", async () => {
    // Arrange - Set state with no BTC
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
          ath_price: 52000.0,
          buy_amount: 200.0,
        },
      });
    });

    await page.reload();

    // Act - Try to place sell order
    await page.click('[data-testid="sell-button"]');

    // Assert - Should show error
    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      "No BTC to sell",
    );
    await expect(page.locator('[data-testid="sell-button"]')).toBeDisabled();
  });

  test("should show loss correctly when selling below reference price", async () => {
    // Arrange - Mock sell at loss
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "480.00",
          avgPrice: "48000.00",
          feeBTC: "0",
          feeUSDT: "0.48",
        },
      });
    });

    await page.route("**/api/profit-summary", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          principal: 500.0,
          revenue: 479.52,
          profit: 0, // Never negative per STRATEGY.md
          profitPercentage: 0,
        },
      });
    });

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Wait for success
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

    // Assert - Check loss display
    await expect(page.locator('[data-testid="profit-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="profit-amount"]')).toContainText(
      "$0.00",
    );
    await expect(page.locator('[data-testid="loss-warning"]')).toContainText(
      "Sold at loss",
    );
  });

  test("should update buy amount after cycle reset", async () => {
    // Arrange - Mock sell with significant profit
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "600.00",
          avgPrice: "60000.00",
          feeBTC: "0",
          feeUSDT: "0.60",
        },
      });
    });

    // Mock updated state with new buy amount
    await page.route("**/api/cycle-state/update", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "READY",
          capital_available: 1099.4,
          btc_accumulated: 0,
          purchases_remaining: 5,
          reference_price: 52000.0,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: 52000.0,
          buy_amount: 219.88, // Recalculated from new capital
        },
      });
    });

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Wait for success
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

    // Assert - Check new buy amount
    await expect(page.locator('[data-testid="buy-amount"]')).toContainText(
      "$219.88",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$1,099.40");
  });

  test("should persist state across page refreshes after sell", async () => {
    // Arrange - Mock state after sell order
    const updatedState = {
      id: "test-cycle",
      status: "READY",
      capital_available: 1024.475,
      btc_accumulated: 0,
      purchases_remaining: 5,
      reference_price: 52000.0,
      cost_accum_usdt: 0,
      btc_accum_net: 0,
      ath_price: 52000.0,
      buy_amount: 204.0,
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
      "READY",
    );
    await expect(
      page.locator('[data-testid="capital-available"]'),
    ).toContainText("$1,024.48");
    await expect(page.locator('[data-testid="btc-accumulated"]')).toContainText(
      "0.00000",
    );
  });

  test("should show real-time updates during sell order processing", async () => {
    // Arrange - Delay order response to see loading states
    await page.route("**/api/orders/sell", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Assert - Check loading states
    await expect(page.locator('[data-testid="order-loading"]')).toBeVisible();
    await expect(page.locator('[data-testid="loading-message"]')).toContainText(
      "Placing sell order...",
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

  test("should handle network errors gracefully during sell", async () => {
    // Arrange - Mock network error
    await page.route("**/api/orders/sell", async (route) => {
      await route.abort("failed");
    });

    // Act - Try to place sell order
    await page.click('[data-testid="sell-button"]');

    // Assert - Should show error and allow retry
    await expect(page.locator('[data-testid="error-message"]')).toContainText(
      "Network error",
    );
    await expect(page.locator('[data-testid="retry-button"]')).toBeVisible();

    // Retry with success
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    await page.click('[data-testid="retry-button"]');
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();
  });

  test("should display cycle reset notification", async () => {
    // Arrange - Mock complete sale
    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    // Act - Place sell order
    await page.click('[data-testid="sell-button"]');

    // Wait for success
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

    // Assert - Check for cycle reset notification
    await expect(
      page.locator('[data-testid="cycle-reset-notification"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="cycle-reset-notification"]'),
    ).toContainText("Cycle complete! Ready for new purchases.");
    await expect(page.locator('[data-testid="new-buy-amount"]')).toContainText(
      "New buy amount: $204.00",
    );
  });

  test("should update UI immediately after sell order completion", async () => {
    // Arrange
    let stateUpdateRequested = false;

    await page.route("**/api/orders/sell", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          orderId: 12345,
          status: "FILLED",
          executedQty: "0.01",
          cummulativeQuoteQty: "525.00",
          avgPrice: "52500.00",
          feeBTC: "0",
          feeUSDT: "0.525",
        },
      });
    });

    await page.route("**/api/cycle-state/update", async (route) => {
      stateUpdateRequested = true;
      await route.fulfill({
        status: 200,
        json: {
          id: "test-cycle",
          status: "READY",
          capital_available: 1024.475,
          btc_accumulated: 0,
          purchases_remaining: 5,
          reference_price: 52000.0,
          cost_accum_usdt: 0,
          btc_accum_net: 0,
          ath_price: 52000.0,
          buy_amount: 204.0,
        },
      });
    });

    // Act
    await page.click('[data-testid="sell-button"]');

    // Assert - State update should be requested
    await page.waitForTimeout(1000);
    expect(stateUpdateRequested).toBe(true);

    // UI should reflect new state
    await expect(page.locator('[data-testid="status-badge"]')).toContainText(
      "READY",
    );
  });
});
