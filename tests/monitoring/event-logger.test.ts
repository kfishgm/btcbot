import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { EventLogger } from "../../src/monitoring/event-logger.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../../types/supabase.js";
import { Logger } from "../../src/utils/logger.js";

// Mock the dependencies
jest.mock("@supabase/supabase-js");
jest.mock("../../src/utils/logger.js");

describe("EventLogger", () => {
  let eventLogger: EventLogger;
  let mockSupabase: jest.Mocked<SupabaseClient<Database>>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock Supabase client with proper typing
    const mockFrom = jest.fn();
    const mockInsert = jest.fn();
    const mockSelect = jest.fn();
    const mockEq = jest.fn();
    const mockGte = jest.fn();
    const mockLte = jest.fn();
    const mockOrder = jest.fn();
    const mockLimit = jest.fn();
    const mockContains = jest.fn();

    // Chain the methods properly
    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: mockSelect,
      eq: mockEq,
      gte: mockGte,
      lte: mockLte,
      order: mockOrder,
      limit: mockLimit,
      contains: mockContains,
    });

    mockInsert.mockReturnValue({
      select: mockSelect,
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
      gte: mockGte,
      lte: mockLte,
      order: mockOrder,
      limit: mockLimit,
      contains: mockContains,
    });

    mockEq.mockReturnValue({
      order: mockOrder,
      limit: mockLimit,
      gte: mockGte,
      lte: mockLte,
    });

    mockGte.mockReturnValue({
      lte: mockLte,
      order: mockOrder,
    });

    mockLte.mockReturnValue({
      order: mockOrder,
    });

    mockOrder.mockReturnValue({
      limit: mockLimit,
    });

    mockContains.mockReturnValue({
      order: mockOrder,
    });

    mockSupabase = {
      from: mockFrom,
    } as unknown as jest.Mocked<SupabaseClient<Database>>;

    (createClient as jest.Mock).mockReturnValue(mockSupabase);

    // Setup mock logger with proper typing
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Initialize EventLogger
    eventLogger = new EventLogger({
      supabase: mockSupabase,
      logger: mockLogger,
      batchSize: 10,
      flushInterval: 1000,
    });
  });

  afterEach(() => {
    // Clean up any timers
    eventLogger.shutdown();
  });

  describe("Trade Event Logging", () => {
    it("should log buy order events with complete trade context", async () => {
      const tradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        price: 50000.0,
        quantity: 0.002,
        cycleId: "cycle-uuid-123",
        purchaseNumber: 3,
        fees: 0.000002,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-1" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logTradeExecuted(tradeEvent);

      expect(mockSupabase.from).toHaveBeenCalledWith("bot_events");
      // The implementation uses batch insert, so it's called with an array
      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: "TRADE_EXECUTED",
            severity: "INFO",
            message: expect.stringContaining("BUY order executed"),
            metadata: expect.objectContaining({
              type: "BUY",
              symbol: "BTC/USDT",
              price: 50000.0,
              quantity: 0.002,
              cycleId: "cycle-uuid-123",
              purchaseNumber: 3,
              fees: 0.000002,
            }),
          }),
        ]),
      );
    });

    it("should log sell order events with profit/loss calculation", async () => {
      const sellEvent = {
        type: "SELL" as const,
        symbol: "BTC/USDT",
        price: 55000.0,
        quantity: 0.01,
        cycleId: "cycle-uuid-123",
        fees: 0.55,
        profit: 50.0,
        profitPercentage: 10.0,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-2" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logTradeExecuted(sellEvent);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: expect.stringContaining("SELL order executed"),
        metadata: expect.objectContaining({
          profit: 50.0,
          profitPercentage: 10.0,
        }),
      });
    });

    it("should handle failed trade attempts", async () => {
      const failedTrade = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        attemptedPrice: 50000.0,
        attemptedQuantity: 0.002,
        error: "Insufficient balance",
        cycleId: "cycle-uuid-123",
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-3" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logTradeFailed(failedTrade);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "TRADE_FAILED",
        severity: "ERROR",
        message: expect.stringContaining("Trade failed"),
        metadata: expect.objectContaining({
          orderId: "ORDER-789",
          error: {
            message: "Insufficient balance",
            stack: expect.any(String),
          },
        }),
      });
    });
  });

  describe("System Event Logging", () => {
    it("should log bot startup events with configuration", async () => {
      const startupConfig = {
        version: "1.0.0",
        environment: "production",
        tradingPair: "BTCUSDT",
        strategy: {
          dropPercentage: 0.03,
          risePercentage: 0.05,
          maxPurchases: 10,
        },
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-4" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logSystemStart(startupConfig);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "START",
        severity: "INFO",
        message: "Bot started",
        metadata: expect.objectContaining(startupConfig),
      });
    });

    it("should log bot shutdown events with reason", async () => {
      const shutdownReason = {
        reason: "User initiated",
        runtime: 3600000, // 1 hour in ms
        tradesExecuted: 5,
        finalState: "HOLDING",
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-5" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logSystemStop(shutdownReason);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "STOP",
        severity: "INFO",
        message: "Bot stopped",
        metadata: expect.objectContaining(shutdownReason),
      });
    });

    it("should log system errors with full context", async () => {
      const systemError = {
        error: new Error("Database connection failed"),
        context: {
          operation: "fetching cycle state",
          retryCount: 3,
          lastAttempt: new Date().toISOString(),
        },
        severity: "ERROR" as const,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-6" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logSystemError(systemError);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "ERROR",
        severity: "ERROR",
        message: "System error: Database connection failed",
        metadata: expect.objectContaining({
          error: {
            message: "Database connection failed",
            stack: expect.any(String),
          },
          context: systemError.context,
        }),
      });
    });

    it("should log websocket connection events", async () => {
      const wsEvent = {
        connected: true,
        details: {
          url: "wss://stream.binance.com:9443/ws",
          reconnectCount: 0,
        },
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-7" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logWebsocketEvent(wsEvent);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "WEBSOCKET_CONNECTED",
        severity: "INFO",
        message: "WebSocket connected",
        metadata: expect.objectContaining({
          url: "wss://stream.binance.com:9443/ws",
          reconnectCount: 0,
        }),
      });
    });

    it("should log drift halt events", async () => {
      const driftEvent = {
        symbol: "BTC/USDT",
        referencePrice: 50000.0,
        currentPrice: 48000.0,
        driftPercentage: -4.0,
        maxAllowedDrift: 3.0,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-8" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logDriftHalt(driftEvent);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "DRIFT_HALT",
        severity: "WARNING",
        message: expect.stringContaining("Drift halt triggered"),
        metadata: expect.objectContaining(driftEvent),
      });
    });
  });

  describe("Metric Event Logging", () => {
    it("should log cycle completion metrics", async () => {
      const cycleMetrics = {
        cycleId: "cycle-uuid-123",
        duration: 7200000, // 2 hours
        tradesExecuted: 10,
        totalProfit: 100.0,
        profitPercentage: 10.0,
        startTime: new Date("2024-01-01T00:00:00Z"),
        endTime: new Date("2024-01-01T02:00:00Z"),
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-9" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logCycleComplete(cycleMetrics);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "CYCLE_COMPLETE",
        severity: "INFO",
        message: expect.stringContaining("Cycle completed"),
        metadata: expect.objectContaining(cycleMetrics),
      });
    });

    it("should log performance metrics periodically", async () => {
      const performanceMetrics = {
        cpuUsage: 45.2,
        memoryUsage: 67.8,
        eventLatency: 120,
        databaseLatency: 50,
        timestamp: new Date(),
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-10" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logPerformanceMetrics(performanceMetrics);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "PERFORMANCE_METRICS",
        severity: "INFO",
        message: "Performance metrics",
        metadata: expect.objectContaining(performanceMetrics),
      });
    });

    it("should log strategy performance metrics", async () => {
      const strategyMetrics = {
        period: "24h",
        totalTrades: 50,
        successfulTrades: 45,
        failedTrades: 5,
        totalVolume: 5000.0,
        totalProfit: 250.0,
        winRate: 0.9,
        averageProfit: 5.0,
        maxDrawdown: -2.5,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-id-11" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logStrategyMetrics(strategyMetrics);

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith({
        event_type: "STRATEGY_METRICS",
        severity: "INFO",
        message: "Strategy performance metrics",
        metadata: expect.objectContaining(strategyMetrics),
      });
    });
  });

  describe("Batch Insert Optimization", () => {
    it("should batch multiple events for efficient insertion", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "batch-1" }, { id: "batch-2" }, { id: "batch-3" }],
            error: null,
          }),
        }),
      });

      // Queue multiple events
      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Trade 1",
        metadata: { orderId: "1" },
      });

      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Trade 2",
        metadata: { orderId: "2" },
      });

      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Trade 3",
        metadata: { orderId: "3" },
      });

      // Force flush
      await eventLogger.flush();

      // Should have made a single batch insert
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ message: "Trade 1" }),
          expect.objectContaining({ message: "Trade 2" }),
          expect.objectContaining({ message: "Trade 3" }),
        ]),
      );
    });

    it("should auto-flush when batch size is reached", async () => {
      // Create EventLogger with small batch size
      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 2,
        flushInterval: 10000, // Long interval to ensure auto-flush is from batch size
      });

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "batch-1" }, { id: "batch-2" }],
            error: null,
          }),
        }),
      });

      // Queue events up to batch size
      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Trade 1",
        metadata: { orderId: "1" },
      });

      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Trade 2",
        metadata: { orderId: "2" },
      });

      // Should have auto-flushed
      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledTimes(1);
    });

    it("should flush remaining events on shutdown", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "shutdown-1" }],
            error: null,
          }),
        }),
      });

      // Queue an event
      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Final trade",
        metadata: { orderId: "final" },
      });

      // Shutdown should flush
      await eventLogger.shutdown();

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ message: "Final trade" }),
        ]),
      );
    });

    it("should handle batch insert failures with retry logic", async () => {
      let attemptCount = 0;
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockImplementation(() => {
            attemptCount++;
            if (attemptCount === 1) {
              return Promise.resolve({
                data: null,
                error: { message: "Database timeout" },
              });
            }
            return Promise.resolve({
              data: [{ id: "retry-success" }],
              error: null,
            });
          }),
        }),
      });

      await eventLogger.queueEvent({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Trade with retry",
        metadata: { orderId: "retry-1" },
      });

      await eventLogger.flush();

      // Should have retried
      expect(attemptCount).toBe(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to insert events"),
        expect.any(Object),
      );
    });
  });

  describe("Event Classification", () => {
    it("should classify events by severity", () => {
      const classification = eventLogger.classifyEvent("ERROR");
      expect(classification).toEqual({
        severity: "ERROR",
        priority: "HIGH",
        requiresImmediate: true,
      });
    });

    it("should classify trade events", () => {
      const classification = eventLogger.classifyEvent("TRADE_EXECUTED");
      expect(classification).toEqual({
        severity: "INFO",
        priority: "MEDIUM",
        requiresImmediate: false,
      });
    });

    it("should classify drift events as warnings", () => {
      const classification = eventLogger.classifyEvent("DRIFT_HALT");
      expect(classification).toEqual({
        severity: "WARNING",
        priority: "HIGH",
        requiresImmediate: true,
      });
    });

    it("should support custom event type classification", () => {
      eventLogger.registerEventType("CUSTOM_ALERT", {
        severity: "WARNING",
        priority: "HIGH",
        category: "CUSTOM",
      });

      const classification = eventLogger.classifyEvent("CUSTOM_ALERT");
      expect(classification).toEqual({
        severity: "WARNING",
        priority: "HIGH",
        requiresImmediate: true,
      });
    });
  });

  describe("Query Methods", () => {
    it("should retrieve events by type", async () => {
      const mockEvents = [
        {
          id: "1",
          event_type: "TRADE_EXECUTED",
          severity: "INFO",
          message: "Trade 1",
          metadata: { orderId: "1" },
          created_at: new Date().toISOString(),
        },
        {
          id: "2",
          event_type: "TRADE_EXECUTED",
          severity: "INFO",
          message: "Trade 2",
          metadata: { orderId: "2" },
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: mockEvents,
                error: null,
              }),
            }),
          }),
        }),
      });

      const events = await eventLogger.getEventsByType("TRADE_EXECUTED", {
        limit: 10,
      });

      expect(events).toEqual(mockEvents);
      expect(mockSupabase.from).toHaveBeenCalledWith("bot_events");
      expect(
        mockSupabase.from("bot_events").select("*").eq,
      ).toHaveBeenCalledWith("event_type", "TRADE_EXECUTED");
    });

    it("should retrieve events by severity", async () => {
      const mockEvents = [
        {
          id: "1",
          event_type: "ERROR",
          severity: "ERROR",
          message: "Error 1",
          created_at: new Date().toISOString(),
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: mockEvents,
                error: null,
              }),
            }),
          }),
        }),
      });

      const events = await eventLogger.getEventsBySeverity("ERROR", {
        limit: 10,
      });

      expect(events).toEqual(mockEvents);
      expect(
        mockSupabase.from("bot_events").select("*").eq,
      ).toHaveBeenCalledWith("severity", "ERROR");
    });

    it("should retrieve events within a time range", async () => {
      const startTime = new Date("2024-01-01T00:00:00Z");
      const endTime = new Date("2024-01-02T00:00:00Z");

      const mockEvents = [
        {
          id: "1",
          event_type: "TRADE_EXECUTED",
          created_at: "2024-01-01T12:00:00Z",
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockEvents,
                error: null,
              }),
            }),
          }),
        }),
      });

      const events = await eventLogger.getEventsByTimeRange(startTime, endTime);

      expect(events).toEqual(mockEvents);
      expect(
        mockSupabase.from("bot_events").select("*").gte,
      ).toHaveBeenCalledWith("created_at", startTime.toISOString());
    });

    it("should retrieve events for a specific cycle", async () => {
      const cycleId = "cycle-uuid-123";
      const mockEvents = [
        {
          id: "1",
          event_type: "TRADE_EXECUTED",
          metadata: { cycleId },
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          contains: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: mockEvents,
              error: null,
            }),
          }),
        }),
      });

      const events = await eventLogger.getEventsByCycle(cycleId);

      expect(events).toEqual(mockEvents);
      expect(
        mockSupabase.from("bot_events").select("*").contains,
      ).toHaveBeenCalledWith("metadata", { cycleId });
    });

    it("should aggregate metrics for a time period", async () => {
      const mockEvents = [
        {
          event_type: "TRADE_EXECUTED",
          metadata: { type: "BUY", quoteQuantity: 100 },
        },
        {
          event_type: "TRADE_EXECUTED",
          metadata: { type: "BUY", quoteQuantity: 150 },
        },
        {
          event_type: "TRADE_EXECUTED",
          metadata: { type: "SELL", quoteQuantity: 300, profit: 50 },
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({
                data: mockEvents,
                error: null,
              }),
            }),
          }),
        }),
      });

      const metrics = await eventLogger.getAggregatedMetrics(
        new Date("2024-01-01"),
        new Date("2024-01-02"),
      );

      expect(metrics).toEqual({
        totalTrades: 3,
        buyOrders: 2,
        sellOrders: 1,
        totalVolume: 550,
        totalProfit: 50,
        averageProfit: 50,
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle database connection errors gracefully", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockRejectedValue(new Error("Connection refused")),
        }),
      });

      await eventLogger.logSystemStart({ version: "1.0.0" });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to log event"),
        expect.objectContaining({
          error: expect.any(Error),
        }),
      );
    });

    it("should queue events when database is unavailable", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest
            .fn()
            .mockRejectedValue(new Error("Database unavailable")),
        }),
      });

      eventLogger.enableOfflineQueue(true);

      await eventLogger.logSystemStart({ version: "1.0.0" });

      const queueSize = eventLogger.getOfflineQueueSize();
      expect(queueSize).toBe(1);
    });

    it("should retry failed events from offline queue", async () => {
      let attemptCount = 0;
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockImplementation(() => {
            attemptCount++;
            if (attemptCount === 1) {
              return Promise.reject(new Error("Database unavailable"));
            }
            return Promise.resolve({
              data: [{ id: "retry-success" }],
              error: null,
            });
          }),
        }),
      });

      eventLogger.enableOfflineQueue(true);

      await eventLogger.logSystemStart({ version: "1.0.0" });
      expect(eventLogger.getOfflineQueueSize()).toBe(1);

      await eventLogger.retryOfflineQueue();
      expect(eventLogger.getOfflineQueueSize()).toBe(0);
    });
  });

  describe("Event Deduplication", () => {
    it("should prevent duplicate events within time window", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-1" }],
            error: null,
          }),
        }),
      });

      const tradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        price: 50000.0,
        quantity: 0.002,
        cycleId: "cycle-123",
      };

      // Enable deduplication with 1 second window
      eventLogger.enableDeduplication(true, 1000);

      // Log the same event twice
      await eventLogger.logTradeExecuted(tradeEvent);
      await eventLogger.logTradeExecuted(tradeEvent);

      // Should only insert once
      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledTimes(1);
    });

    it("should allow duplicate events after time window expires", async () => {
      jest.useFakeTimers();

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-1" }],
            error: null,
          }),
        }),
      });

      const tradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        price: 50000.0,
        quantity: 0.002,
        cycleId: "cycle-123",
      };

      // Enable deduplication with 1 second window
      eventLogger.enableDeduplication(true, 1000);

      // Log event
      await eventLogger.logTradeExecuted(tradeEvent);

      // Advance time past deduplication window
      jest.advanceTimersByTime(1100);

      // Log same event again
      await eventLogger.logTradeExecuted(tradeEvent);

      // Should insert twice
      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe("Event Enrichment", () => {
    it("should enrich events with system context", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-1" }],
            error: null,
          }),
        }),
      });

      // Set global context
      eventLogger.setGlobalContext({
        botId: "bot-123",
        environment: "production",
        version: "1.0.0",
      });

      await eventLogger.logSystemStart({});

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            botId: "bot-123",
            environment: "production",
            version: "1.0.0",
          }),
        }),
      );
    });

    it("should add timestamps automatically", async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [{ id: "event-1" }],
            error: null,
          }),
        }),
      });

      await eventLogger.logSystemStart({});

      expect(mockSupabase.from("bot_events").insert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        }),
      );
    });
  });
});
