import { HistoricalCandleManager } from "../../src/exchange/historical-candle-manager";
import { BinanceClient } from "../../src/exchange/binance-client";
import type { BinanceKline } from "../../src/exchange/types";

// Mock the BinanceClient
jest.mock("../../src/exchange/binance-client");

describe("HistoricalCandleManager", () => {
  let mockClient: jest.Mocked<BinanceClient>;
  let manager: HistoricalCandleManager;
  const testSymbol = "BTCUSDT";
  const testInterval = "1h";

  // Helper function to create mock kline data
  const createMockKline = (
    overrides?: Partial<BinanceKline>,
  ): BinanceKline => ({
    openTime: Date.now() - 3600000,
    open: "50000.00",
    high: "51000.00",
    low: "49000.00",
    close: "50500.00",
    volume: "100.00",
    closeTime: Date.now(),
    quoteAssetVolume: "5050000.00",
    numberOfTrades: 1000,
    takerBuyBaseAssetVolume: "50.00",
    takerBuyQuoteAssetVolume: "2525000.00",
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = new BinanceClient({
      apiKey: "test",
      apiSecret: "test",
      testnet: true,
    }) as jest.Mocked<BinanceClient>;
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
  });

  describe("Initialization", () => {
    it("should fetch exactly 20 closed candles on initialization", async () => {
      const mockKlines = Array.from({ length: 20 }, (_, i) =>
        createMockKline({
          openTime: Date.now() - (20 - i) * 3600000,
          closeTime: Date.now() - (20 - i - 1) * 3600000,
        }),
      );

      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(mockClient.getKlines).toHaveBeenCalledWith(
        testSymbol,
        testInterval,
        20,
      );
      expect(manager.getCandleHistory()).toHaveLength(20);
    });

    it("should store fetched candles in memory", async () => {
      const mockKlines = Array.from({ length: 20 }, (_, i) =>
        createMockKline({
          openTime: Date.now() - (20 - i) * 3600000,
          close: `${50000 + i * 100}.00`,
        }),
      );

      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      const history = manager.getCandleHistory();
      expect(history).toHaveLength(20);
      expect(history[0].close).toBe("50000.00");
      expect(history[19].close).toBe("51900.00");
    });

    it("should handle insufficient history (< 20 candles) with warning", async () => {
      const mockKlines = Array.from({ length: 10 }, (_, i) =>
        createMockKline({
          openTime: Date.now() - (10 - i) * 3600000,
        }),
      );

      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.getCandleHistory()).toHaveLength(10);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("insufficient history"),
      );

      consoleSpy.mockRestore();
    });

    it("should handle no candles available", async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.getCandleHistory()).toHaveLength(0);
      expect(manager.calculateATH()).toBe(0);
    });

    it("should handle initialization errors gracefully", async () => {
      mockClient.getKlines = jest
        .fn()
        .mockRejectedValue(new Error("API error"));

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      await expect(manager.initialize()).rejects.toThrow("API error");
      expect(manager.getCandleHistory()).toHaveLength(0);
    });

    it("should prevent re-initialization", async () => {
      const mockKlines = Array.from({ length: 20 }, () => createMockKline());
      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();
      await manager.initialize(); // Second call

      expect(mockClient.getKlines).toHaveBeenCalledTimes(1);
    });
  });

  describe("Candle Management", () => {
    beforeEach(async () => {
      const mockKlines = Array.from({ length: 10 }, (_, i) =>
        createMockKline({
          openTime: Date.now() - (10 - i) * 3600000,
          high: `${51000 + i * 100}.00`,
        }),
      );
      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();
    });

    it("should maintain a sliding window of 20 candles", () => {
      // Add 15 more candles to reach 25 total
      for (let i = 0; i < 15; i++) {
        manager.addCandle(
          createMockKline({
            openTime: Date.now() + (i + 1) * 3600000,
            high: `${52000 + i * 100}.00`,
          }),
        );
      }

      const history = manager.getCandleHistory();
      expect(history).toHaveLength(20);
      // Should have kept the most recent 20
      expect(parseFloat(history[19].high)).toBeGreaterThan(52000);
    });

    it("should prevent duplicate candles based on openTime", () => {
      const candle = createMockKline({ openTime: Date.now() });

      manager.addCandle(candle);
      const firstCount = manager.getCandleHistory().length;

      manager.addCandle(candle); // Add same candle again
      const secondCount = manager.getCandleHistory().length;

      expect(firstCount).toBe(secondCount);
    });

    it("should update existing candle when openTime matches", () => {
      const openTime = Date.now();
      const candle1 = createMockKline({
        openTime,
        close: "50000.00",
      });
      const candle2 = createMockKline({
        openTime,
        close: "51000.00",
      });

      manager.addCandle(candle1);
      manager.addCandle(candle2);

      const history = manager.getCandleHistory();
      const updatedCandle = history.find((c) => c.openTime === openTime);
      expect(updatedCandle?.close).toBe("51000.00");
    });

    it("should handle adding candles to empty history", () => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      const candle = createMockKline();
      manager.addCandle(candle);

      expect(manager.getCandleHistory()).toHaveLength(1);
      expect(manager.getCandleHistory()[0]).toEqual(candle);
    });
  });

  describe("ATH Calculation Support", () => {
    it("should calculate ATH from available candles", async () => {
      const mockKlines = [
        createMockKline({ high: "50000.00" }),
        createMockKline({ high: "55000.00" }), // This is ATH
        createMockKline({ high: "52000.00" }),
      ];
      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.calculateATH()).toBe(55000);
    });

    it("should return 0 when no candles available", () => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      expect(manager.calculateATH()).toBe(0);
    });

    it("should update ATH when new higher candle is added", async () => {
      const mockKlines = [createMockKline({ high: "50000.00" })];
      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.calculateATH()).toBe(50000);

      manager.addCandle(createMockKline({ high: "60000.00" }));
      expect(manager.calculateATH()).toBe(60000);
    });

    it("should provide statistics about window completeness", async () => {
      const mockKlines = Array.from({ length: 10 }, () => createMockKline());
      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      const stats = manager.getStatistics();
      expect(stats.candleCount).toBe(10);
      expect(stats.windowSize).toBe(20);
      expect(stats.isFullWindow).toBe(false);
    });
  });

  describe("REST API Fallback", () => {
    beforeEach(async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();
    });

    it("should start REST polling on demand", () => {
      expect(manager.isPolling()).toBe(false);

      manager.startRestPolling(5000);

      expect(manager.isPolling()).toBe(true);
    });

    it("should stop REST polling on demand", () => {
      manager.startRestPolling(5000);
      expect(manager.isPolling()).toBe(true);

      manager.stopRestPolling();

      expect(manager.isPolling()).toBe(false);
    });

    it("should fetch candles at specified intervals", async () => {
      jest.useFakeTimers();

      const mockKlines = [createMockKline()];
      mockClient.getKlines = jest.fn().mockResolvedValue(mockKlines);

      manager.startRestPolling(1000);

      // Fast-forward time
      jest.advanceTimersByTime(3000);
      await Promise.resolve(); // Let promises resolve

      expect(mockClient.getKlines).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });

    it("should handle polling errors gracefully", async () => {
      jest.useFakeTimers();

      mockClient.getKlines = jest
        .fn()
        .mockRejectedValue(new Error("Network error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      manager.startRestPolling(1000);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("REST polling error"),
        expect.any(Error),
      );
      expect(manager.isPolling()).toBe(true); // Should continue polling

      consoleSpy.mockRestore();
      jest.useRealTimers();
    });

    it("should prevent multiple polling instances", () => {
      manager.startRestPolling(1000);
      manager.startRestPolling(2000); // Try to start again

      // Should still be using first interval
      expect(manager.isPolling()).toBe(true);
    });

    it("should merge new candles correctly during polling", async () => {
      jest.useFakeTimers();

      const candle1 = createMockKline({ openTime: 1000, high: "50000.00" });
      const candle2 = createMockKline({ openTime: 2000, high: "60000.00" });

      mockClient.getKlines = jest
        .fn()
        .mockResolvedValueOnce([candle1])
        .mockResolvedValueOnce([candle1, candle2]);

      manager.startRestPolling(1000);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(manager.getCandleHistory()).toHaveLength(1);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(manager.getCandleHistory()).toHaveLength(2);
      expect(manager.calculateATH()).toBe(60000);

      jest.useRealTimers();
    });
  });

  describe("WebSocket Failure Detection", () => {
    beforeEach(async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
        {
          websocketFailureThreshold: 3,
        },
      );
      await manager.initialize();
    });

    it("should track WebSocket failure count", () => {
      expect(manager.getWebSocketFailureCount()).toBe(0);

      manager.recordWebSocketFailure();
      expect(manager.getWebSocketFailureCount()).toBe(1);

      manager.recordWebSocketFailure();
      expect(manager.getWebSocketFailureCount()).toBe(2);
    });

    it("should reset failure count on recovery", () => {
      manager.recordWebSocketFailure();
      manager.recordWebSocketFailure();
      expect(manager.getWebSocketFailureCount()).toBe(2);

      manager.recordWebSocketRecovery();
      expect(manager.getWebSocketFailureCount()).toBe(0);
    });

    it("should automatically start REST polling after threshold failures", () => {
      expect(manager.isPolling()).toBe(false);

      manager.recordWebSocketFailure();
      manager.recordWebSocketFailure();
      manager.recordWebSocketFailure(); // Reaches threshold of 3

      expect(manager.isPolling()).toBe(true);
    });

    it("should stop REST polling when WebSocket recovers", () => {
      // Trigger polling
      manager.recordWebSocketFailure();
      manager.recordWebSocketFailure();
      manager.recordWebSocketFailure();
      expect(manager.isPolling()).toBe(true);

      manager.recordWebSocketRecovery();

      expect(manager.isPolling()).toBe(false);
      expect(manager.getWebSocketFailureCount()).toBe(0);
    });
  });

  describe("Configuration", () => {
    it("should use default configuration when not provided", () => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      const config = manager.getConfiguration();
      expect(config.maxCandles).toBe(20);
      expect(config.restPollingInterval).toBe(60000);
      expect(config.websocketFailureThreshold).toBe(5);
    });

    it("should accept custom configuration", () => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
        {
          maxCandles: 30,
          restPollingInterval: 30000,
          websocketFailureThreshold: 10,
        },
      );

      const config = manager.getConfiguration();
      expect(config.maxCandles).toBe(30);
      expect(config.restPollingInterval).toBe(30000);
      expect(config.websocketFailureThreshold).toBe(10);
    });
  });

  describe("Thread Safety and Cleanup", () => {
    it("should clean up resources on stop", async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      manager.startRestPolling(1000);
      expect(manager.isPolling()).toBe(true);

      manager.stop();

      expect(manager.isPolling()).toBe(false);
      expect(manager.getCandleHistory()).toHaveLength(0);
    });

    it("should handle concurrent add operations safely", async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(
          manager.addCandle(
            createMockKline({ openTime: Date.now() + i * 1000 }),
          ),
        ),
      );

      await Promise.all(promises);

      expect(manager.getCandleHistory().length).toBeLessThanOrEqual(20);
    });

    it("should provide thread-safe read access", async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([createMockKline()]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      const history1 = manager.getCandleHistory();
      const history2 = manager.getCandleHistory();

      expect(history1).not.toBe(history2); // Different array instances
      expect(history1).toEqual(history2); // Same content
    });
  });

  describe("Data Validation", () => {
    beforeEach(() => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
    });

    it("should validate candle data before adding", () => {
      const invalidCandle = createMockKline({ high: "invalid" });

      expect(() => manager.addCandle(invalidCandle)).toThrow();
    });

    it("should validate timestamp sequencing", () => {
      const candle1 = createMockKline({ openTime: 1000, closeTime: 2000 });
      const candle2 = createMockKline({ openTime: 2000, closeTime: 1500 }); // Invalid

      manager.addCandle(candle1);
      expect(() => manager.addCandle(candle2)).toThrow(
        "Invalid timestamp sequence",
      );
    });

    it("should handle zero volume candles", () => {
      const zeroVolumeCandle = createMockKline({ volume: "0" });

      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      manager.addCandle(zeroVolumeCandle);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Zero volume candle"),
      );
      consoleSpy.mockRestore();
    });

    it("should reject negative price values", () => {
      const negativeCandle = createMockKline({ high: "-100.00" });

      expect(() => manager.addCandle(negativeCandle)).toThrow("Negative price");
    });
  });

  describe("Performance Monitoring", () => {
    beforeEach(async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
    });

    it("should track fetch latency", async () => {
      const delay = 100;
      mockClient.getKlines = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve([createMockKline()]), delay),
            ),
        );

      await manager.initialize();

      const metrics = manager.getMetrics();
      expect(metrics.lastFetchLatency).toBeGreaterThanOrEqual(delay);
    });

    it("should track memory usage", async () => {
      await manager.initialize();

      const initialMetrics = manager.getMetrics();

      // Add many candles
      for (let i = 0; i < 20; i++) {
        manager.addCandle(createMockKline({ openTime: Date.now() + i * 1000 }));
      }

      const finalMetrics = manager.getMetrics();
      expect(finalMetrics.memoryUsage).toBeGreaterThan(
        initialMetrics.memoryUsage,
      );
    });

    it("should provide fetch statistics", async () => {
      mockClient.getKlines = jest
        .fn()
        .mockResolvedValueOnce([createMockKline()])
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce([createMockKline()]);

      await manager.initialize();

      try {
        await manager.fetchLatestCandles();
      } catch {
        // Expected to fail
      }

      await manager.fetchLatestCandles();

      const metrics = manager.getMetrics();
      expect(metrics.totalFetches).toBe(3);
      expect(metrics.failedFetches).toBe(1);
      expect(metrics.successRate).toBeCloseTo(0.67, 1);
    });
  });
});

