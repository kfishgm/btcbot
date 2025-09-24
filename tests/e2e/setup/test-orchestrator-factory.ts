/**
 * Test Orchestrator Factory
 *
 * Creates a MainOrchestrator with real production components
 * but mocked external services for E2E testing.
 *
 * This ensures tests use the exact same logic as production.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../types/supabase.js";
import { MainOrchestrator } from "../../../src/app/main-orchestrator.js";
import { CandleProcessor } from "../../../src/exchange/candle-processor.js";
import { CycleStateManager } from "../../../src/cycle/cycle-state-manager.js";
import { HistoricalCandleManager } from "../../../src/exchange/historical-candle-manager.js";
import { BuyTriggerDetector } from "../../../src/cycle/buy-trigger-detector.js";
import { SellTriggerDetector } from "../../../src/cycle/sell-trigger-detector.js";
import { BuyOrderPlacer } from "../../../src/order/buy-order-placer.js";
import { SellOrderPlacer } from "../../../src/order/sell-order-placer.js";
import { BuyOrderStateUpdater } from "../../../src/cycle/buy-order-state-updater.js";
import { SellOrderStateUpdater } from "../../../src/cycle/sell-order-state-updater.js";
import { StrategyPauseMechanism } from "../../../src/cycle/strategy-pause-mechanism.js";
import { EventLogger } from "../../../src/monitoring/event-logger.js";
import { BalanceManager } from "../../../src/exchange/balance-manager.js";
import { ConnectionManager } from "../../../src/database/connection-manager.js";
import { StateTransactionManager } from "../../../src/cycle/state-transaction-manager.js";
import { ReferencePriceCalculator } from "../../../src/cycle/reference-price-calculator.js";
import { BuyAmountCalculator } from "../../../src/cycle/buy-amount-calculator.js";
import { StrategyConfigLoader } from "../../../src/config/strategy-config-loader.js";
import { TradingRules } from "../../../src/exchange/trading-rules.js";
import type { BinanceClient } from "../../../src/exchange/binance-client.js";
import type { WebSocketManager } from "../../../src/exchange/websocket-manager.js";
import type { DiscordNotifier } from "../../../src/notifications/discord-notifier.js";

// Mocks
import { MockSupabaseClient } from "../mocks/mock-supabase-client.js";
import { MockBinanceClient } from "../mocks/mock-binance-client.js";
import { MockWebSocketManager } from "../mocks/mock-websocket-manager.js";
import { MockDiscordNotifier } from "../mocks/mock-discord-notifier.js";
import { MockCandleManager } from "../mocks/mock-candle-manager.js";

export interface TestScenario {
  name: string;
  description: string;
  symbol: string;
  interval: string;
  candles: Array<{
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    comment?: string;
  }>;
}

export interface TestOrchestratorConfig {
  scenario: TestScenario;
  historicalCandles?: number; // How many candles are historical vs live (default: 25)
  initialCapital?: number; // Initial USDT capital (default: 1000)
  dropPercentage?: number; // Grid drop percentage (default: 0.003)
  risePercentage?: number; // Sell trigger rise percentage (default: 0.005)
  maxPurchases?: number; // Max grid purchases (default: 10)
  skipValidation?: boolean; // Skip startup validation (default: true for tests)
}

export interface TestOrchestratorResult {
  orchestrator: MainOrchestrator;
  mocks: {
    supabase: MockSupabaseClient;
    binance: MockBinanceClient;
    websocket: MockWebSocketManager;
    discord: MockDiscordNotifier;
    candleManager: MockCandleManager;
  };
  components: {
    cycleStateManager: CycleStateManager;
    buyTriggerDetector: BuyTriggerDetector;
    sellTriggerDetector: SellTriggerDetector;
    balanceManager: BalanceManager;
    eventLogger: EventLogger;
  };
}

export async function createTestOrchestrator(
  config: TestOrchestratorConfig,
): Promise<TestOrchestratorResult> {
  // Set defaults
  const historicalCount = config.historicalCandles ?? 2; // Only 2 historical for testing
  const initialCapital = config.initialCapital ?? 1000;
  const dropPercentage = config.dropPercentage ?? 0.003;
  const risePercentage = config.risePercentage ?? 0.005;
  const maxPurchases = config.maxPurchases ?? 10;

  // Create shared candle manager
  const candleManager = new MockCandleManager(config.scenario.candles);
  candleManager.setHistoricalCount(historicalCount);

  // Create mocked external services
  const mockSupabase = new MockSupabaseClient();
  const mockDiscord = new MockDiscordNotifier();
  const mockBinance = new MockBinanceClient({
    initialBalances: { BTC: 0, USDT: initialCapital },
    feeRate: 0.001,
    slippage: 0.001,
    candleManager: candleManager,
  });

  const mockWebSocket = new MockWebSocketManager({
    candleManager: candleManager,
    symbol: config.scenario.symbol,
    emitInterval: 0, // Emit immediately for fast tests
    onCandleEmitted: () => {
      // Update Binance price when WebSocket emits a candle
      mockBinance.updatePriceFromCandleManager();
    },
  });

  // Set up initial strategy config in mock Supabase
  mockSupabase.setStrategyConfig("test-strategy", {
    timeframe: config.scenario.interval,
    drop_percentage: dropPercentage,
    rise_percentage: risePercentage,
    max_purchases: maxPurchases,
    min_buy_usdt: 10,
    initial_capital_usdt: initialCapital,
    slippage_buy_pct: 0.003,
    slippage_sell_pct: 0.003,
    ath_window: 25,
    is_active: true,
  });

  // Create real production components with mocked services
  // Cast mocks to proper interfaces for production components
  const supabaseClient = mockSupabase as unknown as SupabaseClient<Database>;
  const binanceClient = mockBinance as unknown as BinanceClient;
  const webSocketManager = mockWebSocket as unknown as WebSocketManager;
  const discordNotifier = mockDiscord as unknown as DiscordNotifier;

  const strategyConfigLoader = new StrategyConfigLoader();
  const connectionManager = new ConnectionManager({
    url: process.env.SUPABASE_URL || "https://test.supabase.co",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key",
  });

  const tradingRules = new TradingRules(binanceClient);

  // Note: OrderPriceCalculator is not used in test orchestrator
  // The order placers don't use it with the simplified constructor

  const candleProcessor = new CandleProcessor({});

  const cycleStateManager = new CycleStateManager(supabaseClient, {
    initialCapitalUSDT: initialCapital,
    maxPurchases: maxPurchases,
    minBuyUSDT: 10,
  });

  const stateTransactionManager = new StateTransactionManager(supabaseClient);

  const historicalCandleManager = new HistoricalCandleManager(
    binanceClient,
    config.scenario.symbol,
    config.scenario.interval,
  );

  const referencePriceCalculator = new ReferencePriceCalculator();
  const buyAmountCalculator = new BuyAmountCalculator();

  const buyTriggerDetector = new BuyTriggerDetector(buyAmountCalculator);

  const sellTriggerDetector = new SellTriggerDetector();

  const balanceManager = new BalanceManager(binanceClient);

  const buyOrderPlacer = new BuyOrderPlacer(
    binanceClient,
    tradingRules,
    supabaseClient,
    config.scenario.symbol,
  );

  const sellOrderPlacer = new SellOrderPlacer(
    binanceClient,
    tradingRules,
    supabaseClient,
    config.scenario.symbol,
  );

  const buyOrderStateUpdater = new BuyOrderStateUpdater(
    supabaseClient,
    discordNotifier,
  );

  const sellOrderStateUpdater = new SellOrderStateUpdater(
    supabaseClient,
    {
      maxPurchases: maxPurchases,
    },
    discordNotifier,
  );

  // Import the logger from utils
  const { logger } = await import("../../../src/utils/logger.js");
  const eventLogger = new EventLogger({
    supabase: supabaseClient,
    logger: logger,
  });

  const strategyPauseMechanism = new StrategyPauseMechanism(
    supabaseClient,
    cycleStateManager,
    discordNotifier,
  );

  // Create the orchestrator with all real components
  const orchestrator = new MainOrchestrator({
    supabaseClient,
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
  });

  return {
    orchestrator,
    mocks: {
      supabase: mockSupabase,
      binance: mockBinance,
      websocket: mockWebSocket,
      discord: mockDiscord,
      candleManager,
    },
    components: {
      cycleStateManager,
      buyTriggerDetector,
      sellTriggerDetector,
      balanceManager,
      eventLogger,
    },
  };
}
