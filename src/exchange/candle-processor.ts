import { EventEmitter } from "events";
import type { KlineMessage, CandleData } from "./websocket-types";

export interface CandleProcessorOptions {
  maxTimestampDrift?: number;
  maxCacheSize?: number;
}

export interface CandleProcessorStats {
  messagesProcessed: number;
  candlesClosed: number;
  candlesUpdated: number;
  errorsCount: number;
  lastProcessedTime: number | null;
  processingRate: number;
  cacheSize: number;
}

export interface CandleProcessorError {
  message: string;
  code: string;
  timestamp: number;
  data?: unknown;
}

export class CandleProcessor extends EventEmitter {
  private options: Required<CandleProcessorOptions>;
  private stats: CandleProcessorStats;
  private processedCandles: Map<string, CandleData>;
  private processingTimes: number[] = [];

  constructor(options: CandleProcessorOptions = {}) {
    super();
    this.options = {
      maxTimestampDrift: options.maxTimestampDrift ?? 60000, // 60 seconds default
      maxCacheSize: options.maxCacheSize ?? 1000,
    };

    this.stats = {
      messagesProcessed: 0,
      candlesClosed: 0,
      candlesUpdated: 0,
      errorsCount: 0,
      lastProcessedTime: null,
      processingRate: 0,
      cacheSize: 0,
    };

    this.processedCandles = new Map();
  }

  parseMessage(message: KlineMessage): CandleData {
    if (message.e !== "kline") {
      throw new Error(`Invalid message type: expected kline, got ${message.e}`);
    }

    if (!message.k) {
      throw new Error("Invalid kline message: missing kline data");
    }

    const { k } = message;

    return {
      eventTime: message.E,
      symbol: message.s,
      openTime: k.t,
      closeTime: k.T,
      firstTradeId: k.f,
      lastTradeId: k.L,
      open: k.o,
      high: k.h,
      low: k.l,
      close: k.c,
      volume: k.v,
      numberOfTrades: k.n,
      isCandleClosed: k.x,
      quoteAssetVolume: k.q,
      takerBuyBaseAssetVolume: k.V,
      takerBuyQuoteAssetVolume: k.Q,
    };
  }

  convertToDecimal(value: string): number {
    if (value === null || value === undefined) {
      throw new Error("Invalid numeric string: null or undefined");
    }
    if (value === "") {
      throw new Error("Invalid numeric string: empty string");
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
      throw new Error(`Invalid numeric string: ${value}`);
    }
    // Round to 8 decimal places to avoid floating point precision issues
    return Math.round(num * 100000000) / 100000000;
  }

  validateTimestamp(message: KlineMessage): void {
    const now = Date.now();
    const messageTime = message.E;
    const drift = now - messageTime;

    if (drift < -this.options.maxTimestampDrift) {
      throw new Error("Timestamp too far in the future");
    }

    if (drift > this.options.maxTimestampDrift) {
      throw new Error("Timestamp too far in the past");
    }
  }

  isCandleClosed(message: KlineMessage): boolean {
    return message.k.x === true;
  }

  validateData(message: KlineMessage): void {
    const { k } = message;

    // Check for negative prices
    const prices = [k.o, k.h, k.l, k.c];
    for (const price of prices) {
      const numPrice = parseFloat(price);
      if (numPrice < 0) {
        throw new Error("Invalid data: negative price detected");
      }
    }

    // Check for zero volume on closed candles
    if (k.x === true) {
      const volume = parseFloat(k.v);
      if (volume === 0) {
        throw new Error("Invalid data: zero volume for closed candle");
      }
    }

    // Validate high/low relationship
    const high = parseFloat(k.h);
    const low = parseFloat(k.l);
    if (high < low) {
      throw new Error(`Invalid price range: high (${high}) < low (${low})`);
    }

    // Validate open/close within high/low range
    const open = parseFloat(k.o);
    const close = parseFloat(k.c);

    if (open > high || open < low) {
      throw new Error(`Open price (${open}) outside high/low range`);
    }

    if (close > high || close < low) {
      throw new Error(`Close price (${close}) outside high/low range`);
    }
  }

