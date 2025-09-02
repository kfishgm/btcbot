import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import { StrategyPauseMechanism } from "../../src/cycle/strategy-pause-mechanism";
import { DriftDetector } from "../../src/cycle/drift-detector";
import { CycleStateManager } from "../../src/cycle/cycle-state-manager";
import { DiscordNotifier } from "../../src/notifications/discord-notifier";

// Mock dependencies
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

    // Create mock Supabase client
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    } as unknown as jest.Mocked<SupabaseClient<Database>>;

    // Create real instances with mocked methods
    mockDriftDetector = new DriftDetector() as jest.Mocked<DriftDetector>;
    mockCycleStateManager = new CycleStateManager(mockSupabase, {
      initialCapitalUSDT: 1000,
      maxPurchases: 10,
      minBuyUSDT: 10,
    }) as jest.Mocked<CycleStateManager>;

    mockDiscordNotifier = new DiscordNotifier({
      webhookUrl: "https://discord.webhook.url",
    }) as jest.Mocked<DiscordNotifier>;

    // Mock specific methods
    mockDiscordNotifier.sendPauseAlert = jest.fn().mockResolvedValue(undefined);
    mockDiscordNotifier.sendResumeSuccessAlert = jest
      .fn()
      .mockResolvedValue(undefined);
    mockDiscordNotifier.sendResumeFailedAlert = jest
      .fn()
      .mockResolvedValue(undefined);

    // Initialize the pause mechanism
    pauseMechanism = new StrategyPauseMechanism(
      mockSupabase,
      mockCycleStateManager,
      mockDriftDetector,
      mockDiscordNotifier,
    );
  });

  describe("Initialization", () => {
    it("should initialize with all required dependencies", () => {
      expect(pauseMechanism).toBeDefined();
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(pauseMechanism.getPauseReason()).toBeNull();
    });

    it("should restore paused state from database on initialization", async () => {
      // Mock database returns existing paused state
      const mockSingle = jest.fn().mockResolvedValue({
        data: {
          id: 1,
          status: "paused",
          pause_reason: "Drift detected",
          paused_at: new Date().toISOString(),
          pause_metadata: {
            usdtDrift: 0.01,
            btcDrift: 0.008,
          },
        },
        error: null,
      });

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: mockSingle,
              }),
            }),
          }),
        }),
      });

      await pauseMechanism.initialize();

      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toBe("Drift detected");
    });
  });

  describe("Drift Detection Pausing", () => {
    it("should pause strategy when drift exceeds threshold", async () => {
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
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
      });

      const result = await pauseMechanism.checkDriftAndPause(
        1010, // usdtSpotBalance
        1000, // capitalAvailable
        0.01, // btcSpotBalance
        0.01, // btcAccumulated
      );

      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toContain("drift exceeded");

      // Verify Discord notification was sent
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalled();
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

      const result = await pauseMechanism.checkDriftAndPause(
        1001,
        1000,
        0.01002,
        0.01,
      );

      expect(result).toBe(false);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(pauseMechanism.getPauseReason()).toBeNull();
    });
  });

  describe("Error Pausing", () => {
    it("should pause on critical error", async () => {
      const error = new Error("Insufficient balance for trade");
      const context = {
        operation: "PLACE_BUY_ORDER",
        orderAmount: 100,
        availableBalance: 50,
      };

      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
      });

      await pauseMechanism.pauseOnError(error, context);

      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toBe(error.message);
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalled();
    });

    it("should not double-pause on multiple errors", async () => {
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "READY",
      });

      // First error
      await pauseMechanism.pauseOnError(new Error("First error"), {});

      // Reset mock counts
      jest.clearAllMocks();

      // Second error while already paused
      await pauseMechanism.pauseOnError(new Error("Second error"), {});

      // Should not send another Discord alert
      expect(mockDiscordNotifier.sendPauseAlert).not.toHaveBeenCalled();
    });
  });

  describe("Resume", () => {
    beforeEach(async () => {
      // Pause the strategy first using the public API
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
      });

      await pauseMechanism.pauseOnError(new Error("Test pause"), {});
    });

    it("should successfully resume when validation passes", async () => {
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "PAUSED",
        capital_available: 1000,
        btc_accumulated: 0.01,
      });

      mockCycleStateManager.validateState = jest.fn().mockReturnValue(true);

      const result = await pauseMechanism.resumeStrategy(false);

      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalled();
    });

    it("should fail to resume when state validation fails", async () => {
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "PAUSED",
        capital_available: -100, // Invalid negative value
        btc_accumulated: 0.01,
      });

      mockCycleStateManager.validateState = jest.fn().mockReturnValue(false);

      const result = await pauseMechanism.resumeStrategy(false);

      expect(result).toBe(false);
      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(mockDiscordNotifier.sendResumeFailedAlert).toHaveBeenCalled();
    });

    it("should allow force resume bypassing validation", async () => {
      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "PAUSED",
        capital_available: 1000,
        btc_accumulated: 0.01,
      });

      mockCycleStateManager.validateState = jest.fn().mockReturnValue(false);

      const result = await pauseMechanism.resumeStrategy(true); // Force resume

      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalledWith(
        true,
      );
    });
  });

  describe("State Management", () => {
    it("should track pause metadata", async () => {
      // Mock drift detection to trigger pause with metadata
      mockDriftDetector.checkDrift = jest.fn().mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.015,
          status: "exceeded",
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.003,
          status: "ok",
          threshold: 0.005,
        },
        overallStatus: "exceeded",
      });

      mockCycleStateManager.getCurrentState = jest.fn().mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
      });

      await pauseMechanism.checkDriftAndPause(1015, 1000, 0.01003, 0.01);

      const metadata = pauseMechanism.getPauseMetadata();
      expect(metadata).toBeDefined();
      expect(metadata?.usdtDrift).toBe(0.015);
      expect(metadata?.btcDrift).toBe(0.003);
    });

    it("should return null metadata when not paused", () => {
      expect(pauseMechanism.getPauseMetadata()).toBeNull();
    });
  });
});
