import { jest } from "@jest/globals";
import { DiscordNotifier } from "../../src/notifications/discord-notifier.js";
import type {
  DiscordNotifierConfig,
  DiscordMessage,
} from "../../src/notifications/discord-notifier.js";
import type { PauseReason } from "../../src/cycle/strategy-pause-mechanism.js";

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe("DiscordNotifier", () => {
  let notifier: DiscordNotifier;
  const mockWebhookUrl = "https://discord.com/api/webhooks/test/token";
  const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as Response);

    notifier = new DiscordNotifier({
      webhookUrl: mockWebhookUrl,
      enableRateLimiting: false,
      silentMode: false,
    });
  });

  describe("constructor", () => {
    it("should throw error if webhook URL is not provided", () => {
      expect(() => new DiscordNotifier({} as DiscordNotifierConfig)).toThrow(
        "Discord webhook URL is required",
      );
    });

    it("should set default config values", () => {
      const config = notifier.getConfig();
      expect(config.enableRateLimiting).toBe(false);
      expect(config.rateLimitWindow).toBe(60000);
      expect(config.rateLimitCount).toBe(5);
      expect(config.silentMode).toBe(false);
      expect(config.environment).toBe("development");
    });
  });

  describe("sendTradeAlert", () => {
    it("should send buy trade alert with correct formatting", async () => {
      await notifier.sendTradeAlert("buy", 50000, 0.1);

      expect(mockFetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0]).toMatchObject({
        title: "📈 Trade Executed",
        color: 0x00ff00,
        fields: expect.arrayContaining([
          { name: "Type", value: "BUY", inline: true },
          { name: "Price", value: "$50000.00", inline: true },
          { name: "Quantity", value: "0.10000000 BTC", inline: true },
          { name: "Total Value", value: "$5000.00", inline: true },
        ]),
      });
    });

    it("should send sell trade alert with correct formatting", async () => {
      await notifier.sendTradeAlert("sell", 55000, 0.1);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0]).toMatchObject({
        title: "📉 Trade Executed",
        color: 0xff0000,
        fields: expect.arrayContaining([
          { name: "Type", value: "SELL", inline: true },
          { name: "Price", value: "$55000.00", inline: true },
        ]),
      });
    });
  });

  describe("sendCycleCompleteAlert", () => {
    it("should send cycle completion alert with profit metrics", async () => {
      await notifier.sendCycleCompleteAlert({
        profit: 150.75,
        profitPercentage: 5.25,
        cycleNumber: 3,
        totalTrades: 8,
        duration: 14400000, // 4 hours in ms
        finalCapital: 3150.75,
      });

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0]).toMatchObject({
        title: expect.stringContaining("Cycle #3 Complete"),
        color: 0x00ff00,
        fields: expect.arrayContaining([
          { name: "Profit", value: "$150.75", inline: true },
          { name: "Profit %", value: "5.25%", inline: true },
          { name: "Total Trades", value: "8", inline: true },
          { name: "Duration", value: "4h 0m", inline: true },
          { name: "Final Capital", value: "$3150.75", inline: true },
        ]),
      });
    });

    it("should handle zero profit cycles", async () => {
      await notifier.sendCycleCompleteAlert({
        profit: 0,
        profitPercentage: 0,
        cycleNumber: 1,
        totalTrades: 3,
        duration: 3600000,
        finalCapital: 1000,
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0].fields).toContainEqual({
        name: "Profit",
        value: "$0.00",
        inline: true,
      });
    });
  });

  describe("offline message queue", () => {
    it("should queue messages when webhook is offline", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        notifier.sendTradeAlert("buy", 50000, 0.1),
      ).rejects.toThrow();

      const queuedMessages = notifier.getQueuedMessages();
      expect(queuedMessages).toHaveLength(1);
      expect(queuedMessages[0].type).toBe("trade");
    });

    it("should retry queued messages when connection is restored", async () => {
      // First call fails
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      await expect(
        notifier.sendTradeAlert("buy", 50000, 0.1),
      ).rejects.toThrow();

      // Reset mock to succeed
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      } as Response);

      // Retry queued messages
      const result = await notifier.retryQueuedMessages();
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
      expect(notifier.getQueuedMessages()).toHaveLength(0);
    });

    it("should limit queue size to prevent memory issues", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Try to queue more than max (default 100)
      for (let i = 0; i < 150; i++) {
        await expect(
          notifier.sendTradeAlert("buy", 50000 + i, 0.1),
        ).rejects.toThrow();
      }

      const queuedMessages = notifier.getQueuedMessages();
      expect(queuedMessages.length).toBeLessThanOrEqual(100);
    });

    it("should clear old messages from queue after timeout", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Queue a message
      await expect(
        notifier.sendTradeAlert("buy", 50000, 0.1),
      ).rejects.toThrow();

      // Simulate old message by modifying timestamp
      const queue = notifier.getQueuedMessages();
      expect(queue).toHaveLength(1);

      // Clear old messages (older than 24 hours)
      notifier.clearOldQueuedMessages(24 * 60 * 60 * 1000);
      expect(notifier.getQueuedMessages()).toHaveLength(1);

      // Clear with 0 age threshold
      notifier.clearOldQueuedMessages(0);
      expect(notifier.getQueuedMessages()).toHaveLength(0);
    });
  });

  describe("retry logic", () => {
    it("should retry failed webhook calls with exponential backoff", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response);

      const notifierWithRetry = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        enableRetry: true,
        maxRetries: 3,
        retryDelay: 100,
      });

      await notifierWithRetry.sendTradeAlert("buy", 50000, 0.1);

      // Should have been called 3 times (2 failures + 1 success)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should fail after max retries", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const notifierWithRetry = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        enableRetry: true,
        maxRetries: 2,
        retryDelay: 100,
      });

      await expect(
        notifierWithRetry.sendTradeAlert("buy", 50000, 0.1),
      ).rejects.toThrow("Network error");

      // Should have been called 3 times (initial + 2 retries)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should handle rate limit responses correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({
          "X-RateLimit-Reset-After": "5",
        }),
      } as Response);

      await expect(notifier.sendAlert("Test message")).rejects.toThrow(
        "Discord webhook failed: 429 Too Many Requests",
      );
    });
  });

  describe("sendAlert", () => {
    it("should send alert with correct severity color", async () => {
      const severities = [
        { severity: "info" as const, color: 0x0099ff },
        { severity: "warning" as const, color: 0xffcc00 },
        { severity: "error" as const, color: 0xff6600 },
        { severity: "critical" as const, color: 0xff0000 },
      ];

      for (const { severity, color } of severities) {
        await notifier.sendAlert("Test message", severity);

        const callArgs = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

        expect(body.embeds?.[0].color).toBe(color);
      }
    });

    it("should include metadata when provided", async () => {
      const metadata = {
        userId: "123",
        action: "test",
        timestamp: Date.now(),
      };

      await notifier.sendAlert("Test message", "info", undefined, metadata);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      const metadataField = body.embeds?.[0].fields?.find(
        (f) => f.name === "Metadata",
      );
      expect(metadataField).toBeDefined();
      expect(metadataField?.value).toContain("userId");
    });

    it("should respect silent mode for non-critical alerts", async () => {
      const silentNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        silentMode: true,
      });

      await silentNotifier.sendAlert("Test message", "info");
      expect(mockFetch).not.toHaveBeenCalled();

      await silentNotifier.sendAlert("Critical message", "critical");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("sendPauseAlert", () => {
    it("should send pause alert with drift information", async () => {
      const reason: PauseReason = {
        type: "drift_detected",
        message: "Balance drift detected",
        metadata: {
          usdtDrift: 0.01,
          btcDrift: 0.005,
        },
      };

      await notifier.sendPauseAlert(reason);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0].description).toContain("STRATEGY PAUSED");
      expect(body.embeds?.[0].fields).toContainEqual({
        name: "USDT Drift",
        value: "1.00%",
        inline: true,
      });
      expect(body.embeds?.[0].fields).toContainEqual({
        name: "BTC Drift",
        value: "0.50%",
        inline: true,
      });
    });
  });

  describe("rate limiting", () => {
    it("should enforce rate limits when enabled", async () => {
      const rateLimitedNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        enableRateLimiting: true,
        rateLimitWindow: 1000,
        rateLimitCount: 2,
      });

      // First two should succeed
      await rateLimitedNotifier.sendAlert("Message 1");
      await rateLimitedNotifier.sendAlert("Message 2");

      // Third should be skipped
      await rateLimitedNotifier.sendAlert("Message 3");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should bypass rate limit for critical alerts", async () => {
      const rateLimitedNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        enableRateLimiting: true,
        rateLimitWindow: 1000,
        rateLimitCount: 1,
      });

      await rateLimitedNotifier.sendAlert("Normal message");
      await rateLimitedNotifier.sendAlert("Critical message", "critical");

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should reset rate limit after window expires", async () => {
      jest.useFakeTimers();

      const rateLimitedNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        enableRateLimiting: true,
        rateLimitWindow: 1000,
        rateLimitCount: 1,
      });

      await rateLimitedNotifier.sendAlert("Message 1");
      await rateLimitedNotifier.sendAlert("Message 2"); // Should be skipped

      jest.advanceTimersByTime(1001);

      await rateLimitedNotifier.sendAlert("Message 3");

      expect(mockFetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe("sendBatchAlerts", () => {
    it("should batch messages correctly", async () => {
      const messages = Array.from({ length: 25 }, (_, i) => `Message ${i}`);
      await notifier.sendBatchAlerts(messages);

      // Should be called 3 times (10 + 10 + 5)
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Check first batch
      const firstCall = mockFetch.mock.calls[0];
      const firstBody = JSON.parse(
        firstCall[1]?.body as string,
      ) as DiscordMessage;
      expect(firstBody.embeds).toHaveLength(10);

      // Check last batch
      const lastCall = mockFetch.mock.calls[2];
      const lastBody = JSON.parse(
        lastCall[1]?.body as string,
      ) as DiscordMessage;
      expect(lastBody.embeds).toHaveLength(5);
    });
  });

  describe("health check", () => {
    it("should return true when webhook is healthy", async () => {
      const result = await notifier.healthCheck();
      expect(result).toBe(true);
      expect(notifier.isWebhookHealthy()).toBe(true);
    });

    it("should return false when webhook is unhealthy", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await notifier.healthCheck();
      expect(result).toBe(false);
      expect(notifier.isWebhookHealthy()).toBe(false);
    });
  });

  describe("formatting helpers", () => {
    it("should format numbers correctly", () => {
      expect(notifier.formatNumber(123.456, 2)).toBe("123.46");
      expect(notifier.formatNumber(0.00123456, 8)).toBe("0.00123456");
    });

    it("should format currency correctly", () => {
      expect(notifier.formatCurrency(1234.56)).toBe("$1234.56");
      expect(notifier.formatCurrency(0.5)).toBe("$0.50");
    });

    it("should format percentage correctly", () => {
      expect(notifier.formatPercentage(0.1234)).toBe("12.34%");
      expect(notifier.formatPercentage(0.05)).toBe("5.00%");
    });

    it("should format duration correctly", () => {
      expect(notifier.formatDuration(3600000)).toBe("1h 0m");
      expect(notifier.formatDuration(7890000)).toBe("2h 11m");
      expect(notifier.formatDuration(150000)).toBe("2m");
      expect(notifier.formatDuration(86400000)).toBe("24h 0m");
    });
  });

  describe("error alerts", () => {
    it("should format error alerts with stack trace", async () => {
      const error = new Error("Test error");
      error.stack = "Error: Test error\n  at someFunction";

      await notifier.sendErrorAlert(error, { operation: "test" });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0].description).toContain("STRATEGY PAUSED");
      expect(body.embeds?.[0].description).toContain("Test error");
    });
  });

  describe("resume alerts", () => {
    it("should send successful resume alert", async () => {
      await notifier.sendResumeSuccessAlert(false);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0].description).toContain("STRATEGY RESUMED");
      expect(body.embeds?.[0].fields).toContainEqual({
        name: "Resume Type",
        value: "Validated",
        inline: true,
      });
    });

    it("should send failed resume alert with errors", async () => {
      const errors = ["Balance mismatch", "Invalid state"];
      await notifier.sendResumeFailedAlert(errors);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string) as DiscordMessage;

      expect(body.embeds?.[0].description).toContain("RESUME FAILED");
      expect(body.embeds?.[0].fields).toContainEqual({
        name: "Validation Errors",
        value: "Balance mismatch\nInvalid state",
        inline: false,
      });
    });
  });
});
