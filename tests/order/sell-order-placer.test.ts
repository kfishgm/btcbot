import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  SellOrderPlacer,
  TradeRecord,
} from "../../src/order/sell-order-placer";
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

describe("SellOrderPlacer", () => {
  let sellOrderPlacer: SellOrderPlacer;
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
      // Real rounding logic for BTCUSDT
      const stepSize = 0.00001;
      return Math.round(qty / stepSize) * stepSize;
    });

    const roundPriceFn = jest.fn<(price: number, _symbol: string) => number>();
    roundPriceFn.mockImplementation((price: number, _symbol: string) => {
      // Real rounding logic for BTCUSDT
      const tickSize = 0.01;
      return Math.floor(price / tickSize) * tickSize;
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

    // Create SellOrderPlacer instance with null supabase client (we use events instead)
    sellOrderPlacer = new SellOrderPlacer(
      mockBinanceClient as unknown as BinanceClient,
      mockTradingRules as unknown as TradingRules,
      null, // Supabase client is not used directly
      "BTCUSDT",
    );
  });

  describe("Order Preparation", () => {
    it("should prepare sell order with correct quantity and price", async () => {
      const btcAccumulated = new Decimal("0.5"); // Sell 0.5 BTC
      const currentPrice = new Decimal("50000");
      const slippageGuardPct = 0.003; // 0.3% slippage

      const orderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        slippageGuardPct,
      );

      // Test the actual calculation logic
      // limit_price = 50000 * (1 - 0.003) = 49850
      // quantity = 0.5 (selling ALL btc_accumulated)
      expect(orderParams.symbol).toBe("BTCUSDT");
      expect(orderParams.limitPrice.toNumber()).toBe(49850);
      expect(orderParams.quantity.toNumber()).toBe(0.5);
      expect(orderParams.clientOrderId).toMatch(/^SELL_\d+_[a-z0-9]+$/);
    });

    it("should always sell ALL btc_accumulated (never partial)", async () => {
      const btcAccumulated = new Decimal("1.23456789"); // Exact amount with many decimals
      const currentPrice = new Decimal("45000");
      const slippageGuardPct = 0.005; // 0.5%

      const orderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        slippageGuardPct,
      );

      // Should round to step size but use ALL accumulated BTC
      // 1.23456789 -> rounded to 1.23457 (step size 0.00001)
      expect(orderParams.quantity.toNumber()).toBeCloseTo(1.23457, 5);
      // limit_price = 45000 * (1 - 0.005) = 44775
      expect(orderParams.limitPrice.toNumber()).toBe(44775);
    });

    it("should apply slippage guard correctly to sell price", async () => {
      const btcAccumulated = new Decimal("0.1");
      const currentPrice = new Decimal("60000");
      const slippageGuardPct = 0.002; // 0.2%

      const orderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        slippageGuardPct,
      );

      // limit_price_sell = 60000 * (1 - 0.002) = 59880
      expect(orderParams.limitPrice.toNumber()).toBe(59880);
    });

    it("should use default slippage guard of 0.3% if not specified", async () => {
      const btcAccumulated = new Decimal("0.25");
      const currentPrice = new Decimal("50000");

      // Test with explicit 0.003 (0.3%)
      const orderParamsWithDefault = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        0.003,
      );

      expect(orderParamsWithDefault.limitPrice.toNumber()).toBe(49850); // 50000 * 0.997
    });

    it("should generate unique client order IDs", async () => {
      const btcAccumulated = new Decimal("0.1");
      const currentPrice = new Decimal("50000");

      const order1 = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        0.003,
      );
      const order2 = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        0.003,
      );

      expect(order1.clientOrderId).not.toBe(order2.clientOrderId);
      expect(order1.clientOrderId).toMatch(/^SELL_\d+_[a-z0-9]+$/);
      expect(order2.clientOrderId).toMatch(/^SELL_\d+_[a-z0-9]+$/);
    });

    it("should throw error for zero BTC balance", async () => {
      const btcAccumulated = new Decimal("0");
      const currentPrice = new Decimal("50000");

      await expect(
        sellOrderPlacer.prepareOrder(btcAccumulated, currentPrice, 0.003),
      ).rejects.toThrow("BTC amount to sell must be greater than 0");
    });

    it("should throw error for negative BTC balance", async () => {
      const btcAccumulated = new Decimal("-0.1");
      const currentPrice = new Decimal("50000");

      await expect(
        sellOrderPlacer.prepareOrder(btcAccumulated, currentPrice, 0.003),
      ).rejects.toThrow("BTC amount to sell must be greater than 0");
    });

    it("should throw error for invalid price", async () => {
      const btcAccumulated = new Decimal("0.1");
      const invalidPrice = new Decimal("0");

      await expect(
        sellOrderPlacer.prepareOrder(btcAccumulated, invalidPrice, 0.003),
      ).rejects.toThrow("Current price must be greater than 0");
    });

    it("should throw error for invalid slippage guard", async () => {
      const btcAccumulated = new Decimal("0.1");
      const currentPrice = new Decimal("50000");

      await expect(
        sellOrderPlacer.prepareOrder(btcAccumulated, currentPrice, -0.01),
      ).rejects.toThrow("Slippage guard percentage must be between 0 and 0.1");

      await expect(
        sellOrderPlacer.prepareOrder(btcAccumulated, currentPrice, 0.2),
      ).rejects.toThrow("Slippage guard percentage must be between 0 and 0.1");
    });
  });

  describe("Order Validation", () => {
    it("should validate order against minimum quantity", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("0.000001"), // Below minimum 0.00001
        limitPrice: new Decimal("50000"),
        clientOrderId: "test-order",
      };

      await expect(sellOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order quantity 0.000001 is below minimum 0.00001",
      );
    });

    it("should validate order against maximum quantity", async () => {
      const orderParams = {
        symbol: "BTCUSDT",
        quantity: new Decimal("10000"), // Above maximum 9000
        limitPrice: new Decimal("50000"),
        clientOrderId: "test-order",
      };

      await expect(sellOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
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

      await expect(sellOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
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
        sellOrderPlacer.validateOrder(orderParams),
      ).resolves.toBeUndefined();
    });

    it("should validate quantity after rounding to step size", async () => {
      const btcAccumulated = new Decimal("0.000004"); // Below minimum after rounding
      const currentPrice = new Decimal("50000");

      // This should fail because 0.000004 rounds to 0
      await expect(
        sellOrderPlacer.prepareOrder(btcAccumulated, currentPrice, 0.003),
      ).rejects.toThrow("BTC amount too small after rounding to step size");
    });
  });

  describe("Order Placement", () => {
    it("should place a LIMIT IOC sell order successfully", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        orderId: 987654321,
        clientOrderId: "SELL_123_xyz",
        symbol: "BTCUSDT",
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00", // 0.5 * 49850
        status: "FILLED" as OrderStatus,
        side: "SELL",
        type: "LIMIT",
        timeInForce: "IOC",
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      // Verify correct order parameters were sent
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(1);
      const callArgs = mockBinanceClient.createOrder.mock.calls[0][0];
      expect(callArgs.symbol).toBe("BTCUSDT");
      expect(callArgs.side).toBe("SELL");
      expect(callArgs.type).toBe("LIMIT");
      expect(callArgs.timeInForce).toBe("IOC"); // Must be IOC per STRATEGY.md
      expect(callArgs.quantity).toBe(0.5);
      expect(callArgs.price).toBe(49850); // 50000 * (1 - 0.003)
      expect(callArgs.newClientOrderId).toMatch(/^SELL_\d+_[a-z0-9]+$/);

      // Verify result processing
      expect(result.orderId).toBe(987654321);
      expect(result.status).toBe("FILLED");
      expect(result.executedQty.toString()).toBe("0.5");
      expect(result.cummulativeQuoteQty.toString()).toBe("24925");
    });

    it("should handle partial fills correctly", async () => {
      const btcAccumulated = new Decimal("1.0");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        orderId: 987654321,
        clientOrderId: "SELL_123_xyz",
        executedQty: "0.7", // Only partially filled
        cummulativeQuoteQty: "34895.00", // 0.7 * 49850
        status: "PARTIALLY_FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(result.status).toBe("PARTIALLY_FILLED");
      expect(result.executedQty.toString()).toBe("0.7");
      // Partial fill means some BTC remains unsold
    });

    it("should handle IOC order cancellation (no fill)", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        orderId: 987654321,
        clientOrderId: "SELL_123_xyz",
        executedQty: "0", // No fill at all
        cummulativeQuoteQty: "0",
        status: "EXPIRED" as OrderStatus, // IOC orders expire if not filled
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(result.status).toBe("EXPIRED");
      expect(result.executedQty.toString()).toBe("0");
    });

    it("should retry on network errors", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockSuccessResponse = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      // First two calls fail with network errors, third succeeds
      mockBinanceClient.createOrder
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
      expect(result.orderId).toBe(987654321);
    });

    it("should not retry on non-retryable errors", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      mockBinanceClient.createOrder.mockRejectedValue(
        new Error("Insufficient balance"),
      );

      await expect(
        sellOrderPlacer.placeOrder(
          btcAccumulated,
          currentPrice,
          new Decimal("48000"),
          0.003,
        ),
      ).rejects.toThrow("Insufficient balance");

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe("Fee Tracking", () => {
    it("should track BTC fees correctly", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrderWithBTCFee = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "49850.00",
            qty: "0.5",
            commission: "0.0005", // Fee in BTC
            commissionAsset: "BTC",
            tradeId: 654321,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderWithBTCFee);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(result.feeBTC.toString()).toBe("0.0005");
      expect(result.feeUSDT.toString()).toBe("0");
    });

    it("should track USDT fees correctly", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrderWithUSDTFee = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "49850.00",
            qty: "0.5",
            commission: "24.925", // Fee in USDT
            commissionAsset: "USDT",
            tradeId: 654322,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderWithUSDTFee);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(result.feeUSDT.toString()).toBe("24.925");
      expect(result.feeBTC.toString()).toBe("0");
    });

    it("should track other currency fees correctly", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrderWithBNBFee = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "49850.00",
            qty: "0.5",
            commission: "0.05", // Fee in BNB
            commissionAsset: "BNB",
            tradeId: 654323,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderWithBNBFee);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(result.feeOther["BNB"].toString()).toBe("0.05");
      expect(result.feeBTC.toString()).toBe("0");
      expect(result.feeUSDT.toString()).toBe("0");
    });

    it("should aggregate fees across multiple fills", async () => {
      const btcAccumulated = new Decimal("1.0");
      const currentPrice = new Decimal("50000");

      const mockOrderWithMultipleFills = {
        orderId: 987654321,
        executedQty: "1.0",
        cummulativeQuoteQty: "49850.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "49850.00",
            qty: "0.5",
            commission: "0.0005",
            commissionAsset: "BTC",
            tradeId: 654324,
          },
          {
            price: "49850.00",
            qty: "0.3",
            commission: "14.955",
            commissionAsset: "USDT",
            tradeId: 654325,
          },
          {
            price: "49850.00",
            qty: "0.2",
            commission: "0.0002",
            commissionAsset: "BTC",
            tradeId: 654326,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(
        mockOrderWithMultipleFills,
      );

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(result.feeBTC.toString()).toBe("0.0007"); // 0.0005 + 0.0002
      expect(result.feeUSDT.toString()).toBe("14.955");
    });
  });

  describe("Profit Calculation", () => {
    it("should calculate profit correctly for complete sale", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("60000"); // Selling at higher price
      const referencePrice = new Decimal("50000"); // Bought at this price

      const mockOrderResponse = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "29910.00", // 0.5 * 59820 (with slippage)
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "59820.00",
            qty: "0.5",
            commission: "29.91", // USDT fee
            commissionAsset: "USDT",
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      const profitData = sellOrderPlacer.calculateProfit(
        result.executedQty,
        result.cummulativeQuoteQty,
        result.feeUSDT,
        result.feeBTC,
        referencePrice,
        result.avgPrice,
      );

      // principal = 50000 * 0.5 = 25000
      // net_usdt_received = 29910 - 29.91 = 29880.09
      // profit = max(0, 29880.09 - 25000) = 4880.09
      expect(profitData.principal.toNumber()).toBeCloseTo(25000, 2);
      expect(profitData.netUsdtReceived.toNumber()).toBeCloseTo(29880.09, 2);
      expect(profitData.profit.toNumber()).toBeCloseTo(4880.09, 2);
    });

    it("should never return negative profit", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("40000"); // Selling at lower price
      const referencePrice = new Decimal("50000"); // Bought at higher price

      const mockOrderResponse = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "19940.00", // 0.5 * 39880 (with slippage)
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "39880.00",
            qty: "0.5",
            commission: "19.94", // USDT fee
            commissionAsset: "USDT",
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      const profitData = sellOrderPlacer.calculateProfit(
        result.executedQty,
        result.cummulativeQuoteQty,
        result.feeUSDT,
        result.feeBTC,
        referencePrice,
        result.avgPrice,
      );

      // principal = 50000 * 0.5 = 25000
      // net_usdt_received = 19940 - 19.94 = 19920.06
      // profit = max(0, 19920.06 - 25000) = 0 (not negative)
      expect(profitData.principal.toNumber()).toBeCloseTo(25000, 2);
      expect(profitData.netUsdtReceived.toNumber()).toBeCloseTo(19920.06, 2);
      expect(profitData.profit.toNumber()).toBe(0); // Never negative
    });

    it("should account for BTC fees in profit calculation", async () => {
      const btcAccumulated = new Decimal("1.0");
      const currentPrice = new Decimal("55000");
      const referencePrice = new Decimal("50000");

      const mockOrderResponse = {
        orderId: 987654321,
        executedQty: "1.0",
        cummulativeQuoteQty: "54835.00", // 1.0 * 54835 (with slippage)
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "54835.00",
            qty: "1.0",
            commission: "0.001", // BTC fee (reduces BTC sold)
            commissionAsset: "BTC",
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderResponse);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      const profitData = sellOrderPlacer.calculateProfit(
        result.executedQty,
        result.cummulativeQuoteQty,
        result.feeUSDT,
        result.feeBTC,
        referencePrice,
        result.avgPrice,
      );

      // When fee is in BTC, it doesn't affect USDT calculation
      // principal = 50000 * 1.0 = 50000
      // net_usdt_received = 54835 (no USDT fee)
      // profit = max(0, 54835 - 50000) = 4835
      // BTC fees reduce the actual BTC sold, not the USDT received
      expect(profitData.principal.toNumber()).toBe(50000);
      expect(profitData.netUsdtReceived.toNumber()).toBe(54835);
      expect(profitData.profit.toNumber()).toBe(4835);
    });
  });

  describe("Event Emission", () => {
    it("should emit proper events during order placement", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 987654321,
        executedQty: "0.5",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);

      const events: Array<{ event: string; data: unknown }> = [];

      sellOrderPlacer.on("orderPlacing", (data) =>
        events.push({ event: "orderPlacing", data }),
      );
      sellOrderPlacer.on("orderExecuted", (data) =>
        events.push({ event: "orderExecuted", data }),
      );
      sellOrderPlacer.on("orderCompleted", (data) =>
        events.push({ event: "orderCompleted", data }),
      );

      await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(events).toHaveLength(3);
      expect(events[0].event).toBe("orderPlacing");
      expect(events[1].event).toBe("orderExecuted");
      expect(events[2].event).toBe("orderCompleted");
    });

    it("should emit error event on failure", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      mockBinanceClient.createOrder.mockRejectedValue(new Error("API Error"));

      let errorEventData: { error: Error } | undefined;

      sellOrderPlacer.on(
        "orderFailed",
        (data: { error: Error }) => (errorEventData = data),
      );

      try {
        await sellOrderPlacer.placeOrder(
          btcAccumulated,
          currentPrice,
          new Decimal("48000"),
          0.003,
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("API Error");
      }

      expect(errorEventData).toBeDefined();
      expect(errorEventData?.error).toBeInstanceOf(Error);
      expect(errorEventData?.error.message).toBe("API Error");
    });
  });

  describe("Database Integration", () => {
    it("should emit trade record with cycle ID when set", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);

      // Set cycle ID
      sellOrderPlacer.setCycleId("CYCLE_TEST_002");

      let tradeRecord: TradeRecord | undefined;
      sellOrderPlacer.on("tradeRecordReady", (data: TradeRecord) => {
        tradeRecord = data;
      });

      await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(tradeRecord).toBeDefined();
      expect(tradeRecord?.cycle_id).toBe("CYCLE_TEST_002");
      expect(tradeRecord?.type).toBe("SELL");
      expect(tradeRecord?.order_id).toBe("987654321");
      expect(tradeRecord?.status).toBe("FILLED");
      expect(tradeRecord?.quantity).toBe(0.5);
      expect(tradeRecord?.quote_quantity).toBe(24925);
    });

    it("should emit profit record when sale completes", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("60000");
      const referencePrice = new Decimal("50000");

      const mockOrder = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "29910.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "59820.00",
            qty: "0.5",
            commission: "29.91",
            commissionAsset: "USDT",
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);
      sellOrderPlacer.setCycleId("CYCLE_TEST_003");

      let profitRecord:
        | { cycle_id: string; profit: Decimal; principal: Decimal }
        | undefined;
      sellOrderPlacer.on(
        "profitCalculated",
        (data: {
          btcSold: Decimal;
          usdtReceived: Decimal;
          principal: Decimal;
          profit: Decimal;
          netUsdtReceived: Decimal;
        }) => {
          profitRecord = {
            cycle_id: "CYCLE_TEST_003",
            principal: data.principal,
            profit: data.profit,
          };
        },
      );

      await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        referencePrice,
        0.003,
      );

      expect(profitRecord).toBeDefined();
      expect(profitRecord?.cycle_id).toBe("CYCLE_TEST_003");
      expect(profitRecord?.profit.toNumber()).toBeCloseTo(4880.09, 2);
      expect(profitRecord?.principal.toNumber()).toBe(25000);
    });
  });

  describe("State Update Data", () => {
    it("should calculate state update data correctly", async () => {
      const btcAccumulated = new Decimal("1.0");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 987654321,
        executedQty: "1.0",
        cummulativeQuoteQty: "49850.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "49850.00",
            qty: "1.0",
            commission: "49.85",
            commissionAsset: "USDT",
            tradeId: 123456,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );
      const stateData = sellOrderPlacer.getStateUpdateData(result);

      expect(stateData.btcSold.toString()).toBe("1");
      expect(stateData.usdtReceived.toString()).toBe("49850");
      expect(stateData.netUsdtReceived.toString()).toBe("49800.15"); // 49850 - 49.85
      expect(stateData.avgPrice.toString()).toBe(result.avgPrice.toString());
    });

    it("should handle BTC fees in state update", async () => {
      const btcAccumulated = new Decimal("1.0");
      const currentPrice = new Decimal("50000");

      const mockOrder = {
        orderId: 987654321,
        executedQty: "1.0",
        cummulativeQuoteQty: "49850.00",
        status: "FILLED" as OrderStatus,
        fills: [
          {
            price: "49850.00",
            qty: "1.0",
            commission: "0.001",
            commissionAsset: "BTC",
            tradeId: 123456,
          },
        ],
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrder);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );
      const stateData = sellOrderPlacer.getStateUpdateData(result);

      // When fee is in BTC, the USDT received is not reduced
      expect(stateData.btcSold.toString()).toBe("1");
      expect(stateData.usdtReceived.toString()).toBe("49850");
      expect(stateData.netUsdtReceived.toString()).toBe("49850"); // No USDT fee
    });
  });

  describe("Retry Logic", () => {
    it("should retry on rate limit errors", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const errorWithCode = new Error("Rate limit exceeded") as Error & {
        code: string;
      };
      errorWithCode.code = "-1003";

      const mockOrder = {
        orderId: 987654321,
        executedQty: "0.5",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockRejectedValueOnce(errorWithCode)
        .mockResolvedValue(mockOrder);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(2);
      expect(result.orderId).toBe(987654321);
    });

    it("should retry on internal Binance errors", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const errorWithCode = new Error("Internal error") as Error & {
        code: string;
      };
      errorWithCode.code = "-1001";

      const mockOrder = {
        orderId: 987654321,
        executedQty: "0.5",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockRejectedValueOnce(errorWithCode)
        .mockResolvedValue(mockOrder);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(2);
      expect(result.orderId).toBe(987654321);
    });

    it("should handle maximum retry attempts", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const networkError = new Error("Network timeout");

      // Fail all retries
      mockBinanceClient.createOrder.mockRejectedValue(networkError);

      await expect(
        sellOrderPlacer.placeOrder(
          btcAccumulated,
          currentPrice,
          new Decimal("48000"),
          0.003,
        ),
      ).rejects.toThrow("Network timeout");

      // Should try 3 times (initial + 2 retries)
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
    });
  });

  describe("Order Status Query", () => {
    it("should get order status by client order ID", async () => {
      const mockOrder = {
        orderId: 987654321,
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.getOrder.mockResolvedValue(mockOrder);

      const status = await sellOrderPlacer.getOrderStatus("SELL_123_xyz");

      expect(mockBinanceClient.getOrder).toHaveBeenCalledWith(
        "BTCUSDT",
        undefined,
        "SELL_123_xyz",
      );
      expect(status.status).toBe("FILLED");
    });
  });

  describe("Edge Cases", () => {
    it("should handle very small quantities correctly", async () => {
      const btcAccumulated = new Decimal("0.00001"); // Minimum allowed
      const currentPrice = new Decimal("1000000"); // High price to meet min notional

      const orderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        0.003,
      );

      expect(orderParams.quantity.toNumber()).toBe(0.00001);
      // notional = 0.00001 * 997000 = 9.97 USDT (just below 10)
      // This should fail validation
      await expect(sellOrderPlacer.validateOrder(orderParams)).rejects.toThrow(
        "Order notional value 9.97 is below minimum 10",
      );
    });

    it("should handle very large quantities correctly", async () => {
      const btcAccumulated = new Decimal("8999.99999"); // Just below maximum
      const currentPrice = new Decimal("50000");

      const orderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        currentPrice,
        0.003,
      );

      expect(orderParams.quantity.toNumber()).toBe(8999.99999);
      await expect(
        sellOrderPlacer.validateOrder(orderParams),
      ).resolves.toBeUndefined();
    });

    it("should handle price at boundaries correctly", async () => {
      const btcAccumulated = new Decimal("0.01");

      // Test with minimum price that would result in negative after slippage
      const minPrice = new Decimal("0.01");
      const minOrderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        minPrice,
        0.003,
      );
      // 0.01 * 0.997 = 0.00997 which rounds to 0 with tick size 0.01
      expect(minOrderParams.limitPrice.toNumber()).toBe(0);

      // Test with maximum price
      const maxPrice = new Decimal("999999");
      const maxOrderParams = await sellOrderPlacer.prepareOrder(
        btcAccumulated,
        maxPrice,
        0.003,
      );
      expect(maxOrderParams.limitPrice.toNumber()).toBe(996999); // 999999 * 0.997
    });

    it("should handle order with no fills array", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrderNoFills = {
        orderId: 987654321,
        executedQty: "0.5",
        cummulativeQuoteQty: "24925.00",
        status: "FILLED" as OrderStatus,
        // No fills array
      } as BinanceOrder;

      mockBinanceClient.createOrder.mockResolvedValue(mockOrderNoFills);

      const result = await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        new Decimal("48000"),
        0.003,
      );

      // Should handle missing fills gracefully
      expect(result.feeBTC.toString()).toBe("0");
      expect(result.feeUSDT.toString()).toBe("0");
      expect(result.feeOther).toEqual({});
    });

    it("should handle concurrent orders with unique IDs", async () => {
      const btcAccumulated = new Decimal("0.5");
      const currentPrice = new Decimal("50000");

      const mockOrder1 = {
        orderId: 987654321,
        clientOrderId: "SELL_1_abc",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      const mockOrder2 = {
        orderId: 987654322,
        clientOrderId: "SELL_2_def",
        status: "FILLED" as OrderStatus,
      } as BinanceOrder;

      mockBinanceClient.createOrder
        .mockResolvedValueOnce(mockOrder1)
        .mockResolvedValueOnce(mockOrder2);

      // Place orders concurrently
      const [result1, result2] = await Promise.all([
        sellOrderPlacer.placeOrder(
          btcAccumulated,
          currentPrice,
          new Decimal("48000"),
          0.003,
        ),
        sellOrderPlacer.placeOrder(
          btcAccumulated,
          currentPrice,
          new Decimal("48000"),
          0.003,
        ),
      ]);

      expect(result1.clientOrderId).not.toBe(result2.clientOrderId);
      expect(result1.orderId).toBe(987654321);
      expect(result2.orderId).toBe(987654322);
    });
  });
});
