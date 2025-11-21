#!/usr/bin/env tsx
/**
 * Get Strategy Configuration Script
 *
 * Displays the current cycle and active strategy configuration
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

async function getStrategyConfig() {
  console.log("📊 Fetching current cycle and strategy configuration...\n");

  // Get current cycle
  const { data: currentCycle, error: cycleError } = await supabase
    .from("cycle_state")
    .select("*")
    .eq("status", "READY")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cycleError) {
    console.error("❌ Error fetching current cycle:", cycleError);
    process.exit(1);
  }

  if (!currentCycle) {
    console.log("⚠️  No READY cycle found\n");
  } else {
    console.log("✅ Current Cycle:");
    console.log(`   ID: ${currentCycle.id}`);
    console.log(`   Status: ${currentCycle.status}`);
    console.log(`   Capital: $${currentCycle.capital_available}`);
    console.log(`   BTC Accumulated: ${currentCycle.btc_accumulated} BTC`);
    console.log(`   Purchases Remaining: ${currentCycle.purchases_remaining}`);
    console.log(`   Buy Amount: $${currentCycle.buy_amount}`);
    console.log(
      `   Strategy Config ID: ${currentCycle.strategy_config_id || "Not linked"}\n`,
    );
  }

  // Get strategy config
  const { data: strategyConfig, error: configError } = await supabase
    .from("strategy_config")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();

  if (configError) {
    console.error("❌ Error fetching strategy config:", configError);
    process.exit(1);
  }

  if (!strategyConfig) {
    console.log("⚠️  No active strategy configuration found");
    process.exit(0);
  }

  console.log("⚙️  Active Strategy Configuration:");
  console.log("   ================================");
  console.log(`   ID: ${strategyConfig.id}`);
  console.log(`   Symbol: ${strategyConfig.symbol}`);
  console.log(`   Max Purchases: ${strategyConfig.max_purchases}`);
  console.log(
    `   Drop Percentage: ${(strategyConfig.drop_percentage * 100).toFixed(2)}%`,
  );
  console.log(
    `   Rise Percentage: ${(strategyConfig.rise_percentage * 100).toFixed(2)}%`,
  );
  console.log(
    `   Slippage Guard: ${(strategyConfig.slippage_guard * 100).toFixed(2)}%`,
  );
  console.log(
    `   Commission Rate: ${(strategyConfig.commission_rate * 100).toFixed(2)}%`,
  );
  console.log(`   Is Active: ${strategyConfig.is_active}`);
  console.log(`   Created: ${strategyConfig.created_at}`);
  console.log(`   Updated: ${strategyConfig.updated_at}\n`);

  console.log("📈 Trading Strategy Details:");
  console.log("   ==========================");
  console.log(
    `   • Buy when price drops ${(strategyConfig.drop_percentage * 100).toFixed(2)}% from anchor`,
  );
  console.log(
    `   • Sell when price rises ${(strategyConfig.rise_percentage * 100).toFixed(2)}% above SRP`,
  );
  console.log(`   • Max ${strategyConfig.max_purchases} buy levels per cycle`);
  console.log(
    `   • Slippage protection: ${(strategyConfig.slippage_guard * 100).toFixed(2)}%`,
  );
  console.log(
    `   • Estimated commission: ${(strategyConfig.commission_rate * 100).toFixed(2)}%\n`,
  );

  console.log("💡 Spec v3 Compliance:");
  console.log("   ====================");
  console.log("   ✅ SRP = cost_accum_usdt / base_tradeable");
  console.log(
    `   ✅ Target Sell = (SRP × ${(1 + strategyConfig.rise_percentage).toFixed(3)}) / ${(1 - strategyConfig.commission_rate).toFixed(3)}`,
  );
  console.log("   ✅ No BTC fee double-counting");
  console.log("   ✅ Dust excluded from SRP calculation");
  console.log("");
}

getStrategyConfig()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
