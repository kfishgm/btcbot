// Main exports
export { BinanceClient } from "./binance-client";
export {
  createBinanceClient,
  getBinanceClient,
  clearBinanceClient,
  validateBinanceConfig,
} from "./binance-factory";
export { TradingRules } from "./trading-rules";
export type { OrderValidationResult } from "./trading-rules";
export { BalanceManager } from "./balance-manager";
export type { Balance, BalanceOptions } from "./balance-manager";
export { WebSocketManager } from "./websocket-manager";
export { CandleProcessor } from "./candle-processor";
export type {
  CandleProcessorOptions,
  CandleProcessorStats,
  CandleProcessorError,
} from "./candle-processor";
export { HistoricalCandleManager } from "./historical-candle-manager";
export type {
  ExtendedKline,
  HistoricalCandleConfig,
  ATHCalculateOptions,
  ATHChangeEvent,
  CandleStatistics,
  CandleMetrics,
} from "./historical-candle-manager";

// Re-export all types
export * from "./types";
export * from "./websocket-types";
