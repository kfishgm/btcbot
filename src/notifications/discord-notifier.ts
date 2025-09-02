import type { PauseReason } from "../cycle/strategy-pause-mechanism.js";
import { logger } from "../utils/logger.js";

export interface DiscordNotifierConfig {
  webhookUrl: string;
  enableRateLimiting?: boolean;
  rateLimitWindow?: number; // milliseconds
  rateLimitCount?: number;
  silentMode?: boolean;
  environment?: string;
  enableRetry?: boolean;
  maxRetries?: number;
  retryDelay?: number; // milliseconds
  maxQueueSize?: number;
  queueTTL?: number; // milliseconds
}

export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordField[];
  timestamp?: string;
  footer?: {
    text: string;
  };
}

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export type AlertSeverity = "info" | "warning" | "error" | "critical";

interface RateLimitInfo {
  count: number;
  windowStart: number;
}

interface QueuedMessage {
  id: string;
  type: "alert" | "trade" | "cycle" | "pause" | "resume" | "error";
  message: DiscordMessage;
  timestamp: number;
  retryCount: number;
}

export interface CycleCompleteData {
  profit: number;
  profitPercentage: number;
  cycleNumber: number;
  totalTrades: number;
  duration: number; // milliseconds
  finalCapital: number;
}

export class DiscordNotifier {
  private config: Required<DiscordNotifierConfig>;
  private rateLimitInfo: RateLimitInfo;
  private isHealthy: boolean = true;
  private messageQueue: QueuedMessage[] = [];
  private queueProcessing: boolean = false;

  constructor(config: DiscordNotifierConfig) {
    if (!config.webhookUrl) {
      throw new Error("Discord webhook URL is required");
    }

    this.config = {
      webhookUrl: config.webhookUrl,
      enableRateLimiting: config.enableRateLimiting ?? true,
      rateLimitWindow: config.rateLimitWindow ?? 60000, // 1 minute
      rateLimitCount: config.rateLimitCount ?? 5,
      silentMode: config.silentMode ?? false,
      environment: config.environment ?? "development",
      enableRetry: config.enableRetry ?? false,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      maxQueueSize: config.maxQueueSize ?? 100,
      queueTTL: config.queueTTL ?? 24 * 60 * 60 * 1000, // 24 hours
    };

    this.rateLimitInfo = {
      count: 0,
      windowStart: Date.now(),
    };
  }

  async sendAlert(
    message: string,
    severity: AlertSeverity = "info",
    fields?: DiscordField[],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (this.config.silentMode && severity !== "critical") {
      logger.debug("Discord notification suppressed (silent mode)", {
        message,
        severity,
      });
      return;
    }

    if (!this.checkRateLimit(severity === "critical")) {
      logger.warn("Discord rate limit exceeded, skipping notification", {
        message,
        severity,
      });
      return;
    }

    const color = this.getColorForSeverity(severity);
    const embed: DiscordEmbed = {
      title: `🤖 BTC Trading Bot ${this.getSeverityEmoji(severity)}`,
      description: message,
      color,
      fields: fields || [],
      timestamp: new Date().toISOString(),
      footer: {
        text: "BTC Trading Bot",
      },
    };

    if (metadata) {
      embed.fields = embed.fields || [];
      embed.fields.push({
        name: "Metadata",
        value:
          "```json\n" +
          JSON.stringify(metadata, null, 2).substring(0, 1000) +
          "\n```",
        inline: false,
      });
    }

    const discordMessage: DiscordMessage = {
      embeds: [embed],
      username: "BTC Trading Bot",
    };

    try {
      await this.sendToWebhook(discordMessage);
    } catch (error) {
      await this.queueMessage("alert", discordMessage);
      throw error;
    }
  }

  async sendPauseAlert(reason: PauseReason): Promise<void> {
    const fields: DiscordField[] = [
      {
        name: "Pause Type",
        value: reason.type.replace(/_/g, " ").toUpperCase(),
        inline: true,
      },
      {
        name: "Timestamp",
        value: new Date().toISOString(),
        inline: true,
      },
    ];

    if (reason.type === "drift_detected" && reason.metadata) {
      const usdtDrift = ((reason.metadata.usdtDrift as number) * 100).toFixed(
        2,
      );
      const btcDrift = ((reason.metadata.btcDrift as number) * 100).toFixed(2);

      fields.push(
        {
          name: "USDT Drift",
          value: `${usdtDrift}%`,
          inline: true,
        },
        {
          name: "BTC Drift",
          value: `${btcDrift}%`,
          inline: true,
        },
      );
    }

    await this.sendAlert(
      `⚠️ **STRATEGY PAUSED**\n\n${reason.message}\n\n**Manual intervention required!**`,
      "critical",
      fields,
      reason.metadata,
    );
  }

  async sendResumeSuccessAlert(forced: boolean): Promise<void> {
    const fields: DiscordField[] = [
      {
        name: "Resume Type",
        value: forced ? "Forced" : "Validated",
        inline: true,
      },
      {
        name: "Timestamp",
        value: new Date().toISOString(),
        inline: true,
      },
    ];

    await this.sendAlert(
      "✅ **STRATEGY RESUMED**\n\nThe trading strategy has been successfully resumed and is now active.",
      "info",
      fields,
    );
  }

