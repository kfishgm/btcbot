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
import { ProfitPoolService } from "./src/pool/profit-pool-service.js";

import type { Database } from "./types/supabase.js";
import { ConfigurationError } from "./src/config/index.js";
import type { PoolConfig } from "./src/types/pool.types.js";

/**
 * Load pool configuration from database (profit_pool table)
 * Returns undefined if no pool config exists or pool is disabled
 */
async function loadPoolConfigFromDatabase(
  supabase: ReturnType<typeof createClient<Database>>,
): Promise<PoolConfig | undefined> {
  try {
    const { data: poolRow, error } = await supabase
      .from("profit_pool")
      .select(
        "is_enabled, reinvestment_percentage, funding_wallet_percentage, min_funding_transfer_amount",
      )
      .limit(1)
      .single();

    if (error) {
      logger.warn("Failed to load pool config from database, pool disabled", {
        error: error.message,
      });
      return undefined;
    }

    if (!poolRow || !poolRow.is_enabled) {
      logger.info("Pool is disabled in database configuration");
      return undefined;
    }

    const poolConfig: PoolConfig = {
      enabled: poolRow.is_enabled,
      reinvestmentPercentage: poolRow.reinvestment_percentage,
      fundingWalletPercentage: poolRow.funding_wallet_percentage,
      minFundingTransferAmount: poolRow.min_funding_transfer_amount,
    };

    logger.info("Pool configuration loaded from database", {
      enabled: poolConfig.enabled,
      reinvestmentPct: poolConfig.reinvestmentPercentage,
      fundingWalletPct: poolConfig.fundingWalletPercentage,
      minFundingTransfer: poolConfig.minFundingTransferAmount,
    });

    return poolConfig;
  } catch (error) {
    logger.warn("Failed to load pool config from database, pool disabled", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

// Load .env.local first, then .env as fallback
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

// Parse --test flag for hybrid mode (mainnet data + testnet trading)
const isHybridTestMode = process.argv.includes("--test");

// Increase max listeners for multi-config support (7 orchestrators + pool + system handlers)
process.setMaxListeners(20);

/**
 * Shared dependencies used across all orchestrators
 */
interface SharedDependencies {
  appConfig: ReturnType<typeof getConfig>;
  supabase: ReturnType<typeof createClient<Database>>;
  marketDataClient: BinanceClient; // For candles, prices, exchange info (mainnet in hybrid mode)
  tradingClient: BinanceClient; // For orders and balances (testnet in hybrid mode)
  isHybridTestMode: boolean;
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

  // Market data client always uses mainnet (real prices)
  const marketDataClient = new BinanceClient({
    apiKey: appConfig.binance.apiKey,
    apiSecret: appConfig.binance.apiSecret,
    testnet: false,
  });

  // Trading client: testnet when --test flag, mainnet otherwise
  let tradingClient: BinanceClient;
  if (isHybridTestMode) {
    // Validate testnet credentials exist
    if (
      !appConfig.binanceTestnet.apiKey ||
      !appConfig.binanceTestnet.apiSecret
    ) {
      throw new ConfigurationError(
        "Test mode requires BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET environment variables",
      );
    }
    tradingClient = new BinanceClient({
      apiKey: appConfig.binanceTestnet.apiKey,
      apiSecret: appConfig.binanceTestnet.apiSecret,
      testnet: true,
    });
  } else {
    // Production: same mainnet client for both
    tradingClient = marketDataClient;
  }

  const strategyConfigLoader = new StrategyConfigLoader();

  const connectionManager = new ConnectionManager({
    url: appConfig.supabase.url,
    key: appConfig.supabase.serviceRoleKey,
  });

  const eventLogger = new EventLogger({
    supabase: supabase,
    logger: logger,
  });

  // Balance manager uses trading client (reads testnet balances in hybrid mode)
  const balanceManager = new BalanceManager(tradingClient);
  const referencePriceCalculator = new ReferencePriceCalculator();
  const buyAmountCalculator = new BuyAmountCalculator();
  const stateTransactionManager = new StateTransactionManager(supabase);

  // Trading rules and commission use market data client (mainnet data in hybrid mode)
  const tradingRules = new TradingRules(marketDataClient);

  // Commission manager uses market data client for rate lookups
  const commissionManager = new CommissionManager(marketDataClient);
  await commissionManager.initialize();

  // Get trading rules and exchange info for BTCUSDT (from market data source)
  const btcRules = await tradingRules.getRules("BTCUSDT");
  const stepSize = btcRules.stepSize;
  const tickSize = btcRules.tickSize;

  // Get exchange info to get asset precisions (from market data source)
  const exchangeInfo = await marketDataClient.getExchangeInfo("BTCUSDT");
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
    marketDataClient,
    tradingClient,
    isHybridTestMode,
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
    supabase,
    marketDataClient,
    tradingClient,
    tradingRules,
    commissionManager,
  } = shared;

  // Create profit pool service if pool is enabled
  let profitPoolService: ProfitPoolService | undefined;
  if (strategyConfig.pool?.enabled) {
    profitPoolService = new ProfitPoolService(
      supabase,
      strategyConfig.pool,
      tradingClient,
    );
  }

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
    profitPoolService, // Pass profit pool service if available
  );

  const strategyPauseMechanism = new StrategyPauseMechanism(
    supabase,
    cycleStateManager,
  );

  // Historical candles use market data client (mainnet in hybrid mode)
  const historicalCandleManager = new HistoricalCandleManager(
    marketDataClient,
    "BTCUSDT",
    strategyConfig.timeframe,
    {
      maxCandles: strategyConfig.athWindow,
    },
  );

  // WebSocket always uses mainnet for real-time market data
  const webSocketManager = new WebSocketManager({
    symbol: "BTCUSDT",
    timeframe: strategyConfig.timeframe,
    testnet: false,
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

  // Order placers use trading client (testnet in hybrid mode)
  const buyOrderPlacer = new BuyOrderPlacer(
    tradingClient,
    tradingRules,
    supabase,
    "BTCUSDT",
    strategyConfig,
  );

  const sellOrderPlacer = new SellOrderPlacer(
    tradingClient,
    tradingRules,
    supabase,
    "BTCUSDT",
    strategyConfig,
    profitPoolService, // Pass profit pool service if available
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
    binanceClient: tradingClient, // Use trading client for order operations
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
    const modeLabel = isHybridTestMode
      ? "🧪 HYBRID TEST MODE"
      : "🚀 PRODUCTION MODE";
    console.log(`${modeLabel}: Starting BTC Trading Bot (Multi-Config)...`);

    // Create shared dependencies
    const shared = await createSharedDependencies();

    // Load all active strategy configs with validation
    // Use INITIAL_CAPITAL_USDT from .env as the capital pool for percentage calculations
    const capitalPool = parseFloat(process.env.INITIAL_CAPITAL_USDT || "3000");

    const strategyConfigs =
      await shared.strategyConfigLoader.loadAllActiveConfigs(capitalPool);

    // Load pool configuration from database and attach to strategy configs
    const poolConfig = await loadPoolConfigFromDatabase(shared.supabase);
    if (poolConfig) {
      // Attach pool config to each strategy config
      for (const config of strategyConfigs) {
        config.pool = poolConfig;
      }
      console.log("💰 Profit Pool ENABLED");
      console.log(
        `   - Reinvestment: ${poolConfig.reinvestmentPercentage}% | Funding: ${poolConfig.fundingWalletPercentage}%`,
      );
      console.log(
        `   - Min funding transfer: $${poolConfig.minFundingTransferAmount}`,
      );
    } else {
      console.log("💰 Profit Pool: disabled");
    }

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

    const successLabel = isHybridTestMode
      ? "✅ BTC Trading Bot started in HYBRID TEST MODE"
      : "✅ BTC Trading Bot started successfully";
    console.log(`${successLabel} with ${pool.getCount()} active config(s)!`);
    if (isHybridTestMode) {
      console.log("   📊 Market data: MAINNET (real prices)");
      console.log("   💰 Trading: TESTNET (paper money)");
    }

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
