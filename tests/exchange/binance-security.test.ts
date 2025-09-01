import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { BinanceClient } from "../../src/exchange/binance-client";
import type { BinanceConfig } from "../../src/exchange/types";

// Create properly typed mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe("BinanceClient Security Features", () => {
  let client: BinanceClient;

  describe("Credential Validation", () => {
    it("should reject short API keys in production", () => {
      const config: BinanceConfig = {
        apiKey: "short",
        apiSecret: "validSecretKeyThatIsLongEnough",
        testnet: false, // Production mode
      };

      expect(() => new BinanceClient(config)).toThrow(
        "API key length is invalid (expected 20-100 characters)",
      );
    });

    it("should reject long API keys in production", () => {
      const config: BinanceConfig = {
        apiKey: "a".repeat(101),
        apiSecret: "validSecretKeyThatIsLongEnough",
        testnet: false, // Production mode
      };

      expect(() => new BinanceClient(config)).toThrow(
        "API key length is invalid (expected 20-100 characters)",
      );
    });

    it("should reject API keys with invalid characters in production", () => {
      const config: BinanceConfig = {
        apiKey: "invalid-key-with-dashes!!!",
        apiSecret: "validSecretKeyThatIsLongEnough",
        testnet: false, // Production mode
      };

      expect(() => new BinanceClient(config)).toThrow(
        "API key contains invalid characters",
      );
    });

    it("should reject short API secrets in production", () => {
      const config: BinanceConfig = {
        apiKey: "validApiKeyThatIsLongEnough",
        apiSecret: "short",
        testnet: false, // Production mode
      };

      expect(() => new BinanceClient(config)).toThrow(
        "API secret length is invalid (expected 20-100 characters)",
      );
    });

    it("should reject API secrets with invalid characters in production", () => {
      const config: BinanceConfig = {
        apiKey: "validApiKeyThatIsLongEnough",
        apiSecret: "invalid-secret-with-dashes",
        testnet: false, // Production mode
      };

      expect(() => new BinanceClient(config)).toThrow(
        "API secret contains invalid characters",
      );
    });

    it("should accept valid credentials", () => {
      const config: BinanceConfig = {
        apiKey: "validApiKeyThatIsLongEnough123",
        apiSecret: "validSecretKeyThatIsLongEnough456",
        testnet: true,
      };

      expect(() => new BinanceClient(config)).not.toThrow();
    });

    it("should warn about test credentials in production", () => {
      const config: BinanceConfig = {
        apiKey: "testApiKeyForDevelopment",
        apiSecret: "testSecretKeyForDevelopment",
        testnet: false,
      };

      const client = new BinanceClient(config);
      const warnings = client.getWarnings();

      expect(warnings).toContain(
        "API credentials appear to be test/demo credentials but testnet is disabled",
      );
    });

    it("should detect various test credential patterns", () => {
      const testPatterns = [
        {
          apiKey: "demoApiKey1234567890",
          apiSecret: "validSecretKey1234567890",
        },
        {
          apiKey: "validApiKey1234567890",
          apiSecret: "sandboxSecret1234567890",
        },
        { apiKey: "xxxxxxxxxxxxxxxxxxxxx", apiSecret: "yyyyyyyyyyyyyyyyyyyyy" },
        { apiKey: "123456789012345678901", apiSecret: "abcdefghijklmnopqrstu" },
      ];

      let warningCount = 0;
      testPatterns.forEach((pattern) => {
        const client = new BinanceClient({
          ...pattern,
          testnet: false,
        });
        if (client.getWarnings().length > 0) {
          warningCount++;
        }
      });

      expect(warningCount).toBe(testPatterns.length);
    });
  });

  describe("Authentication Testing", () => {
    beforeEach(() => {
      const config: BinanceConfig = {
        apiKey: "validApiKeyThatIsLongEnough",
        apiSecret: "validSecretKeyThatIsLongEnough",
        testnet: true,
      };
      client = new BinanceClient(config);
    });

    it("should track authentication status", () => {
      expect(client.isAuthenticationTested()).toBe(false);
    });

    it("should validate authentication with testAuthentication()", async () => {
      // Mock fetch for account info request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          canTrade: true,
          balances: [],
        }),
      } as Response);

      const result = await client.testAuthentication();
      expect(result).toBe(true);
      expect(client.isAuthenticationTested()).toBe(true);
    });

    it("should handle authentication failures", async () => {
      // Mock fetch to return auth error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({
          code: -2014,
          msg: "Invalid API-key, IP, or permissions for action.",
        }),
      } as Response);

      await expect(client.testAuthentication()).rejects.toThrow(
        "Authentication failed",
      );
      expect(client.isAuthenticationTested()).toBe(false);
    });
  });

  describe("Trading Pair Validation", () => {
    beforeEach(() => {
      const config: BinanceConfig = {
        apiKey: "validApiKeyThatIsLongEnough",
        apiSecret: "validSecretKeyThatIsLongEnough",
        testnet: true,
      };
      client = new BinanceClient(config);
    });

    it("should reject non-USDT trading pairs", async () => {
      await expect(
        client.createOrder({
          symbol: "BTCBUSD",
          side: "BUY",
          type: "LIMIT",
          quantity: 0.001,
          price: 40000,
        }),
      ).rejects.toThrow("Only USDT pairs are supported");
    });

    it("should accept USDT trading pairs", async () => {
      // Mock successful order creation
      mockFetch
        .mockResolvedValueOnce({
          // For time sync
          ok: true,
          headers: new Headers(),
          json: async () => ({ serverTime: Date.now() }),
        } as Response)
        .mockResolvedValueOnce({
          // For order creation
          ok: true,
          headers: new Headers(),
          json: async () => ({
            orderId: 123456,
            symbol: "BTCUSDT",
            status: "NEW",
          }),
        } as Response);

      await client.syncTime();

      const orderPromise = client.createOrder({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 0.001,
        price: 40000,
      });

      // Should not throw for USDT pair
      await expect(orderPromise).resolves.toBeDefined();
    });

    it("should warn about orders below minimum value", async () => {
      // Mock successful order creation
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: async () => ({ serverTime: Date.now() }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers(),
          json: async () => ({
            orderId: 123456,
            symbol: "BTCUSDT",
            status: "NEW",
          }),
        } as Response);

      await client.syncTime();

      await client.createOrder({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: 0.0001,
        price: 40000, // 0.0001 * 40000 = $4 (below $10 minimum)
      });

      const warnings = client.getWarnings();
      expect(warnings.some((w) => w.includes("below Binance minimum"))).toBe(
        true,
      );
      expect(warnings.some((w) => w.includes("$4.00"))).toBe(true);
    });
  });

  describe("Error Message Enhancement", () => {
    beforeEach(() => {
      const config: BinanceConfig = {
        apiKey: "validApiKeyThatIsLongEnough",
        apiSecret: "validSecretKeyThatIsLongEnough",
        testnet: true,
      };
      client = new BinanceClient(config);
    });

    it("should preserve Binance error codes in errors", async () => {
      // Mock fetch to return Binance error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({
          code: -1121,
          msg: "Invalid symbol.",
        }),
      } as Response);

      try {
        await client.getPrice("INVALID");
        fail("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const apiError = error as Error & { code?: number };
        expect(apiError.message).toContain("[-1121]");
        expect(apiError.message).toContain("Invalid symbol");
        expect(apiError.code).toBe(-1121);
      }
    });
  });
});