  processMessage(message: KlineMessage): void {
    const startTime = Date.now();

    try {
      // Validate timestamp
      this.validateTimestamp(message);

      // Validate data integrity
      this.validateData(message);

      // Parse message to candle data
      const candle = this.parseMessage(message);

      // Process the candle
      const processedCandle = this.processCandle(candle);

      // Update stats
      this.stats.messagesProcessed++;
      this.stats.lastProcessedTime = Date.now();

      // Emit appropriate event
      if (processedCandle.isCandleClosed) {
        this.stats.candlesClosed++;
        this.emit("candle_closed", processedCandle);
      } else {
        this.stats.candlesUpdated++;
        this.emit("candle_update", processedCandle);
      }

      // Update processing time metrics
      const processingTime = Date.now() - startTime;
      this.updateProcessingRate(processingTime);
    } catch (error) {
      this.handleError(error as Error, message);
    }
  }

  processBatch(messages: KlineMessage[]): void {
    for (const message of messages) {
      this.processMessage(message);
    }
  }

  processCandle(candle: CandleData): CandleData & { processedData?: unknown } {
    // Validate and convert numeric values
    const openDecimal = this.convertToDecimal(candle.open);
    const highDecimal = this.convertToDecimal(candle.high);
    const lowDecimal = this.convertToDecimal(candle.low);
    const closeDecimal = this.convertToDecimal(candle.close);
    const volumeDecimal = this.convertToDecimal(candle.volume);
    this.convertToDecimal(candle.quoteAssetVolume);
    this.convertToDecimal(candle.takerBuyBaseAssetVolume);
    this.convertToDecimal(candle.takerBuyQuoteAssetVolume);

    // Return candle with original string formatting preserved and add processedData
    const processedCandle = {
      ...candle,
      processedData: {
        openDecimal,
        closeDecimal,
        highDecimal,
        lowDecimal,
        volumeDecimal,
      },
    };

    // Cache the candle
    const cacheKey = `${candle.symbol}_${candle.openTime}`;
    this.processedCandles.set(cacheKey, processedCandle);

    // Manage cache size
    if (this.processedCandles.size > this.options.maxCacheSize) {
      const firstKey = this.processedCandles.keys().next().value;
      if (firstKey) {
        this.processedCandles.delete(firstKey);
      }
    }

    this.stats.cacheSize = this.processedCandles.size;

    return processedCandle;
  }

  attachToWebSocketManager(manager: EventEmitter): void {
    manager.on("message", (message: unknown) => {
      // Check if this is a kline message
      if (this.isKlineMessage(message)) {
        this.processMessage(message as KlineMessage);
      }
    });

    manager.on("error", (error: Error) => {
      // Log WebSocket errors but don't stop processing
      console.error("WebSocket error:", error.message);
    });
  }

  getStats(): CandleProcessorStats {
    return { ...this.stats };
  }

  clearCache(): void {
    this.processedCandles.clear();
    this.stats.cacheSize = 0;
  }

  private isKlineMessage(message: unknown): boolean {
    if (!message || typeof message !== "object") {
      return false;
    }

    const msg = message as Record<string, unknown>;
    return msg.e === "kline" && typeof msg.k === "object";
  }

  private handleError(error: Error, message?: KlineMessage): void {
    this.stats.errorsCount++;

    const processorError: CandleProcessorError = {
      message: error.message,
      code: this.getErrorCode(error),
      timestamp: Date.now(),
      data: message,
    };

    // Log the error
    console.error(`CandleProcessor error: ${error.message}`);

    // Emit error event
    this.emit("error", processorError);

    // Continue processing (don't throw)
  }

  private getErrorCode(error: Error): string {
    if (error.message.includes("negative price")) {
      return "NEGATIVE_PRICE";
    }
    if (error.message.includes("zero volume")) {
      return "ZERO_VOLUME";
    }
    if (error.message.includes("Invalid price range")) {
      return "INVALID_RANGE";
    }
    if (error.message.includes("Timestamp")) {
      return "TIMESTAMP_DRIFT";
    }
    if (error.message.includes("Invalid numeric")) {
      return "INVALID_NUMBER";
    }
    return "UNKNOWN_ERROR";
  }

  private updateProcessingRate(processingTime: number): void {
    this.processingTimes.push(processingTime);

    // Keep only last 100 processing times
    if (this.processingTimes.length > 100) {
      this.processingTimes.shift();
    }

    // Calculate average processing rate (messages per second)
    if (this.processingTimes.length > 0) {
      const avgTime =
        this.processingTimes.reduce((a, b) => a + b, 0) /
        this.processingTimes.length;
      this.stats.processingRate = avgTime > 0 ? Math.round(1000 / avgTime) : 0;
    }
  }
}
