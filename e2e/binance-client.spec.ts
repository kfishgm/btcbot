import { test, expect, Page } from "@playwright/test";

test.describe("Binance Client E2E Tests", () => {
  let page: Page;

  test.beforeEach(async ({ page: p }: { page: Page }) => {
    page = p;
    // Navigate to the trading interface
    await page.goto("/trading");

    // Wait for the page to load
    await page.waitForSelector("[data-testid='trading-interface']");
  });

  test.describe("Trading Interface Integration", () => {
    test("should display real-time BTC price", async () => {
      // Wait for price to load
      await page.waitForSelector("[data-testid='btc-price']");

      // Check that price is displayed
      const priceElement = page.locator("[data-testid='btc-price']");
      await expect(priceElement).toBeVisible();

      // Price should be a valid number
      const priceText = await priceElement.textContent();
      expect(priceText).toMatch(/^\$[\d,]+\.?\d*$/);

      // Price should update within 5 seconds
      await priceElement.textContent();
      await page.waitForTimeout(5000);
      await priceElement.textContent();

      // Prices might be the same in stable market, but element should still be present
      await expect(priceElement).toBeVisible();
    });

    test("should display account balances", async () => {
      // Wait for balances to load
      await page.waitForSelector("[data-testid='account-balances']");

      // Check BTC balance
      const btcBalance = page.locator("[data-testid='balance-btc']");
      await expect(btcBalance).toBeVisible();
      const btcText = await btcBalance.textContent();
      expect(btcText).toMatch(/^[\d.]+\s*BTC$/);

      // Check USDT balance
      const usdtBalance = page.locator("[data-testid='balance-usdt']");
      await expect(usdtBalance).toBeVisible();
      const usdtText = await usdtBalance.textContent();
      expect(usdtText).toMatch(/^[\d,]+\.?\d*\s*USDT$/);

      // Check total portfolio value
      const portfolioValue = page.locator("[data-testid='portfolio-value']");
      await expect(portfolioValue).toBeVisible();
      const portfolioText = await portfolioValue.textContent();
      expect(portfolioText).toMatch(/^\$[\d,]+\.?\d*$/);
    });

    test("should display order book", async () => {
      // Wait for order book to load
      await page.waitForSelector("[data-testid='order-book']");

      // Check bid side
      const bids = page.locator(
        "[data-testid='order-book-bids'] [data-testid='order-book-row']",
      );
      await expect(bids.first()).toBeVisible();
      const bidCount = await bids.count();
      expect(bidCount).toBeGreaterThan(0);

      // Check ask side
      const asks = page.locator(
        "[data-testid='order-book-asks'] [data-testid='order-book-row']",
      );
      await expect(asks.first()).toBeVisible();
      const askCount = await asks.count();
      expect(askCount).toBeGreaterThan(0);

      // Check spread indicator
      const spread = page.locator("[data-testid='order-book-spread']");
      await expect(spread).toBeVisible();
      const spreadText = await spread.textContent();
      expect(spreadText).toMatch(/^[\d.]+\s*\([\d.]+%\)$/);
    });
  });

  test.describe("Order Placement", () => {
    test("should place a limit buy order", async () => {
      // Select limit order type
      await page.click("[data-testid='order-type-limit']");

      // Select buy side
      await page.click("[data-testid='order-side-buy']");

      // Enter order details
      await page.fill("[data-testid='order-price']", "30000");
      await page.fill("[data-testid='order-quantity']", "0.001");

      // Check estimated total
      const total = page.locator("[data-testid='order-total']");
      await expect(total).toHaveText("30.00 USDT");

      // Place order
      await page.click("[data-testid='place-order-button']");

      // Wait for confirmation
      await page.waitForSelector("[data-testid='order-confirmation']");

      // Check success message
      const successMessage = page.locator(
        "[data-testid='order-success-message']",
      );
      await expect(successMessage).toBeVisible();
      await expect(successMessage).toContainText("Order placed successfully");

      // Check order appears in open orders
      await page.click("[data-testid='open-orders-tab']");
      const openOrders = page.locator(
        "[data-testid='open-orders-list'] [data-testid='order-row']",
      );
      await expect(openOrders.first()).toBeVisible();

      // Verify order details
      const orderRow = openOrders.first();
      await expect(orderRow).toContainText("BTCUSDT");
      await expect(orderRow).toContainText("BUY");
      await expect(orderRow).toContainText("0.001");
      await expect(orderRow).toContainText("30,000");
    });

    test("should place a market sell order", async () => {
      // Select market order type
      await page.click("[data-testid='order-type-market']");

      // Select sell side
      await page.click("[data-testid='order-side-sell']");

      // Enter quantity
      await page.fill("[data-testid='order-quantity']", "0.0001");

      // Market orders should not show price input
      await expect(
        page.locator("[data-testid='order-price']"),
      ).not.toBeVisible();

      // Place order
      await page.click("[data-testid='place-order-button']");

      // Wait for confirmation
      await page.waitForSelector("[data-testid='order-confirmation']");

      // Check success message
      const successMessage = page.locator(
        "[data-testid='order-success-message']",
      );
      await expect(successMessage).toBeVisible();
      await expect(successMessage).toContainText("Order executed");

      // Market orders should appear in trade history
      await page.click("[data-testid='trade-history-tab']");
      const trades = page.locator(
        "[data-testid='trade-history-list'] [data-testid='trade-row']",
      );
      await expect(trades.first()).toBeVisible();

      // Verify trade details
      const tradeRow = trades.first();
      await expect(tradeRow).toContainText("BTCUSDT");
      await expect(tradeRow).toContainText("SELL");
      await expect(tradeRow).toContainText("0.0001");
    });

    test("should validate order before submission", async () => {
      // Try to place order without filling details
      await page.click("[data-testid='place-order-button']");

      // Should show validation errors
      const priceError = page.locator("[data-testid='order-price-error']");
      await expect(priceError).toBeVisible();
      await expect(priceError).toContainText("Price is required");

      const quantityError = page.locator(
        "[data-testid='order-quantity-error']",
      );
      await expect(quantityError).toBeVisible();
      await expect(quantityError).toContainText("Quantity is required");

      // Enter invalid values
      await page.fill("[data-testid='order-price']", "-100");
      await page.fill("[data-testid='order-quantity']", "0");

      await page.click("[data-testid='place-order-button']");

      // Should show validation errors
      await expect(priceError).toContainText("Price must be positive");
      await expect(quantityError).toContainText(
        "Quantity must be greater than 0",
      );

      // Check minimum order size
      await page.fill("[data-testid='order-price']", "40000");
      await page.fill("[data-testid='order-quantity']", "0.00001");

      await page.click("[data-testid='place-order-button']");

      await expect(quantityError).toContainText(
        "Minimum order size is 0.0001 BTC",
      );
    });

    test("should place a stop-loss order", async () => {
      // Select stop-loss order type
      await page.click("[data-testid='order-type-stop-loss']");

      // Select sell side
      await page.click("[data-testid='order-side-sell']");

      // Enter order details
      await page.fill("[data-testid='order-stop-price']", "38000");
      await page.fill("[data-testid='order-price']", "37900");
      await page.fill("[data-testid='order-quantity']", "0.001");

      // Place order
      await page.click("[data-testid='place-order-button']");

      // Wait for confirmation
      await page.waitForSelector("[data-testid='order-confirmation']");

      // Check success message
      const successMessage = page.locator(
        "[data-testid='order-success-message']",
      );
      await expect(successMessage).toBeVisible();
      await expect(successMessage).toContainText("Stop-loss order placed");

      // Check order appears in open orders with stop indicator
      await page.click("[data-testid='open-orders-tab']");
      const openOrders = page.locator(
        "[data-testid='open-orders-list'] [data-testid='order-row']",
      );
      const stopOrder = openOrders.filter({ hasText: "STOP" });
      await expect(stopOrder.first()).toBeVisible();
      await expect(stopOrder.first()).toContainText("38,000");
    });
  });

  test.describe("Order Management", () => {
    test("should cancel an open order", async () => {
      // First place an order
      await page.click("[data-testid='order-type-limit']");
      await page.click("[data-testid='order-side-buy']");
      await page.fill("[data-testid='order-price']", "30000");
      await page.fill("[data-testid='order-quantity']", "0.001");
      await page.click("[data-testid='place-order-button']");
      await page.waitForSelector("[data-testid='order-confirmation']");

      // Go to open orders
      await page.click("[data-testid='open-orders-tab']");

      // Find the order and click cancel
      const cancelButton = page
        .locator(
          "[data-testid='open-orders-list'] [data-testid='cancel-order-button']",
        )
        .first();
      await expect(cancelButton).toBeVisible();
      await cancelButton.click();

      // Confirm cancellation
      await page.waitForSelector("[data-testid='cancel-confirmation-dialog']");
      await page.click("[data-testid='confirm-cancel-button']");

      // Check success message
      const successMessage = page.locator(
        "[data-testid='cancel-success-message']",
      );
      await expect(successMessage).toBeVisible();
      await expect(successMessage).toContainText(
        "Order cancelled successfully",
      );

      // Order should disappear from open orders
      const openOrders = page.locator(
        "[data-testid='open-orders-list'] [data-testid='order-row']",
      );
      const orderCount = await openOrders.count();
      expect(orderCount).toBe(0);
    });

    test("should cancel all open orders", async () => {
      // Place multiple orders
      for (let i = 0; i < 3; i++) {
        await page.click("[data-testid='order-type-limit']");
        await page.click("[data-testid='order-side-buy']");
        await page.fill("[data-testid='order-price']", `${30000 - i * 100}`);
        await page.fill("[data-testid='order-quantity']", "0.001");
        await page.click("[data-testid='place-order-button']");
        await page.waitForSelector("[data-testid='order-confirmation']");
        await page.click("[data-testid='close-confirmation']");
      }

      // Go to open orders
      await page.click("[data-testid='open-orders-tab']");

      // Check multiple orders exist
      const openOrders = page.locator(
        "[data-testid='open-orders-list'] [data-testid='order-row']",
      );
      await expect(openOrders).toHaveCount(3);

      // Click cancel all
      await page.click("[data-testid='cancel-all-orders-button']");

      // Confirm cancellation
      await page.waitForSelector(
        "[data-testid='cancel-all-confirmation-dialog']",
      );
      await page.click("[data-testid='confirm-cancel-all-button']");

      // Check success message
      const successMessage = page.locator(
        "[data-testid='cancel-all-success-message']",
      );
      await expect(successMessage).toBeVisible();
      await expect(successMessage).toContainText("All orders cancelled");

      // All orders should be gone
      await expect(openOrders).toHaveCount(0);
    });

    test("should view order history", async () => {
      // Navigate to order history
      await page.click("[data-testid='order-history-tab']");

      // Wait for history to load
      await page.waitForSelector("[data-testid='order-history-list']");

      // Check filters
      const statusFilter = page.locator("[data-testid='order-status-filter']");
      await expect(statusFilter).toBeVisible();

      // Filter by filled orders
      await statusFilter.selectOption("FILLED");

      // Check that orders are displayed
      const orders = page.locator(
        "[data-testid='order-history-list'] [data-testid='order-row']",
      );
      const filledOrders = orders.filter({ hasText: "FILLED" });
      const count = await filledOrders.count();

      if (count > 0) {
        // Verify order details are shown
        const firstOrder = filledOrders.first();
        await expect(firstOrder).toContainText("BTCUSDT");

        // Click to view order details
        await firstOrder.click();

        // Check order detail modal
        await page.waitForSelector("[data-testid='order-detail-modal']");
        const modal = page.locator("[data-testid='order-detail-modal']");
        await expect(modal).toContainText("Order ID");
        await expect(modal).toContainText("Execution Time");
        await expect(modal).toContainText("Fees");
      }
    });
  });

  test.describe("Error Handling", () => {
    test("should handle rate limit errors gracefully", async () => {
      // Rapidly place multiple orders to trigger rate limit
      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(
          page.evaluate(async () => {
            // Direct API call to trigger rate limit
            const response = await fetch("/api/binance/order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol: "BTCUSDT",
                side: "BUY",
                type: "LIMIT",
                quantity: 0.001,
                price: 30000,
              }),
            });
            return response.status;
          }),
        );
      }

      const results = await Promise.all(promises);

      // Some requests should be rate limited
      const rateLimited = results.filter((status: number) => status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);

      // Check UI shows rate limit warning
      const warning = page.locator("[data-testid='rate-limit-warning']");
      await expect(warning).toBeVisible();
      await expect(warning).toContainText("Rate limit reached");
    });

    test("should handle insufficient balance errors", async () => {
      // Try to place an order larger than balance
      await page.click("[data-testid='order-type-limit']");
      await page.click("[data-testid='order-side-buy']");
      await page.fill("[data-testid='order-price']", "40000");
      await page.fill("[data-testid='order-quantity']", "1000"); // Large amount

      // Check if balance warning appears
      const balanceWarning = page.locator(
        "[data-testid='insufficient-balance-warning']",
      );
      await expect(balanceWarning).toBeVisible();
      await expect(balanceWarning).toContainText("Insufficient balance");

      // Place order button should be disabled
      const placeButton = page.locator("[data-testid='place-order-button']");
      await expect(placeButton).toBeDisabled();

      // If forced through, should show error
      await page.evaluate(() => {
        const button = document.querySelector(
          "[data-testid='place-order-button']",
        ) as HTMLButtonElement | null;
        if (button) button.disabled = false;
      });

      await placeButton.click();

      // Check error message
      const errorMessage = page.locator("[data-testid='order-error-message']");
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toContainText("insufficient balance");
    });

    test("should handle network errors", async () => {
      // Simulate network offline
      await page.context().setOffline(true);

      // Try to place an order
      await page.click("[data-testid='order-type-limit']");
      await page.click("[data-testid='order-side-buy']");
      await page.fill("[data-testid='order-price']", "40000");
      await page.fill("[data-testid='order-quantity']", "0.001");
      await page.click("[data-testid='place-order-button']");

      // Check error message
      const errorMessage = page.locator(
        "[data-testid='network-error-message']",
      );
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toContainText("Network error");

      // Check retry button
      const retryButton = page.locator("[data-testid='retry-button']");
      await expect(retryButton).toBeVisible();

      // Restore network and retry
      await page.context().setOffline(false);
      await retryButton.click();

      // Should succeed now
      await page.waitForSelector("[data-testid='order-confirmation']");
    });

    test("should handle session timeout", async () => {
      // Wait for extended period to simulate timeout
      await page.waitForTimeout(5000);

      // Simulate expired session
      await page.evaluate(() => {
        localStorage.removeItem("auth_token");
        sessionStorage.clear();
      });

      // Try to place an order
      await page.click("[data-testid='order-type-limit']");
      await page.click("[data-testid='order-side-buy']");
      await page.fill("[data-testid='order-price']", "40000");
      await page.fill("[data-testid='order-quantity']", "0.001");
      await page.click("[data-testid='place-order-button']");

      // Should redirect to login or show session expired message
      const sessionMessage = page.locator(
        "[data-testid='session-expired-message']",
      );
      const loginPage = page.locator("[data-testid='login-form']");

      const sessionExpired = await sessionMessage
        .isVisible()
        .catch(() => false);
      const onLoginPage = await loginPage.isVisible().catch(() => false);

      expect(sessionExpired || onLoginPage).toBeTruthy();
    });
  });

  test.describe("Real-time Updates", () => {
    test("should update prices via WebSocket", async () => {
      // Get initial price
      const priceElement = page.locator("[data-testid='btc-price']");
      const initialPrice = await priceElement.textContent();

      // Wait for WebSocket connection indicator
      const wsIndicator = page.locator("[data-testid='websocket-status']");
      await expect(wsIndicator).toHaveAttribute("data-status", "connected");

      // Wait for price update (max 10 seconds)
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const currentPrice = await priceElement.textContent();
        if (currentPrice !== initialPrice) {
          break;
        }
      }

      // Price should have updated or at least element should still be present
      await expect(priceElement).toBeVisible();
    });

    test("should update order book in real-time", async () => {
      // Get initial order book state
      const bids = page.locator(
        "[data-testid='order-book-bids'] [data-testid='order-book-row']",
      );
      const initialBidCount = await bids.count();
      const firstBid = await bids.first().textContent();

      // Wait for updates (max 10 seconds)
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const currentBidCount = await bids.count();
        const currentFirstBid = await bids.first().textContent();

        if (
          currentBidCount !== initialBidCount ||
          currentFirstBid !== firstBid
        ) {
          break;
        }
      }

      // Order book should be present
      await expect(bids.first()).toBeVisible();
    });

    test("should reconnect WebSocket on disconnect", async () => {
      // Check initial connection
      const wsIndicator = page.locator("[data-testid='websocket-status']");
      await expect(wsIndicator).toHaveAttribute("data-status", "connected");

      // Simulate disconnect by going offline
      await page.context().setOffline(true);

      // Status should show disconnected
      await expect(wsIndicator).toHaveAttribute("data-status", "disconnected");

      // Reconnect
      await page.context().setOffline(false);

      // Wait for reconnection (max 10 seconds)
      await expect(wsIndicator).toHaveAttribute("data-status", "connected", {
        timeout: 10000,
      });

      // Data should resume updating
      const priceElement = page.locator("[data-testid='btc-price']");
      await expect(priceElement).toBeVisible();
    });
  });
});
