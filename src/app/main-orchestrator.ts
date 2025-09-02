import { EventEmitter } from "events";
import { Decimal } from "decimal.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase";
import type { CandleData } from "../exchange/websocket-types";
import type { WebSocketManager } from "../exchange/websocket-manager";
import type { CandleProcessor } from "../exchange/candle-processor";
import type {
  CycleStateManager,
  CycleState,
} from "../cycle/cycle-state-manager";
import type { HistoricalCandleManager } from "../exchange/historical-candle-manager";
import type { BuyTriggerDetector } from "../cycle/buy-trigger-detector";
import type { SellTriggerDetector } from "../cycle/sell-trigger-detector";
import type { BuyOrderPlacer } from "../order/buy-order-placer";
import type { SellOrderPlacer } from "../order/sell-order-placer";
import type { BuyOrderStateUpdater } from "../cycle/buy-order-state-updater";
import type { SellOrderStateUpdater } from "../cycle/sell-order-state-updater";
import type { DriftDetector } from "../cycle/drift-detector";
import type { StrategyPauseMechanism } from "../cycle/strategy-pause-mechanism";
import type { DiscordNotifier } from "../notifications/discord-notifier";
import type { EventLogger } from "../monitoring/event-logger";
import type { BalanceManager } from "../exchange/balance-manager";
import type { ConnectionManager } from "../database/connection-manager";
import type { StateTransactionManager } from "../cycle/state-transaction-manager";
import type { ReferencePriceCalculator } from "../cycle/reference-price-calculator";
import type { BuyAmountCalculator } from "../cycle/buy-amount-calculator";
import type {
  StrategyConfigLoader,
  StrategyConfig,
} from "../config/strategy-config-loader";
import { StartupValidator } from "./startup-validator";
import type { StartupValidatorConfig } from "./startup-validator";
import type { BinanceClient } from "../exchange/binance-client";
import type { ValidationReport } from "../types/validation";
import { Logger } from "../utils/logger";

const logger = new Logger();

export interface OrchestratorConfig {
  supabaseClient: SupabaseClient<Database>;
  binanceClient: BinanceClient;
  webSocketManager: WebSocketManager;
  candleProcessor: CandleProcessor;
  cycleStateManager: CycleStateManager;
  historicalCandleManager: HistoricalCandleManager;
  buyTriggerDetector: BuyTriggerDetector;
  sellTriggerDetector: SellTriggerDetector;
  buyOrderPlacer: BuyOrderPlacer;
  sellOrderPlacer: SellOrderPlacer;
  buyOrderStateUpdater: BuyOrderStateUpdater;
  sellOrderStateUpdater: SellOrderStateUpdater;
  driftDetector: DriftDetector;
  strategyPauseMechanism: StrategyPauseMechanism;
  discordNotifier?: DiscordNotifier;
  eventLogger: EventLogger;
  balanceManager: BalanceManager;
  connectionManager: ConnectionManager;
  stateTransactionManager: StateTransactionManager;
  referencePriceCalculator: ReferencePriceCalculator;
  buyAmountCalculator: BuyAmountCalculator;
  strategyConfigLoader: StrategyConfigLoader;
  enableHealthMonitoring?: boolean;
  healthCheckInterval?: number;
  memoryThresholdMB?: number;
}

export interface OrchestratorHealth {
  status: "healthy" | "degraded" | "unhealthy";
  lastCandleProcessed: number | null;
  candlesProcessed: number;
  errorsCount: number;
  memoryUsage: OrchestratorMemoryStats;
  uptime: number;
  isProcessing: boolean;
}

export interface OrchestratorMemoryStats {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

export interface OrchestratorPerformanceMetrics {
  averageProcessingTime: number;
  lastProcessingTime: number;
  slowProcessingCount: number;
  totalProcessingTime: number;
  candlesProcessed: number;
}

export class MainOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private isInitialized = false;
  private isRunning = false;
  private isProcessingCandle = false;
  private processingQueue: CandleData[] = [];
  private health: OrchestratorHealth;
  private performanceMetrics: OrchestratorPerformanceMetrics;
  private healthCheckTimer?: NodeJS.Timeout;
  private startTime: number = Date.now();
  private strategyConfig?: StrategyConfig;
  private componentRefs: WeakMap<object, boolean> = new WeakMap();
  private errorObjects: Error[] = [];
  private maxErrorObjects = 100;

