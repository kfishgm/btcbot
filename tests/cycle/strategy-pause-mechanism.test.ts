import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import { StrategyPauseMechanism } from "../../src/cycle/strategy-pause-mechanism";
import { CycleStateManager } from "../../src/cycle/cycle-state-manager";
import { DiscordNotifier } from "../../src/notifications/discord-notifier";
import { MockTradingRules } from "../mocks/mock-trading-rules";
import type { TradingRules } from "../../src/exchange/trading-rules";

describe("StrategyPauseMechanism", () => {
  let pauseMechanism: StrategyPauseMechanism;
  let mockSupabase: SupabaseClient<Database>;
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
    const mockTradingRules = new MockTradingRules() as unknown as TradingRules;
    mockCycleStateManager = new CycleStateManager(
      mockSupabase,
      {
        initialCapitalUSDT: 1000,
        maxPurchases: 10,
        minBuyUSDT: 10,
      },
      mockTradingRules,
    );

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
      mockDiscordNotifier,
    );
  });

  // Helper function to create a valid mock cycle state
  const createMockCycleState = (overrides = {}) => ({
    id: "test-id",
    status: "READY",
    capital_available: 1000,
    btc_accumulated: 0,
    purchases_remaining: 10,
    ath_price: null,
    btc_accum_net: null,
    btc_dust: null,
    buy_amount: null,
    buy_anchor_price: null,
    cost_accum_usdt: null,
    reference_price: null,
    completed_at: null,
    final_profit: null,
    previous_cycle_id: null,
    strategy_config_id: null,
    updated_at: null,
    buy_grid: null,
    buy_index: 0,
    version: 1,
    ...overrides,
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
        mockDiscordNotifier,
      );

      await pauseMechanismWithState.initialize();

      expect(pauseMechanismWithState.isPausedStatus()).toBe(true);
      expect(pauseMechanismWithState.getPauseReason()).toBe("Drift detected");
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

      jest.spyOn(mockCycleStateManager, "getCurrentState").mockResolvedValue(
        createMockCycleState({
          btc_accumulated: 0.01,
          purchases_remaining: 5,
        }),
      );

      await pauseMechanism.pauseOnError(error, context);

      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(pauseMechanism.getPauseReason()).toBe(error.message);
      expect(mockDiscordNotifier.sendPauseAlert).toHaveBeenCalled();
    });

    it("should not double-pause on multiple errors", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockResolvedValue(
        createMockCycleState({
          btc_accumulated: 0.01,
          purchases_remaining: 5,
        }),
      );

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
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockResolvedValue(
        createMockCycleState({
          btc_accumulated: 0.01,
          purchases_remaining: 5,
        }),
      );

      await pauseMechanism.pauseOnError(new Error("Test pause"), {});
    });

    it("should successfully resume when validation passes", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockResolvedValue(
        createMockCycleState({
          status: "PAUSED",
          btc_accumulated: 0.01,
          purchases_remaining: 5,
        }),
      );

      jest
        .spyOn(mockCycleStateManager, "validateState")
        .mockResolvedValue(true);

      const result = await pauseMechanism.resumeStrategy(false);

      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalled();
    });

    it("should fail to resume when state validation fails", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockResolvedValue(
        createMockCycleState({
          status: "PAUSED",
          capital_available: -100, // Invalid negative value
          btc_accumulated: 0.01,
          purchases_remaining: 5,
        }),
      );

      jest
        .spyOn(mockCycleStateManager, "validateState")
        .mockResolvedValue(false);

      const result = await pauseMechanism.resumeStrategy(false);

      expect(result).toBe(false);
      expect(pauseMechanism.isPausedStatus()).toBe(true);
      expect(mockDiscordNotifier.sendResumeFailedAlert).toHaveBeenCalled();
    });

    it("should allow force resume bypassing validation", async () => {
      jest.spyOn(mockCycleStateManager, "getCurrentState").mockResolvedValue(
        createMockCycleState({
          status: "PAUSED",
          btc_accumulated: 0.01,
          purchases_remaining: 5,
        }),
      );

      jest
        .spyOn(mockCycleStateManager, "validateState")
        .mockResolvedValue(false);

      const result = await pauseMechanism.resumeStrategy(true); // Force resume

      expect(result).toBe(true);
      expect(pauseMechanism.isPausedStatus()).toBe(false);
      expect(mockDiscordNotifier.sendResumeSuccessAlert).toHaveBeenCalledWith(
        true,
      );
    });
  });

  describe("State Management", () => {
    it("should return null metadata when not paused", () => {
      expect(pauseMechanism.getPauseMetadata()).toBeNull();
    });
  });
});
