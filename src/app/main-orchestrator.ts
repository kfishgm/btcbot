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
import type {
  StrategyConfigLoader,
  StrategyConfig,
} from "../config/strategy-config-loader";
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
  private startupValidator?: StartupValidator;
  private componentRefs: WeakMap<object, boolean> = new WeakMap();
  private errorObjects: Error[] = [];
  private maxErrorObjects = 100;

  constructor(config: OrchestratorConfig) {
    super();
    this.setMaxListeners(20); // Set reasonable limit for event listeners
    this.config = config;

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
      logger.warn("Orchestrator already initialized");
      return;
    }

    logger.info("🚀 Initializing Main Orchestrator");

    try {
      // Ensure database connection
      await this.config.connectionManager.connect();

      // Load strategy configuration
      this.strategyConfig = await this.config.strategyConfigLoader.loadConfig();
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
        strategyConfigLoader: this.config.strategyConfigLoader,
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
      logger.debug("Orchestrator not running, skipping candle");
      return;
    }

    // Check if strategy is paused before processing
    if (this.config.strategyPauseMechanism?.isPausedStatus()) {
      logger.info("Strategy is paused, skipping candle processing");
      return;
    }

    // Prevent concurrent processing
    if (this.isProcessingCandle) {
      logger.debug("Already processing a candle, queueing", {
        queueLength: this.processingQueue.length,
      });
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
    logger.debug("Processing candle close", {
      closeTime: new Date(candle.closeTime).toISOString(),
      price: closePrice,
    });

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

    // Log candle close with ATH info
    logger.info(
      `Candle closed. Price: ${closePrice.toFixed(2)}, Window ATH: ${currentATH.toFixed(2)}, Stored ATH: ${previousStoredATH.toFixed(2)}`,
    );

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
          logger.info(
            `Window ATH: ${currentATH.toFixed(2)}, Candle: ${closePrice.toFixed(2)} | ATH Ref updated to ${currentATH.toFixed(2)} (${isDust ? "dust" : "not holding"})`,
          );
        } else {
          // When holding, ATH reference stays as-is, sell reference is used for sell trigger
          logger.info(
            `Window ATH: ${currentATH.toFixed(2)}, Candle: ${closePrice.toFixed(2)} | ATH Ref (frozen): ${workingState.ath_reference_price?.toFixed(2) || "N/A"}, Sell Ref: ${workingState.sell_reference_price?.toFixed(2) || "N/A"} (holding)`,
          );
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
      // STEP 2: Check SELL condition FIRST (only if holding meaningful BTC, not dust)
      // ===============================================================
      if (
        workingState.btc_accumulated &&
        workingState.btc_accumulated > 0 &&
        !isDust
      ) {
        logger.info(
          `Holding ${workingState.btc_accumulated} BTC, checking sell condition`,
        );

        // Calculate sell details for logging
        // Use commission-adjusted formula to match actual sell trigger
        const commissionRate = 0.001; // Default 0.1% commission
        const sellReferencePrice =
          typeof workingState.sell_reference_price === "number"
            ? workingState.sell_reference_price
            : 0;
        const sellTarget = sellReferencePrice
          ? (sellReferencePrice *
              (1 + (this.strategyConfig?.risePercentage || 0.03))) /
            (1 - commissionRate)
          : null;
        const usdtAmount = workingState.btc_accumulated * closePrice;
        const percentAwayFromSell = sellTarget
          ? Math.abs((sellTarget - closePrice) / sellTarget) * 100
          : 0;

        logger.info(
          `Sell check - Amount: ${workingState.btc_accumulated.toFixed(8)} BTC (${usdtAmount.toFixed(2)} USDT), Price: ${closePrice.toFixed(2)}, Target: ${sellTarget?.toFixed(2) || "N/A"}, % Away: ${percentAwayFromSell.toFixed(2)}%`,
        );

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
            `✅ SELL CONDITION MET at ${closePrice} - Placing sell order`,
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
              );

            // Check if this is a cycle completion signal
            if (
              "type" in updateResult &&
              updateResult.type === "CREATE_NEW_CYCLE"
            ) {
              logger.info("🔄 Cycle completed - creating new cycle", {
                previousCycleId: updateResult.previousCycleId,
                profit: updateResult.completionData.finalProfit,
                carryOverCapital: updateResult.completionData.carryOverCapital,
                carryOverDust: updateResult.completionData.carryOverDust,
              });

              // Create new cycle
              const previousState = workingState;
              const newCycle =
                await this.config.cycleStateManager.createNewCycleAfterCompletion(
                  previousState,
                  updateResult.completionData,
                );

              logger.info("New cycle created", {
                cycleId: newCycle.id,
                capital: newCycle.capital_available,
                dust: newCycle.btc_dust,
              });

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
            } else {
              // Normal sell update (partial sale)
              logger.info(
                `Sell order executed - State updated (partial sale)`,
                {
                  btc_remaining:
                    "btc_accumulated" in updateResult
                      ? updateResult.btc_accumulated
                      : 0,
                  capital_available:
                    "capital_available" in updateResult
                      ? updateResult.capital_available
                      : 0,
                },
              );
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
        logger.info(
          `Have ${workingState.purchases_remaining} purchases remaining, checking buy condition`,
        );

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

        // Calculate the buy details for logging
        const buyIndex = workingState.buy_index || 0;
        const currentGridLevel =
          workingState.buy_grid && buyIndex < workingState.buy_grid.length
            ? workingState.buy_grid[buyIndex]
            : null;
        const buyTarget =
          currentGridLevel ||
          (workingState.ath_reference_price
            ? workingState.ath_reference_price *
              (1 - (this.strategyConfig?.dropPercentage || 0.003))
            : null);
        const percentAway = buyTarget
          ? Math.abs((closePrice - buyTarget) / buyTarget) * 100
          : null;
        const purchaseAmount =
          workingState.capital_available / workingState.purchases_remaining;

        logger.info(
          `Buy check - Price: ${closePrice.toFixed(2)}, Grid Level: ${currentGridLevel ? currentGridLevel.toFixed(2) : "N/A"}, Purchase Amount: ${purchaseAmount.toFixed(2)} USDT, Buy Target: ${buyTarget ? buyTarget.toFixed(2) : "N/A"}, % Away: ${percentAway ? percentAway.toFixed(2) : "N/A"}%`,
        );

        if (buyDecision.shouldBuy) {
          const buyUsdtAmount = workingState.buy_amount || 100;

          logger.info(
            `✅ BUY CONDITION MET at ${closePrice} - Placing buy order for ${buyUsdtAmount} USDT`,
            {
              reason: buyDecision.reason,
              grid_level: buyDecision.newBuyIndex,
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
              );

            logger.info(`Buy order executed - State updated`, {
              btc_accumulated: updatedState.btc_accumulated,
              purchases_remaining: updatedState.purchases_remaining,
              sell_reference_price: updatedState.sell_reference_price,
              buy_anchor_price: updatedState.buy_anchor_price,
              grid_level: updatedState.buy_index,
            });

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
    // Listen for candle close events
    this.config.candleProcessor.on("candle_closed", (candle: CandleData) => {
      this.onCandleClose(candle).catch((error) => {
        logger.error("Error in candle close handler", error);
      });
    });

    // Listen for WebSocket reconnection
    this.config.webSocketManager.on("reconnected", () => {
      logger.info("WebSocket reconnected, waiting for next real-time candle");
    });

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

  private updateHealthStatus(): void {
    const now = Date.now();
    const timeSinceLastCandle = this.health.lastCandleProcessed
      ? now - this.health.lastCandleProcessed
      : Infinity;

    // Update memory usage
    this.health.memoryUsage = this.getMemoryStats();

    // Update uptime
    this.health.uptime = now - this.startTime;

    // Determine health status
    if (timeSinceLastCandle > 300000) {
      // No candle in 5 minutes
      this.health.status = "unhealthy";
    } else if (timeSinceLastCandle > 120000) {
      // No candle in 2 minutes
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
