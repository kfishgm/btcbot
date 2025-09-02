import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Mock the dependencies before importing them
jest.mock("@supabase/supabase-js");
jest.mock("../../src/utils/logger.js");

import { EventLogger } from "../../src/monitoring/event-logger.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Logger } from "../../src/utils/logger.js";

// Get the mocked version of createClient
const { createClient } = jest.requireMock("@supabase/supabase-js") as {
  createClient: jest.Mock;
};

describe("EventLogger", () => {
  let eventLogger: EventLogger;
  let mockSupabase: SupabaseClient;
  let mockLogger: Logger;
  let mockFrom: jest.Mock;
  let mockInsert: jest.Mock;
  let mockSelect: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock functions for query builder chain
    mockInsert = jest.fn();
    mockSelect = jest.fn();

    // Setup the mock chain - insert returns an object with select
    mockInsert.mockImplementation(() => ({
      select: mockSelect,
    }));

    // select returns a promise by default
    mockSelect.mockImplementation(() =>
      Promise.resolve({
        data: [],
        error: null,
      }),
    );

    // Create from mock that returns query builder
    mockFrom = jest.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      contains: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
    }));

    // Create mock Supabase client
    mockSupabase = {
      from: mockFrom,
    } as unknown as SupabaseClient;

    createClient.mockReturnValue(mockSupabase);

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    (Logger as unknown as jest.Mock).mockImplementation(() => mockLogger);

    // Create EventLogger instance with required config
    eventLogger = new EventLogger({
      supabase: mockSupabase,
      logger: mockLogger,
      batchSize: 10,
      flushInterval: 1000,
    });
  });

  afterEach(() => {
    // Clean up any timers
    jest.clearAllTimers();
  });

  describe("Trade Events", () => {
    it("should log buy trade events", async () => {
      // Setup mock to return success
      mockSelect.mockImplementation(() =>
        Promise.resolve({
          data: [{ id: "event-id-1" }],
          error: null,
        }),
      );

      const tradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        price: 50000.0,
        quantity: 0.002,
        cycleId: "cycle-uuid-123",
        purchaseNumber: 1,
        fees: 0.000002,
      };

      await eventLogger.logTradeExecuted(tradeEvent);

      expect(mockFrom).toHaveBeenCalledWith("bot_events");
      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message: "Buy order executed: 0.002 BTC/USDT @ $50000",
        metadata: expect.objectContaining({
          type: "BUY",
          symbol: "BTC/USDT",
          price: 50000.0,
          quantity: 0.002,
        }),
      });
    });

    it("should log sell trade events", async () => {
      // Setup mock to return success
      mockSelect.mockImplementation(() =>
        Promise.resolve({
          data: [{ id: "event-id-2" }],
          error: null,
        }),
      );

      const tradeEvent = {
        type: "SELL" as const,
        symbol: "BTC/USDT",
        price: 51000.0,
        quantity: 0.002,
        cycleId: "cycle-uuid-123",
        purchaseNumber: 3,
        fees: 0.000002,
        profit: 100.5,
      };

      await eventLogger.logTradeExecuted(tradeEvent);

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "TRADE_EXECUTED",
        severity: "INFO",
        message:
          "Sell order executed: 0.002 BTC/USDT @ $51000 (Profit: $100.50)",
        metadata: expect.objectContaining({
          type: "SELL",
          profit: 100.5,
        }),
      });
    });

    it("should log failed trade events", async () => {
      // Setup mock to return success
      mockSelect.mockImplementation(() =>
        Promise.resolve({
          data: [{ id: "event-id-3" }],
          error: null,
        }),
      );

      const failedTradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        attemptedPrice: 50000.0,
        attemptedQuantity: 0.002,
        error: "Insufficient balance",
        cycleId: "cycle-uuid-123",
      };

      await eventLogger.logTradeFailed(failedTradeEvent);

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "TRADE_FAILED",
        severity: "ERROR",
        message: "Failed to execute BUY: Insufficient balance",
        metadata: expect.objectContaining({
          type: "BUY",
          error: "Insufficient balance",
        }),
      });
    });
  });

  describe("System Events", () => {
    it("should log system start events", async () => {
      // Setup mock to return success
      mockSelect.mockImplementation(() =>
        Promise.resolve({
          data: [{ id: "event-id-4" }],
          error: null,
        }),
      );

      await eventLogger.logSystemStart({ version: "1.0.0" });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "START",
        severity: "INFO",
        message: "Trading bot started",
        metadata: { config: { version: "1.0.0" } },
      });
    });

    it("should log system stop events", async () => {
      await eventLogger.logSystemStop("Manual shutdown");

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "STOP",
        severity: "INFO",
        message: "Trading bot stopped",
        metadata: { reason: "Manual shutdown" },
      });
    });

    it("should log error events with high severity", async () => {
      const error = new Error("Database connection failed");
      await eventLogger.logSystemError(error);

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "ERROR",
        severity: "ERROR",
        message: "System error: Database connection failed",
        metadata: expect.objectContaining({
          error: {
            message: "Database connection failed",
            name: "Error",
          },
        }),
      });
    });

    it("should log WebSocket connection events", async () => {
      await eventLogger.logWebsocketEvent({
        connected: true,
        details: { exchange: "Binance" },
      });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "WEBSOCKET_CONNECTED",
        severity: "INFO",
        message: "WebSocket connected to Binance",
        metadata: expect.objectContaining({
          details: { exchange: "Binance" },
          connected: true,
        }),
      });
    });

    it("should log drift halt events", async () => {
      await eventLogger.logDriftHalt({
        symbol: "BTC/USDT",
        currentPrice: 50000,
        referencePrice: 48500,
        driftPercentage: 0.035,
        maxAllowedDrift: 0.03,
      });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "DRIFT_HALT",
        severity: "WARNING",
        message: "Trading halted due to price drift on BTC/USDT",
        metadata: expect.objectContaining({
          driftPercentage: 0.035,
          maxAllowedDrift: 0.03,
        }),
      });
    });
  });

  describe("Performance Metrics", () => {
    it("should log cycle metrics", async () => {
      await eventLogger.logCycleComplete({
        cycleId: "cycle-uuid-123",
        duration: 2500,
        tradesExecuted: 6,
        totalProfit: 450.75,
        profitPercentage: 0.85,
        startTime: new Date("2024-01-01T10:00:00Z"),
        endTime: new Date("2024-01-01T10:30:00Z"),
      });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "CYCLE_COMPLETE",
        severity: "INFO",
        message: "Cycle cycle-uuid-123 completed",
        metadata: expect.objectContaining({
          tradesExecuted: 6,
          totalProfit: 450.75,
        }),
      });
    });

    it("should log performance metrics", async () => {
      await eventLogger.logPerformanceMetrics({
        cpuUsage: 45,
        memoryUsage: 256,
        eventLatency: 25,
        databaseLatency: 30,
        timestamp: new Date(),
      });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "PERFORMANCE_METRICS",
        severity: "INFO",
        message: "Performance metrics recorded",
        metadata: expect.objectContaining({
          cpuUsage: 45,
          memoryUsage: 256,
        }),
      });
    });

    it("should log strategy metrics", async () => {
      await eventLogger.logStrategyMetrics({
        winRate: 0.85,
        totalVolume: 100000,
        maxDrawdown: 0.15,
        sharpeRatio: 1.5,
        period: "24h",
      });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "STRATEGY_METRICS",
        severity: "INFO",
        message: "Strategy metrics recorded",
        metadata: expect.objectContaining({
          winRate: 0.85,
          totalVolume: 100000,
        }),
      });
    });
  });

  describe("Query Methods", () => {
    it("should query events by type", async () => {
      const mockEvents = [
        {
          id: "1",
          event_type: "TRADE_EXECUTED",
          message: "Trade executed",
          metadata: {},
          severity: "INFO",
          created_at: new Date().toISOString(),
        },
      ];

      const mockQueryChain = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        range: jest.fn(() =>
          Promise.resolve({
            data: mockEvents,
            error: null,
          }),
        ),
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue(mockQueryChain),
      });

      const events = await eventLogger.getEventsByType("TRADE_EXECUTED", {
        limit: 10,
      });

      expect(events).toEqual(mockEvents);
      expect(mockQueryChain.eq).toHaveBeenCalledWith(
        "event_type",
        "TRADE_EXECUTED",
      );
    });

    it("should query events by date range", async () => {
      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-02");

      const mockQueryChain = {
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          }),
        ),
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue(mockQueryChain),
      });

      await eventLogger.getEventsByTimeRange(startDate, endDate);

      expect(mockQueryChain.gte).toHaveBeenCalledWith(
        "created_at",
        startDate.toISOString(),
      );
      expect(mockQueryChain.lte).toHaveBeenCalledWith(
        "created_at",
        endDate.toISOString(),
      );
    });

    it("should query events by severity", async () => {
      const mockQueryChain = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        range: jest.fn(() =>
          Promise.resolve({
            data: [],
            error: null,
          }),
        ),
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue(mockQueryChain),
      });

      await eventLogger.getEventsBySeverity("ERROR", {
        limit: 50,
      });

      expect(mockQueryChain.eq).toHaveBeenCalledWith("severity", "ERROR");
    });

    it("should handle query errors gracefully", async () => {
      const mockQueryChain = {
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        range: jest.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: "Query failed" },
          }),
        ),
      };

      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue(mockQueryChain),
      });

      const events = await eventLogger.getEventsByType("CUSTOM", {
        limit: 100,
      });

      expect(events).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith("Failed to query events", {
        error: { message: "Query failed" },
      });
    });
  });

  describe("Event Classification", () => {
    it("should classify events by severity", () => {
      const classification = eventLogger.classifyEvent("ERROR");

      expect(classification).toEqual({
        severity: "ERROR",
        priority: "CRITICAL",
        category: "SYSTEM",
      });
    });

    it("should classify trade events", () => {
      const classification = eventLogger.classifyEvent("TRADE_EXECUTED");

      expect(classification).toEqual({
        severity: "INFO",
        priority: "HIGH",
        category: "TRADING",
      });
    });

    it("should classify warning events", () => {
      const classification = eventLogger.classifyEvent("DRIFT_HALT");

      expect(classification).toEqual({
        severity: "WARNING",
        priority: "HIGH",
        category: "TRADING",
      });
    });

    it("should handle unknown event types", () => {
      const classification = eventLogger.classifyEvent("UNKNOWN_EVENT");

      expect(classification).toEqual({
        severity: "INFO",
        priority: "LOW",
        category: "UNKNOWN",
      });
    });
  });

  describe("Batch Processing", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should batch multiple events before sending", async () => {
      // Create EventLogger with small batch size for testing
      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 3,
        flushInterval: 5000,
      });

      // Log multiple events without awaiting
      const promises = [
        eventLogger.logTradeExecuted({
          type: "BUY",
          symbol: "BTC/USDT",
          price: 50000,
          quantity: 0.001,
          cycleId: "cycle-1",
          purchaseNumber: 1,
          fees: 0.0001,
        }),
        eventLogger.logTradeExecuted({
          type: "BUY",
          symbol: "BTC/USDT",
          price: 50100,
          quantity: 0.001,
          cycleId: "cycle-1",
          purchaseNumber: 2,
          fees: 0.0001,
        }),
        eventLogger.logTradeExecuted({
          type: "BUY",
          symbol: "BTC/USDT",
          price: 50200,
          quantity: 0.001,
          cycleId: "cycle-1",
          purchaseNumber: 3,
          fees: 0.0001,
        }),
      ];

      await Promise.all(promises);

      // Should have made only one batch insert
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ event_type: "TRADE_EXECUTED" }),
          expect.objectContaining({ event_type: "TRADE_EXECUTED" }),
          expect.objectContaining({ event_type: "TRADE_EXECUTED" }),
        ]),
      );
    });

    it("should auto-flush based on timer", async () => {
      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 10,
        flushInterval: 1000,
      });

      // Log one event
      eventLogger.logTradeExecuted({
        type: "BUY",
        symbol: "BTC/USDT",
        price: 50000,
        quantity: 0.001,
        cycleId: "cycle-1",
        purchaseNumber: 1,
        fees: 0.0001,
      });

      // Should not insert immediately
      expect(mockInsert).not.toHaveBeenCalled();

      // Advance timers
      jest.advanceTimersByTime(1000);

      // Wait for async flush
      await new Promise((resolve) => setImmediate(resolve));

      // Should have flushed
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("should handle flush errors and use offline queue", async () => {
      // Make insert fail
      mockInsert.mockImplementation(() => ({
        select: jest.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: "Database unavailable" },
          }),
        ),
      }));

      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 1,
        flushInterval: 5000,
      });

      // Enable offline queue
      eventLogger.enableOfflineQueue(true);

      await eventLogger.logTradeExecuted({
        type: "BUY",
        symbol: "BTC/USDT",
        price: 50000,
        quantity: 0.001,
        cycleId: "cycle-1",
        purchaseNumber: 1,
        fees: 0.0001,
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to insert batch",
        expect.objectContaining({ error: { message: "Database unavailable" } }),
      );

      // Now make insert succeed
      mockInsert.mockImplementation(() => ({
        select: jest.fn(() =>
          Promise.resolve({
            data: [{ id: "event-1" }],
            error: null,
          }),
        ),
      }));

      // Flush again to process offline queue
      await eventLogger.flush();

      // Should have retried the insert
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("Deduplication", () => {
    it("should prevent duplicate events within time window", async () => {
      // Enable deduplication
      eventLogger.enableDeduplication(true, 1000);

      const tradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        price: 50000,
        quantity: 0.001,
        cycleId: "cycle-1",
        purchaseNumber: 1,
        fees: 0.0001,
      };

      // Log same event twice
      await eventLogger.logTradeExecuted(tradeEvent);
      await eventLogger.logTradeExecuted(tradeEvent);

      // Should only insert once
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Duplicate event detected"),
      );
    });

    it("should allow same event after deduplication window", async () => {
      jest.useFakeTimers();

      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 1,
        flushInterval: 5000,
      });

      eventLogger.enableDeduplication(true, 1000); // 1 second window

      const tradeEvent = {
        type: "BUY" as const,
        symbol: "BTC/USDT",
        price: 50000,
        quantity: 0.001,
        cycleId: "cycle-1",
        purchaseNumber: 1,
        fees: 0.0001,
      };

      // First log
      await eventLogger.logTradeExecuted(tradeEvent);

      // Advance time past deduplication window
      jest.advanceTimersByTime(1100);

      // Second log
      await eventLogger.logTradeExecuted(tradeEvent);

      // Should insert twice
      expect(mockInsert).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe("Manual Operations", () => {
    it("should support manual flush", async () => {
      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 10,
        flushInterval: 60000,
      });

      // Log one event
      eventLogger.logTradeExecuted({
        type: "BUY",
        symbol: "BTC/USDT",
        price: 50000,
        quantity: 0.001,
        cycleId: "cycle-1",
        purchaseNumber: 1,
        fees: 0.0001,
      });

      // Manually flush
      await eventLogger.flush();

      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("should set global context", async () => {
      // Set global context
      eventLogger.setGlobalContext({ appVersion: "1.0.0", env: "test" });

      // Log an event
      await eventLogger.logSystemStart({ version: "1.0.0" });

      // Should include global context in metadata
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            globalContext: { appVersion: "1.0.0", env: "test" },
          }),
        }),
      );
    });

    it("should enable and disable offline queue", async () => {
      // Start with offline queue disabled
      eventLogger.enableOfflineQueue(false);

      // Make insert fail
      mockInsert.mockImplementation(() => ({
        select: jest.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: "Database unavailable" },
          }),
        ),
      }));

      await eventLogger.logSystemStart({ version: "1.0.0" });

      // Should log error but not queue offline
      expect(mockLogger.error).toHaveBeenCalled();

      // Enable offline queue
      eventLogger.enableOfflineQueue(true);

      // Now events should queue offline when failing
      await eventLogger.logSystemStop("test");

      // Fix insert
      mockInsert.mockImplementation(() => ({
        select: jest.fn(() =>
          Promise.resolve({
            data: [{ id: "event-1" }],
            error: null,
          }),
        ),
      }));

      // Flush should process offline queue
      await eventLogger.flush();

      // Should have tried to insert both events (1 failed, 1 succeeded from offline queue)
      expect(mockInsert).toHaveBeenCalledTimes(3);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large metadata objects", async () => {
      const largeMetadata = {
        data: Array(1000)
          .fill(0)
          .map((_, i) => ({
            index: i,
            value: Math.random(),
            timestamp: new Date().toISOString(),
          })),
      };

      await eventLogger.logCustomEvent({
        event_type: "CUSTOM",
        severity: "INFO",
        message: "Large metadata test",
        metadata: largeMetadata,
      });

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "CUSTOM",
        severity: "INFO",
        message: "Large metadata test",
        metadata: largeMetadata,
      });
    });

    it("should handle null/undefined metadata gracefully", async () => {
      await eventLogger.logSystemStart(undefined);

      expect(mockInsert).toHaveBeenCalledWith({
        event_type: "START",
        severity: "INFO",
        message: "Trading bot started",
        metadata: { config: undefined },
      });
    });

    it("should continue operating after database errors", async () => {
      // First call fails
      let callCount = 0;
      mockInsert.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: jest.fn(() =>
              Promise.resolve({
                data: null,
                error: { message: "Connection lost" },
              }),
            ),
          };
        }
        return {
          select: jest.fn(() =>
            Promise.resolve({
              data: [{ id: "event-1" }],
              error: null,
            }),
          ),
        };
      });

      eventLogger = new EventLogger({
        supabase: mockSupabase,
        logger: mockLogger,
        batchSize: 1,
        flushInterval: 5000,
      });

      // First event fails
      await eventLogger.logSystemError(new Error("Test error 1"));

      // Second event succeeds
      await eventLogger.logSystemError(new Error("Test error 2"));

      expect(mockInsert).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });
});
