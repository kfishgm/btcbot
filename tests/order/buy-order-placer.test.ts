import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { BuyOrderPlacer, TradeRecord } from "../../src/order/buy-order-placer";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import { Decimal } from "decimal.js";
import type {
  SymbolTradingRules,
  BinanceOrder,
  OrderStatus,
  CreateOrderParams,
} from "../../src/exchange/types";

// Only mock the external dependencies (Binance API)
jest.mock("../../src/exchange/binance-client");
jest.mock("../../src/exchange/trading-rules");

describe("BuyOrderPlacer", () => {
  let buyOrderPlacer: BuyOrderPlacer;
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
  };
  let mockTradingRules: {
    getRules: jest.Mock<
      (symbol: string, forceRefresh?: boolean) => Promise<SymbolTradingRules>
    >;
    roundQuantityToStep: jest.Mock<
      (quantity: number, symbol: string) => number
    >;
    roundPriceToTick: jest.Mock<(price: number, symbol: string) => number>;
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup default trading rules that match real Binance BTCUSDT rules
    const mockSymbolRules: SymbolTradingRules = {
      symbol: "BTCUSDT",
      minQty: 0.00001, // Real Binance min for BTCUSDT
      maxQty: 9000.0,
      stepSize: 0.00001,
      minPrice: 0.01,
      maxPrice: 1000000,
      tickSize: 0.01,
      minNotional: 10.0, // Real Binance min notional
      lastUpdated: Date.now(),
    };

    // Create mock functions with proper typing
    const getRulesFn = jest.fn<() => Promise<SymbolTradingRules>>();
    getRulesFn.mockResolvedValue(mockSymbolRules);

    const roundQuantityFn = jest.fn<(qty: number, _symbol: string) => number>();
    roundQuantityFn.mockImplementation((qty: number, _symbol: string) => {
      // Real rounding logic
      const stepSize = 0.00001;
      return parseFloat((Math.floor(qty / stepSize) * stepSize).toFixed(8));
    });

    const roundPriceFn = jest.fn<(price: number, _symbol: string) => number>();
    roundPriceFn.mockImplementation((price: number, _symbol: string) => {
      // Real rounding logic
      const tickSize = 0.01;
      return parseFloat((Math.floor(price / tickSize) * tickSize).toFixed(8));
    });

    // Create mock trading rules
    mockTradingRules = {
      getRules: getRulesFn as jest.Mock<
        (symbol: string, forceRefresh?: boolean) => Promise<SymbolTradingRules>
      >,
      roundQuantityToStep: roundQuantityFn as jest.Mock<
        (quantity: number, symbol: string) => number
      >,
      roundPriceToTick: roundPriceFn as jest.Mock<
        (price: number, symbol: string) => number
      >,
    };

    // Create mock Binance client
    const createOrderFn = jest.fn<() => Promise<BinanceOrder>>();
    const getOrderFn = jest.fn<() => Promise<BinanceOrder>>();

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
    };

    // Create BuyOrderPlacer instance with null supabase client (we use events instead)
    buyOrderPlacer = new BuyOrderPlacer(
      mockBinanceClient as unknown as BinanceClient,
      mockTradingRules as unknown as TradingRules,
      null, // Supabase client is not used directly
      "BTCUSDT",
    );
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
      expect(orderParams.quantity.toNumber()).toBeCloseTo(0.01994, 5);
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
      // quantity = 5000 / 45225 = 0.11056... -> rounded to 0.11055
      expect(orderParams.limitPrice.toNumber()).toBe(45225);
      expect(orderParams.quantity.toNumber()).toBeCloseTo(0.11055, 5);
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
        executedQty: "0.01994",
        cummulativeQuoteQty: "999.99",
        status: "FILLED" as OrderStatus,
        side: "BUY",
        type: "LIMIT",
        timeInForce: "IOC",
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

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
      expect(callArgs.quantity).toBeCloseTo(0.01994, 5);
      expect(callArgs.price).toBe(50150);
      expect(callArgs.newClientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);

      // Verify result processing
      expect(result.orderId).toBe(123456789);
      expect(result.status).toBe("FILLED");
      expect(result.executedQty.toString()).toBe("0.01994");
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

      mockBinanceClient.createOrder.mockRejectedValue(
        new Error("Insufficient balance"),
      );

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Insufficient balance");

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

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeOther["BNB"].toString()).toBe("0.001");
      expect(result.feeBTC.toString()).toBe("0");
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
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);

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
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);

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
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockRejectedValueOnce(errorWithCode)
        .mockResolvedValue(mockOrder);

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
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockRejectedValueOnce(errorWithCode)
        .mockResolvedValue(mockOrder);

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
