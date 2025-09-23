/**
 * Mock WebSocket Manager for E2E Tests
 *
 * Emits live candles from test scenarios after historical candles have been fetched
 */

import { EventEmitter } from "events";
import type { CandleData } from "../../../src/exchange/websocket-types.js";
import { MockCandleManager } from "./mock-candle-manager.js";

export interface MockWebSocketConfig {
  candleManager?: MockCandleManager;
  emitInterval?: number; // Milliseconds between candle emissions (0 = instant)
  symbol?: string;
  onCandleEmitted?: () => void; // Callback when a candle is emitted
}

export class MockWebSocketManager extends EventEmitter {
  private candleManager: MockCandleManager;
  private onCandleEmitted?: () => void;
  private emitTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private symbol: string;
  private emitInterval: number;

  constructor(config?: MockWebSocketConfig) {
    super();
    this.candleManager = config?.candleManager || new MockCandleManager();
    this.symbol = config?.symbol || "BTCUSDT";
    this.emitInterval = config?.emitInterval || 0;
    this.onCandleEmitted = config?.onCandleEmitted;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    this.isConnected = true;
    this.emit("connected");

    // Start emitting live candles if available
    if (this.candleManager.hasMoreLiveCandles() && this.emitInterval === 0) {
      // Emit all candles immediately for fast testing
      setImmediate(() => this.emitAllCandles());
    } else if (this.candleManager.hasMoreLiveCandles()) {
      // Emit candles with interval
      this.startEmittingCandles();
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    this.isConnected = false;
    if (this.emitTimer) {
      clearInterval(this.emitTimer);
      this.emitTimer = null;
    }
    this.emit("disconnected");
  }

  private emitAllCandles(): void {
    while (this.candleManager.hasMoreLiveCandles() && this.isConnected) {
      this.emitNextCandle();
    }
  }

  private startEmittingCandles(): void {
    this.emitTimer = setInterval(() => {
      if (this.isConnected && this.candleManager.hasMoreLiveCandles()) {
        this.emitNextCandle();
      } else {
        this.stopEmitting();
      }
    }, this.emitInterval);
  }

  private emitNextCandle(): void {
    const testCandle = this.candleManager.getNextLiveCandle();
    if (!testCandle) return;

    const candleData: CandleData = {
      eventTime: Date.now(),
      symbol: this.symbol,
      openTime: testCandle.openTime,
      closeTime: testCandle.closeTime,
      firstTradeId: 0,
      lastTradeId: 0,
      open: testCandle.open.toString(),
      close: testCandle.close.toString(),
      high: testCandle.high.toString(),
      low: testCandle.low.toString(),
      volume: testCandle.volume.toString(),
      numberOfTrades: 1,
      isCandleClosed: true, // Mark as final/closed candle
      quoteAssetVolume: (testCandle.volume * testCandle.close).toString(),
      takerBuyBaseAssetVolume: "0",
      takerBuyQuoteAssetVolume: "0",
    };

    this.emit("candle", candleData);

    // Call the callback if provided (to update Binance mock price)
    if (this.onCandleEmitted) {
      this.onCandleEmitted();
    }

    // Emit completion when all candles are done
    if (!this.candleManager.hasMoreLiveCandles()) {
      this.emit("scenario_complete");
    }
  }

  private stopEmitting(): void {
    if (this.emitTimer) {
      clearInterval(this.emitTimer);
      this.emitTimer = null;
    }
  }

  // Test helper methods
  setCandleManager(candleManager: MockCandleManager): void {
    this.candleManager = candleManager;
  }

  reset(): void {
    this.candleManager.reset();
    this.stopEmitting();
  }

  isRunning(): boolean {
    return this.isConnected;
  }

  // Manually trigger next candle (useful for step-by-step testing)
  emitNext(): void {
    if (this.isConnected && this.candleManager.hasMoreLiveCandles()) {
      this.emitNextCandle();
    }
  }

  // Wait for all candles to be emitted
  async waitForCompletion(): Promise<void> {
    if (!this.candleManager.hasMoreLiveCandles()) return;

    return new Promise((resolve) => {
      this.once("scenario_complete", resolve);
    });
  }

  // Get status info
  getStatus(): {
    isConnected: boolean;
    remainingLiveCandles: number;
  } {
    const status = this.candleManager.getStatus();
    return {
      isConnected: this.isConnected,
      remainingLiveCandles: status.remainingLive,
    };
  }

  // Typed event methods - use more specific method names
  onCandle(listener: (data: CandleData) => void): this {
    return this.on("candle", listener);
  }

  onConnected(listener: () => void): this {
    return this.on("connected", listener);
  }

  onDisconnected(listener: () => void): this {
    return this.on("disconnected", listener);
  }

  onScenarioComplete(listener: () => void): this {
    return this.on("scenario_complete", listener);
  }

  onError(listener: (error: Error) => void): this {
    return this.on("error", listener);
  }
}
