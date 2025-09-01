import WebSocket from "ws";
import { EventEmitter } from "events";
import type {
  WebSocketConfig,
  WebSocketState,
  CandleData,
  ConnectionStats,
  KlineMessage,
  WebSocketError,
} from "./websocket-types";

export class WebSocketManager extends EventEmitter {
  private config: WebSocketConfig;
  private ws: WebSocket | null = null;
  private state: WebSocketState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private messageQueue: string[] = [];
  private stats: ConnectionStats;
  private isIntentionalDisconnect = false;

  constructor(config: WebSocketConfig) {
    super();
    this.config = {
      maxReconnectDelay: 10000,
      heartbeatInterval: 30000,
      pongTimeout: 5000,
      maxQueueSize: 1000,
      ...config,
    };

    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      reconnectAttempts: 0,
      lastMessageTime: null,
      connectedAt: null,
      disconnectedAt: null,
      uptime: 0,
    };
  }

  connect(): void {
    if (this.state === "connecting" || this.state === "connected") {
      return;
    }

    this.setState("connecting");
    this.isIntentionalDisconnect = false;

    const url = this.buildWebSocketUrl();

    try {
      this.ws = new WebSocket(url);
      this.setupEventHandlers();
    } catch (error) {
      this.handleError(error as Error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.isIntentionalDisconnect = true;
    this.cleanup();

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Normal closure");
      } else {
        this.ws.terminate();
      }
      this.ws = null;
    }

    this.setState("disconnected");
    this.stats.disconnectedAt = Date.now();
    this.updateUptime();
  }

  send(message: string | object): void {
    if (this.state !== "connected" || !this.ws) {
      this.queueMessage(
        typeof message === "string" ? message : JSON.stringify(message),
      );
      return;
    }

    const messageStr =
      typeof message === "string" ? message : JSON.stringify(message);

    try {
      this.ws.send(messageStr);
      this.stats.messagesSent++;
    } catch (error) {
      this.handleError(error as Error);
      this.queueMessage(messageStr);
    }
  }

  getState(): WebSocketState {
    return this.state;
  }

  getStats(): ConnectionStats {
    this.updateUptime();
    return { ...this.stats };
  }

  isConnected(): boolean {
    return this.state === "connected";
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  resetStats(): void {
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      reconnectAttempts: 0,
      lastMessageTime: null,
      connectedAt: null,
      disconnectedAt: null,
      uptime: 0,
    };
  }

  private buildWebSocketUrl(): string {
    const { symbol, timeframe, testnet } = this.config;
    const baseUrl = testnet
      ? "wss://testnet.binance.vision"
      : "wss://stream.binance.com:9443";

    return `${baseUrl}/ws/${symbol}@kline_${timeframe}`;
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on("open", () => this.handleOpen());
    this.ws.on("message", (data: WebSocket.RawData) =>
      this.handleMessage(data),
    );
    this.ws.on("close", (code: number, reason: Buffer) =>
      this.handleClose(code, reason.toString()),
    );
    this.ws.on("error", (error: Error) => this.handleError(error));
    this.ws.on("pong", () => this.handlePong());
  }

  private handleOpen(): void {
    this.setState("connected");
    this.reconnectAttempts = 0;
    this.stats.connectedAt = Date.now();
    this.stats.disconnectedAt = null;

    this.emit("connected");

    if (this.reconnectAttempts > 0) {
      this.emit("reconnected");
    }

    this.startHeartbeat();
    this.processQueuedMessages();
  }

  private handleMessage(data: WebSocket.RawData): void {
    const message = data.toString();
    this.stats.messagesReceived++;
    this.stats.lastMessageTime = Date.now();

    try {
      const parsed = JSON.parse(message) as KlineMessage;

      if (parsed.e === "kline" && parsed.k) {
        const candle: CandleData = {
          eventTime: parsed.E,
          symbol: parsed.s,
          openTime: parsed.k.t,
          closeTime: parsed.k.T,
          firstTradeId: parsed.k.f,
          lastTradeId: parsed.k.L,
          open: parsed.k.o,
          high: parsed.k.h,
          low: parsed.k.l,
          close: parsed.k.c,
          volume: parsed.k.v,
          numberOfTrades: parsed.k.n,
          isCandleClosed: parsed.k.x,
          quoteAssetVolume: parsed.k.q,
          takerBuyBaseAssetVolume: parsed.k.V,
          takerBuyQuoteAssetVolume: parsed.k.Q,
        };

        this.emit("candle", candle);
      }
    } catch (error) {
      this.handleError(new Error(`Failed to parse message: ${error}`));
    }
  }

  private handleClose(code: number, reason: string): void {
    this.cleanup();
    this.stats.disconnectedAt = Date.now();
    this.updateUptime();

    this.emit("disconnected", { code, reason });

    if (!this.isIntentionalDisconnect) {
      this.setState("reconnecting");
      this.scheduleReconnect();
    } else {
      this.setState("disconnected");
    }
  }

  private handleError(error: Error): void {
    const wsError: WebSocketError = {
      message: error.message,
      timestamp: Date.now(),
    };

    if (error.message.includes("429") || error.message.includes("rate limit")) {
      wsError.code = 429;
    } else if (
      error.message.includes("401") ||
      error.message.includes("authentication")
    ) {
      wsError.code = 401;
    }

    this.emit("error", wsError);
  }

  private handlePong(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();

        this.pongTimeout = setTimeout(() => {
          this.handlePongTimeout();
        }, this.config.pongTimeout || 5000);
      }
    }, this.config.heartbeatInterval || 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private handlePongTimeout(): void {
    if (this.ws) {
      this.ws.terminate();
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isIntentionalDisconnect) {
      return;
    }

    if (
      this.config.maxReconnectAttempts &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.emit("max_retries_reached");
      this.setState("disconnected");
      return;
    }

    const delay = Math.min(
      Math.pow(2, this.reconnectAttempts) * 1000,
      this.config.maxReconnectDelay || 10000,
    );

    this.reconnectAttempts++;
    this.stats.reconnectAttempts++;

    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private queueMessage(message: string): void {
    if (this.messageQueue.length >= (this.config.maxQueueSize || 1000)) {
      this.messageQueue.shift();
    }
    this.messageQueue.push(message);
  }

  private processQueuedMessages(): void {
    while (
      this.messageQueue.length > 0 &&
      this.state === "connected" &&
      this.ws
    ) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          this.ws.send(message);
          this.stats.messagesSent++;
        } catch {
          this.queueMessage(message);
          break;
        }
      }
    }
  }

  private setState(state: WebSocketState): void {
    const previousState = this.state;
    this.state = state;
    if (previousState !== state) {
      this.emit("state_change", { from: previousState, to: state });
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private updateUptime(): void {
    if (this.stats.connectedAt && !this.stats.disconnectedAt) {
      this.stats.uptime = Date.now() - this.stats.connectedAt;
    } else if (this.stats.connectedAt && this.stats.disconnectedAt) {
      this.stats.uptime = this.stats.disconnectedAt - this.stats.connectedAt;
    }
  }
}
