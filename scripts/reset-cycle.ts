#!/usr/bin/env tsx
/**
 * Reset Cycle Script
 *
 * This script:
 * 1. Finds the current active cycle
 * 2. Marks it as COMPLETED (if exists)
 * 3. Creates a fresh new cycle with specified options
 * 4. Optionally updates strategy config
 *
 * Usage:
 *   pnpm tsx scripts/reset-cycle.ts [options]
 *
 * Examples:
 *   pnpm tsx scripts/reset-cycle.ts --help
 *   pnpm tsx scripts/reset-cycle.ts --capital 500 --mode geom_modified
 *   pnpm tsx scripts/reset-cycle.ts --capital 1000 --purchases 20 --drop 0.05
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

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  help: boolean;
  capital: number;
  purchases: number;
  mode: "arithmetic" | "geom_modified";
  drop: number;
  rise: number;
  minBuy: number;
  athWindow: number;
  updateConfig: boolean;
  dryRun: boolean;
  timeframe: string;
  capitalPct: number | null;
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         BTC Bot - Reset Cycle Script                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  pnpm tsx scripts/reset-cycle.ts [OPTIONS]

OPTIONS:
  --help, -h              Show this help message

  CYCLE OPTIONS:
  --capital, -c <num>     Initial capital in USDT (default: $300 or env)
  --purchases, -p <num>   Max purchases per cycle (default: 10)

  STRATEGY OPTIONS:
  --mode, -m <mode>       Buy mode: "arithmetic" or "geom_modified" (default: arithmetic)
  --drop, -d <pct>        Drop percentage, e.g., 0.03 for 0.03%, 3 for 3% (default: 3%)
  --rise, -r <pct>        Rise percentage, e.g., 0.05 for 0.05%, 5 for 5% (default: 3%)
  --min-buy <num>         Minimum buy amount in USDT (default: 10)
  --ath-window <num>      ATH lookback window in candles (default: 20)
  --timeframe, -t <tf>    Timeframe for strategy config (default: 4h)
  --capital-pct <pct>     Capital allocation percentage for multi-config (default: 100)

  BEHAVIOR:
  --update-config         Also update strategy_config table with these settings
  --dry-run               Show what would happen without making changes

EXAMPLES:
  # Reset with defaults (arithmetic mode, $300 capital)
  pnpm tsx scripts/reset-cycle.ts

  # Use geometric modified mode with $500 capital
  pnpm tsx scripts/reset-cycle.ts --capital 500 --mode geom_modified

  # Custom strategy: 5% drop, 20 purchases, update config
  pnpm tsx scripts/reset-cycle.ts -c 1000 -p 20 -d 0.05 --update-config

  # Dry run to see what would happen
  pnpm tsx scripts/reset-cycle.ts --capital 500 --mode geom_modified --dry-run

BUY MODES:
  arithmetic      Grid-based strategy with pre-calculated levels.
                  - Multiple levels can trigger in one candle
                  - First buy sets anchor price, grid is rebuilt from anchor

  geom_modified   Dynamic threshold strategy (no grid).
                  - Max 1 buy per candle
                  - Each fill price becomes the anchor for the next threshold
                  - threshold = p_last_buy × (1 - drop%)
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    capital: parseFloat(process.env.INITIAL_CAPITAL_USDT || "300"),
    purchases: 10,
    mode: "arithmetic",
    drop: 0.03, // 3% as decimal
    rise: 0.03, // 3% as decimal
    minBuy: 10,
    athWindow: 20,
    updateConfig: false,
    dryRun: false,
    timeframe: "4h",
    capitalPct: 100,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;

      case "--capital":
      case "-c":
        options.capital = parseFloat(nextArg);
        i++;
        break;

      case "--purchases":
      case "-p":
        options.purchases = parseInt(nextArg, 10);
        i++;
        break;

      case "--mode":
      case "-m":
        if (nextArg === "arithmetic" || nextArg === "geom_modified") {
          options.mode = nextArg;
        } else {
          console.error(
            `❌ Invalid mode: "${nextArg}". Must be "arithmetic" or "geom_modified"`,
          );
          process.exit(1);
        }
        i++;
        break;

      case "--drop":
      case "-d":
        // Convert percentage to decimal (e.g., 0.03 -> 0.0003, 3 -> 0.03)
        options.drop = parseFloat(nextArg) / 100;
        i++;
        break;

      case "--rise":
      case "-r":
        // Convert percentage to decimal (e.g., 0.05 -> 0.0005, 5 -> 0.05)
        options.rise = parseFloat(nextArg) / 100;
        i++;
        break;

      case "--min-buy":
        options.minBuy = parseFloat(nextArg);
        i++;
        break;

      case "--ath-window":
        options.athWindow = parseInt(nextArg, 10);
        i++;
        break;

      case "--timeframe":
      case "-t":
        options.timeframe = nextArg;
        i++;
        break;

      case "--capital-pct":
        options.capitalPct = parseFloat(nextArg);
        i++;
        break;

      case "--update-config":
        options.updateConfig = true;
        break;

      case "--dry-run":
        options.dryRun = true;
        break;

      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          console.error("   Run with --help for usage information");
          process.exit(1);
        }
    }
  }

  return options;
}

// ============================================================================
// Main Script
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function resetCycle(options: CliOptions) {
  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase configuration");
    console.error(
      "   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  const buyAmount =
    Math.floor((options.capital / options.purchases) * 100) / 100;

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                            Reset Cycle${options.dryRun ? " (DRY RUN)" : ""}                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  console.log("📋 Configuration:");
  console.log(`   Buy Mode:          ${options.mode}`);
  console.log(`   Initial Capital:   $${options.capital}`);
  console.log(`   Max Purchases:     ${options.purchases}`);
  console.log(`   Buy Amount:        $${buyAmount} per purchase`);
  console.log(`   Drop Percentage:   ${(options.drop * 100).toFixed(1)}%`);
  console.log(`   Rise Percentage:   ${(options.rise * 100).toFixed(1)}%`);
  console.log(`   Min Buy:           $${options.minBuy}`);
  console.log(`   ATH Window:        ${options.athWindow} candles`);
  console.log(`   Update Config:     ${options.updateConfig ? "Yes" : "No"}`);
  console.log("");

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
    console.log("   Found active cycle:");
    console.log(
      `   ├─ ID:                 ${currentCycle.id.substring(0, 8)}...`,
    );
    console.log(`   ├─ Status:             ${currentCycle.status}`);
    console.log(`   ├─ Capital Available:  $${currentCycle.capital_available}`);
    console.log(
      `   ├─ BTC Accumulated:    ${currentCycle.btc_accumulated} BTC`,
    );
    console.log(
      `   ├─ Purchases Made:     ${currentCycle.purchases_remaining !== null ? options.purchases - currentCycle.purchases_remaining : 0}`,
    );
    console.log(
      `   └─ p_last_buy:         ${currentCycle.p_last_buy ?? "Not set"}`,
    );
    console.log("");
  } else {
    console.log("   No active cycle found.\n");
  }

  if (options.dryRun) {
    console.log("🔍 DRY RUN - No changes will be made\n");
    console.log("Would perform:");
    if (currentCycle) {
      console.log(
        `   1. Mark cycle ${currentCycle.id.substring(0, 8)}... as COMPLETED`,
      );
    }
    console.log(
      `   ${currentCycle ? "2" : "1"}. Create new cycle with above configuration`,
    );
    if (options.updateConfig) {
      console.log(
        `   ${currentCycle ? "3" : "2"}. Update strategy_config with new settings`,
      );
    }
    console.log(
      "\n✅ Dry run complete. Run without --dry-run to apply changes.",
    );
    return;
  }

  // Step 2: Mark current cycle as COMPLETED
  if (currentCycle) {
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
    console.log("   ✓ Cycle marked as COMPLETED\n");
  }

  // Step 3: Update strategy config if requested
  if (options.updateConfig) {
    console.log(
      `⚙️  Updating strategy configuration for timeframe ${options.timeframe}...`,
    );

    // Find active config by timeframe
    const { data: existingConfig } = await supabase
      .from("strategy_config")
      .select("id")
      .eq("timeframe", options.timeframe)
      .eq("is_active", true)
      .maybeSingle();

    const configData = {
      drop_percentage: options.drop,
      rise_percentage: options.rise,
      max_purchases: options.purchases,
      min_buy_usdt: options.minBuy,
      initial_capital_usdt: options.capital,
      ath_window: options.athWindow,
      buy_mode: options.mode,
      capital_allocation_pct: options.capitalPct,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    if (existingConfig) {
      const { error: configError } = await supabase
        .from("strategy_config")
        .update(configData)
        .eq("id", existingConfig.id);

      if (configError) {
        console.error("❌ Error updating strategy config:", configError);
        process.exit(1);
      }
      console.log(`   ✓ Strategy config updated for ${options.timeframe}\n`);
    } else {
      const { error: configError } = await supabase
        .from("strategy_config")
        .insert({
          ...configData,
          timeframe: options.timeframe,
          slippage_buy_pct: 0.003,
          slippage_sell_pct: 0.003,
        });

      if (configError) {
        console.error("❌ Error creating strategy config:", configError);
        process.exit(1);
      }
      console.log(`   ✓ Strategy config created for ${options.timeframe}\n`);
    }
  }

  // Step 4: Get strategy config ID
  const { data: strategyConfig } = await supabase
    .from("strategy_config")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  // Step 5: Create new fresh cycle
  console.log("🆕 Creating new cycle...");
  const { data: newCycle, error: insertError } = await supabase
    .from("cycle_state")
    .insert({
      status: "READY",
      capital_available: options.capital,
      btc_accumulated: 0,
      btc_dust: 0,
      btc_accum_net: 0,
      cost_accum_usdt: 0,
      purchases_remaining: options.purchases,
      buy_amount: buyAmount,
      sell_reference_price: null,
      ath_reference_price: null,
      ath_price: null,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      p_last_buy: null,
      state_version: 2,
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

  console.log("   ✓ New cycle created\n");

  // Summary
  console.log(
    "╔══════════════════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║                               Summary                                        ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════════════════════╝",
  );
  console.log("");
  if (currentCycle) {
    console.log(
      `   Old Cycle:  ${currentCycle.id.substring(0, 8)}... → COMPLETED`,
    );
  }
  console.log(`   New Cycle:  ${newCycle.id.substring(0, 8)}... → READY`);
  console.log("");
  console.log("   New Cycle Details:");
  console.log(`   ├─ Buy Mode:           ${options.mode}`);
  console.log(`   ├─ Capital:            $${newCycle.capital_available}`);
  console.log(`   ├─ Purchases:          0 / ${newCycle.purchases_remaining}`);
  console.log(`   ├─ Buy Amount:         $${newCycle.buy_amount}`);
  console.log(
    `   ├─ p_last_buy:         ${newCycle.p_last_buy ?? "null (will be set on first fill)"}`,
  );
  console.log(`   └─ State Version:      ${newCycle.state_version}`);
  console.log("");

  if (options.mode === "geom_modified") {
    console.log("💡 Geometric Modified Mode:");
    console.log("   - First buy triggers at: ATH × (1 - drop%)");
    console.log("   - Subsequent buys trigger at: p_last_buy × (1 - drop%)");
    console.log("   - Max 1 buy per candle");
    console.log("");
  } else {
    console.log("💡 Arithmetic Mode:");
    console.log("   - Grid levels calculated from anchor price");
    console.log("   - Multiple levels can trigger in one candle");
    console.log("");
  }

  console.log("✅ Reset complete! Bot is ready to run.\n");
}

// ============================================================================
// Entry Point
// ============================================================================

const args = process.argv.slice(2);
const options = parseArgs(args);

if (options.help) {
  printHelp();
  process.exit(0);
}

resetCycle(options)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
