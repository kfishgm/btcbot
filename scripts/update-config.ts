#!/usr/bin/env tsx
/**
 * Update Config Script
 *
 * This script updates strategy configuration without resetting the cycle.
 * Useful for adjusting parameters while the bot is running.
 *
 * Usage:
 *   pnpm tsx scripts/update-config.ts [options]
 *
 * Examples:
 *   pnpm tsx scripts/update-config.ts --help
 *   pnpm tsx scripts/update-config.ts --drop 0.05 --rise 0.05
 *   pnpm tsx scripts/update-config.ts --timeframe 5m --ath-window 30
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
  timeframe: string | null;
  drop: number | null;
  rise: number | null;
  athWindow: number | null;
  mode: "arithmetic" | "geom_modified" | null;
  purchases: number | null;
  minBuy: number | null;
  capital: number | null;
  capitalPct: number | null;
  slippageBuy: number | null;
  slippageSell: number | null;
  active: boolean | null;
  dryRun: boolean;
  list: boolean;
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                       BTC Bot - Update Config Script                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  pnpm tsx scripts/update-config.ts [OPTIONS]

OPTIONS:
  --help, -h              Show this help message
  --list, -l              List all strategy configs

  TARGET:
  --timeframe, -t <tf>    Timeframe to update (default: first active config)
                          Examples: 1m, 5m, 15m, 1h, 4h, 1d

  STRATEGY PARAMETERS:
  --drop, -d <pct>        Drop percentage (e.g., 0.03 for 0.03%, 3 for 3%)
  --rise, -r <pct>        Rise percentage (e.g., 0.05 for 0.05%, 5 for 5%)
  --ath-window <num>      ATH lookback window in candles
  --mode, -m <mode>       Buy mode: "arithmetic" or "geom_modified"
  --purchases, -p <num>   Max purchases per cycle
  --min-buy <num>         Minimum buy amount in USDT
  --capital <num>         Initial capital in USDT
  --capital-pct <pct>     Capital allocation percentage (for multi-config)
  --slippage-buy <pct>    Buy slippage tolerance (e.g., 0.003 for 0.3%)
  --slippage-sell <pct>   Sell slippage tolerance (e.g., 0.003 for 0.3%)

  STATUS:
  --active <bool>         Set config active status (true/false)

  BEHAVIOR:
  --dry-run               Show what would change without applying

EXAMPLES:
  # List all configs
  pnpm tsx scripts/update-config.ts --list

  # Update drop and rise for the active config
  pnpm tsx scripts/update-config.ts --drop 0.05 --rise 0.05

  # Update 5m timeframe config specifically
  pnpm tsx scripts/update-config.ts --timeframe 5m --ath-window 30

  # Change buy mode on 1h config
  pnpm tsx scripts/update-config.ts -t 1h --mode geom_modified

  # Dry run to see what would change
  pnpm tsx scripts/update-config.ts --drop 0.04 --dry-run

NOTES:
  - Only specified parameters will be updated
  - Changes take effect on the next candle (no restart needed)
  - Use --dry-run to preview changes before applying
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    timeframe: null,
    drop: null,
    rise: null,
    athWindow: null,
    mode: null,
    purchases: null,
    minBuy: null,
    capital: null,
    capitalPct: null,
    slippageBuy: null,
    slippageSell: null,
    active: null,
    dryRun: false,
    list: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;

      case "--list":
      case "-l":
        options.list = true;
        break;

      case "--timeframe":
      case "-t":
        options.timeframe = nextArg;
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

      case "--ath-window":
        options.athWindow = parseInt(nextArg, 10);
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

      case "--purchases":
      case "-p":
        options.purchases = parseInt(nextArg, 10);
        i++;
        break;

      case "--min-buy":
        options.minBuy = parseFloat(nextArg);
        i++;
        break;

      case "--capital":
        options.capital = parseFloat(nextArg);
        i++;
        break;

      case "--capital-pct":
        options.capitalPct = parseFloat(nextArg);
        i++;
        break;

      case "--slippage-buy":
        options.slippageBuy = parseFloat(nextArg);
        i++;
        break;

      case "--slippage-sell":
        options.slippageSell = parseFloat(nextArg);
        i++;
        break;

      case "--active":
        options.active = nextArg === "true";
        i++;
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

async function listConfigs() {
  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase configuration");
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  const { data: configs, error } = await supabase
    .from("strategy_config")
    .select("*")
    .order("is_active", { ascending: false })
    .order("timeframe", { ascending: true });

  if (error) {
    console.error("❌ Error fetching configs:", error);
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                          Strategy Configurations                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  if (!configs || configs.length === 0) {
    console.log("   No strategy configurations found.\n");
    return;
  }

  for (const config of configs) {
    const status = config.is_active ? "🟢 ACTIVE" : "⚪ INACTIVE";
    console.log(`${status} | Timeframe: ${config.timeframe}`);
    console.log(`   ├─ ID:              ${config.id.substring(0, 8)}...`);
    console.log(
      `   ├─ Buy Mode:        ${config.buy_mode || "arithmetic (default)"}`,
    );
    console.log(
      `   ├─ Drop %:          ${((config.drop_percentage || 0) * 100).toFixed(2)}%`,
    );
    console.log(
      `   ├─ Rise %:          ${((config.rise_percentage || 0) * 100).toFixed(2)}%`,
    );
    console.log(`   ├─ ATH Window:      ${config.ath_window} candles`);
    console.log(`   ├─ Max Purchases:   ${config.max_purchases}`);
    console.log(`   ├─ Min Buy:         $${config.min_buy_usdt}`);
    console.log(`   ├─ Initial Capital: $${config.initial_capital_usdt}`);
    // capital_allocation_pct may not be in generated types yet
    const capitalPct = (
      config as unknown as { capital_allocation_pct?: number }
    ).capital_allocation_pct;
    console.log(`   ├─ Capital Alloc:   ${capitalPct || 100}%`);
    console.log(
      `   ├─ Slippage (Buy):  ${((config.slippage_buy_pct || 0) * 100).toFixed(2)}%`,
    );
    console.log(
      `   ├─ Slippage (Sell): ${((config.slippage_sell_pct || 0) * 100).toFixed(2)}%`,
    );
    console.log(`   └─ Updated:         ${config.updated_at}`);
    console.log("");
  }
}

async function updateConfig(options: CliOptions) {
  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase configuration");
    console.error(
      "   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  // Find the config to update
  let query = supabase.from("strategy_config").select("*");

  if (options.timeframe) {
    query = query.eq("timeframe", options.timeframe);
  } else {
    query = query.eq("is_active", true);
  }

  const { data: configs, error: fetchError } = await query;

  if (fetchError) {
    console.error("❌ Error fetching config:", fetchError);
    process.exit(1);
  }

  if (!configs || configs.length === 0) {
    if (options.timeframe) {
      console.error(`❌ No config found for timeframe: ${options.timeframe}`);
    } else {
      console.error("❌ No active config found");
    }
    console.error("   Run with --list to see all configs");
    process.exit(1);
  }

  const config = configs[0];

  // Build update object with only specified fields
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (options.drop !== null) updates.drop_percentage = options.drop;
  if (options.rise !== null) updates.rise_percentage = options.rise;
  if (options.athWindow !== null) updates.ath_window = options.athWindow;
  if (options.mode !== null) updates.buy_mode = options.mode;
  if (options.purchases !== null) updates.max_purchases = options.purchases;
  if (options.minBuy !== null) updates.min_buy_usdt = options.minBuy;
  if (options.capital !== null) updates.initial_capital_usdt = options.capital;
  if (options.capitalPct !== null)
    updates.capital_allocation_pct = options.capitalPct;
  if (options.slippageBuy !== null)
    updates.slippage_buy_pct = options.slippageBuy;
  if (options.slippageSell !== null)
    updates.slippage_sell_pct = options.slippageSell;
  if (options.active !== null) updates.is_active = options.active;

  // Check if there are any actual updates
  const updateKeys = Object.keys(updates).filter((k) => k !== "updated_at");
  if (updateKeys.length === 0) {
    console.error("❌ No parameters specified to update");
    console.error("   Run with --help for usage information");
    process.exit(1);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         Update Config${options.dryRun ? " (DRY RUN)" : ""}                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`📋 Target Config: ${config.timeframe}`);
  console.log(`   ID: ${config.id.substring(0, 8)}...`);
  console.log(`   Status: ${config.is_active ? "Active" : "Inactive"}`);
  console.log("");

  console.log("📝 Changes:");
  for (const key of updateKeys) {
    const oldValue = config[key as keyof typeof config];
    const newValue = updates[key];

    // Format percentages nicely
    let oldDisplay = String(oldValue);
    let newDisplay = String(newValue);

    if (
      key.includes("percentage") ||
      key.includes("pct") ||
      key.includes("slippage")
    ) {
      oldDisplay = `${((oldValue as number) * 100).toFixed(2)}%`;
      newDisplay = `${((newValue as number) * 100).toFixed(2)}%`;
    }

    console.log(`   ${key}:`);
    console.log(`      Before: ${oldDisplay}`);
    console.log(`      After:  ${newDisplay}`);
  }
  console.log("");

  if (options.dryRun) {
    console.log("🔍 DRY RUN - No changes applied");
    console.log("   Run without --dry-run to apply changes.\n");
    return;
  }

  // Apply the update
  const { error: updateError } = await supabase
    .from("strategy_config")
    .update(updates)
    .eq("id", config.id);

  if (updateError) {
    console.error("❌ Error updating config:", updateError);
    process.exit(1);
  }

  console.log("✅ Config updated successfully!");
  console.log("");
  console.log("💡 Note: Changes take effect on the next candle.");
  console.log("   No bot restart required.\n");
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

if (options.list) {
  listConfigs()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
} else {
  updateConfig(options)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}