  constructor(config: OrchestratorConfig) {
    super();
    this.setMaxListeners(20); // Set reasonable limit for event listeners
    this.config = config;

    // Initialize health status
    this.health = {
      status: "healthy",
      lastCandleProcessed: null,
      candlesProcessed: 0,
      errorsCount: 0,
      memoryUsage: this.getMemoryStats(),
      uptime: 0,
      isProcessing: false,
    };

    // Initialize performance metrics
    this.performanceMetrics = {
      averageProcessingTime: 0,
      lastProcessingTime: 0,
      slowProcessingCount: 0,
      totalProcessingTime: 0,
      candlesProcessed: 0,
    };

    // Store component references for memory management
    this.componentRefs.set(config.webSocketManager, true);
    this.componentRefs.set(config.candleProcessor, true);
    this.componentRefs.set(config.cycleStateManager, true);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error("Orchestrator already initialized");
    }

    try {
      logger.info("Initializing Main Orchestrator...");

      // 1. Run startup validation
      logger.info("Running startup validation...");
      const validationReport = await this.runStartupValidation();

      if (!validationReport.overallSuccess) {
        const errorMessage = this.formatValidationErrors(validationReport);
        logger.error("Startup validation failed", { report: validationReport });
        throw new Error(`Startup validation failed:\n${errorMessage}`);
      }

      if (validationReport.summary.totalWarnings > 0) {
        logger.warn("Startup validation completed with warnings", {
          warnings: validationReport.summary.totalWarnings,
        });
      } else {
        logger.info("Startup validation passed successfully");
      }

      // 2. Ensure database connection
      await this.config.connectionManager.connect();

      // 3. Load strategy configuration
      this.strategyConfig = await this.config.strategyConfigLoader.loadConfig();
      if (!this.strategyConfig) {
        throw new Error("No active strategy configuration found");
      }

      // 4. Initialize cycle state manager
      await this.config.cycleStateManager.initialize();

      // 5. Check if strategy is paused
      const isPaused = this.config.strategyPauseMechanism.isPausedStatus();
      if (isPaused) {
        logger.warn("Strategy is currently paused. Starting in paused mode.");
        this.emit("strategyPaused");
      }

      // 6. Setup event listeners
      this.setupEventListeners();

      // 7. Start health monitoring if enabled
      if (this.config.enableHealthMonitoring) {
        this.startHealthMonitoring();
      }

      this.isInitialized = true;
      logger.info("Main Orchestrator initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize orchestrator", error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Orchestrator must be initialized before starting");
    }

    if (this.isRunning) {
      throw new Error("Orchestrator is already running");
    }

    try {
      logger.info("Starting Main Orchestrator...");

      // Connect WebSocket
      await this.config.webSocketManager.connect();

      // Check for any missed candles and process them
      await this.catchUpMissedCandles();

      this.isRunning = true;
      logger.info("Main Orchestrator started successfully");
    } catch (error) {
      logger.error("Failed to start orchestrator", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info("Stopping Main Orchestrator...");

      // 1. Stop accepting new candles
      this.isRunning = false;

      // 2. Wait for current processing to complete
      while (this.isProcessingCandle) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 3. Current state is already saved in database

      // 4. Disconnect WebSocket
      await this.config.webSocketManager.disconnect();

      // 5. Stop health monitoring
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }

      // 6. Close database connection
      await this.config.connectionManager.disconnect();

      // 7. Clean up event listeners
      this.removeAllEventListeners();

      logger.info("Main Orchestrator stopped successfully");
    } catch (error) {
      logger.error("Error during orchestrator shutdown", error);
      throw error;
    }
  }