  async sendResumeFailedAlert(errors: string[]): Promise<void> {
    const fields: DiscordField[] = [
      {
        name: "Validation Errors",
        value: errors.join("\n"),
        inline: false,
      },
      {
        name: "Timestamp",
        value: new Date().toISOString(),
        inline: true,
      },
    ];

    await this.sendAlert(
      "❌ **RESUME FAILED**\n\nThe trading strategy could not be resumed due to validation errors.",
      "error",
      fields,
    );
  }

  async sendTradeAlert(
    type: "buy" | "sell",
    price: number,
    quantity: number,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    const emoji = type === "buy" ? "📈" : "📉";
    const color = type === "buy" ? 0x00ff00 : 0xff0000;

    const fields: DiscordField[] = [
      {
        name: "Type",
        value: type.toUpperCase(),
        inline: true,
      },
      {
        name: "Price",
        value: `$${price.toFixed(2)}`,
        inline: true,
      },
      {
        name: "Quantity",
        value: `${quantity.toFixed(8)} BTC`,
        inline: true,
      },
      {
        name: "Total Value",
        value: `$${(price * quantity).toFixed(2)}`,
        inline: true,
      },
    ];

    const embed: DiscordEmbed = {
      title: `${emoji} Trade Executed`,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: "BTC Trading Bot",
      },
    };

    const message: DiscordMessage = {
      embeds: [embed],
      username: "BTC Trading Bot",
    };

