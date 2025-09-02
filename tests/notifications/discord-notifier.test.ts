import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  DiscordNotifier,
  type AlertSeverity,
} from "../../src/notifications/discord-notifier";

// Mock fetch
global.fetch = jest.fn() as jest.Mock;

describe("DiscordNotifier", () => {
  let notifier: DiscordNotifier;
  const mockWebhookUrl = "https://discord.com/api/webhooks/123456/token";

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset fetch mock
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    });

    notifier = new DiscordNotifier({
      webhookUrl: mockWebhookUrl,
      environment: "test",
      enableRateLimiting: true,
      maxAlertsPerMinute: 5,
    });
  });

  describe("Configuration", () => {
    it("should initialize with required configuration", () => {
      expect(notifier).toBeDefined();
      expect(notifier.getConfig()).toEqual({
        webhookUrl: mockWebhookUrl,
        environment: "test",
        enableRateLimiting: true,
        maxAlertsPerMinute: 5,
      });
    });

    it("should validate webhook URL format", () => {
      expect(() => {
        new DiscordNotifier({
          webhookUrl: "invalid-url",
          environment: "test",
        });
      }).toThrow("Invalid Discord webhook URL");
    });

    it("should support multiple environments", () => {
      const prodNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        environment: "production",
      });

      expect(prodNotifier.getConfig().environment).toBe("production");
    });
  });

  describe("Alert Sending", () => {
    it("should send basic alert with required fields", async () => {
      await notifier.sendAlert("This is a test alert", "info");

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: expect.stringContaining("BTC Trading Bot"),
              description: "This is a test alert",
              color: expect.any(Number), // Info color
              timestamp: expect.any(String),
              footer: expect.objectContaining({
                text: expect.stringContaining("TriBot | test"),
              }),
            }),
          ],
        }),
      );
    });

    it("should use appropriate colors for severity levels", async () => {
      const severities = [
        { level: "info" as const, color: 3447003 }, // Blue
        { level: "warning" as const, color: 16776960 }, // Yellow
        { level: "error" as const, color: 15158332 }, // Red
        { level: "critical" as const, color: 10038562 }, // Dark Red
        { level: "success" as const, color: 3066993 }, // Green
      ];

      for (const { level, color } of severities) {
        jest.clearAllMocks();

        await notifier.sendAlert(
          `Alert with ${level} severity`,
          level as AlertSeverity,
        );

        expect(global.fetch).toHaveBeenCalledWith(
          mockWebhookUrl,
          expect.objectContaining({
            embeds: [
              expect.objectContaining({
                color,
              }),
            ],
          }),
        );
      }
    });

    it("should include fields when provided", async () => {
      const fields = [
        { name: "USDT Drift", value: "1.5%", inline: true },
        { name: "BTC Drift", value: "0.3%", inline: true },
        {
          name: "Action Required",
          value: "Manual intervention needed",
          inline: false,
        },
      ];

      await notifier.sendAlert(
        "Balance drift exceeded threshold",
        "critical",
        fields,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              fields,
            }),
          ],
        }),
      );
    });

    it("should add action required indicator for critical alerts", async () => {
      await notifier.sendAlert("Immediate action required", "critical");

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: "🚨 Critical Alert",
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "⚠️ Action Required",
                  value: "Manual intervention needed",
                  inline: false,
                }),
              ]),
            }),
          ],
        }),
      );
    });

    it("should include metadata in alert", async () => {
      const metadata = {
        tradeId: "12345",
        amount: 1000,
        price: 50000,
      };

      await notifier.sendAlert({
        title: "Trade Executed",
        severity: "info",
        description: "Buy order completed",
        metadata,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "Metadata",
                  value: expect.stringContaining("tradeId"),
                }),
              ]),
            }),
          ],
        }),
      );
    });

    it("should truncate long descriptions", async () => {
      const longDescription = "A".repeat(3000); // Discord limit is 2048

      await notifier.sendAlert({
        title: "Long Alert",
        severity: "info",
        description: longDescription,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              description: expect.stringMatching(/^A{2044}\.\.\./), // 2044 + "..."
            }),
          ],
        }),
      );
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limiting when enabled", async () => {
      // Send multiple alerts quickly
      const promises = [];
      for (let i = 0; i < 7; i++) {
        promises.push(
          notifier.sendAlert({
            title: `Alert ${i}`,
            severity: "info",
            description: `Test alert ${i}`,
          }),
        );
      }

      const results = await Promise.allSettled(promises);

      // First 5 should succeed
      expect(results.slice(0, 5).every((r) => r.status === "fulfilled")).toBe(
        true,
      );

      // 6th and 7th should be rate limited
      expect(results[5].status).toBe("rejected");
      if (results[5].status === "rejected") {
        expect(results[5].reason.message).toContain("Rate limit exceeded");
      }
    });

    it("should reset rate limit after time window", async () => {
      jest.useFakeTimers();

      // Send 5 alerts (max per minute)
      for (let i = 0; i < 5; i++) {
        await notifier.sendAlert({
          title: `Alert ${i}`,
          severity: "info",
          description: "Test",
        });
      }

      // Should be rate limited
      await expect(
        notifier.sendAlert({
          title: "Alert 6",
          severity: "info",
          description: "Test",
        }),
      ).rejects.toThrow("Rate limit exceeded");

      // Advance time by 1 minute
      jest.advanceTimersByTime(60000);

      // Should be able to send again
      await expect(
        notifier.sendAlert({
          title: "Alert 7",
          severity: "info",
          description: "Test",
        }),
      ).resolves.not.toThrow();

      jest.useRealTimers();
    });

    it("should bypass rate limiting when disabled", async () => {
      const unlimitedNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        environment: "test",
        enableRateLimiting: false,
      });

      // Send many alerts quickly
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          unlimitedNotifier.sendAlert({
            title: `Alert ${i}`,
            severity: "info",
            description: "Test",
          }),
        );
      }

      const results = await Promise.allSettled(promises);

      // All should succeed
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle Discord API errors", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Discord API error: 400 Bad Request"));

      await expect(
        notifier.sendAlert({
          title: "Test",
          severity: "info",
          description: "Test",
        }),
      ).rejects.toThrow("Discord API error");
    });

    it("should handle network errors", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        notifier.sendAlert({
          title: "Test",
          severity: "info",
          description: "Test",
        }),
      ).rejects.toThrow("ECONNREFUSED");
    });

    it("should retry on temporary failures", async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error("Temporary failure"));
        }
        return Promise.resolve({ data: { success: true } });
      });

      await notifier.sendAlert({
        title: "Test",
        severity: "info",
        description: "Test",
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should give up after max retries", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Persistent failure"));

      await expect(
        notifier.sendAlert({
          title: "Test",
          severity: "info",
          description: "Test",
        }),
      ).rejects.toThrow("Persistent failure");

      // Default max retries is 3
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("Batch Notifications", () => {
    it("should support sending multiple alerts as batch", async () => {
      const alerts = [
        {
          title: "Alert 1",
          severity: "info" as const,
          description: "First alert",
        },
        {
          title: "Alert 2",
          severity: "warning" as const,
          description: "Second alert",
        },
      ];

      await notifier.sendBatch(alerts);

      // Should combine into single Discord message with multiple embeds
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({ title: "Alert 1" }),
            expect.objectContaining({ title: "Alert 2" }),
          ]),
        }),
      );
    });

    it("should split large batches to respect Discord limits", async () => {
      // Discord limit is 10 embeds per message
      const alerts = Array.from({ length: 15 }, (_, i) => ({
        title: `Alert ${i}`,
        severity: "info" as const,
        description: `Alert number ${i}`,
      }));

      await notifier.sendBatch(alerts);

      // Should split into 2 messages (10 + 5)
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // First call should have 10 embeds
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining(
            Array.from({ length: 10 }, () => expect.any(Object)),
          ),
        }),
      );

      // Second call should have 5 embeds
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining(
            Array.from({ length: 5 }, () => expect.any(Object)),
          ),
        }),
      );
    });
  });

  describe("Notification Templates", () => {
    it("should use template for drift detection", async () => {
      await notifier.sendDriftAlert({
        usdtDrift: 0.015,
        btcDrift: 0.003,
        threshold: 0.005,
        balances: {
          usdtSpot: 1015,
          capitalAvailable: 1000,
          btcSpot: 0.01003,
          btcAccumulated: 0.01,
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: expect.stringContaining("Drift Detected"),
              color: 15158332, // Critical color
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "USDT Drift",
                  value: expect.stringContaining("1.50%"),
                }),
                expect.objectContaining({
                  name: "BTC Drift",
                  value: expect.stringContaining("0.30%"),
                }),
              ]),
            }),
          ],
        }),
      );
    });

    it("should use template for error notifications", async () => {
      await notifier.sendErrorAlert({
        error: new Error("Connection timeout"),
        operation: "PLACE_ORDER",
        context: {
          orderId: "12345",
          side: "BUY",
          amount: 100,
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: expect.stringContaining("Error"),
              description: expect.stringContaining("Connection timeout"),
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "Operation",
                  value: "PLACE_ORDER",
                }),
                expect.objectContaining({
                  name: "Context",
                  value: expect.stringContaining("orderId"),
                }),
              ]),
            }),
          ],
        }),
      );
    });

    it("should use template for trade execution", async () => {
      await notifier.sendTradeAlert({
        type: "BUY",
        amount: 0.001,
        price: 50000,
        total: 50,
        orderId: "ORD123",
        timestamp: new Date("2024-01-01T12:00:00Z"),
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: expect.stringContaining("Buy Order Executed"),
              color: 3066993, // Success color
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "Amount",
                  value: "0.001 BTC",
                }),
                expect.objectContaining({
                  name: "Price",
                  value: "$50,000.00",
                }),
                expect.objectContaining({
                  name: "Total",
                  value: "$50.00",
                }),
              ]),
            }),
          ],
        }),
      );
    });

    it("should use template for strategy resume", async () => {
      await notifier.sendResumeAlert({
        pauseDuration: 3600000, // 1 hour
        previousReason: "DRIFT_DETECTED",
        validatorId: "admin-123",
        validationResults: {
          stateValid: true,
          driftAcceptable: true,
          exchangeConnected: true,
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: expect.stringContaining("Strategy Resumed"),
              color: 3066993, // Success color
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "Pause Duration",
                  value: expect.stringContaining("1 hour"),
                }),
                expect.objectContaining({
                  name: "Validation Results",
                  value: expect.stringContaining("✅"),
                }),
              ]),
            }),
          ],
        }),
      );
    });
  });

  describe("Message Formatting", () => {
    it("should format numbers appropriately", async () => {
      await notifier.sendAlert({
        title: "Test",
        severity: "info",
        description: "Test",
        fields: [
          {
            name: "Price",
            value: notifier.formatCurrency(50000.5),
            inline: true,
          },
          {
            name: "Amount",
            value: notifier.formatNumber(0.00012345, 8),
            inline: true,
          },
          {
            name: "Percentage",
            value: notifier.formatPercentage(0.0156),
            inline: true,
          },
        ],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              fields: [
                expect.objectContaining({ value: "$50,000.50" }),
                expect.objectContaining({ value: "0.00012345" }),
                expect.objectContaining({ value: "1.56%" }),
              ],
            }),
          ],
        }),
      );
    });

    it("should format timestamps", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");

      await notifier.sendAlert({
        title: "Test",
        severity: "info",
        description: "Test",
        timestamp,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              timestamp: "2024-01-01T12:00:00.000Z",
            }),
          ],
        }),
      );
    });

    it("should add environment badge to footer", async () => {
      const prodNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        environment: "production",
      });

      await prodNotifier.sendAlert({
        title: "Test",
        severity: "info",
        description: "Test",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              footer: expect.objectContaining({
                text: expect.stringContaining("TriBot | production"),
              }),
            }),
          ],
        }),
      );
    });
  });

  describe("Silent Mode", () => {
    it("should respect silent mode for non-critical alerts", async () => {
      const silentNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        environment: "test",
        silentMode: true,
      });

      await silentNotifier.sendAlert({
        title: "Info Alert",
        severity: "info",
        description: "Test",
      });

      // Should not send non-critical alerts in silent mode
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should still send critical alerts in silent mode", async () => {
      const silentNotifier = new DiscordNotifier({
        webhookUrl: mockWebhookUrl,
        environment: "test",
        silentMode: true,
      });

      await silentNotifier.sendAlert({
        title: "Critical Alert",
        severity: "critical",
        description: "Critical issue",
      });

      // Should send critical alerts even in silent mode
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe("Health Check", () => {
    it("should verify Discord webhook is accessible", async () => {
      const isHealthy = await notifier.healthCheck();

      expect(isHealthy).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              title: "Health Check",
              description: "Discord notifier is operational",
            }),
          ],
        }),
      );
    });

    it("should return false when webhook is not accessible", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Connection failed"));

      const isHealthy = await notifier.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });
});
