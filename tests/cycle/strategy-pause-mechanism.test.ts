import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import { StrategyPauseMechanism } from "../../src/cycle/strategy-pause-mechanism";
import { DriftDetector } from "../../src/cycle/drift-detector";
import { CycleStateManager } from "../../src/cycle/cycle-state-manager";
import { DiscordNotifier } from "../../src/notifications/discord-notifier";
import { logger } from "../../src/utils/logger";

// Mock dependencies
jest.mock("../../src/cycle/drift-detector");
jest.mock("../../src/cycle/cycle-state-manager");
jest.mock("../../src/notifications/discord-notifier");
jest.mock("../../src/utils/logger");

describe("StrategyPauseMechanism", () => {
  let pauseMechanism: StrategyPauseMechanism;
  let mockSupabase: jest.Mocked<SupabaseClient<Database>>;
  let mockDriftDetector: jest.Mocked<DriftDetector>;
  let mockCycleStateManager: jest.Mocked<CycleStateManager>;
  let mockDiscordNotifier: jest.Mocked<DiscordNotifier>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(),
      eq: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<SupabaseClient<Database>>;

    mockDriftDetector = new DriftDetector() as jest.Mocked<DriftDetector>;
    mockCycleStateManager = new CycleStateManager(mockSupabase, {
      initialCapitalUSDT: 1000,
      maxPurchases: 10,
      minBuyUSDT: 10,
    }) as jest.Mocked<CycleStateManager>;
    mockDiscordNotifier = new DiscordNotifier({
      webhookUrl: "https://discord.webhook.url",
      environment: "test",
    }) as jest.Mocked<DiscordNotifier>;

    // Initialize the pause mechanism
    pauseMechanism = new StrategyPauseMechanism({
      supabase: mockSupabase,
      driftDetector: mockDriftDetector,
      cycleStateManager: mockCycleStateManager,
      discordNotifier: mockDiscordNotifier,
    });
  });

  describe("Initialization", () => {
    it("should initialize with all required dependencies", () => {
      expect(pauseMechanism).toBeDefined();
      expect(pauseMechanism.isPaused()).toBe(false);
      expect(pauseMechanism.getPauseReason()).toBeNull();
    });

    it("should restore paused state from database on initialization", async () => {
      // Mock database returns existing paused state
      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 1,
                status: "PAUSED",
                pause_reason: "DRIFT_DETECTED",
                paused_at: new Date().toISOString(),
                pause_metadata: {
                  usdtDrift: 0.01,
                  btcDrift: 0.008,
                },
              },
              error: null,
            }),
          }),
        }),
      });

      await pauseMechanism.initialize();

      expect(pauseMechanism.isPaused()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toBe("DRIFT_DETECTED");
    });
  });

  describe("Drift Detection Pausing", () => {
    it("should pause strategy when USDT drift exceeds threshold", async () => {
      // Mock drift detection result
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.01, // 1% drift
          status: "exceeded",
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.001,
          status: "ok",
          threshold: 0.005,
        },
        overallStatus: "exceeded",
      });

      // Mock current state
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: 1,
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
      });

      const result = await pauseMechanism.checkAndPauseOnDrift({
        usdtSpotBalance: 1010,
        capitalAvailable: 1000,
        btcSpotBalance: 0.01,
        btcAccumulated: 0.01,
      });

      expect(result.paused).toBe(true);
      expect(result.reason).toBe("DRIFT_DETECTED");
      expect(result.driftDetails).toEqual({
        usdtDrift: 0.01,
        btcDrift: 0.001,
        threshold: 0.005,
      });

      // Verify Discord notification was sent
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith({
        title: "🚨 Strategy Paused: Drift Detected",
        severity: "critical",
        description: expect.stringContaining("USDT drift: 1.00%"),
        fields: expect.arrayContaining([
          expect.objectContaining({
            name: "USDT Drift",
            value: "1.00% (threshold: 0.50%)",
          }),
        ]),
        requiresAction: true,
      });

      // Verify database update
      expect(mockSupabase.from).toHaveBeenCalledWith("cycle_state");
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: "PAUSED",
      });

      // Verify bot event was logged
      expect(mockSupabase.from).toHaveBeenCalledWith("bot_events");
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STRATEGY_PAUSED_DRIFT",
          severity: "error",
          message: expect.stringContaining("drift exceeded"),
        }),
      );
    });

    it("should pause strategy when BTC drift exceeds threshold", async () => {
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.001,
          status: "ok",
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.008, // 0.8% drift
          status: "exceeded",
          threshold: 0.005,
        },
        overallStatus: "exceeded",
      });

      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: 1,
        status: "HOLDING",
        capital_available: 500,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
      });

      const result = await pauseMechanism.checkAndPauseOnDrift({
        usdtSpotBalance: 500,
        capitalAvailable: 500,
        btcSpotBalance: 0.01008,
        btcAccumulated: 0.01,
      });

      expect(result.paused).toBe(true);
      expect(result.reason).toBe("DRIFT_DETECTED");
      expect(result.driftDetails?.btcDrift).toBe(0.008);

      // Verify Discord notification mentions BTC drift
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("BTC drift: 0.80%"),
        }),
      );
    });

    it("should not pause when drift is within acceptable threshold", async () => {
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.001,
          status: "ok",
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.002,
          status: "ok",
          threshold: 0.005,
        },
        overallStatus: "ok",
      });

      const result = await pauseMechanism.checkAndPauseOnDrift({
        usdtSpotBalance: 1001,
        capitalAvailable: 1000,
        btcSpotBalance: 0.01002,
        btcAccumulated: 0.01,
      });

      expect(result.paused).toBe(false);
      expect(result.reason).toBeNull();
      expect(mockDiscordNotifier.sendAlert).not.toHaveBeenCalled();
      expect(pauseMechanism.isPaused()).toBe(false);
    });

    it("should handle drift check when already paused", async () => {
      // First pause the strategy
      pauseMechanism["pausedState"] = {
        isPaused: true,
        reason: "CRITICAL_ERROR",
        pausedAt: new Date(),
        metadata: {},
      };

      const result = await pauseMechanism.checkAndPauseOnDrift({
        usdtSpotBalance: 1010,
        capitalAvailable: 1000,
        btcSpotBalance: 0.01,
        btcAccumulated: 0.01,
      });

      // Should not re-pause or send another notification
      expect(result.paused).toBe(true);
      expect(result.reason).toBe("CRITICAL_ERROR"); // Original reason
      expect(mockDiscordNotifier.sendAlert).not.toHaveBeenCalled();
    });
  });

  describe("Critical Error Pausing", () => {
    it("should pause on critical trading error", async () => {
      const error = new Error("Insufficient balance for trade");
      const context = {
        operation: "PLACE_BUY_ORDER",
        orderAmount: 100,
        availableBalance: 50,
      };

      const result = await pauseMechanism.pauseOnCriticalError(error, context);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe("CRITICAL_ERROR");
      expect(result.errorDetails).toEqual({
        message: "Insufficient balance for trade",
        context,
      });

      // Verify Discord notification
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith({
        title: "🚨 Strategy Paused: Critical Error",
        severity: "critical",
        description: expect.stringContaining("Insufficient balance"),
        fields: expect.arrayContaining([
          {
            name: "Operation",
            value: "PLACE_BUY_ORDER",
            inline: true,
          },
          {
            name: "Error Type",
            value: "Error",
            inline: true,
          },
        ]),
        requiresAction: true,
      });

      // Verify state update
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: "PAUSED",
      });
    });

    it("should pause on network connectivity error", async () => {
      const error = new Error(
        "ECONNREFUSED: Connection refused to Binance API",
      );
      const context = {
        operation: "FETCH_MARKET_DATA",
        endpoint: "api.binance.com",
        retryCount: 3,
      };

      const result = await pauseMechanism.pauseOnCriticalError(error, context);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe("CRITICAL_ERROR");

      // Verify appropriate severity for network errors
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "🚨 Strategy Paused: Critical Error",
          description: expect.stringContaining("ECONNREFUSED"),
        }),
      );
    });

    it("should pause on database corruption error", async () => {
      const error = new Error("Database integrity check failed");
      const context = {
        operation: "VALIDATE_CYCLE_STATE",
        validationErrors: [
          { field: "btc_accumulated", error: "Value is negative" },
          { field: "capital_available", error: "Exceeds initial capital" },
        ],
      };

      const result = await pauseMechanism.pauseOnCriticalError(error, context);

      expect(result.paused).toBe(true);
      expect(result.reason).toBe("CRITICAL_ERROR");

      // Verify detailed error logging
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STRATEGY_PAUSED_ERROR",
          severity: "error",
          metadata: expect.objectContaining({
            error: "Database integrity check failed",
            context,
          }),
        }),
      );
    });

    it("should not double-pause on multiple critical errors", async () => {
      // First error
      await pauseMechanism.pauseOnCriticalError(new Error("First error"), {
        operation: "OP1",
      });

      // Reset mock counts
      jest.clearAllMocks();

      // Second error while already paused
      const result = await pauseMechanism.pauseOnCriticalError(
        new Error("Second error"),
        { operation: "OP2" },
      );

      expect(result.paused).toBe(true);
      expect(result.alreadyPaused).toBe(true);

      // Should not send another Discord alert
      expect(mockDiscordNotifier.sendAlert).not.toHaveBeenCalled();
      // Should still log the error event
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "ERROR_WHILE_PAUSED",
        }),
      );
    });
  });

  describe("Manual Resume", () => {
    beforeEach(async () => {
      // Set up paused state
      pauseMechanism["pausedState"] = {
        isPaused: true,
        reason: "DRIFT_DETECTED",
        pausedAt: new Date(Date.now() - 3600000), // 1 hour ago
        metadata: {
          usdtDrift: 0.01,
          btcDrift: 0.002,
        },
      };
    });

    it("should successfully resume when validation passes", async () => {
      // Mock successful validation
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: 1,
        status: "PAUSED",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        reference_price: 50000,
        cost_accum_usdt: 500,
        btc_accum_net: 0.01,
      });

      mockCycleStateManager.validateState = jest.fn().mockReturnValue(true);

      // Mock drift is now acceptable
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: { status: "ok", driftPercentage: 0.001 },
        btc: { status: "ok", driftPercentage: 0.001 },
        overallStatus: "ok",
      });

      // Mock exchange connectivity check
      pauseMechanism["validateExchangeConnectivity"] = jest
        .fn()
        .mockResolvedValue(true);

      const result = await pauseMechanism.resume({
        force: false,
        validatorId: "admin-123",
        reason: "Drift resolved after manual balance adjustment",
      });

      expect(result.resumed).toBe(true);
      expect(result.validationResults).toEqual({
        stateValid: true,
        driftAcceptable: true,
        exchangeConnected: true,
      });
      expect(pauseMechanism.isPaused()).toBe(false);

      // Verify state was updated to READY
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: "READY",
      });

      // Verify resume notification was sent
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith({
        title: "✅ Strategy Resumed",
        severity: "info",
        description: expect.stringContaining("successfully resumed"),
        fields: expect.arrayContaining([
          {
            name: "Previous Pause Reason",
            value: "DRIFT_DETECTED",
            inline: true,
          },
          {
            name: "Pause Duration",
            value: expect.stringMatching(/\d+ minutes?/),
            inline: true,
          },
          {
            name: "Resumed By",
            value: "admin-123",
            inline: true,
          },
        ]),
      });

      // Verify resume event was logged
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STRATEGY_RESUMED",
          severity: "info",
          metadata: expect.objectContaining({
            validatorId: "admin-123",
            reason: "Drift resolved after manual balance adjustment",
          }),
        }),
      );
    });

    it("should fail to resume when state validation fails", async () => {
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: 1,
        status: "PAUSED",
        capital_available: -100, // Invalid negative value
        btc_accumulated: 0.01,
      });

      mockCycleStateManager.validateState = jest.fn().mockReturnValue(false);

      const result = await pauseMechanism.resume({
        force: false,
        validatorId: "admin-123",
      });

      expect(result.resumed).toBe(false);
      expect(result.error).toBe("State validation failed");
      expect(result.validationResults.stateValid).toBe(false);
      expect(pauseMechanism.isPaused()).toBe(true);

      // Should not update state
      expect(mockSupabase.update).not.toHaveBeenCalledWith({
        status: "READY",
      });

      // Should send validation failure notification
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "⚠️ Resume Failed: Validation Error",
          severity: "warning",
        }),
      );
    });

    it("should fail to resume when drift is still exceeded", async () => {
      mockCycleStateManager.validateState = jest.fn().mockReturnValue(true);

      // Drift still exceeded
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: { status: "exceeded", driftPercentage: 0.01 },
        btc: { status: "ok", driftPercentage: 0.001 },
        overallStatus: "exceeded",
      });

      const result = await pauseMechanism.resume({
        force: false,
        validatorId: "admin-123",
      });

      expect(result.resumed).toBe(false);
      expect(result.error).toBe("Drift still exceeds threshold");
      expect(result.validationResults.driftAcceptable).toBe(false);
      expect(pauseMechanism.isPaused()).toBe(true);
    });

    it("should allow force resume bypassing validation", async () => {
      // Set up failing validations
      mockCycleStateManager.validateState = jest.fn().mockReturnValue(false);
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        overallStatus: "exceeded",
      });

      const result = await pauseMechanism.resume({
        force: true,
        validatorId: "admin-123",
        reason: "Emergency override - manual verification completed",
      });

      expect(result.resumed).toBe(true);
      expect(result.forced).toBe(true);
      expect(pauseMechanism.isPaused()).toBe(false);

      // Verify warning in Discord notification
      expect(mockDiscordNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "⚠️ Strategy Force Resumed",
          severity: "warning",
          description: expect.stringContaining("FORCED RESUME"),
        }),
      );

      // Verify force resume is logged
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STRATEGY_FORCE_RESUMED",
          severity: "warning",
          metadata: expect.objectContaining({
            forced: true,
            validationBypassed: true,
          }),
        }),
      );
    });

    it("should recalculate all values after resume", async () => {
      // Mock successful validation
      mockCycleStateManager.validateState = jest.fn().mockReturnValue(true);
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        overallStatus: "ok",
      });
      pauseMechanism["validateExchangeConnectivity"] = jest
        .fn()
        .mockResolvedValue(true);

      // Mock recalculation method
      pauseMechanism["recalculateStrategyValues"] = jest
        .fn()
        .mockResolvedValue({
          capitalAvailable: 1000,
          btcAccumulated: 0.01,
          referencePrice: 50000,
          buyAmount: 100,
        });

      const result = await pauseMechanism.resume({
        force: false,
        validatorId: "admin-123",
      });

      expect(result.resumed).toBe(true);
      expect(pauseMechanism["recalculateStrategyValues"]).toHaveBeenCalled();

      // Verify recalculated values were saved
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "READY",
        }),
      );
    });

    it("should fail to resume when not paused", async () => {
      pauseMechanism["pausedState"] = {
        isPaused: false,
        reason: null,
        pausedAt: null,
        metadata: {},
      };

      const result = await pauseMechanism.resume({
        force: false,
        validatorId: "admin-123",
      });

      expect(result.resumed).toBe(false);
      expect(result.error).toBe("Strategy is not currently paused");
      expect(mockDiscordNotifier.sendAlert).not.toHaveBeenCalled();
    });
  });

  describe("State Persistence", () => {
    it("should persist pause state to database", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { id: 1 },
              error: null,
            }),
          }),
        }),
      });

      await pauseMechanism["persistPauseState"]({
        reason: "DRIFT_DETECTED",
        metadata: { usdtDrift: 0.01 },
      });

      expect(mockSupabase.from).toHaveBeenCalledWith("strategy_pause_state");
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        status: "PAUSED",
        pause_reason: "DRIFT_DETECTED",
        paused_at: expect.any(String),
        pause_metadata: { usdtDrift: 0.01 },
      });
    });

    it("should clear pause state from database on resume", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            error: null,
          }),
        }),
      });

      await pauseMechanism["clearPauseState"]();

      expect(mockSupabase.from).toHaveBeenCalledWith("strategy_pause_state");
      expect(mockSupabase.delete).toHaveBeenCalled();
    });
  });

  describe("Integration with CycleStateManager", () => {
    it("should update cycle state status when pausing", async () => {
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        overallStatus: "exceeded",
        usdt: { status: "exceeded", driftPercentage: 0.01 },
        btc: { status: "ok", driftPercentage: 0.001 },
      });

      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: 1,
        status: "READY",
      });

      await pauseMechanism.checkAndPauseOnDrift({
        usdtSpotBalance: 1010,
        capitalAvailable: 1000,
        btcSpotBalance: 0.01,
        btcAccumulated: 0.01,
      });

      // Verify cycle state was updated to PAUSED
      expect(mockSupabase.from).toHaveBeenCalledWith("cycle_state");
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: "PAUSED",
      });
    });

    it("should coordinate with cycle state manager for resume", async () => {
      pauseMechanism["pausedState"] = {
        isPaused: true,
        reason: "DRIFT_DETECTED",
        pausedAt: new Date(),
        metadata: {},
      };

      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: 1,
        status: "PAUSED",
      });
      mockCycleStateManager.validateState = jest.fn().mockReturnValue(true);
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        overallStatus: "ok",
      });
      pauseMechanism["validateExchangeConnectivity"] = jest
        .fn()
        .mockResolvedValue(true);

      await pauseMechanism.resume({
        force: false,
        validatorId: "admin-123",
      });

      // Verify cycle state was updated back to READY
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: "READY",
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle database errors gracefully when pausing", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest
            .fn()
            .mockRejectedValue(new Error("Database connection lost")),
        }),
      });

      const result = await pauseMechanism.pauseOnCriticalError(
        new Error("Test error"),
        {},
      );

      // Should still mark as paused in memory
      expect(result.paused).toBe(true);
      expect(pauseMechanism.isPaused()).toBe(true);

      // Should log the database error
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update database"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("should handle Discord notification failures gracefully", async () => {
      mockDiscordNotifier.sendAlert = jest
        .fn()
        .mockRejectedValue(new Error("Discord webhook failed"));

      const result = await pauseMechanism.pauseOnCriticalError(
        new Error("Test error"),
        {},
      );

      // Should still pause successfully
      expect(result.paused).toBe(true);

      // Should log the notification failure
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send Discord notification"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("should handle concurrent pause requests", async () => {
      // Simulate concurrent pause requests
      const pause1 = pauseMechanism.pauseOnCriticalError(new Error("Error 1"), {
        operation: "OP1",
      });
      const pause2 = pauseMechanism.pauseOnCriticalError(new Error("Error 2"), {
        operation: "OP2",
      });

      const [result1, result2] = await Promise.all([pause1, pause2]);

      // One should succeed, one should detect already paused
      const results = [result1, result2];
      expect(results.filter((r) => r.alreadyPaused === true).length).toBe(1);
      expect(results.every((r) => r.paused === true)).toBe(true);
    });

    it("should maintain pause state through instance recreation", async () => {
      // First instance pauses
      await pauseMechanism.pauseOnCriticalError(new Error("Test"), {});

      // Create new instance (simulating restart)
      const newPauseMechanism = new StrategyPauseMechanism({
        supabase: mockSupabase,
        driftDetector: mockDriftDetector,
        cycleStateManager: mockCycleStateManager,
        discordNotifier: mockDiscordNotifier,
      });

      // Mock database returns paused state
      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                status: "PAUSED",
                pause_reason: "CRITICAL_ERROR",
                paused_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      });

      await newPauseMechanism.initialize();

      expect(newPauseMechanism.isPaused()).toBe(true);
      expect(newPauseMechanism.getPauseReason()).toBe("CRITICAL_ERROR");
    });
  });

  describe("Pause Reason Details", () => {
    it("should track detailed pause metadata", async () => {
      const metadata = {
        usdtDrift: 0.015,
        btcDrift: 0.003,
        usdtSpotBalance: 1015,
        capitalAvailable: 1000,
        btcSpotBalance: 0.01003,
        btcAccumulated: 0.01,
      };

      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: { status: "exceeded", driftPercentage: 0.015 },
        btc: { status: "ok", driftPercentage: 0.003 },
        overallStatus: "exceeded",
      });

      await pauseMechanism.checkAndPauseOnDrift(metadata);

      const pauseDetails = pauseMechanism.getPauseDetails();
      expect(pauseDetails).toMatchObject({
        isPaused: true,
        reason: "DRIFT_DETECTED",
        pausedAt: expect.any(Date),
        metadata: expect.objectContaining({
          usdtDrift: 0.015,
          btcDrift: 0.003,
        }),
      });
    });

    it("should categorize pause reasons correctly", () => {
      const reasons = pauseMechanism.getPauseReasonCategories();

      expect(reasons).toEqual({
        DRIFT_DETECTED: "Balance drift exceeded threshold",
        CRITICAL_ERROR: "Unrecoverable error occurred",
        MANUAL_PAUSE: "Manually paused by operator",
        STATE_CORRUPTION: "Cycle state validation failed",
        EXCHANGE_ERROR: "Exchange connectivity or API error",
      });
    });
  });
});
