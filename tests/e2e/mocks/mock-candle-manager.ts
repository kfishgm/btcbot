/**
 * Mock Candle Manager for E2E Tests
 *
 * Manages candle data shared between MockBinanceClient and MockWebSocketManager
 * to accurately simulate the bot's behavior with historical and live candles.
 */

export interface TestCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  comment?: string;
}

export class MockCandleManager {
  private candles: TestCandle[] = [];
  private historicalCandleIndex: number = 0; // Where historical data ends
  private currentCandleIndex: number = 0; // Current position in candle stream

  constructor(candles: TestCandle[] = []) {
    this.candles = candles;
  }

  /**
   * Set the candle data from a scenario
   */
  setCandles(candles: TestCandle[]): void {
    this.candles = candles;
    this.historicalCandleIndex = 0;
    this.currentCandleIndex = 0;
  }

  /**
   * Set how many candles should be considered "historical" (available via getKlines)
   * The rest will be "live" candles that come through websocket
   */
  setHistoricalCount(count: number): void {
    this.historicalCandleIndex = Math.min(count, this.candles.length);
    this.currentCandleIndex = this.historicalCandleIndex;
  }

  /**
   * Get historical candles (for BinanceClient.getKlines)
   * Returns candles up to the historical index
   */
  getHistoricalCandles(limit?: number): TestCandle[] {
    const endIdx = this.historicalCandleIndex;
    const startIdx = limit ? Math.max(0, endIdx - limit) : 0;
    return this.candles.slice(startIdx, endIdx);
  }

  /**
   * Get the next live candle (for WebSocket emission)
   * Returns null if no more candles
   */
  getNextLiveCandle(): TestCandle | null {
    if (this.currentCandleIndex >= this.candles.length) {
      return null;
    }
    const candle = this.candles[this.currentCandleIndex];
    this.currentCandleIndex++;
    return candle;
  }

  /**
   * Get current price (last known close price)
   */
  getCurrentPrice(): number {
    if (this.currentCandleIndex > 0) {
      return this.candles[this.currentCandleIndex - 1].close;
    }
    if (this.historicalCandleIndex > 0) {
      return this.candles[this.historicalCandleIndex - 1].close;
    }
    if (this.candles.length > 0) {
      return this.candles[0].close;
    }
    return 100000; // Default price
  }

  /**
   * Get price at specific candle index
   */
  getPriceAtIndex(index: number): number {
    if (index >= 0 && index < this.candles.length) {
      return this.candles[index].close;
    }
    return this.getCurrentPrice();
  }

  /**
   * Check if there are more live candles to emit
   */
  hasMoreLiveCandles(): boolean {
    return this.currentCandleIndex < this.candles.length;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.historicalCandleIndex = 0;
    this.currentCandleIndex = 0;
  }

  /**
   * Get all candles (for debugging)
   */
  getAllCandles(): TestCandle[] {
    return [...this.candles];
  }

  /**
   * Get candle at specific index
   */
  getCandleAt(index: number): TestCandle | null {
    if (index >= 0 && index < this.candles.length) {
      return this.candles[index];
    }
    return null;
  }

  /**
   * Get status information
   */
  getStatus(): {
    totalCandles: number;
    historicalCount: number;
    currentIndex: number;
    remainingLive: number;
  } {
    return {
      totalCandles: this.candles.length,
      historicalCount: this.historicalCandleIndex,
      currentIndex: this.currentCandleIndex,
      remainingLive: this.candles.length - this.currentCandleIndex,
    };
  }
}
