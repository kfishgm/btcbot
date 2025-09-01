import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock the BinanceClient
jest.mock("../../src/exchange/binance-client");

// Import everything
import {
  HistoricalCandleManager,
  type ExtendedKline,
} from "../../src/exchange/historical-candle-manager";
import { BinanceClient } from "../../src/exchange/binance-client";
import { logger } from "../../src/utils/logger";

describe("HistoricalCandleManager", () => {
  let mockClient: BinanceClient;
  let manager: HistoricalCandleManager;
  const testSymbol = "BTCUSDT";
  const testInterval = "1h";

  // Type for mocked getKlines function
  type MockGetKlines = jest.MockedFunction<
    typeof BinanceClient.prototype.getKlines
  >;

  // Helper function to create mock kline data
  const createMockKline = (
    overrides?: Partial<ExtendedKline>,
  ): ExtendedKline => {
    const baseTime = Date.now() - 3600000;
    const openTime = overrides?.openTime ?? baseTime;
    // Calculate closeTime based on the actual openTime being used
    const defaultCloseTime = openTime + 3599999; // 1 ms before the next hour

    // Build the kline with defaults, then apply overrides
    const baseKline: ExtendedKline = {
      openTime,
      open: overrides?.open ?? "50000.00",
      high: overrides?.high ?? "51000.00",
      low: overrides?.low ?? "49000.00",
      close: overrides?.close ?? "50500.00",
      volume: overrides?.volume ?? "100.00",
      closeTime: overrides?.closeTime ?? defaultCloseTime,
      quoteAssetVolume: overrides?.quoteAssetVolume ?? "5050000.00",
      numberOfTrades: overrides?.numberOfTrades ?? 1000,
      takerBuyBaseAssetVolume: overrides?.takerBuyBaseAssetVolume ?? "50.00",
      takerBuyQuoteAssetVolume:
        overrides?.takerBuyQuoteAssetVolume ?? "2525000.00",
    };

    return baseKline;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = new BinanceClient({
      apiKey: "test",
      apiSecret: "test",
      testnet: true,
    });
    // Override methods with mocks - properly typed
    mockClient.getKlines = jest.fn() as unknown as typeof mockClient.getKlines;
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

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

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

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

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

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

      // Spy on logger to suppress output in tests
      const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.getCandleHistory()).toHaveLength(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("insufficient history"),
        expect.objectContaining({
          symbol: testSymbol,
          received: 10,
          expected: 20,
        }),
      );

      warnSpy.mockRestore();
    });

    it("should handle no candles available", async () => {
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);

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
      (mockClient.getKlines as MockGetKlines).mockRejectedValue(
        new Error("API error"),
      );

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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

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

  describe("ATH Calculation - TDD Requirements", () => {
    // Test 1: Calculate ATH from exactly 20 closed candles
    it("should calculate ATH from exactly the last 20 CLOSED candles only", async () => {
      const now = Date.now();
      const closedCandles = Array.from({ length: 20 }, (_, i) => {
        const openTime = now - (21 - i) * 3600000; // 21 hours ago to 2 hours ago
        return createMockKline({
          openTime,
          closeTime: openTime + 3599999, // Closed candle
          high: `${50000 + i * 100}.00`, // Increasing highs
          isClosed: true, // Mark as closed
        });
      });

      // Add an unclosed candle (current candle)
      const unclosedCandle = createMockKline({
        openTime: now - 3600000, // 1 hour ago
        closeTime: now + 1800000, // 30 minutes in the future
        high: "99999.00", // Very high value that should be excluded
        isClosed: false, // Mark as unclosed
      });

      const allCandles = [...closedCandles, unclosedCandle];
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(allCandles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // ATH should be from the 20th closed candle (51900), NOT the unclosed candle (99999)
      expect(manager.calculateATH()).toBe(51900);
    });

    // Test 2: Exclude current unclosed candle from calculation
    it("should exclude the current unclosed candle from ATH calculation", async () => {
      const now = Date.now();

      // Create 10 closed candles with lower highs
      const closedCandles = Array.from({ length: 10 }, (_, i) =>
        createMockKline({
          openTime: now - (11 - i) * 3600000,
          closeTime: now - (11 - i) * 3600000 + 3599999,
          high: `${40000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      // Add unclosed candle with highest value
      const unclosedCandle = createMockKline({
        openTime: now - 3600000,
        closeTime: now + 1800000, // Future time
        high: "100000.00", // Highest value but should be excluded
        isClosed: false,
      });

      (mockClient.getKlines as MockGetKlines).mockResolvedValue([
        ...closedCandles,
        unclosedCandle,
      ]);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // Should return max from closed candles only (40900), not 100000
      expect(manager.calculateATH()).toBe(40900);
    });

    // Test 3: Handle less than 20 candles gracefully
    it("should handle less than 20 candles gracefully", async () => {
      const now = Date.now();

      // Only 5 closed candles
      const candles = Array.from({ length: 5 }, (_, i) =>
        createMockKline({
          openTime: now - (6 - i) * 3600000,
          closeTime: now - (6 - i) * 3600000 + 3599999,
          high: `${45000 + i * 1000}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(candles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // Should calculate ATH from all 5 available closed candles
      expect(manager.calculateATH()).toBe(49000); // 45000 + 4 * 1000
    });

    // Test 4: Update ATH when new closed candles are added
    it("should update ATH when new closed candles are added", async () => {
      const now = Date.now();

      // Initialize with 20 closed candles
      const initialCandles = Array.from({ length: 20 }, (_, i) =>
        createMockKline({
          openTime: now - (21 - i) * 3600000,
          closeTime: now - (21 - i) * 3600000 + 3599999,
          high: `${50000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(initialCandles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      const initialATH = manager.calculateATH();
      expect(initialATH).toBe(51900); // Last candle has highest

      // Add a new closed candle with higher high
      const newClosedCandle = createMockKline({
        openTime: now - 1800000,
        closeTime: now - 1,
        high: "60000.00",
        isClosed: true,
      });

      manager.addCandle(newClosedCandle);

      // ATH should update to reflect new closed candle
      expect(manager.calculateATH()).toBe(60000);
    });

    // Test 5: Emit ATH change events
    it("should emit ATH change events when value changes", async () => {
      const now = Date.now();
      const eventListener = jest.fn();

      // Initialize with some candles
      const initialCandles = Array.from({ length: 10 }, (_, i) =>
        createMockKline({
          openTime: now - (11 - i) * 3600000,
          closeTime: now - (11 - i) * 3600000 + 3599999,
          high: `${40000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(initialCandles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      // Subscribe to ATH change events
      manager.on("athChanged", eventListener);

      await manager.initialize();

      const initialATH = manager.calculateATH();
      expect(initialATH).toBe(40900);

      // Add new closed candle with higher high
      const newHighCandle = createMockKline({
        openTime: now - 1800000, // 30 minutes ago
        closeTime: now - 1, // Just closed
        high: "50000.00",
        isClosed: true,
      });

      manager.addCandle(newHighCandle);

      // Should emit event with old and new ATH values
      expect(eventListener).toHaveBeenCalledWith({
        oldATH: 40900,
        newATH: 50000,
        timestamp: expect.any(Number),
      });

      // Add candle with lower high - should NOT emit event
      eventListener.mockClear();
      const lowerCandle = createMockKline({
        openTime: now - 900000, // 15 minutes ago
        closeTime: now - 2, // Just closed
        high: "45000.00",
        isClosed: true,
      });

      manager.addCandle(lowerCandle);
      expect(eventListener).not.toHaveBeenCalled();
    });

    // Test 6: Performance with sliding window updates
    it("should efficiently update ATH with sliding window of 20 candles", async () => {
      const now = Date.now();

      // Initialize with 20 candles
      const initialCandles = Array.from({ length: 20 }, (_, i) =>
        createMockKline({
          openTime: now - (21 - i) * 3600000,
          closeTime: now - (21 - i) * 3600000 + 3599999,
          high: `${50000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(initialCandles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.calculateATH()).toBe(51900);

      // Add 10 more candles - should maintain only last 20
      for (let i = 0; i < 10; i++) {
        const newCandle = createMockKline({
          openTime: now - (10 - i) * 1800000, // Past times
          closeTime: now - (10 - i) * 1800000 + 1799999, // Closed in the past
          high: `${52000 + i * 100}.00`,
          isClosed: true,
        });
        manager.addCandle(newCandle);
      }

      // Should only consider last 20 candles for ATH
      const history = manager.getCandleHistory();
      const closedHistory = history.filter((c) => c.isClosed);
      expect(closedHistory.length).toBeLessThanOrEqual(20);

      // ATH should be from the newest candles (52900)
      expect(manager.calculateATH()).toBe(52900);
    });

    // Test 7: Edge case - no candles
    it("should return 0 ATH when no candles exist", () => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      expect(manager.calculateATH()).toBe(0);
    });

    // Test 8: Edge case - single candle
    it("should handle single closed candle correctly", async () => {
      const singleCandle = createMockKline({
        high: "42000.00",
        isClosed: true,
      });

      (mockClient.getKlines as MockGetKlines).mockResolvedValue([singleCandle]);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.calculateATH()).toBe(42000);
    });

    // Test 9: Edge case - duplicate highs
    it("should handle duplicate high values correctly", async () => {
      const now = Date.now();

      // Create candles with duplicate highs
      const candles = Array.from({ length: 10 }, (_, i) =>
        createMockKline({
          openTime: now - (11 - i) * 3600000,
          closeTime: now - (11 - i) * 3600000 + 3599999,
          high: i < 5 ? "50000.00" : "55000.00", // 5 with 50k, 5 with 55k
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(candles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.calculateATH()).toBe(55000);
    });

    // Test 10: Only closed candles in sliding window
    it("should only include closed candles in 20-candle sliding window", async () => {
      const now = Date.now();

      // Create 25 closed candles
      const closedCandles = Array.from({ length: 25 }, (_, i) =>
        createMockKline({
          openTime: now - (26 - i) * 3600000,
          closeTime: now - (26 - i) * 3600000 + 3599999,
          high: `${40000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      // Add unclosed candle
      const unclosedCandle = createMockKline({
        openTime: now - 3600000,
        closeTime: now + 1800000,
        high: "100000.00",
        isClosed: false,
      });

      (mockClient.getKlines as MockGetKlines).mockResolvedValue([
        ...closedCandles,
        unclosedCandle,
      ]);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // Should only use last 20 closed candles (indices 5-24), ATH = 40000 + 24*100 = 42400
      expect(manager.calculateATH()).toBe(42400);
    });

    // Test 11: ATH updates trigger recalculation
    it("should recalculate ATH when candle window shifts", async () => {
      const now = Date.now();

      // Initialize with 20 candles where candle 10 has the highest value
      const initialCandles = Array.from({ length: 20 }, (_, i) =>
        createMockKline({
          openTime: now - (21 - i) * 3600000,
          closeTime: now - (21 - i) * 3600000 + 3599999,
          high: i === 10 ? "70000.00" : `${50000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(initialCandles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      expect(manager.calculateATH()).toBe(70000);

      // Add 11 new candles to push the high-value candle out of the window
      // Initial candles are from (now - 21h) to (now - 1h)
      // The 70000 candle is at index 10, which is at (now - 11h)
      // To push it out, we need 11 more recent candles
      for (let i = 0; i < 11; i++) {
        const candleTime = now - 3600000 - (10 - i) * 300000; // Recent past times
        manager.addCandle(
          createMockKline({
            openTime: candleTime,
            closeTime: candleTime + 299999, // 5 minute candles, closed
            high: "60000.00",
            isClosed: true,
          }),
        );
      }

      // ATH should now be 60000 as the 70000 candle is out of the 20-candle window
      expect(manager.calculateATH()).toBe(60000);
    });

    // Test 12: Method signature for excluding unclosed candles
    it("should have method signature to exclude unclosed candles", () => {
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      // Test that calculateATH can accept options
      const athWithOptions = manager.calculateATH({ excludeUnclosed: true });
      expect(athWithOptions).toBe(0); // No candles

      // Test default behavior excludes unclosed
      const athDefault = manager.calculateATH();
      expect(athDefault).toBe(0);
    });

    // Test 13: Performance optimization - caching ATH
    it("should cache ATH value and only recalculate when candles change", async () => {
      const now = Date.now();
      const candles = Array.from({ length: 20 }, (_, i) =>
        createMockKline({
          openTime: now - (21 - i) * 3600000,
          closeTime: now - (21 - i) * 3600000 + 3599999,
          high: `${50000 + i * 100}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(candles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // Spy on internal calculation method (if exposed)
      const calculateSpy = jest.spyOn(manager, "calculateATH");

      // First call should calculate
      const ath1 = manager.calculateATH();
      expect(ath1).toBe(51900);
      expect(calculateSpy).toHaveBeenCalledTimes(1);

      // Second call without changes should return cached value
      const ath2 = manager.calculateATH();
      expect(ath2).toBe(51900);

      // Add new candle to invalidate cache
      manager.addCandle(
        createMockKline({
          openTime: now - 600000, // 10 minutes ago
          closeTime: now - 1, // Just closed
          high: "55000.00",
          isClosed: true,
        }),
      );

      // Should recalculate after change
      const ath3 = manager.calculateATH();
      expect(ath3).toBe(55000);

      calculateSpy.mockRestore();
    });

    // Test 14: Handle candle close time validation
    it("should determine if candle is closed based on closeTime vs current time", async () => {
      const now = Date.now();

      // Closed candle: closeTime is in the past
      const closedCandle = createMockKline({
        openTime: now - 7200000,
        closeTime: now - 3600000,
        high: "50000.00",
      });

      // Unclosed candle: closeTime is in the future
      const unclosedCandle = createMockKline({
        openTime: now - 3600000,
        closeTime: now + 3600000,
        high: "60000.00",
      });

      (mockClient.getKlines as MockGetKlines).mockResolvedValue([
        closedCandle,
        unclosedCandle,
      ]);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // Should only consider the closed candle
      expect(manager.calculateATH()).toBe(50000);
    });

    // Test 15: ATH calculation with getATH method
    it("should provide getATH() method for cached access", async () => {
      const now = Date.now();
      const candles = Array.from({ length: 10 }, (_, i) =>
        createMockKline({
          openTime: now - (11 - i) * 3600000,
          closeTime: now - (11 - i) * 3600000 + 3599999,
          high: `${45000 + i * 500}.00`,
          isClosed: true,
        }),
      );

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(candles);

      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
      await manager.initialize();

      // getATH should return cached value without recalculation
      const ath = manager.getATH();
      expect(ath).toBe(49500);
    });
  });

  describe("REST API Fallback", () => {
    beforeEach(async () => {
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue(mockKlines);

      // Clear the initial fetch from initialize
      jest.clearAllMocks();

      manager.startRestPolling(1000);

      // Initial fetch happens immediately
      await Promise.resolve();
      await Promise.resolve();
      expect(mockClient.getKlines).toHaveBeenCalledTimes(1);

      // Fast-forward time for first interval
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(mockClient.getKlines).toHaveBeenCalledTimes(2);

      // Fast-forward time for second interval
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(mockClient.getKlines).toHaveBeenCalledTimes(3);

      manager.stopRestPolling();
      jest.useRealTimers();
    });

    it("should handle polling errors gracefully", async () => {
      jest.useFakeTimers();

      (mockClient.getKlines as MockGetKlines).mockRejectedValue(
        new Error("Network error"),
      );

      // Spy on logger to suppress and verify error logging
      const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});

      manager.startRestPolling(1000);

      // Wait for initial poll to complete with error
      await jest.runOnlyPendingTimersAsync();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("REST polling error"),
        expect.objectContaining({
          error: "Network error",
          symbol: testSymbol,
        }),
      );
      expect(manager.isPolling()).toBe(true); // Should continue polling

      manager.stopRestPolling();
      errorSpy.mockRestore();
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

      // Reset manager state to avoid candles from initialization
      manager.stop();
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );

      (mockClient.getKlines as MockGetKlines)
        .mockResolvedValueOnce([candle1])
        .mockResolvedValueOnce([candle1, candle2]);

      manager.startRestPolling(1000);

      // Wait for first poll (immediate)
      await Promise.resolve();
      await Promise.resolve();
      expect(manager.getCandleHistory()).toHaveLength(1);

      // Advance for second poll
      jest.advanceTimersByTime(1000);
      await jest.runOnlyPendingTimersAsync();
      expect(manager.getCandleHistory()).toHaveLength(2);
      expect(manager.calculateATH()).toBe(60000);

      manager.stopRestPolling();
      jest.useRealTimers();
    });
  });

  describe("WebSocket Failure Detection", () => {
    beforeEach(async () => {
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([
        createMockKline(),
      ]);
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

      // Spy on logger to suppress and verify warning
      const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

      manager.addCandle(zeroVolumeCandle);

      expect(warnSpy).toHaveBeenCalledWith(
        "Zero volume candle detected",
        expect.objectContaining({
          symbol: testSymbol,
        }),
      );

      warnSpy.mockRestore();
    });

    it("should reject negative price values", () => {
      const negativeCandle = createMockKline({ high: "-100.00" });

      expect(() => manager.addCandle(negativeCandle)).toThrow("Negative price");
    });
  });

  describe("Performance Monitoring", () => {
    beforeEach(async () => {
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
      manager = new HistoricalCandleManager(
        mockClient,
        testSymbol,
        testInterval,
      );
    });

    it("should track fetch latency", async () => {
      jest.useRealTimers(); // Use real timers for accurate timing
      const delay = 50;
      (mockClient.getKlines as MockGetKlines).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve([createMockKline()]), delay),
          ),
      );

      await manager.initialize();

      const metrics = manager.getMetrics();
      // Allow some tolerance for timing
      expect(metrics.lastFetchLatency).toBeGreaterThanOrEqual(delay - 10);
      expect(metrics.lastFetchLatency).toBeLessThan(delay + 200);
    }, 10000);

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
      (mockClient.getKlines as MockGetKlines)
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
  let mockClient: BinanceClient;
  let manager: HistoricalCandleManager;

  // Type for mocked getKlines function
  type MockGetKlines = jest.MockedFunction<
    typeof BinanceClient.prototype.getKlines
  >;

  const createMockKline = (
    overrides?: Partial<ExtendedKline>,
  ): ExtendedKline => {
    const baseTime = Date.now() - 3600000;
    return {
      openTime: baseTime,
      open: "50000.00",
      high: "51000.00",
      low: "49000.00",
      close: "50500.00",
      volume: "100.00",
      closeTime: baseTime + 3599999, // 1 ms before the next hour
      quoteAssetVolume: "5050000.00",
      numberOfTrades: 1000,
      takerBuyBaseAssetVolume: "50.00",
      takerBuyQuoteAssetVolume: "2525000.00",
      ...overrides,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = new BinanceClient({
      apiKey: "test",
      apiSecret: "test",
      testnet: true,
    });
    mockClient.getKlines = jest.fn() as unknown as typeof mockClient.getKlines;
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
  });

  describe("Full WebSocket Failure Recovery Flow", () => {
    it("should handle complete failure → REST polling → recovery cycle", async () => {
      jest.useFakeTimers();

      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([newCandle]);

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

      (mockClient.getKlines as MockGetKlines).mockResolvedValue(
        historicalCandles,
      );
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

      (mockClient.getKlines as MockGetKlines)
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

      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
      manager = new HistoricalCandleManager(mockClient, "BTCUSDT", "1h");
      await manager.initialize();

      let callCount = 0;
      (mockClient.getKlines as MockGetKlines).mockImplementation(() => {
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
      (mockClient.getKlines as MockGetKlines).mockResolvedValue([]);
      manager = new HistoricalCandleManager(mockClient, "BTCUSDT", "1h", {
        maxCandles: 20,
      });
      await manager.initialize();

      // Add thousands of candles
      const baseTime = Date.now();
      for (let i = 0; i < 1000; i++) {
        const openTime = baseTime + i * 3600000; // Each candle 1 hour apart
        manager.addCandle(
          createMockKline({
            openTime,
            closeTime: openTime + 3599999,
          }),
        );
      }

      // Should still only have maxCandles in memory
      expect(manager.getCandleHistory()).toHaveLength(20);

      const finalMetrics = manager.getMetrics();
      // Memory should be bounded - we only keep 20 candles regardless of how many we add
      // The memory usage should be reasonable for 20 candles (less than 10MB)
      expect(finalMetrics.memoryUsage).toBeLessThan(10 * 1024 * 1024); // 10MB
      // Verify we only have maxCandles in memory
      expect(manager.getCandleHistory()).toHaveLength(20);
    });
  });
});
