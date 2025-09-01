import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { BuyOrderPlacer } from "../../src/order/buy-order-placer";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import { Decimal } from "decimal.js";
import type { SymbolTradingRules } from "../../src/exchange/types";

// Mock dependencies
jest.mock("../../src/exchange/binance-client");
jest.mock("../../src/exchange/trading-rules");

// Define error types for testing
interface ApiError extends Error {
  code?: string;
}

// Helper to cast mocks properly
function asMock<T extends object>(mock: T): jest.Mocked<T> {
  return mock as jest.Mocked<T>;
}

describe("BuyOrderPlacer", () => {
  let buyOrderPlacer: BuyOrderPlacer;
  let mockBinanceClient: BinanceClient;
  let mockTradingRules: TradingRules;
  let mockSupabaseClient: unknown;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances
    const mockConfig = {
      apiKey: "test-key",
      apiSecret: "test-secret",
      testnet: true,
    };
    mockBinanceClient = new BinanceClient(mockConfig);
    mockTradingRules = new TradingRules(mockBinanceClient);
    // Create a mock Supabase client
    mockSupabaseClient = null;

    // Setup default trading rules
    const mockSymbolRules: SymbolTradingRules = {
      symbol: "BTCUSDT",
      minQty: 0.0001,
      maxQty: 9000.0,
      stepSize: 0.00001,
      minPrice: 0.01,
      maxPrice: 1000000,
      tickSize: 0.01,
      minNotional: 10.0,
      lastUpdated: Date.now(),
    };

    // Setup mock implementations
    asMock(mockTradingRules).getRules = jest
      .fn()
      .mockResolvedValue(mockSymbolRules);

    asMock(mockTradingRules).roundQuantityToStep = jest
      .fn()
      .mockImplementation((qty: number) => {
        return Math.floor(qty / 0.00001) * 0.00001;
      });

    asMock(mockTradingRules).roundPriceToTick = jest
      .fn()
      .mockImplementation((price: number) => {
        return Math.floor(price / 0.01) * 0.01;
      });

    // Create BuyOrderPlacer instance
    buyOrderPlacer = new BuyOrderPlacer(
      mockBinanceClient,
      mockTradingRules,
      mockSupabaseClient,
      "BTCUSDT",
    );
  });

  describe("Order Preparation", () => {
    it("should calculate quantity correctly from buy amount and limit price", async () => {
      const buyAmount = new Decimal("1000"); // 1000 USDT
      const currentPrice = new Decimal("50000");
      const slippageGuardPct = 0.003; // 0.3%

      // Expected calculations
      const expectedLimitPrice = new Decimal("50150"); // 50000 * (1 + 0.003) = 50150
      const expectedQuantity = new Decimal("0.01994"); // 1000 / 50150 = 0.019940... rounded to step size

      const orderParams = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      expect(orderParams.symbol).toBe("BTCUSDT");
      expect(orderParams.quantity.toFixed(5)).toBe(expectedQuantity.toFixed(5));
      expect(orderParams.limitPrice.toFixed(2)).toBe(
        expectedLimitPrice.toFixed(2),
      );
      expect(orderParams.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
    });

    it("should round quantity to step size", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");
      const slippageGuardPct = 0.003;

      const orderParams = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      expect(orderParams.quantity).toEqual(new Decimal("0.01994"));
      expect(mockTradingRules.roundQuantityToStep).toHaveBeenCalledWith(
        expect.any(Number),
        "BTCUSDT",
      );
    });

    it("should calculate limit price with slippage guard", async () => {
      const buyAmount = new Decimal("2000");
      const currentPrice = new Decimal("60000");
      const slippageGuardPct = 0.005; // 0.5%

      // 60000 * (1 + 0.005) = 60300
      const expectedLimitPrice = new Decimal("60300");

      const orderParams = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      expect(orderParams.limitPrice).toEqual(expectedLimitPrice);
      expect(mockTradingRules.roundPriceToTick).toHaveBeenCalledWith(
        60300,
        "BTCUSDT",
      );
    });

    it("should generate unique client order ID", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const orderParams1 = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      const orderParams2 = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(orderParams1.clientOrderId).not.toBe(orderParams2.clientOrderId);
      expect(orderParams1.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
      expect(orderParams2.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
    });
  });

  describe("Order Validation", () => {
    it("should validate minimum quantity", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.00005"), // Below min of 0.0001
        limitPrice: new Decimal("50000"),
        clientOrderId: "BUY_123_abc",
      };

      await expect(buyOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order quantity 0.00005 is below minimum 0.0001",
      );
    });

    it("should validate maximum quantity", async () => {
      asMock(mockTradingRules).roundQuantityToStep = jest
        .fn()
        .mockReturnValue(10000);

      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("10000"), // Above max of 9000
        limitPrice: new Decimal("50000"),
        clientOrderId: "BUY_123_abc",
      };

      await expect(buyOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order quantity 10000 exceeds maximum 9000",
      );
    });

    it("should validate minimum notional value", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.0001"),
        limitPrice: new Decimal("10000"), // 0.0001 * 10000 = 1 USDT (below min 10)
        clientOrderId: "BUY_123_abc",
      };

      await expect(buyOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order notional value 1 is below minimum 10",
      );
    });

    it("should pass validation for valid orders", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.01"),
        limitPrice: new Decimal("50000"), // 0.01 * 50000 = 500 USDT
        clientOrderId: "BUY_123_abc",
      };

      await expect(
        buyOrderPlacer.validateOrder(orderParams),
      ).resolves.not.toThrow();
    });
  });

  describe("Order Placement", () => {
    it("should submit order to Binance with correct parameters", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");
      const slippageGuardPct = 0.003;

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        orderListId: -1,
        clientOrderId: "BUY_123_abc",
        transactTime: Date.now(),
        price: "50150.00",
        origQty: "0.01994",
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED",
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        timeInForce: "IOC",
        quantity: 0.01994,
        price: 50150.0,
        newClientOrderId: expect.stringMatching(/^BUY_\d+_[a-z0-9]+$/),
      });

      expect(result.orderId).toBe(123456789);
      expect(result.executedQty.toString()).toBe("0.01994");
      expect(result.status).toBe("FILLED");
    });

    it("should handle partially filled orders", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockPartialFillResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        clientOrderId: "BUY_123_abc",
        transactTime: Date.now(),
        price: "50150.00",
        origQty: "0.01994",
        executedQty: "0.01000", // Only partially filled
        cummulativeQuoteQty: "501.50",
        status: "EXPIRED",
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
        fills: [
          {
            price: "50150.00",
            qty: "0.01000",
            commission: "0.00001",
            commissionAsset: "BTC",
          },
        ],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockPartialFillResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.executedQty.toString()).toBe("0.01");
      expect(result.status).toBe("EXPIRED");
      expect(result.cummulativeQuoteQty.toString()).toBe("501.5");
    });

    it("should throw on order rejection", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockRejectedValue(new Error("Insufficient balance"));

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Insufficient balance");
    });

    it("should retry on transient failures", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      // First two calls fail, third succeeds
      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("Connection reset"))
        .mockResolvedValueOnce(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
      expect(result.orderId).toBe(123456789);
    });
  });

  describe("Database Recording", () => {
    it("should save successful trade to database", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        clientOrderId: "BUY_123_abc",
        transactTime: Date.now(),
        price: "50150.00",
        origQty: "0.01994",
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED",
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      mockSupabaseClient = {
        from: jest.fn().mockReturnValue({
          insert: jest.fn().mockResolvedValue({ error: null }),
        }),
      };

      // Set cycle ID for database save
      buyOrderPlacer.setCycleId("CYCLE_001");

      // Spy on event emission
      const eventSpy = jest.spyOn(buyOrderPlacer, "emit");

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      // Check that trade record event was emitted
      const tradeRecordCalls = eventSpy.mock.calls.filter(
        (call) => call[0] === "tradeRecordReady",
      );
      expect(tradeRecordCalls.length).toBe(1);

      const tradeRecord = tradeRecordCalls[0][1] as Record<string, unknown>;
      expect(tradeRecord.type).toBe("BUY");
      expect(tradeRecord.order_id).toBe("123456789");
      expect(tradeRecord.status).toBe("FILLED");
      expect(tradeRecord.cycle_id).toBe("CYCLE_001");
    });

    it("should emit trade record without cycle_id if not set", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      // Don't set cycle ID
      const eventSpy = jest.spyOn(buyOrderPlacer, "emit");

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      const tradeRecordCalls = eventSpy.mock.calls.filter(
        (call) => call[0] === "tradeRecordReady",
      );
      expect(tradeRecordCalls.length).toBe(1);

      const tradeRecord = tradeRecordCalls[0][1] as Record<string, unknown>;
      expect(tradeRecord.cycle_id).toBeUndefined();
    });
  });

  describe("Fee Tracking", () => {
    it("should track BTC fees", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
          },
        ],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC.toString()).toBe("0.00001994");
      expect(result.feeUSDT.toString()).toBe("0");
    });

    it("should track USDT fees", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.99999",
            commissionAsset: "USDT",
          },
        ],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC.toString()).toBe("0");
      expect(result.feeUSDT.toString()).toBe("0.99999");
    });
  });

  describe("Error Handling", () => {
    it("should handle rate limit errors", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const rateLimitError: ApiError = new Error("Rate limit exceeded");
      rateLimitError.code = "RATE_LIMIT";

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockRejectedValue(rateLimitError);

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Rate limit exceeded");
    });
  });

  describe("State Updates", () => {
    it("should provide state update data for successful order", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
          },
        ],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      const stateUpdateData = buyOrderPlacer.getStateUpdateData(result);

      expect(stateUpdateData.btcReceived.toString()).toBe("0.01994");
      expect(stateUpdateData.netBTCReceived.toString()).toBe("0.01992006"); // 0.01994 - 0.00001994
      expect(stateUpdateData.totalCostUSDT.toString()).toBe("999.99");
      expect(stateUpdateData.avgPrice.toString()).toBe("50149.699397590361446"); // 999.99 / 0.01994
    });
  });

  describe("Event Emissions", () => {
    it("should emit orderPlacing event before submitting", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const eventSpy = jest.spyOn(buyOrderPlacer, "emit");

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      const orderPlacingCalls = eventSpy.mock.calls.filter(
        (call) => call[0] === "orderPlacing",
      );
      expect(orderPlacingCalls.length).toBe(1);

      const orderParams = orderPlacingCalls[0][1] as Record<string, unknown>;
      expect(orderParams.symbol).toBe("BTCUSDT");
      expect(orderParams.quantity).toBeInstanceOf(Decimal);
      expect(orderParams.limitPrice).toBeInstanceOf(Decimal);
    });

    it("should emit orderCompleted event on success", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      asMock(mockBinanceClient).createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const eventSpy = jest.spyOn(buyOrderPlacer, "emit");

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      const orderCompletedCalls = eventSpy.mock.calls.filter(
        (call) => call[0] === "orderCompleted",
      );
      expect(orderCompletedCalls.length).toBe(1);

      const result = orderCompletedCalls[0][1] as Record<string, unknown>;
      expect(result.orderId).toBe(123456789);
      expect(result.status).toBe("FILLED");
    });
  });
});
