import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import { StrategyPauseMechanism } from "../../src/cycle/strategy-pause-mechanism";
import {
  DriftDetector,
  type DriftResult,
} from "../../src/cycle/drift-detector";
import { CycleStateManager } from "../../src/cycle/cycle-state-manager";
import { DiscordNotifier } from "../../src/notifications/discord-notifier";
import { logger } from "../../src/utils/logger";

// Mock only external dependencies (Supabase and Discord)
jest.mock("../../src/utils/logger");

/**
 * Integration tests for StrategyPauseMechanism
 * These tests verify the pause mechanism works correctly with real components
 */
describe("StrategyPauseMechanism Integration", () => {
  let pauseMechanism: StrategyPauseMechanism;
  let mockSupabase: jest.Mocked<SupabaseClient<Database>>;
  let mockQueryBuilder: {
    insert: jest.Mock;
    update: jest.Mock;
    select: jest.Mock;
    single: jest.Mock;
    eq: jest.Mock;
    delete: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
  };
  let driftDetector: DriftDetector;
  let cycleStateManager: CycleStateManager;
  let mockDiscordNotifier: jest.Mocked<DiscordNotifier>;

  beforeEach(() => {
    // Create mock Supabase client
    mockQueryBuilder = {
      insert: jest.fn(() => mockQueryBuilder),
      update: jest.fn(() => mockQueryBuilder),
      select: jest.fn(() => mockQueryBuilder),
      single: jest.fn(() => Promise.resolve({ data: null, error: null })),
      eq: jest.fn(() => mockQueryBuilder),
      delete: jest.fn(() => mockQueryBuilder),
      order: jest.fn(() => mockQueryBuilder),
      limit: jest.fn(() => mockQueryBuilder),
    };

    mockSupabase = {
      from: jest.fn().mockReturnValue(mockQueryBuilder),
    } as unknown as jest.Mocked<SupabaseClient<Database>>;

    // Create real DriftDetector with default threshold
    driftDetector = new DriftDetector();

    // Create real CycleStateManager
    cycleStateManager = new CycleStateManager(mockSupabase, {
      initialCapitalUSDT: 1000,
      maxPurchases: 10,
      minBuyUSDT: 10,
    });

    // Mock Discord notifier (external service)
    mockDiscordNotifier = {
      sendAlert: jest.fn(() => Promise.resolve()),
      sendPauseAlert: jest.fn(() => Promise.resolve()),
      sendResumeSuccessAlert: jest.fn(() => Promise.resolve()),
      sendResumeFailedAlert: jest.fn(() => Promise.resolve()),
      sendDriftAlert: jest.fn(() => Promise.resolve()),
      sendErrorAlert: jest.fn(() => Promise.resolve()),
      sendTradeAlert: jest.fn(() => Promise.resolve()),
      sendResumeAlert: jest.fn(() => Promise.resolve()),
      sendBatch: jest.fn(() => Promise.resolve()),
      sendBatchAlerts: jest.fn(() => Promise.resolve()),
      healthCheck: jest.fn(() => Promise.resolve(true)),
      testWebhook: jest.fn(() => Promise.resolve(true)),
      getConfig: jest.fn(() => ({
        webhookUrl: "https://discord.webhook.url",
        environment: "test",
        enableRateLimiting: true,
        rateLimitWindow: 60000,
        rateLimitCount: 5,
        silentMode: false,
      })),
    } as unknown as jest.Mocked<DiscordNotifier>;

    // Initialize the pause mechanism with real components
    pauseMechanism = new StrategyPauseMechanism(
      mockSupabase,
      cycleStateManager,
      driftDetector,
      mockDiscordNotifier,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("End-to-End Drift Detection Flow", () => {
    it("should detect drift and pause strategy when USDT balance drifts", async () => {
      // Setup initial cycle state
      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "cycle_state") {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 1,
                  status: "READY",
                  capital_available: 1000,
                  btc_accumulated: 0.01,
                  purchases_remaining: 5,
                  reference_price: 50000,
                  cost_accum_usdt: 500,
                  btc_accum_net: 0.01,
                  ath_price: null,
                  buy_amount: 100,
                },
                error: null,
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "bot_events") {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "strategy_pause_state") {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 1 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return mockSupabase;
      });

      await cycleStateManager.initialize();

      // Simulate drift condition (1% USDT drift, exceeds 0.5% threshold)
      const result = await pauseMechanism.checkDriftAndPause(
        1010, // usdtSpotBalance - 1% drift from 1000
        1000, // capitalAvailable
        0.01, // btcSpotBalance
        0.01, // btcAccumulated
      );

      // Verify pause was triggered
      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toContain("drift exceeded");

      // Verify Discord notification was sent
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "drift_detected",
          message: expect.stringContaining("drift exceeded"),
        }),
      );

      // Verify cycle state was updated
      expect(mockSupabase.from).toHaveBeenCalledWith("cycle_state");
      expect(mockQueryBuilder.update).toHaveBeenCalledWith({
        status: "PAUSED",
      });

      // Verify bot event was logged
      expect(mockSupabase.from).toHaveBeenCalledWith("bot_events");
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STRATEGY_PAUSED_DRIFT",
          severity: "error",
        }),
      );
    });

    it("should not pause when drift is within acceptable limits", async () => {
      // Setup cycle state
      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "cycle_state") {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 1,
                  status: "READY",
                  capital_available: 1000,
                  btc_accumulated: 0.01,
                  purchases_remaining: 5,
                },
                error: null,
              }),
            }),
          };
        }
        return mockSupabase;
      });

      await cycleStateManager.initialize();

      // Simulate small drift (0.3%, below 0.5% threshold)
      const result = await pauseMechanism.checkDriftAndPause(
        1003, // usdtSpotBalance - 0.3% drift
        1000, // capitalAvailable
        0.01002, // btcSpotBalance - 0.2% drift
        0.01, // btcAccumulated
      );

      // Verify no pause
      expect(result).toBe(false);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(pauseMechanism.getPauseReason()).toBeNull();
      expect(mockDiscordNotifier.sendPauseAlert).not.toHaveBeenCalled();
    });
  });

  describe("Complete Pause and Resume Cycle", () => {
    it("should handle full pause-resume cycle with validation", async () => {
      // Step 1: Initialize with valid state
      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "cycle_state") {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 1,
                  status: "READY",
                  capital_available: 1000,
                  btc_accumulated: 0.01,
                  purchases_remaining: 5,
                  reference_price: 50000,
                  cost_accum_usdt: 500,
                  btc_accum_net: 0.01,
                  ath_price: null,
                  buy_amount: 100,
                },
                error: null,
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "bot_events") {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "strategy_pause_state") {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { id: 1 },
                  error: null,
                }),
              }),
            }),
            delete: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return mockSupabase;
      });

      await cycleStateManager.initialize();

      // Step 2: Trigger pause due to critical error
      const errorContext = {
        operation: "PLACE_BUY_ORDER",
        errorCode: "INSUFFICIENT_BALANCE",
        requiredBalance: 100,
        availableBalance: 50,
      };

      const pauseResult = await pauseMechanism.pauseOnError(
        new Error("Insufficient balance for trade"),
        errorContext,
      );

      expect(pauseResult.paused).toBe(true);
      expect(pauseResult.reason).toBe("CRITICAL_ERROR");
      expect(pauseMechanism.isPausedStatus()).toBe(true);

      // Verify Discord alert was sent
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "critical_error",
          message: expect.any(String),
        }),
      );

      // Step 3: Attempt resume with validation
      // First attempt - simulate drift still exists (should fail)
      const firstResumeAttempt = await pauseMechanism.resumeStrategy(false);
      expect(firstResumeAttempt).toBe(false); // Should fail due to drift

      // Mock exchange connectivity check
      pauseMechanism["validateExchangeConnectivity"] = jest
        .fn()
        .mockResolvedValue(true);

      // Since we're using real DriftDetector, we need to provide valid balances
      // Mock the current state for drift check
      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "cycle_state") {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 1,
                  status: "PAUSED",
                  capital_available: 1000,
                  btc_accumulated: 0.01,
                  purchases_remaining: 5,
                  reference_price: 50000,
                  cost_accum_usdt: 500,
                  btc_accum_net: 0.01,
                  ath_price: null,
                  buy_amount: 100,
                },
                error: null,
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "bot_events") {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "strategy_pause_state") {
          return {
            delete: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return mockSupabase;
      });

      // Step 4: Successful resume after fixing issues
      // Mock drift check to pass
      jest.spyOn(driftDetector, "checkDrift").mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.001, // 0.1% - below threshold
          status: "ok",
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.001,
          status: "ok",
          threshold: 0.005,
        },
        overallStatus: "ok",
      });

      const successfulResume = await pauseMechanism.resumeStrategy(false);

      expect(successfulResume).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);

      // Verify resume notification
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalledWith(
        false,
      );
    });
  });

  describe("Multiple Error Handling", () => {
    it("should handle cascading errors without double-pausing", async () => {
      // Initialize
      await pauseMechanism.initialize();

      // First error causes pause
      const error1 = new Error("Database connection lost");
      const result1 = await pauseMechanism.pauseOnError(error1, {
        operation: "DATABASE_QUERY",
      });

      expect(result1.paused).toBe(true);
      expect(result1.alreadyPaused).toBe(false);

      // Clear mock calls
      jest.clearAllMocks();

      // Second error while already paused
      const error2 = new Error("Exchange API timeout");
      const result2 = await pauseMechanism.pauseOnError(error2, {
        operation: "FETCH_TICKER",
      });

      expect(result2.paused).toBe(true);
      expect(result2.alreadyPaused).toBe(true);

      // Should not send another Discord alert for second error
      expect(mockDiscordNotifier.sendPauseAlert).not.toHaveBeenCalled();

      // Third error
      const error3 = new Error("Invalid order parameters");
      const result3 = await pauseMechanism.pauseOnError(error3, {
        operation: "VALIDATE_ORDER",
      });

      expect(result3.paused).toBe(true);
      expect(result3.alreadyPaused).toBe(true);

      // Strategy should still be paused with original reason
      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toBe("CRITICAL_ERROR");
    });
  });

  describe("State Persistence Across Restarts", () => {
    it("should maintain pause state through system restart", async () => {
      // Simulate existing paused state in database
      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "strategy_pause_state") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: 1,
                    status: "PAUSED",
                    pause_reason: "DRIFT_DETECTED",
                    paused_at: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
                    pause_metadata: {
                      usdtDrift: 0.012,
                      btcDrift: 0.003,
                      detectedAt: new Date(Date.now() - 7200000).toISOString(),
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return mockSupabase;
      });

      // Create new instance (simulating restart)
      const newPauseMechanism = new StrategyPauseMechanism({
        supabase: mockSupabase,
        driftDetector,
        cycleStateManager,
        discordNotifier: mockDiscordNotifier,
      });

      // Initialize should restore paused state
      await newPauseMechanism.initialize();

      expect(newPauseMechanism.isPausedStatus()).toBe(true);
      expect(newPauseMechanism.getPauseReason()).toBe("DRIFT_DETECTED");

      const pauseDetails = newPauseMechanism.getPauseDetails();
      expect(pauseDetails?.metadata).toEqual({
        usdtDrift: 0.012,
        btcDrift: 0.003,
        detectedAt: expect.any(String),
      });
    });
  });

  describe("Force Resume Scenarios", () => {
    it("should allow force resume bypassing all validations", async () => {
      // Setup paused state
      await pauseMechanism.pauseOnError(new Error("Critical system failure"), {
        operation: "SYSTEM_CHECK",
      });

      expect(pauseMechanism.isPausedStatus()).toBe(true);

      // Setup failing validations
      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "cycle_state") {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 1,
                  status: "PAUSED",
                  capital_available: -100, // Invalid negative value
                  btc_accumulated: -0.01, // Invalid negative value
                  purchases_remaining: 15, // Exceeds max
                },
                error: null,
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "bot_events") {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "strategy_pause_state") {
          return {
            delete: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return mockSupabase;
      });

      // Mock drift check to fail
      jest.spyOn(driftDetector, "checkDrift").mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.02, // 2% - way above threshold
          status: "exceeded",
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.015,
          status: "exceeded",
          threshold: 0.005,
        },
        overallStatus: "exceeded",
      });

      // Mock exchange connectivity to fail
      pauseMechanism["validateExchangeConnectivity"] = jest
        .fn()
        .mockResolvedValue(false);

      // Normal resume should fail
      const normalResume = await pauseMechanism.resumeStrategy(false);

      expect(normalResume).toBe(false);

      // Force resume should succeed despite failures
      const forceResume = await pauseMechanism.resumeStrategy(true);

      expect(forceResume).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);

      // Verify warning notification was sent
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalledWith(
        true,
      );

      // Verify force resume was logged
      expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "STRATEGY_FORCE_RESUMED",
          severity: "warning",
        }),
      );
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent pause requests correctly", async () => {
      // Simulate concurrent errors from different parts of the system
      const promises = [
        pauseMechanism.pauseOnError(new Error("API Error"), {
          operation: "API_CALL",
        }),
        pauseMechanism.pauseOnError(new Error("Database Error"), {
          operation: "DB_QUERY",
        }),
        pauseMechanism.pauseOnError(new Error("Validation Error"), {
          operation: "VALIDATION",
        }),
      ];

      const results = await Promise.all(promises);

      // Only one should successfully pause, others should detect already paused
      const primaryPause = results.filter((r) => !r.alreadyPaused);
      const secondaryPauses = results.filter((r) => r.alreadyPaused);

      expect(primaryPause.length).toBe(1);
      expect(secondaryPauses.length).toBe(2);

      // All should report paused state
      expect(results.every((r) => r.paused)).toBe(true);

      // Only one Discord notification should be sent
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalledTimes(1);
    });

    it("should handle pause during resume attempt", async () => {
      // Setup initial paused state
      await pauseMechanism.pauseOnError(new Error("Initial error"), {});

      // Mock successful validation for resume
      const mockUsdtResult: DriftResult = {
        asset: "USDT",
        status: "ok",
        driftPercentage: 0.001,
        threshold: 0.005,
      };

      const mockBtcResult: DriftResult = {
        asset: "BTC",
        status: "ok",
        driftPercentage: 0.001,
        threshold: 0.005,
      };

      jest.spyOn(driftDetector, "checkDrift").mockReturnValue({
        usdt: mockUsdtResult,
        btc: mockBtcResult,
        overallStatus: "ok",
      });

      mockSupabase.from = jest.fn().mockImplementation((table) => {
        if (table === "cycle_state") {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 1,
                  status: "PAUSED",
                  capital_available: 1000,
                  btc_accumulated: 0.01,
                  purchases_remaining: 5,
                },
                error: null,
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockImplementation(() => {
                // Simulate error during resume
                return Promise.reject(new Error("Database lock timeout"));
              }),
            }),
          };
        }
        return mockSupabase;
      });

      pauseMechanism["validateExchangeConnectivity"] = jest
        .fn()
        .mockResolvedValue(true);

      // Attempt resume which will fail due to database error
      const resumeResult = await pauseMechanism.resumeStrategy(false);

      expect(resumeResult).toBe(false);

      // Should still be paused
      expect(pauseMechanism.isPausedStatus()).toBe(true);
    });
  });

  describe("Real Drift Calculations", () => {
    it("should correctly calculate and handle various drift scenarios", async () => {
      // Test cases with real drift detector calculations
      const scenarios = [
        {
          name: "Small USDT drift within threshold",
          balances: {
            usdtSpotBalance: 1004.99,
            capitalAvailable: 1000,
            btcSpotBalance: 0.01,
            btcAccumulated: 0.01,
          },
          expectedPaused: false,
        },
        {
          name: "USDT drift at exact threshold",
          balances: {
            usdtSpotBalance: 1005,
            capitalAvailable: 1000,
            btcSpotBalance: 0.01,
            btcAccumulated: 0.01,
          },
          expectedPaused: true, // >= 0.5% triggers pause
        },
        {
          name: "Large BTC drift",
          balances: {
            usdtSpotBalance: 1000,
            capitalAvailable: 1000,
            btcSpotBalance: 0.0101, // 1% drift
            btcAccumulated: 0.01,
          },
          expectedPaused: true,
        },
        {
          name: "Both assets drift but below threshold",
          balances: {
            usdtSpotBalance: 1003,
            capitalAvailable: 1000,
            btcSpotBalance: 0.01003,
            btcAccumulated: 0.01,
          },
          expectedPaused: false,
        },
        {
          name: "Zero balances edge case",
          balances: {
            usdtSpotBalance: 0,
            capitalAvailable: 0,
            btcSpotBalance: 0,
            btcAccumulated: 0,
          },
          expectedPaused: false, // No drift when both are zero
        },
      ];

      for (const scenario of scenarios) {
        jest.clearAllMocks();

        const result = await pauseMechanism.checkDriftAndPause(
          scenario.balances.usdtSpotBalance,
          scenario.balances.capitalAvailable,
          scenario.balances.btcSpotBalance,
          scenario.balances.btcAccumulated,
        );

        expect(result).toBe(scenario.expectedPaused);

        if (scenario.expectedPaused) {
          expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalled();
        } else {
          expect(mockDiscordNotifier.sendPauseAlert).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe("Error Recovery Patterns", () => {
    it("should handle and recover from Discord notification failures", async () => {
      // Mock Discord to fail
      mockDiscordNotifier.sendPauseAlert = jest
        .fn()
        .mockRejectedValue(new Error("Discord webhook unavailable"));

      // Pause should still work even if Discord fails
      const result = await pauseMechanism.pauseOnError(
        new Error("Test error"),
        {},
      );

      expect(result.paused).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(true);

      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send Discord notification"),
        expect.any(Object),
      );
    });

    it("should handle database errors during pause gracefully", async () => {
      // Mock database to fail
      mockSupabase.from = jest.fn().mockImplementation(() => {
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockRejectedValue(new Error("Database unavailable")),
          }),
          insert: jest
            .fn()
            .mockRejectedValue(new Error("Database unavailable")),
        };
      });

      const result = await pauseMechanism.pauseOnError(
        new Error("Test error"),
        {},
      );

      // Should still pause in memory even if database fails
      expect(result.paused).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(true);

      // Verify database error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update"),
        expect.any(Object),
      );
    });
  });
});
