import { SupabaseClient } from "@supabase/supabase-js";
import { Logger } from "../utils/logger";

export interface EventLoggerConfig {
  supabase: SupabaseClient;
  logger: Logger;
  batchSize?: number;
  flushInterval?: number;
  testRunId?: string;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export interface BaseEvent {
  event_type: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message?: string;
  metadata?: Record<string, unknown>;
  created_at?: Date;
}

export interface TradeEvent {
  type: "BUY" | "SELL";
  symbol: string;
  price: number;
  quantity: number;
  cycleId: string;
  purchaseNumber?: number;
  fees?: number;
  profit?: number;
  profitPercentage?: number;
}

export interface FailedTradeEvent {
  type: "BUY" | "SELL";
  symbol: string;
  attemptedPrice: number;
  attemptedQuantity: number;
  error: string;
  cycleId: string;
}

export interface SystemEvent {
  type:
    | "START"
    | "STOP"
    | "ERROR"
    | "WEBSOCKET_CONNECTED"
    | "WEBSOCKET_DISCONNECTED"
    | "CONFIG_UPDATED";
  details?: unknown;
  error?: Error;
}

export interface DriftHaltEvent {
  symbol: string;
  currentPrice: number;
  referencePrice: number;
  driftPercentage: number;
  maxAllowedDrift: number;
}

export interface CycleMetrics {
  cycleId: string;
  duration: number;
  tradesExecuted: number;
  totalProfit: number;
  profitPercentage: number;
  startTime: Date;
  endTime: Date;
}

export interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  eventLatency: number;
  databaseLatency: number;
  timestamp: Date;
}

export interface StrategyMetrics {
  winRate: number;
  totalVolume: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  period: string;
}

export interface EventClassification {
  severity: "INFO" | "WARNING" | "ERROR";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "severity";
  orderDirection?: "ASC" | "DESC";
}

interface QueuedEvent extends BaseEvent {
  id: string;
  timestamp: number;
  retryCount?: number;
}

export class EventLogger {
  private supabase: SupabaseClient;
  private logger: Logger;
  private batchSize: number;
  private flushInterval: number;
  private testRunId?: string;
  private retryAttempts: number;
  private retryDelayMs: number;

  private eventQueue: QueuedEvent[] = [];
  private flushTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private offlineQueueEnabled = false;
  private offlineQueue: QueuedEvent[] = [];
  private deduplicationEnabled = false;
  private deduplicationWindowMs = 5000;
  private recentEvents: Map<string, number> = new Map();
  private globalContext: Record<string, unknown> = {};
  private customEventTypes: Map<string, EventClassification> = new Map();

  constructor(config: EventLoggerConfig) {
    this.supabase = config.supabase;
    this.logger = config.logger;
    this.batchSize = config.batchSize ?? 10;
    this.flushInterval = config.flushInterval ?? 5000;
    this.testRunId = config.testRunId;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;

    this.initializeDefaultEventTypes();
    this.startFlushTimer();
  }

