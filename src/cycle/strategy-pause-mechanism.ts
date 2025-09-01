import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";
import type { CycleStateManager } from "./cycle-state-manager.js";
import type { DriftDetector, CombinedDriftResult } from "./drift-detector.js";
import type { DiscordNotifier } from "../notifications/discord-notifier.js";
import { logger } from "../utils/logger.js";

export interface PauseReason {
  type: "drift_detected" | "critical_error" | "manual" | "state_corruption";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ResumeValidationResult {
  canResume: boolean;
  validationErrors: string[];
  driftCheck?: CombinedDriftResult;
}

export interface StrategyPauseMechanismConfig {
  driftThreshold?: number;
  enableNotifications?: boolean;
  requireManualResume?: boolean;
}

export interface PauseState {
  id: number;
  status: "paused" | "active";
  pause_reason: string;
  paused_at: string;
  pause_metadata: Record<string, unknown>;
  resumed_at?: string;
  resume_metadata?: Record<string, unknown>;
}

export class StrategyPauseMechanism {
  private supabase: SupabaseClient<Database>;
  private cycleStateManager: CycleStateManager;
  private driftDetector: DriftDetector;
  private discordNotifier?: DiscordNotifier;
  private config: Required<StrategyPauseMechanismConfig>;
  private isPaused: boolean = false;
  private pauseState: PauseState | null = null;

  constructor(
    supabase: SupabaseClient<Database>,
    cycleStateManager: CycleStateManager,
    driftDetector: DriftDetector,
    discordNotifier?: DiscordNotifier,
    config?: StrategyPauseMechanismConfig,
  ) {
    this.supabase = supabase;
    this.cycleStateManager = cycleStateManager;
    this.driftDetector = driftDetector;
    this.discordNotifier = discordNotifier;
    this.config = {
      driftThreshold: config?.driftThreshold ?? 0.005,
      enableNotifications: config?.enableNotifications ?? true,
      requireManualResume: config?.requireManualResume ?? true,
    };
  }

