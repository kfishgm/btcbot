/**
 * Mock Discord Notifier for E2E Tests
 *
 * Implements the same interface as DiscordNotifier but doesn't send actual notifications.
 * Captures all notification attempts for assertion in tests.
 */

import type { AlertSeverity } from "../../../src/notifications/discord-notifier.js";

export interface BuyExecutionData {
  price: number;
  amount: number;
  btcQuantity: number;
  capitalRemaining: number;
  purchasesRemaining: number;
  referencePrice: number | null;
}

export interface SellExecutionData {
  price: number;
  amount: number;
  btcQuantity: number;
  profit: number;
  referencePrice: number | null;
}

export interface CycleCompletionData {
  totalProfit: number;
  btcRemaining: number;
  btcRemainingValue: number;
  totalValue: number;
  cycleStats: {
    duration: number;
    totalBuys: number;
    totalSells: number;
    avgBuyPrice: number;
    avgSellPrice: number;
  };
}

export interface StrategyPausedData {
  reason: string;
  details: {
    currentPrice?: number;
    drift?: number;
    maxDrift?: number;
    [key: string]: unknown;
  };
}

export interface MockNotification {
  type: string;
  severity?: AlertSeverity;
  message?: string;
  details?:
    | BuyExecutionData
    | SellExecutionData
    | CycleCompletionData
    | StrategyPausedData
    | { reason: string };
  timestamp: Date;
}

export class MockDiscordNotifier {
  private notifications: MockNotification[] = [];
  private isEnabled: boolean = true;

  constructor(_config?: { webhookUrl?: string }) {
    // Accept config for compatibility but don't use it
    // Tests should not send real Discord messages
  }

  /**
   * Mock sendAlert - captures alert notifications
   */
  async sendAlert(
    severity: AlertSeverity,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isEnabled) return;

    this.notifications.push({
      type: "alert",
      severity,
      message,
      details: details as unknown as StrategyPausedData,
      timestamp: new Date(),
    });
    return Promise.resolve();
  }

  /**
   * Mock notifyBuyExecution - captures buy notifications
   */
  async notifyBuyExecution(data: BuyExecutionData): Promise<void> {
    if (!this.isEnabled) return;

    this.notifications.push({
      type: "buy_execution",
      details: data,
      timestamp: new Date(),
    });
    return Promise.resolve();
  }

  /**
   * Mock notifySellExecution - captures sell notifications
   */
  async notifySellExecution(data: SellExecutionData): Promise<void> {
    if (!this.isEnabled) return;

    this.notifications.push({
      type: "sell_execution",
      details: data,
      timestamp: new Date(),
    });
    return Promise.resolve();
  }

  /**
   * Mock notifyCycleCompletion - captures cycle completion notifications
   */
  async notifyCycleCompletion(data: CycleCompletionData): Promise<void> {
    if (!this.isEnabled) return;

    this.notifications.push({
      type: "cycle_completion",
      details: data,
      timestamp: new Date(),
    });
    return Promise.resolve();
  }

  /**
   * Mock notifyStrategyPaused - captures pause notifications
   */
  async notifyStrategyPaused(data: StrategyPausedData): Promise<void> {
    if (!this.isEnabled) return;

    this.notifications.push({
      type: "strategy_paused",
      details: data,
      timestamp: new Date(),
    });
    return Promise.resolve();
  }

  /**
   * Mock notifyStrategyResumed - captures resume notifications
   */
  async notifyStrategyResumed(data: { reason: string }): Promise<void> {
    if (!this.isEnabled) return;

    this.notifications.push({
      type: "strategy_resumed",
      details: data,
      timestamp: new Date(),
    });
    return Promise.resolve();
  }

  /**
   * Get all captured notifications
   */
  getNotifications(): MockNotification[] {
    return [...this.notifications];
  }

  /**
   * Get notifications by type
   */
  getNotificationsByType(type: string): MockNotification[] {
    return this.notifications.filter((n) => n.type === type);
  }

  /**
   * Clear all captured notifications
   */
  clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * Get count of notifications
   */
  getNotificationCount(): number {
    return this.notifications.length;
  }

  /**
   * Disable/enable the mock notifier
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Get the last notification
   */
  getLastNotification(): MockNotification | undefined {
    return this.notifications[this.notifications.length - 1];
  }

  /**
   * Assert no notifications were sent
   */
  expectNoNotifications(): void {
    if (this.notifications.length > 0) {
      throw new Error(
        `Expected no notifications but found ${this.notifications.length}: ${JSON.stringify(this.notifications)}`,
      );
    }
  }

  /**
   * Assert specific notification was sent
   */
  expectNotification(
    type: string,
    details?: Partial<
      BuyExecutionData | SellExecutionData | CycleCompletionData
    >,
  ): void {
    const notification = this.notifications.find((n) => n.type === type);
    if (!notification) {
      throw new Error(
        `Expected notification of type '${type}' but found none. Notifications: ${JSON.stringify(this.notifications)}`,
      );
    }

    if (
      details &&
      notification.details &&
      typeof notification.details === "object"
    ) {
      for (const [key, value] of Object.entries(details)) {
        const notificationDetail = (
          notification.details as Record<string, unknown>
        )[key];
        if (notificationDetail !== value) {
          throw new Error(
            `Expected notification detail '${key}' to be '${value}' but was '${notificationDetail}'`,
          );
        }
      }
    }
  }
}
