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

import { CycleStateManager } from "./src/cycle/cycle-state-manager.js";
import { BuyTriggerDetector } from "./src/cycle/buy-trigger-detector.js";
import { SellTriggerDetector } from "./src/cycle/sell-trigger-detector.js";
import { DriftDetector } from "./src/cycle/drift-detector.js";
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
  const driftDetector = new DriftDetector();

  const cycleStateManager = new CycleStateManager(supabase, {
    initialCapitalUSDT: strategyConfig.initialCapitalUsdt,
    maxPurchases: strategyConfig.maxPurchases,
    minBuyUSDT: strategyConfig.minBuyUsdt,
  });

  const strategyPauseMechanism = new StrategyPauseMechanism(
    supabase,
    cycleStateManager,
    driftDetector,
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

  const buyTriggerDetector = new BuyTriggerDetector(buyAmountCalculator);
  const sellTriggerDetector = new SellTriggerDetector();

  const tradingRules = new TradingRules(binanceClient);
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
  );
  const sellOrderStateUpdater = new SellOrderStateUpdater(
    supabase,
    {
      maxPurchases: strategyConfig.maxPurchases,
    },
    discordNotifier,
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
    driftDetector,
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
