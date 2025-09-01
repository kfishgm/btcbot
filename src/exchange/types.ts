export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  recvWindow?: number;
  timeout?: number;
}

export type OrderType =
  | "LIMIT"
  | "MARKET"
  | "STOP_LOSS"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "LIMIT_MAKER";

export type OrderSide = "BUY" | "SELL";

export type TimeInForce = "GTC" | "IOC" | "FOK";

export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "PENDING_CANCEL"
  | "REJECTED"
  | "EXPIRED";

export interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime?: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: OrderStatus;
  timeInForce: TimeInForce;
  type: OrderType;
  side: OrderSide;
  stopPrice?: string;
  icebergQty?: string;
  time?: number;
  updateTime?: number;
  isWorking?: boolean;
  origQuoteOrderQty?: string;
  fills?: OrderFill[];
}

export interface OrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId: number;
}

export interface CreateOrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  newClientOrderId?: string;
  recvWindow?: number;
}

export interface BinanceAccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: BinanceBalance[];
  permissions: string[];
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

export interface BinanceOrderBook {
  lastUpdateId: number;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
}

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export interface RateLimitInfo {
  weightUsed: number;
  weightLimit: number;
  ordersPerSecond: number;
  lastResetTime: number;
}

export interface BinanceError {
  code: number;
  msg: string;
}

export interface BinanceServerTime {
  serverTime: number;
}

export interface BinanceTrade {
  symbol: string;
  id: number;
  orderId: number;
  orderListId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
}

export interface BinanceListenKey {
  listenKey: string;
}

export interface BinanceExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: Array<{
    rateLimitType: string;
    interval: string;
    intervalNum: number;
    limit: number;
  }>;
  symbols: BinanceSymbolInfo[];
}

export interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quoteAssetPrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: BinanceSymbolFilter[];
  permissions: string[];
}

export interface BinanceSymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  applyToMarket?: boolean;
  avgPriceMins?: number;
}

export interface SymbolTradingRules {
  symbol: string;
  minPrice: number;
  maxPrice: number;
  tickSize: number;
  minQty: number;
  maxQty: number;
  stepSize: number;
  minNotional: number;
  lastUpdated: number;
}

export interface WebSocketMessage {
  e: string;
  E: number;
  s?: string;
  [key: string]: unknown;
}

export interface TradeStreamMessage extends WebSocketMessage {
  e: "trade";
  s: string;
  t: number;
  p: string;
  q: string;
  b: number;
  a: number;
  T: number;
  m: boolean;
  M: boolean;
}

export interface DepthStreamMessage extends WebSocketMessage {
  e: "depthUpdate";
  s: string;
  U: number;
  u: number;
  b: Array<[string, string]>;
  a: Array<[string, string]>;
}

export interface AccountUpdateMessage extends WebSocketMessage {
  e: "outboundAccountPosition";
  u: number;
  B: Array<{
    a: string;
    f: string;
    l: string;
  }>;
}

export interface OrderUpdateMessage extends WebSocketMessage {
  e: "executionReport";
  s: string;
  c: string;
  S: OrderSide;
  o: OrderType;
  f: TimeInForce;
  q: string;
  p: string;
  P: string;
  F: string;
  g: number;
  C: string;
  x: string;
  X: OrderStatus;
  r: string;
  i: number;
  l: string;
  z: string;
  L: string;
  n: string;
  N: string;
  T: number;
  t: number;
  I: number;
  w: boolean;
  m: boolean;
  M: boolean;
  O: number;
  Z: string;
  Y: string;
  Q: string;
}
