/**
 * E2E Test Environment Setup
 *
 * This file ensures that E2E tests:
 * 1. Load the correct .env.test configuration
 * 2. Don't contaminate local or production databases
 * 3. Don't send Discord notifications
 * 4. Run in complete isolation
 */

import { config } from "dotenv";
import path from "path";

// Load .env.test for E2E tests, NOT .env.local or .env
config({ path: path.resolve(process.cwd(), ".env.test") });

// Force test environment
process.env.NODE_ENV = "test";

// Force disable Discord notifications
process.env.DISCORD_WEBHOOK_URL = "";

// Safety checks
export function validateTestEnvironment(): void {
  // Ensure we're in test mode
  if (process.env.NODE_ENV !== "test") {
    throw new Error("E2E tests must run with NODE_ENV=test");
  }

  // Ensure Discord is disabled
  if (process.env.DISCORD_WEBHOOK_URL) {
    throw new Error("Discord must be disabled for E2E tests");
  }

  // Ensure not using production database
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set for tests");
  }

  if (
    !supabaseUrl.includes("localhost") &&
    !supabaseUrl.includes("127.0.0.1")
  ) {
    throw new Error("E2E tests must use local/mock database, not production");
  }

  // Ensure we're not using real API keys
  const binanceKey = process.env.BINANCE_API_KEY;
  if (
    binanceKey &&
    !binanceKey.includes("mock") &&
    !binanceKey.includes("test")
  ) {
    throw new Error("E2E tests must use mock Binance credentials");
  }
}

// Run validation immediately when this file is imported
validateTestEnvironment();

// Export for use in tests
export const TEST_CONFIG = {
  initialCapitalUsdt: parseFloat(process.env.INITIAL_CAPITAL_USDT || "1000"),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  binanceApiKey: process.env.BINANCE_API_KEY!,
  binanceApiSecret: process.env.BINANCE_API_SECRET!,
  isTestnet: process.env.BINANCE_TESTNET === "true",
};
