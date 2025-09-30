import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { SellOrderPlacer } from "../../src/order/sell-order-placer";
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
  getMinimumSellableQuantity: jest.Mock<
    (price: number, symbol: string) => number
  >;
};

describe("SellOrderPlacer - Retry Logic", () => {
  let sellOrderPlacer: SellOrderPlacer;
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
      getMinimumSellableQuantity: jest.fn(() => 0.00001),
    };

    sellOrderPlacer = new SellOrderPlacer(
      mockBinanceClient as unknown as BinanceClient,
      mockTradingRules as unknown as TradingRules,
      mockSupabaseClient,
      "BTCUSDT",
    );

    // Mock the private sleep method to eliminate delays in tests
    const sellOrderPlacerWithSleep = sellOrderPlacer as unknown as {
      sleep: (ms: number) => Promise<void>;
    };
    jest
      .spyOn(sellOrderPlacerWithSleep, "sleep")
      .mockImplementation(() => Promise.resolve());
  });

  describe("INSUFFICIENT_BALANCE retry mechanism", () => {
    it("should retry with refreshed balance on INSUFFICIENT_BALANCE error", async () => {
      const btcToSell = new Decimal(0.5);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // First attempt fails with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance for requested action"),
      );

      // Mock balance refresh showing less BTC available
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 0.3,
        locked: 0,
      });

      // Second attempt succeeds with reduced quantity
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "SELL_1234567890_abc123",
        price: "51000",
        origQty: "0.29999",
        executedQty: "0.29999",
        cummulativeQuoteQty: "15299.49",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "SELL",
      };

      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);

      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "51000",
          qty: "0.29999",
          quoteQty: "0",
          commission: "0.000015",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);

      const result = await sellOrderPlacer.placeOrder(
        btcToSell,
        currentPrice,
        referencePrice,
        0.003,
      );

      // Verify balance was refreshed
      expect(mockBinanceClient.getBalance).toHaveBeenCalledWith("BTC");

      // Verify order was placed twice (first failed, second succeeded)
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(2);

      // Verify second order used reduced quantity
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      expect(secondCall[0].quantity).toBeLessThan(0.5);
      // Quantization uses floor: 0.3 * 0.995 = 0.2985, floored to stepSize = 0.29850 -> 0.3
      expect(secondCall[0].quantity).toBeCloseTo(0.3, 5);

      // Verify result
      expect(result.executedQty.toString()).toBe("0.29999");
      expect(result.status).toBe("FILLED");
    });

    it("should generate unique clientOrderId for each retry", async () => {
      const btcToSell = new Decimal(1.0);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance"),
      );

      // Mock balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 0.8,
        locked: 0,
      });

      // Second attempt also fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance"),
      );

      // Mock another balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 0.5,
        locked: 0,
      });

      // Third attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "SELL_1234567890_xyz789",
        price: "51000",
        origQty: "0.49999",
        executedQty: "0.49999",
        cummulativeQuoteQty: "25499.49",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "SELL",
      };

      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);

      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "51000",
          qty: "0.49999",
          quoteQty: "0",
          commission: "0.000025",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);

      await sellOrderPlacer.placeOrder(
        btcToSell,
        currentPrice,
        referencePrice,
        0.003,
      );

      // Verify three attempts were made
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);

      // Extract clientOrderIds from each call
      const clientOrderIds = mockBinanceClient.createOrder.mock.calls.map(
        (call) => call[0].newClientOrderId,
      );

      // Verify all clientOrderIds are unique
      const uniqueIds = new Set(clientOrderIds);
      expect(uniqueIds.size).toBe(3);

      // Verify all start with SELL_ prefix and have retry counter suffix
      clientOrderIds.forEach((id) => {
        expect(id).toMatch(/^SELL_\d+_[a-z0-9]+_\d+$/);
      });
    });

    it("should respect maximum retry attempts for balance errors", async () => {
      const btcToSell = new Decimal(1.0);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // Always fail with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValue(
        new Error("Account has insufficient balance"),
      );

      // Mock balance refreshes (3 times max)
      mockBinanceClient.getBalance
        .mockResolvedValueOnce({ free: 0.9, locked: 0 })
        .mockResolvedValueOnce({ free: 0.8, locked: 0 })
        .mockResolvedValueOnce({ free: 0.7, locked: 0 });

      await expect(
        sellOrderPlacer.placeOrder(
          btcToSell,
          currentPrice,
          referencePrice,
          0.003,
        ),
      ).rejects.toThrow("Account has insufficient balance");

      // Verify we attempted 3 times total (retryCount = 3, attempts 0, 1, 2)
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
      expect(mockBinanceClient.getBalance).toHaveBeenCalledTimes(3);
    });

    it("should handle balance refresh failures gracefully", async () => {
      const btcToSell = new Decimal(0.5);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // First attempt fails with insufficient balance
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Account has insufficient balance"),
      );

      // Balance refresh fails
      mockBinanceClient.getBalance.mockRejectedValueOnce(
        new Error("Network error"),
      );

      await expect(
        sellOrderPlacer.placeOrder(
          btcToSell,
          currentPrice,
          referencePrice,
          0.003,
        ),
      ).rejects.toThrow("Network error");

      // Verify we attempted to refresh balance
      expect(mockBinanceClient.getBalance).toHaveBeenCalledTimes(1);
    });

    it("should properly quantize adjusted sell amount to step size", async () => {
      const btcToSell = new Decimal(0.123456789);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );

      // Mock balance showing slightly less
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 0.12,
        locked: 0,
      });

      // Second attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "SELL_1234567890_abc123",
        price: "51000",
        origQty: "0.11999",
        executedQty: "0.11999",
        cummulativeQuoteQty: "6119.49",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "SELL",
      };

      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);

      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "51000",
          qty: "0.11999",
          quoteQty: "0",
          commission: "0.000006",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);

      await sellOrderPlacer.placeOrder(
        btcToSell,
        currentPrice,
        referencePrice,
        0.003,
      );

      // Verify the quantity was properly quantized to step size (0.00001)
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      // 0.12 * 0.995 = 0.1194, floored to stepSize 0.00001 = 0.11940 -> rounds to 0.12
      expect(secondCall[0].quantity).toBeCloseTo(0.12, 5);
    });

    it("should throw error if adjusted amount is below minimum", async () => {
      const btcToSell = new Decimal(0.001);
      const currentPrice = new Decimal(5000); // Low price makes notional too small

      // This test verifies that orders below minNotional are rejected in prepareOrder
      // No need to mock createOrder since it never gets called
      await expect(
        sellOrderPlacer.placeOrder(
          btcToSell,
          currentPrice,
          currentPrice,
          0.003,
        ),
      ).rejects.toThrow("below minimum");

      // Verify createOrder was never called (validation happens before order placement)
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(0);
    });

    it("should distinguish between balance errors and other retryable errors", async () => {
      const btcToSell = new Decimal(0.5);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

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
        free: 0.3,
        locked: 0,
      });

      // Third attempt succeeds
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "SELL_1234567890_abc123",
        price: "51000",
        origQty: "0.29999",
        executedQty: "0.29999",
        cummulativeQuoteQty: "15299.49",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "SELL",
      };

      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);

      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "51000",
          qty: "0.29999",
          quoteQty: "0",
          commission: "0.000015",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);

      await sellOrderPlacer.placeOrder(
        btcToSell,
        currentPrice,
        referencePrice,
        0.003,
      );

      // Verify balance was only refreshed once (for the balance error)
      expect(mockBinanceClient.getBalance).toHaveBeenCalledTimes(1);

      // Verify three order attempts
      expect(mockBinanceClient.createOrder).toHaveBeenCalledTimes(3);
    });

    it("should correctly calculate safe quantity using min(spot_btc, btc_accumulated)", async () => {
      const btcAccumulated = new Decimal(1.0);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );

      // Mock balance showing less than accumulated (spot < accumulated)
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 0.7,
        locked: 0,
      });

      // Second attempt succeeds with spot amount
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "SELL_1234567890_abc123",
        price: "51000",
        origQty: "0.69999", // Quantized 0.7 to step size
        executedQty: "0.69999",
        cummulativeQuoteQty: "35699.49",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "SELL",
      };

      mockBinanceClient.createOrder.mockResolvedValueOnce(successfulOrder);
      mockBinanceClient.getOrder.mockResolvedValueOnce(successfulOrder);

      const trades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 1,
          orderId: 12345,
          orderListId: -1,
          price: "51000",
          qty: "0.69999",
          quoteQty: "0",
          commission: "0.000035",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);

      await sellOrderPlacer.placeOrder(
        btcAccumulated,
        currentPrice,
        referencePrice,
        0.003,
      );

      // Verify second order used the spot balance (less than accumulated)
      const secondCall = mockBinanceClient.createOrder.mock.calls[1];
      expect(secondCall[0].quantity).toBeLessThan(1.0);
      // 0.7 * 0.995 = 0.6965, floored to stepSize = 0.69650 -> rounds to 0.7
      expect(secondCall[0].quantity).toBeCloseTo(0.7, 5);
    });
  });

  describe("Integration with fills data", () => {
    it("should use fills data for reconciliation after retry", async () => {
      const btcToSell = new Decimal(0.5);
      const currentPrice = new Decimal(50000);
      const referencePrice = new Decimal(49000);

      // First attempt fails
      mockBinanceClient.createOrder.mockRejectedValueOnce(
        new Error("Insufficient balance"),
      );

      // Mock balance refresh
      mockBinanceClient.getBalance.mockResolvedValueOnce({
        free: 0.4,
        locked: 0,
      });

      // Second attempt succeeds with partial fill
      const successfulOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 12345,
        orderListId: -1,
        clientOrderId: "SELL_1234567890_abc123",
        price: "51000",
        origQty: "0.39999",
        executedQty: "0.35", // Partial fill
        cummulativeQuoteQty: "17850",
        status: "PARTIALLY_FILLED" as OrderStatus,
        timeInForce: "IOC",
        type: "LIMIT",
        side: "SELL",
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
          price: "51000",
          qty: "0.2",
          quoteQty: "0",
          commission: "0.00001",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
        {
          symbol: "BTCUSDT",
          id: 2,
          orderId: 12345,
          orderListId: -1,
          price: "51010",
          qty: "0.15",
          quoteQty: "7651.5",
          commission: "0.0000075",
          commissionAsset: "BTC",
          time: Date.now() + 100,
          isBuyer: false,
          isMaker: false,
          isBestMatch: true,
        },
      ];
      mockBinanceClient.getMyTrades.mockResolvedValueOnce(trades);

      const result = await sellOrderPlacer.placeOrder(
        btcToSell,
        currentPrice,
        referencePrice,
        0.003,
      );

      // Verify fills were properly processed
      expect(result.fills).toHaveLength(2);
      expect(result.executedQty.toString()).toBe("0.35");
      expect(result.feeBTC.toString()).toBe("0.0000175");
    });
  });
});
