import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { EventLogger } from "../src/monitoring/event-logger.js";
import { Logger } from "../src/utils/logger.js";
import { Database } from "../types/supabase.js";

// Helper to setup test environment
async function setupTestEnvironment() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);
  const logger = new Logger({ level: "debug", transports: [] });

  return { supabase, logger };
}

// Helper to clean up test data
async function cleanupTestData(
  supabase: ReturnType<typeof createClient<Database>>,
  testRunId: string,
) {
  // Delete events created during this test run
  await supabase
    .from("bot_events")
    .delete()
    .contains("metadata", { testRunId });
}

test.describe("Event Logging System E2E", () => {
  let eventLogger: EventLogger;
  let supabase: ReturnType<typeof createClient<Database>>;
  let logger: Logger;
  let testRunId: string;

  test.beforeEach(async () => {
    // Generate unique test run ID to isolate test data
    testRunId = `test-run-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Setup test environment
    const env = await setupTestEnvironment();
    supabase = env.supabase;
    logger = env.logger;

    // Initialize EventLogger with test configuration
    eventLogger = new EventLogger({
      supabase,
      logger,
      batchSize: 5,
      flushInterval: 100,
      testRunId, // Add test run ID to all events for cleanup
    });
  });

  test.afterEach(async () => {
    // Shutdown event logger
    await eventLogger.shutdown();

    // Clean up test data
    await cleanupTestData(supabase, testRunId);
  });

  test.describe("Complete Trading Cycle Workflow", () => {
    test("should log full trading cycle from startup to completion", async () => {
      // 1. Bot Startup
      await eventLogger.logSystemStart({
        version: "1.0.0",
        environment: "test",
        tradingPair: "BTCUSDT",
        strategy: {
          dropPercentage: 0.03,
          risePercentage: 0.05,
          maxPurchases: 10,
        },
        testRunId,
      });

      // 2. WebSocket Connection
      await eventLogger.logWebsocketEvent({
        status: "CONNECTED",
        url: "wss://stream.binance.com:9443/ws",
        reconnectCount: 0,
        timestamp: new Date().toISOString(),
        testRunId,
      });

      // 3. Initial Configuration Update
      await eventLogger.logConfigUpdate({
        configType: "strategy",
        oldValues: { dropPercentage: 0.03 },
        newValues: { dropPercentage: 0.025 },
        reason: "User adjustment",
        testRunId,
      });

      // 4. Execute Buy Orders (simulate 3 purchases)
      const cycleId = `cycle-${Date.now()}`;
      for (let i = 1; i <= 3; i++) {
        await eventLogger.logTradeExecuted({
          orderId: `ORDER-BUY-${i}`,
          type: "BUY",
          price: 50000 - i * 500, // Prices drop
          quantity: 0.002,
          quoteQuantity: 100,
          feeAsset: "BTC",
          feeAmount: 0.000002,
          cycleId,
          cycleNumber: 1,
          purchaseNumber: i,
          timestamp: new Date().toISOString(),
          testRunId,
        });

        // Add small delay to simulate real trading
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // 5. Drift Detection (price moved too far)
      await eventLogger.logDriftHalt({
        referencePrice: 50000,
        currentPrice: 48000,
        driftPercentage: -4.0,
        threshold: 3.0,
        cycleId,
        action: "HALT",
        testRunId,
      });

      // 6. Execute Sell Order
      await eventLogger.logTradeExecuted({
        orderId: "ORDER-SELL-1",
        type: "SELL",
        price: 52500,
        quantity: 0.006, // Sell all accumulated BTC
        quoteQuantity: 315,
        feeAsset: "USDT",
        feeAmount: 0.315,
        cycleId,
        cycleNumber: 1,
        profit: 15,
        profitPercentage: 5,
        timestamp: new Date().toISOString(),
        testRunId,
      });

      // 7. Cycle Completion
      await eventLogger.logCycleComplete({
        cycleId,
        cycleNumber: 1,
        duration: 7200000, // 2 hours
        tradesExecuted: 4,
        btcAccumulated: 0.006,
        totalCost: 300,
        averagePrice: 50000,
        profit: 15,
        profitPercentage: 5,
        successRate: 1.0,
        testRunId,
      });

      // 8. Performance Metrics
      await eventLogger.logPerformanceMetrics({
        timestamp: new Date().toISOString(),
        cpuUsage: 45.2,
        memoryUsage: 67.8,
        activeConnections: 1,
        queuedOrders: 0,
        averageLatency: 120,
        uptimeSeconds: 7200,
        testRunId,
      });

      // 9. Bot Shutdown
      await eventLogger.logSystemStop({
        reason: "Test completed",
        runtime: 7200000,
        tradesExecuted: 4,
        finalState: "READY",
        testRunId,
      });

      // Wait for all events to be flushed
      await eventLogger.flush();

      // Verify all events were logged correctly
      const { data: events, error } = await supabase
        .from("bot_events")
        .select("*")
        .contains("metadata", { testRunId })
        .order("created_at", { ascending: true });

      expect(error).toBeNull();
      expect(events).toBeDefined();
      expect(events?.length).toBeGreaterThanOrEqual(10); // At least 10 events

      // Verify event sequence
      const eventTypes = events?.map((e) => e.event_type);
      expect(eventTypes).toContain("START");
      expect(eventTypes).toContain("WEBSOCKET_CONNECTED");
      expect(eventTypes).toContain("CONFIG_UPDATED");
      expect(eventTypes).toContain("TRADE_EXECUTED");
      expect(eventTypes).toContain("DRIFT_HALT");
      expect(eventTypes).toContain("CYCLE_COMPLETE");
      expect(eventTypes).toContain("PERFORMANCE_METRICS");
      expect(eventTypes).toContain("STOP");

      // Verify trade events have correct metadata
      const tradeEvents = events?.filter(
        (e) => e.event_type === "TRADE_EXECUTED",
      );
      expect(tradeEvents?.length).toBe(4); // 3 buys + 1 sell

      const buyEvents = tradeEvents?.filter(
        (e) => (e.metadata as Record<string, unknown>)?.type === "BUY",
      );
      expect(buyEvents?.length).toBe(3);

      const sellEvents = tradeEvents?.filter(
        (e) => (e.metadata as Record<string, unknown>)?.type === "SELL",
      );
      expect(sellEvents?.length).toBe(1);
      expect(
        (sellEvents?.[0].metadata as Record<string, unknown>)?.profit,
      ).toBe(15);
    });

    test("should handle error scenarios during trading", async () => {
      // Start bot
      await eventLogger.logSystemStart({
        version: "1.0.0",
        environment: "test",
        testRunId,
      });

      // Simulate connection error
      await eventLogger.logWebsocketEvent({
        status: "DISCONNECTED",
        url: "wss://stream.binance.com:9443/ws",
        error: "Connection timeout",
        reconnectCount: 3,
        timestamp: new Date().toISOString(),
        testRunId,
      });

      // Simulate failed trade
      await eventLogger.logTradeFailed({
        orderId: "ORDER-FAIL-1",
        type: "BUY",
        price: 50000,
        quantity: 0.002,
        error: new Error("Insufficient balance"),
        cycleId: "cycle-error-test",
        timestamp: new Date().toISOString(),
        testRunId,
      });

      // System error
      await eventLogger.logSystemError({
        error: new Error("Database connection failed"),
        context: {
          operation: "fetching cycle state",
          retryCount: 3,
          lastAttempt: new Date().toISOString(),
        },
        severity: "ERROR",
        testRunId,
      });

      // Emergency stop
      await eventLogger.logSystemStop({
        reason: "Emergency shutdown due to errors",
        runtime: 60000,
        tradesExecuted: 0,
        finalState: "ERROR",
        testRunId,
      });

      // Flush and verify
      await eventLogger.flush();

      const { data: events } = await supabase
        .from("bot_events")
        .select("*")
        .contains("metadata", { testRunId })
        .eq("severity", "ERROR");

      expect(events?.length).toBeGreaterThanOrEqual(2); // At least 2 error events

      // Verify error events contain proper error information
      const systemError = events?.find((e) =>
        e.message?.includes("Database connection failed"),
      );
      expect(systemError).toBeDefined();
      expect(
        (systemError?.metadata as Record<string, unknown>)?.error,
      ).toBeDefined();
    });
  });

  test.describe("Batch Processing and Performance", () => {
    test("should efficiently batch multiple events", async () => {
      const startTime = Date.now();

      // Queue 20 events rapidly
      const promises = [];
      for (let i = 1; i <= 20; i++) {
        promises.push(
          eventLogger.queueEvent({
            event_type: "TRADE_EXECUTED",
            severity: "INFO",
            message: `Trade ${i}`,
            metadata: {
              orderId: `BATCH-${i}`,
              testRunId,
            },
          }),
        );
      }

      await Promise.all(promises);
      await eventLogger.flush();

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly due to batching
      expect(duration).toBeLessThan(1000); // Less than 1 second

      // Verify all events were inserted
      const { data: events } = await supabase
        .from("bot_events")
        .select("*")
        .contains("metadata", { testRunId });

      expect(events?.length).toBe(20);
    });

    test("should handle offline queue when database is unavailable", async () => {
      // Enable offline queue
      eventLogger.enableOfflineQueue(true);

      // Temporarily break the database connection by using invalid credentials
      const brokenSupabase = createClient<Database>(
        "http://invalid-url:54321",
        "invalid-key",
      );

      const offlineLogger = new EventLogger({
        supabase: brokenSupabase,
        logger,
        batchSize: 5,
        flushInterval: 100,
      });

      offlineLogger.enableOfflineQueue(true);

      // Try to log events (will fail and queue offline)
      await offlineLogger.logSystemStart({
        version: "1.0.0",
        testRunId,
      });

      await offlineLogger.logTradeExecuted({
        orderId: "OFFLINE-1",
        type: "BUY",
        price: 50000,
        quantity: 0.002,
        testRunId,
      });

      // Check offline queue size
      const queueSize = offlineLogger.getOfflineQueueSize();
      expect(queueSize).toBeGreaterThan(0);

      // Clean up
      await offlineLogger.shutdown();
    });
  });

  test.describe("Query and Analytics", () => {
    test("should retrieve and aggregate metrics correctly", async () => {
      const cycleId = `cycle-analytics-${Date.now()}`;

      // Log multiple trade events
      const trades = [
        { type: "BUY", price: 49000, quantity: 0.002, quoteQuantity: 98 },
        { type: "BUY", price: 48500, quantity: 0.002, quoteQuantity: 97 },
        { type: "BUY", price: 48000, quantity: 0.002, quoteQuantity: 96 },
        {
          type: "SELL",
          price: 52000,
          quantity: 0.006,
          quoteQuantity: 312,
          profit: 21,
        },
      ];

      for (const [index, trade] of trades.entries()) {
        await eventLogger.logTradeExecuted({
          orderId: `ANALYTICS-${index + 1}`,
          type: trade.type as "BUY" | "SELL",
          price: trade.price,
          quantity: trade.quantity,
          quoteQuantity: trade.quoteQuantity,
          profit: trade.profit,
          cycleId,
          cycleNumber: 1,
          timestamp: new Date().toISOString(),
          testRunId,
        });
      }

      await eventLogger.flush();

      // Query events by cycle
      const cycleEvents = await eventLogger.getEventsByCycle(cycleId);
      expect(cycleEvents.length).toBe(4);

      // Get aggregated metrics
      const startTime = new Date(Date.now() - 3600000); // 1 hour ago
      const endTime = new Date();
      const metrics = await eventLogger.getAggregatedMetrics(
        startTime,
        endTime,
      );

      // Note: metrics will include all events in the time range, not just our test events
      // So we just verify the structure
      expect(metrics).toHaveProperty("totalTrades");
      expect(metrics).toHaveProperty("buyOrders");
      expect(metrics).toHaveProperty("sellOrders");
      expect(metrics).toHaveProperty("totalVolume");
      expect(metrics).toHaveProperty("totalProfit");

      // Query high severity events
      const errorEvents = await eventLogger.getEventsBySeverity("ERROR", {
        limit: 10,
      });
      expect(Array.isArray(errorEvents)).toBe(true);
    });

    test("should support event deduplication", async () => {
      // Enable deduplication
      eventLogger.enableDeduplication(true, 500); // 500ms window

      const duplicateEvent = {
        orderId: "DEDUP-TEST-1",
        type: "BUY" as const,
        price: 50000,
        quantity: 0.002,
        testRunId,
      };

      // Log the same event multiple times rapidly
      await eventLogger.logTradeExecuted(duplicateEvent);
      await eventLogger.logTradeExecuted(duplicateEvent);
      await eventLogger.logTradeExecuted(duplicateEvent);

      await eventLogger.flush();

      // Should only have one event due to deduplication
      const { data: events } = await supabase
        .from("bot_events")
        .select("*")
        .contains("metadata", { orderId: "DEDUP-TEST-1", testRunId });

      expect(events?.length).toBe(1);

      // Wait for deduplication window to expire
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Now it should allow the duplicate
      await eventLogger.logTradeExecuted(duplicateEvent);
      await eventLogger.flush();

      const { data: eventsAfter } = await supabase
        .from("bot_events")
        .select("*")
        .contains("metadata", { orderId: "DEDUP-TEST-1", testRunId });

      expect(eventsAfter?.length).toBe(2);
    });
  });

  test.describe("Event Classification and Prioritization", () => {
    test("should classify and prioritize events correctly", async () => {
      // Test classification for different event types
      const classifications = [
        { type: "ERROR", expectedSeverity: "ERROR", expectedPriority: "HIGH" },
        {
          type: "DRIFT_HALT",
          expectedSeverity: "WARNING",
          expectedPriority: "HIGH",
        },
        {
          type: "TRADE_EXECUTED",
          expectedSeverity: "INFO",
          expectedPriority: "MEDIUM",
        },
        { type: "START", expectedSeverity: "INFO", expectedPriority: "LOW" },
      ];

      for (const {
        type,
        expectedSeverity,
        expectedPriority,
      } of classifications) {
        const classification = eventLogger.classifyEvent(type);
        expect(classification.severity).toBe(expectedSeverity);
        expect(classification.priority).toBe(expectedPriority);
      }

      // Register custom event type
      eventLogger.registerEventType("CUSTOM_CRITICAL", {
        severity: "ERROR",
        priority: "CRITICAL",
        requiresImmediate: true,
      });

      const customClassification = eventLogger.classifyEvent("CUSTOM_CRITICAL");
      expect(customClassification.priority).toBe("CRITICAL");
      expect(customClassification.requiresImmediate).toBe(true);

      // Log a custom event
      await eventLogger.logCustomEvent({
        event_type: "CUSTOM_CRITICAL",
        severity: "ERROR",
        message: "Critical custom event",
        metadata: {
          reason: "Test critical event",
          testRunId,
        },
      });

      await eventLogger.flush();

      // Verify custom event was logged
      const { data: customEvents } = await supabase
        .from("bot_events")
        .select("*")
        .eq("event_type", "CUSTOM_CRITICAL")
        .contains("metadata", { testRunId });

      expect(customEvents?.length).toBe(1);
      expect(customEvents?.[0].severity).toBe("ERROR");
    });
  });

  test.describe("System Context and Enrichment", () => {
    test("should enrich all events with global context", async () => {
      // Set global context
      eventLogger.setGlobalContext({
        botId: "bot-e2e-test",
        environment: "test",
        version: "2.0.0",
        region: "us-east-1",
      });

      // Log various events
      await eventLogger.logSystemStart({ testRunId });
      await eventLogger.logTradeExecuted({
        orderId: "CONTEXT-1",
        type: "BUY",
        price: 50000,
        quantity: 0.001,
        testRunId,
      });
      await eventLogger.logCycleComplete({
        cycleId: "cycle-context",
        cycleNumber: 1,
        duration: 3600000,
        tradesExecuted: 1,
        btcAccumulated: 0.001,
        totalCost: 50,
        averagePrice: 50000,
        profit: 0,
        profitPercentage: 0,
        successRate: 1.0,
        testRunId,
      });

      await eventLogger.flush();

      // Verify all events have global context
      const { data: events } = await supabase
        .from("bot_events")
        .select("*")
        .contains("metadata", { testRunId });

      expect(events?.length).toBeGreaterThanOrEqual(3);

      for (const event of events || []) {
        const metadata = event.metadata as Record<string, unknown>;
        expect(metadata.botId).toBe("bot-e2e-test");
        expect(metadata.environment).toBe("test");
        expect(metadata.version).toBe("2.0.0");
        expect(metadata.region).toBe("us-east-1");
        expect(metadata.timestamp).toBeDefined();
      }
    });
  });

  test.describe("Real-time Monitoring Dashboard", () => {
    test("should support real-time event streaming for dashboard", async ({
      page,
    }) => {
      // This test would normally interact with a real dashboard UI
      // For now, we'll simulate the backend behavior that a dashboard would use

      // Start a simulated trading session
      const sessionId = `session-${Date.now()}`;

      await eventLogger.logSystemStart({
        sessionId,
        testRunId,
      });

      // Simulate real-time trading with events
      const eventStream = [];
      for (let i = 1; i <= 5; i++) {
        const event = {
          orderId: `RT-${i}`,
          type: "BUY" as const,
          price: 50000 - i * 100,
          quantity: 0.001,
          sessionId,
          testRunId,
          timestamp: new Date().toISOString(),
        };

        await eventLogger.logTradeExecuted(event);
        eventStream.push(event);

        // Small delay to simulate real-time
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await eventLogger.flush();

      // Query recent events as a dashboard would
      const recentEvents = await eventLogger.getEventsByTimeRange(
        new Date(Date.now() - 60000), // Last minute
        new Date(),
      );

      // Verify events are retrievable in real-time order
      const sessionEvents = recentEvents.filter(
        (e: { metadata?: Record<string, unknown> }) =>
          e.metadata?.sessionId === sessionId,
      );

      expect(sessionEvents.length).toBeGreaterThanOrEqual(5);

      // Verify chronological order
      for (let i = 1; i < sessionEvents.length; i++) {
        const prevTime = new Date(
          sessionEvents[i - 1].created_at || "",
        ).getTime();
        const currTime = new Date(sessionEvents[i].created_at || "").getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });
  });
});
