import Transport from "winston-transport";
import type { LogEntry } from "winston";

/**
 * Options for configuring the Discord logs transport
 */
interface DiscordLogsTransportOptions {
  /** Discord webhook URL (required) */
  webhookUrl: string;
  /** Minimum log level to send to Discord (default: 'info') */
  level?: string;
  /** Username to display in Discord (default: 'Bot Logs') */
  username?: string;
  /** Enable batching of logs (default: true) */
  enableBatching?: boolean;
  /** Number of logs to batch together (default: 10, max: 10) */
  batchSize?: number;
  /** Interval in milliseconds to send batched logs (default: 5000) */
  batchInterval?: number;
  /** Maximum requests per 60 seconds (default: 30, Discord limit) */
  rateLimit?: number;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

interface DiscordMessage {
  embeds: DiscordEmbed[];
  username?: string;
}

interface QueuedLog {
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Winston transport that sends logs to Discord via webhook with rate limiting and batching.
 *
 * Features:
 * - Rate limiting: Respects Discord's 30 requests per 60 seconds limit
 * - Batching: Groups up to 10 logs into a single Discord message
 * - Error handling: Never throws errors that could crash the app
 * - Color coding: Red (error), Yellow (warn), Blue (info), Gray (debug)
 * - Metadata support: Formats complex objects as Discord embed fields
 * - Auto-truncation: Handles Discord's character limits (2000 chars per field)
 *
 * @example
 * ```typescript
 * import { Logger } from './logger.js';
 * import { DiscordLogsTransport } from './discord-logs-transport.js';
 *
 * const transport = new DiscordLogsTransport({
 *   webhookUrl: 'https://discord.com/api/webhooks/YOUR_WEBHOOK',
 *   level: 'info',
 *   username: 'Trading Bot Logs',
 * });
 *
 * const logger = new Logger({
 *   transports: ['console', 'discord'],
 * });
 *
 * logger.addTransport('discord', transport);
 * logger.info('Bot started');
 * ```
 */
export class DiscordLogsTransport extends Transport {
  private webhookUrl: string;
  private username: string;
  private enableBatching: boolean;
  private batchSize: number;
  private batchInterval: number;
  private rateLimit: number;

  private logQueue: QueuedLog[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private requestTimestamps: number[] = [];
  private isProcessing: boolean = false;

  private static readonly COLORS = {
    error: 0xff0000, // Red
    warn: 0xffcc00, // Yellow
    info: 0x0099ff, // Blue
    debug: 0x808080, // Gray
  } as const;

  private static readonly EMOJIS = {
    error: "🔴",
    warn: "🟡",
    info: "🔵",
    debug: "⚪",
  } as const;

  constructor(opts: DiscordLogsTransportOptions) {
    super(opts);
    this.webhookUrl = opts.webhookUrl;
    this.username = opts.username || "Bot Logs";
    this.level = opts.level || "info";
    this.enableBatching = opts.enableBatching ?? true;
    this.batchSize = opts.batchSize || 10;
    this.batchInterval = opts.batchInterval || 5000;
    this.rateLimit = opts.rateLimit || 30; // Discord: 30 requests per 60 seconds

    if (this.enableBatching) {
      this.startBatchTimer();
    }
  }

  /**
   * Strip ANSI color codes from a string
   * Winston's colorize format adds codes like \u001b[32m that show up as [32m in Discord
   */
  private stripAnsiCodes(text: string): string {
    const ansiPattern = new RegExp(
      String.fromCharCode(27) + "\\[[0-9;]*m",
      "g",
    );
    return text.replace(ansiPattern, "");
  }

  async log(info: LogEntry, callback: () => void): Promise<void> {
    setImmediate(() => {
      this.emit("logged", info);
    });

    const queuedLog: QueuedLog = {
      level: this.stripAnsiCodes(String(info.level || "info")),
      message: this.stripAnsiCodes(String(info.message || "")),
      metadata: this.extractMetadata(info),
      timestamp: new Date().toISOString(),
    };

    if (this.enableBatching) {
      this.queueLog(queuedLog);
    } else {
      this.sendLog(queuedLog).catch((error: Error) => {
        process.stderr.write(`Discord transport error: ${error.message}\n`);
      });
    }

    callback();
  }

  private extractMetadata(info: LogEntry): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    const excludeKeys = ["level", "message", "timestamp"];

    for (const [key, value] of Object.entries(info)) {
      if (!excludeKeys.includes(key) && !String(key).startsWith("Symbol(")) {
        metadata[key] = value;
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private queueLog(log: QueuedLog): void {
    this.logQueue.push(log);

    if (this.logQueue.length >= this.batchSize) {
      this.processBatch().catch((error: Error) => {
        process.stderr.write(
          `Discord batch processing error: ${error.message}\n`,
        );
      });
    }
  }

  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => {
      this.processBatch().catch((error: Error) => {
        process.stderr.write(`Discord batch timer error: ${error.message}\n`);
      });
    }, this.batchInterval);
  }

  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.logQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const logsToProcess = this.logQueue.splice(0, this.batchSize);
      await this.sendBatchLogs(logsToProcess);
    } finally {
      this.isProcessing = false;
    }
  }

