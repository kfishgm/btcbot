/**
 * Commission Manager
 *
 * Manages Binance account commission rates with caching and auto-refresh.
 * Fetches taker/maker commission rates from account info and caches them.
 * Automatically refreshes rates to handle VIP level changes.
 */

import type { BinanceClient } from "./binance-client.js";
import { logger } from "../utils/logger.js";

export interface CommissionRates {
  takerCommission: number; // As decimal (0.001 = 0.1%)
  makerCommission: number; // As decimal (0.001 = 0.1%)
  lastUpdated: number;
}

export class CommissionManager {
  private static readonly DEFAULT_COMMISSION = 0.001; // 0.1% default
  private static readonly CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours default

  private commissionCache: CommissionRates | null = null;
  private autoRefreshInterval?: NodeJS.Timeout;
  private onErrorCallback?: (error: Error) => void;

  constructor(private binanceClient: BinanceClient) {}

  /**
   * Initialize by fetching initial commission rates
   */
  async initialize(): Promise<void> {
    try {
      await this.refreshRates();
      logger.info("Commission rates initialized", {
        takerCommission: this.commissionCache?.takerCommission,
        makerCommission: this.commissionCache?.makerCommission,
      });
    } catch (error) {
      logger.error("Failed to initialize commission rates, using defaults", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Set default rates as fallback
      this.commissionCache = {
        takerCommission: CommissionManager.DEFAULT_COMMISSION,
        makerCommission: CommissionManager.DEFAULT_COMMISSION,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Get current taker commission rate (used for market orders)
   * @returns Commission rate as decimal (0.001 = 0.1%)
   */
  async getTakerCommission(): Promise<number> {
    const rates = await this.getCommissionRates();
    return rates.takerCommission;
  }

  /**
   * Get current maker commission rate (used for limit orders)
   * @returns Commission rate as decimal (0.001 = 0.1%)
   */
  async getMakerCommission(): Promise<number> {
    const rates = await this.getCommissionRates();
    return rates.makerCommission;
  }

  /**
   * Get current commission rates with auto-refresh if expired
   */
  async getCommissionRates(): Promise<CommissionRates> {
    // Check if cache exists and is still valid
    if (this.commissionCache && !this.isExpired()) {
      return this.commissionCache;
    }

    // Refresh rates if expired or not cached
    try {
      await this.refreshRates();
    } catch (error) {
      logger.warn("Failed to refresh commission rates, using cached/default", {
        error: error instanceof Error ? error.message : String(error),
      });

      // If we have cached rates, use them even if expired
      if (this.commissionCache) {
        return this.commissionCache;
      }

      // Last resort: return default rates
      return {
        takerCommission: CommissionManager.DEFAULT_COMMISSION,
        makerCommission: CommissionManager.DEFAULT_COMMISSION,
        lastUpdated: Date.now(),
      };
    }

    return this.commissionCache!;
  }

  /**
   * Force refresh commission rates from Binance
   */
  async refreshRates(): Promise<void> {
    try {
      const accountInfo = await this.binanceClient.getAccountInfo();

      // Binance returns commission as integer (10 = 0.1%)
      // Convert to decimal: 10 / 10000 = 0.001
      const takerCommission = accountInfo.takerCommission / 10000;
      const makerCommission = accountInfo.makerCommission / 10000;

      // Handle testnet which may return 0
      const finalTakerCommission =
        takerCommission > 0
          ? takerCommission
          : CommissionManager.DEFAULT_COMMISSION;
      const finalMakerCommission =
        makerCommission > 0
          ? makerCommission
          : CommissionManager.DEFAULT_COMMISSION;

      this.commissionCache = {
        takerCommission: finalTakerCommission,
        makerCommission: finalMakerCommission,
        lastUpdated: Date.now(),
      };

      logger.info("Commission rates refreshed", {
        takerCommission: finalTakerCommission,
        makerCommission: finalMakerCommission,
        rawTaker: accountInfo.takerCommission,
        rawMaker: accountInfo.makerCommission,
      });
    } catch (error) {
      logger.error("Failed to fetch commission rates from Binance", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if cached rates are expired
   */
  private isExpired(): boolean {
    if (!this.commissionCache) {
      return true;
    }
    return (
      Date.now() - this.commissionCache.lastUpdated >
      CommissionManager.CACHE_TTL
    );
  }

  /**
   * Start auto-refresh of commission rates
   * @param intervalMs Refresh interval in milliseconds
   * @param onError Error callback
   */
  startAutoRefresh(
    intervalMs: number = CommissionManager.CACHE_TTL,
    onError?: (error: Error) => void,
  ): void {
    this.stopAutoRefresh(); // Clear any existing interval

    this.onErrorCallback = onError;

    this.autoRefreshInterval = setInterval(async () => {
      try {
        await this.refreshRates();
        logger.debug("Auto-refreshed commission rates");
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Failed to auto-refresh commission rates", {
          error: err.message,
        });
        if (this.onErrorCallback) {
          this.onErrorCallback(err);
        }
      }
    }, intervalMs);

    logger.info(
      `Commission auto-refresh enabled (every ${intervalMs / 1000}s)`,
    );
  }

  /**
   * Stop auto-refresh
   */
  stopAutoRefresh(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = undefined;
      logger.info("Commission auto-refresh stopped");
    }
  }

  /**
   * Check if auto-refresh is enabled
   */
  isAutoRefreshEnabled(): boolean {
    return this.autoRefreshInterval !== undefined;
  }

  /**
   * Get cache status
   */
  getCacheStatus(): {
    cached: boolean;
    expired: boolean;
    rates: CommissionRates | null;
  } {
    return {
      cached: this.commissionCache !== null,
      expired: this.isExpired(),
      rates: this.commissionCache,
    };
  }
}
