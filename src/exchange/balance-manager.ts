import { Decimal } from "decimal.js";

// Configure Decimal to avoid scientific notation for small numbers
Decimal.set({ toExpNeg: -9, toExpPos: 20 });
import type { BinanceClient } from "./binance-client";
import type { BinanceAccountInfo } from "./types";

export interface Balance {
  asset: string;
  free: Decimal;
  locked: Decimal;
  total: Decimal;
  lastUpdated: Date;
  fromCache: boolean;
  isStale?: boolean;
}

export interface BalanceOptions {
  forceRefresh?: boolean;
}

interface CachedBalance {
  balance: Balance;
  timestamp: number;
}

interface RetryState {
  count: number;
  lastAttempt: number;
}

const CACHE_TTL = 1000; // 1 second
const MAX_RETRIES = 3;
const RATE_LIMIT_BACKOFF = 5000; // 5 seconds for rate limit errors

export class BalanceManager {
  private client: BinanceClient;
  private cache: Map<string, CachedBalance> = new Map();
  private lastKnownBalances: Map<string, Balance> = new Map();
  private retryStates: Map<string, RetryState> = new Map();
  private pendingRequests: Map<string, Promise<Balance>> = new Map();

  constructor(client: BinanceClient) {
    this.client = client;
  }

  async getBalance(asset: string, options?: BalanceOptions): Promise<Balance> {
    const forceRefresh = options?.forceRefresh ?? false;

    // Check if we have a pending request for this asset (deduplication)
    const pendingRequest = this.pendingRequests.get(asset);
    if (pendingRequest && !forceRefresh) {
      return pendingRequest;
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.getCachedBalance(asset);
      if (cached) {
        return cached;
      }
    }

    // Create new request
    const requestPromise = this.fetchBalanceWithRetry(asset);
    this.pendingRequests.set(asset, requestPromise);

    try {
      const balance = await requestPromise;
      return balance;
    } finally {
      this.pendingRequests.delete(asset);
    }
  }

  async getBalances(assets: string[]): Promise<Balance[]> {
    // First check what's in cache
    const results: Balance[] = [];
    const assetsToFetch: string[] = [];

    for (const asset of assets) {
      const cached = this.getCachedBalance(asset);
      if (cached) {
        results.push(cached);
      } else {
        assetsToFetch.push(asset);
      }
    }

    // If we need to fetch any, fetch all at once
    if (assetsToFetch.length > 0) {
      try {
        const accountInfo = await this.fetchAccountInfoWithRetry();
        const balances = this.parseAccountInfo(accountInfo, assets);

        // Update cache and results
        for (const balance of balances) {
          this.setCachedBalance(balance.asset, balance);
          this.setLastKnownBalance(balance.asset, balance);

          // Add to results if it was requested and not already cached
          if (assetsToFetch.includes(balance.asset)) {
            results.push(balance);
          }
        }

        // Handle assets not found in response (default to zero)
        for (const asset of assetsToFetch) {
          if (!results.find((b) => b.asset === asset)) {
            const zeroBalance = this.createZeroBalance(asset);
            results.push(zeroBalance);
            this.setCachedBalance(asset, zeroBalance);
          }
        }
      } catch (error) {
        // On error, return last known for all requested assets
        for (const asset of assetsToFetch) {
          const lastKnown = this.lastKnownBalances.get(asset);
          if (lastKnown) {
            results.push({ ...lastKnown, isStale: true, fromCache: false });
          } else {
            throw error;
          }
        }
      }
    }

    // Sort results to match input order
    return assets.map((asset) => {
      const balance = results.find((b) => b.asset === asset);
      if (!balance) {
        // This should not happen as we handle all assets above
        throw new Error(`Balance not found for ${asset}`);
      }
      return balance;
    });
  }

  setLastKnownBalance(asset: string, balance: Balance): void {
    this.lastKnownBalances.set(asset, balance);
  }

  private getCachedBalance(asset: string): Balance | null {
    const cached = this.cache.get(asset);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp <= CACHE_TTL) {
      return { ...cached.balance, fromCache: true };
    }

