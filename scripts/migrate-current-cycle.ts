#!/usr/bin/env tsx

/**
 * Migration script to properly set up the current cycle state
 * after implementing the new cycle completion tracking system.
 *
 * This script will:
 * 1. Mark the old cycle as COMPLETED
 * 2. Create a new fresh cycle with the correct starting values
 */

import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase.js";

// Load environment variables
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

async function main() {
  console.log("Starting cycle migration...");

  // Initialize Supabase client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase configuration");
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  // 1. Get the current cycle
  const { data: currentCycle, error: fetchError } = await supabase
    .from("cycle_state")
    .select("*")
    .eq("id", "7a59bb7b-a697-41c7-956e-7e447c8cb674")
    .single();

  if (fetchError || !currentCycle) {
    console.error("Failed to fetch current cycle:", fetchError);
    process.exit(1);
  }

  console.log("Current cycle found:", {
    id: currentCycle.id,
    status: currentCycle.status,
    btc_accumulated: currentCycle.btc_accumulated,
    capital_available: currentCycle.capital_available,
  });

  // 2. Mark the current cycle as COMPLETED
  type CycleStatus =
    Database["public"]["Tables"]["cycle_state"]["Update"]["status"];
  const completedStatus: CycleStatus = "COMPLETED" as CycleStatus;

  const { error: updateError } = await supabase
    .from("cycle_state")
    .update({
      status: completedStatus,
      completed_at: new Date().toISOString(),
      final_profit: 4.2495226629, // The profit from the last sell
      updated_at: new Date().toISOString(),
    })
    .eq("id", currentCycle.id);

  if (updateError) {
    console.error("Failed to mark cycle as completed:", updateError);
    process.exit(1);
  }

  console.log("✅ Marked old cycle as COMPLETED");

  // 3. Get active strategy config
  const { data: strategyConfig, error: configError } = await supabase
    .from("strategy_config")
    .select("*")
    .eq("is_active", true)
    .single();

  if (configError || !strategyConfig) {
    console.error("No active strategy configuration found:", configError);
    process.exit(1);
  }

  console.log("Active strategy config found:", {
    id: strategyConfig.id,
    max_purchases: strategyConfig.max_purchases,
    initial_capital_usdt: strategyConfig.initial_capital_usdt,
  });

  // 4. Calculate buy amount for new cycle
  const carryOverCapital = 1004.2495226629;
  const carryOverDust = 0.00000278;
  const buyAmount =
    Math.floor((carryOverCapital / strategyConfig.max_purchases) * 100000000) /
    100000000;

  // 5. Create new cycle
  const newCycleData = {
    status: "READY" as const,
    capital_available: carryOverCapital,
    btc_accumulated: carryOverDust,
    btc_dust: carryOverDust,
    btc_accum_net: 0,
    cost_accum_usdt: 0,
    purchases_remaining: strategyConfig.max_purchases,
    buy_amount: buyAmount,
    reference_price: null,
    ath_price: null,
    buy_anchor_price: null,
    buy_grid: null,
    buy_index: 0,
    strategy_config_id: strategyConfig.id,
    previous_cycle_id: currentCycle.id,
    updated_at: new Date().toISOString(),
  };

  const { data: newCycle, error: insertError } = await supabase
    .from("cycle_state")
    .insert(newCycleData)
    .select()
    .single();

  if (insertError || !newCycle) {
    console.error("Failed to create new cycle:", insertError);
    process.exit(1);
  }

  console.log("✅ New cycle created successfully:", {
    id: newCycle.id,
    status: newCycle.status,
    capital_available: newCycle.capital_available,
    btc_dust: newCycle.btc_dust,
    buy_amount: newCycle.buy_amount,
    purchases_remaining: newCycle.purchases_remaining,
    previous_cycle_id: newCycle.previous_cycle_id,
  });

  console.log("\n🎉 Migration completed successfully!");
  console.log("The bot will now use the new cycle when it starts.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
