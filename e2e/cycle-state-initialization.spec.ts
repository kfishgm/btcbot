import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase.js";

// Mock environment for testing
const TEST_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key",
};

test.describe("Cycle State Initialization E2E", () => {
  let supabase: ReturnType<typeof createClient<Database>>;

  test.beforeAll(async () => {
    // Initialize Supabase client for test setup/teardown
    supabase = createClient<Database>(
      TEST_ENV.SUPABASE_URL,
      TEST_ENV.SUPABASE_SERVICE_ROLE_KEY,
    );
  });

  test.beforeEach(async () => {
    // Clean up any existing cycle states before each test
    await supabase.from("cycle_state").delete().neq("id", "");
  });

  test.afterEach(async () => {
    // Clean up after each test
    await supabase.from("cycle_state").delete().neq("id", "");
    await supabase.from("bot_events").delete().neq("id", "");
  });

  test.describe("Application Startup", () => {
    test("should create initial cycle state when no state exists", async ({
      page,
    }) => {
      // This will fail - application doesn't exist yet
      // Start the application
      await page.goto("/");

      // Give the app time to initialize
      await page.waitForTimeout(2000);

      // Check database for created state
      const { data: cycleState } = await supabase
        .from("cycle_state")
        .select("*")
        .single();

      expect(cycleState).toBeTruthy();
      expect(cycleState?.status).toBe("READY");
      expect(cycleState?.capital_available).toBe(300); // From default config
      expect(cycleState?.btc_accumulated).toBe(0);
      expect(cycleState?.purchases_remaining).toBe(10); // From default config
      expect(cycleState?.reference_price).toBeNull();
      expect(cycleState?.cost_accum_usdt).toBe(0);
      expect(cycleState?.btc_accum_net).toBe(0);
      expect(cycleState?.ath_price).toBeNull();
      expect(cycleState?.buy_amount).toBe(30); // floor(300/10)
    });

    test("should display cycle state on dashboard after initialization", async ({
      page,
    }) => {
      // Start the application
      await page.goto("/dashboard");

      // Wait for state to be displayed
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Verify state is displayed correctly
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "READY",
      );
      await expect(
        page.locator('[data-testid="capital-available"]'),
      ).toContainText("300.00");
      await expect(
        page.locator('[data-testid="btc-accumulated"]'),
      ).toContainText("0.00000000");
      await expect(
        page.locator('[data-testid="purchases-remaining"]'),
      ).toContainText("10");
    });

    test("should recover existing valid state on restart", async ({ page }) => {
      // Pre-create a valid state
      const existingState = {
        status: "HOLDING",
        capital_available: 150,
        btc_accumulated: 0.005,
        purchases_remaining: 5,
        reference_price: 50000,
        cost_accum_usdt: 150,
        btc_accum_net: 0.003,
        ath_price: 52000,
        buy_amount: 30,
      };

      await supabase.from("cycle_state").insert(existingState);

      // Start the application
      await page.goto("/dashboard");

      // Wait for state to be displayed
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Verify existing state was loaded
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "HOLDING",
      );
      await expect(
        page.locator('[data-testid="capital-available"]'),
      ).toContainText("150.00");
      await expect(
        page.locator('[data-testid="btc-accumulated"]'),
      ).toContainText("0.00500000");
      await expect(
        page.locator('[data-testid="purchases-remaining"]'),
      ).toContainText("5");
      await expect(
        page.locator('[data-testid="reference-price"]'),
      ).toContainText("50,000.00");
    });

    test("should pause when corrupted state is detected", async ({ page }) => {
      // Pre-create a corrupted state (negative capital)
      const corruptedState = {
        status: "READY",
        capital_available: -100, // Invalid
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
      };

      await supabase.from("cycle_state").insert(corruptedState);

      // Start the application
      await page.goto("/dashboard");

      // Wait for state to be updated to PAUSED
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Verify state was paused
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "PAUSED",
      );

      // Verify error alert is shown
      await expect(page.locator('[data-testid="error-alert"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-alert"]')).toContainText(
        "Corrupted cycle state detected",
      );

      // Check database was updated
      const { data: updatedState } = await supabase
        .from("cycle_state")
        .select("status")
        .single();

      expect(updatedState?.status).toBe("PAUSED");

      // Check bot_event was created
      const { data: events } = await supabase
        .from("bot_events")
        .select("*")
        .eq("event_type", "CYCLE_STATE_CORRUPTION");

      expect(events).toHaveLength(1);
      expect(events?.[0].severity).toBe("ERROR");
    });
  });

  test.describe("Configuration Changes", () => {
    test("should recalculate buy_amount when configuration changes", async ({
      page,
    }) => {
      // Start the application
      await page.goto("/settings");

      // Wait for settings page to load
      await page.waitForSelector('[data-testid="initial-capital-input"]', {
        timeout: 5000,
      });

      // Change initial capital
      await page.fill('[data-testid="initial-capital-input"]', "500");

      // Change max purchases
      await page.fill('[data-testid="max-purchases-input"]', "20");

      // Save settings
      await page.click('[data-testid="save-settings-button"]');

      // Wait for success message
      await expect(
        page.locator('[data-testid="success-message"]'),
      ).toBeVisible();

      // Navigate to dashboard
      await page.goto("/dashboard");

      // Verify buy_amount was recalculated
      await expect(page.locator('[data-testid="buy-amount"]')).toContainText(
        "25.00",
      ); // floor(500/20)
    });

    test("should validate min_buy_usdt constraint", async ({ page }) => {
      // Start the application
      await page.goto("/settings");

      // Wait for settings page to load
      await page.waitForSelector('[data-testid="initial-capital-input"]', {
        timeout: 5000,
      });

      // Set configuration that would result in buy_amount < min_buy_usdt
      await page.fill('[data-testid="initial-capital-input"]', "50");
      await page.fill('[data-testid="max-purchases-input"]', "10");
      await page.fill('[data-testid="min-buy-usdt-input"]', "10");

      // Try to save settings
      await page.click('[data-testid="save-settings-button"]');

      // Should show validation error
      await expect(
        page.locator('[data-testid="validation-error"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="validation-error"]'),
      ).toContainText("Buy amount (5.00) would be below minimum (10.00)");
    });
  });

  test.describe("State Recovery Scenarios", () => {
    test("should handle multiple restarts gracefully", async ({ page }) => {
      // First startup - creates initial state
      await page.goto("/dashboard");
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "READY",
      );

      // Simulate restart by reloading
      await page.reload();
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Should still show same state
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "READY",
      );

      // Check database - should only have one state record
      const { data: states } = await supabase.from("cycle_state").select("*");

      expect(states).toHaveLength(1);
    });

    test("should validate state consistency on every startup", async ({
      page,
    }) => {
      // Create state with inconsistent data
      const inconsistentState = {
        status: "HOLDING",
        capital_available: 150,
        btc_accumulated: 0.005, // Has BTC
        purchases_remaining: 10, // But still has all purchases (inconsistent)
        reference_price: null, // Should have reference when holding
        cost_accum_usdt: 0, // Should be non-zero when holding
        btc_accum_net: 0, // Should be non-zero when holding
        ath_price: null,
        buy_amount: 30,
      };

      await supabase.from("cycle_state").insert(inconsistentState);

      // Start the application
      await page.goto("/dashboard");

      // Wait for state validation and update
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Should be paused due to inconsistency
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "PAUSED",
      );

      // Should show specific validation error
      await expect(page.locator('[data-testid="error-details"]')).toBeVisible();
      await expect(page.locator('[data-testid="error-details"]')).toContainText(
        "State validation failed",
      );
    });

    test("should preserve state through application errors", async ({
      page,
    }) => {
      // Create a valid state
      const validState = {
        status: "HOLDING",
        capital_available: 200,
        btc_accumulated: 0.003,
        purchases_remaining: 7,
        reference_price: 45000,
        cost_accum_usdt: 100,
        btc_accum_net: 0.0022,
        ath_price: 48000,
        buy_amount: 30,
      };

      await supabase.from("cycle_state").insert(validState);

      // Start the application
      await page.goto("/dashboard");
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Simulate application error by navigating to invalid route
      await page.goto("/invalid-route-that-causes-error");

      // Navigate back to dashboard
      await page.goto("/dashboard");
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // State should be preserved
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "HOLDING",
      );
      await expect(
        page.locator('[data-testid="capital-available"]'),
      ).toContainText("200.00");
      await expect(
        page.locator('[data-testid="btc-accumulated"]'),
      ).toContainText("0.00300000");
    });
  });

  test.describe("Error Handling", () => {
    test("should show error when database is unavailable", async ({ page }) => {
      // This test would require mocking database unavailability
      // In a real scenario, you might stop the database or use network interception

      // Intercept database requests and make them fail
      await page.route("**/rest/v1/cycle_state*", (route) => {
        route.abort("failed");
      });

      // Try to start the application
      await page.goto("/dashboard");

      // Should show database connection error
      await expect(
        page.locator('[data-testid="connection-error"]'),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="connection-error"]'),
      ).toContainText("Database connection failed");

      // Should show retry button
      await expect(page.locator('[data-testid="retry-button"]')).toBeVisible();
    });

    test("should handle concurrent initialization attempts", async ({
      browser,
    }) => {
      // Open two browser contexts simultaneously
      const context1 = await browser.newContext();
      const context2 = await browser.newContext();

      const page1 = await context1.newPage();
      const page2 = await context2.newPage();

      // Start both applications simultaneously
      await Promise.all([page1.goto("/dashboard"), page2.goto("/dashboard")]);

      // Wait for both to initialize
      await Promise.all([
        page1.waitForSelector('[data-testid="cycle-status"]', {
          timeout: 5000,
        }),
        page2.waitForSelector('[data-testid="cycle-status"]', {
          timeout: 5000,
        }),
      ]);

      // Both should show the same state
      await expect(page1.locator('[data-testid="cycle-status"]')).toContainText(
        "READY",
      );
      await expect(page2.locator('[data-testid="cycle-status"]')).toContainText(
        "READY",
      );

      // Database should only have one state record
      const { data: states } = await supabase.from("cycle_state").select("*");

      expect(states).toHaveLength(1);

      await context1.close();
      await context2.close();
    });

    test("should log initialization events for debugging", async ({ page }) => {
      // Start the application
      await page.goto("/dashboard");

      // Wait for initialization
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Check bot_events for initialization log
      const { data: events } = await supabase
        .from("bot_events")
        .select("*")
        .eq("event_type", "CYCLE_STATE_INITIALIZED")
        .order("created_at", { ascending: false });

      expect(events).toBeTruthy();
      expect(events?.[0]).toMatchObject({
        event_type: "CYCLE_STATE_INITIALIZED",
        severity: "INFO",
        message: expect.stringContaining("Cycle state initialized"),
      });
    });
  });

  test.describe("UI Feedback", () => {
    test("should show loading state during initialization", async ({
      page,
    }) => {
      // Slow down the database response to see loading state
      await page.route("**/rest/v1/cycle_state*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      });

      // Start the application
      await page.goto("/dashboard");

      // Should show loading indicator immediately
      await expect(
        page.locator('[data-testid="loading-spinner"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="loading-message"]'),
      ).toContainText("Initializing cycle state...");

      // Wait for initialization to complete
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 10000,
      });

      // Loading should disappear
      await expect(
        page.locator('[data-testid="loading-spinner"]'),
      ).not.toBeVisible();
    });

    test("should update UI immediately after state changes", async ({
      page,
    }) => {
      // Start the application
      await page.goto("/dashboard");
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Initial state should be READY
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "READY",
      );

      // Simulate a state change in the database
      const { data: currentState } = await supabase
        .from("cycle_state")
        .select("*")
        .single();

      if (currentState?.id) {
        await supabase
          .from("cycle_state")
          .update({
            status: "HOLDING",
            btc_accumulated: 0.001,
            purchases_remaining: 9,
          })
          .eq("id", currentState.id);
      }

      // UI should update (assuming real-time subscriptions or polling)
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "HOLDING",
        { timeout: 5000 },
      );
      await expect(
        page.locator('[data-testid="btc-accumulated"]'),
      ).toContainText("0.00100000");
      await expect(
        page.locator('[data-testid="purchases-remaining"]'),
      ).toContainText("9");
    });

    test("should provide clear feedback when state is paused", async ({
      page,
    }) => {
      // Create a paused state
      await supabase.from("cycle_state").insert({
        status: "PAUSED",
        capital_available: 300,
        btc_accumulated: 0,
        purchases_remaining: 10,
        reference_price: null,
        cost_accum_usdt: 0,
        btc_accum_net: 0,
        ath_price: null,
        buy_amount: 30,
      });

      // Start the application
      await page.goto("/dashboard");
      await page.waitForSelector('[data-testid="cycle-status"]', {
        timeout: 5000,
      });

      // Should show paused status prominently
      await expect(page.locator('[data-testid="cycle-status"]')).toContainText(
        "PAUSED",
      );
      await expect(page.locator('[data-testid="cycle-status"]')).toHaveClass(
        /.*warning.*/,
      );

      // Should show pause reason if available
      await expect(page.locator('[data-testid="pause-notice"]')).toBeVisible();
      await expect(page.locator('[data-testid="pause-notice"]')).toContainText(
        "Trading is paused. Manual intervention required.",
      );

      // Trading controls should be disabled
      await expect(
        page.locator('[data-testid="start-trading-button"]'),
      ).toBeDisabled();
    });
  });
});
