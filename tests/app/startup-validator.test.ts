import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { StartupValidator } from "../../src/app/startup-validator";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Decimal } from "decimal.js";
import type { Database } from "../../types/supabase";

jest.mock("../../src/exchange/binance-client");
jest.mock("@supabase/supabase-js");
jest.mock("../../src/notifications/discord-notifier");
jest.mock("../../src/exchange/balance-manager");
jest.mock("../../src/cycle/cycle-state-manager");
jest.mock("../../src/config/strategy-config-loader");
jest.mock("../../src/utils/logger");

describe("StartupValidator", () => {
  let validator: StartupValidator;
  let mockBinanceClient: { ping: ReturnType<typeof jest.fn> };
  let mockSupabaseClient: {
    from: ReturnType<typeof jest.fn>;
  };
  let mockDiscordNotifier: { sendAlert: ReturnType<typeof jest.fn> };
  let mockBalanceManager: { getBalance: ReturnType<typeof jest.fn> };
  let mockCycleStateManager: { getCurrentState: ReturnType<typeof jest.fn> };
  let mockStrategyConfigLoader: { loadConfig: ReturnType<typeof jest.fn> };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    process.env = {
      ...process.env,
      BINANCE_API_KEY: "test-api-key",
      BINANCE_API_SECRET: "test-api-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-supabase-key",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test",
      INITIAL_CAPITAL_USDT: "1000",
    };

    // Create mocks
    mockBinanceClient = {
      ping: jest.fn().mockResolvedValue(true as never),
    };

    mockSupabaseClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ error: null } as never),
        }),
      }),
    };

    mockDiscordNotifier = {
      sendAlert: jest.fn().mockResolvedValue(undefined as never),
    };

    mockBalanceManager = {
      getBalance: jest.fn(),
    };

    mockCycleStateManager = {
      getCurrentState: jest.fn(),
    };

    mockStrategyConfigLoader = {
      loadConfig: jest.fn().mockResolvedValue({
        id: "test-config",
        timeframe: "5m",
        dropPercentage: 3,
        risePercentage: 3,
        maxPurchases: 10,
        minBuyUsdt: 10,
        initialCapitalUsdt: 1000,
        slippageBuyPct: 0.003,
        slippageSellPct: 0.003,
        isActive: true,
        updatedAt: new Date().toISOString(),
      } as never),
    };

    validator = new StartupValidator({
      binanceClient: mockBinanceClient as never,
      supabaseClient: mockSupabaseClient as never,
      discordNotifier: mockDiscordNotifier as never,
      balanceManager: mockBalanceManager as never,
      cycleStateManager: mockCycleStateManager as never,
      strategyConfigLoader: mockStrategyConfigLoader as never,
    });
  });

  describe("Configuration Validation", () => {
    describe("Environment Variables", () => {
      it("should pass when all required environment variables are set", async () => {
        const result = await validator.validateConfiguration();

        expect(result.success).toBe(true);
        expect(result.errors).toHaveLength(0);
        // Should have warning about discord webhook being optional
        expect(result.warnings).toHaveLength(0);
      });

      it("should fail when BINANCE_API_KEY is missing", async () => {
        delete process.env.BINANCE_API_KEY;

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "MISSING_ENV_VAR",
            message: "Missing required environment variable: BINANCE_API_KEY",
          }),
        );
      });

      it("should fail when BINANCE_API_SECRET is missing", async () => {
        delete process.env.BINANCE_API_SECRET;

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "MISSING_ENV_VAR",
            message:
              "Missing required environment variable: BINANCE_API_SECRET",
          }),
        );
      });

      it("should fail when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "MISSING_ENV_VAR",
            message:
              "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL",
          }),
        );
      });

      it("should fail when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "MISSING_ENV_VAR",
            message:
              "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY",
          }),
        );
      });

      it("should fail when INITIAL_CAPITAL_USDT is missing", async () => {
        delete process.env.INITIAL_CAPITAL_USDT;

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "MISSING_ENV_VAR",
            message:
              "Missing required environment variable: INITIAL_CAPITAL_USDT",
          }),
        );
      });

      it("should warn when DISCORD_WEBHOOK_URL is missing", async () => {
        delete process.env.DISCORD_WEBHOOK_URL;

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(true);
        expect(result.warnings).toContainEqual(
          expect.objectContaining({
            code: "MISSING_DISCORD_WEBHOOK",
            message:
              "Discord webhook not configured - notifications will be disabled",
          }),
        );
      });

      it("should fail when INITIAL_CAPITAL_USDT is not a valid number", async () => {
        process.env.INITIAL_CAPITAL_USDT = "invalid";

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_INITIAL_CAPITAL",
            message: "Invalid INITIAL_CAPITAL_USDT value: invalid",
          }),
        );
      });

      it("should fail when INITIAL_CAPITAL_USDT is negative", async () => {
        process.env.INITIAL_CAPITAL_USDT = "-100";

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_INITIAL_CAPITAL",
            message: "Invalid INITIAL_CAPITAL_USDT value: -100",
          }),
        );
      });
    });

    describe("API Credentials", () => {
      it("should validate Binance API credentials", async () => {
        mockBinanceClient.ping.mockResolvedValue(true);

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(true);
        expect(mockBinanceClient.ping).toHaveBeenCalled();
      });

      it("should fail when Binance API credentials are invalid", async () => {
        mockBinanceClient.ping.mockRejectedValue(new Error("Invalid API key"));

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_BINANCE_CREDENTIALS",
            message: expect.stringContaining("Invalid Binance API credentials"),
          }),
        );
      });

      it("should validate Supabase credentials", async () => {
        mockSupabaseClient.from.mockReturnValue({
          select: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ error: null } as never),
          }),
        });

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(true);
        expect(mockSupabaseClient.from).toHaveBeenCalledWith("cycle_state");
      });

      it("should fail when Supabase credentials are invalid", async () => {
        mockSupabaseClient.from.mockReturnValue({
          select: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              error: { message: "Invalid API key" },
            } as never),
          }),
        });

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_SUPABASE_CREDENTIALS",
            message: expect.stringContaining("Invalid Supabase credentials"),
          }),
        );
      });
    });

    describe("Strategy Configuration", () => {
      it("should validate strategy configuration", async () => {
        mockStrategyConfigLoader.loadConfig.mockResolvedValue({
          id: "test-config",
          timeframe: "5m",
          dropPercentage: 3,
          risePercentage: 3,
          maxPurchases: 10,
          minBuyUsdt: 10,
          initialCapitalUsdt: 1000,
          slippageBuyPct: 0.003,
          slippageSellPct: 0.003,
          isActive: true,
          updatedAt: new Date().toISOString(),
        } as never);

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(true);
        expect(mockStrategyConfigLoader.loadConfig).toHaveBeenCalled();
      });

      it("should fail when no strategy config exists", async () => {
        mockStrategyConfigLoader.loadConfig.mockResolvedValue(null as never);

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "NO_STRATEGY_CONFIG",
            message: "No active strategy configuration found",
          }),
        );
      });

      it("should fail when drop_percentage is invalid", async () => {
        mockStrategyConfigLoader.loadConfig.mockResolvedValue({
          id: "test-config",
          timeframe: "5m",
          dropPercentage: 0, // Invalid - must be > 0
          risePercentage: 3,
          maxPurchases: 10,
          minBuyUsdt: 10,
          initialCapitalUsdt: 1000,
          slippageBuyPct: 0.003,
          slippageSellPct: 0.003,
          isActive: true,
          updatedAt: new Date().toISOString(),
        } as never);

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_DROP_PERCENTAGE",
            message: expect.stringContaining("Invalid drop_percentage"),
          }),
        );
      });

      it("should fail when rise_percentage is invalid", async () => {
        mockStrategyConfigLoader.loadConfig.mockResolvedValue({
          id: "test-config",
          timeframe: "5m",
          dropPercentage: 3,
          risePercentage: -1, // Invalid - must be > 0
          maxPurchases: 10,
          minBuyUsdt: 10,
          initialCapitalUsdt: 1000,
          slippageBuyPct: 0.003,
          slippageSellPct: 0.003,
          isActive: true,
          updatedAt: new Date().toISOString(),
        } as never);

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_RISE_PERCENTAGE",
            message: expect.stringContaining("Invalid rise_percentage"),
          }),
        );
      });
    });
  });

  describe("Balance Validation", () => {
    beforeEach(() => {
      mockBalanceManager.getBalance.mockImplementation((asset: string) => {
        if (asset === "USDT") {
          return Promise.resolve({
            asset: "USDT",
            free: new Decimal(1500),
            locked: new Decimal(0),
            total: new Decimal(1500),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        if (asset === "BTC") {
          return Promise.resolve({
            asset: "BTC",
            free: new Decimal(0),
            locked: new Decimal(0),
            total: new Decimal(0),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        throw new Error(`Unknown asset: ${asset}`);
      });

      mockCycleStateManager.getCurrentState.mockResolvedValue(null as never);
    });

    it("should pass when USDT balance is sufficient", async () => {
      process.env.INITIAL_CAPITAL_USDT = "1000";

      const result = await validator.validateBalances();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when USDT balance is insufficient", async () => {
      process.env.INITIAL_CAPITAL_USDT = "2000";

      const result = await validator.validateBalances();

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "INSUFFICIENT_USDT",
          message: expect.stringContaining("Insufficient USDT balance"),
        }),
      );
    });

    it("should warn when BTC balance exists", async () => {
      mockBalanceManager.getBalance.mockImplementation((asset: string) => {
        if (asset === "USDT") {
          return Promise.resolve({
            asset: "USDT",
            free: new Decimal(1500),
            locked: new Decimal(0),
            total: new Decimal(1500),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        if (asset === "BTC") {
          return Promise.resolve({
            asset: "BTC",
            free: new Decimal(0.5),
            locked: new Decimal(0),
            total: new Decimal(0.5),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        throw new Error(`Unknown asset: ${asset}`);
      });

      const result = await validator.validateBalances();

      expect(result.success).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "EXISTING_BTC_BALANCE",
          message: expect.stringContaining("Existing BTC balance detected"),
        }),
      );
    });

    it("should not warn for dust BTC amounts", async () => {
      mockBalanceManager.getBalance.mockImplementation((asset: string) => {
        if (asset === "USDT") {
          return Promise.resolve({
            asset: "USDT",
            free: new Decimal(1500),
            locked: new Decimal(0),
            total: new Decimal(1500),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        if (asset === "BTC") {
          return Promise.resolve({
            asset: "BTC",
            free: new Decimal(0.000001),
            locked: new Decimal(0),
            total: new Decimal(0.000001),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        throw new Error(`Unknown asset: ${asset}`);
      });

      const result = await validator.validateBalances();

      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should detect USDT drift from last state", async () => {
      mockCycleStateManager.getCurrentState.mockResolvedValue({
        id: "test-id",
        status: "READY",
        ath_price: 50000,
        reference_price: 50000,
        btc_accumulated: 0,
        btc_accum_net: 0,
        capital_available: 1000, // Expected 1000 but have 1500
        cost_accum_usdt: 0,
        purchases_remaining: 10,
        buy_amount: 100,
        updated_at: new Date().toISOString(),
      } as never);

      const result = await validator.validateBalances();

      expect(result.success).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "USDT_DRIFT_DETECTED",
          message: expect.stringContaining("USDT balance drift detected"),
        }),
      );
    });

    it("should detect BTC drift from last state", async () => {
      mockBalanceManager.getBalance.mockImplementation((asset: string) => {
        if (asset === "USDT") {
          return Promise.resolve({
            asset: "USDT",
            free: new Decimal(1500),
            locked: new Decimal(0),
            total: new Decimal(1500),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        if (asset === "BTC") {
          return Promise.resolve({
            asset: "BTC",
            free: new Decimal(0.5),
            locked: new Decimal(0),
            total: new Decimal(0.5),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        throw new Error(`Unknown asset: ${asset}`);
      });

      mockCycleStateManager.getCurrentState.mockResolvedValue({
        id: "test-id",
        status: "HOLDING",
        ath_price: 50000,
        reference_price: 50000,
        btc_accumulated: 1.0, // Expected 1.0 but have 0.5
        btc_accum_net: 1.0,
        capital_available: 1500,
        cost_accum_usdt: 50000,
        purchases_remaining: 0,
        buy_amount: 100,
        updated_at: new Date().toISOString(),
      } as never);

      const result = await validator.validateBalances();

      expect(result.success).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "BTC_DRIFT_DETECTED",
          message: expect.stringContaining("BTC balance drift detected"),
        }),
      );
    });
  });

  describe("Connectivity Validation", () => {
    it("should pass when all services are connected", async () => {
      mockBinanceClient.ping.mockResolvedValue(true);
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ error: null }),
        }),
      });
      mockDiscordNotifier.sendAlert.mockResolvedValue(undefined);

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should retry Binance connection on failure", async () => {
      let callCount = 0;
      mockBinanceClient.ping.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error("Connection timeout"));
        }
        return Promise.resolve(true);
      });

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(true);
      expect(mockBinanceClient.ping).toHaveBeenCalledTimes(3);
    });

    it("should fail after max retries for Binance", async () => {
      mockBinanceClient.ping.mockRejectedValue(new Error("Connection failed"));

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "BINANCE_CONNECTION_FAILED",
          message: expect.stringContaining(
            "Failed to connect to Binance API after 3 retries",
          ),
        }),
      );
      expect(mockBinanceClient.ping).toHaveBeenCalledTimes(3);
    });

    it("should fail when Supabase connection fails", async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({
            error: { message: "Connection timeout" },
          } as never),
        }),
      });

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "SUPABASE_CONNECTION_FAILED",
          message: expect.stringContaining("Failed to connect to Supabase"),
        }),
      );
    });

    it("should warn when Discord webhook fails", async () => {
      mockDiscordNotifier.sendAlert.mockRejectedValue(
        new Error("Webhook failed"),
      );

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(true); // Discord is not critical
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "DISCORD_CONNECTION_FAILED",
          message: expect.stringContaining(
            "Failed to connect to Discord webhook",
          ),
        }),
      );
    });

    it("should skip Discord test when not configured", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(true);
      expect(mockDiscordNotifier.sendAlert).not.toHaveBeenCalled();
    });
  });

  describe("Full Validation", () => {
    beforeEach(() => {
      // Setup all mocks for successful validation
      mockBinanceClient.ping.mockResolvedValue(true);
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ error: null }),
        }),
      });
      mockDiscordNotifier.sendAlert.mockResolvedValue(undefined);
      mockBalanceManager.getBalance.mockImplementation((asset: string) => {
        if (asset === "USDT") {
          return Promise.resolve({
            asset: "USDT",
            free: new Decimal(1500),
            locked: new Decimal(0),
            total: new Decimal(1500),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        if (asset === "BTC") {
          return Promise.resolve({
            asset: "BTC",
            free: new Decimal(0),
            locked: new Decimal(0),
            total: new Decimal(0),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        throw new Error(`Unknown asset: ${asset}`);
      });
      mockCycleStateManager.getCurrentState.mockResolvedValue(null as never);
    });

    it("should run all validations in sequence", async () => {
      const report = await validator.validate();

      expect(report.overallSuccess).toBe(true);
      expect(report.configuration.success).toBe(true);
      expect(report.balance.success).toBe(true);
      expect(report.connectivity.success).toBe(true);
      expect(report.summary.totalErrors).toBe(0);
    });

    it("should fail fast on critical configuration errors", async () => {
      delete process.env.BINANCE_API_KEY;

      const report = await validator.validate();

      expect(report.overallSuccess).toBe(false);
      expect(report.configuration.success).toBe(false);
      // Should not have run balance or connectivity checks
      expect(mockBalanceManager.getBalance).not.toHaveBeenCalled();
    });

    it("should fail fast on critical connectivity errors", async () => {
      mockBinanceClient.ping.mockRejectedValue(new Error("Connection failed"));

      const report = await validator.validate();

      expect(report.overallSuccess).toBe(false);
      expect(report.connectivity.success).toBe(false);
      // Should have run configuration but not balance
      expect(mockStrategyConfigLoader.loadConfig).toHaveBeenCalled();
      expect(mockBalanceManager.getBalance).not.toHaveBeenCalled();
    });

    it("should continue on warnings", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;

      // Add BTC balance to trigger warning
      mockBalanceManager.getBalance.mockImplementation((asset: string) => {
        if (asset === "USDT") {
          return Promise.resolve({
            asset: "USDT",
            free: new Decimal(1500),
            locked: new Decimal(0),
            total: new Decimal(1500),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        if (asset === "BTC") {
          return Promise.resolve({
            asset: "BTC",
            free: new Decimal(0.1),
            locked: new Decimal(0),
            total: new Decimal(0.1),
            lastUpdated: new Date(),
            fromCache: false,
          });
        }
        throw new Error(`Unknown asset: ${asset}`);
      });

      const report = await validator.validate();

      expect(report.overallSuccess).toBe(true);
      expect(report.summary.totalWarnings).toBeGreaterThan(0);
      expect(report.summary.totalErrors).toBe(0);
    });

    it("should generate comprehensive report", async () => {
      const report = await validator.validate();

      expect(report).toHaveProperty("timestamp");
      expect(report).toHaveProperty("overallSuccess");
      expect(report).toHaveProperty("configuration");
      expect(report).toHaveProperty("balance");
      expect(report).toHaveProperty("connectivity");
      expect(report).toHaveProperty("summary");
      expect(report.summary).toHaveProperty("totalErrors");
      expect(report.summary).toHaveProperty("totalWarnings");
      expect(report.summary).toHaveProperty("criticalErrors");
    });

    it("should format report for display", async () => {
      const report = await validator.validate();
      const formatted = validator.formatReport(report);

      expect(formatted).toContain("STARTUP VALIDATION REPORT");
      expect(formatted).toContain("Overall Status:");
      expect(formatted).toContain("CONFIGURATION VALIDATION");
      expect(formatted).toContain("BALANCE VALIDATION");
      expect(formatted).toContain("CONNECTIVITY VALIDATION");
    });
  });
});
