import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { BinanceApiErrorHandler } from "../../src/exchange/api-error-handler";

interface CircularError {
  message: string;
  circular?: CircularError;
}

describe("BinanceApiErrorHandler", () => {
  let errorHandler: BinanceApiErrorHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    errorHandler = new BinanceApiErrorHandler();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Error Classification", () => {
    it("should classify network errors as retryable", () => {
      const networkError = new Error("ECONNREFUSED");
      expect(errorHandler.isRetryableError(networkError)).toBe(true);
    });

    it("should classify timeout errors as retryable", () => {
      const timeoutError = new Error("ETIMEDOUT");
      expect(errorHandler.isRetryableError(timeoutError)).toBe(true);
    });

    it("should classify 503 Service Unavailable as retryable", () => {
      const error503 = {
        response: {
          status: 503,
          data: { code: -1003, msg: "Service Unavailable" },
        },
      };
      expect(errorHandler.isRetryableError(error503)).toBe(true);
    });

    it("should classify 429 Too Many Requests as retryable", () => {
      const error429 = {
        response: {
          status: 429,
          data: { code: -1003, msg: "Too many requests" },
          headers: {
            "x-mbx-used-weight": "1200",
            "x-mbx-used-weight-1m": "1200",
            "retry-after": "60",
          },
        },
      };
      expect(errorHandler.isRetryableError(error429)).toBe(true);
    });

    it("should classify 401 Unauthorized as non-retryable", () => {
      const error401 = {
        response: {
          status: 401,
          data: { code: -2014, msg: "API-key format invalid" },
        },
      };
      expect(errorHandler.isRetryableError(error401)).toBe(false);
    });

    it("should classify 400 Bad Request as non-retryable", () => {
      const error400 = {
        response: {
          status: 400,
          data: { code: -1013, msg: "Invalid quantity" },
        },
      };
      expect(errorHandler.isRetryableError(error400)).toBe(false);
    });

    it("should classify insufficient balance error as non-retryable", () => {
      const balanceError = {
        response: {
          status: 400,
          data: {
            code: -2010,
            msg: "Account has insufficient balance for requested action",
          },
        },
      };
      expect(errorHandler.isRetryableError(balanceError)).toBe(false);
    });

    it("should classify unknown errors as non-retryable by default", () => {
      const unknownError = new Error("Some unknown error");
      expect(errorHandler.isRetryableError(unknownError)).toBe(false);
    });
  });

  describe("Retry Logic with Exponential Backoff", () => {
    it("should retry up to 3 times with exponential backoff", async () => {
      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ success: true });

      const promise = errorHandler.executeWithRetry(operation);

      // Fast-forward through all retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const result = await promise;

      expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
      expect(result).toEqual({ success: true });
    });

    it("should use correct exponential backoff delays: 1s, 2s, 4s", async () => {
      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce({ success: true });

      const sleepSpy = jest.spyOn(errorHandler, "sleep");

      const promise = errorHandler.executeWithRetry(operation);

      // Fast-forward through all retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      await promise;

      expect(sleepSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000);
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 4000);
    });

    it("should fail after maximum retry attempts", async () => {
      const operation = jest
        .fn<() => Promise<never>>()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const promise = errorHandler.executeWithRetry(operation).catch((e) => e);

      // Fast-forward through all retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Maximum retry attempts (3) exceeded");
      expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it("should not retry non-retryable errors", async () => {
      const nonRetryableError = {
        response: {
          status: 401,
          data: { code: -2014, msg: "API-key format invalid" },
        },
      };

      const operation = jest
        .fn<() => Promise<never>>()
        .mockRejectedValue(nonRetryableError);

      await expect(errorHandler.executeWithRetry(operation)).rejects.toEqual(
        nonRetryableError,
      );

      expect(operation).toHaveBeenCalledTimes(1); // Only initial attempt, no retries
    });

    it("should succeed on first retry", async () => {
      const operation = jest
        .fn<() => Promise<{ data: string }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ data: "success" });

      const promise = errorHandler.executeWithRetry(operation);

      await jest.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(operation).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: "success" });
    });

    it("should succeed on second retry", async () => {
      const operation = jest
        .fn<() => Promise<{ data: string }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce({ data: "success" });

      const promise = errorHandler.executeWithRetry(operation);

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(operation).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ data: "success" });
    });

    it("should succeed on third retry", async () => {
      const operation = jest
        .fn<() => Promise<{ data: string }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ data: "success" });

      const promise = errorHandler.executeWithRetry(operation);

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const result = await promise;

      expect(operation).toHaveBeenCalledTimes(4);
      expect(result).toEqual({ data: "success" });
    });
  });

  describe("Rate Limit Handling", () => {
    it("should extract rate limit info from 429 response headers", () => {
      const error429 = {
        response: {
          status: 429,
          headers: {
            "x-mbx-used-weight": "1200",
            "x-mbx-used-weight-1m": "1200",
            "x-mbx-order-count-10s": "10",
            "x-mbx-order-count-1m": "50",
            "retry-after": "60",
          },
        },
      };

      const rateLimitInfo = errorHandler.extractRateLimitInfo(error429);

      expect(rateLimitInfo).toEqual({
        weightUsed: 1200,
        weightLimit: 1200,
        ordersPerSecond: 10,
        retryAfter: 60,
        lastResetTime: expect.any(Number),
      });
    });

    it("should pause for retry-after duration on rate limit error", async () => {
      const error429 = {
        response: {
          status: 429,
          data: { code: -1003, msg: "Too many requests" },
          headers: {
            "retry-after": "5", // 5 seconds
          },
        },
      };

      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ success: true });

      const sleepSpy = jest.spyOn(errorHandler, "sleep");

      const promise = errorHandler.executeWithRetry(operation);

      // Fast-forward through rate limit delay
      await jest.advanceTimersByTimeAsync(5000);

      await promise;

      expect(sleepSpy).toHaveBeenCalledWith(5000);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should track and update weight usage from response headers", async () => {
      const response = {
        headers: {
          "x-mbx-used-weight": "100",
          "x-mbx-used-weight-1m": "100",
        },
        data: { success: true },
      };

      errorHandler.updateRateLimitInfo(response);
      const rateLimitInfo = errorHandler.getRateLimitInfo();

      expect(rateLimitInfo.weightUsed).toBe(100);
      expect(rateLimitInfo.lastResetTime).toBeGreaterThan(0);
    });

    it("should handle rate limit without retry-after header", async () => {
      const error429 = {
        response: {
          status: 429,
          data: { code: -1003, msg: "Too many requests" },
          headers: {
            "x-mbx-used-weight": "1200",
          },
        },
      };

      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ success: true });

      const sleepSpy = jest.spyOn(errorHandler, "sleep");

      const promise = errorHandler.executeWithRetry(operation);

      // Should use default backoff when no retry-after
      await jest.advanceTimersByTimeAsync(1000);

      await promise;

      expect(sleepSpy).toHaveBeenCalledWith(1000); // Default first retry delay
    });

    it("should reset rate limit tracking after time window", () => {
      const now = Date.now();

      // Set initial rate limit info
      errorHandler.setRateLimitInfo({
        weightUsed: 1000,
        weightLimit: 1200,
        ordersPerSecond: 10,
        lastResetTime: now - 61000, // 61 seconds ago
      });

      // Should reset after 1 minute window
      const rateLimitInfo = errorHandler.getRateLimitInfo();

      if (Date.now() - rateLimitInfo.lastResetTime > 60000) {
        errorHandler.resetRateLimitInfo();
      }

      const resetInfo = errorHandler.getRateLimitInfo();
      expect(resetInfo.weightUsed).toBe(0);
    });
  });

  describe("State Preservation", () => {
    it("should preserve operation state during retries", async () => {
      const state = { counter: 0, data: [] as string[] };

      const operation = jest.fn<() => Promise<typeof state>>(async () => {
        state.counter++;
        state.data.push(`attempt-${state.counter}`);

        if (state.counter < 3) {
          throw new Error("ECONNREFUSED");
        }
        return state;
      });

      const promise = errorHandler.executeWithRetry(operation, {
        preserveState: true,
      });

      // Advance timers for retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result.counter).toBe(3);
      expect(result.data).toEqual(["attempt-1", "attempt-2", "attempt-3"]);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should pass context through retries", async () => {
      const context = { userId: "123", orderId: "456" };

      const operation = jest
        .fn<
          (
            ctx: typeof context,
          ) => Promise<{ success: boolean; context: typeof context }>
        >()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ success: true, context });

      const promise = errorHandler.executeWithRetry(() => operation(context), {
        context,
      });

      // Advance timer for retry
      await jest.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.context).toEqual(context);
      expect(operation).toHaveBeenCalledWith(context);
    });

    it("should maintain request parameters across retries", async () => {
      const params = { symbol: "BTCUSDT", quantity: 0.001 };

      const operation = jest
        .fn<
          (
            p: typeof params,
          ) => Promise<{ success: boolean; params: typeof params }>
        >()
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ success: true, params });

      const promise = errorHandler.executeWithRetry(() => operation(params));

      // Advance timers for retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      await promise;

      expect(operation).toHaveBeenCalledTimes(3);
      expect(operation).toHaveBeenCalledWith(params);
    });
  });

  describe("Error Message Formatting", () => {
    it("should format network error messages clearly", () => {
      const error = new Error("ECONNREFUSED");
      const formatted = errorHandler.formatErrorMessage(error);

      expect(formatted).toContain("Network connection failed");
      expect(formatted).toContain("ECONNREFUSED");
    });

    it("should format Binance API error messages with code and description", () => {
      const error = {
        response: {
          status: 400,
          data: {
            code: -1013,
            msg: "Invalid quantity.",
          },
        },
      };

      const formatted = errorHandler.formatErrorMessage(error);

      expect(formatted).toContain("Binance API Error");
      expect(formatted).toContain("-1013");
      expect(formatted).toContain("Invalid quantity");
    });

    it("should format rate limit error with retry information", () => {
      const error = {
        response: {
          status: 429,
          data: { code: -1003, msg: "Too many requests" },
          headers: {
            "retry-after": "60",
          },
        },
      };

      const formatted = errorHandler.formatErrorMessage(error);

      expect(formatted).toContain("Rate limit exceeded");
      expect(formatted).toContain("retry after 60 seconds");
    });

    it("should format insufficient balance error with clear message", () => {
      const error = {
        response: {
          status: 400,
          data: {
            code: -2010,
            msg: "Account has insufficient balance for requested action.",
          },
        },
      };

      const formatted = errorHandler.formatErrorMessage(error);

      expect(formatted).toContain("Insufficient balance");
      expect(formatted).toContain("requested action");
    });

    it("should format unknown errors gracefully", () => {
      const error = { unexpected: "format" };
      const formatted = errorHandler.formatErrorMessage(error);

      expect(formatted).toContain("Unknown error occurred");
    });

    it("should include retry attempt information in error messages", () => {
      const error = new Error("ECONNREFUSED");
      const formatted = errorHandler.formatErrorMessage(error, {
        attempt: 2,
        maxAttempts: 3,
      });

      expect(formatted).toContain("Retry attempt 2 of 3");
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined errors gracefully", async () => {
      const operation = jest
        .fn<() => Promise<never>>()
        .mockRejectedValueOnce(null);

      await expect(errorHandler.executeWithRetry(operation)).rejects.toBeNull();

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should handle circular reference errors", () => {
      const error: CircularError = { message: "Test error" };
      error.circular = error; // Create circular reference

      const formatted = errorHandler.formatErrorMessage(error);
      expect(formatted).toBeDefined();
      expect(formatted).not.toContain("[object Object]");
    });

    it("should handle very long error messages", () => {
      const longMessage = "Error: " + "x".repeat(10000);
      const error = new Error(longMessage);

      const formatted = errorHandler.formatErrorMessage(error);
      expect(formatted.length).toBeLessThanOrEqual(500); // Should truncate
    });

    it("should handle concurrent retry operations", async () => {
      const operation1 = jest
        .fn<() => Promise<{ id: number }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ id: 1 });

      const operation2 = jest
        .fn<() => Promise<{ id: number }>>()
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce({ id: 2 });

      const promise1 = errorHandler.executeWithRetry(operation1);
      const promise2 = errorHandler.executeWithRetry(operation2);

      // Advance timer for both retries
      await jest.advanceTimersByTimeAsync(1000);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ id: 1 });
      expect(result2).toEqual({ id: 2 });
      expect(operation1).toHaveBeenCalledTimes(2);
      expect(operation2).toHaveBeenCalledTimes(2);
    });

    it("should handle operations that throw synchronously", async () => {
      const operation = jest.fn<() => never>(() => {
        throw new Error("Synchronous error");
      });

      await expect(errorHandler.executeWithRetry(operation)).rejects.toThrow(
        "Synchronous error",
      );

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should cleanup resources on final failure", async () => {
      const cleanup = jest.fn<() => void>();

      const operation = jest
        .fn<() => Promise<never>>()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const promise = errorHandler
        .executeWithRetry(operation, {
          onFailure: cleanup,
        })
        .catch((e) => e);

      // Advance timers for all retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);

      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Maximum retry attempts (3) exceeded");
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("should not cleanup resources on success", async () => {
      const cleanup = jest.fn<() => void>();

      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ success: true });

      const promise = errorHandler.executeWithRetry(operation, {
        onFailure: cleanup,
      });

      // Advance timer for retry
      await jest.advanceTimersByTimeAsync(1000);

      await promise;

      expect(cleanup).not.toHaveBeenCalled();
    });
  });

  describe("Integration with BinanceClient", () => {
    it("should handle typical API request retry scenario", async () => {
      const mockRequest = jest
        .fn<() => Promise<{ data: { symbol: string; price: string } }>>()
        .mockRejectedValueOnce({
          response: {
            status: 503,
            data: { code: -1001, msg: "Internal error" },
          },
        })
        .mockResolvedValueOnce({
          data: { symbol: "BTCUSDT", price: "50000" },
        });

      const promise = errorHandler.executeWithRetry(mockRequest);

      // Advance timer for retry
      await jest.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.data.symbol).toBe("BTCUSDT");
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it("should handle order placement with insufficient balance", async () => {
      const placeOrder = jest.fn<() => Promise<never>>().mockRejectedValue({
        response: {
          status: 400,
          data: {
            code: -2010,
            msg: "Account has insufficient balance for requested action.",
          },
        },
      });

      await expect(
        errorHandler.executeWithRetry(placeOrder),
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: { code: -2010 },
        },
      });

      expect(placeOrder).toHaveBeenCalledTimes(1); // No retries for insufficient balance
    });

    it("should handle signature verification errors", async () => {
      const signedRequest = jest.fn<() => Promise<never>>().mockRejectedValue({
        response: {
          status: 401,
          data: {
            code: -1022,
            msg: "Signature for this request is not valid.",
          },
        },
      });

      await expect(
        errorHandler.executeWithRetry(signedRequest),
      ).rejects.toMatchObject({
        response: {
          status: 401,
          data: { code: -1022 },
        },
      });

      expect(signedRequest).toHaveBeenCalledTimes(1); // No retries for auth errors
    });
  });

  describe("Custom Retry Configuration", () => {
    it("should allow custom maximum retry attempts", async () => {
      const customHandler = new BinanceApiErrorHandler({ maxRetries: 5 });
      const operation = jest
        .fn<() => Promise<never>>()
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const promise = customHandler.executeWithRetry(operation).catch((e) => e);

      // Advance timers for all 5 retries
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);
      await jest.advanceTimersByTimeAsync(8000);
      await jest.advanceTimersByTimeAsync(16000);

      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Maximum retry attempts (5) exceeded");
      expect(operation).toHaveBeenCalledTimes(6); // Initial + 5 retries
    });

    it("should allow custom base delay", async () => {
      const customHandler = new BinanceApiErrorHandler({ baseDelay: 500 });
      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ success: true });

      const sleepSpy = jest.spyOn(customHandler, "sleep");

      const promise = customHandler.executeWithRetry(operation);
      await jest.advanceTimersByTimeAsync(500);
      await promise;

      expect(sleepSpy).toHaveBeenCalledWith(500); // Custom base delay
    });

    it("should allow custom backoff multiplier", async () => {
      const customHandler = new BinanceApiErrorHandler({
        backoffMultiplier: 3,
      });
      const operation = jest
        .fn<() => Promise<{ success: boolean }>>()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({ success: true });

      const sleepSpy = jest.spyOn(customHandler, "sleep");

      const promise = customHandler.executeWithRetry(operation);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(3000); // 1000 * 3
      await promise;

      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 3000);
    });
  });
});
