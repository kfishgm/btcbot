import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { EventEmitter } from "events";
import type {
  KlineMessage,
  CandleData,
} from "../../src/exchange/websocket-types";
// This import will fail initially - CandleProcessor doesn't exist yet (TDD!)
import { CandleProcessor } from "../../src/exchange/candle-processor";

// Define extended types for testing
interface ProcessedCandleData extends CandleData {
  processedData?: {
    openDecimal: number;
    closeDecimal: number;
    highDecimal: number;
    lowDecimal: number;
    volumeDecimal: number;
  };
}

interface CandleProcessorStats {
  totalProcessed: number;
  totalErrors: number;
  errorRate: number;
}

interface CandleProcessorOptions {
  maxTimestampDrift?: number;
}

describe("CandleProcessor", () => {
  let processor: CandleProcessor;
  let mockEventEmitter: EventEmitter;

  beforeEach(() => {
    // This will fail - CandleProcessor doesn't exist yet
    processor = new CandleProcessor();
    mockEventEmitter = new EventEmitter();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Message Parsing", () => {
    it("should parse a valid KlineMessage into CandleData", () => {
      const klineMessage: KlineMessage = {
        e: "kline",
        E: 1638316800000,
        s: "BTCUSDT",
        k: {
          t: 1638316800000,
          T: 1638316859999,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - parseMessage method doesn't exist yet
      const result = processor.parseMessage(klineMessage);

      expect(result).toBeDefined();
      expect(result.eventTime).toBe(1638316800000);
      expect(result.symbol).toBe("BTCUSDT");
      expect(result.openTime).toBe(1638316800000);
      expect(result.closeTime).toBe(1638316859999);
      expect(result.open).toBe("50000.00");
      expect(result.close).toBe("50100.00");
      expect(result.high).toBe("50150.00");
      expect(result.low).toBe("49950.00");
      expect(result.volume).toBe("10.50000");
      expect(result.numberOfTrades).toBe(100);
      expect(result.isCandleClosed).toBe(false);
    });

    it("should handle missing kline data gracefully", () => {
      const invalidMessage = {
        e: "kline",
        E: 1638316800000,
        s: "BTCUSDT",
        // k field is missing
      } as unknown as KlineMessage;

      // This will fail - parseMessage method doesn't exist yet
      expect(() => processor.parseMessage(invalidMessage)).toThrow(
        "Invalid kline message: missing kline data",
      );
    });

    it("should handle non-kline messages", () => {
      const nonKlineMessage = {
        e: "trade",
        E: 1638316800000,
        s: "BTCUSDT",
      } as unknown as KlineMessage;

      // This will fail - parseMessage method doesn't exist yet
      expect(() => processor.parseMessage(nonKlineMessage)).toThrow(
        "Invalid message type: expected kline, got trade",
      );
    });
  });

  describe("Decimal Number Conversion", () => {
    it("should convert string price values to decimal numbers", () => {
      const klineMessage: KlineMessage = {
        e: "kline",
        E: 1638316800000,
        s: "BTCUSDT",
        k: {
          t: 1638316800000,
          T: 1638316859999,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.12345678",
          c: "50100.87654321",
          h: "50150.00000001",
          l: "49950.99999999",
          v: "10.50000000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - convertToDecimal method doesn't exist yet
      const openDecimal = processor.convertToDecimal(klineMessage.k.o);
      const closeDecimal = processor.convertToDecimal(klineMessage.k.c);
      const highDecimal = processor.convertToDecimal(klineMessage.k.h);
      const lowDecimal = processor.convertToDecimal(klineMessage.k.l);
      const volumeDecimal = processor.convertToDecimal(klineMessage.k.v);

      expect(openDecimal).toBe(50000.12345678);
      expect(closeDecimal).toBe(50100.87654321);
      expect(highDecimal).toBe(50150.00000001);
      expect(lowDecimal).toBe(49950.99999999);
      expect(volumeDecimal).toBe(10.5);
    });

    it("should handle invalid numeric strings", () => {
      // This will fail - convertToDecimal method doesn't exist yet
      expect(() => processor.convertToDecimal("not-a-number")).toThrow(
        "Invalid numeric string: not-a-number",
      );
      expect(() => processor.convertToDecimal("")).toThrow(
        "Invalid numeric string: empty string",
      );
      expect(() =>
        processor.convertToDecimal(null as unknown as string),
      ).toThrow("Invalid numeric string: null or undefined");
      expect(() =>
        processor.convertToDecimal(undefined as unknown as string),
      ).toThrow("Invalid numeric string: null or undefined");
    });

    it("should preserve precision for very small numbers", () => {
      // This will fail - convertToDecimal method doesn't exist yet
      const result = processor.convertToDecimal("0.00000001");
      expect(result).toBe(0.00000001);
    });

    it("should preserve precision for very large numbers", () => {
      // This will fail - convertToDecimal method doesn't exist yet
      const result = processor.convertToDecimal("999999.99999999");
      expect(result).toBe(999999.99999999);
    });
  });

  describe("Timestamp Validation", () => {
    it("should accept current timestamps", () => {
      const currentTime = Date.now();
      const klineMessage: KlineMessage = {
        e: "kline",
        E: currentTime,
        s: "BTCUSDT",
        k: {
          t: currentTime - 60000, // 1 minute ago
          T: currentTime,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - validateTimestamp method doesn't exist yet
      expect(() => processor.validateTimestamp(klineMessage)).not.toThrow();
    });

    it("should reject timestamps too far in the future", () => {
      const futureTime = Date.now() + 3600000; // 1 hour in the future
      const klineMessage: KlineMessage = {
        e: "kline",
        E: futureTime,
        s: "BTCUSDT",
        k: {
          t: futureTime,
          T: futureTime + 60000,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - validateTimestamp method doesn't exist yet
      expect(() => processor.validateTimestamp(klineMessage)).toThrow(
        "Timestamp too far in the future",
      );
    });

    it("should reject timestamps too far in the past", () => {
      const pastTime = Date.now() - 86400000; // 24 hours ago
      const klineMessage: KlineMessage = {
        e: "kline",
        E: pastTime,
        s: "BTCUSDT",
        k: {
          t: pastTime,
          T: pastTime + 60000,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - validateTimestamp method doesn't exist yet
      expect(() => processor.validateTimestamp(klineMessage)).toThrow(
        "Timestamp too far in the past",
      );
    });

    it("should have configurable timestamp tolerance", () => {
      // This will fail - constructor with options doesn't exist yet
      const customProcessor = new CandleProcessor({
        maxTimestampDrift: 5000, // 5 seconds
      } as CandleProcessorOptions);

      const currentTime = Date.now();
      const edgeMessage: KlineMessage = {
        e: "kline",
        E: currentTime + 4999, // Just within tolerance
        s: "BTCUSDT",
        k: {
          t: currentTime,
          T: currentTime + 60000,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      expect(() =>
        customProcessor.validateTimestamp(edgeMessage),
      ).not.toThrow();
    });
  });

  describe("Candle Close Detection", () => {
    it("should detect when a candle is closed (x=true)", () => {
      const closedCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: true, // Candle is closed
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - isCandleClosed method doesn't exist yet
      expect(processor.isCandleClosed(closedCandle)).toBe(true);
    });

    it("should detect when a candle is not closed (x=false)", () => {
      const openCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 30000,
          T: Date.now() + 30000,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false, // Candle is still open
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - isCandleClosed method doesn't exist yet
      expect(processor.isCandleClosed(openCandle)).toBe(false);
    });
  });

  describe("Event Emission", () => {
    it("should emit 'candle_closed' event when a candle closes", (done) => {
      const closedCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: true, // Candle is closed
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - event emission doesn't exist yet
      processor.on("candle_closed", (data: CandleData) => {
        expect(data).toBeDefined();
        expect(data.isCandleClosed).toBe(true);
        expect(data.symbol).toBe("BTCUSDT");
        expect(data.close).toBe("50100.00");
        done();
      });

      processor.processMessage(closedCandle);
    });

    it("should emit 'candle_update' event for open candles", (done) => {
      const openCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 30000,
          T: Date.now() + 30000,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false, // Candle is still open
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - event emission doesn't exist yet
      processor.on("candle_update", (data: CandleData) => {
        expect(data).toBeDefined();
        expect(data.isCandleClosed).toBe(false);
        expect(data.symbol).toBe("BTCUSDT");
        done();
      });

      processor.processMessage(openCandle);
    });

    it("should include processed decimal values in emitted events", (done) => {
      const closedCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.12",
          c: "50100.34",
          h: "50150.56",
          l: "49950.78",
          v: "10.50000",
          n: 100,
          x: true,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - processedData property doesn't exist yet
      processor.on("candle_closed", (data: ProcessedCandleData) => {
        expect(data.processedData).toBeDefined();
        expect(data.processedData?.openDecimal).toBe(50000.12);
        expect(data.processedData?.closeDecimal).toBe(50100.34);
        expect(data.processedData?.highDecimal).toBe(50150.56);
        expect(data.processedData?.lowDecimal).toBe(49950.78);
        expect(data.processedData?.volumeDecimal).toBe(10.5);
        done();
      });

      processor.processMessage(closedCandle);
    });
  });

  describe("Data Validation", () => {
    it("should reject negative prices", () => {
      const invalidCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "-50000.00", // Negative price
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - validateData method doesn't exist yet
      expect(() => processor.validateData(invalidCandle)).toThrow(
        "Invalid data: negative price detected",
      );
    });

    it("should reject zero volume for closed candles", () => {
      const zeroVolumeCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "0.00000", // Zero volume
          n: 0,
          x: true, // Closed candle
          q: "0.00",
          V: "0.00000",
          Q: "0.00",
          B: "0",
        },
      };

      // This will fail - validateData method doesn't exist yet
      expect(() => processor.validateData(zeroVolumeCandle)).toThrow(
        "Invalid data: zero volume for closed candle",
      );
    });

    it("should allow zero volume for open candles", () => {
      const zeroVolumeOpenCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 30000,
          T: Date.now() + 30000,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 100,
          o: "50000.00",
          c: "50000.00",
          h: "50000.00",
          l: "50000.00",
          v: "0.00000", // Zero volume is OK for open candles
          n: 0,
          x: false, // Open candle
          q: "0.00",
          V: "0.00000",
          Q: "0.00",
          B: "0",
        },
      };

      // This will fail - validateData method doesn't exist yet
      expect(() => processor.validateData(zeroVolumeOpenCandle)).not.toThrow();
    });

    it("should reject if high is less than low", () => {
      const invalidHighLow: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "49900.00", // High is less than low
          l: "50200.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - validateData method doesn't exist yet
      expect(() => processor.validateData(invalidHighLow)).toThrow(
        "Invalid data: high price is less than low price",
      );
    });

    it("should reject if open/close is outside high/low range", () => {
      const invalidRange: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "51000.00", // Close is higher than high
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - validateData method doesn't exist yet
      expect(() => processor.validateData(invalidRange)).toThrow(
        "Invalid data: close price outside high/low range",
      );
    });
  });

  describe("Error Handling and Recovery", () => {
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
      consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("should log errors for invalid data", () => {
      const invalidCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "invalid", // Invalid number format
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - processMessage with error handling doesn't exist yet
      processor.processMessage(invalidCandle);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to process candle"),
        expect.any(Error),
      );
    });

    it("should emit 'error' event for processing failures", (done) => {
      const invalidCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "-50000.00", // Negative price
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      // This will fail - error event emission doesn't exist yet
      processor.on("error", (error: Error) => {
        expect(error).toBeDefined();
        expect(error.message).toContain("negative price");
        done();
      });

      processor.processMessage(invalidCandle);
    });

    it("should continue processing after encountering an error", () => {
      const invalidCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "invalid", // This will cause an error
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: false,
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      const validCandle: KlineMessage = {
        e: "kline",
        E: Date.now(),
        s: "BTCUSDT",
        k: {
          t: Date.now() - 60000,
          T: Date.now(),
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "10.50000",
          n: 100,
          x: true, // Valid closed candle
          q: "525000.00",
          V: "5.25000",
          Q: "262500.00",
          B: "0",
        },
      };

      let closedCandleReceived = false;
      processor.on("candle_closed", () => {
        closedCandleReceived = true;
      });

      // Process invalid candle first (should not crash)
      processor.processMessage(invalidCandle);

      // Process valid candle (should work)
      processor.processMessage(validCandle);

      // This will fail - recovery behavior doesn't exist yet
      expect(closedCandleReceived).toBe(true);
    });

    it("should track error statistics", () => {
      const invalidCandles = [
        {
          ...createBaseKlineMessage(),
          k: { ...createBaseKlineMessage().k, o: "invalid" },
        },
        {
          ...createBaseKlineMessage(),
          k: { ...createBaseKlineMessage().k, c: "-100" },
        },
        {
          ...createBaseKlineMessage(),
          k: { ...createBaseKlineMessage().k, v: "0.00", x: true },
        },
      ];

      invalidCandles.forEach((candle) => processor.processMessage(candle));

      // This will fail - getStats method doesn't exist yet
      const stats = processor.getStats() as CandleProcessorStats;
      expect(stats.totalProcessed).toBe(3);
      expect(stats.totalErrors).toBe(3);
      expect(stats.errorRate).toBeCloseTo(1.0);
    });
  });

  describe("Batch Processing", () => {
    it("should process multiple messages in sequence", () => {
      const messages: KlineMessage[] = [
        createKlineMessage({ x: false, c: "50000.00" }),
        createKlineMessage({ x: false, c: "50100.00" }),
        createKlineMessage({ x: true, c: "50200.00" }), // Closed candle
        createKlineMessage({ x: false, c: "50150.00" }),
      ];

      let updateCount = 0;
      let closedCount = 0;

      processor.on("candle_update", () => updateCount++);
      processor.on("candle_closed", () => closedCount++);

      // This will fail - processBatch method doesn't exist yet
      processor.processBatch(messages);

      expect(updateCount).toBe(2); // Two open candles
      expect(closedCount).toBe(1); // One closed candle
    });

    it("should handle mixed valid and invalid messages in batch", () => {
      const messages: KlineMessage[] = [
        createKlineMessage({ x: false, c: "50000.00" }), // Valid
        createKlineMessage({ x: false, o: "invalid" }), // Invalid
        createKlineMessage({ x: true, c: "50200.00" }), // Valid closed
        createKlineMessage({ x: false, h: "-100" }), // Invalid
        createKlineMessage({ x: false, c: "50300.00" }), // Valid
      ];

      let updateCount = 0;
      let closedCount = 0;
      let errorCount = 0;

      processor.on("candle_update", () => updateCount++);
      processor.on("candle_closed", () => closedCount++);
      processor.on("error", () => errorCount++);

      // This will fail - processBatch method doesn't exist yet
      processor.processBatch(messages);

      expect(updateCount).toBe(2); // Two valid open candles
      expect(closedCount).toBe(1); // One valid closed candle
      expect(errorCount).toBe(2); // Two invalid messages
    });
  });

  describe("Integration with WebSocketManager", () => {
    it("should be able to process messages from WebSocketManager format", () => {
      // Simulate the exact format that WebSocketManager would emit
      const wsManagerCandle: CandleData = {
        eventTime: Date.now(),
        symbol: "BTCUSDT",
        openTime: Date.now() - 60000,
        closeTime: Date.now(),
        firstTradeId: 100,
        lastTradeId: 200,
        open: "50000.00",
        high: "50150.00",
        low: "49950.00",
        close: "50100.00",
        volume: "10.50000",
        numberOfTrades: 100,
        isCandleClosed: true,
        quoteAssetVolume: "525000.00",
        takerBuyBaseAssetVolume: "5.25000",
        takerBuyQuoteAssetVolume: "262500.00",
      };

      // This will fail - processCandle method doesn't exist yet
      const result = processor.processCandle(wsManagerCandle);

      expect(result).toBeDefined();
      expect(result.symbol).toBe("BTCUSDT");
      expect(result.isCandleClosed).toBe(true);
    });

    it("should integrate as WebSocketManager message handler", () => {
      const manager = new mockEventEmitter();

      // This will fail - attachToWebSocketManager method doesn't exist yet
      processor.attachToWebSocketManager(manager as unknown as EventEmitter);

      const testCandle: CandleData = {
        eventTime: Date.now(),
        symbol: "BTCUSDT",
        openTime: Date.now() - 60000,
        closeTime: Date.now(),
        firstTradeId: 100,
        lastTradeId: 200,
        open: "50000.00",
        high: "50150.00",
        low: "49950.00",
        close: "50100.00",
        volume: "10.50000",
        numberOfTrades: 100,
        isCandleClosed: true,
        quoteAssetVolume: "525000.00",
        takerBuyBaseAssetVolume: "5.25000",
        takerBuyQuoteAssetVolume: "262500.00",
      };

      let candleClosedEmitted = false;
      processor.on("candle_closed", () => {
        candleClosedEmitted = true;
      });

      // Simulate WebSocketManager emitting a candle
      manager.emit("candle", testCandle);

      expect(candleClosedEmitted).toBe(true);
    });
  });

  describe("Performance and Memory Management", () => {
    it("should not accumulate memory when processing many messages", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Process many messages
      for (let i = 0; i < 10000; i++) {
        const message = createKlineMessage({
          x: i % 100 === 0, // Every 100th candle is closed
          c: `${50000 + i}.00`,
        });
        processor.processMessage(message);
      }

      // This will fail - clearCache method doesn't exist yet
      processor.clearCache();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB for 10k messages)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it("should process messages quickly", () => {
      const message = createKlineMessage({ x: true, c: "50000.00" });

      const startTime = performance.now();

      // Process 1000 messages
      for (let i = 0; i < 1000; i++) {
        processor.processMessage(message);
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should process 1000 messages in less than 100ms
      expect(totalTime).toBeLessThan(100);
    });
  });
});

// Helper functions for creating test data
function createBaseKlineMessage(): KlineMessage {
  return {
    e: "kline",
    E: Date.now(),
    s: "BTCUSDT",
    k: {
      t: Date.now() - 60000,
      T: Date.now(),
      s: "BTCUSDT",
      i: "1m",
      f: 100,
      L: 200,
      o: "50000.00",
      c: "50100.00",
      h: "50150.00",
      l: "49950.00",
      v: "10.50000",
      n: 100,
      x: false,
      q: "525000.00",
      V: "5.25000",
      Q: "262500.00",
      B: "0",
    },
  };
}

function createKlineMessage(
  overrides: Partial<KlineMessage["k"]> = {},
): KlineMessage {
  const base = createBaseKlineMessage();
  return {
    ...base,
    k: {
      ...base.k,
      ...overrides,
    },
  };
}