describe("HistoricalCandleManager Integration Tests", () => {
  let mockClient: jest.Mocked<BinanceClient>;
  let manager: HistoricalCandleManager;

  const createMockKline = (
    overrides?: Partial<BinanceKline>,
  ): BinanceKline => ({
    openTime: Date.now() - 3600000,
    open: "50000.00",
    high: "51000.00",
    low: "49000.00",
    close: "50500.00",
    volume: "100.00",
    closeTime: Date.now(),
    quoteAssetVolume: "5050000.00",
    numberOfTrades: 1000,
    takerBuyBaseAssetVolume: "50.00",
    takerBuyQuoteAssetVolume: "2525000.00",
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = new BinanceClient({
      apiKey: "test",
      apiSecret: "test",
      testnet: true,
    }) as jest.Mocked<BinanceClient>;
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
  });

  describe("Full WebSocket Failure Recovery Flow", () => {
    it("should handle complete failure → REST polling → recovery cycle", async () => {
      jest.useFakeTimers();

      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(mockClient, "BTCUSDT", "1h", {
        websocketFailureThreshold: 2,
        restPollingInterval: 1000,
      });

      await manager.initialize();
      expect(manager.isPolling()).toBe(false);

      // Simulate WebSocket failures
      manager.recordWebSocketFailure();
      manager.recordWebSocketFailure();
      expect(manager.isPolling()).toBe(true);

      // Let polling run
      const newCandle = createMockKline({ high: "60000.00" });
      mockClient.getKlines = jest.fn().mockResolvedValue([newCandle]);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(manager.getCandleHistory()).toContainEqual(newCandle);

      // Simulate recovery
      manager.recordWebSocketRecovery();
      expect(manager.isPolling()).toBe(false);
      expect(manager.getWebSocketFailureCount()).toBe(0);

      jest.useRealTimers();
    });
  });

  describe("Real-time Updates with Historical Context", () => {
    it("should maintain accurate ATH across historical and real-time data", async () => {
      // Initialize with historical data
      const historicalCandles = [
        createMockKline({ openTime: 1000, high: "45000.00" }),
        createMockKline({ openTime: 2000, high: "48000.00" }),
        createMockKline({ openTime: 3000, high: "47000.00" }),
      ];

      mockClient.getKlines = jest.fn().mockResolvedValue(historicalCandles);
      manager = new HistoricalCandleManager(mockClient, "BTCUSDT", "1h");
      await manager.initialize();

      expect(manager.calculateATH()).toBe(48000);

      // Add real-time candles
      manager.addCandle(createMockKline({ openTime: 4000, high: "46000.00" }));
      expect(manager.calculateATH()).toBe(48000); // Still historical ATH

      manager.addCandle(createMockKline({ openTime: 5000, high: "52000.00" }));
      expect(manager.calculateATH()).toBe(52000); // New ATH from real-time
    });
  });

  describe("Multiple Symbol Management", () => {
    it("should handle multiple trading pairs independently", async () => {
      const btcManager = new HistoricalCandleManager(
        mockClient,
        "BTCUSDT",
        "1h",
      );
      const ethManager = new HistoricalCandleManager(
        mockClient,
        "ETHUSDT",
        "1h",
      );

      mockClient.getKlines = jest
        .fn()
        .mockResolvedValueOnce([createMockKline({ high: "50000.00" })]) // BTC
        .mockResolvedValueOnce([createMockKline({ high: "3000.00" })]); // ETH

      await btcManager.initialize();
      await ethManager.initialize();

      expect(btcManager.calculateATH()).toBe(50000);
      expect(ethManager.calculateATH()).toBe(3000);

      btcManager.stop();
      ethManager.stop();
    });
  });

  describe("Error Recovery and Resilience", () => {
    it("should recover from intermittent API failures during polling", async () => {
      jest.useFakeTimers();

      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(mockClient, "BTCUSDT", "1h");
      await manager.initialize();

      let callCount = 0;
      mockClient.getKlines = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount % 2 === 0) {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve([
          createMockKline({ high: `${50000 + callCount * 1000}.00` }),
        ]);
      });

      manager.startRestPolling(1000);

      // Run several polling cycles
      for (let i = 0; i < 6; i++) {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      }

      // Should have successful data despite intermittent failures
      expect(manager.getCandleHistory().length).toBeGreaterThan(0);
      expect(manager.calculateATH()).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });

  describe("Memory Management", () => {
    it("should prevent memory leaks when processing large volumes", async () => {
      mockClient.getKlines = jest.fn().mockResolvedValue([]);
      manager = new HistoricalCandleManager(mockClient, "BTCUSDT", "1h", {
        maxCandles: 20,
      });
      await manager.initialize();

      const initialMetrics = manager.getMetrics();

      // Add thousands of candles
      for (let i = 0; i < 1000; i++) {
        manager.addCandle(createMockKline({ openTime: Date.now() + i * 1000 }));
      }

      // Should still only have maxCandles in memory
      expect(manager.getCandleHistory()).toHaveLength(20);

      const finalMetrics = manager.getMetrics();
      // Memory should be bounded, not growing infinitely
      expect(finalMetrics.memoryUsage).toBeLessThan(
        initialMetrics.memoryUsage * 100,
      );
    });
  });
});
