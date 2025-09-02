import { StartupValidator } from "../../src/app/startup-validator";
import { BinanceService } from "../../src/services/binance-service";
import { SupabaseService } from "../../src/services/supabase-service";
import { DiscordNotifier } from "../../src/services/discord-notifier";
import { Logger } from "../../src/utils/logger";
import { ValidationReport, ValidationResult } from "../../src/types/validation";

jest.mock("../../src/services/binance-service");
jest.mock("../../src/services/supabase-service");
jest.mock("../../src/services/discord-notifier");
jest.mock("../../src/utils/logger");

describe("StartupValidator", () => {
  let validator: StartupValidator;
  let mockBinanceService: jest.Mocked<BinanceService>;
  let mockSupabaseService: jest.Mocked<SupabaseService>;
  let mockDiscordNotifier: jest.Mocked<DiscordNotifier>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    process.env = {
      ...process.env,
      BINANCE_API_KEY: "test-api-key",
      BINANCE_API_SECRET: "test-api-secret",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_KEY: "test-supabase-key",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test",
      INITIAL_CAPITAL_USDT: "1000",
      STRATEGY_CONFIG: JSON.stringify({
        leverage: 2,
        allocation_percentage: 50,
        stop_loss_percentage: 5,
        take_profit_percentage: 10,
      }),
    };

    // Create mock logger with proper typing
    const MockLogger = Logger as jest.MockedClass<typeof Logger>;
    mockLogger = new MockLogger() as jest.Mocked<Logger>;
    mockLogger.info = jest.fn();
    mockLogger.error = jest.fn();
    mockLogger.warn = jest.fn();
    mockLogger.debug = jest.fn();

    // Create mock services with proper typing
    const MockBinanceService = BinanceService as jest.MockedClass<
      typeof BinanceService
    >;
    mockBinanceService =
      new MockBinanceService() as jest.Mocked<BinanceService>;
    mockBinanceService.testConnection = jest.fn();
    mockBinanceService.getBalance = jest.fn();

    const MockSupabaseService = SupabaseService as jest.MockedClass<
      typeof SupabaseService
    >;
    mockSupabaseService =
      new MockSupabaseService() as jest.Mocked<SupabaseService>;
    mockSupabaseService.testConnection = jest.fn();
    mockSupabaseService.getLastExecutionState = jest.fn();

    const MockDiscordNotifier = DiscordNotifier as jest.MockedClass<
      typeof DiscordNotifier
    >;
    mockDiscordNotifier =
      new MockDiscordNotifier() as jest.Mocked<DiscordNotifier>;
    mockDiscordNotifier.testConnection = jest.fn();

    validator = new StartupValidator(
      mockBinanceService,
      mockSupabaseService,
      mockDiscordNotifier,
      mockLogger,
    );
  });

  describe("Configuration Validation", () => {
    describe("Environment Variables", () => {
      it("should pass when all required environment variables are set", async () => {
        const result = await validator.validateConfiguration();

        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it("should fail when BINANCE_API_KEY is missing", async () => {
        delete process.env.BINANCE_API_KEY;

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Missing required environment variable: BINANCE_API_KEY",
          severity: "critical",
        });
      });

      it("should fail when BINANCE_API_SECRET is missing", async () => {
        delete process.env.BINANCE_API_SECRET;

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Missing required environment variable: BINANCE_API_SECRET",
          severity: "critical",
        });
      });

      it("should fail when SUPABASE_URL is missing", async () => {
        delete process.env.SUPABASE_URL;

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Missing required environment variable: SUPABASE_URL",
          severity: "critical",
        });
      });

      it("should fail when SUPABASE_KEY is missing", async () => {
        delete process.env.SUPABASE_KEY;

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Missing required environment variable: SUPABASE_KEY",
          severity: "critical",
        });
      });

      it("should fail when INITIAL_CAPITAL_USDT is missing", async () => {
        delete process.env.INITIAL_CAPITAL_USDT;

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message:
            "Missing required environment variable: INITIAL_CAPITAL_USDT",
          severity: "critical",
        });
      });

      it("should warn when DISCORD_WEBHOOK_URL is missing", async () => {
        delete process.env.DISCORD_WEBHOOK_URL;

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("warning");
        expect(result.warnings).toContainEqual({
          category: "configuration",
          message:
            "Discord webhook URL not configured - notifications will be disabled",
          severity: "warning",
        });
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("API Credentials Validation", () => {
      it("should validate Binance API credentials successfully", async () => {
        mockBinanceService.testConnection.mockResolvedValue(true);

        const result = await validator.validateConfiguration();

        expect(mockBinanceService.testConnection).toHaveBeenCalled();
        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
      });

      it("should fail when Binance API credentials are invalid", async () => {
        mockBinanceService.testConnection.mockRejectedValue(
          new Error("Invalid API key"),
        );

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Invalid Binance API credentials: Invalid API key",
          severity: "critical",
        });
      });

      it("should fail when Supabase credentials are invalid", async () => {
        mockSupabaseService.testConnection.mockRejectedValue(
          new Error("Invalid Supabase key"),
        );

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Invalid Supabase credentials: Invalid Supabase key",
          severity: "critical",
        });
      });
    });

    describe("Strategy Configuration Validation", () => {
      it("should validate strategy configuration successfully", async () => {
        const result = await validator.validateConfiguration();

        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
      });

      it("should fail when STRATEGY_CONFIG is not valid JSON", async () => {
        process.env.STRATEGY_CONFIG = "invalid json";

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: expect.stringContaining("Invalid STRATEGY_CONFIG JSON"),
          severity: "critical",
        });
      });

      it("should fail when leverage is missing from strategy config", async () => {
        process.env.STRATEGY_CONFIG = JSON.stringify({
          allocation_percentage: 50,
          stop_loss_percentage: 5,
          take_profit_percentage: 10,
        });

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Missing required strategy configuration: leverage",
          severity: "critical",
        });
      });

      it("should fail when leverage is invalid (less than 1)", async () => {
        process.env.STRATEGY_CONFIG = JSON.stringify({
          leverage: 0.5,
          allocation_percentage: 50,
          stop_loss_percentage: 5,
          take_profit_percentage: 10,
        });

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Invalid leverage: must be between 1 and 125",
          severity: "critical",
        });
      });

      it("should fail when leverage is invalid (greater than 125)", async () => {
        process.env.STRATEGY_CONFIG = JSON.stringify({
          leverage: 150,
          allocation_percentage: 50,
          stop_loss_percentage: 5,
          take_profit_percentage: 10,
        });

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Invalid leverage: must be between 1 and 125",
          severity: "critical",
        });
      });

      it("should fail when allocation_percentage is invalid", async () => {
        process.env.STRATEGY_CONFIG = JSON.stringify({
          leverage: 2,
          allocation_percentage: 150,
          stop_loss_percentage: 5,
          take_profit_percentage: 10,
        });

        const result = await validator.validateConfiguration();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "configuration",
          message: "Invalid allocation_percentage: must be between 0 and 100",
          severity: "critical",
        });
      });
    });
  });

  describe("Balance Validation", () => {
    describe("USDT Balance", () => {
      it("should pass when USDT balance equals initial capital", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1000,
          BTC: 0,
        });

        const result = await validator.validateBalances();

        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it("should pass when USDT balance exceeds initial capital", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1500,
          BTC: 0,
        });

        const result = await validator.validateBalances();

        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it("should fail when USDT balance is less than initial capital", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 500,
          BTC: 0,
        });

        const result = await validator.validateBalances();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "balance",
          message: "Insufficient USDT balance: 500 USDT (required: 1000 USDT)",
          severity: "critical",
        });
      });

      it("should handle balance check failures gracefully", async () => {
        mockBinanceService.getBalance.mockRejectedValue(
          new Error("Network error"),
        );

        const result = await validator.validateBalances();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "balance",
          message: "Failed to check account balances: Network error",
          severity: "critical",
        });
      });
    });

    describe("BTC Balance", () => {
      it("should warn when BTC balance exists", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1000,
          BTC: 0.5,
        });

        const result = await validator.validateBalances();

        expect(result.status).toBe("warning");
        expect(result.warnings).toContainEqual({
          category: "balance",
          message:
            "Existing BTC balance detected: 0.5 BTC. Bot will manage this position.",
          severity: "warning",
        });
        expect(result.errors).toHaveLength(0);
      });

      it("should not warn when BTC balance is zero", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1000,
          BTC: 0,
        });

        const result = await validator.validateBalances();

        expect(result.status).toBe("success");
        expect(result.warnings).toHaveLength(0);
      });
    });

    describe("State Drift Detection", () => {
      it("should pass when no previous state exists", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1000,
          BTC: 0,
        });
        mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

        const result = await validator.validateBalances();

        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it("should pass when current state matches last saved state", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1000,
          BTC: 0.5,
        });
        mockSupabaseService.getLastExecutionState.mockResolvedValue({
          usdt_balance: 1000,
          btc_balance: 0.5,
          timestamp: new Date().toISOString(),
        });

        const result = await validator.validateBalances();

        expect(result.status).toBe("warning"); // Warning for BTC balance, but no drift error
        expect(result.errors).toHaveLength(0);
      });

      it("should warn when USDT balance has drifted from last state", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1200,
          BTC: 0.5,
        });
        mockSupabaseService.getLastExecutionState.mockResolvedValue({
          usdt_balance: 1000,
          btc_balance: 0.5,
          timestamp: new Date().toISOString(),
        });

        const result = await validator.validateBalances();

        expect(result.warnings).toContainEqual({
          category: "balance",
          message:
            "USDT balance drift detected: expected 1000 USDT, found 1200 USDT",
          severity: "warning",
        });
      });

      it("should warn when BTC balance has drifted from last state", async () => {
        mockBinanceService.getBalance.mockResolvedValue({
          USDT: 1000,
          BTC: 0.3,
        });
        mockSupabaseService.getLastExecutionState.mockResolvedValue({
          usdt_balance: 1000,
          btc_balance: 0.5,
          timestamp: new Date().toISOString(),
        });

        const result = await validator.validateBalances();

        expect(result.warnings).toContainEqual({
          category: "balance",
          message:
            "BTC balance drift detected: expected 0.5 BTC, found 0.3 BTC",
          severity: "warning",
        });
      });
    });
  });

  describe("Connectivity Validation", () => {
    describe("Binance API Connectivity", () => {
      it("should pass when Binance API is reachable", async () => {
        mockBinanceService.testConnection.mockResolvedValue(true);

        const result = await validator.validateConnectivity();

        expect(mockBinanceService.testConnection).toHaveBeenCalled();
        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
      });

      it("should fail when Binance API is unreachable", async () => {
        mockBinanceService.testConnection.mockRejectedValue(
          new Error("Connection timeout"),
        );

        const result = await validator.validateConnectivity();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "connectivity",
          message: "Failed to connect to Binance API: Connection timeout",
          severity: "critical",
        });
      });

      it("should retry connection on temporary failures", async () => {
        mockBinanceService.testConnection
          .mockRejectedValueOnce(new Error("Temporary failure"))
          .mockResolvedValueOnce(true);

        const result = await validator.validateConnectivity();

        expect(mockBinanceService.testConnection).toHaveBeenCalledTimes(2);
        expect(result.status).toBe("success");
      });

      it("should fail after max retries", async () => {
        mockBinanceService.testConnection.mockRejectedValue(
          new Error("Persistent failure"),
        );

        const result = await validator.validateConnectivity();

        expect(mockBinanceService.testConnection).toHaveBeenCalledTimes(3); // Initial + 2 retries
        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "connectivity",
          message: "Failed to connect to Binance API: Persistent failure",
          severity: "critical",
        });
      });
    });

    describe("Supabase Connectivity", () => {
      it("should pass when Supabase is reachable", async () => {
        mockSupabaseService.testConnection.mockResolvedValue(true);

        const result = await validator.validateConnectivity();

        expect(mockSupabaseService.testConnection).toHaveBeenCalled();
        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
      });

      it("should fail when Supabase is unreachable", async () => {
        mockBinanceService.testConnection.mockResolvedValue(true);
        mockSupabaseService.testConnection.mockRejectedValue(
          new Error("Database unreachable"),
        );

        const result = await validator.validateConnectivity();

        expect(result.status).toBe("error");
        expect(result.errors).toContainEqual({
          category: "connectivity",
          message: "Failed to connect to Supabase: Database unreachable",
          severity: "critical",
        });
      });
    });

    describe("Discord Webhook Connectivity", () => {
      it("should pass when Discord webhook is reachable", async () => {
        mockDiscordNotifier.testConnection.mockResolvedValue(true);

        const result = await validator.validateConnectivity();

        expect(mockDiscordNotifier.testConnection).toHaveBeenCalled();
        expect(result.status).toBe("success");
        expect(result.errors).toHaveLength(0);
      });

      it("should warn when Discord webhook is unreachable", async () => {
        mockBinanceService.testConnection.mockResolvedValue(true);
        mockSupabaseService.testConnection.mockResolvedValue(true);
        mockDiscordNotifier.testConnection.mockRejectedValue(
          new Error("Webhook invalid"),
        );

        const result = await validator.validateConnectivity();

        expect(result.status).toBe("warning");
        expect(result.warnings).toContainEqual({
          category: "connectivity",
          message:
            "Discord webhook unreachable: Webhook invalid - notifications will be disabled",
          severity: "warning",
        });
        expect(result.errors).toHaveLength(0);
      });

      it("should skip Discord test when webhook URL is not configured", async () => {
        delete process.env.DISCORD_WEBHOOK_URL;
        mockBinanceService.testConnection.mockResolvedValue(true);
        mockSupabaseService.testConnection.mockResolvedValue(true);

        const result = await validator.validateConnectivity();

        expect(mockDiscordNotifier.testConnection).not.toHaveBeenCalled();
        expect(result.status).toBe("success");
      });
    });
  });

  describe("Full Validation Run", () => {
    it("should run all validations and return comprehensive report", async () => {
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockDiscordNotifier.testConnection.mockResolvedValue(true);
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0,
      });
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      const report = await validator.validate();

      expect(report).toMatchObject({
        status: "success",
        timestamp: expect.any(String),
        validations: {
          configuration: {
            status: "success",
            errors: [],
            warnings: [],
          },
          balance: {
            status: "success",
            errors: [],
            warnings: [],
          },
          connectivity: {
            status: "success",
            errors: [],
            warnings: [],
          },
        },
        summary: {
          totalErrors: 0,
          totalWarnings: 0,
          criticalErrors: 0,
        },
      });
    });

    it("should fail fast on critical configuration errors", async () => {
      delete process.env.BINANCE_API_KEY;

      const report = await validator.validate();

      expect(report.status).toBe("error");
      expect(report.validations.configuration.status).toBe("error");
      expect(report.validations.balance).toBeUndefined(); // Should not run
      expect(report.validations.connectivity).toBeUndefined(); // Should not run
      expect(mockBinanceService.getBalance).not.toHaveBeenCalled();
      expect(mockBinanceService.testConnection).not.toHaveBeenCalled();
    });

    it("should continue validation on warnings", async () => {
      delete process.env.DISCORD_WEBHOOK_URL; // This causes a warning
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0.1, // This causes a warning
      });
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      const report = await validator.validate();

      expect(report.status).toBe("warning");
      expect(report.validations.configuration.status).toBe("warning");
      expect(report.validations.balance.status).toBe("warning");
      expect(report.validations.connectivity.status).toBe("success");
      expect(report.summary.totalWarnings).toBe(2);
      expect(report.summary.totalErrors).toBe(0);
    });

    it("should aggregate multiple errors and warnings", async () => {
      // Configuration warning
      delete process.env.DISCORD_WEBHOOK_URL;

      // Balance error and warning
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 500, // Error: insufficient
        BTC: 0.1, // Warning: existing balance
      });

      // Connectivity passes
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      const report = await validator.validate();

      expect(report.status).toBe("error");
      expect(report.summary.totalErrors).toBe(1);
      expect(report.summary.totalWarnings).toBe(2);
      expect(report.summary.criticalErrors).toBe(1);
    });

    it("should generate readable validation report", async () => {
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockDiscordNotifier.testConnection.mockResolvedValue(true);
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0,
      });
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      const report = await validator.validate();
      const reportString = validator.formatReport(report);

      expect(reportString).toContain("STARTUP VALIDATION REPORT");
      expect(reportString).toContain("Status: SUCCESS");
      expect(reportString).toContain("Configuration: ✅ PASSED");
      expect(reportString).toContain("Balance: ✅ PASSED");
      expect(reportString).toContain("Connectivity: ✅ PASSED");
      expect(reportString).toContain("Total Errors: 0");
      expect(reportString).toContain("Total Warnings: 0");
    });

    it("should format error report with details", async () => {
      delete process.env.BINANCE_API_KEY;
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 500,
        BTC: 0.1,
      });

      const report = await validator.validate();
      const reportString = validator.formatReport(report);

      expect(reportString).toContain("STARTUP VALIDATION REPORT");
      expect(reportString).toContain("Status: ERROR");
      expect(reportString).toContain("Configuration: ❌ FAILED");
      expect(reportString).toContain("ERRORS:");
      expect(reportString).toContain(
        "Missing required environment variable: BINANCE_API_KEY",
      );
      expect(reportString).toContain("Critical Errors: 1");
    });

    it("should log validation progress", async () => {
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockDiscordNotifier.testConnection.mockResolvedValue(true);
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0,
      });
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      await validator.validate();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Starting startup validation...",
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Validating configuration...",
      );
      expect(mockLogger.info).toHaveBeenCalledWith("Validating balances...");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Validating connectivity...",
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Startup validation completed successfully",
      );
    });
  });

  describe("Integration with MainOrchestrator", () => {
    it("should be callable from MainOrchestrator.initialize()", async () => {
      // This test verifies the expected integration point
      interface OrchestratorContext {
        binanceService: BinanceService;
        supabaseService: SupabaseService;
        discordNotifier: DiscordNotifier;
        logger: Logger;
      }

      const mockOrchestrator = {
        initialize: jest.fn(async function (this: OrchestratorContext) {
          const validator = new StartupValidator(
            this.binanceService,
            this.supabaseService,
            this.discordNotifier,
            this.logger,
          );

          const report = await validator.validate();

          if (report.status === "error") {
            throw new Error(
              `Startup validation failed: ${report.summary.criticalErrors} critical errors`,
            );
          }

          if (report.status === "warning") {
            this.logger.warn(
              `Startup validation completed with ${report.summary.totalWarnings} warnings`,
            );
          }

          return report;
        }),
      };

      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockDiscordNotifier.testConnection.mockResolvedValue(true);
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0,
      });
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      const orchestrator = {
        binanceService: mockBinanceService,
        supabaseService: mockSupabaseService,
        discordNotifier: mockDiscordNotifier,
        logger: mockLogger,
        initialize: mockOrchestrator.initialize,
      };

      const report = await orchestrator.initialize();

      expect(report.status).toBe("success");
      expect(mockOrchestrator.initialize).toHaveBeenCalled();
    });

    it("should throw error on critical failures in MainOrchestrator", async () => {
      interface OrchestratorContext {
        binanceService: BinanceService;
        supabaseService: SupabaseService;
        discordNotifier: DiscordNotifier;
        logger: Logger;
      }

      const mockOrchestrator = {
        initialize: jest.fn(async function (this: OrchestratorContext) {
          const validator = new StartupValidator(
            this.binanceService,
            this.supabaseService,
            this.discordNotifier,
            this.logger,
          );

          const report = await validator.validate();

          if (report.status === "error") {
            throw new Error(
              `Startup validation failed: ${report.summary.criticalErrors} critical errors`,
            );
          }

          return report;
        }),
      };

      delete process.env.BINANCE_API_KEY; // Cause critical error

      const orchestrator = {
        binanceService: mockBinanceService,
        supabaseService: mockSupabaseService,
        discordNotifier: mockDiscordNotifier,
        logger: mockLogger,
        initialize: mockOrchestrator.initialize,
      };

      await expect(orchestrator.initialize()).rejects.toThrow(
        "Startup validation failed: 1 critical errors",
      );
    });
  });

  describe("Validation Report Types", () => {
    it("should return properly typed ValidationReport", async () => {
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockResolvedValue(true);
      mockDiscordNotifier.testConnection.mockResolvedValue(true);
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0,
      });
      mockSupabaseService.getLastExecutionState.mockResolvedValue(null);

      const report: ValidationReport = await validator.validate();

      // Type checking - these should all be defined
      expect(report.status).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.validations).toBeDefined();
      expect(report.validations.configuration).toBeDefined();
      expect(report.validations.balance).toBeDefined();
      expect(report.validations.connectivity).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.totalErrors).toBeDefined();
      expect(report.summary.totalWarnings).toBeDefined();
      expect(report.summary.criticalErrors).toBeDefined();
    });

    it("should return properly typed ValidationResult for each validation", async () => {
      const configResult: ValidationResult =
        await validator.validateConfiguration();

      expect(configResult).toMatchObject({
        status: expect.stringMatching(/^(success|warning|error)$/),
        errors: expect.any(Array),
        warnings: expect.any(Array),
      });

      configResult.errors.forEach((error) => {
        expect(error).toMatchObject({
          category: expect.any(String),
          message: expect.any(String),
          severity: expect.stringMatching(/^(critical|error|warning)$/),
        });
      });

      configResult.warnings.forEach((warning) => {
        expect(warning).toMatchObject({
          category: expect.any(String),
          message: expect.any(String),
          severity: "warning",
        });
      });
    });
  });

  describe("Error Recovery and Retries", () => {
    it("should retry transient network failures", async () => {
      let callCount = 0;
      mockBinanceService.testConnection.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("ECONNRESET"));
        }
        return Promise.resolve(true);
      });

      const result = await validator.validateConnectivity();

      expect(result.status).toBe("success");
      expect(mockBinanceService.testConnection).toHaveBeenCalledTimes(2);
    });

    it("should not retry non-transient failures", async () => {
      mockBinanceService.testConnection.mockRejectedValue(
        new Error("Invalid API key"),
      );

      const result = await validator.validateConnectivity();

      expect(result.status).toBe("error");
      expect(mockBinanceService.testConnection).toHaveBeenCalledTimes(1); // No retries for auth errors
    });

    it("should handle mixed success and failure in connectivity tests", async () => {
      mockBinanceService.testConnection.mockResolvedValue(true);
      mockSupabaseService.testConnection.mockRejectedValue(
        new Error("Database down"),
      );
      mockDiscordNotifier.testConnection.mockResolvedValue(true);

      const result = await validator.validateConnectivity();

      expect(result.status).toBe("error");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Supabase");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty strategy config", async () => {
      process.env.STRATEGY_CONFIG = "{}";

      const result = await validator.validateConfiguration();

      expect(result.status).toBe("error");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes("leverage"))).toBe(
        true,
      );
      expect(
        result.errors.some((e) => e.message.includes("allocation_percentage")),
      ).toBe(true);
    });

    it("should handle negative INITIAL_CAPITAL_USDT", async () => {
      process.env.INITIAL_CAPITAL_USDT = "-1000";

      const result = await validator.validateConfiguration();

      expect(result.status).toBe("error");
      expect(result.errors).toContainEqual({
        category: "configuration",
        message: "Invalid INITIAL_CAPITAL_USDT: must be a positive number",
        severity: "critical",
      });
    });

    it("should handle non-numeric INITIAL_CAPITAL_USDT", async () => {
      process.env.INITIAL_CAPITAL_USDT = "abc";

      const result = await validator.validateConfiguration();

      expect(result.status).toBe("error");
      expect(result.errors).toContainEqual({
        category: "configuration",
        message: "Invalid INITIAL_CAPITAL_USDT: must be a positive number",
        severity: "critical",
      });
    });

    it("should handle very small BTC balances as zero", async () => {
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0.00000001, // dust amount
      });

      const result = await validator.validateBalances();

      expect(result.status).toBe("success");
      expect(result.warnings).toHaveLength(0); // Should treat as zero
    });

    it("should handle missing balance properties gracefully", async () => {
      // Use a type assertion to simulate missing BTC property
      const incompleteBalance = {
        USDT: 1000,
      } as { USDT: number; BTC: number };

      mockBinanceService.getBalance.mockResolvedValue(incompleteBalance);

      const result = await validator.validateBalances();

      expect(result.status).toBe("success");
      expect(result.errors).toHaveLength(0);
    });

    it("should handle null/undefined last execution state", async () => {
      mockBinanceService.getBalance.mockResolvedValue({
        USDT: 1000,
        BTC: 0,
      });

      // Use type assertion for undefined to match the expected return type
      mockSupabaseService.getLastExecutionState.mockResolvedValue(
        undefined as unknown as null,
      );

      const result = await validator.validateBalances();

      expect(result.status).toBe("success");
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
