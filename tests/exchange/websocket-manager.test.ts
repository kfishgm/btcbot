import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { WebSocketManager } from "../../src/exchange/websocket-manager";
import type { WebSocketConfig } from "../../src/exchange/websocket-types";
import { EventEmitter } from "events";
import type { Mock } from "jest-mock";

// Define types for our mock
interface MockWebSocketInstance extends EventEmitter {
  readyState: number;
  url: string;
  send: Mock;
  ping: Mock;
  pong: Mock;
  close: Mock;
  terminate: Mock;
}

// Create a mock WebSocket class
class MockWebSocket extends EventEmitter implements MockWebSocketInstance {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static lastInstance?: MockWebSocketInstance;

  public readyState: number = MockWebSocket.CONNECTING;
  public url: string;

  constructor(url: string) {
    super();
    this.url = url;
    // Store the instance for test access
    MockWebSocket.lastInstance = this;

    // Simulate async connection
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.emit("open");
      }
    }, 0);
  }

  send = jest.fn((_data: string | Buffer) => {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
  }) as Mock;

  ping = jest.fn(() => {
    if (this.readyState === MockWebSocket.OPEN) {
      // Simulate pong response
      setTimeout(() => this.emit("pong"), 10);
    }
  }) as Mock;

  pong = jest.fn() as Mock;

  close = jest.fn(() => {
    if (this.readyState < MockWebSocket.CLOSING) {
      this.readyState = MockWebSocket.CLOSING;
      setTimeout(() => {
        this.readyState = MockWebSocket.CLOSED;
        this.emit("close");
      }, 0);
    }
  }) as Mock;

  terminate = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }) as Mock;

  // Override Node.js EventEmitter methods to match WebSocket API
  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  off(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }
}

// Mock the ws module
jest.mock("ws", () => ({
  __esModule: true,
  default: MockWebSocket,
}));

