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
  let mockSupabase: SupabaseClient<Database>;
  let mockDriftDetector: DriftDetector;
  let mockCycleStateManager: CycleStateManager;
  let mockDiscordNotifier: DiscordNotifier;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create a properly typed mock Supabase client
    let pauseStateData: unknown = null;
    const mockQueryBuilder = {
      insert: jest.fn((data: unknown) => {
        // Store the data being inserted for pause_states
        if (data && typeof data === "object" && "pause_reason" in data) {
          pauseStateData = {
            id: 1,
            status: "status" in data ? data.status : "paused",
            pause_reason: data.pause_reason,
            pause_metadata: "pause_metadata" in data ? data.pause_metadata : {},
            paused_at: new Date().toISOString(),
            resumed_at: null,
            resume_metadata: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }
        return mockQueryBuilder;
      }),
      update: jest.fn(() => mockQueryBuilder),
      select: jest.fn(() => mockQueryBuilder),
      single: jest.fn(() => {
        // Return the stored pause data if available
        if (pauseStateData) {
          const result = { data: pauseStateData, error: null };
          pauseStateData = null; // Reset after use
          return Promise.resolve(result);
        }
        return Promise.resolve({ data: null, error: null });
      }),
      eq: jest.fn(() => mockQueryBuilder),
      order: jest.fn(() => mockQueryBuilder),
      limit: jest.fn(() => mockQueryBuilder),
      delete: jest.fn(() => mockQueryBuilder),
    };

    mockSupabase = {
      from: jest.fn(() => mockQueryBuilder),
    } as unknown as SupabaseClient<Database>;

    // Create mock instances
    mockDriftDetector = new DriftDetector();
    mockCycleStateManager = new CycleStateManager(mockSupabase, {
      initialCapitalUSDT: 1000,
      maxPurchases: 10,
      minBuyUSDT: 10,
    });

    mockDiscordNotifier = new DiscordNotifier({
      webhookUrl: "https://discord.webhook.url",
    });

    // Mock the methods we need
    jest
      .spyOn(mockDiscordNotifier, "sendPauseAlert")
      .mockResolvedValue(undefined);
    jest
      .spyOn(mockDiscordNotifier, "sendResumeSuccessAlert")
      .mockResolvedValue(undefined);
    jest
      .spyOn(mockDiscordNotifier, "sendResumeFailedAlert")
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
      const mockQueryBuilder = {
        select: jest.fn(() => mockQueryBuilder),
        eq: jest.fn(() => mockQueryBuilder),
        order: jest.fn(() => mockQueryBuilder),
        limit: jest.fn(() => mockQueryBuilder),
        single: jest.fn(() =>
          Promise.resolve({
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
          }),
        ),
      };

      const mockSupabaseWithData = {
        from: jest.fn(() => mockQueryBuilder),
      } as unknown as SupabaseClient<Database>;

      const pauseMechanismWithState = new StrategyPauseMechanism(
        mockSupabaseWithData,
        mockCycleStateManager,
        mockDriftDetector,
        mockDiscordNotifier,
      );

      await pauseMechanismWithState.initialize();

      expect(pauseMechanismWithState.isPausedStatus()).toBe(true);
      expect(pauseMechanismWithState.getPauseReason()).toBe("Drift detected");
    });
  });

  describe("Drift Detection Pausing", () => {
    it("should pause strategy when drift exceeds threshold", async () => {
      // Mock drift detection result
      jest.spyOn(mockDriftDetector, "checkDrift").mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.01, // 1% drift
          status: "exceeded" as const,
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.001,
          status: "ok" as const,
          threshold: 0.005,
        },
        overallStatus: "exceeded" as const,
      });

      // Mock current state
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
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
      jest.spyOn(mockDriftDetector, "checkDrift").mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.001,
          status: "ok" as const,
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.002,
          status: "ok" as const,
          threshold: 0.005,
        },
        overallStatus: "ok" as const,
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

      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
      });

      await pauseMechanism.pauseOnError(error, context);

      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toBe(error.message);
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalled();
    });

    it("should not double-pause on multiple errors", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
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
      // Pause the strategy first
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
      });

      await pauseMechanism.pauseOnError(new Error("Test pause"), {});
    });

    it("should successfully resume when validation passes", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "PAUSED",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
      });

      jest.spyOn(mockCycleStateManager, "validateState").mockReturnValue(true);

      const result = await pauseMechanism.resumeStrategy(false);

      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalled();
    });

    it("should fail to resume when state validation fails", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "PAUSED",
        capital_available: -100, // Invalid negative value
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
      });

      jest.spyOn(mockCycleStateManager, "validateState").mockReturnValue(false);

      const result = await pauseMechanism.resumeStrategy(false);

      expect(result).toBe(false);
      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(mockDiscordNotifier.sendResumeFailedAlert).toHaveBeenCalled();
    });

    it("should allow force resume bypassing validation", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "PAUSED",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
      });

      jest.spyOn(mockCycleStateManager, "validateState").mockReturnValue(false);

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
      jest.spyOn(mockDriftDetector, "checkDrift").mockReturnValue({
        usdt: {
          asset: "USDT",
          driftPercentage: 0.015,
          status: "exceeded" as const,
          threshold: 0.005,
        },
        btc: {
          asset: "BTC",
          driftPercentage: 0.003,
          status: "ok" as const,
          threshold: 0.005,
        },
        overallStatus: "exceeded" as const,
      });

      jest.spyOn(mockCycleStateManager, "getCurrentState").mockReturnValue({
        id: "test-id",
        status: "READY",
        capital_available: 1000,
        btc_accumulated: 0.01,
        purchases_remaining: 5,
        ath_price: null,
        btc_accum_net: null,
        buy_amount: null,
        cost_accum_usdt: null,
        reference_price: null,
        updated_at: null,
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
