import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import type { BinanceClient } from "../exchange/binance-client";
import type { BalanceManager } from "../exchange/balance-manager";
import type { DiscordNotifier } from "../notifications/discord-notifier";
import type { CycleStateManager } from "../cycle/cycle-state-manager";
import type { StrategyConfigLoader } from "../config/strategy-config-loader";
import type {
  ValidationReport,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "../types/validation";

export interface StartupValidatorConfig {
  binanceClient: BinanceClient;
  supabaseClient: SupabaseClient<Database>;
  discordNotifier?: DiscordNotifier;
  balanceManager: BalanceManager;
  cycleStateManager: CycleStateManager;
  strategyConfigLoader: StrategyConfigLoader;
}

export class StartupValidator {
  private config: StartupValidatorConfig;

  constructor(config: StartupValidatorConfig) {
    this.config = config;
  }

  /**
   * Run full startup validation
   */
  async validate(): Promise<ValidationReport> {
    const timestamp = new Date();
    const results: {
      configuration: ValidationResult;
      balance: ValidationResult;
      connectivity: ValidationResult;
    } = {
      configuration: { success: true, errors: [], warnings: [] },
      balance: { success: true, errors: [], warnings: [] },
      connectivity: { success: true, errors: [], warnings: [] },
    };

    // Run validations sequentially with fail-fast on critical errors
    try {
      // 1. Configuration validation (critical - fail fast)
      results.configuration = await this.validateConfiguration();
      if (!results.configuration.success) {
        return this.createReport(timestamp, results);
      }

      // 2. Connectivity validation (critical - fail fast)
      results.connectivity = await this.validateConnectivity();
      if (!results.connectivity.success) {
        return this.createReport(timestamp, results);
      }

      // 3. Balance validation (may have warnings but not critical)
      results.balance = await this.validateBalances();
    } catch (error) {
      // Unexpected error - treat as critical configuration error
      results.configuration.success = false;
      results.configuration.errors.push({
        code: "UNEXPECTED_ERROR",
        message: `Unexpected error during validation: ${error instanceof Error ? error.message : String(error)}`,
        details: error,
      });
    }

    return this.createReport(timestamp, results);
  }

  /**
   * Validate configuration (env vars, API credentials, strategy config)
   */
  async validateConfiguration(): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required environment variables
    const requiredEnvVars = [
      "BINANCE_API_KEY",
      "BINANCE_API_SECRET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "INITIAL_CAPITAL_USDT",
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        errors.push({
          code: "MISSING_ENV_VAR",
          message: `Missing required environment variable: ${envVar}`,
        });
      }
    }

    // Check optional Discord webhook
    if (!process.env.DISCORD_WEBHOOK_URL) {
      warnings.push({
        code: "MISSING_DISCORD_WEBHOOK",
        message:
          "Discord webhook not configured - notifications will be disabled",
      });
    }

    // Validate initial capital is a valid number
    const initialCapital = process.env.INITIAL_CAPITAL_USDT;
    if (initialCapital) {
      const capitalValue = parseFloat(initialCapital);
      if (isNaN(capitalValue) || capitalValue <= 0) {
        errors.push({
          code: "INVALID_INITIAL_CAPITAL",
          message: `Invalid INITIAL_CAPITAL_USDT value: ${initialCapital}`,
        });
      }
    }

    // Load and validate strategy configuration
    try {
      const strategyConfig =
        await this.config.strategyConfigLoader.loadConfig();
      if (!strategyConfig) {
        errors.push({
          code: "NO_STRATEGY_CONFIG",
          message: "No active strategy configuration found",
        });
      } else {
        // Validate strategy config values

        if (
          !strategyConfig.dropPercentage ||
          strategyConfig.dropPercentage <= 0
        ) {
          errors.push({
            code: "INVALID_DROP_PERCENTAGE",
            message: `Invalid drop_percentage: ${strategyConfig.dropPercentage}`,
          });
        }

        if (
          !strategyConfig.risePercentage ||
          strategyConfig.risePercentage <= 0
        ) {
          errors.push({
            code: "INVALID_RISE_PERCENTAGE",
            message: `Invalid rise_percentage: ${strategyConfig.risePercentage}`,
          });
        }
      }
    } catch (error) {
      errors.push({
        code: "STRATEGY_CONFIG_ERROR",
        message: `Failed to load strategy configuration: ${error instanceof Error ? error.message : String(error)}`,
        details: error,
      });
    }

    // Test API credentials
    if (errors.length === 0) {
      // Only test if we have the required env vars
      try {
        // Test Binance API
        await this.config.binanceClient.ping();
      } catch (error) {
        errors.push({
          code: "INVALID_BINANCE_CREDENTIALS",
          message: `Invalid Binance API credentials: ${error instanceof Error ? error.message : String(error)}`,
          details: error,
        });
      }

      try {
        // Test Supabase connection
        const { error } = await this.config.supabaseClient
          .from("cycle_state")
          .select("id")
          .limit(1);
        if (error) {
          errors.push({
            code: "INVALID_SUPABASE_CREDENTIALS",
            message: `Invalid Supabase credentials: ${error.message}`,
            details: error,
          });
        }
      } catch (error) {
        errors.push({
          code: "INVALID_SUPABASE_CREDENTIALS",
          message: `Invalid Supabase credentials: ${error instanceof Error ? error.message : String(error)}`,
          details: error,
        });
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate balances (USDT amount, BTC warning, drift check)
   */
  async validateBalances(): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Get current balances
      const usdtBalance = await this.config.balanceManager.getBalance("USDT");
      const btcBalance = await this.config.balanceManager.getBalance("BTC");

      // Check USDT >= initial_capital_usdt
      const initialCapital = parseFloat(
        process.env.INITIAL_CAPITAL_USDT || "0",
      );
      if (usdtBalance.free.lt(initialCapital)) {
        errors.push({
          code: "INSUFFICIENT_USDT",
          message: `Insufficient USDT balance. Required: ${initialCapital}, Available: ${usdtBalance.free.toFixed(2)}`,
          details: {
            required: initialCapital,
            available: usdtBalance.free.toNumber(),
          },
        });
      }

      // Warn if BTC balance exists (excluding dust)
      const dustThreshold = 0.00001; // 1 satoshi
      if (btcBalance.free.gt(dustThreshold)) {
        warnings.push({
          code: "EXISTING_BTC_BALANCE",
          message: `Existing BTC balance detected: ${btcBalance.free.toFixed(8)} BTC. Consider selling before starting new cycle.`,
          details: {
            btcBalance: btcBalance.free.toNumber(),
          },
        });
      }

      // Check for drift from last state
      const lastState = await this.config.cycleStateManager.getCurrentState();
      if (lastState) {
        const driftThreshold = 0.01; // 1% drift

        // Check USDT drift
        const expectedUsdt = lastState.capital_available || 0;
        const actualUsdt = usdtBalance.free.toNumber();
        const usdtDrift =
          Math.abs(actualUsdt - expectedUsdt) / Math.max(expectedUsdt, 1);

        if (usdtDrift > driftThreshold && expectedUsdt > 0) {
          warnings.push({
            code: "USDT_DRIFT_DETECTED",
            message: `USDT balance drift detected. Expected: ${expectedUsdt.toFixed(2)}, Actual: ${actualUsdt.toFixed(2)}`,
            details: {
              expected: expectedUsdt,
              actual: actualUsdt,
              driftPercentage: (usdtDrift * 100).toFixed(2),
            },
          });
        }

        // Check BTC drift
        const expectedBtc = lastState.btc_accumulated || 0;
        const actualBtc = btcBalance.free.toNumber();
        const btcDrift = Math.abs(actualBtc - expectedBtc);

        if (btcDrift > dustThreshold && expectedBtc > 0) {
          warnings.push({
            code: "BTC_DRIFT_DETECTED",
            message: `BTC balance drift detected. Expected: ${expectedBtc.toFixed(8)}, Actual: ${actualBtc.toFixed(8)}`,
            details: {
              expected: expectedBtc,
              actual: actualBtc,
            },
          });
        }
      }
    } catch (error) {
      errors.push({
        code: "BALANCE_CHECK_ERROR",
        message: `Failed to check balances: ${error instanceof Error ? error.message : String(error)}`,
        details: error,
      });
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate connectivity to external services
   */
  async validateConnectivity(): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Test Binance API connectivity with retries
    let binanceConnected = false;
    let retries = 3;
    let lastError: Error | null = null;

    while (retries > 0 && !binanceConnected) {
      try {
        await this.config.binanceClient.ping();
        binanceConnected = true;
      } catch (error) {
        lastError = error as Error;
        retries--;
        if (retries > 0) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, 3 - retries) * 1000),
          );
        }
      }
    }

    if (!binanceConnected && lastError) {
      errors.push({
        code: "BINANCE_CONNECTION_FAILED",
        message: `Failed to connect to Binance API after 3 retries: ${lastError.message}`,
        details: lastError,
      });
    }

    // Test Supabase connectivity
    try {
      const { error } = await this.config.supabaseClient
        .from("cycle_state")
        .select("id")
        .limit(1);

      if (error) {
        errors.push({
          code: "SUPABASE_CONNECTION_FAILED",
          message: `Failed to connect to Supabase: ${error.message}`,
          details: error,
        });
      }
    } catch (error) {
      errors.push({
        code: "SUPABASE_CONNECTION_FAILED",
        message: `Failed to connect to Supabase: ${error instanceof Error ? error.message : String(error)}`,
        details: error,
      });
    }

    // Test Discord webhook if configured (warning only)
    if (process.env.DISCORD_WEBHOOK_URL && this.config.discordNotifier) {
      try {
        // Send a test message
        await this.config.discordNotifier.sendAlert(
          "Startup validation test",
          "info",
        );
      } catch (error) {
        warnings.push({
          code: "DISCORD_CONNECTION_FAILED",
          message: `Failed to connect to Discord webhook: ${error instanceof Error ? error.message : String(error)}`,
          details: error,
        });
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Create validation report
   */
  private createReport(
    timestamp: Date,
    results: {
      configuration: ValidationResult;
      balance: ValidationResult;
      connectivity: ValidationResult;
    },
  ): ValidationReport {
    const totalErrors =
      results.configuration.errors.length +
      results.balance.errors.length +
      results.connectivity.errors.length;

    const totalWarnings =
      results.configuration.warnings.length +
      results.balance.warnings.length +
      results.connectivity.warnings.length;

    const criticalErrors: string[] = [];

    // Configuration and connectivity errors are critical
    results.configuration.errors.forEach((e) => criticalErrors.push(e.message));
    results.connectivity.errors.forEach((e) => criticalErrors.push(e.message));

    const overallSuccess =
      results.configuration.success &&
      results.balance.success &&
      results.connectivity.success;

    return {
      timestamp,
      overallSuccess,
      configuration: results.configuration,
      balance: results.balance,
      connectivity: results.connectivity,
      summary: {
        totalErrors,
        totalWarnings,
        criticalErrors,
      },
    };
  }

  /**
   * Format validation report for display
   */
  formatReport(report: ValidationReport): string {
    const lines: string[] = [];

    lines.push("=".repeat(60));
    lines.push("STARTUP VALIDATION REPORT");
    lines.push(`Timestamp: ${report.timestamp.toISOString()}`);
    lines.push("=".repeat(60));
    lines.push("");

    // Overall status
    const statusEmoji = report.overallSuccess ? "✅" : "❌";
    const statusText = report.overallSuccess ? "PASSED" : "FAILED";
    lines.push(`Overall Status: ${statusEmoji} ${statusText}`);
    lines.push(`Total Errors: ${report.summary.totalErrors}`);
    lines.push(`Total Warnings: ${report.summary.totalWarnings}`);
    lines.push("");

    // Configuration section
    lines.push("-".repeat(60));
    lines.push("CONFIGURATION VALIDATION");
    lines.push("-".repeat(60));
    this.formatSection(report.configuration, lines);

    // Balance section
    lines.push("-".repeat(60));
    lines.push("BALANCE VALIDATION");
    lines.push("-".repeat(60));
    this.formatSection(report.balance, lines);

    // Connectivity section
    lines.push("-".repeat(60));
    lines.push("CONNECTIVITY VALIDATION");
    lines.push("-".repeat(60));
    this.formatSection(report.connectivity, lines);

    // Critical errors summary
    if (report.summary.criticalErrors.length > 0) {
      lines.push("-".repeat(60));
      lines.push("CRITICAL ERRORS (Must Fix)");
      lines.push("-".repeat(60));
      report.summary.criticalErrors.forEach((error) => {
        lines.push(`❌ ${error}`);
      });
      lines.push("");
    }

    lines.push("=".repeat(60));

    return lines.join("\n");
  }

  private formatSection(result: ValidationResult, lines: string[]): void {
    const statusEmoji = result.success ? "✅" : "❌";
    const statusText = result.success ? "PASSED" : "FAILED";
    lines.push(`Status: ${statusEmoji} ${statusText}`);

    if (result.errors.length > 0) {
      lines.push("\nErrors:");
      result.errors.forEach((error) => {
        lines.push(`  ❌ [${error.code}] ${error.message}`);
      });
    }

    if (result.warnings.length > 0) {
      lines.push("\nWarnings:");
      result.warnings.forEach((warning) => {
        lines.push(`  ⚠️  [${warning.code}] ${warning.message}`);
      });
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      lines.push("  ✅ All checks passed");
    }

    lines.push("");
  }
}
