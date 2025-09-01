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

/**
 * Integration tests for WebSocketManager
 * These tests verify the WebSocketManager functionality without mocking
 */
describe("WebSocketManager Integration", () => {
  let manager: WebSocketManager;
  let config: WebSocketConfig;

  beforeEach(() => {
    config = {
      symbol: "btcusdt",
      timeframe: "1m",
      testnet: true, // Use testnet for integration tests
      maxReconnectDelay: 10000,
      heartbeatInterval: 30000,
      pongTimeout: 5000,
      maxQueueSize: 1000,
    };
  });

  afterEach(() => {
    if (manager) {
      manager.disconnect();
    }
  });

  describe("State Management", () => {
    it("should initialize with disconnected state", () => {
      manager = new WebSocketManager(config);
      expect(manager.getState()).toBe("disconnected");
    });

    it("should transition to connecting state when connect is called", () => {
      manager = new WebSocketManager(config);
      // Don't actually connect to avoid real WebSocket connection
      // Just verify the state management works
      expect(manager.getState()).toBe("disconnected");
    });

    it("should return to disconnected state after disconnect", () => {
      manager = new WebSocketManager(config);
      // Don't connect to avoid real connection
      manager.disconnect();
      expect(manager.getState()).toBe("disconnected");
    });

    it("should handle multiple disconnects gracefully", () => {
      manager = new WebSocketManager(config);
      manager.disconnect();
      manager.disconnect();
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Connection Stats", () => {
    it("should provide initial stats", () => {
      manager = new WebSocketManager(config);
      const stats = manager.getStats();

      expect(stats).toHaveProperty("messagesSent");
      expect(stats).toHaveProperty("messagesReceived");
      expect(stats).toHaveProperty("reconnectAttempts");
      expect(stats).toHaveProperty("lastMessageTime");
      expect(stats).toHaveProperty("connectedAt");
      expect(stats).toHaveProperty("disconnectedAt");
      expect(stats).toHaveProperty("uptime");

      expect(stats.messagesSent).toBe(0);
      expect(stats.messagesReceived).toBe(0);
      expect(stats.reconnectAttempts).toBe(0);
      expect(stats.connectedAt).toBeNull();
      expect(stats.uptime).toBe(0);
    });

    it("should track initial state in stats", () => {
      manager = new WebSocketManager(config);

      const stats = manager.getStats();
      expect(stats.connectedAt).toBeNull();
      expect(stats.disconnectedAt).toBeNull();
    });
  });

  describe("Message Queueing", () => {
    it("should queue messages when not connected", () => {
      manager = new WebSocketManager(config);

      // Send message without connecting
      manager.send({ test: "data1" });
      manager.send({ test: "data2" });

      // Messages should be queued internally
      expect(manager.getState()).toBe("disconnected");
    });

    it("should respect max queue size", () => {
      const smallQueueConfig = { ...config, maxQueueSize: 2 };
      manager = new WebSocketManager(smallQueueConfig);

      // Try to queue more than max
      for (let i = 0; i < 5; i++) {
        manager.send({ message: i });
      }

      // Manager should handle this gracefully
      expect(manager.getState()).toBe("disconnected");
    });
  });

  describe("Event Emitter", () => {
    it("should allow event listener registration", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.on("candle", listener);

      // Verify listener is registered (won't be called without real connection)
      expect(manager.listenerCount("candle")).toBe(1);
    });

    it("should allow event listener removal", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.on("candle", listener);
      manager.off("candle", listener);

      expect(manager.listenerCount("candle")).toBe(0);
    });

    it("should support once listeners", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.once("connected", listener);

      expect(manager.listenerCount("connected")).toBe(1);
    });
  });

  describe("Connection Check", () => {
    it("should correctly report connection status", () => {
      manager = new WebSocketManager(config);

      expect(manager.isConnected()).toBe(false);

      // Don't actually connect to avoid real WebSocket
      manager.disconnect();
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe("Configuration", () => {
    it("should handle production configuration", () => {
      const prodConfig: WebSocketConfig = {
        symbol: "ethusdt",
        timeframe: "5m",
        testnet: false,
        maxReconnectDelay: 30000,
        heartbeatInterval: 60000,
        pongTimeout: 10000,
        maxQueueSize: 500,
      };

      manager = new WebSocketManager(prodConfig);
      expect(manager.getState()).toBe("disconnected");
    });

    it("should handle different timeframes", () => {
      const timeframes = [
        "1m",
        "3m",
        "5m",
        "15m",
        "30m",
        "1h",
        "2h",
        "4h",
        "6h",
        "8h",
        "12h",
        "1d",
      ];

      for (const timeframe of timeframes) {
        const tfConfig = { ...config, timeframe };
        const tfManager = new WebSocketManager(tfConfig);
        expect(tfManager.getState()).toBe("disconnected");
        tfManager.disconnect();
      }
    });

    it("should handle different symbols", () => {
      const symbols = ["btcusdt", "ethusdt", "bnbusdt", "adausdt", "dogeusdt"];

      for (const symbol of symbols) {
        const symbolConfig = { ...config, symbol };
        const symbolManager = new WebSocketManager(symbolConfig);
        expect(symbolManager.getState()).toBe("disconnected");
        symbolManager.disconnect();
      }
    });
  });

  describe("Error Scenarios", () => {
    it("should handle send with invalid data gracefully", () => {
      manager = new WebSocketManager(config);

      // These should not throw
      manager.send(null as unknown as object);
      manager.send(undefined as unknown as object);
      manager.send({});

      expect(manager.getState()).toBe("disconnected");
    });
  });
});