    try {
      await this.sendToWebhook(message);
    } catch (error) {
      await this.queueMessage("trade", message);
      throw error;
    }
  }

  async sendCycleCompleteAlert(data: CycleCompleteData): Promise<void> {
    const emoji = data.profit > 0 ? "💰" : "📊";
    const color = data.profit > 0 ? 0x00ff00 : 0xffa500;

    const fields: DiscordField[] = [
      {
        name: "Profit",
        value: `$${data.profit.toFixed(2)}`,
        inline: true,
      },
      {
        name: "Profit %",
        value: `${data.profitPercentage.toFixed(2)}%`,
        inline: true,
      },
      {
        name: "Total Trades",
        value: data.totalTrades.toString(),
        inline: true,
      },
      {
        name: "Duration",
        value: this.formatDuration(data.duration),
        inline: true,
      },
      {
        name: "Final Capital",
        value: `$${data.finalCapital.toFixed(2)}`,
        inline: true,
      },
    ];

    const embed: DiscordEmbed = {
      title: `${emoji} Cycle #${data.cycleNumber} Complete`,
      description: `Trading cycle completed successfully${
        data.profit > 0 ? " with profit!" : "."
      }`,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: "BTC Trading Bot",
      },
    };

    const message: DiscordMessage = {
      embeds: [embed],
      username: "BTC Trading Bot",
    };

    try {
      await this.sendToWebhook(message);
    } catch (error) {
      await this.queueMessage("cycle", message);
      throw error;
    }
  }

  async sendBatchAlerts(messages: string[]): Promise<void> {
    const batchSize = 10;
    const batches = [];

    for (let i = 0; i < messages.length; i += batchSize) {
      batches.push(messages.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const embeds: DiscordEmbed[] = batch.map((msg) => ({
        description: msg,
        color: 0x0099ff,
        timestamp: new Date().toISOString(),
      }));

      const message: DiscordMessage = {
        embeds,
        username: "BTC Trading Bot",
      };

      await this.sendToWebhook(message);

      // Wait a bit between batches to avoid rate limiting
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async testWebhook(): Promise<boolean> {
    try {
      await this.sendAlert("🔧 Discord webhook test message", "info");
      return true;
    } catch (error) {
      logger.error("Discord webhook test failed", { error });
      return false;
    }
  }

  // Alias methods for backward compatibility with tests
  async sendBatch(
    alerts: Array<{
      title: string;
      severity: AlertSeverity;
      description: string;
    }>,
  ): Promise<void> {
    for (const alert of alerts) {
      await this.sendAlert(alert.description, alert.severity);
    }
  }

  async sendDriftAlert(driftData: {
    usdtDrift: number;
    btcDrift: number;
    threshold: number;
  }): Promise<void> {
    const reason: PauseReason = {
      type: "drift_detected",
      message: `Balance drift exceeded: USDT ${(driftData.usdtDrift * 100).toFixed(2)}%, BTC ${(driftData.btcDrift * 100).toFixed(2)}%`,
      metadata: driftData,
    };
    await this.sendPauseAlert(reason);
  }

  async sendErrorAlert(
    error: Error,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const reason: PauseReason = {
      type: "critical_error",
      message: error.message,
      metadata: { errorName: error.name, context },
    };
    await this.sendPauseAlert(reason);
  }

  async sendResumeAlert(forced: boolean = false): Promise<void> {
    await this.sendResumeSuccessAlert(forced);
  }

  async healthCheck(): Promise<boolean> {
    return this.testWebhook();
  }

  getConfig(): DiscordNotifierConfig {
    return { ...this.config };
  }

  private async sendToWebhook(
    message: DiscordMessage,
    retryCount: number = 0,
  ): Promise<void> {
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("X-RateLimit-Reset-After");
          logger.warn("Discord rate limited by API", { retryAfter });
        }
        throw new Error(
          `Discord webhook failed: ${response.status} ${response.statusText}`,
        );
      }

      this.isHealthy = true;
    } catch (error) {
      this.isHealthy = false;
      logger.error("Failed to send Discord notification", { error });

      // Retry logic
      if (this.config.enableRetry && retryCount < this.config.maxRetries) {
        const delay = this.config.retryDelay * Math.pow(2, retryCount); // Exponential backoff
        logger.info(
          `Retrying Discord webhook in ${delay}ms (attempt ${retryCount + 1}/${this.config.maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendToWebhook(message, retryCount + 1);
      }

      throw error;
    }
  }

  private checkRateLimit(bypass: boolean = false): boolean {
    if (!this.config.enableRateLimiting || bypass) {
      return true;
    }

    const now = Date.now();
    if (now - this.rateLimitInfo.windowStart > this.config.rateLimitWindow) {
      this.rateLimitInfo = {
        count: 1,
        windowStart: now,
      };
      return true;
    }

    if (this.rateLimitInfo.count >= this.config.rateLimitCount) {
      return false;
    }

    this.rateLimitInfo.count++;
    return true;
  }

  private getColorForSeverity(severity: AlertSeverity): number {
    switch (severity) {
      case "info":
        return 0x0099ff; // Blue
      case "warning":
        return 0xffcc00; // Yellow
      case "error":
        return 0xff6600; // Orange
      case "critical":
        return 0xff0000; // Red
      default:
        return 0x808080; // Gray
    }
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case "info":
        return "ℹ️";
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
      case "critical":
        return "🚨";
      default:
        return "📝";
    }
  }

  isWebhookHealthy(): boolean {
    return this.isHealthy;
  }

  resetRateLimit(): void {
    this.rateLimitInfo = {
      count: 0,
      windowStart: Date.now(),
    };
  }

  formatNumber(value: number, decimals: number = 2): string {
    return value.toFixed(decimals);
  }

  formatCurrency(value: number): string {
    return `$${value.toFixed(2)}`;
  }

  formatPercentage(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }

  formatDuration(milliseconds: number): string {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  // Queue management methods
  private async queueMessage(
    type: QueuedMessage["type"],
    message: DiscordMessage,
  ): Promise<void> {
    // Enforce max queue size
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      // Remove oldest message
      this.messageQueue.shift();
      logger.warn("Discord message queue full, removing oldest message");
    }

    const queuedMessage: QueuedMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      message,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.messageQueue.push(queuedMessage);
    logger.info(
      `Queued Discord message (type: ${type}, queue size: ${this.messageQueue.length})`,
    );
  }

  getQueuedMessages(): Array<{
    id: string;
    type: string;
    timestamp: number;
    retryCount: number;
  }> {
    return this.messageQueue.map(({ message: _, ...rest }) => rest);
  }

  async retryQueuedMessages(): Promise<{ successful: number; failed: number }> {
    if (this.queueProcessing) {
      logger.warn("Queue processing already in progress");
      return { successful: 0, failed: 0 };
    }

    this.queueProcessing = true;
    let successful = 0;
    let failed = 0;

    const messagesToRetry = [...this.messageQueue];
    this.messageQueue = [];

    for (const queuedMessage of messagesToRetry) {
      try {
        await this.sendToWebhook(queuedMessage.message);
        successful++;
        logger.info(
          `Successfully sent queued message (id: ${queuedMessage.id})`,
        );
      } catch (error) {
        failed++;
        queuedMessage.retryCount++;

        // Re-queue if not exceeded max retries
        if (queuedMessage.retryCount < this.config.maxRetries) {
          this.messageQueue.push(queuedMessage);
        } else {
          logger.error(
            `Dropping queued message after max retries (id: ${queuedMessage.id})`,
            {
              error,
            },
          );
        }
      }
    }

    this.queueProcessing = false;
    logger.info(
      `Queue retry complete (successful: ${successful}, failed: ${failed})`,
    );
    return { successful, failed };
  }

  clearOldQueuedMessages(maxAge: number = this.config.queueTTL): void {
    const now = Date.now();
    const before = this.messageQueue.length;

    this.messageQueue = this.messageQueue.filter(
      (msg) => now - msg.timestamp < maxAge,
    );

    const removed = before - this.messageQueue.length;
    if (removed > 0) {
      logger.info(`Cleared ${removed} old messages from queue`);
    }
  }

  clearQueue(): void {
    const count = this.messageQueue.length;
    this.messageQueue = [];
    logger.info(`Cleared ${count} messages from queue`);
  }

  getQueueSize(): number {
    return this.messageQueue.length;
  }
}
