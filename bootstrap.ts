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
import { OrchestratorPool } from "./src/app/orchestrator-pool.js";
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
import {
  StrategyConfigLoader,
  type StrategyConfig,
} from "./src/config/strategy-config-loader.js";

import type { Database } from "./types/supabase.js";

// Load .env.local first, then .env as fallback
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

// Increase max listeners for multi-config support (7 orchestrators + pool + system handlers)
process.setMaxListeners(20);

/**
 * Shared dependencies used across all orchestrators
 */
interface SharedDependencies {
  appConfig: ReturnType<typeof getConfig>;
  supabase: ReturnType<typeof createClient<Database>>;
  binanceClient: BinanceClient;
  strategyConfigLoader: StrategyConfigLoader;
  connectionManager: ConnectionManager;
  eventLogger: EventLogger;
  balanceManager: BalanceManager;
  stateTransactionManager: StateTransactionManager;
  referencePriceCalculator: ReferencePriceCalculator;
  buyAmountCalculator: BuyAmountCalculator;
  tradingRules: TradingRules;
  commissionManager: CommissionManager;
  discordNotifier: DiscordNotifier | undefined;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  stepSize: number;
  tickSize: number;
}

/**
 * Create shared dependencies that are used by all orchestrators
 */
async function createSharedDependencies(): Promise<SharedDependencies> {
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

  // Initialize commission manager for fee tracking
  const commissionManager = new CommissionManager(binanceClient);
  await commissionManager.initialize();

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

  // Enable Discord logging if webhook URL is provided
  if (process.env.DISCORD_LOGS_WEBHOOK_URL) {
    logger.enableDiscordLogging(process.env.DISCORD_LOGS_WEBHOOK_URL);
  }

  let discordNotifier: DiscordNotifier | undefined;
  if (process.env.DISCORD_WEBHOOK_URL) {
    discordNotifier = new DiscordNotifier({
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    });
  }

  return {
    appConfig,
    supabase,
    binanceClient,
    strategyConfigLoader,
    connectionManager,
    eventLogger,
    balanceManager,
    stateTransactionManager,
    referencePriceCalculator,
    buyAmountCalculator,
    tradingRules,
    commissionManager,
    discordNotifier,
    baseAssetPrecision,
    quoteAssetPrecision,
    stepSize,
    tickSize,
  };
}

/**
 * Create an orchestrator for a specific strategy config
 */
async function createOrchestratorForConfig(
  strategyConfig: StrategyConfig,
  shared: SharedDependencies,
): Promise<MainOrchestrator> {
  const {
    appConfig,
    supabase,
    binanceClient,
    tradingRules,
    commissionManager,
  } = shared;

  // Create config-specific cycle state manager
  const cycleStateManager = new CycleStateManager(
    supabase,
    {
      initialCapitalUSDT: strategyConfig.initialCapitalUsdt,
      maxPurchases: strategyConfig.maxPurchases,
      minBuyUSDT: strategyConfig.minBuyUsdt,
    },
    tradingRules,
    strategyConfig.id, // Pass strategy config ID for filtering
    strategyConfig.timeframe, // Pass timeframe for logging context
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

  const candleProcessor = new CandleProcessor({
    timeframe: strategyConfig.timeframe,
  });
  candleProcessor.attachToWebSocketManager(webSocketManager);

  // Add error handler to WebSocketManager
  webSocketManager.on("error", (error: { message: string; code?: number }) => {
    logger.error("WebSocket error", {
      message: error.message,
      code: error.code,
      configId: strategyConfig.id,
      timeframe: strategyConfig.timeframe,
    });
  });

  const buyTriggerDetector = new BuyTriggerDetector(
    shared.buyAmountCalculator,
    strategyConfig,
    tradingRules,
  );

  const sellTriggerDetector = new SellTriggerDetector(
    strategyConfig,
    tradingRules,
    commissionManager,
  );

  // Set precision in sell trigger detector
  sellTriggerDetector.setTradingPrecision(
    shared.baseAssetPrecision,
    shared.quoteAssetPrecision,
  );

  const buyOrderPlacer = new BuyOrderPlacer(
    binanceClient,
    tradingRules,
    supabase,
    "BTCUSDT",
    strategyConfig,
  );

  const sellOrderPlacer = new SellOrderPlacer(
    binanceClient,
    tradingRules,
    supabase,
    "BTCUSDT",
    strategyConfig,
  );

  const buyOrderStateUpdater = new BuyOrderStateUpdater(
    supabase,
    shared.discordNotifier,
    commissionManager,
    shared.stepSize,
    shared.baseAssetPrecision,
    shared.tickSize,
    strategyConfig,
  );

  const sellOrderStateUpdater = new SellOrderStateUpdater(
    supabase,
    {
      maxPurchases: strategyConfig.maxPurchases,
    },
    shared.discordNotifier,
    tradingRules,
    commissionManager,
    shared.baseAssetPrecision,
    strategyConfig,
  );

  return new MainOrchestrator({
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
    discordNotifier: shared.discordNotifier,
    eventLogger: shared.eventLogger,
    balanceManager: shared.balanceManager,
    connectionManager: shared.connectionManager,
    stateTransactionManager: shared.stateTransactionManager,
    referencePriceCalculator: shared.referencePriceCalculator,
    buyAmountCalculator: shared.buyAmountCalculator,
    strategyConfig, // Pass config directly
    enableHealthMonitoring: true,
    healthCheckInterval: 60000,
    memoryThresholdMB: 500,
  });
}

async function main() {
  let pool: OrchestratorPool | null = null;

  try {
    console.log("🚀 Starting BTC Trading Bot (Multi-Config)...");

    // Create shared dependencies
    const shared = await createSharedDependencies();

    // Load all active strategy configs with validation
    const usdtBalance = await shared.balanceManager.getBalance("USDT");

    // Use INITIAL_CAPITAL_USDT from .env as the capital pool for percentage calculations
    const capitalPool = parseFloat(process.env.INITIAL_CAPITAL_USDT || "3000");

    // Validate we have enough balance for the capital pool
    const actualBalance = usdtBalance.total.toNumber();
    if (capitalPool > actualBalance) {
      throw new Error(
        `Capital pool ($${capitalPool}) exceeds available USDT balance ($${actualBalance.toFixed(2)})`,
      );
    }

    const strategyConfigs =
      await shared.strategyConfigLoader.loadAllActiveConfigs(capitalPool);

    console.log(
      `✅ Loaded ${strategyConfigs.length} active strategy config(s)`,
    );
    for (const config of strategyConfigs) {
      console.log(
        `   - ${config.timeframe}: drop=${config.dropPercentage * 100}%, rise=${config.risePercentage * 100}%, capital=$${config.initialCapitalUsdt}`,
      );
    }

    // Create orchestrator pool
    pool = new OrchestratorPool(strategyConfigs);

    // Create and register an orchestrator for each config
    for (const config of strategyConfigs) {
      const orchestrator = await createOrchestratorForConfig(config, shared);
      pool.registerOrchestrator(config.id, orchestrator);
    }

    // Initialize and start all orchestrators
    await pool.initializeAll();
    await pool.startAll();

    console.log(
      `✅ BTC Trading Bot started successfully with ${pool.getCount()} active config(s)!`,
    );

    // Graceful shutdown handlers
    const shutdown = async () => {
      console.log("\n🛑 Shutting down gracefully...");
      if (pool) {
        await pool.stopAll();
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    if (pool) {
      await pool.stopAll();
    }
    process.exit(1);
  }
}

main();