  private initializeDefaultEventTypes(): void {
    // Trade events
    this.customEventTypes.set("TRADE_EXECUTED", {
      severity: "INFO",
      priority: "HIGH",
      category: "TRADING",
    });
    this.customEventTypes.set("TRADE_FAILED", {
      severity: "ERROR",
      priority: "HIGH",
      category: "TRADING",
    });

    // System events
    this.customEventTypes.set("START", {
      severity: "INFO",
      priority: "MEDIUM",
      category: "SYSTEM",
    });
    this.customEventTypes.set("STOP", {
      severity: "INFO",
      priority: "MEDIUM",
      category: "SYSTEM",
    });
    this.customEventTypes.set("ERROR", {
      severity: "ERROR",
      priority: "CRITICAL",
      category: "SYSTEM",
    });
    this.customEventTypes.set("WEBSOCKET_CONNECTED", {
      severity: "INFO",
      priority: "LOW",
      category: "SYSTEM",
    });
    this.customEventTypes.set("WEBSOCKET_DISCONNECTED", {
      severity: "WARNING",
      priority: "MEDIUM",
      category: "SYSTEM",
    });
    this.customEventTypes.set("DRIFT_HALT", {
      severity: "WARNING",
      priority: "HIGH",
      category: "TRADING",
    });
    this.customEventTypes.set("CONFIG_UPDATED", {
      severity: "INFO",
      priority: "LOW",
      category: "SYSTEM",
    });

    // Metric events
    this.customEventTypes.set("CYCLE_COMPLETE", {
      severity: "INFO",
      priority: "MEDIUM",
      category: "METRICS",
    });
    this.customEventTypes.set("PERFORMANCE_METRICS", {
      severity: "INFO",
      priority: "LOW",
      category: "METRICS",
    });
    this.customEventTypes.set("STRATEGY_METRICS", {
      severity: "INFO",
      priority: "MEDIUM",
      category: "METRICS",
    });
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush().catch((error) => {
          this.logger.error("Failed to flush events", { error });
        });
      }
    }, this.flushInterval);
  }

  private generateEventId(event: BaseEvent): string {
    const key = `${event.event_type}-${event.message || ""}-${JSON.stringify(event.metadata || {})}`;
    return Buffer.from(key).toString("base64");
  }

  private isDuplicateEvent(event: BaseEvent): boolean {
    if (!this.deduplicationEnabled) return false;

    const eventId = this.generateEventId(event);
    const lastSeen = this.recentEvents.get(eventId);
    const now = Date.now();

    if (lastSeen && now - lastSeen < this.deduplicationWindowMs) {
      return true;
    }

    this.recentEvents.set(eventId, now);

    // Cleanup old entries
    for (const [id, timestamp] of this.recentEvents.entries()) {
      if (now - timestamp > this.deduplicationWindowMs * 2) {
        this.recentEvents.delete(id);
      }
    }

    return false;
  }

  private enrichEvent(event: BaseEvent): BaseEvent {
    return {
      ...event,
      metadata: {
        ...this.globalContext,
        ...event.metadata,
        ...(this.testRunId ? { testRunId: this.testRunId } : {}),
      },
      created_at: event.created_at || new Date(),
    };
  }

  async queueEvent(event: BaseEvent): Promise<void> {
    if (this.isDuplicateEvent(event)) {
      return;
    }

    const enrichedEvent = this.enrichEvent(event);
    const queuedEvent: QueuedEvent = {
      ...enrichedEvent,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
    };

    this.eventQueue.push(queuedEvent);

    if (this.eventQueue.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const eventsToFlush = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.insertBatch(eventsToFlush);
    } catch (error) {
      if (this.offlineQueueEnabled) {
        this.offlineQueue.push(...eventsToFlush);
        this.logger.warn("Database unavailable, queued events offline", {
          queueSize: this.offlineQueue.length,
        });
      } else {
        // Retry logic
        for (const event of eventsToFlush) {
          event.retryCount = (event.retryCount || 0) + 1;
          if (event.retryCount < this.retryAttempts) {
            this.eventQueue.push(event);
          } else {
            this.logger.error("Failed to log event after retries", {
              event,
              error,
            });
          }
        }
      }
    }
  }

  private async insertBatch(events: QueuedEvent[]): Promise<void> {
    const eventsToInsert = events.map((event) => ({
      event_type: event.event_type,
      severity: event.severity,
      message: event.message || null,
      metadata: event.metadata || null,
      created_at: event.created_at?.toISOString() || new Date().toISOString(),
    }));

    const { error } = await this.supabase
      .from("bot_events")
      .insert(eventsToInsert);

    if (error) {
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.flush();

    if (this.offlineQueue.length > 0) {
      this.logger.warn(
        `Shutdown with ${this.offlineQueue.length} events in offline queue`,
      );
    }
  }

  // Trade event logging methods
  async logTradeExecuted(event: TradeEvent): Promise<void> {
    await this.queueEvent({
      event_type: "TRADE_EXECUTED",
      severity: "INFO",
      message: `${event.type} order executed: ${event.quantity} ${event.symbol} @ ${event.price}`,
      metadata: {
        type: event.type,
        symbol: event.symbol,
        price: event.price,
        quantity: event.quantity,
        cycleId: event.cycleId,
        purchaseNumber: event.purchaseNumber,
        fees: event.fees,
        profit: event.profit,
        profitPercentage: event.profitPercentage,
      },
    });
  }

  async logTradeFailed(event: FailedTradeEvent): Promise<void> {
    await this.queueEvent({
      event_type: "TRADE_FAILED",
      severity: "ERROR",
      message: `Failed to execute ${event.type} order: ${event.error}`,
      metadata: {
        type: event.type,
        symbol: event.symbol,
        attemptedPrice: event.attemptedPrice,
        attemptedQuantity: event.attemptedQuantity,
        error: event.error,
        cycleId: event.cycleId,
      },
    });
  }

  // System event logging methods
  async logSystemStart(config: unknown): Promise<void> {
    await this.queueEvent({
      event_type: "START",
      severity: "INFO",
      message: "Bot started",
      metadata: { config },
    });
  }

  async logSystemStop(reason: unknown): Promise<void> {
    await this.queueEvent({
      event_type: "STOP",
      severity: "INFO",
      message: "Bot stopped",
      metadata: { reason },
    });
  }

  async logSystemError(error: unknown): Promise<void> {
    const errorDetails =
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : { error: String(error) };

    await this.queueEvent({
      event_type: "ERROR",
      severity: "ERROR",
      message: error instanceof Error ? error.message : "System error occurred",
      metadata: errorDetails,
    });
  }

  async logWebsocketEvent(event: {
    connected: boolean;
    details?: unknown;
  }): Promise<void> {
    await this.queueEvent({
      event_type: event.connected
        ? "WEBSOCKET_CONNECTED"
        : "WEBSOCKET_DISCONNECTED",
      severity: event.connected ? "INFO" : "WARNING",
      message: event.connected
        ? "WebSocket connected"
        : "WebSocket disconnected",
      metadata: { details: event.details },
    });
  }

  async logDriftHalt(event: DriftHaltEvent): Promise<void> {
    await this.queueEvent({
      event_type: "DRIFT_HALT",
      severity: "WARNING",
      message: `Price drift detected: ${event.driftPercentage.toFixed(2)}% drift on ${event.symbol}`,
      metadata: {
        symbol: event.symbol,
        currentPrice: event.currentPrice,
        referencePrice: event.referencePrice,
        driftPercentage: event.driftPercentage,
        maxAllowedDrift: event.maxAllowedDrift,
      },
    });
  }

  async logConfigUpdate(update: unknown): Promise<void> {
    await this.queueEvent({
      event_type: "CONFIG_UPDATED",
      severity: "INFO",
      message: "Configuration updated",
      metadata: { update },
    });
  }

  // Metric logging methods
  async logCycleComplete(metrics: CycleMetrics): Promise<void> {
    await this.queueEvent({
      event_type: "CYCLE_COMPLETE",
      severity: "INFO",
      message: `Cycle ${metrics.cycleId} completed with ${metrics.profitPercentage.toFixed(2)}% profit`,
      metadata: metrics,
    });
  }

  async logPerformanceMetrics(metrics: PerformanceMetrics): Promise<void> {
    await this.queueEvent({
      event_type: "PERFORMANCE_METRICS",
      severity: "INFO",
      message: "Performance metrics recorded",
      metadata: metrics,
    });
  }

  async logStrategyMetrics(metrics: StrategyMetrics): Promise<void> {
    await this.queueEvent({
      event_type: "STRATEGY_METRICS",
      severity: "INFO",
      message: `Strategy metrics for ${metrics.period}`,
      metadata: metrics,
    });
  }

  // Custom event logging
  async logCustomEvent(event: BaseEvent): Promise<void> {
    await this.queueEvent(event);
  }

  // Classification methods
  classifyEvent(type: string): EventClassification {
    return (
      this.customEventTypes.get(type) || {
        severity: "INFO",
        priority: "LOW",
        category: "UNKNOWN",
      }
    );
  }

  registerEventType(type: string, classification: EventClassification): void {
    this.customEventTypes.set(type, classification);
  }

  // Query methods
  async getEventsByType(
    type: string,
    options: QueryOptions = {},
  ): Promise<BaseEvent[]> {
    const query = this.supabase
      .from("bot_events")
      .select("*")
      .eq("event_type", type);

    if (this.testRunId) {
      query.eq("metadata->testRunId", this.testRunId);
    }

    if (options.limit) {
      query.limit(options.limit);
    }

    if (options.offset) {
      query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const orderBy = options.orderBy || "created_at";
    const orderDirection = options.orderDirection === "ASC";
    query.order(orderBy, { ascending: orderDirection });

    const { data, error } = await query;

    if (error) {
      this.logger.error("Failed to query events by type", { error, type });
      throw error;
    }

    return data || [];
  }

  async getEventsBySeverity(
    severity: string,
    options: QueryOptions = {},
  ): Promise<BaseEvent[]> {
    const query = this.supabase
      .from("bot_events")
      .select("*")
      .eq("severity", severity);

    if (this.testRunId) {
      query.eq("metadata->testRunId", this.testRunId);
    }

    if (options.limit) {
      query.limit(options.limit);
    }

    if (options.offset) {
      query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const orderBy = options.orderBy || "created_at";
    const orderDirection = options.orderDirection === "ASC";
    query.order(orderBy, { ascending: orderDirection });

    const { data, error } = await query;

    if (error) {
      this.logger.error("Failed to query events by severity", {
        error,
        severity,
      });
      throw error;
    }

    return data || [];
  }

  async getEventsByTimeRange(start: Date, end: Date): Promise<BaseEvent[]> {
    const query = this.supabase
      .from("bot_events")
      .select("*")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());

    if (this.testRunId) {
      query.eq("metadata->testRunId", this.testRunId);
    }

    query.order("created_at", { ascending: true });

    const { data, error } = await query;

    if (error) {
      this.logger.error("Failed to query events by time range", {
        error,
        start,
        end,
      });
      throw error;
    }

    return data || [];
  }

  async getEventsByCycle(cycleId: string): Promise<BaseEvent[]> {
    const query = this.supabase
      .from("bot_events")
      .select("*")
      .eq("metadata->cycleId", cycleId);

    if (this.testRunId) {
      query.eq("metadata->testRunId", this.testRunId);
    }

    query.order("created_at", { ascending: true });

    const { data, error } = await query;

    if (error) {
      this.logger.error("Failed to query events by cycle", { error, cycleId });
      throw error;
    }

    return data || [];
  }

  async getAggregatedMetrics(
    start: Date,
    end: Date,
  ): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsBySeverity: Record<string, number>;
    cyclesCompleted: number;
    totalProfit: number;
    averageProfit: number;
    errorRate: number;
  }> {
    const events = await this.getEventsByTimeRange(start, end);

    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};
    let cyclesCompleted = 0;
    let totalProfit = 0;
    let errorCount = 0;

    for (const event of events) {
      // Count by type
      eventsByType[event.event_type] =
        (eventsByType[event.event_type] || 0) + 1;

      // Count by severity
      eventsBySeverity[event.severity] =
        (eventsBySeverity[event.severity] || 0) + 1;

      // Track cycles and profit
      if (event.event_type === "CYCLE_COMPLETE" && event.metadata) {
        cyclesCompleted++;
        const metadata = event.metadata as { totalProfit?: number };
        totalProfit += metadata.totalProfit || 0;
      }

      // Count errors
      if (event.severity === "ERROR") {
        errorCount++;
      }
    }

    return {
      totalEvents: events.length,
      eventsByType,
      eventsBySeverity,
      cyclesCompleted,
      totalProfit,
      averageProfit: cyclesCompleted > 0 ? totalProfit / cyclesCompleted : 0,
      errorRate: events.length > 0 ? errorCount / events.length : 0,
    };
  }

  // Feature control methods
  enableOfflineQueue(enabled: boolean): void {
    this.offlineQueueEnabled = enabled;
  }

  getOfflineQueueSize(): number {
    return this.offlineQueue.length;
  }

  async retryOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) return;

    const queueToRetry = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const event of queueToRetry) {
      try {
        await this.insertBatch([event]);
      } catch (error) {
        this.offlineQueue.push(event);
      }
    }
  }

  enableDeduplication(enabled: boolean, windowMs = 5000): void {
    this.deduplicationEnabled = enabled;
    this.deduplicationWindowMs = windowMs;
    if (!enabled) {
      this.recentEvents.clear();
    }
  }

  setGlobalContext(context: Record<string, unknown>): void {
    this.globalContext = context;
  }
}
