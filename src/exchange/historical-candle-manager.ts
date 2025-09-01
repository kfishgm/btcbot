import { BinanceClient } from "./binance-client";
import type { BinanceKline } from "./types";
import { logger } from "../utils/logger";

export interface HistoricalCandleConfig {
  maxCandles?: number;
  restPollingInterval?: number;
  websocketFailureThreshold?: number;
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

export class HistoricalCandleManager {
  private client: BinanceClient;
  private symbol: string;
  private interval: string;
  private config: Required<HistoricalCandleConfig>;
  private candles: BinanceKline[] = [];
  private initialized = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private websocketFailureCount = 0;
  private fetchLatencies: number[] = [];
  private totalFetches = 0;
  private failedFetches = 0;
  private lastFetchLatency = 0;
  private initialMemoryUsage = 0;

  constructor(
    client: BinanceClient,
    symbol: string,
    interval: string,
    config?: HistoricalCandleConfig,
  ) {
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

      this.candles = klines;
      this.initialized = true;
    } catch (error) {
      this.failedFetches++;
      this.lastFetchLatency = Date.now() - startTime;
      this.fetchLatencies.push(this.lastFetchLatency);
      throw error;
    }
  }

  addCandle(candle: BinanceKline): void {
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

    // Check if candle with same openTime exists
    const existingIndex = this.candles.findIndex(
      (c) => c.openTime === candle.openTime,
    );

    if (existingIndex !== -1) {
      // Update existing candle
      this.candles[existingIndex] = candle;
    } else {
      // Add new candle
      this.candles.push(candle);

      // Maintain sliding window
      if (this.candles.length > this.config.maxCandles) {
        // Sort by openTime and keep most recent
        this.candles.sort((a, b) => a.openTime - b.openTime);
        this.candles = this.candles.slice(-this.config.maxCandles);
      }
    }
  }

  private validateCandle(candle: BinanceKline): void {
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

  getCandleHistory(): BinanceKline[] {
    // Return a copy to ensure thread safety
    return [...this.candles];
  }

  calculateATH(): number {
    if (this.candles.length === 0) {
      return 0;
    }

    let maxHigh = 0;
    for (const candle of this.candles) {
      const high = parseFloat(candle.high);
      if (high > maxHigh) {
        maxHigh = high;
      }
    }
    return maxHigh;
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
        this.addCandle(kline);
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
  }
}
