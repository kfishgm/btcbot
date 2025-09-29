import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import { BuyOrderPlacer } from "../../src/order/buy-order-placer";
import { BuyTriggerDetector } from "../../src/cycle/buy-trigger-detector";
import { BuyAmountCalculator } from "../../src/cycle/buy-amount-calculator";
import { StateTransactionManager } from "../../src/cycle/state-transaction-manager";
import type { Database } from "../../types/supabase";
import { Decimal } from "decimal.js";
import type {
  BinanceOrder,
  OrderStatus,
  BinanceExchangeInfo,
} from "../../src/exchange/types";

describe("Buy Order Flow Integration", () => {
  let binanceClient: BinanceClient;
  let tradingRules: TradingRules;
  let buyOrderPlacer: BuyOrderPlacer;
  let buyTriggerDetector: BuyTriggerDetector;
  let buyAmountCalculator: BuyAmountCalculator;
  let stateTransactionManager: StateTransactionManager;
  let mockSupabase: SupabaseClient<Database>;

  // Mock methods
  let mockSupabaseMethods: {
    from: jest.Mock;
    select: jest.Mock;
    single: jest.Mock;
    eq: jest.Mock;
    update: jest.Mock;
    insert: jest.Mock;
    rpc: jest.Mock;
  };

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup mock Supabase methods
    mockSupabaseMethods = {
      from: jest.fn(),
      select: jest.fn(),
      single: jest.fn(),
      eq: jest.fn(),
      update: jest.fn(),
      insert: jest.fn(),
      rpc: jest.fn(),
    };

    // Chain mock methods
    // Create a proper insert chain that supports .select().single()
    const insertSelectChain = {
      single: mockSupabaseMethods.single,
    };
    const insertChainWithSelect = {
      select: jest.fn().mockReturnValue(insertSelectChain),
    };

    mockSupabaseMethods.from.mockReturnValue({
      select: mockSupabaseMethods.select,
      update: mockSupabaseMethods.update,
      insert: jest.fn().mockReturnValue(insertChainWithSelect),
      eq: mockSupabaseMethods.eq,
    });
    mockSupabaseMethods.select.mockReturnValue({
      single: mockSupabaseMethods.single,
      eq: mockSupabaseMethods.eq,
    });
    mockSupabaseMethods.eq.mockReturnValue({
      select: mockSupabaseMethods.select,
      single: mockSupabaseMethods.single,
      update: mockSupabaseMethods.update,
    });
    mockSupabaseMethods.update.mockReturnValue({
      eq: mockSupabaseMethods.eq,
      select: mockSupabaseMethods.select,
    });

    // Default mock responses
    (
      mockSupabaseMethods.single as ReturnType<typeof jest.fn>
    ).mockResolvedValue({ data: null, error: null });
    (mockSupabaseMethods.rpc as ReturnType<typeof jest.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    mockSupabase = {
      from: mockSupabaseMethods.from,
      rpc: mockSupabaseMethods.rpc,
    } as unknown as SupabaseClient<Database>;

    // Mock getExchangeInfo first before creating BinanceClient
    const mockExchangeInfo: BinanceExchangeInfo = {
      timezone: "UTC",
      serverTime: Date.now(),
      rateLimits: [],
      symbols: [
        {
          symbol: "BTCUSDT",
          status: "TRADING",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          baseAssetPrecision: 8,
          quoteAssetPrecision: 8,
          orderTypes: ["LIMIT", "MARKET"],
          icebergAllowed: true,
          ocoAllowed: true,
          isSpotTradingAllowed: true,
          isMarginTradingAllowed: false,
          permissions: ["SPOT"],
          filters: [
            {
              filterType: "LOT_SIZE",
              minQty: "0.00001",
              maxQty: "9000",
              stepSize: "0.00001",
            },
            {
              filterType: "PRICE_FILTER",
              minPrice: "0.01",
              maxPrice: "1000000",
              tickSize: "0.01",
            },
            {
              filterType: "NOTIONAL",
              minNotional: "5.00",
            },
          ],
        },
      ],
    };

    // Initialize components with valid-format test keys
    // Use environment variable to signal we're in test mode
    process.env.NODE_ENV = "test";

    // Create a mock BinanceClient with all necessary methods
    binanceClient = {
      getExchangeInfo: jest.fn(() => Promise.resolve(mockExchangeInfo)),
      createOrder: jest.fn(() =>
        Promise.reject(new Error("createOrder should be mocked in each test")),
      ),
      getOrderBook: jest.fn(),
      getTrades: jest.fn(),
      getAccount: jest.fn(),
      getAllOrders: jest.fn(),
      cancelOrder: jest.fn(),
      getOrder: jest.fn(),
      getMyTrades: jest.fn(() => Promise.resolve([])), // Default to empty trades
      getKlines: jest.fn(),
      config: {
        apiKey: "testApiKey1234567890ABCDEFGHIJ",
        apiSecret: "testApiSecret1234567890ABCDEFGHIJ",
        testnet: true,
      },
    } as unknown as BinanceClient;

    tradingRules = new TradingRules(binanceClient);

    buyOrderPlacer = new BuyOrderPlacer(
      binanceClient,
      tradingRules,
      mockSupabase,
      "BTCUSDT",
    );

    buyAmountCalculator = new BuyAmountCalculator();
    buyTriggerDetector = new BuyTriggerDetector(buyAmountCalculator);

    // CycleStateManager removed as it's not used in tests

    stateTransactionManager = new StateTransactionManager(mockSupabase);
  });

  describe("Full Buy Order Flow", () => {
    it("should detect trigger, place order, and update state", async () => {
      // Setup cycle state
      const cycleState = {
        id: "test-bot-id",
        status: "READY" as const,
        capital_available: 300,
        btc_accumulated: 0,
        btc_accum_net: 0,
        btc_dust: 0,
        cost_accum_usdt: 0,
        purchases_remaining: 10,
        buy_amount: 30,
        reference_price: 100000,
        ath_price: 100000,
        buy_grid: [98000, 96000, 94000, 92000, 90000],
        buy_index: 0,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Test candle below first grid level
      const candle = {
        close: 97500, // Below first grid level of 98000
        high: 98500,
        low: 97000,
        open: 98000,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances = {
        usdtSpot: 300,
        btcSpot: 0,
      };

      const config = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 5,
        exchangeMinNotional: 5,
        driftThresholdPct: 0.005,
        maxPurchases: 10,
      };

      // Test buy trigger detection
      const triggerResult = await buyTriggerDetector.checkBuyTrigger(
        cycleState,
        config,
        candle,
        balances,
      );

      expect(triggerResult.shouldBuy).toBe(true);
      expect(triggerResult.buyAmount).toBe(30);
      expect(triggerResult.levelsTriggered).toBe(1);
      expect(triggerResult.newBuyIndex).toBe(1);

      // Mock successful order placement
      const mockOrderResponse: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "test-order-123",
        transactTime: Date.now(),
        price: "97500.00",
        origQty: "0.00030769",
        executedQty: "0.00030769",
        cummulativeQuoteQty: "30.00",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
        fills: [
          {
            price: "97500.00",
            qty: "0.00030769",
            commission: "0.00000031",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      };

      // Override the default mock for this specific test
      (
        binanceClient.createOrder as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce(mockOrderResponse);

      // Mock getOrder to return the same order (for verification)
      (
        binanceClient.getOrder as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce(mockOrderResponse);

      // Mock getMyTrades to return the fills as trades
      const mockTrades = mockOrderResponse.fills?.map((fill) => ({
        id: fill.tradeId || 123456,
        price: fill.price,
        qty: fill.qty,
        commission: fill.commission,
        commissionAsset: fill.commissionAsset,
        time: Date.now(),
        isBuyer: true,
        isMaker: false,
        isBestMatch: true,
      }));
      (
        binanceClient.getMyTrades as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce(mockTrades);

      // Place the order
      const orderResult = await buyOrderPlacer.placeOrder(
        new Decimal(triggerResult.buyAmount!),
        new Decimal(candle.close),
        0.003, // slippage
      );

      expect(orderResult.status).toBe("FILLED");
      expect(orderResult.executedQty.toNumber()).toBeCloseTo(0.00030769, 8);
      expect(orderResult.feeBTC.toNumber()).toBeCloseTo(0.00000031, 8);

      // Update state after successful order
      const updatedState = {
        ...cycleState,
        capital_available: 270,
        btc_accumulated: 0.00030738, // After fee
        btc_accum_net: 0.00030738,
        btc_dust: 0,
        cost_accum_usdt: 30,
        purchases_remaining: 9,
        buy_index: 1,
        status: "HOLDING" as const,
      };

      (
        mockSupabaseMethods.rpc as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce({
        data: updatedState,
        error: null,
      });

      const stateResult = await stateTransactionManager.updateStateAtomic(
        cycleState.id,
        {
          capital_available: updatedState.capital_available,
          btc_accumulated: updatedState.btc_accumulated,
          btc_accum_net: updatedState.btc_accum_net,
          btc_dust: 0,
          cost_accum_usdt: updatedState.cost_accum_usdt,
          purchases_remaining: updatedState.purchases_remaining,
          buy_index: updatedState.buy_index,
          status: updatedState.status,
        },
      );

      expect(stateResult.capital_available).toBe(270);
      expect(stateResult.purchases_remaining).toBe(9);
      expect(stateResult.buy_index).toBe(1);
    });

    it("should handle partial fill with IOC order", async () => {
      // Test partial fill scenario with IOC order

      const mockOrderResponse: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12346,
        orderListId: -1,
        clientOrderId: "test-order-124",
        transactTime: Date.now(),
        price: "97500.00",
        origQty: "0.00020513",
        executedQty: "0.00010000", // Partial fill
        cummulativeQuoteQty: "9.75",
        status: "EXPIRED" as OrderStatus, // IOC expires with partial fill
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
        fills: [
          {
            price: "97500.00",
            qty: "0.00010000",
            commission: "0.00000010",
            commissionAsset: "BTC",
            tradeId: 123457,
          },
        ],
      };

      // Override the default mock for this specific test
      (
        binanceClient.createOrder as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce(mockOrderResponse);

      // Mock getOrder to return the same order (for verification)
      (
        binanceClient.getOrder as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce(mockOrderResponse);

      // Mock getMyTrades to return the fills as trades
      const mockTrades = mockOrderResponse.fills?.map((fill) => ({
        id: fill.tradeId || 123457,
        price: fill.price,
        qty: fill.qty,
        commission: fill.commission,
        commissionAsset: fill.commissionAsset,
        time: Date.now(),
        isBuyer: true,
        isMaker: false,
        isBestMatch: true,
      }));
      (
        binanceClient.getMyTrades as ReturnType<typeof jest.fn>
      ).mockResolvedValueOnce(mockTrades);

      const orderResult = await buyOrderPlacer.placeOrder(
        new Decimal(20),
        new Decimal(97500),
        0.003,
      );

      expect(orderResult.status).toBe("EXPIRED");
      expect(orderResult.executedQty.toNumber()).toBeCloseTo(0.0001, 8);
      expect(orderResult.cummulativeQuoteQty.toNumber()).toBeCloseTo(9.75, 2);
    });

    it("should handle multiple grid levels triggered", async () => {
      const cycleState = {
        id: "test-bot-id",
        status: "READY" as const,
        capital_available: 300,
        btc_accumulated: 0,
        btc_accum_net: 0,
        btc_dust: 0,
        cost_accum_usdt: 0,
        purchases_remaining: 10,
        buy_amount: 30,
        buy_anchor_price: 98500, // Anchor set, not first buy
        reference_price: 100000,
        ath_price: 100000,
        buy_grid: [98000, 96000, 94000, 92000, 90000],
        buy_index: 0,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Price drops below multiple levels
      const candle = {
        close: 93500, // Below 98000, 96000, and 94000
        high: 95000,
        low: 93000,
        open: 95000,
        volume: 200,
        timestamp: Date.now(),
      };

      const balances = {
        usdtSpot: 300,
        btcSpot: 0,
      };

      const config = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 5,
        exchangeMinNotional: 5,
        driftThresholdPct: 0.005,
        maxPurchases: 10,
      };

      const triggerResult = await buyTriggerDetector.checkBuyTrigger(
        cycleState,
        config,
        candle,
        balances,
      );

      expect(triggerResult.shouldBuy).toBe(true);
      expect(triggerResult.levelsTriggered).toBe(3);
      expect(triggerResult.buyAmount).toBe(90); // 3 levels * 30 each
      expect(triggerResult.newBuyIndex).toBe(3);
      expect(triggerResult.triggeredLevels).toEqual([98000, 96000, 94000]);
    });

    it("should reject order when capital insufficient", async () => {
      const cycleState = {
        id: "test-bot-id",
        status: "READY" as const,
        capital_available: 4, // Below minimum thresholds
        btc_accumulated: 0,
        btc_accum_net: 0,
        btc_dust: 0,
        cost_accum_usdt: 0,
        purchases_remaining: 5,
        buy_amount: 30,
        reference_price: 100000,
        ath_price: 100000,
        buy_grid: [98000],
        buy_index: 0,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const candle = {
        close: 97500,
        high: 98500,
        low: 97000,
        open: 98000,
        volume: 100,
        timestamp: Date.now(),
      };

      const balances = {
        usdtSpot: 4,
        btcSpot: 0,
      };

      const config = {
        dropPercentage: 0.02,
        risePercentage: 0.03,
        minBuyUSDT: 5,
        exchangeMinNotional: 5,
        driftThresholdPct: 0.005,
        maxPurchases: 10,
      };

      const triggerResult = await buyTriggerDetector.checkBuyTrigger(
        cycleState,
        config,
        candle,
        balances,
      );

      expect(triggerResult.shouldBuy).toBe(false);
      expect(triggerResult.reason).toContain("below minimum");
      expect(triggerResult.validations?.amountValid).toBe(false);
    });
  });
});