  /**
   * Main candle processing handler - FOLLOWS EXACT STRATEGY.md ORDER
   */
  async onCandleClose(candle: CandleData): Promise<void> {
    // Check if we should process
    if (!this.isRunning) {
      return;
    }

    // Check if strategy is paused
    const isPaused = this.config.strategyPauseMechanism.isPausedStatus();
    if (isPaused) {
      logger.warn("Strategy is paused, skipping candle processing");
      return;
    }

    // Queue candle if we're already processing
    if (this.isProcessingCandle) {
      this.processingQueue.push(candle);
      return;
    }

    this.isProcessingCandle = true;
    this.health.isProcessing = true;
    const startTime = Date.now();

    try {
      await this.processCandleWithStrategy(candle);

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics(processingTime);

      // Process queued candles
      while (this.processingQueue.length > 0 && this.isRunning) {
        const nextCandle = this.processingQueue.shift();
        if (nextCandle) {
          await this.processCandleWithStrategy(nextCandle);
        }
      }
    } catch (error) {
      logger.error("Error processing candle", error);
      this.health.errorsCount++;
      this.handleProcessingError(error as Error);
      await this.config.eventLogger.logSystemError(error);
    } finally {
      this.isProcessingCandle = false;
      this.health.isProcessing = false;
    }
  }