  async initialize(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from("pause_states")
        .select("*")
        .eq("status", "paused")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        this.pauseState = data as PauseState;
        this.isPaused = true;
        logger.warn("Strategy is currently paused", {
          reason: this.pauseState.pause_reason,
          pausedAt: this.pauseState.paused_at,
        });
      }
    } catch (error) {
      logger.error("Failed to check pause state", { error });
    }
  }

  async checkDriftAndPause(
    usdtSpotBalance: number,
    capitalAvailable: number,
    btcSpotBalance: number,
    btcAccumulated: number,
  ): Promise<boolean> {
    if (this.isPaused) {
      return true;
    }

    const driftResult = this.driftDetector.checkDrift({
      usdtSpotBalance,
      capitalAvailable,
      btcSpotBalance,
      btcAccumulated,
    });

    if (driftResult.overallStatus === "exceeded") {
      const pauseReason: PauseReason = {
        type: "drift_detected",
        message: `Balance drift exceeded threshold: USDT ${(
          driftResult.usdt.driftPercentage * 100
        ).toFixed(2)}%, BTC ${(driftResult.btc.driftPercentage * 100).toFixed(
          2,
        )}%`,
        metadata: {
          usdtDrift: driftResult.usdt.driftPercentage,
          btcDrift: driftResult.btc.driftPercentage,
          threshold: this.config.driftThreshold,
          balances: {
            usdtSpot: usdtSpotBalance,
            capitalAvailable,
            btcSpot: btcSpotBalance,
            btcAccumulated,
          },
        },
      };

      await this.pauseStrategy(pauseReason);
      return true;
    }

    return false;
  }

  async pauseOnError(
    error: Error,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (this.isPaused) {
      logger.warn("Strategy already paused, skipping duplicate pause", {
        existingReason: this.pauseState?.pause_reason,
        newError: error.message,
      });
      return;
    }

    const pauseReason: PauseReason = {
      type: "critical_error",
      message: error.message,
      metadata: {
        errorName: error.name,
        errorStack: error.stack,
        context,
        timestamp: new Date().toISOString(),
      },
    };

    await this.pauseStrategy(pauseReason);
  }

  async pauseStrategy(reason: PauseReason): Promise<void> {
    try {
      const cycleState = this.cycleStateManager.getCurrentState();
      if (!cycleState) {
        throw new Error("No cycle state available");
      }

      await this.supabase
        .from("cycle_state")
        .update({ status: "PAUSED" })
        .eq("id", cycleState.id);

      const { data: pauseStateData, error: pauseError } = await this.supabase
        .from("pause_states")
        .insert({
          status: "paused",
          pause_reason: reason.message,
          pause_metadata: reason.metadata || {},
        })
        .select()
        .single();

      if (pauseError) {
        throw pauseError;
      }

      this.pauseState = pauseStateData as PauseState;
      this.isPaused = true;

      await this.logBotEvent(
        "STRATEGY_PAUSED",
        "error",
        `Strategy paused: ${reason.message}`,
        {
          pauseType: reason.type,
          metadata: reason.metadata,
        },
      );

      if (this.config.enableNotifications && this.discordNotifier) {
        await this.discordNotifier.sendPauseAlert(reason);
      }

      logger.error("Strategy paused", { reason });
    } catch (error) {
      logger.error("Failed to pause strategy", { error, reason });
      throw error;
    }
  }

  async validateResume(): Promise<ResumeValidationResult> {
    const result: ResumeValidationResult = {
      canResume: true,
      validationErrors: [],
    };

    try {
      const cycleState = this.cycleStateManager.getCurrentState();
      if (!cycleState) {
        result.canResume = false;
        result.validationErrors.push("No cycle state available");
        return result;
      }

      if (!this.cycleStateManager.validateState(cycleState)) {
        result.canResume = false;
        result.validationErrors.push("Cycle state validation failed");
      }

      const { data: balances } = await this.supabase.rpc(
        "get_account_balances",
      );
      if (balances) {
        const driftCheck = this.driftDetector.checkDrift({
          usdtSpotBalance: balances.usdt_balance,
          capitalAvailable: cycleState.capital_available,
          btcSpotBalance: balances.btc_balance,
          btcAccumulated: cycleState.btc_accumulated || 0,
        });

        result.driftCheck = driftCheck;

        if (driftCheck.overallStatus === "exceeded") {
          result.canResume = false;
          result.validationErrors.push(
            `Drift still exceeds threshold: USDT ${(
              driftCheck.usdt.driftPercentage * 100
            ).toFixed(
              2,
            )}%, BTC ${(driftCheck.btc.driftPercentage * 100).toFixed(2)}%`,
          );
        }
      }

      try {
        const { data: exchangeStatus } = await this.supabase.rpc(
          "check_exchange_connectivity",
        );
        if (!exchangeStatus?.connected) {
          result.canResume = false;
          result.validationErrors.push("Exchange connectivity check failed");
        }
      } catch {
        result.validationErrors.push("Could not verify exchange connectivity");
      }
    } catch (error) {
      result.canResume = false;
      result.validationErrors.push(
        `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return result;
  }

  async resumeStrategy(force: boolean = false): Promise<boolean> {
    if (!this.isPaused) {
      logger.warn("Strategy is not paused, cannot resume");
      return false;
    }

    if (!force) {
      const validation = await this.validateResume();
      if (!validation.canResume) {
        logger.error("Resume validation failed", {
          errors: validation.validationErrors,
        });

        if (this.config.enableNotifications && this.discordNotifier) {
          await this.discordNotifier.sendResumeFailedAlert(
            validation.validationErrors,
          );
        }

        return false;
      }
    }

    try {
      const cycleState = this.cycleStateManager.getCurrentState();
      if (!cycleState) {
        throw new Error("No cycle state available");
      }

      await this.supabase
        .from("cycle_state")
        .update({ status: "READY" })
        .eq("id", cycleState.id);

      if (this.pauseState) {
        await this.supabase
          .from("pause_states")
          .update({
            status: "active",
            resumed_at: new Date().toISOString(),
            resume_metadata: {
              forced: force,
              resumedBy: "manual",
            },
          })
          .eq("id", this.pauseState.id);
      }

      this.isPaused = false;
      this.pauseState = null;

      await this.logBotEvent("STRATEGY_RESUMED", "info", "Strategy resumed", {
        forced: force,
      });

      if (this.config.enableNotifications && this.discordNotifier) {
        await this.discordNotifier.sendResumeSuccessAlert(force);
      }

      logger.info("Strategy resumed successfully", { forced: force });
      return true;
    } catch (error) {
      logger.error("Failed to resume strategy", { error });
      return false;
    }
  }

  isPausedStatus(): boolean {
    return this.isPaused;
  }

  getPauseReason(): string | null {
    return this.pauseState?.pause_reason || null;
  }

  getPauseMetadata(): Record<string, unknown> | null {
    return this.pauseState?.pause_metadata || null;
  }

  private async logBotEvent(
    eventType: string,
    severity: "info" | "warning" | "error",
    message: string,
    metadata?: unknown,
  ): Promise<void> {
    try {
      await this.supabase.from("bot_events").insert({
        event_type: eventType,
        severity,
        message,
        metadata:
          metadata as Database["public"]["Tables"]["bot_events"]["Insert"]["metadata"],
      });
    } catch (error) {
      logger.error("Failed to log bot event", { error, eventType, message });
    }
  }
}
