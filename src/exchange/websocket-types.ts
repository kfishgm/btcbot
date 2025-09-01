export interface WebSocketConfig {
  symbol: string;
  timeframe: string;
  testnet: boolean;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
  pongTimeout?: number;
  maxQueueSize?: number;
  maxReconnectAttempts?: number;
}

export type WebSocketState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting";

export interface CandleData {
  eventTime: number;
  symbol: string;
  openTime: number;
  closeTime: number;
  firstTradeId: number;
  lastTradeId: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  numberOfTrades: number;
  isCandleClosed: boolean;
  quoteAssetVolume: string;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export interface ConnectionStats {
  messagesSent: number;
  messagesReceived: number;
  reconnectAttempts: number;
  lastMessageTime: number | null;
  connectedAt: number | null;
  disconnectedAt: number | null;
  uptime: number;
}

export interface KlineMessage {
  e: string;
  E: number;
  s: string;
  k: {
    t: number;
    T: number;
    s: string;
    i: string;
    f: number;
    L: number;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    n: number;
    x: boolean;
    q: string;
    V: string;
    Q: string;
    B: string;
  };
}

export interface WebSocketError {
  code?: number;
  message: string;
  timestamp: number;
}
