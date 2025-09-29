#!/usr/bin/env node

/**
 * BTC Trading Bot - Application Bootstrap
 *
 * This file wires up all dependencies and starts the MainOrchestrator.
 * The orchestrator handles the actual trading logic.
 */

import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { MainOrchestrator } from "./src/app/main-orchestrator.js";
import { getConfig } from "./src/config/index.js";
import { logger } from "./src/utils/logger.js";

import { BinanceClient } from "./src/exchange/binance-client.js";
import { WebSocketManager } from "./src/exchange/websocket-manager.js";
import { CandleProcessor } from "./src/exchange/candle-processor.js";
import { HistoricalCandleManager } from "./src/exchange/historical-candle-manager.js";
import { BalanceManager } from "./src/exchange/balance-manager.js";
import { TradingRules } from "./src/exchange/trading-rules.js";
import { CommissionManager } from "./src/exchange/commission-manager.js";

import { CycleStateManager } from "./src/cycle/cycle-state-manager.js";
import { BuyTriggerDetector } from "./src/cycle/buy-trigger-detector.js";
import { SellTriggerDetector } from "./src/cycle/sell-trigger-detector.js";
import { StrategyPauseMechanism } from "./src/cycle/strategy-pause-mechanism.js";
import { BuyOrderStateUpdater } from "./src/cycle/buy-order-state-updater.js";
import { SellOrderStateUpdater } from "./src/cycle/sell-order-state-updater.js";
import { StateTransactionManager } from "./src/cycle/state-transaction-manager.js";
import { ReferencePriceCalculator } from "./src/cycle/reference-price-calculator.js";
import { BuyAmountCalculator } from "./src/cycle/buy-amount-calculator.js";

import { BuyOrderPlacer } from "./src/order/buy-order-placer.js";
import { SellOrderPlacer } from "./src/order/sell-order-placer.js";

import { ConnectionManager } from "./src/database/connection-manager.js";
import { EventLogger } from "./src/monitoring/event-logger.js";
import { DiscordNotifier } from "./src/notifications/discord-notifier.js";
import { StrategyConfigLoader } from "./src/config/strategy-config-loader.js";

import type { Database } from "./types/supabase.js";

// Load .env.local first, then .env as fallback
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

