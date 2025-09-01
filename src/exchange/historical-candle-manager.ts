import { EventEmitter } from "events";
import { BinanceClient } from "./binance-client";
import type { BinanceKline } from "./types";
import { logger } from "../utils/logger";

// Extended kline with closed status
export interface ExtendedKline extends BinanceKline {
  isClosed?: boolean;
}

export interface HistoricalCandleConfig {
  maxCandles?: number;
  restPollingInterval?: number;
  websocketFailureThreshold?: number;
}

export interface ATHCalculateOptions {
  excludeUnclosed?: boolean;
}

export interface ATHChangeEvent {
  oldATH: number;
  newATH: number;
  timestamp: number;
}

export interface CandleStatistics {
  candleCount: number;
  windowSize: number;
  isFullWindow: boolean;
}

export interface CandleMetrics {
  lastFetchLatency: number;
  averageFetchLatency: number;
  memoryUsage: number;
  candleCount: number;
  totalFetches: number;
  failedFetches: number;
  successRate: number;
}

export class HistoricalCandleManager extends EventEmitter {
  private client: BinanceClient;
  private symbol: string;
  private interval: string;
  private config: Required<HistoricalCandleConfig>;
  private candles: ExtendedKline[] = [];
  private initialized = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private websocketFailureCount = 0;
  private fetchLatencies: number[] = [];
  private totalFetches = 0;
  private failedFetches = 0;
  private lastFetchLatency = 0;
  private initialMemoryUsage = 0;
  private cachedATH: number | null = null;
  private lastATHCandles: ExtendedKline[] = [];

  constructor(
    client: BinanceClient,
    symbol: string,
    interval: string,
    config?: HistoricalCandleConfig,
  ) {
    super();
    this.client = client;
    this.symbol = symbol;
    this.interval = interval;
    this.config = {
      maxCandles: config?.maxCandles ?? 20,
      restPollingInterval: config?.restPollingInterval ?? 60000,
      websocketFailureThreshold: config?.websocketFailureThreshold ?? 5,
    };
    this.initialMemoryUsage = process.memoryUsage().heapUsed;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const startTime = Date.now();
    try {
      this.totalFetches++;
      const klines = await this.client.getKlines(
        this.symbol,
        this.interval,
        this.config.maxCandles,
      );

      this.lastFetchLatency = Date.now() - startTime;
      this.fetchLatencies.push(this.lastFetchLatency);

      if (klines.length < this.config.maxCandles) {
        logger.warn(
          `HistoricalCandleManager: insufficient history for ${this.symbol}`,
          {
            symbol: this.symbol,
            received: klines.length,
            expected: this.config.maxCandles,
            module: "HistoricalCandleManager",
          },
        );
      }

      // Mark all fetched candles with their closed status
      this.candles = klines.map((kline) => this.markCandleStatus(kline));

      // Initialize ATH cache after loading candles
      this.cachedATH = null;
      this.calculateATH(); // Populate cache
      this.initialized = true;
    } catch (error) {
      this.failedFetches++;
      this.lastFetchLatency = Date.now() - startTime;
      this.fetchLatencies.push(this.lastFetchLatency);
      throw error;
    }
  }

  addCandle(candle: BinanceKline | ExtendedKline): void {
    // Validate candle data
    this.validateCandle(candle);

    // Check for zero volume
    if (parseFloat(candle.volume) === 0) {
      logger.warn("Zero volume candle detected", {
        symbol: this.symbol,
        timestamp: new Date(candle.openTime).toISOString(),
        module: "HistoricalCandleManager",
      });
    }

    // Mark candle status if not already marked
    const markedCandle = this.markCandleStatus(candle);

    // Check if candle with same openTime exists
    const existingIndex = this.candles.findIndex(
      (c) => c.openTime === markedCandle.openTime,
    );

    // Get old ATH before making changes
    const oldATH = this.getATH();

    if (existingIndex !== -1) {
      // Update existing candle
      this.candles[existingIndex] = markedCandle;
    } else {
      // Add new candle
      this.candles.push(markedCandle);

      // Maintain sliding window - keep maxCandles most recent
      if (this.candles.length > this.config.maxCandles) {
        // Sort by openTime and keep most recent
        this.candles.sort((a, b) => a.openTime - b.openTime);
        this.candles = this.candles.slice(-this.config.maxCandles);
      }
    }

    // Invalidate cache when candles change
    this.cachedATH = null;

    // Check if ATH changed and emit event if it did
    const newATH = this.calculateATH();
    if (oldATH !== 0 && oldATH !== newATH && markedCandle.isClosed) {
      this.emit("athChanged", {
        oldATH,
        newATH,
        timestamp: Date.now(),
      } as ATHChangeEvent);
    }
  }

  private markCandleStatus(
    candle: BinanceKline | ExtendedKline,
  ): ExtendedKline {
    const now = Date.now();
    // A candle is closed if its closeTime is in the past
    const isClosed = candle.closeTime < now;
    return {
      ...candle,
      isClosed,
    };
  }

  private validateCandle(candle: BinanceKline | ExtendedKline): void {
    // Validate numeric values
    const prices = [candle.open, candle.high, candle.low, candle.close];
    for (const price of prices) {
      const numPrice = parseFloat(price);
      if (isNaN(numPrice)) {
        throw new Error(`Invalid numeric value: ${price}`);
      }
      if (numPrice < 0) {
        throw new Error(`Negative price detected: ${price}`);
      }
    }

    // Validate timestamp sequencing
    if (candle.closeTime < candle.openTime) {
      throw new Error(
        `Invalid timestamp sequence: closeTime (${candle.closeTime}) < openTime (${candle.openTime})`,
      );
    }
  }

  getCandleHistory(): ExtendedKline[] {
    // Return a copy to ensure thread safety
    return [...this.candles];
  }

