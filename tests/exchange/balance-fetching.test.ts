import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from "@jest/globals";
import { Decimal } from "decimal.js";
import type { BinanceClient } from "../../src/exchange/binance-client";
import type {
  BinanceAccountInfo,
  BinanceBalance,
} from "../../src/exchange/types";
import { BalanceManager } from "../../src/exchange/balance-manager";

describe("Balance Fetching (BIN-003)", () => {
  let balanceManager: BalanceManager;
  let mockClient: jest.Mocked<BinanceClient>;

  beforeEach(() => {
    jest.useFakeTimers();

    // Create mock BinanceClient
    mockClient = {
      getAccountInfo: jest.fn(),
      getBalance: jest.fn(),
    } as unknown as jest.Mocked<BinanceClient>;

    balanceManager = new BalanceManager(mockClient);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("Balance Parsing and Decimal Conversion", () => {
    it("should parse BTC balance correctly", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "0.12345678", locked: "0.05000000" },
          { asset: "USDT", free: "1000.50", locked: "500.25" },
        ],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balance = await balanceManager.getBalance("BTC");

      expect(balance.asset).toBe("BTC");
      expect(balance.free).toBeInstanceOf(Decimal);
      expect(balance.free.toString()).toBe("0.12345678");
      expect(balance.locked).toBeInstanceOf(Decimal);
      expect(balance.locked.toString()).toBe("0.05");
      expect(balance.total).toBeInstanceOf(Decimal);
      expect(balance.total.toString()).toBe("0.17345678");
      expect(balance.fromCache).toBe(false);
    });

    it("should parse USDT balance correctly", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "0.12345678", locked: "0.05000000" },
          { asset: "USDT", free: "1000.50", locked: "500.25" },
        ],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balance = await balanceManager.getBalance("USDT");

      expect(balance.asset).toBe("USDT");
      expect(balance.free.toString()).toBe("1000.5");
      expect(balance.locked.toString()).toBe("500.25");
      expect(balance.total.toString()).toBe("1500.75");
    });

    it("should handle zero balances", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0", locked: "0" }],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balance = await balanceManager.getBalance("BTC");

      expect(balance.free.toString()).toBe("0");
      expect(balance.locked.toString()).toBe("0");
      expect(balance.total.toString()).toBe("0");
    });

    it("should handle very small decimal values with precision", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.00000001", locked: "0.00000002" }],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balance = await balanceManager.getBalance("BTC");

      expect(balance.free.toString()).toBe("0.00000001");
      expect(balance.locked.toString()).toBe("0.00000002");
      expect(balance.total.toString()).toBe("0.00000003");
    });

    it("should handle asset not found", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0" }],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balance = await balanceManager.getBalance("ETH");

      expect(balance.asset).toBe("ETH");
      expect(balance.free.toString()).toBe("0");
      expect(balance.locked.toString()).toBe("0");
      expect(balance.total.toString()).toBe("0");
    });
  });

  describe("Caching Behavior (1 second TTL)", () => {
    it("should return cached balance within 1 second", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      // First call - should fetch from API
      const balance1 = await balanceManager.getBalance("BTC");
      expect(balance1.fromCache).toBe(false);
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1);

      // Second call within 1 second - should use cache
      jest.advanceTimersByTime(500);
      const balance2 = await balanceManager.getBalance("BTC");
      expect(balance2.fromCache).toBe(true);
      expect(balance2.free.toString()).toBe(balance1.free.toString());
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1); // Still 1

      // Third call still within 1 second - should use cache
      jest.advanceTimersByTime(400);
      const balance3 = await balanceManager.getBalance("BTC");
      expect(balance3.fromCache).toBe(true);
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1); // Still 1
    });

    it("should fetch fresh balance after cache expiry", async () => {
      const mockAccountInfo1: BinanceAccountInfo = {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: "SPOT",
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      const mockAccountInfo2: BinanceAccountInfo = {
        ...mockAccountInfo1,
        balances: [{ asset: "BTC", free: "0.2", locked: "0.1" }],
      };

      mockClient.getAccountInfo
        .mockResolvedValueOnce(mockAccountInfo1)
        .mockResolvedValueOnce(mockAccountInfo2);

      // First call
      const balance1 = await balanceManager.getBalance("BTC");
      expect(balance1.free.toString()).toBe("0.1");
      expect(balance1.fromCache).toBe(false);

      // After cache expiry
      jest.advanceTimersByTime(1001);
      const balance2 = await balanceManager.getBalance("BTC");
      expect(balance2.free.toString()).toBe("0.2");
      expect(balance2.fromCache).toBe(false);
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(2);
    });

    it("should maintain separate cache for different assets", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "0.1", locked: "0.05" },
          { asset: "USDT", free: "1000", locked: "500" },
        ],
      };

      mockClient.getAccountInfo.mockResolvedValue(mockAccountInfo);

      // Fetch BTC
      const btc1 = await balanceManager.getBalance("BTC");
      expect(btc1.fromCache).toBe(false);

      // Fetch USDT - should still call API since different asset
      const usdt1 = await balanceManager.getBalance("USDT");
      expect(usdt1.fromCache).toBe(false);

      // Fetch BTC again - should use cache
      const btc2 = await balanceManager.getBalance("BTC");
      expect(btc2.fromCache).toBe(true);

      // Fetch USDT again - should use cache
      const usdt2 = await balanceManager.getBalance("USDT");
      expect(usdt2.fromCache).toBe(true);
    });

    it("should force refresh when forceRefresh option is true", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      mockClient.getAccountInfo.mockResolvedValue(mockAccountInfo);

      // First call
      await balanceManager.getBalance("BTC");
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1);

      // Second call with forceRefresh
      await balanceManager.getBalance("BTC", { forceRefresh: true });
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(2);

      // Third call without forceRefresh - should use cache from second call
      await balanceManager.getBalance("BTC");
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe("Retry Logic with Exponential Backoff", () => {
    it("should retry on API failure with exponential backoff", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      mockClient.getAccountInfo
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(mockAccountInfo);

      const balancePromise = balanceManager.getBalance("BTC");

      // Process the initial failure and first retry (after 1 second)
      await jest.advanceTimersByTimeAsync(1000);

      // Second retry after 2 seconds
      await jest.advanceTimersByTimeAsync(2000);

      // Third attempt should succeed
      const balance = await balancePromise;

      expect(balance.free.toString()).toBe("0.1");
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(3);
    });

    it("should fail after max retries", async () => {
      mockClient.getAccountInfo.mockRejectedValue(new Error("Network error"));

      const balancePromise = balanceManager.getBalance("BTC");

      // Advance through all retry delays
      await jest.advanceTimersByTimeAsync(1000); // First retry
      await jest.advanceTimersByTimeAsync(2000); // Second retry

      await expect(balancePromise).rejects.toThrow("Network error");
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(3);
    });

    it("should not retry on non-retryable errors", async () => {
      const authError = new Error("Invalid API key") as Error & {
        code?: number;
      };
      authError.code = -2014;
      mockClient.getAccountInfo.mockRejectedValue(authError);

      await expect(balanceManager.getBalance("BTC")).rejects.toThrow(
        "Invalid API key",
      );
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1);
    });

    it("should reset retry count on successful request", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      // First request fails once then succeeds
      mockClient.getAccountInfo
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(mockAccountInfo);

      const balance1Promise = balanceManager.getBalance("BTC");
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(1000);
      await balance1Promise;

      // Clear cache
      await jest.advanceTimersByTimeAsync(1001);

      // Second request should also retry from 0
      mockClient.getAccountInfo
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(mockAccountInfo);

      const balance2Promise = balanceManager.getBalance("BTC");
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(1000); // Should use 1 second delay, not longer
      await balance2Promise;

      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(4);
    });
  });

  describe("Last Known Good Balance Fallback", () => {
    it("should return last known balance when all retries fail", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      // First successful fetch
      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);
      const balance1 = await balanceManager.getBalance("BTC");
      expect(balance1.free.toString()).toBe("0.1");

      // Clear cache
      jest.advanceTimersByTime(1001);

      // Now API fails
      mockClient.getAccountInfo.mockRejectedValue(new Error("API unavailable"));

      const balance2Promise = balanceManager.getBalance("BTC");

      // Advance through all retries
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const balance2 = await balance2Promise;

      expect(balance2.free.toString()).toBe("0.1");
      expect(balance2.isStale).toBe(true);
      expect(balance2.fromCache).toBe(false); // It's not from cache, it's last known
    });

    it("should throw error when no last known balance exists", async () => {
      mockClient.getAccountInfo.mockRejectedValue(new Error("API unavailable"));

      const balancePromise = balanceManager.getBalance("BTC");

      // Advance through all retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(balancePromise).rejects.toThrow("API unavailable");
    });

    it("should update last known balance on successful fetch", async () => {
      const mockAccountInfo1: BinanceAccountInfo = {
        makerCommission: 10,
        takerCommission: 10,
        buyerCommission: 0,
        sellerCommission: 0,
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        updateTime: Date.now(),
        accountType: "SPOT",
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      const mockAccountInfo2: BinanceAccountInfo = {
        ...mockAccountInfo1,
        balances: [{ asset: "BTC", free: "0.2", locked: "0.1" }],
      };

      // First fetch
      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo1);
      await balanceManager.getBalance("BTC");

      // Clear cache
      jest.advanceTimersByTime(1001);

      // Second successful fetch updates last known
      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo2);
      await balanceManager.getBalance("BTC");

      // Clear cache
      jest.advanceTimersByTime(1001);

      // Now API fails, should return new last known value
      mockClient.getAccountInfo.mockRejectedValue(new Error("API unavailable"));

      const balancePromise = balanceManager.getBalance("BTC");
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const balance = await balancePromise;
      expect(balance.free.toString()).toBe("0.2"); // Updated value
      expect(balance.isStale).toBe(true);
    });

    it("should include stale warning when returning fallback", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      // Set up last known balance
      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);
      const originalBalance = await balanceManager.getBalance("BTC");
      const originalTime = originalBalance.lastUpdated;

      // Clear cache
      jest.advanceTimersByTime(1001);

      // API fails
      mockClient.getAccountInfo.mockRejectedValue(new Error("API unavailable"));

      const balancePromise = balanceManager.getBalance("BTC");
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const staleBalance = await balancePromise;

      expect(staleBalance.isStale).toBe(true);
      expect(staleBalance.lastUpdated).toEqual(originalTime); // Same timestamp as original
    });
  });

  describe("Error Handling", () => {
    it("should handle network timeout errors", async () => {
      const timeoutError = new Error("Request timeout");
      mockClient.getAccountInfo.mockRejectedValue(timeoutError);

      const balancePromise = balanceManager.getBalance("BTC");
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(balancePromise).rejects.toThrow("Request timeout");
    });

    it("should handle rate limit errors with longer backoff", async () => {
      const rateLimitError = new Error("Rate limit exceeded") as Error & {
        code?: number;
      };
      rateLimitError.code = 429;

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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      mockClient.getAccountInfo
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockAccountInfo);

      const balancePromise = balanceManager.getBalance("BTC");

      // Should wait longer for rate limit
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(5000);

      const balance = await balancePromise;
      expect(balance.free.toString()).toBe("0.1");
    });

    it("should handle malformed API response", async () => {
      const invalidResponse = {
        // Missing required fields
        balances: "not-an-array",
      } as unknown as BinanceAccountInfo;

      mockClient.getAccountInfo.mockResolvedValueOnce(invalidResponse);

      const balancePromise = balanceManager.getBalance("BTC");
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await expect(balancePromise).rejects.toThrow();
    });

    it("should handle invalid balance format", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "invalid", locked: "0.05" } as BinanceBalance,
        ],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balancePromise = balanceManager.getBalance("BTC");
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await expect(balancePromise).rejects.toThrow();
    });

    it("should handle concurrent requests efficiently", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      // Delay the API response
      mockClient.getAccountInfo.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockAccountInfo), 100);
          }),
      );

      // Make multiple concurrent requests
      const promises = [
        balanceManager.getBalance("BTC"),
        balanceManager.getBalance("BTC"),
        balanceManager.getBalance("BTC"),
      ];

      await jest.advanceTimersByTimeAsync(100);

      const results = await Promise.all(promises);

      // Should only call API once
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1);

      // All should get the same result
      results.forEach((balance) => {
        expect(balance.free.toString()).toBe("0.1");
      });
    });
  });

  describe("Multiple Asset Support", () => {
    it("should fetch multiple assets in one call", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "0.1", locked: "0.05" },
          { asset: "USDT", free: "1000", locked: "500" },
          { asset: "ETH", free: "2.5", locked: "0.5" },
        ],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balances = await balanceManager.getBalances(["BTC", "USDT", "ETH"]);

      expect(balances).toHaveLength(3);
      expect(balances[0].asset).toBe("BTC");
      expect(balances[0].free.toString()).toBe("0.1");
      expect(balances[1].asset).toBe("USDT");
      expect(balances[1].free.toString()).toBe("1000");
      expect(balances[2].asset).toBe("ETH");
      expect(balances[2].free.toString()).toBe("2.5");

      // Should only call API once for all assets
      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1);
    });

    it("should use cache efficiently for multiple assets", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "0.1", locked: "0.05" },
          { asset: "USDT", free: "1000", locked: "500" },
        ],
      };

      mockClient.getAccountInfo.mockResolvedValue(mockAccountInfo);

      // First call fetches all
      const balances1 = await balanceManager.getBalances(["BTC", "USDT"]);
      expect(balances1[0].fromCache).toBe(false);
      expect(balances1[1].fromCache).toBe(false);

      // Second call uses cache
      const balances2 = await balanceManager.getBalances(["BTC", "USDT"]);
      expect(balances2[0].fromCache).toBe(true);
      expect(balances2[1].fromCache).toBe(true);

      expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(1);
    });

    it("should handle partial failures gracefully", async () => {
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
        permissions: ["SPOT"],
        balances: [
          { asset: "BTC", free: "0.1", locked: "0.05" },
          // USDT missing from response
        ],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balances = await balanceManager.getBalances(["BTC", "USDT"]);

      expect(balances).toHaveLength(2);
      expect(balances[0].asset).toBe("BTC");
      expect(balances[0].free.toString()).toBe("0.1");
      expect(balances[1].asset).toBe("USDT");
      expect(balances[1].free.toString()).toBe("0"); // Default to zero
    });
  });

  describe("Integration with BinanceClient", () => {
    it("should integrate properly with existing getAccountInfo", async () => {
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      const balance = await balanceManager.getBalance("BTC");

      expect(mockClient.getAccountInfo).toHaveBeenCalled();
      expect(balance).toBeDefined();
    });

    it("should handle API signature requirements", async () => {
      // This test verifies that the BalanceManager properly delegates
      // to BinanceClient which handles signatures
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
        permissions: ["SPOT"],
        balances: [{ asset: "BTC", free: "0.1", locked: "0.05" }],
      };

      mockClient.getAccountInfo.mockResolvedValueOnce(mockAccountInfo);

      await balanceManager.getBalance("BTC");

      // The actual signature handling is in BinanceClient
      // BalanceManager just needs to call the right method
      expect(mockClient.getAccountInfo).toHaveBeenCalled();
    });
  });
});