async function createDependencies() {
  const appConfig = getConfig();

  const supabase = createClient<Database>(
    appConfig.supabase.url,
    appConfig.supabase.serviceRoleKey,
  );

  const binanceClient = new BinanceClient({
    apiKey: appConfig.binance.apiKey,
    apiSecret: appConfig.binance.apiSecret,
    testnet: appConfig.binance.testnet,
  });

  const strategyConfigLoader = new StrategyConfigLoader();
  const strategyConfig = await strategyConfigLoader.loadConfig();

  if (!strategyConfig || !strategyConfig.isActive) {
    throw new Error("No active strategy configuration found");
  }

  const connectionManager = new ConnectionManager({
    url: appConfig.supabase.url,
    key: appConfig.supabase.serviceRoleKey,
  });

  const eventLogger = new EventLogger({
    supabase: supabase,
    logger: logger,
  });

  const balanceManager = new BalanceManager(binanceClient);
  const referencePriceCalculator = new ReferencePriceCalculator();
  const buyAmountCalculator = new BuyAmountCalculator();
  const stateTransactionManager = new StateTransactionManager(supabase);

  // Create TradingRules instance early so it can be shared
  const tradingRules = new TradingRules(binanceClient);

  const cycleStateManager = new CycleStateManager(
    supabase,
    {
      initialCapitalUSDT: strategyConfig.initialCapitalUsdt,
      maxPurchases: strategyConfig.maxPurchases,
      minBuyUSDT: strategyConfig.minBuyUsdt,
    },
    tradingRules,
  );

  const strategyPauseMechanism = new StrategyPauseMechanism(
    supabase,
    cycleStateManager,
  );

  const historicalCandleManager = new HistoricalCandleManager(
    binanceClient,
    "BTCUSDT",
    strategyConfig.timeframe,
    {
      maxCandles: strategyConfig.athWindow,
    },
  );

  const webSocketManager = new WebSocketManager({
    symbol: "BTCUSDT",
    timeframe: strategyConfig.timeframe,
    testnet: appConfig.binance.testnet,
  });
  const candleProcessor = new CandleProcessor();

  // Connect candle processor to WebSocket manager
  candleProcessor.attachToWebSocketManager(webSocketManager);

  // Initialize commission manager for fee tracking
  const commissionManager = new CommissionManager(binanceClient);
  await commissionManager.initialize();

  const buyTriggerDetector = new BuyTriggerDetector(
    buyAmountCalculator,
    tradingRules,
  );
  const sellTriggerDetector = new SellTriggerDetector(
    tradingRules,
    commissionManager,
  );

  // Get trading rules and exchange info for BTCUSDT
  const btcRules = await tradingRules.getRules("BTCUSDT");
  const stepSize = btcRules.stepSize;
  const tickSize = btcRules.tickSize;

  // Get exchange info to get asset precisions
  const exchangeInfo = await binanceClient.getExchangeInfo("BTCUSDT");
  const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === "BTCUSDT");
  const baseAssetPrecision = symbolInfo?.baseAssetPrecision || 8; // Default to 8 for BTC
  const quoteAssetPrecision = symbolInfo?.quoteAssetPrecision || 8; // Default to 8 for USDT

  logger.info("Trading rules and precision loaded for BTCUSDT", {
    stepSize,
    tickSize,
    minQty: btcRules.minQty,
    minNotional: btcRules.minNotional,
    baseAssetPrecision,
    quoteAssetPrecision,
  });

  // Set precision in buy amount calculator
  buyAmountCalculator.setQuotePrecision(quoteAssetPrecision);

  // Set precision in sell trigger detector
  sellTriggerDetector.setTradingPrecision(
    baseAssetPrecision,
    quoteAssetPrecision,
  );

  // Enable auto-refresh of trading rules every 4 hours
  tradingRules.startAutoRefresh(
    4 * 60 * 60 * 1000, // 4 hours in milliseconds
    (error) => {
      logger.error("Failed to auto-refresh trading rules", {
        error: error.message,
        stack: error.stack,
      });
    },
  );

  logger.info("Trading rules auto-refresh enabled (every 4 hours)");

  // Enable auto-refresh of commission rates every 4 hours
  commissionManager.startAutoRefresh(
    4 * 60 * 60 * 1000, // 4 hours in milliseconds
    (error) => {
      logger.error("Failed to auto-refresh commission rates", {
        error: error.message,
        stack: error.stack,
      });
    },
  );

  logger.info("Commission rates auto-refresh enabled (every 4 hours)");

  const buyOrderPlacer = new BuyOrderPlacer(
    binanceClient,
    tradingRules,
    supabase,
    "BTCUSDT",
  );

  const sellOrderPlacer = new SellOrderPlacer(
    binanceClient,
    tradingRules,
    supabase,
    "BTCUSDT",
  );

  let discordNotifier: DiscordNotifier | undefined;
  if (process.env.DISCORD_WEBHOOK_URL) {
    discordNotifier = new DiscordNotifier({
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    });
  }

  const buyOrderStateUpdater = new BuyOrderStateUpdater(
    supabase,
    discordNotifier,
    stepSize,
    baseAssetPrecision,
    tickSize,
  );
  const sellOrderStateUpdater = new SellOrderStateUpdater(
    supabase,
    {
      maxPurchases: strategyConfig.maxPurchases,
    },
    discordNotifier,
    tradingRules,
  );

  // Add error handler to WebSocketManager to prevent unhandled errors
  webSocketManager.on("error", (error: { message: string; code?: number }) => {
    logger.error("WebSocket error", {
      message: error.message,
      code: error.code,
      module: "bootstrap",
    });
    // Don't crash on WebSocket errors - let the manager handle reconnection
  });

  return {
    supabaseClient: supabase,
    binanceClient,
    webSocketManager,
    candleProcessor,
    cycleStateManager,
    historicalCandleManager,
    buyTriggerDetector,
    sellTriggerDetector,
    buyOrderPlacer,
    sellOrderPlacer,
    buyOrderStateUpdater,
    sellOrderStateUpdater,
    strategyPauseMechanism,
    discordNotifier,
    eventLogger,
    balanceManager,
    connectionManager,
    stateTransactionManager,
    referencePriceCalculator,
    buyAmountCalculator,
    strategyConfigLoader,
    enableHealthMonitoring: true,
    healthCheckInterval: 60000,
    memoryThresholdMB: 500,
  };
}

async function main() {
  let orchestrator: MainOrchestrator | null = null;

  try {
    console.log("Starting BTC Trading Bot...");

    const dependencies = await createDependencies();
    orchestrator = new MainOrchestrator(dependencies);

    await orchestrator.initialize();
    await orchestrator.start();

    console.log("BTC Trading Bot started successfully!");

    process.on("SIGINT", async () => {
      console.log("\nShutting down gracefully...");
      if (orchestrator) await orchestrator.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\nShutting down gracefully...");
      if (orchestrator) await orchestrator.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("Failed to start bot:", error);
    if (orchestrator) await orchestrator.stop();
    process.exit(1);
  }
}

main();
