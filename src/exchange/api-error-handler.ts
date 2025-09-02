import type { BinanceError, RateLimitInfo } from "./types";

interface ErrorHandlerConfig {
  maxRetries?: number;
  baseDelay?: number;
  backoffMultiplier?: number;
}

interface RetryOptions {
  preserveState?: boolean;
  context?: unknown;
  onFailure?: () => void;
}

interface FormattingOptions {
  attempt?: number;
  maxAttempts?: number;
}

interface ApiError {
  response?: {
    status: number;
    data?: BinanceError;
    headers?: Record<string, string>;
  };
  message?: string;
  code?: string;
}

interface ExtendedRateLimitInfo extends RateLimitInfo {
  retryAfter?: number;
}

export class BinanceApiErrorHandler {
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly backoffMultiplier: number;
  private rateLimitInfo: ExtendedRateLimitInfo;

  constructor(config: ErrorHandlerConfig = {}) {
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelay = config.baseDelay ?? 1000;
    this.backoffMultiplier = config.backoffMultiplier ?? 2;
    this.rateLimitInfo = {
      weightUsed: 0,
      weightLimit: 1200,
      ordersPerSecond: 0,
      lastResetTime: Date.now(),
    };
  }

  isRetryableError(error: unknown): boolean {
    if (!error) return false;

    // Check for network errors
    if (error instanceof Error) {
      const message = error.message.toUpperCase();
      if (
        message.includes("ECONNREFUSED") ||
        message.includes("ETIMEDOUT") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNRESET") ||
        message.includes("SOCKET") ||
        message.includes("NETWORK")
      ) {
        return true;
      }
    }

    // Check for HTTP status codes
    const apiError = error as ApiError;

    // Check for network error markers in message (for non-Error objects)
    if (apiError.message) {
      const message = apiError.message.toUpperCase();
      if (
        message.includes("ECONNREFUSED") ||
        message.includes("ETIMEDOUT") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNRESET") ||
        message.includes("SOCKET") ||
        message.includes("NETWORK")
      ) {
        return true;
      }
    }

    if (apiError.response?.status) {
      const status = apiError.response.status;

      // Retryable status codes
      if (
        status === 429 ||
        status === 503 ||
        status === 502 ||
        status === 504
      ) {
        return true;
      }

      // Non-retryable status codes
      if (status >= 400 && status < 500) {
        // Check for specific non-retryable Binance error codes
        const errorCode = apiError.response.data?.code;
        if (errorCode === -2010) {
          // Insufficient balance
          return false;
        }
        return false;
      }

      // Server errors (5xx) are generally retryable except specific ones
      if (status >= 500) {
        return true;
      }
    }

    // Default to non-retryable for unknown errors
    return false;
  }

  async executeWithRetry<T>(
    operation: () => Promise<T> | T,
    options: RetryOptions = {},
  ): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Execute the operation
        const result = await Promise.resolve(operation());
        return result;
      } catch (error) {
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Check if we've exhausted retries
        if (attempt === this.maxRetries) {
          break;
        }

        // Calculate delay for retry
        let delay = this.baseDelay * Math.pow(this.backoffMultiplier, attempt);

        // Check for rate limit with retry-after header
        const apiError = error as ApiError;
        if (apiError.response?.status === 429) {
          const retryAfter = apiError.response.headers?.["retry-after"];
          if (retryAfter) {
            delay = parseInt(retryAfter, 10) * 1000;
          }
        }

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    if (options.onFailure) {
      options.onFailure();
    }

    throw new Error(`Maximum retry attempts (${this.maxRetries}) exceeded`);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  extractRateLimitInfo(error: unknown): ExtendedRateLimitInfo | null {
    const apiError = error as ApiError;
    if (!apiError.response?.headers) {
      return null;
    }

    const headers = apiError.response.headers;
    const weightUsed = parseInt(
      headers["x-mbx-used-weight"] || headers["x-mbx-used-weight-1m"] || "0",
      10,
    );
    const ordersPerSecond = parseInt(
      headers["x-mbx-order-count-10s"] || "0",
      10,
    );
    const retryAfter = headers["retry-after"]
      ? parseInt(headers["retry-after"], 10)
      : undefined;

    return {
      weightUsed,
      weightLimit: 1200,
      ordersPerSecond,
      retryAfter,
      lastResetTime: Date.now(),
    };
  }

  updateRateLimitInfo(response: { headers?: Record<string, string> }): void {
    if (!response.headers) return;

    const weightUsed = parseInt(
      response.headers["x-mbx-used-weight"] ||
        response.headers["x-mbx-used-weight-1m"] ||
        "0",
      10,
    );

    if (weightUsed > 0) {
      this.rateLimitInfo.weightUsed = weightUsed;
      this.rateLimitInfo.lastResetTime = Date.now();
    }
  }

  getRateLimitInfo(): ExtendedRateLimitInfo {
    // Check if we should reset based on time window (1 minute)
    if (Date.now() - this.rateLimitInfo.lastResetTime > 60000) {
      this.resetRateLimitInfo();
    }
    return { ...this.rateLimitInfo };
  }

  setRateLimitInfo(info: ExtendedRateLimitInfo): void {
    this.rateLimitInfo = { ...info };
  }

  resetRateLimitInfo(): void {
    this.rateLimitInfo = {
      weightUsed: 0,
      weightLimit: 1200,
      ordersPerSecond: 0,
      lastResetTime: Date.now(),
    };
  }

  formatErrorMessage(error: unknown, options: FormattingOptions = {}): string {
    try {
      let message = "";

      // Add retry attempt information if provided
      if (options.attempt && options.maxAttempts) {
        message += `Retry attempt ${options.attempt} of ${options.maxAttempts}: `;
      }

      if (!error) {
        message += "Unknown error occurred";
        return this.truncateMessage(message);
      }

      // Handle Error instances
      if (error instanceof Error) {
        const errorMessage = error.message.toUpperCase();

        // Network errors
        if (errorMessage.includes("ECONNREFUSED")) {
          message += "Network connection failed: ECONNREFUSED";
        } else if (errorMessage.includes("ETIMEDOUT")) {
          message += "Network connection timed out: ETIMEDOUT";
        } else if (errorMessage.includes("ENOTFOUND")) {
          message += "Network host not found: ENOTFOUND";
        } else {
          message += error.message;
        }

        return this.truncateMessage(message);
      }

      // Handle API errors
      const apiError = error as ApiError;
      if (apiError.response) {
        const { status, data, headers } = apiError.response;

        // Rate limit error
        if (status === 429) {
          message += "Rate limit exceeded";
          const retryAfter = headers?.["retry-after"];
          if (retryAfter) {
            message += `, retry after ${retryAfter} seconds`;
          }
        }
        // Binance API error with code
        else if (data?.code && data?.msg) {
          message += `Binance API Error [${data.code}]: ${data.msg}`;

          // Special handling for specific error codes
          if (data.code === -2010) {
            message = "Insufficient balance for requested action";
          }
        }
        // Generic HTTP error
        else {
          message += `HTTP ${status} error`;
        }
      } else if (apiError.message) {
        message += apiError.message;
      } else {
        message += "Unknown error occurred";
      }

      return this.truncateMessage(message);
    } catch {
      // Handle circular references or other formatting errors
      return "Unknown error occurred";
    }
  }

  private truncateMessage(message: string, maxLength: number = 500): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + "...";
  }
}