  calculateATH(options?: ATHCalculateOptions): number {
    // Default is to exclude unclosed candles
    const excludeUnclosed = options?.excludeUnclosed ?? true;

    // Check if we can use cached value
    if (this.cachedATH !== null && this.candlesMatchCache()) {
      return this.cachedATH;
    }

    if (this.candles.length === 0) {
      this.cachedATH = 0;
      this.lastATHCandles = [];
      return 0;
    }

    // Filter to only closed candles if required
    const candlesToUse = excludeUnclosed
      ? this.candles.filter((c) => {
          // Re-check closed status in case time has passed
          const now = Date.now();
          c.isClosed = c.closeTime < now;
          return c.isClosed;
        })
      : this.candles;

    if (candlesToUse.length === 0) {
      this.cachedATH = 0;
      this.lastATHCandles = [...this.candles];
      return 0;
    }

    // Calculate max from the last 20 closed candles
    const recentClosedCandles = candlesToUse.slice(-20);

    let maxHigh = 0;
    for (const candle of recentClosedCandles) {
      const high = parseFloat(candle.high);
      if (high > maxHigh) {
        maxHigh = high;
      }
    }

    // Cache the result
    this.cachedATH = maxHigh;
    this.lastATHCandles = [...this.candles];

    return maxHigh;
  }

  getATH(): number {
    // Return cached ATH without recalculation
    if (this.cachedATH !== null && this.candlesMatchCache()) {
      return this.cachedATH;
    }
    return this.calculateATH();
  }

  private candlesMatchCache(): boolean {
    // Check if candles have changed since last ATH calculation
    if (this.candles.length !== this.lastATHCandles.length) {
      return false;
    }

    // Quick check - compare first and last candle
    if (this.candles.length > 0) {
      const firstMatch =
        this.candles[0].openTime === this.lastATHCandles[0]?.openTime;
      const lastIdx = this.candles.length - 1;
      const lastMatch =
        this.candles[lastIdx].openTime ===
        this.lastATHCandles[lastIdx]?.openTime;
      return firstMatch && lastMatch;
    }

    return true;
  }

  getStatistics(): CandleStatistics {
    return {
      candleCount: this.candles.length,
      windowSize: this.config.maxCandles,
      isFullWindow: this.candles.length === this.config.maxCandles,
    };
  }

  getMetrics(): CandleMetrics {
    const currentMemoryUsage = process.memoryUsage().heapUsed;
    const memoryUsage = Math.max(
      0,
      currentMemoryUsage - this.initialMemoryUsage,
    );

    const averageFetchLatency =
      this.fetchLatencies.length > 0
        ? this.fetchLatencies.reduce((a, b) => a + b, 0) /
          this.fetchLatencies.length
        : 0;

    const successRate =
      this.totalFetches > 0
        ? (this.totalFetches - this.failedFetches) / this.totalFetches
        : 0;

    return {
      lastFetchLatency: this.lastFetchLatency,
      averageFetchLatency,
      memoryUsage,
      candleCount: this.candles.length,
      totalFetches: this.totalFetches,
      failedFetches: this.failedFetches,
      successRate,
    };
  }

  startRestPolling(intervalMs?: number): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    const pollInterval = intervalMs ?? this.config.restPollingInterval;

    const poll = async () => {
      try {
        await this.fetchLatestCandles();
      } catch (error) {
        logger.error("REST polling error", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          symbol: this.symbol,
          module: "HistoricalCandleManager",
        });
        // Continue polling even on error
      }
    };

    // Start polling
    this.pollingInterval = setInterval(poll, pollInterval);

    // Do immediate fetch
    poll().catch((error) => {
      logger.error("Initial REST polling fetch error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        symbol: this.symbol,
        module: "HistoricalCandleManager",
      });
    });
  }

  stopRestPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  isPolling(): boolean {
    return this.pollingInterval !== null;
  }

  async fetchLatestCandles(): Promise<void> {
    const startTime = Date.now();
    try {
      this.totalFetches++;
      const klines = await this.client.getKlines(
        this.symbol,
        this.interval,
        this.config.maxCandles,
      );

      this.lastFetchLatency = Date.now() - startTime;
      this.fetchLatencies.push(this.lastFetchLatency);

      // Keep only last 100 latencies for average calculation
      if (this.fetchLatencies.length > 100) {
        this.fetchLatencies = this.fetchLatencies.slice(-100);
      }

      // Merge new candles with existing ones
      for (const kline of klines) {
        this.addCandle(this.markCandleStatus(kline));
      }
    } catch (error) {
      this.failedFetches++;
      this.lastFetchLatency = Date.now() - startTime;
      this.fetchLatencies.push(this.lastFetchLatency);
      throw error;
    }
  }

  recordWebSocketFailure(): void {
    this.websocketFailureCount++;

    // Auto-start REST polling if threshold reached
    if (this.websocketFailureCount >= this.config.websocketFailureThreshold) {
      this.startRestPolling();
    }
  }

  recordWebSocketRecovery(): void {
    this.websocketFailureCount = 0;
    // Stop REST polling when WebSocket recovers
    this.stopRestPolling();
  }

  getWebSocketFailureCount(): number {
    return this.websocketFailureCount;
  }

  getConfiguration(): Required<HistoricalCandleConfig> {
    return { ...this.config };
  }

  stop(): void {
    this.stopRestPolling();
    this.candles = [];
    this.initialized = false;
    this.websocketFailureCount = 0;
    this.fetchLatencies = [];
    this.totalFetches = 0;
    this.failedFetches = 0;
    this.lastFetchLatency = 0;
    this.cachedATH = null;
    this.lastATHCandles = [];
    this.removeAllListeners();
  }
}
