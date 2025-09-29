import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { StartupValidator } from "../../src/app/startup-validator";
import { DiscordNotifier } from "../../src/notifications/discord-notifier";
import { BalanceManager } from "../../src/exchange/balance-manager";
import { CycleStateManager } from "../../src/cycle/cycle-state-manager";
import { StrategyConfigLoader } from "../../src/config/strategy-config-loader";
import { BinanceClient } from "../../src/exchange/binance-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import { Decimal } from "decimal.js";
import { MockTradingRules } from "../mocks/mock-trading-rules";
import type { TradingRules } from "../../src/exchange/trading-rules";

// Only mock external dependencies
jest.mock("../../src/exchange/binance-client");
jest.mock("@supabase/supabase-js");

describe("StartupValidator", () => {
  let validator: StartupValidator;
  let mockBinanceClient: jest.Mocked<BinanceClient>;
  let mockSupabaseClient: SupabaseClient<Database>;
  let discordNotifier: DiscordNotifier;
  let balanceManager: BalanceManager;
  let cycleStateManager: CycleStateManager;
  let strategyConfigLoader: StrategyConfigLoader;

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

    // Create mock Binance client
    mockBinanceClient = {
      ping: jest.fn(() => Promise.resolve(true)),
      getAccountStatus: jest.fn(() =>
        Promise.resolve({
          canTrade: true,
          canWithdraw: false,
          canDeposit: false,
        }),
      ),
      getAllOrders: jest.fn(() => Promise.resolve([])),
      getOpenOrders: jest.fn(() => Promise.resolve([])),
      getExchangeInfo: jest.fn(() => Promise.resolve({ symbols: [] })),
    } as unknown as jest.Mocked<BinanceClient>;

    // Create mock Supabase client
    mockSupabaseClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve({ error: null })),
          eq: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({
                data: {
                  id: "test-config",
                  timeframe: "5m",
                  drop_percentage: 3,
                  rise_percentage: 3,
                  max_purchases: 10,
                  min_buy_usdt: 10,
                  initial_capital_usdt: 1000,
                  slippage_buy_pct: 0.003,
                  slippage_sell_pct: 0.003,
                  is_active: true,
                  updated_at: new Date().toISOString(),
                },
                error: null,
              }),
            ),
          })),
        })),
      })),
    } as unknown as SupabaseClient<Database>;

    // Create real instances with mocked dependencies
    discordNotifier = new DiscordNotifier({
      webhookUrl:
        process.env.DISCORD_WEBHOOK_URL ||
        "https://discord.com/api/webhooks/test",
    });
    // Spy on sendAlert method
    jest.spyOn(discordNotifier, "sendAlert").mockResolvedValue(undefined);

    balanceManager = new BalanceManager(mockBinanceClient as never);
    const mockTradingRules = new MockTradingRules() as unknown as TradingRules;
    cycleStateManager = new CycleStateManager(
      mockSupabaseClient as never,
      {
        initialCapitalUSDT: 1000,
        maxPurchases: 10,
        minBuyUSDT: 10,
      },
      mockTradingRules,
    );
    strategyConfigLoader = new StrategyConfigLoader();

    // Mock the loadConfig method by default to return a valid config
    jest.spyOn(strategyConfigLoader, "loadConfig").mockResolvedValue({
      id: "test-config",
      timeframe: "5m",
      dropPercentage: 0.03,
      risePercentage: 0.03,
      maxPurchases: 10,
      minBuyUsdt: 10,
      initialCapitalUsdt: 1000,
      slippageBuyPct: 0.003,
      slippageSellPct: 0.003,
      athWindow: 20,
      isActive: true,
      updatedAt: new Date().toISOString(),
    });

    validator = new StartupValidator({
      binanceClient: mockBinanceClient as never,
      supabaseClient: mockSupabaseClient as never,
      discordNotifier,
      balanceManager,
      cycleStateManager,
      strategyConfigLoader,
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
        (mockSupabaseClient.from as jest.Mock).mockReturnValue({
          select: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ error: null } as never),
          }),
        });

        const result = await validator.validateConfiguration();

        expect(result.success).toBe(true);
        expect(mockSupabaseClient.from).toHaveBeenCalledWith("cycle_state");
      });

      it("should fail when Supabase credentials are invalid", async () => {
        (mockSupabaseClient.from as jest.Mock).mockReturnValue({
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
        (strategyConfigLoader.loadConfig as jest.Mock).mockResolvedValue({
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
        expect(strategyConfigLoader.loadConfig).toHaveBeenCalled();
      });

      it("should fail when no strategy config exists", async () => {
        (strategyConfigLoader.loadConfig as jest.Mock).mockResolvedValue(
          null as never,
        );

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
        (strategyConfigLoader.loadConfig as jest.Mock).mockResolvedValue({
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
        (strategyConfigLoader.loadConfig as jest.Mock).mockResolvedValue({
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
      jest
        .spyOn(balanceManager, "getBalance")
        .mockImplementation((asset: string) => {
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

      jest
        .spyOn(cycleStateManager, "getCurrentState")
        .mockResolvedValue(null as never);
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
      jest
        .spyOn(balanceManager, "getBalance")
        .mockImplementation((asset: string) => {
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
      jest
        .spyOn(balanceManager, "getBalance")
        .mockImplementation((asset: string) => {
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
      jest.spyOn(cycleStateManager, "getCurrentState").mockResolvedValue({
        id: "test-id",
        status: "READY",
        ath_price: 50000,
        reference_price: 50000,
        btc_accumulated: 0,
        btc_accum_net: 0,
        btc_dust: 0,
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
      jest
        .spyOn(balanceManager, "getBalance")
        .mockImplementation((asset: string) => {
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

      jest.spyOn(cycleStateManager, "getCurrentState").mockResolvedValue({
        id: "test-id",
        status: "HOLDING",
        ath_price: 50000,
        reference_price: 50000,
        btc_accumulated: 1.0, // Expected 1.0 but have 0.5
        btc_accum_net: 1.0,
        btc_dust: 0,
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
      (mockSupabaseClient.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ error: null } as never),
        }),
      });

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
      (mockSupabaseClient.from as jest.Mock).mockReturnValue({
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
      jest.spyOn(discordNotifier, "isWebhookHealthy").mockReturnValue(false);

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(true); // Discord is not critical
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "DISCORD_WEBHOOK_UNHEALTHY",
          message: expect.stringContaining("Discord webhook may be unhealthy"),
        }),
      );
    });

    it("should skip Discord test when not configured", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;

      const result = await validator.validateConnectivity();

      expect(result.success).toBe(true);
      expect(discordNotifier.sendAlert).not.toHaveBeenCalled();
    });
  });

  describe("Full Validation", () => {
    beforeEach(() => {
      // Setup all mocks for successful validation
      (mockSupabaseClient.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ error: null } as never),
        }),
      });
      jest
        .spyOn(balanceManager, "getBalance")
        .mockImplementation((asset: string) => {
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
      jest
        .spyOn(cycleStateManager, "getCurrentState")
        .mockResolvedValue(null as never);
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
      expect(balanceManager.getBalance).not.toHaveBeenCalled();
    });

    it("should fail fast on critical connectivity errors", async () => {
      // Make ping succeed once for configuration validation, then fail for connectivity
      mockBinanceClient.ping
        .mockResolvedValueOnce(true) // Success for configuration validation
        .mockRejectedValue(new Error("Connection failed")); // Fail for connectivity validation

      const report = await validator.validate();

      expect(report.overallSuccess).toBe(false);
      expect(report.connectivity.success).toBe(false);
      // Should have run configuration but not balance (fail-fast after connectivity)
      expect(strategyConfigLoader.loadConfig).toHaveBeenCalled();
      expect(balanceManager.getBalance).not.toHaveBeenCalled();
      // Verify Binance was called 1 time in config + 3 retries in connectivity = 4 total
      expect(mockBinanceClient.ping).toHaveBeenCalledTimes(4);
    });

    it("should continue on warnings", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;

      // Add BTC balance to trigger warning
      jest
        .spyOn(balanceManager, "getBalance")
        .mockImplementation((asset: string) => {
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
