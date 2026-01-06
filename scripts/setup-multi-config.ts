#!/usr/bin/env tsx
/**
 * Setup Multi-Config Script
 *
 * Reads a YAML configuration file and sets up multiple trading strategies
 * in the database. Each config gets its own timeframe, parameters, and capital.
 *
 * USAGE:
 *   pnpm tsx scripts/setup-multi-config.ts <config-file> [options]
 *
 * EXAMPLES:
 *   pnpm tsx scripts/setup-multi-config.ts configs/strategy.yaml
 *   pnpm tsx scripts/setup-multi-config.ts configs/strategy.yaml --dry-run
 *   pnpm tsx scripts/setup-multi-config.ts configs/strategy.yaml --reset
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ============================================================================
// Types
// ============================================================================

interface YamlConfig {
  timeframe: string;
  dropPct: number;
  risePct: number;
  maxPurchases: number;
  minBuyUsdt: number;
  athWindow: number;
  mode: "arithmetic" | "geom_modified";
  capitalPct?: number;
  capitalUsdt?: number;
}

interface YamlFile {
  configs: YamlConfig[];
}

interface CliOptions {
  configFile: string;
  dryRun: boolean;
  reset: boolean;
  force: boolean;
  help: boolean;
}

const VALID_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
];

// ============================================================================
// CLI Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    BTC Bot - Multi-Config Setup Script                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

USAGE:
  pnpm tsx scripts/setup-multi-config.ts <config-file> [OPTIONS]

ARGUMENTS:
  <config-file>       Path to YAML configuration file

OPTIONS:
  --help, -h          Show this help message
  --dry-run           Show what would happen without making changes
  --reset             Also reset cycle states (mark existing as COMPLETED,
                      create fresh READY cycles for each config)
  --force             Force reset even if cycles have open BTC positions
                      (USE WITH CAUTION - will lose position tracking!)

EXAMPLES:
  # Setup configs from YAML file
  pnpm tsx scripts/setup-multi-config.ts configs/strategy.yaml

  # Preview changes without applying
  pnpm tsx scripts/setup-multi-config.ts configs/strategy.yaml --dry-run

  # Setup configs and reset all cycles
  pnpm tsx scripts/setup-multi-config.ts configs/strategy.yaml --reset

CONFIG FILE FORMAT:
  See configs/strategy.example.yaml for a complete example.

  configs:
    - timeframe: "5m"
      dropPct: 1.0        # Percentage (1.0 = 1%)
      risePct: 1.0
      maxPurchases: 10
      minBuyUsdt: 10
      athWindow: 100
      mode: "geom_modified"
      capitalPct: 25      # OR capitalUsdt: 250

NOTES:
  - All configs must use either capitalPct OR capitalUsdt (not mixed)
  - Each timeframe can only appear once
  - Existing configs for the same timeframe will be updated
  - Configs NOT in the YAML file will be deactivated
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    configFile: "",
    dryRun: false,
    reset: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--reset":
        options.reset = true;
        break;
      case "--force":
        options.force = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
        if (!options.configFile) {
          options.configFile = arg;
        }
    }
  }

  return options;
}

// ============================================================================
// Validation
// ============================================================================

function validateConfig(config: YamlConfig, index: number): void {
  const prefix = `Config #${index + 1} (${config.timeframe || "unknown"})`;

  // Timeframe
  if (!config.timeframe) {
    throw new Error(`${prefix}: timeframe is required`);
  }
  if (!VALID_TIMEFRAMES.includes(config.timeframe)) {
    throw new Error(
      `${prefix}: invalid timeframe "${config.timeframe}". Valid: ${VALID_TIMEFRAMES.join(", ")}`,
    );
  }

  // Drop/Rise percentages
  // YAML values are ALWAYS percentages: 0.3 = 0.3%, 3 = 3%
  if (typeof config.dropPct !== "number" || config.dropPct <= 0) {
    throw new Error(`${prefix}: dropPct must be a positive number`);
  }
  if (typeof config.risePct !== "number" || config.risePct <= 0) {
    throw new Error(`${prefix}: risePct must be a positive number`);
  }

  // Validate percentage range (0.15% to 8%)
  if (config.dropPct < 0.15 || config.dropPct > 8) {
    throw new Error(
      `${prefix}: dropPct must be between 0.15 and 8 (meaning 0.15% to 8%). Got ${config.dropPct}`,
    );
  }
  if (config.risePct < 0.15 || config.risePct > 8) {
    throw new Error(
      `${prefix}: risePct must be between 0.15 and 8 (meaning 0.15% to 8%). Got ${config.risePct}`,
    );
  }

  // Max purchases
  if (typeof config.maxPurchases !== "number" || config.maxPurchases < 1) {
    throw new Error(`${prefix}: maxPurchases must be at least 1`);
  }

  // Min buy
  if (typeof config.minBuyUsdt !== "number" || config.minBuyUsdt < 10) {
    throw new Error(`${prefix}: minBuyUsdt must be at least 10`);
  }

  // ATH window
  if (
    typeof config.athWindow !== "number" ||
    config.athWindow < 10 ||
    config.athWindow > 500
  ) {
    throw new Error(`${prefix}: athWindow must be between 10 and 500`);
  }

  // Mode
  if (!["arithmetic", "geom_modified"].includes(config.mode)) {
    throw new Error(`${prefix}: mode must be "arithmetic" or "geom_modified"`);
  }

  // Capital allocation
  if (config.capitalPct === undefined && config.capitalUsdt === undefined) {
    throw new Error(`${prefix}: either capitalPct or capitalUsdt is required`);
  }
  if (config.capitalPct !== undefined && config.capitalUsdt !== undefined) {
    throw new Error(
      `${prefix}: use either capitalPct OR capitalUsdt, not both`,
    );
  }
}

function validateAllConfigs(configs: YamlConfig[]): void {
  if (!configs || configs.length === 0) {
    throw new Error("No configs found in YAML file");
  }

  if (configs.length > 10) {
    throw new Error(`Maximum 10 configs allowed. Found ${configs.length}`);
  }

  // Validate each config
  configs.forEach((config, index) => validateConfig(config, index));

  // Check for duplicate timeframes
  const timeframes = configs.map((c) => c.timeframe);
  const duplicates = timeframes.filter((tf, i) => timeframes.indexOf(tf) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate timeframes found: ${duplicates.join(", ")}`);
  }

  // Check allocation method consistency
  const hasPct = configs.some((c) => c.capitalPct !== undefined);
  const hasUsdt = configs.some((c) => c.capitalUsdt !== undefined);
  if (hasPct && hasUsdt) {
    throw new Error(
      "All configs must use the same allocation method (capitalPct OR capitalUsdt)",
    );
  }

  // Validate total percentage
  if (hasPct) {
    const totalPct = configs.reduce((sum, c) => sum + (c.capitalPct || 0), 0);
    if (totalPct > 100) {
      throw new Error(`Total capitalPct exceeds 100% (got ${totalPct}%)`);
    }
  }
}

// ============================================================================
// Database Operations
// ============================================================================

interface ExistingConfig {
  id: string;
  timeframe: string;
}

async function getExistingConfigs(
  supabase: SupabaseClient<Database>,
): Promise<{ active: ExistingConfig[]; all: ExistingConfig[] }> {
  const { data: activeConfigs, error: activeError } = await supabase
    .from("strategy_config")
    .select("id, timeframe")
    .eq("is_active", true);

  if (activeError) {
    throw new Error(`Failed to fetch active configs: ${activeError.message}`);
  }

  const { data: allConfigs, error: allError } = await supabase
    .from("strategy_config")
    .select("id, timeframe");

  if (allError) {
    throw new Error(`Failed to fetch all configs: ${allError.message}`);
  }

  return {
    active: activeConfigs || [],
    all: allConfigs || [],
  };
}

async function batchUpsertConfigs(
  supabase: SupabaseClient<Database>,
  configs: YamlConfig[],
  existingConfigs: ExistingConfig[],
  dryRun: boolean,
): Promise<
  Array<{ timeframe: string; action: "created" | "updated"; id: string }>
> {
  const results: Array<{
    timeframe: string;
    action: "created" | "updated";
    id: string;
  }> = [];
  const existingByTimeframe = new Map(
    existingConfigs.map((c) => [c.timeframe, c]),
  );

  // Define the config shape for inserts
  interface DbConfigInsert {
    timeframe: string;
    drop_percentage: number;
    rise_percentage: number;
    max_purchases: number;
    min_buy_usdt: number;
    initial_capital_usdt: number;
    slippage_buy_pct: number;
    slippage_sell_pct: number;
    ath_window: number;
    buy_mode: string;
    capital_allocation_pct: number | null;
    is_active: boolean;
    updated_at: string;
  }

  // Prepare all db configs
  const toUpdate: Array<{ id: string; data: DbConfigInsert }> = [];
  const toInsert: DbConfigInsert[] = [];

  for (const config of configs) {
    const dropDecimal = config.dropPct / 100;
    const riseDecimal = config.risePct / 100;

    const dbConfig = {
      timeframe: config.timeframe,
      drop_percentage: dropDecimal,
      rise_percentage: riseDecimal,
      max_purchases: config.maxPurchases,
      min_buy_usdt: config.minBuyUsdt,
      initial_capital_usdt: config.capitalUsdt || 0,
      slippage_buy_pct: 0.003,
      slippage_sell_pct: 0.003,
      ath_window: config.athWindow,
      buy_mode: config.mode,
      capital_allocation_pct: config.capitalPct || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const existing = existingByTimeframe.get(config.timeframe);
    if (existing) {
      toUpdate.push({ id: existing.id, data: dbConfig });
      results.push({
        timeframe: config.timeframe,
        action: "updated",
        id: existing.id,
      });
    } else {
      toInsert.push(dbConfig);
      results.push({
        timeframe: config.timeframe,
        action: "created",
        id: "pending",
      });
    }
  }

  if (dryRun) {
    return results;
  }

  // Step 1: Deactivate ALL configs using RPC to bypass trigger
  // The trigger validates sum=100% which fails during deactivation
  const { error: deactivateError } = await supabase.rpc(
    "batch_deactivate_strategy_configs",
  );

  if (deactivateError) {
    throw new Error(`Failed to deactivate configs: ${deactivateError.message}`);
  }

  // Step 2: Update existing configs (still inactive, will activate in step 4)
  for (const { id, data } of toUpdate) {
    const { error } = await supabase
      .from("strategy_config")
      .update({ ...data, is_active: false }) // Keep inactive for now
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update config: ${error.message}`);
    }
  }

  // Step 3: Insert new configs (inactive initially)
  if (toInsert.length > 0) {
    const { data: insertedData, error: insertError } = await supabase
      .from("strategy_config")
      .insert(toInsert.map((c) => ({ ...c, is_active: false })))
      .select("id, timeframe");

    if (insertError) {
      throw new Error(`Failed to insert configs: ${insertError.message}`);
    }

    // Update results with actual IDs
    if (insertedData) {
      for (const inserted of insertedData) {
        const result = results.find(
          (r) => r.timeframe === inserted.timeframe && r.id === "pending",
        );
        if (result) {
          result.id = inserted.id;
        }
      }
    }
  }

  // Step 4: Activate ALL new configs using RPC to bypass row-level trigger
  // The trigger fires per-row with .update().in(), so we use a custom function
  const allIds = results.map((r) => r.id);

  // Call RPC - function exists after migration is applied
  // Cast supabase to bypass strict RPC type checking for custom function
  interface CustomRpcClient {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => {
      then: (
        cb: (r: {
          error: { message: string; code?: string } | null;
        }) => unknown,
      ) => Promise<unknown>;
    };
  }
  const client = supabase as unknown as CustomRpcClient;
  const { error: activateError } = (await client
    .rpc("batch_activate_strategy_configs", {
      config_ids: allIds,
    })
    .then((res) => res)) as {
    error: { message: string; code?: string } | null;
  };

  if (activateError) {
    // Check if RPC function doesn't exist
    if (
      activateError.message.includes("does not exist") ||
      activateError.code === "42883"
    ) {
      throw new Error(
        `Failed to activate configs: ${activateError.message}\n\n` +
          `The batch_activate_strategy_configs function is missing.\n` +
          `Run the migration: pnpm supabase db push\n` +
          `Or apply: supabase/migrations/20260102_batch_activate_configs.sql`,
      );
    }
    throw new Error(`Failed to activate configs: ${activateError.message}`);
  }

  return results;
}

async function resetCycleForConfig(
  supabase: SupabaseClient<Database>,
  configId: string,
  config: YamlConfig,
  capitalPool: number,
  dryRun: boolean,
  force: boolean,
): Promise<void> {
  // Check for cycles with open positions (BTC holdings)
  const { data: holdingCycles } = await supabase
    .from("cycle_state")
    .select("id, btc_accumulated, status")
    .eq("strategy_config_id", configId)
    .gt("btc_accumulated", 0)
    .in("status", ["READY", "HOLDING", "PAUSED"]);

  if (holdingCycles && holdingCycles.length > 0) {
    const btcHeld = holdingCycles.reduce(
      (sum, c) => sum + (c.btc_accumulated || 0),
      0,
    );
    if (!force) {
      throw new Error(
        `Cannot reset ${config.timeframe}: cycle has open position with ${btcHeld} BTC. ` +
          `Sell the position first, manually close the cycle, or use --force to override.`,
      );
    }
    console.log(
      `   ⚠️  WARNING: Force resetting ${config.timeframe} with ${btcHeld} BTC open position!`,
    );
  }

  // Mark existing cycles as COMPLETED (only if no BTC held)
  if (!dryRun) {
    await supabase
      .from("cycle_state")
      .update({
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("strategy_config_id", configId)
      .in("status", ["READY", "HOLDING", "PAUSED"]);
  }

  // Calculate capital from percentage or use fixed amount
  const capital = config.capitalPct
    ? Math.floor(((capitalPool * config.capitalPct) / 100) * 100) / 100
    : config.capitalUsdt || 0;
  const buyAmount =
    Math.floor((capital / config.maxPurchases) * 100) / 100 || 0;

  // Create new cycle
  if (!dryRun) {
    const { error } = await supabase.from("cycle_state").insert({
      status: "READY",
      capital_available: capital,
      btc_accumulated: 0,
      btc_dust: 0,
      btc_accum_net: 0,
      cost_accum_usdt: 0,
      purchases_remaining: config.maxPurchases,
      buy_amount: buyAmount,
      sell_reference_price: null,
      ath_reference_price: null,
      ath_price: null,
      buy_anchor_price: null,
      buy_grid: null,
      buy_index: 0,
      p_last_buy: null,
      state_version: 2,
      strategy_config_id: configId,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(
        `Failed to create cycle for ${config.timeframe}: ${error.message}`,
      );
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.configFile) {
    console.error("❌ Config file path is required");
    console.error(
      "   Usage: pnpm tsx scripts/setup-multi-config.ts <config-file>",
    );
    console.error("   Run with --help for more information");
    process.exit(1);
  }

  // Resolve config file path
  const configPath = path.isAbsolute(options.configFile)
    ? options.configFile
    : path.join(process.cwd(), options.configFile);

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Load and parse YAML
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    BTC Bot - Multi-Config Setup${options.dryRun ? " (DRY RUN)" : ""}                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`📄 Loading config from: ${configPath}\n`);

  let yamlContent: YamlFile;
  try {
    const fileContent = fs.readFileSync(configPath, "utf8");
    yamlContent = yaml.load(fileContent) as YamlFile;
  } catch (error) {
    console.error(
      `❌ Failed to parse YAML: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  // Validate configs
  try {
    validateAllConfigs(yamlContent.configs);
  } catch (error) {
    console.error(
      `❌ Validation failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  console.log(`✓ Validated ${yamlContent.configs.length} configurations\n`);

  // Connect to Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase configuration");
    console.error(
      "   Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);

  // Get capital pool from environment for percentage-based allocations
  const capitalPool = parseFloat(process.env.INITIAL_CAPITAL_USDT || "3000");

  // Display config summary
  console.log("📋 Configurations to apply:\n");
  console.log(
    "┌────────────┬────────┬────────┬──────────┬────────────────┬────────────┐",
  );
  console.log(
    "│ Timeframe  │ Drop % │ Rise % │ Purchases│ Mode           │ Capital    │",
  );
  console.log(
    "├────────────┼────────┼────────┼──────────┼────────────────┼────────────┤",
  );

  for (const config of yamlContent.configs) {
    const capital = config.capitalPct
      ? `${config.capitalPct}%`
      : `$${config.capitalUsdt}`;
    console.log(
      `│ ${config.timeframe.padEnd(10)} │ ${String(config.dropPct).padEnd(6)} │ ${String(config.risePct).padEnd(6)} │ ${String(config.maxPurchases).padEnd(8)} │ ${config.mode.padEnd(14)} │ ${capital.padEnd(10)} │`,
    );
  }
  console.log(
    "└────────────┴────────┴────────┴──────────┴────────────────┴────────────┘\n",
  );

  if (options.dryRun) {
    console.log("🔍 DRY RUN - No changes will be made\n");
  }

  // Get existing configs to determine create vs update
  const { active: previouslyActive, all: allExisting } =
    await getExistingConfigs(supabase);
  const activeTimeframes = yamlContent.configs.map((c) => c.timeframe);

  // Calculate which configs are being removed (not in new YAML)
  const deactivatedForever = previouslyActive
    .map((c) => c.timeframe)
    .filter((tf: string) => !activeTimeframes.includes(tf));

  if (deactivatedForever.length > 0) {
    console.log(`🔴 Removing configs: ${deactivatedForever.join(", ")}`);
  }

  // Batch upsert all configs at once (avoids sum=100% constraint issues)
  console.log("\n📝 Applying configurations...\n");

  const upsertResults = await batchUpsertConfigs(
    supabase,
    yamlContent.configs,
    allExisting,
    options.dryRun,
  );

  // Handle cycle resets
  const results: Array<{
    timeframe: string;
    action: string;
    cycleReset: boolean;
  }> = [];

  for (const result of upsertResults) {
    const config = yamlContent.configs.find(
      (c) => c.timeframe === result.timeframe,
    )!;
    let cycleReset = false;

    if (options.reset && result.id !== "pending") {
      await resetCycleForConfig(
        supabase,
        result.id,
        config,
        capitalPool,
        options.dryRun,
        options.force,
      );
      cycleReset = true;
    }

    results.push({
      timeframe: result.timeframe,
      action: result.action,
      cycleReset,
    });

    const actionIcon = result.action === "created" ? "🆕" : "✏️ ";
    const resetIcon = cycleReset ? " + 🔄 cycle reset" : "";
    console.log(
      `   ${actionIcon} ${result.timeframe}: ${result.action}${resetIcon}`,
    );
  }

  // Summary
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                 Summary                                      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  const created = results.filter((r) => r.action === "created").length;
  const updated = results.filter((r) => r.action === "updated").length;
  const cyclesReset = results.filter((r) => r.cycleReset).length;

  console.log(`   Configs created:    ${created}`);
  console.log(`   Configs updated:    ${updated}`);
  console.log(`   Configs removed:    ${deactivatedForever.length}`);
  if (options.reset) {
    console.log(`   Cycles reset:       ${cyclesReset}`);
  }

  if (options.dryRun) {
    console.log(
      "\n✅ Dry run complete. Run without --dry-run to apply changes.\n",
    );
  } else {
    console.log("\n✅ Setup complete! Start the bot with: pnpm start\n");

    if (!options.reset) {
      console.log(
        "💡 Tip: Use --reset flag to also create fresh cycle states for each config.\n",
      );
    }
  }
}

main().catch((error) => {
  console.error("❌ Script failed:", error);
  process.exit(1);
});
