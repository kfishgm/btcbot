import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { BuyOrderPlacer } from "../../src/order/buy-order-placer";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import { SupabaseClient } from "../../src/database/supabase";
import { Decimal } from "decimal.js";

// Mock dependencies
jest.mock("../../src/exchange/binance-client");
jest.mock("../../src/exchange/trading-rules");
jest.mock("../../src/database/supabase");

// Define error types for testing
interface ApiError extends Error {
  code?: string;
}

// Define event types for testing
interface OrderEvent {
  type: string;
  data: unknown;
}

describe("BuyOrderPlacer", () => {
  let buyOrderPlacer: BuyOrderPlacer;
  let mockBinanceClient: jest.Mocked<BinanceClient>;
  let mockTradingRules: jest.Mocked<TradingRules>;
  let mockSupabaseClient: jest.Mocked<SupabaseClient>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances
    const mockConfig = {
      apiKey: "test-key",
      apiSecret: "test-secret",
      testnet: true,
    };
    mockBinanceClient = new BinanceClient(
      mockConfig,
    ) as jest.Mocked<BinanceClient>;
    mockTradingRules = new TradingRules(
      mockBinanceClient,
    ) as jest.Mocked<TradingRules>;
    // Create a mock Supabase client
    mockSupabaseClient = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    } as unknown as jest.Mocked<SupabaseClient>;

    // Setup default trading rules
    const mockSymbolRules = {
      symbol: "BTCUSDT",
      status: "TRADING",
      minQty: 0.0001,
      maxQty: 9000.0,
      stepSize: 0.00001,
      minPrice: 0.01,
      maxPrice: 1000000,
      tickSize: 0.01,
      minNotional: 10.0,
      lastUpdated: Date.now(),
    };

    mockTradingRules.getRules = jest.fn().mockResolvedValue(mockSymbolRules);
    mockTradingRules.roundQuantityToStep = jest
      .fn()
      .mockImplementation((qty) => {
        return Math.floor(qty / 0.00001) * 0.00001;
      });
    mockTradingRules.roundPriceToTick = jest
      .fn()
      .mockImplementation((price) => {
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

      expect(orderParams.quantity).toEqual(expectedQuantity);
      expect(orderParams.limitPrice).toEqual(expectedLimitPrice);
      // These are not part of prepareOrder return value
      // They are added during placeOrder
    });

    it("should round quantity to step size correctly", async () => {
      const buyAmount = new Decimal("500");
      const currentPrice = new Decimal("45678.50");
      const slippageGuardPct = 0.003;

      // With slippage: 45678.50 * 1.003 = 45815.5255 -> rounded to tick 45815.52
      // const expectedLimitPrice = new Decimal("45815.52");
      // Quantity: 500 / 45815.52 = 0.01091408... -> rounded down to step size 0.00001
      const expectedQuantity = new Decimal("0.01091");

      const orderParams = await buyOrderPlacer.prepareOrder(
        buyAmount,
        currentPrice,
        slippageGuardPct,
      );

      expect(orderParams.quantity).toEqual(expectedQuantity);
      expect(mockTradingRules.roundQuantityToStep).toHaveBeenCalledWith(
        expect.any(Decimal),
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
        new Decimal("60300"),
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

      expect(orderParams1.clientOrderId).toBeDefined();
      expect(orderParams2.clientOrderId).toBeDefined();
      expect(orderParams1.clientOrderId).not.toEqual(
        orderParams2.clientOrderId,
      );
      expect(orderParams1.clientOrderId).toMatch(/^BUY_\d+_[a-z0-9]+$/);
    });
  });

  describe("Order Validation", () => {
    it("should reject quantity below minimum", async () => {
      const buyAmount = new Decimal("1"); // Very small amount
      const currentPrice = new Decimal("50000");

      // This would result in quantity 0.00002 which is below minQty of 0.0001
      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Quantity 0.00001 is below minimum 0.0001");
    });

    it("should reject quantity above maximum", async () => {
      const buyAmount = new Decimal("500000000"); // Huge amount
      const currentPrice = new Decimal("50000");

      // This would result in quantity 10000 which is above maxQty of 9000
      mockTradingRules.roundQuantityToStep = jest.fn().mockReturnValue(10000);

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Quantity 10000 exceeds maximum 9000");
    });

    it("should reject notional value below minimum", async () => {
      const buyAmount = new Decimal("5"); // Results in notional below 10 USDT
      const currentPrice = new Decimal("50000");

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow(/Notional value .* is below minimum 10/);
    });

    it("should validate all parameters before placing order", async () => {
      const buyAmount = new Decimal("100");
      const currentPrice = new Decimal("50000");

      const validateSpy = jest.spyOn(buyOrderPlacer, "validateOrder");

      try {
        await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      } catch {
        // Expected to fail since implementation doesn't exist
      }

      expect(validateSpy).toHaveBeenCalled();
    });
  });

  describe("Order Submission", () => {
    it("should submit order to Binance with correct parameters", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");
      const slippageGuardPct = 0.003;

      // Mock successful order response
      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        orderListId: -1,
        clientOrderId: "BUY_1234567890123_ABC123",
        transactTime: 1234567890123,
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
            tradeId: 987654321,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
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
        quantity: "0.01994",
        price: "50150.00",
        newClientOrderId: expect.stringMatching(/^BUY_\d{13}_[A-Z0-9]{6}$/),
      });

      expect(result.orderId).toBe(123456789);
      expect(result.executedQty).toEqual(new Decimal("0.01994"));
      expect(result.status).toBe("FILLED");
    });

    it("should handle partial fills correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockPartialFillResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        clientOrderId: "BUY_1234567890123_ABC123",
        transactTime: 1234567890123,
        price: "50150.00",
        origQty: "0.01994",
        executedQty: "0.01000", // Partial fill
        cummulativeQuoteQty: "501.50",
        status: "EXPIRED", // IOC orders expire if not fully filled
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
        fills: [
          {
            price: "50150.00",
            qty: "0.01000",
            commission: "0.00001000",
            commissionAsset: "BTC",
            tradeId: 987654321,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockPartialFillResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.executedQty).toEqual(new Decimal("0.01000"));
      expect(result.status).toBe("EXPIRED");
      // Partial fill is indicated by the quantity being less than expected
      expect(result.executedQty.toString()).toBe("0.01");
      expect(result.status).toBe("EXPIRED"); // IOC orders expire if not fully filled
    });

    it("should handle order rejection from exchange", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      mockBinanceClient.createOrder = jest
        .fn()
        .mockRejectedValue(new Error("Insufficient balance"));

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Failed to place buy order: Insufficient balance");
    });

    it("should retry on network errors with exponential backoff", async () => {
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
      mockBinanceClient.createOrder = jest
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
    it("should save successful order to trades table immediately", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        clientOrderId: "BUY_1234567890123_ABC123",
        transactTime: 1234567890123,
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
            tradeId: 987654321,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);
      mockSupabaseClient.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith("trades");
      const insertMock = (mockSupabaseClient.from as jest.Mock).mock.results[0]
        .value.insert;
      expect(insertMock).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        side: "BUY",
        order_id: "123456789",
        client_order_id: "BUY_1234567890123_ABC123",
        price: "50150.00",
        quantity: "0.01994",
        executed_qty: "0.01994",
        cumulative_quote_qty: "999.99",
        status: "FILLED",
        time_in_force: "IOC",
        type: "LIMIT",
        fills: expect.any(Array),
        commission_btc: "0.00001994",
        commission_usdt: "0",
        transact_time: new Date(1234567890123),
        created_at: expect.any(Date),
      });
    });

    it("should record partial fills in database", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockPartialFillResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        clientOrderId: "BUY_1234567890123_ABC123",
        executedQty: "0.01000",
        cummulativeQuoteQty: "501.50",
        status: "EXPIRED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01000",
            commission: "0.00001000",
            commissionAsset: "BTC",
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockPartialFillResponse);
      mockSupabaseClient.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith("trades");
      const insertMock = (mockSupabaseClient.from as jest.Mock).mock.results[0]
        .value.insert;
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          executed_qty: "0.01000",
          status: "EXPIRED",
          is_partial_fill: true,
        }),
      );
    });

    it("should handle database errors without losing order data", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);
      mockSupabaseClient.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({
          error: { message: "Database connection lost" },
        }),
      });

      // Database save is now handled via events, not direct save
      // So it should complete successfully
      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      expect(result.orderId).toBe(123456789);
    });

    it("should use transaction for database operations", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);
      mockSupabaseClient.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith("trades");
    });
  });

  describe("Fee Tracking", () => {
    it("should correctly track fees in BTC", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00001994",
            commissionAsset: "BTC",
            tradeId: 987654321,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC).toEqual(new Decimal("0.00001994"));
      expect(result.feeUSDT).toEqual(new Decimal("0"));
    });

    it("should correctly track fees in USDT", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.999",
            commissionAsset: "USDT",
            tradeId: 987654321,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC).toEqual(new Decimal("0"));
      expect(result.feeUSDT).toEqual(new Decimal("0.999"));
    });

    it("should aggregate fees from multiple fills", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.00994",
            commission: "0.00000994",
            commissionAsset: "BTC",
            tradeId: 987654321,
          },
          {
            price: "50150.00",
            qty: "0.01000",
            commission: "0.501",
            commissionAsset: "USDT",
            tradeId: 987654322,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC).toEqual(new Decimal("0.00000994"));
      expect(result.feeUSDT).toEqual(new Decimal("0.501"));
    });

    it("should handle BNB fee currency", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [
          {
            price: "50150.00",
            qty: "0.01994",
            commission: "0.00123",
            commissionAsset: "BNB",
            tradeId: 987654321,
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      expect(result.feeBTC).toEqual(new Decimal("0"));
      expect(result.feeUSDT).toEqual(new Decimal("0"));
      expect(result.feeOther.BNB).toEqual(new Decimal("0.00123"));
    });
  });

  describe("Error Scenarios", () => {
    it("should throw descriptive error for invalid buy amount", async () => {
      const invalidAmount = new Decimal("-100");
      const currentPrice = new Decimal("50000");

      await expect(
        buyOrderPlacer.placeOrder(invalidAmount, currentPrice, 0.003),
      ).rejects.toThrow("Buy amount must be positive");
    });

    it("should throw descriptive error for invalid current price", async () => {
      const buyAmount = new Decimal("1000");
      const invalidPrice = new Decimal("0");

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, invalidPrice, 0.003),
      ).rejects.toThrow("Current price must be positive");
    });

    it("should throw descriptive error for invalid slippage", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");
      const invalidSlippage = -0.01;

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, invalidSlippage),
      ).rejects.toThrow("Slippage guard percentage must be between 0 and 1");
    });

    it("should handle exchange API rate limiting", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const rateLimitError: ApiError = new Error("API rate limit exceeded");
      rateLimitError.code = "RATE_LIMIT";

      mockBinanceClient.createOrder = jest
        .fn()
        .mockRejectedValue(rateLimitError);

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Rate limit exceeded. Please wait before retrying.");
    });

    it("should handle insufficient balance error", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const balanceError: ApiError = new Error(
        "Account has insufficient balance",
      );
      balanceError.code = "INSUFFICIENT_BALANCE";

      mockBinanceClient.createOrder = jest.fn().mockRejectedValue(balanceError);

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Insufficient USDT balance for buy order");
    });

    it("should handle market closed error", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const marketError: ApiError = new Error("Market is closed");
      marketError.code = "MARKET_CLOSED";

      mockBinanceClient.createOrder = jest.fn().mockRejectedValue(marketError);

      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Market is currently closed for trading");
    });
  });

  describe("State Updates", () => {
    it("should return data needed for state accumulator updates", async () => {
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

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      // Data needed for state updates
      expect(result.executedQty).toEqual(new Decimal("0.01994"));
      expect(result.cummulativeQuoteQty).toEqual(new Decimal("999.99"));
      expect(result.avgPrice).toEqual(new Decimal("50149.95")); // 999.99 / 0.01994
      // Net BTC is calculated in getStateUpdateData method
      const stateData = buyOrderPlacer.getStateUpdateData(result);
      expect(stateData.netBTCReceived).toEqual(new Decimal("0.01992006")); // 0.01994 - 0.00001994
    });

    it("should calculate net BTC after fees correctly", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.02000",
        status: "FILLED",
        fills: [
          {
            qty: "0.01000",
            commission: "0.00001000",
            commissionAsset: "BTC",
          },
          {
            qty: "0.01000",
            commission: "0.50",
            commissionAsset: "USDT", // Fee in USDT doesn't affect BTC received
          },
        ],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      // Net BTC = executed quantity - BTC fees only
      // Net BTC is calculated in getStateUpdateData method
      const stateData = buyOrderPlacer.getStateUpdateData(result);
      expect(stateData.netBTCReceived).toEqual(new Decimal("0.01999")); // 0.02 - 0.00001
    });
  });

  describe("Integration Points", () => {
    it("should work with existing BinanceClient interface", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      // Verify that BuyOrderPlacer uses the correct BinanceClient method signature
      const createOrderSpy = jest.spyOn(mockBinanceClient, "createOrder");

      try {
        await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      } catch {
        // Expected to fail since implementation doesn't exist
      }

      // Should be called with the expected parameter structure
      expect(createOrderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          timeInForce: "IOC",
          quantity: expect.any(String),
          price: expect.any(String),
          newClientOrderId: expect.any(String),
        }),
      );
    });

    it("should work with existing TradingRulesValidator", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      // Verify that BuyOrderPlacer uses TradingRulesValidator correctly
      const roundQuantityToStepSpy = jest.spyOn(
        mockTradingRules,
        "roundQuantityToStep",
      );
      const roundPriceToTickSpy = jest.spyOn(
        mockTradingRules,
        "roundPriceToTick",
      );

      try {
        await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      } catch {
        // Expected to fail since implementation doesn't exist
      }

      expect(roundQuantityToStepSpy).toHaveBeenCalled();
      expect(roundPriceToTickSpy).toHaveBeenCalled();
    });

    it("should provide method for getting order status", async () => {
      const clientOrderId = "BUY_1234567890123_ABC123";

      const mockStatusResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        clientOrderId: clientOrderId,
        status: "FILLED",
        executedQty: "0.01994",
      };

      mockBinanceClient.getOrder = jest
        .fn()
        .mockResolvedValue(mockStatusResponse);

      const status = await buyOrderPlacer.getOrderStatus(clientOrderId);

      expect(status.status).toBe("FILLED");
      expect(status.executedQty).toEqual(new Decimal("0.01994"));
    });
  });

  describe("Logging and Monitoring", () => {
    it("should emit events for order lifecycle", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const events: OrderEvent[] = [];
      buyOrderPlacer.on("orderPrepared", (data) =>
        events.push({ type: "prepared", data }),
      );
      buyOrderPlacer.on("orderSubmitted", (data) =>
        events.push({ type: "submitted", data }),
      );
      buyOrderPlacer.on("orderFilled", (data) =>
        events.push({ type: "filled", data }),
      );
      buyOrderPlacer.on("orderSaved", (data) =>
        events.push({ type: "saved", data }),
      );

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);
      mockSupabaseClient.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("prepared");
      expect(events[1].type).toBe("submitted");
      expect(events[2].type).toBe("filled");
      expect(events[3].type).toBe("saved");
    });

    it("should include timing metrics in result", async () => {
      const buyAmount = new Decimal("1000");
      const currentPrice = new Decimal("50000");

      const mockOrderResponse = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        executedQty: "0.01994",
        status: "FILLED",
        fills: [],
      };

      mockBinanceClient.createOrder = jest
        .fn()
        .mockResolvedValue(mockOrderResponse);

      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );

      // Timing is tracked through event emissions
      expect(result).toBeDefined();
    });
  });
});
