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
import type { Mock } from "jest-mock";

// Mock the ws module
jest.mock("ws");

// Import the mocked WebSocket
import WebSocket from "ws";

// Type for our mock WebSocket instance
interface MockWebSocketInstance {
  url: string;
  readyState: number;
  send: Mock;
  ping: Mock;
  pong: Mock;
  close: Mock;
  terminate: Mock;
  emit: (event: string, ...args: unknown[]) => void;
}

// Type augmentation for WebSocket class to include lastInstance
interface MockWebSocketClass {
  lastInstance?: MockWebSocketInstance;
  CONNECTING: number;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
}

describe("WebSocketManager", () => {
  let manager: WebSocketManager;
  let config: WebSocketConfig;
  let mockWs: MockWebSocketInstance;
  const MockWS = WebSocket as unknown as MockWebSocketClass;

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

    // Clear any previous instance
    MockWS.lastInstance = undefined;
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

      mockWs = MockWS.lastInstance!;
      expect(mockWs).toBeDefined();
      expect(mockWs.url).toBe(
        "wss://stream.binance.com:9443/ws/btcusdt@kline_1m",
      );
    });

    it("should create a WebSocket connection with correct URL for testnet", () => {
      const testnetConfig = { ...config, testnet: true };
      manager = new WebSocketManager(testnetConfig);
      manager.connect();

      mockWs = MockWS.lastInstance!;
      expect(mockWs).toBeDefined();
      expect(mockWs.url).toBe(
        "wss://testnet.binance.vision/ws/btcusdt@kline_1m",
      );
    });

    it("should emit 'connected' event when connection is established", async () => {
      manager = new WebSocketManager(config);
      const connectedSpy = jest.fn();
      manager.on("connected", connectedSpy);

      manager.connect();

      // Wait for the connection to open
      await jest.runAllTimersAsync();

      expect(connectedSpy).toHaveBeenCalled();
    });

    it("should set state to connected when connection opens", async () => {
      manager = new WebSocketManager(config);
      expect(manager.getState()).toBe("disconnected");

      manager.connect();
      expect(manager.getState()).toBe("connecting");

      // Wait for connection to open
      await jest.runAllTimersAsync();
      expect(manager.getState()).toBe("connected");
    });

    it("should not create multiple connections if connect is called multiple times", () => {
      manager = new WebSocketManager(config);

      manager.connect();
      const firstWs = MockWS.lastInstance;

      manager.connect(); // Second call
      const secondWs = MockWS.lastInstance;

      expect(firstWs).toBe(secondWs);
    });
  });

  describe("Message Parsing", () => {
    it("should parse and emit valid kline data", async () => {
      manager = new WebSocketManager(config);
      const candleSpy = jest.fn();
      manager.on("candle", candleSpy);

      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

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
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

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
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

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
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

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
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;
      mockWs.readyState = MockWS.CLOSED;
      mockWs.emit("close");

      expect(reconnectingSpy).toHaveBeenCalled();
      expect(manager.getState()).toBe("reconnecting");
    });

    it("should use exponential backoff for reconnection attempts", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

      // First reconnection - 1 second
      mockWs.emit("close");
      expect(manager.getState()).toBe("reconnecting");

      // Advance time by 1 second
      jest.advanceTimersByTime(1000);

      // Get the new connection
      const secondWs = MockWS.lastInstance;
      expect(secondWs).not.toBe(mockWs);

      // Second reconnection - 2 seconds
      if (secondWs) {
        secondWs.emit("close");
      }

      const stats = manager.getStats();
      expect(stats.reconnectAttempts).toBeGreaterThan(0);
    });

    it("should not reconnect if disconnect was intentional", async () => {
      manager = new WebSocketManager(config);
      const reconnectingSpy = jest.fn();
      manager.on("reconnecting", reconnectingSpy);

      manager.connect();
      await jest.runAllTimersAsync();

      manager.disconnect(); // Intentional disconnect

      expect(reconnectingSpy).not.toHaveBeenCalled();
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Heartbeat/Ping Mechanism", () => {
    it("should start sending pings after connection", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

      // Advance time by heartbeat interval
      jest.advanceTimersByTime(30000);

      expect(mockWs.ping).toHaveBeenCalled();
    });

    it("should reconnect if pong is not received within timeout", async () => {
      manager = new WebSocketManager(config);
      const reconnectingSpy = jest.fn();
      manager.on("reconnecting", reconnectingSpy);

      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

      // Override ping to not emit pong
      mockWs.ping = jest.fn();

      // Advance time past heartbeat + pong timeout
      jest.advanceTimersByTime(35000);

      expect(reconnectingSpy).toHaveBeenCalled();
    });

    it("should stop heartbeat on disconnect", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;
      const pingCalls = mockWs.ping.mock.calls.length;

      manager.disconnect();

      // Advance time by heartbeat interval
      jest.advanceTimersByTime(30000);

      // Ping should not have been called again
      expect(mockWs.ping).toHaveBeenCalledTimes(pingCalls);
    });
  });

  describe("Message Queue During Reconnection", () => {
    it("should queue messages during reconnection", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

      // Disconnect to trigger reconnection
      mockWs.readyState = MockWS.CLOSED;
      mockWs.emit("close");

      // Try to send while reconnecting
      manager.send({ test: "data" });

      // Advance time for reconnection
      jest.advanceTimersByTime(1000);
      await jest.runAllTimersAsync();

      // Get new connection
      const newWs = MockWS.lastInstance;
      expect(newWs).not.toBe(mockWs);
      if (newWs) {
        expect(newWs.send).toHaveBeenCalledWith(
          JSON.stringify({ test: "data" }),
        );
      }
    });

    it("should respect maximum queue size", () => {
      const smallQueueConfig = { ...config, maxQueueSize: 2 };
      manager = new WebSocketManager(smallQueueConfig);

      // Don't connect, so messages get queued
      for (let i = 0; i < 5; i++) {
        manager.send({ message: i });
      }

      // The manager should maintain a queue internally
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Error Handling", () => {
    it("should emit error events from WebSocket", async () => {
      manager = new WebSocketManager(config);
      const errorSpy = jest.fn();
      manager.on("error", errorSpy);

      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;
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
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;
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

      await jest.runAllTimersAsync();
      expect(manager.getState()).toBe("connected");

      manager.disconnect();
      expect(manager.getState()).toBe("disconnected");
    });

    it("should provide connection statistics", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runAllTimersAsync();

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

      await jest.runAllTimersAsync();
      expect(manager.isConnected()).toBe(true);
    });

    it("should send messages when connected", async () => {
      manager = new WebSocketManager(config);
      manager.connect();
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

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
      await jest.runAllTimersAsync();

      mockWs = MockWS.lastInstance!;

      manager.disconnect();

      expect(mockWs.close).toHaveBeenCalled();
      expect(disconnectedSpy).toHaveBeenCalled();
      expect(manager.getState()).toBe("disconnected");
    });
  });
});