  /**
   * Core trading logic following EXACT STRATEGY.md execution order
   */
  private async processCandleWithStrategy(candle: CandleData): Promise<void> {
    const closePrice = parseFloat(candle.close);
    logger.info(`Processing candle close at ${closePrice}`);

    // Get current state
    const state = await this.config.cycleStateManager.getCurrentState();
    if (!state) {
      throw new Error("No cycle state available");
    }

    // Convert state to mutable copy we can work with
    const workingState: CycleState = { ...state };

    try {
      // ===============================================================
      // STEP 1: Update ATH if not holding (btc_accumulated == 0)
      // ===============================================================
      if (!workingState.btc_accumulated || workingState.btc_accumulated === 0) {
        logger.info("Not holding BTC, updating ATH");

        // Calculate ATH from last 20 candles (as per STRATEGY.md)
        const athPrice = this.config.historicalCandleManager.calculateATH({
          excludeUnclosed: true,
        });

        if (athPrice > 0) {
          workingState.ath_price = athPrice;
          workingState.reference_price = athPrice;

          logger.info(`Updated ATH to ${athPrice} from 20 candles`);
          await this.config.eventLogger.queueEvent({
            event_type: "ATH_UPDATED",
            severity: "INFO",
            message: `ATH updated to ${athPrice}`,
            metadata: {
              ath_price: athPrice,
              candle_count: 20,
            },
          });
        }
      }

      // ===============================================================
      // STEP 2: Check SELL condition FIRST (only if holding)
      // ===============================================================
      if (workingState.btc_accumulated && workingState.btc_accumulated > 0) {
        logger.info(
          `Holding ${workingState.btc_accumulated} BTC, checking sell condition`,
        );

        const sellResult =
          await this.config.sellTriggerDetector.checkSellTrigger(
            {
              status: (workingState.status || "READY") as
                | "READY"
                | "HOLDING"
                | "PAUSED",
              reference_price: workingState.reference_price,
              btc_accumulated: workingState.btc_accumulated || 0,
              purchases_remaining: workingState.purchases_remaining,
              capital_available: workingState.capital_available,
            },
            {
              dropPercentage: this.strategyConfig?.dropPercentage || 0.03,
              risePercentage: this.strategyConfig?.risePercentage || 0.03,
              exchangeMinNotional: 10,
              driftThresholdPct: 0.005,
            },
            {
              close: closePrice,
              high: parseFloat(candle.high),
              low: parseFloat(candle.low),
              open: parseFloat(candle.open),
              volume: parseFloat(candle.volume),
              timestamp: candle.eventTime,
            },
            {
              btcSpot: workingState.btc_accumulated,
              usdtSpot: workingState.capital_available,
            },
          );
        const shouldSell = sellResult.shouldSell;

        if (shouldSell) {
          logger.info("SELL condition triggered");

          // Validate BTC balance
          const btcBalanceResult =
            await this.config.balanceManager.getBalance("BTC");
          const btcBalance = btcBalanceResult.free.toNumber();
          if (btcBalance < workingState.btc_accumulated) {
            logger.error(
              `BTC balance mismatch: have ${btcBalance}, expected ${workingState.btc_accumulated}`,
            );
            await this.config.strategyPauseMechanism.pauseStrategy({
              type: "drift_detected",
              message: `BTC balance mismatch: have ${btcBalance}, expected ${workingState.btc_accumulated}`,
              metadata: {
                expected: workingState.btc_accumulated,
                actual: btcBalance,
              },
            });
            return;
          }

          // Check drift
          const drift = await this.config.driftDetector.checkDrift({
            btcAccumulated: workingState.btc_accumulated,
            btcSpotBalance: btcBalance,
            capitalAvailable: workingState.capital_available,
            usdtSpotBalance: (
              await this.config.balanceManager.getBalance("USDT")
            ).free.toNumber(),
          });

          if (drift.overallStatus === "exceeded") {
            logger.error("Drift exceeded threshold", drift);
            await this.config.strategyPauseMechanism.pauseStrategy({
              type: "drift_detected",
              message: "Balance drift exceeded threshold",
              metadata: {
                btcDrift: drift.btc,
                usdtDrift: drift.usdt,
              },
            });
            return;
          }

          // Place sell order for ALL accumulated BTC
          const sellOrderResult = await this.config.sellOrderPlacer.placeOrder(
            new Decimal(workingState.btc_accumulated),
            new Decimal(closePrice),
            new Decimal(workingState.reference_price || closePrice),
            this.strategyConfig?.slippageSellPct || 0.003,
          );

          if (sellOrderResult.executedQty.gt(0)) {
            // Update state after sell
            const normalizedState = {
              ...workingState,
              id: workingState.id,
              status: workingState.status as "READY" | "HOLDING" | "PAUSED",
              ath_price: workingState.ath_price || 0,
              btc_accum_net: workingState.btc_accum_net || 0,
              btc_accumulated: workingState.btc_accumulated || 0,
              buy_amount: workingState.buy_amount || 0,
              capital_available: workingState.capital_available,
              cost_accum_usdt: workingState.cost_accum_usdt || 0,
              purchases_remaining: workingState.purchases_remaining,
              reference_price: workingState.reference_price || 0,
              updated_at: workingState.updated_at || new Date().toISOString(),
            };
            const updatedState =
              (await this.config.sellOrderStateUpdater.updateAfterSellOrder(
                normalizedState as CycleState,
                sellOrderResult,
              )) as CycleState;

            // If completely sold, cycle is reset
            if (
              !updatedState.btc_accumulated ||
              updatedState.btc_accumulated < 0.00000001
            ) {
              const profit = 0; // Profit calculation is done in state updater
              logger.info(`Cycle complete. Profit: ${profit}`);
              if (this.config.discordNotifier) {
                await this.config.discordNotifier.sendAlert(
                  `✅ Cycle complete. Profit: $${profit.toFixed(2)}`,
                  "info",
                );
              }
              await this.config.eventLogger.queueEvent({
                event_type: "CYCLE_COMPLETE",
                severity: "INFO",
                message: `Cycle complete with profit: ${profit}`,
                metadata: {
                  profit: profit,
                  capital_available: updatedState.capital_available,
                },
              });
            }

            // Save state atomically
            await this.config.stateTransactionManager.updateStateAtomic(
              updatedState.id,
              updatedState,
            );
          }
        }
      }

      // ===============================================================
      // STEP 3: Check BUY condition AFTER (only if not at max purchases)
      // ===============================================================
      if (
        workingState.purchases_remaining &&
        workingState.purchases_remaining > 0
      ) {
        logger.info(
          `Have ${workingState.purchases_remaining} purchases remaining, checking buy condition`,
        );

        const buyResult = await this.config.buyTriggerDetector.checkBuyTrigger(
          {
            status: (workingState.status || "READY") as
              | "READY"
              | "HOLDING"
              | "PAUSED",
            reference_price: workingState.reference_price,
            purchases_remaining: workingState.purchases_remaining,
            capital_available: workingState.capital_available,
            buy_amount: workingState.buy_amount,
            btc_accumulated: workingState.btc_accumulated || 0,
          },
          {
            dropPercentage: this.strategyConfig?.dropPercentage || 0.03,
            risePercentage: this.strategyConfig?.risePercentage || 0.03,
            minBuyUSDT: this.strategyConfig?.minBuyUsdt || 10,
            exchangeMinNotional: 10,
            driftThresholdPct: 0.005,
          },
          {
            close: closePrice,
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            open: parseFloat(candle.open),
            volume: parseFloat(candle.volume),
            timestamp: candle.eventTime,
          },
          {
            btcSpot: (
              await this.config.balanceManager.getBalance("BTC")
            ).free.toNumber(),
            usdtSpot: workingState.capital_available,
          },
        );
        const shouldBuy = buyResult.shouldBuy;

        if (shouldBuy) {
          logger.info("BUY condition triggered");

          // Calculate buy amount
          const buyAmount = this.config.buyAmountCalculator.calculateBuyAmount({
            buy_amount: workingState.buy_amount,
            capital_available: workingState.capital_available,
            purchases_remaining: workingState.purchases_remaining,
          });

          // Skip if amount too small
          const minBuy = Math.max(this.strategyConfig?.minBuyUsdt || 10, 10);
          if (buyAmount < minBuy) {
            logger.info(
              `Buy amount ${buyAmount} below minimum ${minBuy}, skipping`,
            );
            return;
          }

          // Validate USDT balance
          const usdtBalanceResult =
            await this.config.balanceManager.getBalance("USDT");
          const usdtBalance = usdtBalanceResult.free.toNumber();
          if (usdtBalance < buyAmount) {
            logger.warn(
              `Insufficient USDT: have ${usdtBalance}, need ${buyAmount}`,
            );
            return;
          }

          // Check drift
          const drift = await this.config.driftDetector.checkDrift({
            btcAccumulated: workingState.btc_accumulated || 0,
            btcSpotBalance: (
              await this.config.balanceManager.getBalance("BTC")
            ).free.toNumber(),
            capitalAvailable: workingState.capital_available,
            usdtSpotBalance: usdtBalance,
          });

          if (drift.overallStatus === "exceeded") {
            logger.error("Drift exceeded threshold", drift);
            await this.config.strategyPauseMechanism.pauseStrategy({
              type: "drift_detected",
              message: "Balance drift exceeded threshold",
              metadata: {
                btcDrift: drift.btc,
                usdtDrift: drift.usdt,
              },
            });
            return;
          }

          // Place buy order
          const buyOrderResult = await this.config.buyOrderPlacer.placeOrder(
            new Decimal(buyAmount),
            new Decimal(closePrice),
            this.strategyConfig?.slippageBuyPct || 0.003,
          );

          if (buyOrderResult.executedQty.gt(0)) {
            // Update state after buy
            const normalizedState = {
              ...workingState,
              id: workingState.id,
              status: workingState.status as "READY" | "HOLDING" | "PAUSED",
              ath_price: workingState.ath_price || 0,
              btc_accum_net: workingState.btc_accum_net || 0,
              btc_accumulated: workingState.btc_accumulated || 0,
              buy_amount: workingState.buy_amount || 0,
              capital_available: workingState.capital_available,
              cost_accum_usdt: workingState.cost_accum_usdt || 0,
              purchases_remaining: workingState.purchases_remaining,
              reference_price: workingState.reference_price || 0,
              updated_at: workingState.updated_at || new Date().toISOString(),
            };
            const updatedState =
              (await this.config.buyOrderStateUpdater.updateAfterBuyOrder(
                normalizedState as CycleState,
                buyOrderResult,
              )) as CycleState;

            // Save state atomically
            await this.config.stateTransactionManager.updateStateAtomic(
              updatedState.id,
              updatedState,
            );

            if (this.config.discordNotifier) {
              await this.config.discordNotifier.sendAlert(
                `📈 Buy executed at ${buyOrderResult.avgPrice.toFixed(2)}`,
                "info",
              );
            }
            await this.config.eventLogger.queueEvent({
              event_type: "BUY_EXECUTED",
              severity: "INFO",
              message: `Buy executed at ${buyOrderResult.avgPrice}`,
              metadata: {
                price: buyOrderResult.avgPrice.toNumber(),
                quantity: buyOrderResult.executedQty.toNumber(),
                remaining: updatedState.purchases_remaining || 0,
              },
            });
          }
        }
      }

      // Update health status
      this.health.lastCandleProcessed = Date.now();
      this.health.candlesProcessed++;
    } finally {
      // Ensure health status is updated even on error
    }
  }

