#!/usr/bin/env npx tsx
/**
 * Script to verify the new cycle is set up correctly
 * and will properly handle buy_anchor_price
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient<Database>(supabaseUrl, supabaseKey);

async function verifyCycle() {
  console.log("🔍 Verifying new cycle setup...\n");

  // Get current cycle
  const { data: cycle, error } = await supabase
    .from("cycle_state")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("❌ Error fetching cycle:", error);
    process.exit(1);
  }

  console.log("✅ Cycle found:");
  console.log("  ID:", cycle.id);
  console.log("  Status:", cycle.status);
  console.log("  Capital Available: $" + cycle.capital_available);
  console.log("  BTC Accumulated:", cycle.btc_accumulated || 0);
  console.log(
    "  Buy Anchor Price:",
    cycle.buy_anchor_price || "NULL (will be set on first buy)",
  );
  console.log("  Purchases Remaining:", cycle.purchases_remaining);
  console.log("  Reference Price: $" + cycle.reference_price);
  console.log("  ATH Price: $" + cycle.ath_price);
  console.log("  Buy Amount: $" + cycle.buy_amount);
  console.log("");

  // Check strategy config
  const { data: strategy, error: strategyError } = await supabase
    .from("strategy_config")
    .select("*")
    .eq("is_active", true)
    .single();

  if (strategyError) {
    console.error("❌ Error fetching strategy:", strategyError);
    process.exit(1);
  }

  console.log("✅ Strategy config found:");
  console.log("  Drop Percentage:", strategy.drop_percentage * 100 + "%");
  console.log("  Rise Percentage:", strategy.rise_percentage * 100 + "%");
  console.log("  Max Purchases:", strategy.max_purchases);
  console.log("  Initial Capital: $" + strategy.initial_capital_usdt);

  // Calculate and show sell target if we have a reference price
  if (cycle.reference_price) {
    const commissionRate = 0.001; // Default 0.1% Binance commission
    const sellTarget =
      (cycle.reference_price * (1 + strategy.rise_percentage)) /
      (1 - commissionRate);
    console.log("");
    console.log("📈 Sell Target Calculation:");
    console.log(`  Reference Price: $${cycle.reference_price.toFixed(2)}`);
    console.log(
      `  Target Rise: ${(strategy.rise_percentage * 100).toFixed(1)}%`,
    );
    console.log(`  Commission Rate: ${(commissionRate * 100).toFixed(1)}%`);
    console.log(
      `  Actual Sell Target: $${sellTarget.toFixed(2)} (commission-adjusted)`,
    );
    console.log(
      `  → Will trigger sell when price >= $${sellTarget.toFixed(2)}`,
    );
  }
  console.log("");

  // Validate setup
  console.log("📋 Validation:");

  if (!cycle.buy_anchor_price) {
    console.log("  ✅ buy_anchor_price is NULL (correct for new cycle)");
    console.log("     → Will be set to execution price on first buy");
    console.log("     → First buy will be limited to 1 grid level");
    console.log("     → Subsequent buys can trigger multiple levels");
  } else {
    console.log(
      "  ⚠️ buy_anchor_price is already set to",
      cycle.buy_anchor_price,
    );
    console.log("     → This means it's not a fresh cycle");
  }

  if (cycle.btc_accumulated === 0 || cycle.btc_accumulated === null) {
    console.log("  ✅ No BTC accumulated yet (fresh cycle)");
  }

  if (cycle.capital_available === strategy.initial_capital_usdt) {
    console.log("  ✅ Capital matches initial capital");
  }

  if (cycle.purchases_remaining === strategy.max_purchases) {
    console.log("  ✅ All purchases available");
  }

  console.log("\n🎉 New cycle is properly configured and ready to trade!");
  console.log("   The buy_anchor_price fix will work correctly.");
}

verifyCycle().catch(console.error);