  private async sendLog(log: QueuedLog): Promise<void> {
    if (!this.checkRateLimit()) {
      this.queueLog(log);
      return;
    }

    const embed = this.createEmbed(log);
    const message: DiscordMessage = {
      embeds: [embed],
      username: this.username,
    };

    await this.sendToWebhook(message);
  }

  private async sendBatchLogs(logs: QueuedLog[]): Promise<void> {
    if (logs.length === 0) {
      return;
    }

    if (!this.checkRateLimit()) {
      this.logQueue.unshift(...logs);
      return;
    }

    // Discord supports up to 10 embeds per message
    const embeds = logs.slice(0, 10).map((log) => this.createEmbed(log));

    const message: DiscordMessage = {
      embeds,
      username: this.username,
    };

    await this.sendToWebhook(message);

    // Re-queue remaining logs
    if (logs.length > 10) {
      this.logQueue.unshift(...logs.slice(10));
    }
  }

  private createEmbed(log: QueuedLog): DiscordEmbed {
    const level = log.level as keyof typeof DiscordLogsTransport.COLORS;
    const color =
      DiscordLogsTransport.COLORS[level] || DiscordLogsTransport.COLORS.info;
    const emoji = DiscordLogsTransport.EMOJIS[level] || "📝";

    const embed: DiscordEmbed = {
      title: `${emoji} ${log.level.toUpperCase()}`,
      description: this.truncateText(log.message, 2000),
      color,
      timestamp: log.timestamp,
      footer: {
        text: "Bot Logs",
      },
    };

    if (log.metadata && Object.keys(log.metadata).length > 0) {
      embed.fields = this.createFieldsFromMetadata(log.metadata);
    }

    return embed;
  }

  private createFieldsFromMetadata(
    metadata: Record<string, unknown>,
  ): DiscordEmbed["fields"] {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue;
      }

      let fieldValue: string;

      if (typeof value === "object") {
        try {
          fieldValue = JSON.stringify(value, null, 2);
        } catch {
          fieldValue = "[Circular Reference]";
        }
      } else {
        fieldValue = String(value);
      }

      fieldValue = this.truncateText(fieldValue, 1024);

      // Format code blocks for readability
      if (fieldValue.includes("\n") || fieldValue.includes("{")) {
        fieldValue = `\`\`\`\n${fieldValue}\n\`\`\``;
      }

      fields.push({
        name: this.truncateText(key, 256),
        value: fieldValue,
        inline: false,
      });

      if (fields.length >= 25) {
        break;
      }
    }

    return fields;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + "...";
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const windowMs = 60000; // 60 seconds

    // Remove old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < windowMs,
    );

    if (this.requestTimestamps.length >= this.rateLimit) {
      return false;
    }

    this.requestTimestamps.push(now);
    return true;
  }

  private async sendToWebhook(message: DiscordMessage): Promise<void> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Discord webhook failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }
    } catch (error) {
      process.stderr.write(
        `Discord webhook error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      throw error;
    }
  }

  close(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush remaining logs
    if (this.logQueue.length > 0) {
      const logsToFlush = [...this.logQueue];
      this.logQueue = [];

      const embeds = logsToFlush
        .slice(0, 10)
        .map((log) => this.createEmbed(log));
      const message: DiscordMessage = {
        embeds,
        username: this.username,
      };

      // Send synchronously on close
      fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      }).catch((error: Error) => {
        process.stderr.write(
          `Failed to flush Discord logs on close: ${error.message}\n`,
        );
      });
    }

    if (super.close) {
      super.close();
    }
  }
}