    // Cache expired
    this.cache.delete(asset);
    return null;
  }

  private setCachedBalance(asset: string, balance: Balance): void {
    this.cache.set(asset, {
      balance: { ...balance, fromCache: false },
      timestamp: Date.now(),
    });
  }

  private async fetchBalanceWithRetry(asset: string): Promise<Balance> {
    let lastError: Error | null = null;
    const retryState = this.retryStates.get(asset) || {
      count: 0,
      lastAttempt: 0,
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Add delay for retries with exponential backoff
        if (attempt > 0) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          await this.delay(delay);
        }

        const accountInfo = await this.client.getAccountInfo();
        const balances = this.parseAccountInfo(accountInfo, [asset]);
        const balance = balances[0] || this.createZeroBalance(asset);

        // Success - reset retry state and update caches
        this.retryStates.delete(asset);
        this.setCachedBalance(asset, balance);
        this.setLastKnownBalance(asset, balance);

        return balance;
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Special handling for rate limit errors
        if (this.isRateLimitError(error)) {
          await this.delay(RATE_LIMIT_BACKOFF);
          // Don't count rate limit as a retry attempt
          attempt--;
          continue;
        }

        retryState.count = attempt + 1;
        retryState.lastAttempt = Date.now();
        this.retryStates.set(asset, retryState);
      }
    }

    // All retries failed - try to return last known balance
    const lastKnown = this.lastKnownBalances.get(asset);
    if (lastKnown) {
      return { ...lastKnown, isStale: true, fromCache: false };
    }

    throw lastError || new Error("Failed to fetch balance");
  }

  private async fetchAccountInfoWithRetry(): Promise<BinanceAccountInfo> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Add delay for retries with exponential backoff
        if (attempt > 0) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await this.delay(delay);
        }

        return await this.client.getAccountInfo();
      } catch (error) {
        lastError = error as Error;

        if (!this.isRetryableError(error)) {
          throw error;
        }

        if (this.isRateLimitError(error)) {
          await this.delay(RATE_LIMIT_BACKOFF);
          attempt--;
          continue;
        }
      }
    }

    throw lastError || new Error("Failed to fetch account info");
  }

  private parseAccountInfo(
    accountInfo: BinanceAccountInfo,
    assets: string[],
  ): Balance[] {
    // Validate account info structure
    if (!accountInfo || !Array.isArray(accountInfo.balances)) {
      throw new Error("Invalid account info structure");
    }

    const balances: Balance[] = [];
    const now = new Date();

    for (const asset of assets) {
      const binanceBalance = accountInfo.balances.find(
        (b) => b.asset === asset,
      );

      if (binanceBalance) {
        try {
          const free = new Decimal(binanceBalance.free);
          const locked = new Decimal(binanceBalance.locked);
          const total = free.plus(locked);

          balances.push({
            asset,
            free,
            locked,
            total,
            lastUpdated: now,
            fromCache: false,
            isStale: false,
          });
        } catch {
          // Invalid number format
          throw new Error(`Invalid balance format for ${asset}`);
        }
      }
    }

    return balances;
  }

  private createZeroBalance(asset: string): Balance {
    return {
      asset,
      free: new Decimal(0),
      locked: new Decimal(0),
      total: new Decimal(0),
      lastUpdated: new Date(),
      fromCache: false,
      isStale: false,
    };
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    const errorWithCode = error as Error & { code?: number | string };

    // Non-retryable errors
    if (errorWithCode.code === -2014) return false; // Invalid API key
    if (errorWithCode.code === -2015) return false; // Invalid API key/secret
    if (message.includes("invalid api")) return false;
    if (message.includes("signature")) return false;
    if (message.includes("authentication")) return false;
    if (message.includes("invalid") && message.includes("structure"))
      return false; // Invalid response structure
    if (message.includes("invalid") && message.includes("format")) return false; // Invalid data format

    // Retryable errors
    if (message.includes("network")) return true;
    if (message.includes("timeout")) return true;
    if (message.includes("unavailable")) return true;
    if (errorWithCode.code === 429) return true; // Rate limit
    if (errorWithCode.code === 503) return true; // Service unavailable
    if (errorWithCode.code === 502) return true; // Bad gateway
    if (errorWithCode.code === 504) return true; // Gateway timeout

    return true; // Default to retryable
  }

  private isRateLimitError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const errorWithCode = error as Error & { code?: number };
    return (
      errorWithCode.code === 429 ||
      error.message.toLowerCase().includes("rate limit")
    );
  }

  private async delay(ms: number): Promise<void> {
    if (ms === 0) {
      return Promise.resolve();
    }

    // Create promise that will resolve when timer fires
    const promise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms);
    });

    // Allow microtasks to process
    await Promise.resolve();

    return promise;
  }
}
