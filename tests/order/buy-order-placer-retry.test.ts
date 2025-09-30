import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { BuyOrderPlacer } from "../../src/order/buy-order-placer";
import { BinanceClient } from "../../src/exchange/binance-client";
import { TradingRules } from "../../src/exchange/trading-rules";
import { Decimal } from "decimal.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SymbolTradingRules,
  BinanceOrder,
  BinanceTrade,
  OrderStatus,
  CreateOrderParams,
} from "../../src/exchange/types";
// Mock types
type MockBinanceClient = {
  createOrder: jest.Mock<(params: CreateOrderParams) => Promise<BinanceOrder>>;
  getOrder: jest.Mock<
    (
      symbol: string,
      orderId?: number,
      origClientOrderId?: string,
    ) => Promise<BinanceOrder>
  >;
  getMyTrades: jest.Mock<
    (symbol: string, orderId?: number) => Promise<BinanceTrade[]>
  >;
  getBalance: jest.Mock<
    (asset: string) => Promise<{ free: number; locked: number }>
  >;
};
type MockTradingRules = {
  getRules: jest.Mock<
    (symbol: string, forceRefresh?: boolean) => Promise<SymbolTradingRules>
  >;
  roundQuantityToStep: jest.Mock<(quantity: number, symbol: string) => number>;
  roundPriceToTick: jest.Mock<(price: number, symbol: string) => number>;
  getMinimumBuyableQuantity: jest.Mock<
    (price: number, symbol: string) => number
  >;
  roundQuantityForBuyOrder: jest.Mock<
    (
      quantity: number,
      targetSpendUSDT: number,
      currentPriceBTC: number,
      symbol: string,
      availableCapital?: number,
    ) => number
  >;
};
describe("BuyOrderPlacer - Retry Logic", () => {
  let buyOrderPlacer: BuyOrderPlacer;
  let mockSupabaseClient: SupabaseClient;
  let mockBinanceClient: MockBinanceClient;
  let mockTradingRules: MockTradingRules;
  beforeEach(() => {
    // Create mock Supabase client
    mockSupabaseClient = {
      from: jest.fn(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({
                data: { id: "test-trade-id" },
                error: null,
              }),
            ),
          })),
        })),
      })),
    } as unknown as SupabaseClient;
    // Create mock Binance client
    mockBinanceClient = {
      createOrder: jest.fn(),
      getOrder: jest.fn(),
      getMyTrades: jest.fn(),
      getBalance: jest.fn(),
    };
    // Create mock Trading Rules
    mockTradingRules = {
      getRules: jest.fn(() =>
        Promise.resolve({
          symbol: "BTCUSDT",
          status: "TRADING",
          minPrice: 1000,
          maxPrice: 100000,
          tickSize: 0.01,
          minQty: 0.00001,
          maxQty: 1000,
          stepSize: 0.00001,
          minNotional: 10,
          lastUpdated: Date.now(),
        } as SymbolTradingRules),
      ),
      roundQuantityToStep: jest.fn((qty) => Math.floor(qty * 100000) / 100000),
      roundPriceToTick: jest.fn((price) => Math.round(price * 100) / 100),
      getMinimumBuyableQuantity: jest.fn(() => 0.00001),
      roundQuantityForBuyOrder: jest.fn(
        (qty, _targetSpend, _price, _symbol, _cap) => {
          // Smart rounding for buy orders - rounds to step size
          return Math.floor(qty * 100000) / 100000;
        },
      ),
    };
    buyOrderPlacer = new BuyOrderPlacer(
      mockBinanceClient as unknown as BinanceClient,
      mockTradingRules as unknown as TradingRules,
      mockSupabaseClient,
      "BTCUSDT",
    );

    // Mock the private sleep method to eliminate delays in tests
    const buyOrderPlacerWithSleep = buyOrderPlacer as unknown as {
      sleep: (ms: number) => Promise<void>;
    };
    jest
      .spyOn(buyOrderPlacerWithSleep, "sleep")
      .mockImplementation(() => Promise.resolve());
  });
  describe("INSUFFICIENT_BALANCE retry mechanism for USDT", () => {
    it("should retry with refreshed balance on INSUFFICIENT_BALANCE error", async () => {
      const buyAmount = new Decimal(1000); // USDT amount
      const currentPrice = new Decimal(50000);
      // First attempt fails with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance for requested action"),
      );
      // Mock USDT balance refresh showing less available
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 800, // Less than requested 1000
        locked: 0,
      });
      // Second attempt succeeds with reduced USDT amount
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.01612", // ~790 USDT worth
        executedQty: "0.01612",
        cummulativeQuoteQty: "789.88",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.01612",
          quoteQty: "0",
          commission: "0.00001612",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      // Verify USDT balance was refreshed
      expect(mockBinanceClient.getBalance).toHaveBeenCalledWith("USDT");
      // Verify order was placed twice (first failed, second succeeded)
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(2);
      // Verify second order used reduced USDT amount
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      const secondCallArg = secondCall?.[0];
      const orderValue =
        secondCallArg?.quantity && secondCallArg?.price
          ? secondCallArg.quantity * secondCallArg.price
          : 0;
      expect(orderValue).toBeLessThan(1000);
      expect(orderValue).toBeLessThanOrEqual(800 * 1.005); // Smart rounding allows up to 0.5% overspend
      // Verify result
      expect(result.executedQty.toString()).toBe("0.01612");
      expect(result.status).toBe("FILLED");
    });
    it("should generate unique clientOrderId for each retry", async () => {
      const buyAmount = new Decimal(500);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance"),
      );
      // Mock balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 400,
        locked: 0,
      });
      // Second attempt also fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance"),
      );
      // Mock another balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 300,
        locked: 0,
      });
      // Third attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_xyz789",
        price: "49000",
        origQty: "0.00606", // ~297 USDT
        executedQty: "0.00606",
        cummulativeQuoteQty: "296.94",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.00606",
          quoteQty: "0",
          commission: "0.00000606",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      // Verify three attempts were made
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
      // Extract clientOrderIds from each call
      const clientOrderIds = mockBinanceClient.createOrder.mock.calls.map(
        (call) => call[0].newClientOrderId,
      );
      // Verify all clientOrderIds are unique
      const uniqueIds = new Set(clientOrderIds);
      expect(uniqueIds.size).toBe(3);
      // Verify all start with BUY_ prefix
      clientOrderIds.forEach((id) => {
        expect(id).toMatch(/^BUY_\d+_[a-z0-9]+$/);
      });
    });
    it("should respect maximum retry attempts for balance errors", async () => {
      const buyAmount = new Decimal(1000);
      const currentPrice = new Decimal(50000);
      // Always fail with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValue(
        new Error("Account has insufficient balance"),
      );
      // Mock balance refreshes (3 times max)
      mockBinanceClient.getBalance
        .mockResolvedValueOnce({ free: 900, locked: 0 })
        .mockResolvedValueOnce({ free: 800, locked: 0 })
        .mockResolvedValueOnce({ free: 700, locked: 0 });
      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Account has insufficient balance");
      // Verify we attempted 4 times total (1 initial + 3 retries)
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(4);
      expect(mockBinanceClient.getBalance).toHaveBeenCalledTimes(3);
    });
    it("should handle balance refresh failures gracefully", async () => {
      const buyAmount = new Decimal(500);
      const currentPrice = new Decimal(50000);
      // First attempt fails with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance"),
      );
      // Balance refresh fails
      mockBinanceClient.getBalance.mockRejectedValueOnce(
        new Error("Network error"),
      );
      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("Network error");
      // Verify we attempted to refresh balance
      expect(mockBinanceClient.getBalance).toHaveBeenCalledTimes(1);
    });
    it("should properly calculate BTC quantity from adjusted USDT amount", async () => {
      const buyAmount = new Decimal(1000);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance showing less USDT
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 600,
        locked: 0,
      });
      // Second attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.01213", // Properly calculated from available USDT
        executedQty: "0.01213",
        cummulativeQuoteQty: "594.37",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.01213",
          quoteQty: "0",
          commission: "0.00001213",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      // Verify the quantity was properly calculated from available USDT
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      const secondCallArg = secondCall?.[0];
      const orderValue =
        secondCallArg?.quantity && secondCallArg?.price
          ? secondCallArg.quantity * secondCallArg.price
          : 0;
      expect(orderValue).toBeLessThanOrEqual(600 * 1.005); // Smart rounding allows up to 0.5% overspend
      // Smart rounding can vary slightly based on step size and price
      expect(secondCallArg?.quantity).toBeCloseTo(0.012, 3); // Within 0.001 BTC
    });
    it("should throw error if adjusted amount is below minimum notional", async () => {
      const buyAmount = new Decimal(100);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance showing very little USDT (below minimum)
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 5, // Below $10 minimum
        locked: 0,
      });
      await expect(
        buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003),
      ).rejects.toThrow("below minimum");
      // Verify we didn't attempt a second order with insufficient amount
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(1);
    });
    it("should account for fees when calculating safe buy amount", async () => {
      const buyAmount = new Decimal(1000);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance exactly at requested amount
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 1000,
        locked: 0,
      });
      // Second attempt succeeds with slightly reduced amount (accounting for fees)
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.02030", // ~994.7 USDT (99.5% of 1000)
        executedQty: "0.02030",
        cummulativeQuoteQty: "994.70",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.02030",
          quoteQty: "0",
          commission: "0.00002030",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      // Verify second order stays within smart rounding limits (up to 0.5% overspend allowed)
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      const secondCallArg = secondCall?.[0];
      const orderValue =
        secondCallArg?.quantity && secondCallArg?.price
          ? secondCallArg.quantity * secondCallArg.price
          : 0;
      expect(orderValue).toBeLessThanOrEqual(1000 * 1.005); // Smart rounding allows up to 0.5% overspend
      expect(orderValue).toBeGreaterThan(990); // But not too much less
    });
    it("should distinguish between balance errors and other retryable errors", async () => {
      const buyAmount = new Decimal(500);
      const currentPrice = new Decimal(50000);
      // First attempt fails with network error (not balance)
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Network timeout"),
      );
      // Second attempt fails with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 400,
        locked: 0,
      });
      // Third attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.00810",
        executedQty: "0.00810",
        cummulativeQuoteQty: "396.90",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.00810",
          quoteQty: "0",
          commission: "0.00000810",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      await buyOrderPlacer.placeOrder(buyAmount, currentPrice, 0.003);
      // Verify balance was only refreshed once (for the balance error)
      expect(mockBinanceClient.getBalance).toHaveBeenCalledTimes(1);
      // Verify three order attempts
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
    });
    it("should correctly use min(capital_available, intended_buy_amount)", async () => {
      const intendedBuyAmount = new Decimal(2000);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance showing less than intended (capital < intended)
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 1500,
        locked: 0,
      });
      // Second attempt succeeds with available capital
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.03045", // ~1492.05 USDT (99.5% of 1500)
        executedQty: "0.03045",
        cummulativeQuoteQty: "1492.05",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.03045",
          quoteQty: "0",
          commission: "0.00003045",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      await buyOrderPlacer.placeOrder(intendedBuyAmount, currentPrice, 0.003);
      // Verify second order used the available capital (less than intended)
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      const secondCallArg = secondCall?.[0];
      const orderValue =
        secondCallArg?.quantity && secondCallArg?.price
          ? secondCallArg.quantity * secondCallArg.price
          : 0;
      expect(orderValue).toBeLessThan(2000);
      expect(orderValue).toBeLessThanOrEqual(1500 * 1.005); // Smart rounding allows up to 0.5% overspend
    });
  });
  describe("Integration with fills data", () => {
    it("should use fills data for reconciliation after retry", async () => {
      const buyAmount = new Decimal(1000);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 800,
        locked: 0,
      });
      // Second attempt succeeds with partial fill
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.01620",
        executedQty: "0.01500", // Partial fill
        cummulativeQuoteQty: "735.00",
        status: "PARTIALLY_FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      // Multiple fills at different prices
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.01000",
          quoteQty: "0",
          commission: "0.00001000",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
        {
          symbol: "BTCUSDT",
          id: 2,
          orderId: 12345,
          orderListId: -1,
          price: "49010",
          qty: "0.00500",
          quoteQty: "0",
          commission: "0.00000500",
          commissionAsset: "BTC",
          time: Date.now() + 100,
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      // Verify fills were properly processed
      expect(result.fills).toHaveLength(2);
      expect(result.executedQty.toString()).toBe("0.015");
      expect(result.feeBTC.toString()).toBe("0.000015");
    });
    it("should handle fee calculation correctly when fees are in different assets", async () => {
      const buyAmount = new Decimal(500);
      const currentPrice = new Decimal(50000);
      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );
      // Mock balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 400,
        locked: 0,
      });
      // Second attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "BUY_1234567890_abc123",
        price: "49000",
        origQty: "0.00810",
        executedQty: "0.00810",
        cummulativeQuoteQty: "396.90",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "BUY",
      };
      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);
      // Fills with mixed commission assets (BNB for fee discount)
      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "49000",
          qty: "0.00810",
          quoteQty: "0",
          commission: "0.001",
          commissionAsset: "BNB", // Fee paid in BNB for discount
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);
      const result = await buyOrderPlacer.placeOrder(
        buyAmount,
        currentPrice,
        0.003,
      );
      // Verify fills were properly processed with BNB fee
      expect(result.fills).toHaveLength(1);
      expect(result.executedQty.toString()).toBe("0.0081");
      // When fees are paid in BNB, implementation imputes 0.075% BTC fee for reference price calculation
      expect(result.feeBTC.toString()).toBe("0.000006075"); // Imputed BTC fee (0.0081 * 0.00075)
      expect(result.feeOther.BNB?.toString()).toBe("0.001"); // BNB fee recorded
    });
  });
});
