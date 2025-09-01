import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { BinanceClient } from "../../src/exchange/binance-client";
import type {
  BinanceConfig,
  OrderType,
  OrderSide,
  TimeInForce,
  BinanceOrder,
  BinanceAccountInfo,
  BinanceTickerPrice,
  BinanceOrderBook,
  BinanceKline,
  BinanceError,
  BinanceServerTime,
  OrderStatus,
  BinanceTrade,
  BinanceListenKey,
} from "../../src/exchange/types";

// Mock the global fetch
if (!global.fetch) {
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
}

// Helper to create mock responses
const createMockResponse = (
  ok: boolean,
  json: unknown,
  headers?: Record<string, string>,
): Partial<Response> => ({
  ok,
  headers: new Headers(headers || {}),
  json: async () => json,
  status: ok ? 200 : 400,
});

describe("BinanceClient", () => {
  let client: BinanceClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    // Don't use fake timers by default - only enable in specific tests

    // Ensure fetch is mocked
    if (!jest.isMockFunction(global.fetch)) {
      global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    }

    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    // Reset the mock implementation
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Always restore timers to ensure clean state
    jest.useRealTimers();
  });

  describe("Client Initialization", () => {
    it("should initialize with production URLs by default", () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };

      client = new BinanceClient(config);
      expect(client.getBaseUrl()).toBe("https://api.binance.com");
      expect(client.getWsUrl()).toBe("wss://stream.binance.com:9443");
    });

    it("should initialize with testnet URLs when specified", () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: true,
      };

      client = new BinanceClient(config);
      expect(client.getBaseUrl()).toBe("https://testnet.binance.vision");
      expect(client.getWsUrl()).toBe("wss://testnet.binance.vision");
    });

    it("should throw error if API key is missing", () => {
      const config = {
        apiKey: "",
        apiSecret: "test-api-secret",
        testnet: false,
      } as BinanceConfig;

      expect(() => new BinanceClient(config)).toThrow("API key is required");
    });

    it("should throw error if API secret is missing", () => {
      const config = {
        apiKey: "test-api-key",
        apiSecret: "",
        testnet: false,
      } as BinanceConfig;

      expect(() => new BinanceClient(config)).toThrow("API secret is required");
    });

    it("should set proper headers for authenticated requests", async () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };

      client = new BinanceClient(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverTime: Date.now() }),
        headers: new Headers(),
        status: 200,
        statusText: "OK",
      } as unknown as Response);

      await client.syncTime();

      // Make an authenticated request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
        headers: new Headers(),
        status: 200,
        statusText: "OK",
      } as unknown as Response);

      await client.getAccountInfo();

      // Check that API key header was set
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const headers = lastCall![1]?.headers as Headers;
      expect(headers.get("X-MBX-APIKEY")).toBe("test-api-key");
    }, 10000);
  });

  describe("Signature Generation", () => {
    beforeEach(() => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);
    });

    it("should generate correct HMAC-SHA256 signature", () => {
      const queryString =
        "symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=0.001&price=40000&timestamp=1234567890123";
      const expectedSignature = client.generateSignature(queryString);

      // Signature should be a 64-character hex string
      expect(expectedSignature).toMatch(/^[a-f0-9]{64}$/);

      // Same input should produce same signature
      const signature2 = client.generateSignature(queryString);
      expect(signature2).toBe(expectedSignature);
    });

    it("should build query string with proper encoding", () => {
      const params = {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 0.001,
        price: 40000,
      };

      const queryString = client.buildQueryString(params);
      expect(queryString).toContain("symbol=BTCUSDT");
      expect(queryString).toContain("side=BUY");
      expect(queryString).toContain("type=LIMIT");
      expect(queryString).toContain("quantity=0.001");
      expect(queryString).toContain("price=40000");
    });

    it("should add timestamp automatically to signed requests", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, { serverTime: Date.now() }) as Response,
      );

      await client.syncTime();

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, { balances: [] }) as Response,
      );

      await client.getAccountInfo();

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const url = lastCall![0] as string;
      expect(url).toContain("timestamp=");
      expect(url).toContain("signature=");
    });

    it("should handle special characters in parameters", () => {
      const params = {
        symbol: "BTC/USDT",
        note: "Test & verify",
      };

      const queryString = client.buildQueryString(params);
      expect(queryString).toContain("symbol=BTC%2FUSDT");
      expect(queryString).toContain("note=Test%20%26%20verify");
    });

    it("should order parameters alphabetically before signing", () => {
      const params = {
        zebra: "last",
        apple: "first",
        middle: "center",
      };

      const queryString = client.buildQueryString(params);
      const parts = queryString.split("&");
      expect(parts[0]).toContain("apple=");
      expect(parts[1]).toContain("middle=");
      expect(parts[2]).toContain("zebra=");
    });
  });

  describe("Timestamp Synchronization", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should sync with server time", async () => {
      const serverTime = 1234567890123;
      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, {
          serverTime,
        } as BinanceServerTime) as Response,
      );

      await client.syncTime();
      expect(client.getTimeDiff()).toBeDefined();
    });

    it("should handle server time sync errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.syncTime()).rejects.toThrow(
        "Failed to sync time with server",
      );
    });

    it("should validate timestamp within recvWindow", async () => {
      jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      const serverTime = Date.now();
      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, { serverTime }) as Response,
      );

      await client.syncTime();

      // Valid timestamp
      const validTimestamp = client.getTimestamp();
      expect(Math.abs(validTimestamp - serverTime)).toBeLessThan(5000);
    });

    it("should detect expired timestamps", async () => {
      // Set initial time
      jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      const serverTime = Date.now();

      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, { serverTime }) as Response,
      );

      await client.syncTime();

      // Advance time beyond recvWindow
      jest.advanceTimersByTime(60000);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({
          code: -1021,
          msg: "Timestamp for this request is outside of the recvWindow.",
        }),
      } as unknown as Response);

      await expect(client.getAccountInfo()).rejects.toThrow(
        "Timestamp for this request is outside of the recvWindow",
      );
    });

    it("should automatically resync time on timestamp errors", async () => {
      jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      const serverTime = Date.now();

      // Initial sync
      mockFetch.mockResolvedValueOnce(
        createMockResponse(true, { serverTime }) as Response,
      );
      await client.syncTime();

      // Advance time
      jest.advanceTimersByTime(60000);

      // First request fails with timestamp error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({
          code: -1021,
          msg: "Timestamp for this request is outside of the recvWindow.",
        }),
      } as unknown as Response);

      // Auto resync
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverTime: serverTime + 60000 }),
      } as unknown as Response);

      // Retry request succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balances: [] }),
      } as unknown as Response);

      await client.getAccountInfo();
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("Rate Limiting", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should track request weight", () => {
      const rateLimitInfo = client.getRateLimitInfo();
      expect(rateLimitInfo.weightUsed).toBe(0);
      expect(rateLimitInfo.weightLimit).toBe(1200);
    });

    it("should increment weight counter for requests", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "x-mbx-used-weight": "10",
          "x-mbx-used-weight-1m": "10",
        }),
        json: async () => ({ price: "45000.00" }),
      } as unknown as Response);

      await client.getPrice("BTCUSDT");

      const rateLimitInfo = client.getRateLimitInfo();
      expect(rateLimitInfo.weightUsed).toBe(10);
    });

    it("should reset weight counter after 1 minute", async () => {
      // Make a request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "x-mbx-used-weight-1m": "10",
        }),
        json: async () => ({ price: "45000.00" }),
      } as unknown as Response);

      await client.getPrice("BTCUSDT");
      expect(client.getRateLimitInfo().weightUsed).toBe(10);

      // Advance time by 1 minute
      jest.advanceTimersByTime(60000);

      // Make another request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "x-mbx-used-weight-1m": "5",
        }),
        json: async () => ({ price: "45000.00" }),
      } as unknown as Response);

      await client.getPrice("BTCUSDT");
      expect(client.getRateLimitInfo().weightUsed).toBe(5);
    });

    it("should queue requests when rate limited", async () => {
      // Simulate hitting rate limit
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "retry-after": "2",
        }),
        json: async () => ({
          code: -1003,
          msg: "Too many requests.",
        }),
      } as unknown as Response);

      // Next request should succeed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ price: "45000.00" }),
      } as unknown as Response);

      const pricePromise = client.getPrice("BTCUSDT");

      // Advance timers to process retry
      jest.advanceTimersByTime(2000);

      const price = await pricePromise;
      expect(price.price).toBe("45000.00");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should track order rate limits (10 orders/sec)", async () => {
      const orderPromises = [];

      // Mock successful order responses
      for (let i = 0; i < 15; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            orderId: i,
            status: "NEW",
          }),
        } as unknown as Response);
      }

      // Submit 15 orders rapidly
      for (let i = 0; i < 15; i++) {
        orderPromises.push(
          client.createOrder({
            symbol: "BTCUSDT",
            side: "BUY" as OrderSide,
            type: "LIMIT" as OrderType,
            quantity: 0.001,
            price: 40000,
            timeInForce: "GTC" as TimeInForce,
          }),
        );
      }

      // First 10 should go through immediately
      const rateLimitInfo = client.getRateLimitInfo();
      expect(rateLimitInfo.ordersPerSecond).toBeLessThanOrEqual(10);

      // Advance time to allow remaining orders
      jest.advanceTimersByTime(1000);

      await Promise.all(orderPromises);
      expect(mockFetch).toHaveBeenCalledTimes(15);
    });

    it("should handle different endpoint weights correctly", async () => {
      // Account info has higher weight
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "x-mbx-used-weight-1m": "10",
        }),
        json: async () => ({ balances: [] }),
      } as unknown as Response);

      await client.getAccountInfo();
      expect(client.getRateLimitInfo().weightUsed).toBe(10);

      // Order book with limit=5000 has weight of 50
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "x-mbx-used-weight-1m": "60",
        }),
        json: async () => ({ bids: [], asks: [] }),
      } as unknown as Response);

      await client.getOrderBook("BTCUSDT", 5000);
      expect(client.getRateLimitInfo().weightUsed).toBe(60);
    });

    it("should prevent requests when approaching weight limit", async () => {
      // Set weight close to limit
      client.setWeightUsed(1195);

      // This request would exceed limit
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          code: -1003,
          msg: "Too many requests.",
        }),
      } as unknown as Response);

      await expect(client.getAccountInfo()).rejects.toThrow(
        "Too many requests",
      );
    });
  });

  describe("Public API Methods", () => {
    beforeEach(() => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);
    });

    it("should fetch current BTC price", async () => {
      const mockPrice: BinanceTickerPrice = {
        symbol: "BTCUSDT",
        price: "45000.00",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPrice,
      } as unknown as Response);

      const price = await client.getPrice("BTCUSDT");
      expect(price.symbol).toBe("BTCUSDT");
      expect(price.price).toBe("45000.00");
    });

    it("should fetch order book", async () => {
      const mockOrderBook: BinanceOrderBook = {
        lastUpdateId: 123456789,
        bids: [
          ["45000.00", "0.5"],
          ["44999.00", "1.0"],
        ],
        asks: [
          ["45001.00", "0.3"],
          ["45002.00", "0.7"],
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrderBook,
      } as unknown as Response);

      const orderBook = await client.getOrderBook("BTCUSDT");
      expect(orderBook.bids).toHaveLength(2);
      expect(orderBook.asks).toHaveLength(2);
      expect(orderBook.bids[0][0]).toBe("45000.00");
    });

    it("should fetch kline/candlestick data", async () => {
      const mockKlines: BinanceKline[] = [
        {
          openTime: 1234567890000,
          open: "44000.00",
          high: "45000.00",
          low: "43500.00",
          close: "44500.00",
          volume: "100.5",
          closeTime: 1234567890999,
          quoteAssetVolume: "4450000.00",
          numberOfTrades: 1500,
          takerBuyBaseAssetVolume: "50.25",
          takerBuyQuoteAssetVolume: "2225000.00",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          mockKlines.map((k) => [
            k.openTime,
            k.open,
            k.high,
            k.low,
            k.close,
            k.volume,
            k.closeTime,
            k.quoteAssetVolume,
            k.numberOfTrades,
            k.takerBuyBaseAssetVolume,
            k.takerBuyQuoteAssetVolume,
            "0",
          ]),
      } as unknown as Response);

      const klines = await client.getKlines("BTCUSDT", "1h", 1);
      expect(klines).toHaveLength(1);
      expect(klines[0].open).toBe("44000.00");
      expect(klines[0].close).toBe("44500.00");
    });

    it("should handle public API errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          code: -1121,
          msg: "Invalid symbol.",
        }),
      } as unknown as Response);

      await expect(client.getPrice("INVALID")).rejects.toThrow(
        "Invalid symbol",
      );
    });
  });

  describe("Private API Methods", () => {
    beforeEach(async () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);

      // Sync time first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverTime: Date.now() }),
      } as unknown as Response);
      await client.syncTime();
    });

    it("should fetch account information", async () => {
      const mockAccountInfo: BinanceAccountInfo = {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: "SPOT",
        balances: [
          {
            asset: "BTC",
            free: "0.5",
            locked: "0.1",
          },
          {
            asset: "USDT",
            free: "10000.00",
            locked: "0.00",
          },
        ],
        permissions: ["SPOT"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountInfo,
      } as unknown as Response);

      const accountInfo = await client.getAccountInfo();
      expect(accountInfo.canTrade).toBe(true);
      expect(accountInfo.balances).toHaveLength(2);
      expect(accountInfo.balances[0].asset).toBe("BTC");
    });

    it("should fetch specific asset balance", async () => {
      const mockAccountInfo: BinanceAccountInfo = {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: "SPOT",
        balances: [
          {
            asset: "BTC",
            free: "0.5",
            locked: "0.1",
          },
          {
            asset: "USDT",
            free: "10000.00",
            locked: "0.00",
          },
        ],
        permissions: ["SPOT"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountInfo,
      } as unknown as Response);

      const btcBalance = await client.getBalance("BTC");
      expect(btcBalance.asset).toBe("BTC");
      expect(btcBalance.free).toBe("0.5");
      expect(btcBalance.locked).toBe("0.1");
    });

    it("should return zero balance for non-existent asset", async () => {
      const mockAccountInfo: BinanceAccountInfo = {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: "SPOT",
        balances: [],
        permissions: ["SPOT"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountInfo,
      } as unknown as Response);

      const ethBalance = await client.getBalance("ETH");
      expect(ethBalance.asset).toBe("ETH");
      expect(ethBalance.free).toBe("0");
      expect(ethBalance.locked).toBe("0");
    });

    it("should get trade history", async () => {
      const mockTrades: BinanceTrade[] = [
        {
          symbol: "BTCUSDT",
          id: 123456,
          orderId: 789012,
          orderListId: -1,
          price: "45000.00",
          qty: "0.001",
          quoteQty: "45.00",
          commission: "0.045",
          commissionAsset: "USDT",
          time: Date.now() - 3600000,
          isBuyer: true,
          isMaker: false,
          isBestMatch: true,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTrades,
      } as unknown as Response);

      const trades = await client.getMyTrades("BTCUSDT");
      expect(trades).toHaveLength(1);
      expect(trades[0].price).toBe("45000.00");
      expect(trades[0].isBuyer).toBe(true);
    });

    it("should calculate portfolio value", async () => {
      // Mock account info
      const mockAccountInfo: BinanceAccountInfo = {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: "SPOT",
        balances: [
          { asset: "BTC", free: "0.5", locked: "0.1" },
          { asset: "ETH", free: "2.0", locked: "0.0" },
          { asset: "USDT", free: "10000.00", locked: "0.00" },
        ],
        permissions: ["SPOT"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountInfo,
      } as unknown as Response);

      // Mock price responses
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ symbol: "BTCUSDT", price: "45000.00" }),
      } as unknown as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ symbol: "ETHUSDT", price: "3000.00" }),
      } as unknown as Response);

      const portfolioValue = await client.getPortfolioValue();
      // 0.6 BTC * 45000 + 2 ETH * 3000 + 10000 USDT = 27000 + 6000 + 10000 = 43000
      expect(portfolioValue).toBe(43000);
    });
  });

  describe("Order Management", () => {
    beforeEach(async () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);

      // Sync time first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverTime: Date.now() }),
      } as unknown as Response);
      await client.syncTime();
    });

    it("should create a limit buy order", async () => {
      const mockOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        orderListId: -1,
        clientOrderId: "test-order-1",
        transactTime: Date.now(),
        price: "40000.00",
        origQty: "0.001",
        executedQty: "0.000",
        cummulativeQuoteQty: "0.00",
        status: "NEW" as OrderStatus,
        timeInForce: "GTC" as TimeInForce,
        type: "LIMIT" as OrderType,
        side: "BUY" as OrderSide,
        fills: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      } as unknown as Response);

      const order = await client.createOrder({
        symbol: "BTCUSDT",
        side: "BUY" as OrderSide,
        type: "LIMIT" as OrderType,
        quantity: 0.001,
        price: 40000,
        timeInForce: "GTC" as TimeInForce,
      });

      expect(order.orderId).toBe(123456789);
      expect(order.status).toBe("NEW");
      expect(order.side).toBe("BUY");
    });

    it("should create a market sell order", async () => {
      const mockOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 987654321,
        orderListId: -1,
        clientOrderId: "test-order-2",
        transactTime: Date.now(),
        price: "0.00",
        origQty: "0.001",
        executedQty: "0.001",
        cummulativeQuoteQty: "45.00",
        status: "FILLED" as OrderStatus,
        timeInForce: "IOC" as TimeInForce,
        type: "MARKET" as OrderType,
        side: "SELL" as OrderSide,
        fills: [
          {
            price: "45000.00",
            qty: "0.001",
            commission: "0.045",
            commissionAsset: "USDT",
            tradeId: 111111,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      } as unknown as Response);

      const order = await client.createOrder({
        symbol: "BTCUSDT",
        side: "SELL" as OrderSide,
        type: "MARKET" as OrderType,
        quantity: 0.001,
      });

      expect(order.orderId).toBe(987654321);
      expect(order.status).toBe("FILLED");
      expect(order.type).toBe("MARKET");
    });

    it("should create a stop-loss order", async () => {
      const mockOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 555555555,
        orderListId: -1,
        clientOrderId: "test-stop-order",
        transactTime: Date.now(),
        price: "38000.00",
        origQty: "0.001",
        executedQty: "0.000",
        cummulativeQuoteQty: "0.00",
        status: "NEW" as OrderStatus,
        timeInForce: "GTC" as TimeInForce,
        type: "STOP_LOSS_LIMIT" as OrderType,
        side: "SELL" as OrderSide,
        stopPrice: "39000.00",
        fills: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      } as unknown as Response);

      const order = await client.createOrder({
        symbol: "BTCUSDT",
        side: "SELL" as OrderSide,
        type: "STOP_LOSS_LIMIT" as OrderType,
        quantity: 0.001,
        price: 38000,
        stopPrice: 39000,
        timeInForce: "GTC" as TimeInForce,
      });

      expect(order.type).toBe("STOP_LOSS_LIMIT");
      expect(order.stopPrice).toBe("39000.00");
    });

    it("should cancel an order", async () => {
      const mockCancelResponse: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        orderListId: -1,
        clientOrderId: "test-order-1",
        transactTime: Date.now(),
        price: "40000.00",
        origQty: "0.001",
        executedQty: "0.000",
        cummulativeQuoteQty: "0.00",
        status: "CANCELED" as OrderStatus,
        timeInForce: "GTC" as TimeInForce,
        type: "LIMIT" as OrderType,
        side: "BUY" as OrderSide,
        fills: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCancelResponse,
      } as unknown as Response);

      const result = await client.cancelOrder("BTCUSDT", 123456789);
      expect(result.status).toBe("CANCELED");
      expect(result.orderId).toBe(123456789);
    });

    it("should get order status", async () => {
      const mockOrder: BinanceOrder = {
        symbol: "BTCUSDT",
        orderId: 123456789,
        orderListId: -1,
        clientOrderId: "test-order-1",
        price: "40000.00",
        origQty: "0.001",
        executedQty: "0.0005",
        cummulativeQuoteQty: "20.00",
        status: "PARTIALLY_FILLED" as OrderStatus,
        timeInForce: "GTC" as TimeInForce,
        type: "LIMIT" as OrderType,
        side: "BUY" as OrderSide,
        stopPrice: "0.00",
        icebergQty: "0.00",
        time: Date.now() - 60000,
        updateTime: Date.now() - 30000,
        isWorking: true,
        origQuoteOrderQty: "40.00",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrder,
      } as unknown as Response);

      const order = await client.getOrder("BTCUSDT", 123456789);
      expect(order.status).toBe("PARTIALLY_FILLED");
      expect(order.executedQty).toBe("0.0005");
    });

    it("should get all open orders", async () => {
      const mockOrders: BinanceOrder[] = [
        {
          symbol: "BTCUSDT",
          orderId: 111111111,
          orderListId: -1,
          clientOrderId: "order-1",
          price: "40000.00",
          origQty: "0.001",
          executedQty: "0.000",
          cummulativeQuoteQty: "0.00",
          status: "NEW" as OrderStatus,
          timeInForce: "GTC" as TimeInForce,
          type: "LIMIT" as OrderType,
          side: "BUY" as OrderSide,
          stopPrice: "0.00",
          icebergQty: "0.00",
          time: Date.now() - 120000,
          updateTime: Date.now() - 120000,
          isWorking: true,
          origQuoteOrderQty: "40.00",
        },
        {
          symbol: "ETHUSDT",
          orderId: 222222222,
          orderListId: -1,
          clientOrderId: "order-2",
          price: "3000.00",
          origQty: "0.01",
          executedQty: "0.000",
          cummulativeQuoteQty: "0.00",
          status: "NEW" as OrderStatus,
          timeInForce: "GTC" as TimeInForce,
          type: "LIMIT" as OrderType,
          side: "BUY" as OrderSide,
          stopPrice: "0.00",
          icebergQty: "0.00",
          time: Date.now() - 60000,
          updateTime: Date.now() - 60000,
          isWorking: true,
          origQuoteOrderQty: "30.00",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOrders,
      } as unknown as Response);

      const orders = await client.getOpenOrders();
      expect(orders).toHaveLength(2);
      expect(orders[0].symbol).toBe("BTCUSDT");
      expect(orders[1].symbol).toBe("ETHUSDT");
    });

    it("should validate order parameters", async () => {
      await expect(
        client.createOrder({
          symbol: "",
          side: "BUY" as OrderSide,
          type: "LIMIT" as OrderType,
          quantity: 0.001,
          price: 40000,
        }),
      ).rejects.toThrow("Symbol is required");

      await expect(
        client.createOrder({
          symbol: "BTCUSDT",
          side: "BUY" as OrderSide,
          type: "LIMIT" as OrderType,
          quantity: 0,
          price: 40000,
        }),
      ).rejects.toThrow("Quantity must be greater than 0");

      await expect(
        client.createOrder({
          symbol: "BTCUSDT",
          side: "BUY" as OrderSide,
          type: "LIMIT" as OrderType,
          quantity: 0.001,
          price: 0,
        }),
      ).rejects.toThrow("Price is required for LIMIT orders");
    });

    it("should handle order rejection errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          code: -2010,
          msg: "Account has insufficient balance for requested action.",
        }),
      } as unknown as Response);

      await expect(
        client.createOrder({
          symbol: "BTCUSDT",
          side: "BUY" as OrderSide,
          type: "LIMIT" as OrderType,
          quantity: 1000,
          price: 40000,
        }),
      ).rejects.toThrow("Account has insufficient balance");
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should handle Binance API errors with error codes", async () => {
      const errorResponse: BinanceError = {
        code: -1121,
        msg: "Invalid symbol.",
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => errorResponse,
      } as unknown as Response);

      await expect(client.getPrice("INVALID")).rejects.toThrow(
        "Invalid symbol",
      );
    });

    it("should handle network timeouts", async () => {
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Network timeout")), 100);
          }),
      );

      await expect(client.getPrice("BTCUSDT")).rejects.toThrow(
        "Network timeout",
      );
    });

    it("should handle connection errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(client.getPrice("BTCUSDT")).rejects.toThrow("ECONNREFUSED");
    });

    it("should handle invalid JSON responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
        headers: new Headers(),
        status: 200,
        statusText: "OK",
      } as unknown as Response);

      await expect(client.getPrice("BTCUSDT")).rejects.toThrow("Invalid JSON");
    });

    it("should retry on temporary failures", async () => {
      // First two attempts fail
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Third attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ symbol: "BTCUSDT", price: "45000.00" }),
      } as unknown as Response);

      const price = await client.getPrice("BTCUSDT");
      expect(price.price).toBe("45000.00");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should handle rate limit errors with retry-after header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          "retry-after": "5",
        }),
        json: async () => ({
          code: -1003,
          msg: "Too many requests.",
        }),
      } as unknown as Response);

      // Next request succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ symbol: "BTCUSDT", price: "45000.00" }),
      } as unknown as Response);

      const pricePromise = client.getPrice("BTCUSDT");

      // Advance time
      jest.advanceTimersByTime(5000);

      const price = await pricePromise;
      expect(price.price).toBe("45000.00");
    });

    it("should handle IP ban errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 418,
        json: async () => ({
          code: -1003,
          msg: "IP banned until 1234567890000",
        }),
      } as unknown as Response);

      await expect(client.getPrice("BTCUSDT")).rejects.toThrow("IP banned");
    });
  });

  describe("WebSocket Support", () => {
    beforeEach(async () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: false,
      };
      client = new BinanceClient(config);

      // Sync time first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverTime: Date.now() }),
      } as unknown as Response);
      await client.syncTime();
    });

    it("should create user data stream listen key", async () => {
      const mockListenKey: BinanceListenKey = {
        listenKey: "test-listen-key-123456",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockListenKey,
      } as unknown as Response);

      const listenKey = await client.createListenKey();
      expect(listenKey).toBe("test-listen-key-123456");
    });

    it("should keep alive user data stream", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
        headers: new Headers(),
        status: 200,
        statusText: "OK",
      } as unknown as Response);

      await client.keepAliveListenKey("test-listen-key-123456");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v3/userDataStream"),
        expect.objectContaining({
          method: "PUT",
        }),
      );
    });

    it("should close user data stream", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
        headers: new Headers(),
        status: 200,
        statusText: "OK",
      } as unknown as Response);

      await client.closeListenKey("test-listen-key-123456");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v3/userDataStream"),
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    it("should build WebSocket URLs correctly", () => {
      const streamUrl = client.getStreamUrl("btcusdt@trade");
      expect(streamUrl).toBe("wss://stream.binance.com:9443/ws/btcusdt@trade");

      const multiStreamUrl = client.getStreamUrl([
        "btcusdt@trade",
        "ethusdt@trade",
      ]);
      expect(multiStreamUrl).toBe(
        "wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade",
      );
    });

    it("should build testnet WebSocket URLs correctly", () => {
      const config: BinanceConfig = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        testnet: true,
      };
      const testnetClient = new BinanceClient(config);

      const streamUrl = testnetClient.getStreamUrl("btcusdt@trade");
      expect(streamUrl).toBe("wss://testnet.binance.vision/ws/btcusdt@trade");
    });
  });
});
