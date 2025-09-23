#!/usr/bin/env tsx

/**
 * Script to update configuration for better testnet testing
 * - 1-minute candles for faster testing
 * - 0.5% drop/rise thresholds for more frequent triggers
 * - 100 candle ATH window for better accuracy
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database } from "../types/database";

// Load environment variables - use .env.local for local development
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase credentials in .env.local file");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey);

async function updateTestConfig() {
  console.log("🔧 Updating configuration for testnet testing...\n");

  // 1. Check current configuration
  const { data: currentConfig, error: fetchError } = await supabase
    .from("strategy_config")
    .select("*")
    .eq("is_active", true)
    .single();

  if (fetchError || !currentConfig) {
    console.error("❌ Error fetching current config:", fetchError);
    console.log("\n💡 You may need to initialize the database first.");
    console.log("   Run: npx tsx scripts/init-local-db.ts");
    return;
  }

  console.log("📊 Current Configuration:");
  console.log(`  - Timeframe: ${currentConfig.timeframe}`);
  console.log(
    `  - Drop %: ${(currentConfig.drop_percentage * 100).toFixed(1)}%`,
  );
  console.log(
    `  - Rise %: ${(currentConfig.rise_percentage * 100).toFixed(1)}%`,
  );
  console.log(`  - Max Purchases: ${currentConfig.max_purchases}`);
  console.log(`  - Min Buy USDT: $${currentConfig.min_buy_usdt}`);
  console.log(`  - Initial Capital: $${currentConfig.initial_capital_usdt}`);

  // 2. Update to test configuration
  const { error: updateError } = await supabase
    .from("strategy_config")
    .update({
      timeframe: "5m", // 5-minute candles for faster testing
      drop_percentage: 0.003, // 0.3% drop threshold
      rise_percentage: 0.005, // 0.5% rise threshold
      ath_window: 25,
      // min_buy_usdt stays at $10 (database minimum constraint)
    })
    .eq("id", currentConfig.id);

  if (updateError) {
    console.error("❌ Error updating config:", updateError);
    return;
  }

  console.log("\n✅ Updated Configuration:");
  console.log(`  - Timeframe: 5m (5-minute candles)`);
  console.log(`  - Drop %: 0.3%`);
  console.log(`  - Rise %: 0.5%`);
  console.log(`  - ATH Window: 25 candles`);
  console.log(`  - Min Buy USDT: $${currentConfig.min_buy_usdt} (unchanged)`);

  // 3. Log the configuration change
  await supabase.from("bot_events").insert({
    event_type: "CONFIG_UPDATED",
    severity: "info",
    message: "Configuration updated for testnet testing",
    metadata: {
      previous: {
        timeframe: currentConfig.timeframe,
        drop_percentage: currentConfig.drop_percentage,
        rise_percentage: currentConfig.rise_percentage,
        ath_window: currentConfig.ath_window,
        min_buy_usdt: currentConfig.min_buy_usdt,
      },
      new: {
        timeframe: "5m",
        drop_percentage: 0.003,
        rise_percentage: 0.005,
        min_buy_usdt: currentConfig.min_buy_usdt,
        ath_window: 25, // Note: This is set in code, not database
      },
      updated_by: "update-test-config.ts",
    },
  });

  console.log("\n📝 Important Notes:");
  console.log("1. ATH window has been changed to 25 candles in the code");
  console.log("2. These settings are optimized for testnet testing:");
  console.log("   - 5-minute candles = faster testing cycles");
  console.log("   - 0.3% thresholds = more frequent buy triggers");
  console.log("   - 0.5% thresholds = more frequent sell triggers");
  console.log("   - 25 candle ATH = better price history");
  console.log("\n3. To revert to production settings, update:");
  console.log("   - Timeframe: 4h");
  console.log("   - Drop/Rise: 2% (0.02)");
  console.log("   - Min Buy: $10");
  console.log("\n🚀 Restart the bot to use the new configuration:");
  console.log("   npm start");
}

updateTestConfig()
  .then(() => {
    console.log("\n✅ Configuration update completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Configuration update failed:", error);
    process.exit(1);
  });
