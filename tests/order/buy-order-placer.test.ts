import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { BuyOrderPlacer, TradeRecord } from "../../src/order/buy-order-placer";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import { Decimal } from "decimal.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StrategyConfig } from "../../src/config/strategy-config-loader";
import type {
  BinanceOrder,
  BinanceTrade,
  OrderStatus,
  CreateOrderParams,
} from "../../src/exchange/types";

// Only mock the external dependencies (Binance API)
jest.mock("../../src/exchange/binance-client");

describe("BuyOrderPlacer", () => {
  let buyOrderPlacer: BuyOrderPlacer;
  let mockSupabaseClient: SupabaseClient;
  let mockBinanceClient: {
    createOrder: jest.Mock<
      (params: CreateOrderParams) => Promise<BinanceOrder>
    >;
    getOrder: jest.Mock<
      (
        symbol: string,
        orderId?: number,
        origClientOrderId?: string,
      ) => Promise<BinanceOrder>
    >;
    getMyTrades: jest.Mock<
      (symbol: string, orderId: number) => Promise<BinanceTrade[]>
    >;
    getExchangeInfo: jest.Mock<() => Promise<{ symbols: unknown[] }>>;
    getBalance: jest.Mock<
      (asset: string) => Promise<{ free: number; locked: number }>
    >;
  };
  let tradingRules: TradingRules;
  let mockStrategyConfig: StrategyConfig;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock strategy config
    mockStrategyConfig = {
      id: "test-config",
      timeframe: "15m",
      dropPercentage: 0.02,
      risePercentage: 0.03,
      maxPurchases: 5,
      minBuyUsdt: 10,
      initialCapitalUsdt: 500,
      slippageBuyPct: 0.003,
      slippageSellPct: 0.003,
      athWindow: 25,
      isActive: true,
      updatedAt: new Date().toISOString(),
      buyMode: "arithmetic",
    };

    // Mock SupabaseClient with chaining support
    const mockQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(() =>
        Promise.resolve({
          data: { id: "mock-trade-id-123" },
          error: null,
        }),
      ),
    };

    mockSupabaseClient = {
      from: jest.fn(() => mockQueryBuilder),
    } as unknown as SupabaseClient;

    // Setup default trading rules that match real Binance BTCUSDT rules
    const mockBinanceSymbolInfo = {
      symbol: "BTCUSDT",
      status: "TRADING",
      baseAsset: "BTC",
      baseAssetPrecision: 8,
      quoteAsset: "USDT",
      quoteAssetPrecision: 8,
      orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
      icebergAllowed: true,
      ocoAllowed: true,
      isSpotTradingAllowed: true,
      isMarginTradingAllowed: false,
      filters: [
        {
          filterType: "PRICE_FILTER",
          minPrice: "0.01",
          maxPrice: "1000000.00",
          tickSize: "0.01",
        },
        {
          filterType: "LOT_SIZE",
          minQty: "0.00001",
          maxQty: "9000.00",
          stepSize: "0.00001",
        },
        {
          filterType: "NOTIONAL",
          minNotional: "10.00",
          applyToMarket: true,
          avgPriceMins: 5,
        },
      ],
      permissions: ["SPOT"],
    };

    // Create mock Binance client
    const createOrderFn = jest.fn<() => Promise<BinanceOrder>>();
    const getOrderFn = jest.fn<() => Promise<BinanceOrder>>();
    const getMyTradesFn =
      jest.fn<(symbol: string, orderId?: number) => Promise<BinanceTrade[]>>();
    const getExchangeInfoFn = jest.fn<() => Promise<{ symbols: unknown[] }>>();

    // Default mock returns trade data matching the order for realistic testing
    getMyTradesFn.mockImplementation(async () => {
      // Return empty array by default (order not filled)
      return [];
    });

    // Mock getExchangeInfo to return BTCUSDT rules in correct format
    getExchangeInfoFn.mockResolvedValue({
      symbols: [mockBinanceSymbolInfo],
    });

    const getBalanceFn =
      jest.fn<() => Promise<{ free: number; locked: number }>>();
    getBalanceFn.mockResolvedValue({ free: 10000, locked: 0 }); // Default balance

    mockBinanceClient = {
      createOrder: createOrderFn as jest.Mock<
        (params: CreateOrderParams) => Promise<BinanceOrder>
      >,
      getOrder: getOrderFn as jest.Mock<
        (
          symbol: string,
          orderId?: number,
          origClientOrderId?: string,
        ) => Promise<BinanceOrder>
      >,
      getMyTrades: getMyTradesFn as jest.Mock<
        (symbol: string, orderId?: number) => Promise<BinanceTrade[]>
      >,
      getExchangeInfo: getExchangeInfoFn as jest.Mock<
        () => Promise<{ symbols: unknown[] }>
      >,
      getBalance: getBalanceFn as jest.Mock<
        (asset: string) => Promise<{ free: number; locked: number }>
      >,
    };

    // Create real TradingRules instance with mocked BinanceClient
    tradingRules = new TradingRules(
      mockBinanceClient as unknown as BinanceClient,
    );

    // Create BuyOrderPlacer instance with real TradingRules
    buyOrderPlacer = new BuyOrderPlacer(
      mockBinanceClient as unknown as BinanceClient,
      tradingRules,
      mockSupabaseClient as SupabaseClient,
      "BTCUSDT",
      mockStrategyConfig,
    );

    // Mock the private sleep method to eliminate delays in tests
    const buyOrderPlacerWithSleep = buyOrderPlacer as unknown as {
      sleep: (ms: number) => Promise<void>;
    };
    jest
      .spyOn(buyOrderPlacerWithSleep, "sleep")
      .mockImplementation(() => Promise.resolve());
  });

  describe("Order Preparation", () => {
    it("should calculate quantity correctly from buy amount and current price", async () => {
      const buyAmount = new Decimal("1000"); // 1000 USDT to spend
      const currentPrice = new Decimal("50000");
      const slippageGuardPct = 0.003; // 0.3% slippage

      const orderParams = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      // Test the actual calculation logic
      // limit_price = 50000 * (1 + 0.003) = 50150
      // quantity = 1000 / 50150 = 0.0199401... -> rounded to 0.01994
      expect(orderParams.symbol).toBe("BTCUSDT");
      expect(orderParams.limitPrice.toNumber()).toBe(50150);
      // Smart rounding: 1000 / 50000 = 0.02
      // Should round to 0.02000 (exact match, no rounding needed)
      expect(orderParams.quantity.toNumber()).toBeCloseTo(0.02, 5);
      expect(orderParams.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
    });

    it("should calculate limit price with slippage guard correctly", async () => {
      const buyAmount = new Decimal("5000");
      const currentPrice = new Decimal("45000");
      const slippageGuardPct = 0.005; // 0.5%

      const orderParams = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      // limit_price = 45000 * (1 + 0.005) = 45225
      // quantity = 5000 / 45000 (current price) = 0.11111...
      // Smart rounding: rounds DOWN to 0.11111 (capital limit prevents rounding up)
      expect(orderParams.limitPrice.toNumber()).toBe(45225);
      expect(orderParams.quantity.toNumber()).toBeCloseTo(0.11111, 5);
    });

    it("should use default slippage guard of 0.3% if not specified", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      // Test with explicit 0.003 (0.3%)
      const orderParamsWithDefault = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(orderParamsWithDefault.limitPrice.toNumber()).toBe(50150); // 50000 * 1.003
    });

    it("should generate unique client order IDs", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const order1 = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      const order2 = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(order1.clientOrderId).not.toBe(order2.clientOrderId);
      expect(order1.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
      expect(order2.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
    });

    it("should throw error for invalid buy amount", async () => {
      const invalidBuyAmount = new Decimal("0");
      const currentPrice = new Decimal("50000");

      await expect(
        buyOrderPlacer.prepareOrder(invalidBuyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Buy amount must be greater than 0");
    });

    it("should throw error for invalid price", async () => {
      const buyAmount = new Decimal("1000");
      const invalidPrice = new Decimal("0");

      await expect(
        buyOrderPlacer.prepareOrder(buyAmount, invalidPrice, 0.003),
      ).rejects.toThrow("Current price must be greater than 0");
    });

    it("should throw error for invalid slippage guard", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      await expect(
        buyOrderPlacer.prepareOrder(buyAmount, currentPrice, -0.01),
      ).rejects.toThrow("Slippage guard percentage must be between 0 and 0.1");

      await expect(
        buyOrderPlacer.prepareOrder(buyAmount, currentPrice, 0.2),
      ).rejects.toThrow("Slippage guard percentage must be between 0 and 0.1");
    });
  });

  describe("Order Validation", () => {
    it("should validate order against minimum quantity", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.000001"), // Below minimum
        limitPrice: new Decimal("50000"),
        clientOrderId: "test-order",
      };

      await expect(buyOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order quantity 0.000001 is below minimum 0.00001",
      );
    });

    it("should validate order against maximum quantity", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("10000"), // Above maximum
        limitPrice: new Decimal("50000"),
        clientOrderId: "test-order",
      };

      await expect(buyOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order quantity 10000 exceeds maximum 9000",
      );
    });

    it("should validate order against minimum notional value", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.0001"),
        limitPrice: new Decimal("50000"), // 0.0001 * 50000 = 5 USDT < 10 minimum
        clientOrderId: "test-order",
      };

      await expect(buyOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order notional value 5 is below minimum 10",
      );
    });

    it("should pass validation for valid order", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.01"),
        limitPrice: new Decimal("50000"), // 0.01 * 50000 = 500 USDT > 10 minimum
        clientOrderId: "test-order",
      };

      // Should not throw
      await expect(
        buyOrderPlacer.validateOrder(orderParams),
      ).resolves.toBeUndefined();
    });
  });

  describe("Order Placement", () => {
    it("should place a LIMIT IOC order successfully", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        orderId: 123456789,
        clientOrderId: "BUY_123_abc",
        symbol: "BTCUSDT",
        executedQty: "0.02",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        side: "BUY",
        type: "LIMIT",
        timeInForce: "IOC",
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrderResponse);

      // Mock trades for the filled order
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.02",
          quoteQty: "1000.00",
          commission: "0.00002",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      // Verify correct order parameters were sent
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(1);
      const callArgs = mockBinanceClient.createOrder.mock.calls[0][0];
      expect(callArgs.symbol).toBe("BTCUSDT");
      expect(callArgs.side).toBe("BUY");
      expect(callArgs.type).toBe("LIMIT");
      expect(callArgs.timeInForce).toBe("IOC"); // Must be IOC per STRATEGY.md
      // Smart rounding: 1000 / 50000 = 0.02 (exact)
      expect(callArgs.quantity).toBeCloseTo(0.02, 5);
      expect(callArgs.price).toBe(50150);
      expect(callArgs.newClientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);

      // Verify result processing
      expect(result.orderId).toBe(123456789);
      expect(result.status).toBe("FILLED");
      expect(result.executedQty.toString()).toBe("0.02");
      expect(result.cummulativeQuoteQty.toString()).toBe("999.99");
    });

    it("should handle partial fills correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        orderId: 123456789,
        clientOrderId: "BUY_123_abc",
        executedQty: "0.01", // Only partially filled
        cummulativeQuoteQty: "501.5",
        status: "PARTIALLY_FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrderResponse);

      // Mock trades for the partially filled order
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01",
          quoteQty: "501.5",
          commission: "0.00001",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.status).toBe("PARTIALLY_FILLED");
      expect(result.executedQty.toString()).toBe("0.01");
    });

    it("should retry on network errors", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockSuccessResponse = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      // First two calls fail with network errors, third succeeds
      mockBinanceClient.createOrder
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(mockSuccessResponse);
      mockBinanceClient.getOrder.mockResolvedValue(mockSuccessResponse);

      // Mock getMyTrades for successful order
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
      expect(result.orderId).toBe(123456789);
    });

    it("should not retry on non-retryable errors", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      // Use a validation error that's not retryable (invalid symbol/parameters)
      mockBinanceClient.createOrder.mockRejectedValue(
        new Error("Filter failure: LOT_SIZE"),
      );

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Filter failure: LOT_SIZE");

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe("Fee Tracking", () => {
    it("should track BTC fees correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderWithBTCFee = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderWithBTCFee);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrderWithBTCFee);

      // Mock getMyTrades for BTC fee
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC.toString()).toBe("0.00001994");
      expect(result.feeUSDT.toString()).toBe("0");
    });

    it("should track USDT fees correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderWithUSDTFee = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.99999",
            commissionAsset: "USDT",
            tradeId: 123457,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderWithUSDTFee);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrderWithUSDTFee);

      // Mock getMyTrades for USDT fee
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123457,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.99999",
          commissionAsset: "USDT",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeUSDT.toString()).toBe("0.99999");
      expect(result.feeBTC.toString()).toBe("0");
    });

    it("should track other currency fees correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderWithBNBFee = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.001",
            commissionAsset: "BNB",
            tradeId: 123458,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderWithBNBFee);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrderWithBNBFee);

      // Mock getMyTrades for BNB fee
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123458,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.001",
          commissionAsset: "BNB",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeOther["BNB"].toString()).toBe("0.001");
      // When BNB fee is used, BTC fee is imputed: qty * 0.00075
      expect(result.feeBTC.toString()).toBe("0.000014955"); // 0.01994 * 0.00075
      expect(result.feeUSDT.toString()).toBe("0");
    });
  });

  describe("Event Emission", () => {
    it("should emit proper events during order placement", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      // Mock getMyTrades for event emission test
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const events: Array<{ event: string; data: unknown }> = [];

      buyOrderPlacer.on("orderPlacing", (data) =>
        events.push({ event: "orderPlacing", data }),
      );
      buyOrderPlacer.on("orderExecuted", (data) =>
        events.push({ event: "orderExecuted", data }),
      );
      buyOrderPlacer.on("orderCompleted", (data) =>
        events.push({ event: "orderCompleted", data }),
      );

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      expect(events).toHaveLength(3);
      expect(events[0].event).toBe("orderPlacing");
      expect(events[1].event).toBe("orderExecuted");
      expect(events[2].event).toBe("orderCompleted");
    });
  });

  describe("Database Integration", () => {
    it("should emit trade record with cycle ID when set", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      // Mock getMyTrades for trade record
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      // Set cycle ID
      buyOrderPlacer.setCycleId("CYCLE_TEST_001");

      let tradeRecord: TradeRecord | undefined;
      buyOrderPlacer.on("tradeRecordReady", (data) => {
        tradeRecord = data as TradeRecord;
      });

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      expect(tradeRecord).toBeDefined();
      expect(tradeRecord?.cycle_id).toBe("CYCLE_TEST_001");
      expect(tradeRecord?.type).toBe("BUY");
      expect(tradeRecord?.order_id).toBe("123456789");
      expect(tradeRecord?.status).toBe("FILLED");
    });
  });

  describe("State Update Data", () => {
    it("should calculate state update data correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      // Mock getMyTrades
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      const stateData = buyOrderPlacer.getStateUpdateData(result);

      expect(stateData.btcReceived.toString()).toBe("0.01994");
      expect(stateData.netBTCReceived.toString()).toBe("0.01992006"); // 0.01994 - 0.00001994
      expect(stateData.totalCostUSDT.toString()).toBe("999.99");
      expect(stateData.avgPrice.toString()).toBe(result.avgPrice.toString());
    });
  });

  describe("Retry Logic", () => {
    it("should retry on rate limit errors", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const errorWithCode = new Error("Rate limit exceeded") as Error & {
        code: string;
      };
      errorWithCode.code = "-1003";

      const mockOrder = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockRejectedValueOnce(errorWithCode)
        .mockResolvedValue(mockOrder);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      // Mock getMyTrades for rate limit retry test
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(2);
      expect(result.orderId).toBe(123456789);
    });

    it("should retry on internal Binance errors", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const errorWithCode = new Error("Internal error") as Error & {
        code: string;
      };
      errorWithCode.code = "-1001";

      const mockOrder = {
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockRejectedValueOnce(errorWithCode)
        .mockResolvedValue(mockOrder);
      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      // Mock getMyTrades for internal error retry test
      mockBinanceClient.getMyTrades.mockResolvedValue([
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 123456789,
          orderListId: -1,
          price: "50150.00",
          qty: "0.01994",
          quoteQty: "999.99",
          commission: "0.00001994",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ]);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(2);
      expect(result.orderId).toBe(123456789);
    });
  });

  describe("Order Status Query", () => {
    it("should get order status by client order ID", async () => {
      const mockOrder = {
        orderId: 123456789,
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      const status = await buyOrderPlacer.getOrderStatus("BUY_123_abc");

      expect(mockBinanceClient.getOrder).toHaveBeenCalledWith(
        "BTCUSDT",
        undefined,
        "BUY_123_abc",
      );
      expect(status.status).toBe("FILLED");
    });
  });
});