  private setupEventListeners(): void {
    // Listen for candle close events
    this.config.candleProcessor.on("candleClosed", (candle: CandleData) => {
      this.onCandleClose(candle).catch((error) => {
        logger.error("Error in candle close handler", error);
      });
    });

    // Listen for WebSocket reconnection
    this.config.webSocketManager.on("reconnected", () => {
      logger.info("WebSocket reconnected, catching up on missed candles");
      this.catchUpMissedCandles().catch((error) => {
        logger.error("Error catching up missed candles", error);
      });
    });

    // Strategy pause mechanism doesn't emit events, we just check status

    // Setup graceful shutdown handlers
    process.on("SIGTERM", () => this.handleShutdown("SIGTERM"));
    process.on("SIGINT", () => this.handleShutdown("SIGINT"));
  }

  private removeAllEventListeners(): void {
    this.config.candleProcessor.removeAllListeners();
    this.config.webSocketManager.removeAllListeners();
    this.removeAllListeners();
  }

  private async handleShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
      await this.stop();
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown", error);
      process.exit(1);
    }
  }

  private async catchUpMissedCandles(): Promise<void> {
    const state = await this.config.cycleStateManager.getCurrentState();
    if (!state?.updated_at) {
      return;
    }

    const lastUpdate = new Date(state.updated_at).getTime();
    const now = Date.now();
    const timeDiff = now - lastUpdate;

    // If more than 5 minutes since last update, fetch missed candles
    if (timeDiff > 5 * 60 * 1000) {
      // Get candle history and filter for candles after last update
      const allCandles = this.config.historicalCandleManager.getCandleHistory();
      const missedCandles = allCandles.filter(
        (candle) => candle.closeTime > lastUpdate && candle.isClosed,
      );

      if (missedCandles.length > 0) {
        logger.info(`Processing ${missedCandles.length} missed candles`);

        for (const candle of missedCandles) {
          await this.onCandleClose({
            eventTime: candle.closeTime,
            symbol: "BTCUSDT",
            openTime: candle.openTime,
            closeTime: candle.closeTime,
            firstTradeId: 0,
            lastTradeId: 0,
            open: candle.open.toString(),
            high: candle.high.toString(),
            low: candle.low.toString(),
            close: candle.close.toString(),
            volume: candle.volume.toString(),
            numberOfTrades: candle.numberOfTrades || 0,
            isCandleClosed: true,
            quoteAssetVolume: candle.quoteAssetVolume?.toString() || "0",
            takerBuyBaseAssetVolume:
              candle.takerBuyBaseAssetVolume?.toString() || "0",
            takerBuyQuoteAssetVolume:
              candle.takerBuyQuoteAssetVolume?.toString() || "0",
          });
        }
      }
    }
  }

  private startHealthMonitoring(): void {
    const interval = this.config.healthCheckInterval || 60000;

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, interval);
  }

  private performHealthCheck(): void {
    const now = Date.now();

    // Update uptime
    this.health.uptime = now - this.startTime;

    // Check memory usage
    this.health.memoryUsage = this.getMemoryStats();
    const memoryThreshold = this.config.memoryThresholdMB || 500;
    const heapUsedMB = this.health.memoryUsage.heapUsed / 1024 / 1024;

    if (heapUsedMB > memoryThreshold) {
      this.health.status = "unhealthy";
      logger.error(
        `Memory usage exceeded threshold: ${heapUsedMB.toFixed(2)} MB`,
      );
      this.cleanupMemory();
    }

    // Check for stale data
    if (this.health.lastCandleProcessed) {
      const timeSinceLastCandle = now - this.health.lastCandleProcessed;
      if (timeSinceLastCandle > 5 * 60 * 1000) {
        // 5 minutes
        this.health.status = "degraded";
        logger.warn("No candles processed in last 5 minutes");
      }
    }

    // Check error rate
    const errorRate =
      this.health.errorsCount / Math.max(this.health.candlesProcessed, 1);
    if (errorRate > 0.1) {
      // 10% error rate
      this.health.status = "degraded";
      logger.warn(`High error rate: ${(errorRate * 100).toFixed(2)}%`);
    }
  }

  private getMemoryStats(): OrchestratorMemoryStats {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
    };
  }

  private cleanupMemory(): void {
    // Clear old candles from processing queue
    if (this.processingQueue.length > 100) {
      this.processingQueue = this.processingQueue.slice(-50);
    }

    // Clear old error objects
    if (this.errorObjects.length > this.maxErrorObjects) {
      this.errorObjects = this.errorObjects.slice(-50);
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  private updatePerformanceMetrics(processingTime: number): void {
    this.performanceMetrics.lastProcessingTime = processingTime;
    this.performanceMetrics.totalProcessingTime += processingTime;
    this.performanceMetrics.candlesProcessed++;

    // Calculate average
    this.performanceMetrics.averageProcessingTime =
      this.performanceMetrics.totalProcessingTime /
      this.performanceMetrics.candlesProcessed;

    // Track slow processing
    if (processingTime > 1000) {
      // 1 second
      this.performanceMetrics.slowProcessingCount++;
      logger.warn(`Slow candle processing: ${processingTime}ms`);
    }
  }

  private handleProcessingError(error: Error): void {
    // Store error for debugging
    this.errorObjects.push(error);

    // Emit error event
    this.emit("processingError", error);
  }

  // Public getters for monitoring
  getHealth(): OrchestratorHealth {
    return { ...this.health };
  }

  getPerformanceMetrics(): OrchestratorPerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  isHealthy(): boolean {
    return this.health.status === "healthy";
  }

  /**
   * Run startup validation
   */
  private async runStartupValidation(): Promise<ValidationReport> {
    const validatorConfig: StartupValidatorConfig = {
      binanceClient: this.config.binanceClient,
      supabaseClient: this.config.supabaseClient,
      discordNotifier: this.config.discordNotifier,
      balanceManager: this.config.balanceManager,
      cycleStateManager: this.config.cycleStateManager,
      strategyConfigLoader: this.config.strategyConfigLoader,
    };

    const validator = new StartupValidator(validatorConfig);
    const report = await validator.validate();

    // Log the formatted report
    const formattedReport = validator.formatReport(report);
    if (report.overallSuccess) {
      logger.info(`\n${formattedReport}`);
    } else {
      logger.error(`\n${formattedReport}`);
    }

    return report;
  }

  /**
   * Format validation errors for display
   */
  private formatValidationErrors(report: ValidationReport): string {
    const errors: string[] = [];

    if (report.configuration.errors.length > 0) {
      errors.push("Configuration errors:");
      report.configuration.errors.forEach((e) => {
        errors.push(`  - [${e.code}] ${e.message}`);
      });
    }

    if (report.connectivity.errors.length > 0) {
      errors.push("Connectivity errors:");
      report.connectivity.errors.forEach((e) => {
        errors.push(`  - [${e.code}] ${e.message}`);
      });
    }

    if (report.balance.errors.length > 0) {
      errors.push("Balance errors:");
      report.balance.errors.forEach((e) => {
        errors.push(`  - [${e.code}] ${e.message}`);
      });
    }

    return errors.join("\n");
  }
}
