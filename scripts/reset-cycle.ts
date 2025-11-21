#!/usr/bin/env tsx
/**
 * Reset Cycle Script
 *
 * This script:
 * 1. Finds the current active cycle
 * 2. Marks it as COMPLETED (if exists)
 * 3. Creates a fresh new cycle for testing
 *
 * Usage: pnpm tsx scripts/reset-cycle.ts
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase configuration");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey);

async function resetCycle() {
  console.log("🔄 Starting cycle reset for spec compliance testing...\n");

  // Step 1: Get current active cycle
  console.log("📊 Fetching current cycle state...");
  const { data: currentCycle, error: fetchError } = await supabase
    .from("cycle_state")
    .select("*")
    .in("status", ["READY", "HOLDING", "PAUSED"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error("❌ Error fetching current cycle:", fetchError);
    process.exit(1);
  }

  if (currentCycle) {
    console.log("✅ Current cycle found:");
    console.log(`   ID: ${currentCycle.id}`);
    console.log(`   Status: ${currentCycle.status}`);
    console.log(`   Capital Available: $${currentCycle.capital_available}`);
    console.log(`   BTC Accumulated: ${currentCycle.btc_accumulated} BTC`);
    console.log(`   Cost Accumulated: $${currentCycle.cost_accum_usdt || 0}`);
    console.log(`   Purchases Remaining: ${currentCycle.purchases_remaining}`);
    console.log(
      "   Sell Reference Price (SRP):",
      currentCycle.sell_reference_price || "Not set",
    );
    console.log("");

    // Step 2: Mark as COMPLETED
    console.log("🏁 Marking current cycle as COMPLETED...");
    const { error: updateError } = await supabase
      .from("cycle_state")
      .update({
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentCycle.id);

    if (updateError) {
      console.error("❌ Error marking cycle as completed:", updateError);
      process.exit(1);
    }

    console.log("✅ Current cycle marked as COMPLETED\n");
  } else {
    console.log("ℹ️  No active cycle found. Creating a new one...\n");
  }

  // Step 3: Get strategy config or use defaults
  console.log("⚙️  Fetching strategy configuration...");
  const { data: strategyConfig } = await supabase
    .from("strategy_config")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();

  const initialCapital = parseFloat(process.env.INITIAL_CAPITAL_USDT || "300");
  const maxPurchases = strategyConfig?.max_purchases || 10;
  const buyAmount = Math.floor((initialCapital / maxPurchases) * 100) / 100;

  console.log("✅ Configuration loaded:");
  console.log(`   Initial Capital: $${initialCapital}`);
  console.log(`   Max Purchases: ${maxPurchases}`);
  console.log(`   Buy Amount per Purchase: $${buyAmount}\n`);

  // Step 4: Create new fresh cycle
  console.log("🆕 Creating new fresh cycle...");
  const { data: newCycle, error: insertError } = await supabase
    .from("cycle_state")
    .insert({
      status: "READY",
      capital_available: initialCapital,
      btc_accumulated: 0,
      btc_dust: 0,
      btc_accum_net: 0,
      cost_accum_usdt: 0,
      purchases_remaining: maxPurchases,
      buy_amount: buyAmount,
      sell_reference_price: null,
      ath_reference_price: null,
      ath_price: null,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      strategy_config_id: strategyConfig?.id || null,
      previous_cycle_id: currentCycle?.id || null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error("❌ Error creating new cycle:", insertError);
    process.exit(1);
  }

  console.log("✅ New cycle created successfully!");
  console.log(`   ID: ${newCycle.id}`);
  console.log(`   Status: ${newCycle.status}`);
  console.log(`   Capital Available: $${newCycle.capital_available}`);
  console.log(`   BTC Accumulated: ${newCycle.btc_accumulated} BTC`);
  console.log(`   Cost Accumulated: $${newCycle.cost_accum_usdt}`);
  console.log(`   Purchases Remaining: ${newCycle.purchases_remaining}`);
  console.log(`   Buy Amount: $${newCycle.buy_amount}\n`);

  console.log("🎉 Cycle reset complete! Ready for spec compliance testing.\n");
  console.log("📝 Summary:");
  if (currentCycle) {
    console.log(
      `   - Old Cycle ${currentCycle.id.substring(0, 8)}...: COMPLETED`,
    );
  }
  console.log(`   - New Cycle ${newCycle.id.substring(0, 8)}...: READY`);
  console.log("");
  console.log(
    "💡 This fresh cycle will use the corrected spec-compliant formulas:",
  );
  console.log("   - SRP = cost_accum_usdt / base_tradeable (dust excluded)");
  console.log("   - Target = (SRP × (1 + rise%)) / (1 - fee%)");
  console.log("   - No BTC fee double-counting");
  console.log("");
}

resetCycle()
  .then(() => {
    console.log("✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