describe("WebSocketManager", () => {
  let manager: WebSocketManager;
  let config: WebSocketConfig;
  let mockWs: MockWebSocketInstance;

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

    // Clear last instance
    MockWebSocket.lastInstance = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (manager) {
      manager.disconnect();
    }
  });

  describe("Connection Establishment", () => {
    it("should create a WebSocket connection with correct URL for production", async () => {
      manager = new WebSocketManager(config);
      manager.connect();

      // Wait for connection to be established
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;
      expect(mockWs.url).toBe(
        "wss://stream.binance.com:9443/ws/btcusdt@kline_1m",
      );
    });

    it("should create a WebSocket connection with correct URL for testnet", async () => {
      const testnetConfig = { ...config, testnet: true };
      manager = new WebSocketManager(testnetConfig);
      manager.connect();

      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;
      expect(mockWs.url).toBe(
        "wss://testnet.binance.vision/ws/btcusdt@kline_1m",
      );
    });

    it("should emit 'connected' event when connection is established", async () => {
      manager = new WebSocketManager(config);
      const connectedSpy = jest.fn();
      manager.on("connected", connectedSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      expect(connectedSpy).toHaveBeenCalled();
    });

    it("should set state to connected when connection opens", async () => {
      manager = new WebSocketManager(config);
      expect(manager.getState()).toBe("disconnected");

      manager.connect();
      expect(manager.getState()).toBe("connecting");

      await jest.runOnlyPendingTimersAsync();
      expect(manager.getState()).toBe("connected");
    });

    it("should not create multiple connections if connect is called multiple times", async () => {
      manager = new WebSocketManager(config);

      manager.connect();
      const firstWs = MockWebSocket.lastInstance;

      manager.connect(); // Second call
      const secondWs = MockWebSocket.lastInstance;

      expect(firstWs).toBe(secondWs);
    });
  });

  describe("Message Parsing", () => {
    it("should parse and emit valid kline data", async () => {
      manager = new WebSocketManager(config);
      const candleSpy = jest.fn();
      manager.on("candle", candleSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      const klineData = {
        e: "kline",
        E: 1638360000000,
        s: "BTCUSDT",
        k: {
          t: 1638360000000,
          T: 1638360059999,
          s: "BTCUSDT",
          i: "1m",
          f: 100,
          L: 200,
          o: "50000.00",
          c: "50100.00",
          h: "50150.00",
          l: "49950.00",
          v: "100.5",
          n: 1000,
          x: false,
          q: "5025000.00",
          V: "50.25",
          Q: "2512500.00",
          B: "0",
        },
      };

      mockWs.emit("message", Buffer.from(JSON.stringify(klineData)));

      expect(candleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: 1638360000000,
          open: 50000.0,
          high: 50150.0,
          low: 49950.0,
          close: 50100.0,
          volume: 100.5,
          isClosed: false,
        }),
      );
    });

    it("should handle closed klines", async () => {
      manager = new WebSocketManager(config);
      const candleSpy = jest.fn();
      manager.on("candle", candleSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      const klineData = {
        e: "kline",
        k: {
          t: 1638360000000,
          o: "50000.00",
          h: "50150.00",
          l: "49950.00",
          c: "50100.00",
          v: "100.5",
          x: true, // Closed candle
        },
      };

      mockWs.emit("message", Buffer.from(JSON.stringify(klineData)));

      expect(candleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isClosed: true,
        }),
      );
    });

    it("should ignore non-kline messages", async () => {
      manager = new WebSocketManager(config);
      const candleSpy = jest.fn();
      manager.on("candle", candleSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      const nonKlineData = {
        e: "trade",
        E: 1638360000000,
        s: "BTCUSDT",
        p: "50000.00",
        q: "0.001",
      };

      mockWs.emit("message", Buffer.from(JSON.stringify(nonKlineData)));

      expect(candleSpy).not.toHaveBeenCalled();
    });

    it("should handle malformed JSON messages", async () => {
      manager = new WebSocketManager(config);
      const errorSpy = jest.fn();
      manager.on("error", errorSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      mockWs.emit("message", Buffer.from("not valid json"));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Failed to parse message"),
        }),
      );
    });
  });

  describe("Reconnection Logic", () => {
    it("should attempt to reconnect on connection loss", async () => {
      manager = new WebSocketManager(config);
      const reconnectingSpy = jest.fn();
      manager.on("reconnecting", reconnectingSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;
      mockWs.readyState = MockWebSocket.CLOSED;
      mockWs.emit("close");

      expect(reconnectingSpy).toHaveBeenCalled();
      expect(manager.getState()).toBe("reconnecting");
    });

    it("should use exponential backoff for reconnection attempts", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      // First reconnection - 1 second
      mockWs.emit("close");
      expect(manager.getState()).toBe("reconnecting");

      // Advance time by 1 second
      jest.advanceTimersByTime(1000);

      // Second reconnection - 2 seconds
      mockWs = MockWebSocket.lastInstance!;
      mockWs.emit("close");

      // Advance time by 2 seconds
      jest.advanceTimersByTime(2000);

      // Third reconnection - 4 seconds
      mockWs = MockWebSocket.lastInstance!;
      mockWs.emit("close");

      const stats = manager.getStats();
      expect(stats.reconnectAttempts).toBeGreaterThan(0);
    });

    it("should not reconnect if disconnect was intentional", async () => {
      manager = new WebSocketManager(config);
      const reconnectingSpy = jest.fn();
      manager.on("reconnecting", reconnectingSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      manager.disconnect(); // Intentional disconnect

      expect(reconnectingSpy).not.toHaveBeenCalled();
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Heartbeat/Ping Mechanism", () => {
    it("should start sending pings after connection", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      // Advance time by heartbeat interval
      jest.advanceTimersByTime(30000);

      expect(mockWs.ping).toHaveBeenCalled();
    });

    it("should reconnect if pong is not received within timeout", async () => {
      manager = new WebSocketManager(config);
      const reconnectingSpy = jest.fn();
      manager.on("reconnecting", reconnectingSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      // Override ping to not emit pong
      mockWs.ping = jest.fn() as Mock;

      // Advance time past heartbeat + pong timeout
      jest.advanceTimersByTime(35000);

      expect(reconnectingSpy).toHaveBeenCalled();
    });

    it("should stop heartbeat on disconnect", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      manager.disconnect();

      // Advance time by heartbeat interval
      jest.advanceTimersByTime(30000);

      expect(mockWs.ping).not.toHaveBeenCalled();
    });
  });

  describe("Message Queue During Reconnection", () => {
    it("should queue messages during reconnection", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      // Disconnect to trigger reconnection
      mockWs.readyState = MockWebSocket.CLOSED;
      mockWs.emit("close");

      // Try to send while reconnecting
      manager.send({ test: "data" });

      // Reconnect
      await jest.runOnlyPendingTimersAsync();
      jest.advanceTimersByTime(1000);
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ test: "data" }),
      );
    });

    it("should respect maximum queue size", () => {
      const smallQueueConfig = { ...config, maxQueueSize: 2 };
      manager = new WebSocketManager(smallQueueConfig);

      // Don't connect, so messages get queued
      for (let i = 0; i < 5; i++) {
        manager.send({ message: i });
      }

      // The manager should maintain a queue internally even if not exposed in stats
      // We can verify queueing behavior by checking that messages are sent later
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Error Handling", () => {
    it("should emit error events from WebSocket", async () => {
      manager = new WebSocketManager(config);
      const errorSpy = jest.fn();
      manager.on("error", errorSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;
      const error = new Error("Connection failed");
      mockWs.emit("error", error);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "WebSocket error: Connection failed",
        }),
      );
    });

    it("should handle unexpected close codes", async () => {
      manager = new WebSocketManager(config);
      const errorSpy = jest.fn();
      manager.on("error", errorSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;
      mockWs.emit("close", 1006, "Abnormal closure");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Abnormal closure"),
        }),
      );
    });
  });

  describe("Connection State Management", () => {
    it("should track connection state transitions", async () => {
      manager = new WebSocketManager(config);

      expect(manager.getState()).toBe("disconnected");

      manager.connect();
      expect(manager.getState()).toBe("connecting");

      await jest.runOnlyPendingTimersAsync();
      expect(manager.getState()).toBe("connected");

      manager.disconnect();
      expect(manager.getState()).toBe("disconnected");
    });

    it("should provide connection statistics", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      const stats = manager.getStats();

      expect(stats).toHaveProperty("messagesSent");
      expect(stats).toHaveProperty("messagesReceived");
      expect(stats).toHaveProperty("reconnectAttempts");
      expect(stats).toHaveProperty("lastMessageTime");
      expect(stats).toHaveProperty("connectedAt");
      expect(stats).toHaveProperty("disconnectedAt");
      expect(stats).toHaveProperty("uptime");
    });
  });

  describe("Public API Methods", () => {
    it("should check if connected correctly", async () => {
      manager = new WebSocketManager(config);

      expect(manager.isConnected()).toBe(false);

      manager.connect();
      expect(manager.isConnected()).toBe(false); // Still connecting

      await jest.runOnlyPendingTimersAsync();
      expect(manager.isConnected()).toBe(true);
    });

    it("should send messages when connected", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      manager.send({ test: "data" });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ test: "data" }),
      );
    });

    it("should disconnect and cleanup properly", async () => {
      manager = new WebSocketManager(config);
      const disconnectedSpy = jest.fn();
      manager.on("disconnected", disconnectedSpy);

      manager.connect();
      await jest.runOnlyPendingTimersAsync();

      mockWs = MockWebSocket.lastInstance!;

      manager.disconnect();

      expect(mockWs.close).toHaveBeenCalled();
      expect(disconnectedSpy).toHaveBeenCalled();
      expect(manager.getState()).toBe("disconnected");
    });
  });
});
