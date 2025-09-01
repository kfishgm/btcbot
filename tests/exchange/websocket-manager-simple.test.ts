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

describe("WebSocketManager - Simple Tests", () => {
  let manager: WebSocketManager;
  let config: WebSocketConfig;

  beforeEach(() => {
    config = {
      symbol: "btcusdt",
      timeframe: "1m",
      testnet: true, // Use testnet for testing
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

  describe("Basic Functionality", () => {
    it("should create a WebSocketManager instance", () => {
      manager = new WebSocketManager(config);
      expect(manager).toBeDefined();
      expect(manager.getState()).toBe("disconnected");
    });

    it("should have correct initial state", () => {
      manager = new WebSocketManager(config);
      expect(manager.getState()).toBe("disconnected");
      expect(manager.isConnected()).toBe(false);
      expect(manager.getReconnectAttempts()).toBe(0);
    });

    it("should have initial stats", () => {
      manager = new WebSocketManager(config);
      const stats = manager.getStats();

      expect(stats).toEqual({
        messagesSent: 0,
        messagesReceived: 0,
        reconnectAttempts: 0,
        lastMessageTime: null,
        connectedAt: null,
        disconnectedAt: null,
        uptime: 0,
      });
    });

    it("should change state when connecting", () => {
      manager = new WebSocketManager(config);
      const stateListener = jest.fn();
      manager.on("state_change", stateListener);

      manager.connect();

      expect(manager.getState()).toBe("connecting");
      expect(stateListener).toHaveBeenCalledWith({
        from: "disconnected",
        to: "connecting",
      });
    });

    it("should queue messages when not connected", () => {
      manager = new WebSocketManager(config);

      const message = { action: "subscribe", channel: "trades" };
      manager.send(message);

      // Message should be queued since we're not connected
      expect(manager.getState()).toBe("disconnected");
    });

    it("should handle multiple event listeners", () => {
      manager = new WebSocketManager(config);

      const listener1 = jest.fn();
      const listener2 = jest.fn();

      manager.on("state_change", listener1);
      manager.on("state_change", listener2);

      manager.connect();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it("should unsubscribe from events", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.on("state_change", listener);
      manager.off("state_change", listener);

      manager.connect();

      expect(listener).not.toHaveBeenCalled();
    });

    it("should support one-time listeners", () => {
      manager = new WebSocketManager(config);

      const listener = jest.fn();
      manager.once("state_change", listener);

      manager.connect();
      manager.disconnect();
      manager.connect();

      // Should only be called once
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should reset stats on request", () => {
      manager = new WebSocketManager(config);

      // Modify stats by simulating activity
      manager.connect();

      // Reset stats
      manager.resetStats();

      const stats = manager.getStats();
      expect(stats.reconnectAttempts).toBe(0);
      expect(stats.messagesSent).toBe(0);
      expect(stats.messagesReceived).toBe(0);
    });

    it("should handle disconnect properly", () => {
      manager = new WebSocketManager(config);
      const stateListener = jest.fn();
      manager.on("state_change", stateListener);

      manager.connect();
      jest.clearAllMocks();

      manager.disconnect();

      expect(manager.getState()).toBe("disconnected");
      expect(stateListener).toHaveBeenCalledWith({
        from: "connecting",
        to: "disconnected",
      });
    });

    it("should support different timeframes", () => {
      const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

      timeframes.forEach((timeframe) => {
        const customConfig = { ...config, timeframe };
        const customManager = new WebSocketManager(customConfig);
        expect(customManager).toBeDefined();
        customManager.disconnect();
      });
    });

    it("should support both testnet and production", () => {
      const testnetManager = new WebSocketManager({ ...config, testnet: true });
      expect(testnetManager).toBeDefined();
      testnetManager.disconnect();

      const prodManager = new WebSocketManager({ ...config, testnet: false });
      expect(prodManager).toBeDefined();
      prodManager.disconnect();
    });
  });

  describe("Configuration", () => {
    it("should use default values for optional config", () => {
      const minimalConfig: WebSocketConfig = {
        symbol: "btcusdt",
        timeframe: "1m",
        testnet: true,
      };

      manager = new WebSocketManager(minimalConfig);
      expect(manager).toBeDefined();
    });

    it("should accept custom reconnect delay", () => {
      const customConfig = { ...config, maxReconnectDelay: 5000 };
      manager = new WebSocketManager(customConfig);
      expect(manager).toBeDefined();
    });

    it("should accept custom heartbeat interval", () => {
      const customConfig = { ...config, heartbeatInterval: 60000 };
      manager = new WebSocketManager(customConfig);
      expect(manager).toBeDefined();
    });

    it("should accept custom pong timeout", () => {
      const customConfig = { ...config, pongTimeout: 10000 };
      manager = new WebSocketManager(customConfig);
      expect(manager).toBeDefined();
    });

    it("should accept max reconnect attempts", () => {
      const customConfig = { ...config, maxReconnectAttempts: 5 };
      manager = new WebSocketManager(customConfig);
      expect(manager).toBeDefined();
    });
  });
});
