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
import type { StrategyPauseMechanism } from "../cycle/strategy-pause-mechanism";
import type { DiscordNotifier } from "../notifications/discord-notifier";
import type { EventLogger } from "../monitoring/event-logger";
import type { BalanceManager } from "../exchange/balance-manager";
import type { ConnectionManager } from "../database/connection-manager";
import type { StateTransactionManager } from "../cycle/state-transaction-manager";
import type { ReferencePriceCalculator } from "../cycle/reference-price-calculator";
import type { BuyAmountCalculator } from "../cycle/buy-amount-calculator";
import type { StrategyConfig } from "../config/strategy-config-loader";
import { StartupValidator } from "./startup-validator";
import type { StartupValidatorConfig } from "./startup-validator";
import type { BinanceClient } from "../exchange/binance-client";
import type { ValidationError } from "../types/validation";
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
  strategyPauseMechanism: StrategyPauseMechanism;
  discordNotifier?: DiscordNotifier;
  eventLogger: EventLogger;
  balanceManager: BalanceManager;
  connectionManager: ConnectionManager;
  stateTransactionManager: StateTransactionManager;
  referencePriceCalculator: ReferencePriceCalculator;
  buyAmountCalculator: BuyAmountCalculator;
  strategyConfig: StrategyConfig; // Now required - passed from pool
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
  private strategyConfig: StrategyConfig; // Now always defined from config
  private startupValidator?: StartupValidator;
  private componentRefs: WeakMap<object, boolean> = new WeakMap();
  private errorObjects: Error[] = [];
  private maxErrorObjects = 100;
  private staleCandleAlertSent = false;
  private recoveryAttempts = 0;
  private maxRecoveryAttempts = 3;

  constructor(config: OrchestratorConfig) {
    super();
    this.setMaxListeners(20); // Set reasonable limit for event listeners
    this.config = config;
    this.strategyConfig = config.strategyConfig; // Set from config

    // Store component references for memory management
    this.componentRefs.set(config.webSocketManager, true);
    this.componentRefs.set(config.candleProcessor, true);
    this.componentRefs.set(config.cycleStateManager, true);
    this.health = {
      status: "healthy",
      lastCandleProcessed: null,
      candlesProcessed: 0,
      errorsCount: 0,
      memoryUsage: this.getMemoryStats(),
      uptime: 0,
      isProcessing: false,
    };
    this.performanceMetrics = {
      averageProcessingTime: 0,
      lastProcessingTime: 0,
      slowProcessingCount: 0,
      totalProcessingTime: 0,
      candlesProcessed: 0,
    };
  }

  /**
   * Initialize the orchestrator with all required components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn("Orchestrator already initialized", {
        configId: this.strategyConfig.id,
        timeframe: this.strategyConfig.timeframe,
      });
      return;
    }

    logger.info("🚀 Initializing Main Orchestrator", {
      configId: this.strategyConfig.id,
      timeframe: this.strategyConfig.timeframe,
    });

    try {
      // Ensure database connection
      await this.config.connectionManager.connect();
      logger.info("Strategy configuration loaded", {
        maxPurchases: this.strategyConfig.maxPurchases,
        dropPercentage: this.strategyConfig.dropPercentage,
        risePercentage: this.strategyConfig.risePercentage,
        athWindow: this.strategyConfig.athWindow,
      });

      // Initialize startup validator
      const validatorConfig: StartupValidatorConfig = {
        supabaseClient: this.config.supabaseClient,
        binanceClient: this.config.binanceClient,
        balanceManager: this.config.balanceManager,
        discordNotifier: this.config.discordNotifier,
        cycleStateManager: this.config.cycleStateManager,
        // strategyConfigLoader omitted - validation done in bootstrap for multi-config
      };
      this.startupValidator = new StartupValidator(validatorConfig);

      // Initialize historical candle manager with configured window
      logger.info(
        `Fetching historical candles for ATH calculation (window: ${this.strategyConfig.athWindow} candles)`,
      );
      await this.config.historicalCandleManager.initialize();
      const stats = this.config.historicalCandleManager.getStatistics();
      logger.info(`Historical candles loaded: ${stats.candleCount} candles`);

      // Initialize cycle state manager
      await this.config.cycleStateManager.initialize();

      // Log current cycle state
      const cycleState = await this.config.cycleStateManager.getCurrentState();
      if (cycleState) {
        logger.info("Cycle state loaded", {
          id: cycleState.id,
          status: cycleState.status,
          capitalAvailable: cycleState.capital_available,
          btcAccumulated: cycleState.btc_accumulated,
          purchasesRemaining: cycleState.purchases_remaining,
          athReferencePrice: cycleState.ath_reference_price,
          sellReferencePrice: cycleState.sell_reference_price,
          buyAmount: cycleState.buy_amount,
        });
      }

      // Check if strategy is paused
      const isPaused = this.config.strategyPauseMechanism?.isPausedStatus();
      if (isPaused) {
        logger.warn("Strategy is currently paused. Starting in paused mode.");
        this.emit("strategyPaused");
      }

      // Initialize health monitoring if enabled
      if (this.config.enableHealthMonitoring) {
        this.initializeHealthMonitoring();
      }

      this.setupEventListeners();
      this.isInitialized = true;

      logger.info("✅ Main Orchestrator initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize orchestrator", error);
      throw error;
    }
  }

  /**
   * Start the orchestrator and begin processing
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Orchestrator must be initialized before starting");
    }

    if (this.isRunning) {
      logger.warn("Orchestrator is already running");
      return;
    }

    try {
      logger.info("▶️ Starting Main Orchestrator");

      // Run startup validation
      if (this.startupValidator) {
        const validationReport = await this.startupValidator.validate();
        if (!validationReport.overallSuccess) {
          const errors = validationReport.configuration.errors
            .concat(validationReport.connectivity.errors)
            .concat(validationReport.balance.errors)
            .map((e: ValidationError) => e.message);
          logger.error("Startup validation failed", validationReport);
          throw new Error(`Startup validation failed: ${errors.join(", ")}`);
        }
        logger.info("✅ Startup validation passed");
      }

      // Connect WebSocket
      logger.info("Connecting WebSocket");
      this.config.webSocketManager.connect();

      // Wait for WebSocket to be connected
      let retries = 0;
      while (!this.config.webSocketManager.isConnected() && retries < 30) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        retries++;
      }

      if (!this.config.webSocketManager.isConnected()) {
        throw new Error("Failed to connect WebSocket after 3 seconds");
      }

      // Bot only processes real-time candles, not historical ones for trading decisions

      this.isRunning = true;
      logger.info("✅ Main Orchestrator started successfully");
    } catch (error) {
      logger.error("Failed to start orchestrator", error);
      throw error;
    }
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn("Orchestrator is not running");
      return;
    }

    logger.info("⏹️ Stopping Main Orchestrator");

    this.isRunning = false;

    // Stop health monitoring
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Wait for current processing to complete
    while (this.isProcessingCandle) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Clear any queued candles
    this.processingQueue = [];

    // Remove all event listeners
    this.removeAllEventListeners();

    // Cleanup memory
    this.cleanupMemory();

    logger.info("✅ Main Orchestrator stopped");
  }

  /**
   * Main candle processing logic - follows STRATEGY.md execution order
   */
  private async onCandleClose(candle: CandleData): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Check if strategy is paused before processing
    if (this.config.strategyPauseMechanism?.isPausedStatus()) {
      return;
    }

    // Prevent concurrent processing
    if (this.isProcessingCandle) {
      this.processingQueue.push(candle);
      return;
    }

    this.isProcessingCandle = true;
    this.health.isProcessing = true;
    const startTime = Date.now();

    try {
      await this.processCandleClose(candle);

      // Update performance metrics
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics(processingTime);

      // Process queued candles if any
      while (this.processingQueue.length > 0) {
        const queuedCandle = this.processingQueue.shift();
        if (queuedCandle) {
          await this.processCandleClose(queuedCandle);
        }
      }
    } catch (error) {
      logger.error("Error processing candle", error);
      this.health.errorsCount++;
      this.handleProcessingError(error as Error);
    } finally {
      this.isProcessingCandle = false;
      this.health.isProcessing = false;
    }
  }

  /**
   * Process a single candle close event
   * CRITICAL: This follows STRATEGY.md execution order exactly
   */
  private async processCandleClose(candle: CandleData): Promise<void> {
    const closePrice =
      typeof candle.close === "string"
        ? parseFloat(candle.close)
        : candle.close;

    // Get current state
    const state = await this.config.cycleStateManager.getCurrentState();
    if (!state) {
      throw new Error("No cycle state available");
    }

    // Add the current candle to the historical candle manager's rolling window
    // This ensures ATH calculation includes the latest price
    this.config.historicalCandleManager.addCandle(candle);

    // Calculate current ATH regardless of holding status
    const currentATH = this.config.historicalCandleManager.calculateATH({
      excludeUnclosed: true,
    });

    // Check if ATH has actually changed from the stored value
    const previousStoredATH = state.ath_price || 0;
    const athChanged = currentATH > previousStoredATH && currentATH > 0;

    // Convert state to mutable copy we can work with
    const workingState: CycleState = { ...state };

    // Set cycle ID for order placers so trades get saved with correct association
    this.config.buyOrderPlacer.setCycleId(workingState.id);
    this.config.sellOrderPlacer.setCycleId(workingState.id);

    try {
      // ===============================================================
      // STEP 1: Update ATH (always track, but only update reference when not holding meaningful BTC)
      // ===============================================================
      // Check if we're holding meaningful BTC (not just dust)
      const tradingRules = this.config.sellOrderStateUpdater.getTradingRules();
      await tradingRules.getRules("BTCUSDT"); // Ensure rules are cached
      const isDust = tradingRules.isDust(
        workingState.btc_accumulated || 0,
        "BTCUSDT",
      );
      const shouldUpdateReferencePrice =
        !workingState.btc_accumulated ||
        workingState.btc_accumulated === 0 ||
        isDust;

      // Always update ATH price in state
      if (currentATH > 0) {
        const previousStoredATH = workingState.ath_price || 0;
        workingState.ath_price = currentATH;

        // Update ATH reference price only if not holding meaningful BTC (for first buy trigger)
        if (shouldUpdateReferencePrice) {
          workingState.ath_reference_price = currentATH;
        }

        // Always persist ATH to database (can go up or down with rolling window)
        await this.config.stateTransactionManager.updateStateAtomic(
          workingState.id,
          {
            ath_price: currentATH,
            ath_reference_price: shouldUpdateReferencePrice
              ? currentATH
              : workingState.ath_reference_price,
          },
        );

        // Log event only when ATH increases (for notifications/events)
        if (athChanged) {
          const candleCount =
            this.config.historicalCandleManager.getStatistics().candleCount;
          await this.config.eventLogger.queueEvent({
            event_type: "ATH_UPDATED",
            severity: "INFO",
            message: `ATH updated from ${previousStoredATH.toFixed(2)} to ${currentATH.toFixed(2)}`,
            metadata: {
              old_ath: previousStoredATH,
              new_ath: currentATH,
              candle_count: candleCount,
              window_size: this.strategyConfig?.athWindow || 20,
              is_holding: !shouldUpdateReferencePrice,
              btc_amount: workingState.btc_accumulated || 0,
            },
          });
        }
      }

      // ===============================================================
      // Log candle close with trading status
      // ===============================================================
      const dropPct = this.strategyConfig?.dropPercentage || 0.003;
      const risePct = this.strategyConfig?.risePercentage || 0.005;

      // Calculate buy target based on current reference
      // For first buy: ATH * (1 - drop), for subsequent: depends on p_last_buy or sell_reference
      const buyReferencePrice =
        workingState.p_last_buy ||
        workingState.sell_reference_price ||
        workingState.ath_reference_price ||
        currentATH;
      const buyTarget = buyReferencePrice * (1 - dropPct);

      // Calculate sell target (only meaningful if holding)
      const sellTarget = workingState.sell_reference_price
        ? workingState.sell_reference_price * (1 + risePct)
        : null;

      logger.info(
        `[${this.strategyConfig.timeframe}] 📊 Candle close: ${closePrice.toFixed(2)}`,
        {
          close: closePrice.toFixed(2),
          ath: currentATH.toFixed(2),
          buyTarget: buyTarget.toFixed(2),
          sellTarget: sellTarget?.toFixed(2) || "N/A",
          purchasesLeft: workingState.purchases_remaining,
          btcHeld: (workingState.btc_accumulated || 0).toFixed(8),
        },
      );

      // ===============================================================
      // STEP 2: Check SELL condition FIRST (only if holding meaningful BTC, not dust)
      // ===============================================================
      if (
        workingState.btc_accumulated &&
        workingState.btc_accumulated > 0 &&
        !isDust
      ) {
        const sellDecision =
          await this.config.sellTriggerDetector.checkSellTrigger(
            {
              status: workingState.status as "READY" | "HOLDING" | "PAUSED",
              sell_reference_price: workingState.sell_reference_price,
              btc_accumulated: workingState.btc_accumulated || 0,
              purchases_remaining: workingState.purchases_remaining,
              capital_available: workingState.capital_available,
            },
            {
              risePercentage: this.strategyConfig?.risePercentage || 0.005,
              dropPercentage: this.strategyConfig?.dropPercentage || 0.003,
              exchangeMinNotional: 10,
            },
            {
              close: closePrice,
              high: closePrice,
              low: closePrice,
              open: closePrice,
              volume: 0,
              timestamp: Date.now(),
            },
            {
              usdtSpot: workingState.capital_available,
              btcSpot: workingState.btc_accumulated || 0,
            },
          );

        if (sellDecision.shouldSell) {
          logger.info(
            `[${this.strategyConfig.timeframe}] ✅ SELL CONDITION MET at ${closePrice}`,
            {
              btc_accumulated: workingState.btc_accumulated || 0,
              reason: sellDecision.reason,
            },
          );

          const sellOrderResult = await this.config.sellOrderPlacer.placeOrder(
            new Decimal(workingState.btc_accumulated),
            new Decimal(closePrice),
            new Decimal(this.strategyConfig?.slippageSellPct || 0.003),
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
              ath_reference_price: workingState.ath_reference_price || 0,
              sell_reference_price: workingState.sell_reference_price || 0,
              updated_at: workingState.updated_at || new Date().toISOString(),
            };
            const updateResult =
              await this.config.sellOrderStateUpdater.updateAfterSellOrder(
                normalizedState,
                sellOrderResult,
                this.strategyConfig?.risePercentage,
                this.strategyConfig?.initialCapitalUsdt,
              );

            // Check if this is a cycle completion signal
            if (
              "type" in updateResult &&
              updateResult.type === "CREATE_NEW_CYCLE"
            ) {
              logger.info(
                `[${this.strategyConfig.timeframe}] 🔄 CYCLE COMPLETED - profit: ${updateResult.completionData.finalProfit.toFixed(2)} USDT`,
                {
                  previousCycleId: updateResult.previousCycleId,
                  carryOverCapital:
                    updateResult.completionData.carryOverCapital,
                },
              );

              // Create new cycle
              const previousState = workingState;
              const newCycle =
                await this.config.cycleStateManager.createNewCycleAfterCompletion(
                  previousState,
                  updateResult.completionData,
                );

              // Log event
              await this.config.eventLogger.queueEvent({
                event_type: "CYCLE_COMPLETE",
                severity: "INFO",
                message: `Cycle ${updateResult.previousCycleId} completed with profit: ${updateResult.completionData.finalProfit}`,
                metadata: {
                  previous_cycle_id: updateResult.previousCycleId,
                  new_cycle_id: newCycle.id,
                  profit: updateResult.completionData.finalProfit,
                  carry_over_capital:
                    updateResult.completionData.carryOverCapital,
                  carry_over_dust: updateResult.completionData.carryOverDust,
                },
              });
            }

            // Log sell event
            await this.config.eventLogger.queueEvent({
              event_type: "SELL_EXECUTED",
              severity: "INFO",
              message: `Sell executed at ${sellOrderResult.avgPrice}`,
              metadata: {
                price: sellOrderResult.avgPrice.toNumber(),
                quantity: sellOrderResult.executedQty.toNumber(),
                remaining_btc:
                  ("btc_accumulated" in updateResult
                    ? updateResult.btc_accumulated
                    : 0) || 0,
              },
            });
          }
        }
      }

      // ===============================================================
      // STEP 3: Check BUY condition (if not holding or only dust)
      // ===============================================================
      if (workingState.purchases_remaining > 0) {
        const buyDecision =
          await this.config.buyTriggerDetector.checkBuyTrigger(
            {
              status: workingState.status as "READY" | "HOLDING" | "PAUSED",
              ath_reference_price: workingState.ath_reference_price,
              sell_reference_price: workingState.sell_reference_price,
              purchases_remaining: workingState.purchases_remaining,
              capital_available: workingState.capital_available,
              buy_amount: workingState.buy_amount,
              buy_anchor_price: workingState.buy_anchor_price || null,
              btc_accumulated: workingState.btc_accumulated || 0,
              btc_dust: workingState.btc_dust || 0,
              buy_grid: workingState.buy_grid,
              buy_index: workingState.buy_index || 0,
              // GeomModified-only: p_last_buy for dynamic threshold anchoring
              p_last_buy: workingState.p_last_buy,
            },
            {
              dropPercentage: this.strategyConfig?.dropPercentage || 0.003,
              risePercentage: this.strategyConfig?.risePercentage || 0.005,
              maxPurchases: this.strategyConfig?.maxPurchases || 10,
              minBuyUSDT: this.strategyConfig?.minBuyUsdt || 10,
              exchangeMinNotional: 10,
            },
            {
              close: closePrice,
              high: closePrice,
              low: closePrice,
              open: closePrice,
              volume: 0,
              timestamp: Date.now(),
            },
            {
              usdtSpot: workingState.capital_available,
              btcSpot: workingState.btc_accumulated || 0,
            },
          );

        if (buyDecision.shouldBuy) {
          // Use the calculated buy amount from the trigger detector
          // This handles multi-level grid crossings correctly (combined amount)
          const buyUsdtAmount =
            buyDecision.buyAmount || workingState.buy_amount || 100;

          logger.info(
            `[${this.strategyConfig.timeframe}] ✅ BUY CONDITION MET at ${closePrice} for ${buyUsdtAmount} USDT`,
            {
              reason: buyDecision.reason,
              levels_triggered: buyDecision.levelsTriggered || 1,
            },
          );

          const buyOrderResult = await this.config.buyOrderPlacer.placeOrder(
            new Decimal(buyUsdtAmount),
            new Decimal(closePrice),
            this.strategyConfig?.slippageBuyPct || 0.003,
          );

          if (buyOrderResult.executedQty.gt(0)) {
            // Update state after buy (include the grid that was built)
            const normalizedState = {
              ...workingState,
              id: workingState.id,
              status: workingState.status as "READY" | "HOLDING" | "PAUSED",
              ath_price: workingState.ath_price || 0,
              btc_accum_net: workingState.btc_accum_net || 0,
              btc_accumulated: workingState.btc_accumulated || 0,
              buy_amount: workingState.buy_amount || 0,
              buy_grid: buyDecision.newGrid || workingState.buy_grid, // Include the newly built grid
              buy_index: buyDecision.newBuyIndex || workingState.buy_index || 0,
              buy_anchor_price: workingState.buy_anchor_price,
              capital_available: workingState.capital_available,
              cost_accum_usdt: workingState.cost_accum_usdt || 0,
              purchases_remaining: workingState.purchases_remaining,
              ath_reference_price: workingState.ath_reference_price || 0,
              sell_reference_price: workingState.sell_reference_price || 0,
              updated_at: workingState.updated_at || new Date().toISOString(),
            };
            const updatedState =
              await this.config.buyOrderStateUpdater.updateAfterBuyOrder(
                normalizedState,
                buyOrderResult,
                buyDecision.levelsTriggered || 1,
                this.strategyConfig?.maxPurchases,
                this.strategyConfig?.risePercentage,
                this.strategyConfig?.dropPercentage,
                this.strategyConfig?.buyMode,
              );

            logger.info(
              `[${this.strategyConfig.timeframe}] Buy executed: ${updatedState.btc_accumulated?.toFixed(8)} BTC (${updatedState.purchases_remaining} purchases left)`,
            );

            // Log buy event
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
    // Remove existing listeners first to allow safe re-attachment
    // This enables recovery after connectivity issues
    this.config.candleProcessor.removeAllListeners("candle_closed");
    this.config.webSocketManager.removeAllListeners("reconnected");

    // Listen for candle close events
    this.config.candleProcessor.on("candle_closed", (candle: CandleData) => {
      this.onCandleClose(candle).catch((error) => {
        logger.error("Error in candle close handler", error);
      });
    });

    // Listen for WebSocket reconnection
    this.config.webSocketManager.on("reconnected", () => {
      logger.info("WebSocket reconnected, waiting for next real-time candle");
      // Reset stale alert flag on successful reconnection
      this.staleCandleAlertSent = false;
      this.recoveryAttempts = 0;
    });

    // Setup graceful shutdown handlers (only once)
    // Note: process event handlers should not be duplicated
    process.off("SIGTERM", this.boundShutdownHandler);
    process.off("SIGINT", this.boundShutdownHandler);
    process.on("SIGTERM", () => this.handleShutdown("SIGTERM"));
    process.on("SIGINT", () => this.handleShutdown("SIGINT"));
  }

  // Handler reference for cleanup
  private boundShutdownHandler = () => {};

  private removeAllEventListeners(): void {
    this.config.candleProcessor.removeAllListeners();
    this.config.webSocketManager.removeAllListeners();
    this.removeAllListeners();
  }

  /**
   * Attempt to recover from stale candle processing
   * This reconnects WebSocket and re-attaches event listeners
   */
  private async attemptRecovery(): Promise<void> {
    if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
      logger.error(
        `Max recovery attempts (${this.maxRecoveryAttempts}) reached. Manual intervention required.`,
        { timeframe: this.strategyConfig.timeframe },
      );

      // Send critical Discord alert
      if (this.config.discordNotifier) {
        try {
          await this.config.discordNotifier.sendAlert(
            `CRITICAL: Bot Recovery Failed for ${this.strategyConfig.timeframe}. Manual restart required.`,
            "critical",
            [
              {
                name: "Timeframe",
                value: this.strategyConfig.timeframe,
                inline: true,
              },
              {
                name: "Recovery Attempts",
                value: `${this.recoveryAttempts}/${this.maxRecoveryAttempts}`,
                inline: true,
              },
              {
                name: "Action Required",
                value: "Manual restart needed",
                inline: false,
              },
            ],
          );
        } catch (notifyError) {
          logger.error("Failed to send critical alert", { error: notifyError });
        }
      }

      this.emit("criticalFailure", new Error("Max recovery attempts reached"));
      return;
    }

    this.recoveryAttempts++;
    logger.warn(
      `Attempting recovery (${this.recoveryAttempts}/${this.maxRecoveryAttempts})`,
      { timeframe: this.strategyConfig.timeframe },
    );

    try {
      // 1. Disconnect WebSocket
      logger.info("Recovery: Disconnecting WebSocket...");
      this.config.webSocketManager.disconnect();

      // Wait a moment before reconnecting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 2. Re-setup event listeners (this removes old ones first)
      logger.info("Recovery: Re-attaching event listeners...");
      this.setupEventListeners();

      // 3. Reconnect WebSocket
      logger.info("Recovery: Reconnecting WebSocket...");
      this.config.webSocketManager.connect();

      // Wait for WebSocket to be connected
      let retries = 0;
      while (!this.config.webSocketManager.isConnected() && retries < 30) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        retries++;
      }

      if (this.config.webSocketManager.isConnected()) {
        logger.info("Recovery successful: WebSocket reconnected", {
          timeframe: this.strategyConfig.timeframe,
        });

        // Send recovery success notification
        if (this.config.discordNotifier) {
          try {
            await this.config.discordNotifier.sendAlert(
              `Bot Recovery Successful for ${this.strategyConfig.timeframe}`,
              "info",
              [
                {
                  name: "Timeframe",
                  value: this.strategyConfig.timeframe,
                  inline: true,
                },
                {
                  name: "Attempt",
                  value: `${this.recoveryAttempts}`,
                  inline: true,
                },
              ],
            );
          } catch (notifyError) {
            logger.warn("Failed to send recovery success notification", {
              error: notifyError,
            });
          }
        }

        // Reset counters on successful recovery
        this.staleCandleAlertSent = false;
      } else {
        throw new Error("WebSocket failed to reconnect after 3 seconds");
      }
    } catch (error) {
      logger.error("Recovery attempt failed", {
        error,
        attempt: this.recoveryAttempts,
        timeframe: this.strategyConfig.timeframe,
      });

      // Will retry on next health check if under max attempts
    }
  }

  private async handleShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, initiating graceful shutdown`);
    await this.stop();
    process.exit(0);
  }

  private initializeHealthMonitoring(): void {
    const interval = this.config.healthCheckInterval || 60000; // Default 1 minute
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, interval);

    logger.info(`Health monitoring initialized with ${interval}ms interval`);
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

    // Check for stale data (timeframe-aware threshold)
    if (this.health.lastCandleProcessed) {
      const timeSinceLastCandle = now - this.health.lastCandleProcessed;
      // Set threshold based on timeframe (2x candle interval + buffer)
      const thresholdMs = this.getStaleDataThreshold();

      if (timeSinceLastCandle > thresholdMs) {
        this.health.status = "degraded";
        const staleMinutes = Math.round(timeSinceLastCandle / 1000 / 60);

        logger.warn("No candles processed recently", {
          timeframe: this.strategyConfig.timeframe,
          timeSinceLastCandle: staleMinutes,
          thresholdMinutes: Math.round(thresholdMs / 1000 / 60),
        });

        // Send Discord alert (only once per incident)
        if (!this.staleCandleAlertSent && this.config.discordNotifier) {
          this.staleCandleAlertSent = true;
          this.config.discordNotifier
            .sendAlert(
              `Stale Data Alert: No candles processed for ${staleMinutes} minutes`,
              "warning",
              [
                {
                  name: "Timeframe",
                  value: this.strategyConfig.timeframe,
                  inline: true,
                },
                {
                  name: "Minutes Since Last Candle",
                  value: `${staleMinutes}`,
                  inline: true,
                },
                {
                  name: "Status",
                  value: "Attempting auto-recovery...",
                  inline: false,
                },
              ],
            )
            .catch((err: Error) => {
              logger.error("Failed to send stale data alert", { error: err });
            });
        }

        // If critically stale (3x threshold), attempt auto-recovery
        if (timeSinceLastCandle > thresholdMs * 3) {
          this.health.status = "unhealthy";
          logger.error(
            "Critical: No candles for 3x threshold, attempting recovery",
            {
              timeframe: this.strategyConfig.timeframe,
              staleMinutes,
            },
          );
          // Run recovery async (don't block health check)
          this.attemptRecovery().catch((err) => {
            logger.error("Recovery failed in health check", { error: err });
          });
        }
      } else {
        // Reset alert flag when candles are processing normally
        if (this.staleCandleAlertSent) {
          this.staleCandleAlertSent = false;
          this.recoveryAttempts = 0;
        }
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

    // Emit health update
    this.emit("healthUpdate", this.health);
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

  /**
   * Get timeframe-aware threshold for stale data detection
   * Returns milliseconds - candles should arrive within 2x their interval
   */
  private getStaleDataThreshold(): number {
    const timeframeMs: Record<string, number> = {
      "1m": 1 * 60 * 1000,
      "5m": 5 * 60 * 1000,
      "15m": 15 * 60 * 1000,
      "1h": 60 * 60 * 1000,
      "4h": 4 * 60 * 60 * 1000,
      "1d": 24 * 60 * 60 * 1000,
      "1w": 7 * 24 * 60 * 60 * 1000,
    };

    const interval =
      timeframeMs[this.strategyConfig.timeframe] || 5 * 60 * 1000;
    // Allow 2x the candle interval before warning (e.g., 1h = 2 hours, 1d = 2 days)
    return interval * 2;
  }

  private updateHealthStatus(): void {
    const now = Date.now();
    const timeSinceLastCandle = this.health.lastCandleProcessed
      ? now - this.health.lastCandleProcessed
      : Infinity;

    // Update memory usage
    this.health.memoryUsage = this.getMemoryStats();

    // Update uptime
    this.health.uptime = now - this.startTime;

    // Determine health status (timeframe-aware)
    const degradedThreshold = this.getStaleDataThreshold();
    const unhealthyThreshold = degradedThreshold * 2;

    if (timeSinceLastCandle > unhealthyThreshold) {
      this.health.status = "unhealthy";
    } else if (timeSinceLastCandle > degradedThreshold) {
      this.health.status = "degraded";
    } else if (this.health.errorsCount > 10) {
      this.health.status = "degraded";
    } else {
      this.health.status = "healthy";
    }

    // Emit health update
    this.emit("healthUpdate", this.health);
  }

  private updatePerformanceMetrics(processingTime: number): void {
    this.performanceMetrics.lastProcessingTime = processingTime;
    this.performanceMetrics.candlesProcessed++;
    this.performanceMetrics.totalProcessingTime += processingTime;
    this.performanceMetrics.averageProcessingTime =
      this.performanceMetrics.totalProcessingTime /
      this.performanceMetrics.candlesProcessed;

    if (processingTime > 1000) {
      // More than 1 second is slow
      this.performanceMetrics.slowProcessingCount++;
      logger.warn(`Slow candle processing: ${processingTime}ms`);
    }
  }

  private handleProcessingError(error: Error): void {
    // Store error for debugging
    this.errorObjects.push(error);

    // Limit error object storage
    if (this.errorObjects.length > this.maxErrorObjects) {
      this.errorObjects = this.errorObjects.slice(-this.maxErrorObjects);
    }

    // Emit error event
    this.emit("processingError", error);

    // Update health status
    this.updateHealthStatus();
  }

  private getMemoryStats(): OrchestratorMemoryStats {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
    };
  }

  public getHealth(): OrchestratorHealth {
    return { ...this.health };
  }

  public getPerformanceMetrics(): OrchestratorPerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  public isHealthy(): boolean {
    return this.health.status === "healthy";
  }

  public getStatus(): {
    initialized: boolean;
    running: boolean;
    processing: boolean;
    queueLength: number;
    health: OrchestratorHealth;
    performance: OrchestratorPerformanceMetrics;
  } {
    return {
      initialized: this.isInitialized,
      running: this.isRunning,
      processing: this.isProcessingCandle,
      queueLength: this.processingQueue.length,
      health: this.getHealth(),
      performance: this.getPerformanceMetrics(),
    };
  }
}
