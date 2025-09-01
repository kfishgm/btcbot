import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import WebSocket from "ws";
import { WebSocketManager } from "../../src/exchange/websocket-manager";
import type { WebSocketConfig } from "../../src/exchange/websocket-types";

// Mock WebSocket
jest.mock("ws");

describe("WebSocketManager", () => {
  let manager: WebSocketManager;
  let mockWebSocket: jest.Mocked<WebSocket>;
  let config: WebSocketConfig;
  let originalWebSocket: typeof WebSocket | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    config = {
      symbol: "btcusdt",
      timeframe: "1m",
      testnet: false,
      maxReconnectDelay: 10000,
      heartbeatInterval: 30000,
      pongTimeout: 5000,
      maxQueueSize: 1000,
    };

    // Create a mock WebSocket instance
    let wsReadyState = WebSocket.CONNECTING;
    mockWebSocket = {
      get readyState() {
        return wsReadyState;
      },
      set readyState(value) {
        wsReadyState = value;
      },
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
      send: jest.fn(),
      ping: jest.fn(),
      pong: jest.fn(),
      close: jest.fn(),
      terminate: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    } as unknown as jest.Mocked<WebSocket>;

    // Mock WebSocket constructor
    (
      WebSocket as unknown as jest.MockedClass<typeof WebSocket>
    ).mockImplementation(() => mockWebSocket);
  });

  afterEach(() => {
    jest.useRealTimers();
    if (manager) {
      manager.disconnect();
    }
  });

  describe("Connection Establishment", () => {
    it("should create a WebSocket connection with correct URL for production", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      expect(WebSocket).toHaveBeenCalledWith(
        "wss://stream.binance.com:9443/ws/btcusdt@kline_1m",
      );
    });

    it("should create a WebSocket connection with correct URL for testnet", () => {
      const testnetConfig = { ...config, testnet: true };
      manager = new WebSocketManager(testnetConfig);
      manager.connect();

      expect(WebSocket).toHaveBeenCalledWith(
        "wss://testnet.binance.vision/ws/btcusdt@kline_1m",
      );
    });

    it("should support different timeframes", () => {
      const configs = [
        { timeframe: "1m", expected: "btcusdt@kline_1m" },
        { timeframe: "3m", expected: "btcusdt@kline_3m" },
        { timeframe: "5m", expected: "btcusdt@kline_5m" },
        { timeframe: "15m", expected: "btcusdt@kline_15m" },
        { timeframe: "30m", expected: "btcusdt@kline_30m" },
        { timeframe: "1h", expected: "btcusdt@kline_1h" },
        { timeframe: "2h", expected: "btcusdt@kline_2h" },
        { timeframe: "4h", expected: "btcusdt@kline_4h" },
        { timeframe: "6h", expected: "btcusdt@kline_6h" },
        { timeframe: "8h", expected: "btcusdt@kline_8h" },
        { timeframe: "12h", expected: "btcusdt@kline_12h" },
        { timeframe: "1d", expected: "btcusdt@kline_1d" },
        { timeframe: "3d", expected: "btcusdt@kline_3d" },
        { timeframe: "1w", expected: "btcusdt@kline_1w" },
        { timeframe: "1M", expected: "btcusdt@kline_1M" },
      ];

      configs.forEach(({ timeframe, expected }) => {
        jest.clearAllMocks();
        const customConfig = { ...config, timeframe };
        manager = new WebSocketManager(customConfig);
        manager.connect();

        expect(WebSocket).toHaveBeenCalledWith(
          expect.stringContaining(expected),
        );
        manager.disconnect();
      });
    });

    it("should emit 'connected' event when connection is established", () => {
      manager = new WebSocketManager(config);
      const connectListener = jest.fn();
      manager.on("connected", connectListener);

      manager.connect();

      // Simulate WebSocket open event
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      expect(connectListener).toHaveBeenCalled();
    });

    it("should set state to CONNECTED when connection opens", () => {
      manager = new WebSocketManager(config);
      expect(manager.getState()).toBe("disconnected");

      manager.connect();
      expect(manager.getState()).toBe("connecting");

      // Simulate WebSocket open event
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      expect(manager.getState()).toBe("connected");
    });

    it("should not create multiple connections if connect is called multiple times", () => {
      manager = new WebSocketManager(config);

      manager.connect();
      manager.connect();
      manager.connect();

      expect(WebSocket).toHaveBeenCalledTimes(1);
    });

    it("should handle connection timeout", () => {
      manager = new WebSocketManager({ ...config });
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Advance time past the connection timeout
      jest.advanceTimersByTime(5001);

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Connection timeout"),
        }),
      );
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Message Parsing", () => {
    it("should parse and emit valid kline data", () => {
      manager = new WebSocketManager(config);
      const candleListener = jest.fn();
      manager.on("candle", candleListener);

      manager.connect();

      // Simulate WebSocket message with valid kline data
      const klineMessage = {
        e: "kline",
        E: 1638360000000,
        s: "BTCUSDT",
        k: {
          t: 1638360000000, // Kline start time
          T: 1638360059999, // Kline close time
          s: "BTCUSDT", // Symbol
          i: "1m", // Interval
          f: 100, // First trade ID
          L: 200, // Last trade ID
          o: "50000.00", // Open price
          c: "50100.00", // Close price
          h: "50150.00", // High price
          l: "49950.00", // Low price
          v: "100.50000000", // Base asset volume
          n: 1000, // Number of trades
          x: false, // Is this kline closed?
          q: "5025000.00", // Quote asset volume
          V: "50.25000000", // Taker buy base asset volume
          Q: "2512500.00", // Taker buy quote asset volume
          B: "0", // Ignore
        },
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify(klineMessage));

      expect(candleListener).toHaveBeenCalledWith({
        timestamp: 1638360000000,
        open: 50000.0,
        high: 50150.0,
        low: 49950.0,
        close: 50100.0,
        volume: 100.5,
        closed: false,
        trades: 1000,
        quoteVolume: 5025000.0,
      });
    });

    it("should handle closed klines", () => {
      manager = new WebSocketManager(config);
      const candleListener = jest.fn();
      manager.on("candle", candleListener);

      manager.connect();

      const klineMessage = {
        e: "kline",
        E: 1638360000000,
        s: "BTCUSDT",
        k: {
          t: 1638360000000,
          T: 1638360059999,
          s: "BTCUSDT",
          i: "1m",
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "100.50000000",
          n: 1000,
          x: true, // Closed kline
          q: "5025000.00",
        },
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify(klineMessage));

      expect(candleListener).toHaveBeenCalledWith(
        expect.objectContaining({
          closed: true,
        }),
      );
    });

    it("should ignore non-kline messages", () => {
      manager = new WebSocketManager(config);
      const candleListener = jest.fn();
      manager.on("candle", candleListener);

      manager.connect();

      const nonKlineMessage = {
        e: "trade",
        E: 1638360000000,
        s: "BTCUSDT",
        p: "50000.00",
        q: "0.1",
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify(nonKlineMessage));

      expect(candleListener).not.toHaveBeenCalled();
    });

    it("should handle malformed JSON messages", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, "not valid json {]");

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to parse message"),
        }),
      );
    });

    it("should handle messages with missing required fields", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      const candleListener = jest.fn();
      manager.on("error", errorListener);
      manager.on("candle", candleListener);

      manager.connect();

      const invalidMessage = {
        e: "kline",
        // Missing k field
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify(invalidMessage));

      expect(candleListener).not.toHaveBeenCalled();
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Invalid kline data"),
        }),
      );
    });
  });

  describe("Reconnection Logic", () => {
    it("should attempt to reconnect on connection loss", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Clear the initial connection call
      jest.clearAllMocks();

      // Simulate connection close
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1000, "Normal closure");

      // Advance timers to trigger reconnection
      jest.advanceTimersByTime(1000);

      expect(WebSocket).toHaveBeenCalledTimes(1);
    });

    it("should use exponential backoff for reconnection attempts", () => {
      manager = new WebSocketManager(config);
      const reconnectListener = jest.fn();
      manager.on("reconnecting", reconnectListener);

      manager.connect();
      jest.clearAllMocks();

      // Simulate multiple connection failures
      for (let i = 0; i < 5; i++) {
        const closeHandler = mockWebSocket.on.mock.calls.find(
          (call) => call[0] === "close",
        )?.[1];
        closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

        const expectedDelay = Math.min(1000 * Math.pow(2, i), 10000);

        jest.advanceTimersByTime(expectedDelay);

        if (i < 4) {
          // Reset mock for next iteration
          mockWebSocket.on.mockClear();
          (
            WebSocket as unknown as jest.MockedClass<typeof WebSocket>
          ).mockImplementation(() => mockWebSocket);
        }
      }

      // Should have attempted reconnection with increasing delays
      expect(reconnectListener).toHaveBeenCalledTimes(5);
      expect(reconnectListener).toHaveBeenNthCalledWith(1, {
        attempt: 1,
        delay: 1000,
      });
      expect(reconnectListener).toHaveBeenNthCalledWith(2, {
        attempt: 2,
        delay: 2000,
      });
      expect(reconnectListener).toHaveBeenNthCalledWith(3, {
        attempt: 3,
        delay: 4000,
      });
      expect(reconnectListener).toHaveBeenNthCalledWith(4, {
        attempt: 4,
        delay: 8000,
      });
      expect(reconnectListener).toHaveBeenNthCalledWith(5, {
        attempt: 5,
        delay: 10000,
      }); // Max delay
    });

    it("should reset reconnection attempts on successful connection", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate connection failure
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      // Advance timer for first reconnection
      jest.advanceTimersByTime(1000);

      // Simulate successful reconnection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Clear mocks and simulate another failure
      jest.clearAllMocks();
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      // Should start with initial delay again
      const reconnectListener = jest.fn();
      manager.on("reconnecting", reconnectListener);
      jest.advanceTimersByTime(1000);

      expect(reconnectListener).toHaveBeenCalledWith({
        attempt: 1,
        delay: 1000,
      });
    });

    it("should not reconnect if disconnect was intentional", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      jest.clearAllMocks();

      // Intentional disconnect
      manager.disconnect();

      // Simulate close event after intentional disconnect
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1000, "Normal closure");

      // Advance timers
      jest.advanceTimersByTime(10000);

      // Should not attempt reconnection
      expect(WebSocket).not.toHaveBeenCalled();
    });

    it("should emit reconnection events", () => {
      manager = new WebSocketManager(config);
      const reconnectingListener = jest.fn();
      const reconnectedListener = jest.fn();

      manager.on("reconnecting", reconnectingListener);
      manager.on("reconnected", reconnectedListener);

      manager.connect();

      // Simulate connection loss
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      // Trigger reconnection
      jest.advanceTimersByTime(1000);

      expect(reconnectingListener).toHaveBeenCalledWith({
        attempt: 1,
        delay: 1000,
      });

      // Simulate successful reconnection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      expect(reconnectedListener).toHaveBeenCalledWith({ attempts: 1 });
    });

    it("should handle maximum reconnection attempts", () => {
      manager = new WebSocketManager({ ...config, maxReconnectAttempts: 3 });
      const errorListener = jest.fn();
      const maxRetriesListener = jest.fn();

      manager.on("error", errorListener);
      manager.on("max_retries_reached", maxRetriesListener);

      manager.connect();

      // Simulate multiple connection failures
      for (let i = 0; i < 4; i++) {
        const closeHandler = mockWebSocket.on.mock.calls.find(
          (call) => call[0] === "close",
        )?.[1];
        closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        jest.advanceTimersByTime(delay);

        if (i < 3) {
          mockWebSocket.on.mockClear();
          (
            WebSocket as unknown as jest.MockedClass<typeof WebSocket>
          ).mockImplementation(() => mockWebSocket);
        }
      }

      expect(maxRetriesListener).toHaveBeenCalledWith({ attempts: 3 });
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Heartbeat/Ping Mechanism", () => {
    it("should start sending pings after connection", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Advance time to trigger heartbeat
      jest.advanceTimersByTime(30000);

      expect(mockWebSocket.ping).toHaveBeenCalled();
    });

    it("should send pings at regular intervals", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Simulate multiple heartbeat intervals
      for (let i = 1; i <= 3; i++) {
        jest.advanceTimersByTime(30000);
        expect(mockWebSocket.ping).toHaveBeenCalledTimes(i);

        // Simulate pong response
        const pongHandler = mockWebSocket.on.mock.calls.find(
          (call) => call[0] === "pong",
        )?.[1];
        pongHandler?.call(mockWebSocket);
      }
    });

    it("should reconnect if pong is not received within timeout", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Send ping
      jest.advanceTimersByTime(30000);
      expect(mockWebSocket.ping).toHaveBeenCalled();

      // Don't send pong, wait for timeout
      jest.advanceTimersByTime(5000);

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Ping timeout"),
        }),
      );
      expect(mockWebSocket.terminate).toHaveBeenCalled();
    });

    it("should reset pong timeout on receiving pong", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Send ping
      jest.advanceTimersByTime(30000);

      // Send pong just before timeout
      jest.advanceTimersByTime(4000);
      const pongHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "pong",
      )?.[1];
      pongHandler?.call(mockWebSocket);

      // Wait past original timeout
      jest.advanceTimersByTime(2000);

      // Should not have triggered timeout
      expect(errorListener).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Ping timeout"),
        }),
      );
      expect(mockWebSocket.terminate).not.toHaveBeenCalled();
    });

    it("should stop heartbeat on disconnect", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Send first ping
      jest.advanceTimersByTime(30000);
      expect(mockWebSocket.ping).toHaveBeenCalledTimes(1);

      // Disconnect
      manager.disconnect();

      // Advance time - should not send more pings
      jest.advanceTimersByTime(30000);
      expect(mockWebSocket.ping).toHaveBeenCalledTimes(1);
    });

    it("should handle ping errors gracefully", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Make ping throw an error
      mockWebSocket.ping.mockImplementation(() => {
        throw new Error("Ping failed");
      });

      // Trigger heartbeat
      jest.advanceTimersByTime(30000);

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Heartbeat failed"),
        }),
      );
    });
  });

  describe("Message Queue During Reconnection", () => {
    it("should queue messages during reconnection", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Simulate connection loss
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      // Try to send messages while disconnected
      const testMessages = [
        { action: "subscribe", channel: "trades" },
        { action: "subscribe", channel: "orderbook" },
        { action: "ping" },
      ];

      testMessages.forEach((msg) => {
        manager.send(msg);
      });

      // Messages should be queued, not sent
      expect(mockWebSocket.send).not.toHaveBeenCalled();

      // Simulate reconnection
      jest.advanceTimersByTime(1000);
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const reconnectOpenHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      reconnectOpenHandler?.call(mockWebSocket);

      // All queued messages should be sent
      expect(mockWebSocket.send).toHaveBeenCalledTimes(3);
      testMessages.forEach((msg, index) => {
        expect(mockWebSocket.send).toHaveBeenNthCalledWith(
          index + 1,
          JSON.stringify(msg),
        );
      });
    });

    it("should respect maximum queue size", () => {
      manager = new WebSocketManager({ ...config, maxQueueSize: 3 });
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate connection loss
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      // Try to send more messages than queue size
      for (let i = 0; i < 5; i++) {
        manager.send({ action: "test", id: i });
      }

      // Should emit error for messages that couldn't be queued
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Message queue full"),
        }),
      );

      // Simulate reconnection
      jest.advanceTimersByTime(1000);
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const reconnectOpenHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      reconnectOpenHandler?.call(mockWebSocket);

      // Only first 3 messages should be sent
      expect(mockWebSocket.send).toHaveBeenCalledTimes(3);
    });

    it("should clear queue on successful send", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate connection loss and queue messages
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      manager.send({ action: "test1" });
      manager.send({ action: "test2" });

      // Reconnect
      jest.advanceTimersByTime(1000);
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const reconnectOpenHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      reconnectOpenHandler?.call(mockWebSocket);

      expect(mockWebSocket.send).toHaveBeenCalledTimes(2);

      // Queue should be empty now
      jest.clearAllMocks();

      // Disconnect and reconnect again
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      jest.advanceTimersByTime(1000);
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      reconnectOpenHandler?.call(mockWebSocket);

      // No messages should be sent (queue was cleared)
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it("should maintain message order in queue", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate connection loss
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      const messages = [
        { id: 1, action: "first" },
        { id: 2, action: "second" },
        { id: 3, action: "third" },
      ];

      messages.forEach((msg) => manager.send(msg));

      // Reconnect
      jest.advanceTimersByTime(1000);
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const reconnectOpenHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      reconnectOpenHandler?.call(mockWebSocket);

      // Messages should be sent in order
      messages.forEach((msg, index) => {
        expect(mockWebSocket.send).toHaveBeenNthCalledWith(
          index + 1,
          JSON.stringify(msg),
        );
      });
    });

    it("should handle send errors for queued messages", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Queue a message during disconnection
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      manager.send({ action: "test" });

      // Make send throw an error
      mockWebSocket.send.mockImplementation(() => {
        throw new Error("Send failed");
      });

      // Reconnect
      jest.advanceTimersByTime(1000);
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const reconnectOpenHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      reconnectOpenHandler?.call(mockWebSocket);

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to send queued message"),
        }),
      );
    });
  });

  describe("Error Handling", () => {
    it("should emit error events from WebSocket", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      const wsError = new Error("WebSocket error");
      const errorHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "error",
      )?.[1];
      errorHandler?.call(mockWebSocket, wsError);

      expect(errorListener).toHaveBeenCalledWith(wsError);
    });

    it("should handle unexpected close codes", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate abnormal closure
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Connection closed unexpectedly"),
          code: 1006,
        }),
      );
    });

    it("should handle rate limiting errors", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate rate limit error message
      const rateLimitMessage = {
        error: {
          code: 429,
          msg: "Too many requests",
        },
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify(rateLimitMessage));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Rate limit"),
          code: 429,
        }),
      );
    });

    it("should handle authentication errors", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      // Simulate auth error
      const authErrorMessage = {
        error: {
          code: 401,
          msg: "Invalid API key",
        },
      };

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify(authErrorMessage));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Authentication failed"),
          code: 401,
        }),
      );
    });

    it("should handle network errors gracefully", () => {
      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      // Mock WebSocket to throw on construction
      (
        WebSocket as unknown as jest.MockedClass<typeof WebSocket>
      ).mockImplementation(() => {
        throw new Error("Network unreachable");
      });

      manager.connect();

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to create WebSocket"),
        }),
      );
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Connection State Management", () => {
    it("should track connection state transitions", () => {
      manager = new WebSocketManager(config);
      const stateListener = jest.fn();
      manager.on("state_change", stateListener);

      expect(manager.getState()).toBe("disconnected");

      manager.connect();
      expect(stateListener).toHaveBeenCalledWith({
        from: "DISCONNECTED",
        to: "CONNECTING",
      });

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);
      expect(stateListener).toHaveBeenCalledWith({
        from: "CONNECTING",
        to: "CONNECTED",
      });

      // Simulate reconnecting
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");
      expect(stateListener).toHaveBeenCalledWith({
        from: "CONNECTED",
        to: "RECONNECTING",
      });

      // Simulate disconnection
      manager.disconnect();
      expect(stateListener).toHaveBeenCalledWith({
        from: "RECONNECTING",
        to: "DISCONNECTED",
      });
    });

    it("should provide connection statistics", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Initial stats
      let stats = manager.getStats();
      expect(stats).toEqual({
        messagesReceived: 0,
        messagesSent: 0,
        reconnectAttempts: 0,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastMessageAt: null,
        connectionUptime: 0,
        currentState: "CONNECTING",
      });

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      stats = manager.getStats();
      // Check state separately as it's not in the stats object
      expect(manager.getState()).toBe("connected");
      expect(stats.connectedAt).not.toBeNull();

      // Simulate receiving messages
      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify({ e: "test" }));
      messageHandler?.call(mockWebSocket, JSON.stringify({ e: "test2" }));

      stats = manager.getStats();
      expect(stats.messagesReceived).toBe(2);
      expect(stats.lastMessageTime).not.toBeNull();

      // Send a message
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      manager.send({ action: "test" });

      stats = manager.getStats();
      expect(stats.messagesSent).toBe(1);

      // Simulate disconnection and reconnection
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1006, "Abnormal closure");

      jest.advanceTimersByTime(1000);

      stats = manager.getStats();
      expect(stats.reconnectAttempts).toBe(1);
      expect(stats.disconnectedAt).not.toBeNull();
    });

    it("should calculate connection uptime correctly", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Advance time by 1 minute
      jest.advanceTimersByTime(60000);

      const stats = manager.getStats();
      expect(stats.uptime).toBeGreaterThanOrEqual(60000);
    });

    it("should reset stats on request", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Generate some stats
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      const messageHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];
      messageHandler?.call(mockWebSocket, JSON.stringify({ e: "test" }));

      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      manager.send({ action: "test" });

      // Verify stats exist
      let stats = manager.getStats();
      expect(stats.messagesReceived).toBe(1);
      expect(stats.messagesSent).toBe(1);

      // Reset stats
      manager.resetStats();

      // Verify stats are reset
      stats = manager.getStats();
      expect(stats.messagesReceived).toBe(0);
      expect(stats.messagesSent).toBe(0);
      expect(stats.reconnectAttempts).toBe(0);
    });
  });

  describe("Public API Methods", () => {
    it("should check if connected correctly", () => {
      manager = new WebSocketManager(config);

      expect(manager.isConnected()).toBe(false);

      manager.connect();
      expect(manager.isConnected()).toBe(false); // Still connecting

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      expect(manager.isConnected()).toBe(true);

      // Simulate disconnection
      (mockWebSocket as { readyState: number }).readyState = WebSocket.CLOSED;
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1000, "Normal closure");

      expect(manager.isConnected()).toBe(false);
    });

    it("should send messages when connected", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      const message = { action: "subscribe", channel: "trades" };
      const result = manager.send(message);

      expect(result).toBe(true);
      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should queue messages when not connected", () => {
      manager = new WebSocketManager(config);

      const message = { action: "subscribe", channel: "trades" };
      const result = manager.send(message);

      expect(result).toBe(false);
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it("should disconnect and cleanup properly", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Start heartbeat
      jest.advanceTimersByTime(30000);
      expect(mockWebSocket.ping).toHaveBeenCalled();

      // Disconnect
      manager.disconnect();

      expect(mockWebSocket.close).toHaveBeenCalled();
      expect(manager.getState()).toBe("disconnected");

      // Verify heartbeat is stopped
      jest.clearAllMocks();
      jest.advanceTimersByTime(30000);
      expect(mockWebSocket.ping).not.toHaveBeenCalled();
    });

    // These tests removed as the methods are not part of task requirements

    it("should subscribe to multiple events", () => {
      manager = new WebSocketManager(config);

      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      manager.on("connected", listener1);
      manager.on("connected", listener2);
      manager.on("disconnected", listener3);

      manager.connect();

      // Trigger connected event
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(listener3).not.toHaveBeenCalled();

      // Trigger disconnected event
      const closeHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];
      closeHandler?.call(mockWebSocket, 1000, "Normal closure");

      expect(listener3).toHaveBeenCalled();
    });

    it("should unsubscribe from events", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.on("connected", listener);

      // Unsubscribe
      manager.off("connected", listener);

      manager.connect();

      // Trigger connected event
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should emit once for one-time listeners", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.once("connected", listener);

      manager.connect();

      // First connection
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);
      expect(listener).toHaveBeenCalledTimes(1);

      // Simulate reconnection
      openHandler?.call(mockWebSocket);
      expect(listener).toHaveBeenCalledTimes(1); // Still only called once
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle rapid connect/disconnect cycles", () => {
      manager = new WebSocketManager(config);

      for (let i = 0; i < 5; i++) {
        manager.connect();
        manager.disconnect();
      }

      // Should handle gracefully without errors
      expect(manager.getState()).toBe("disconnected");
    });

    it("should handle WebSocket not available scenario", () => {
      // Store original WebSocket
      originalWebSocket = (
        global as unknown as { WebSocket?: typeof WebSocket }
      ).WebSocket;

      // Remove WebSocket from global
      delete (global as unknown as { WebSocket?: typeof WebSocket }).WebSocket;

      manager = new WebSocketManager(config);
      const errorListener = jest.fn();
      manager.on("error", errorListener);

      manager.connect();

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("WebSocket is not available"),
        }),
      );

      // Restore WebSocket
      if (originalWebSocket) {
        (global as unknown as { WebSocket?: typeof WebSocket }).WebSocket =
          originalWebSocket;
      }
    });

    it("should handle simultaneous send operations", () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Simulate successful connection
      (mockWebSocket as { readyState: number }).readyState = WebSocket.OPEN;
      const openHandler = mockWebSocket.on.mock.calls.find(
        (call) => call[0] === "open",
      )?.[1];
      openHandler?.call(mockWebSocket);

      // Send multiple messages simultaneously
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(manager.send({ id: i, action: "test" }));
      }

      expect(mockWebSocket.send).toHaveBeenCalledTimes(10);
    });

    it("should maintain event emitter memory limits", () => {
      manager = new WebSocketManager(config);

      // Add many listeners
      const listeners = [];
      for (let i = 0; i < 100; i++) {
        const listener = jest.fn();
        listeners.push(listener);
        manager.on("candle", listener);
      }

      // Should handle without memory warnings
      expect(manager.getMaxListeners()).toBeGreaterThanOrEqual(100);
    });
  });
});
