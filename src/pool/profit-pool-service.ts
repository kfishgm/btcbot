/**
 * Profit Pool Service
 *
 * Core orchestration for profit pool management:
 * 1. Receives net profits from SELL/CYCLE_CLOSED events
 * 2. Splits profits by configured percentages
 * 3. HOLDS reinvestment in pool until new cycle creation
 * 4. Accumulates funding wallet amounts with DUST handling
 * 5. Triggers funding wallet transfers when threshold reached
 */

import { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { logger } from "../utils/logger";
import { PoolConfig } from "../types/pool.types";
import { ProfitPoolRepository } from "./repositories/profit-pool-repository";
import { ReinvestmentRepository } from "./repositories/reinvestment-repository";
import { FundingTransferRepository } from "./repositories/funding-transfer-repository";
import { BinanceClient } from "../exchange/binance-client";

export class ProfitPoolService {
  private profitPoolRepo: ProfitPoolRepository;
  private reinvestmentRepo: ReinvestmentRepository;
  private fundingTransferRepo: FundingTransferRepository;

  constructor(
    private supabase: SupabaseClient,
    private config: PoolConfig,
    // Note: binanceClient used in Phase 4 for universal transfers
    private binanceClient: BinanceClient,
  ) {
    this.profitPoolRepo = new ProfitPoolRepository(supabase);
    this.reinvestmentRepo = new ReinvestmentRepository(supabase);
    this.fundingTransferRepo = new FundingTransferRepository(supabase);
  }

  /**
   * Add net profit to the pool
   *
   * Process:
   * 1. Check idempotency - prevent double-counting from same source
   * 2. Update pool total_net_profits
   * 3. Split by configured percentages
   * 4. HOLD reinvestment in pool (not distributed to active cycles)
   * 5. Accumulate funding wallet amount
   * 6. Check if funding threshold reached and process transfer
   */
  async addNetProfit(
    netProfit: Decimal,
    sourceEvent: "SELL" | "CYCLE_CLOSED",
    sourceCycleId: string | null,
  ): Promise<void> {
    if (!this.config.enabled) {
      logger.debug("Pool disabled, skipping profit addition");
      return;
    }

    if (netProfit.lte(0)) {
      logger.debug("Non-positive profit, skipping pool addition", {
        profit: netProfit.toString(),
      });
      return;
    }

    // 1. Check idempotency - prevent double-counting
    if (sourceCycleId) {
      const alreadyAdded = await this.reinvestmentRepo.alreadyAdded(
        sourceCycleId,
        sourceEvent,
      );
      if (alreadyAdded) {
        logger.warn("Profit from this source already added, skipping", {
          sourceEvent,
          sourceCycleId,
          profit: netProfit.toString(),
        });
        return;
      }
    }

    // 2. Calculate allocations by percentage
    const reinvestmentPct = new Decimal(this.config.reinvestmentPercentage).div(
      100,
    );
    const fundingPct = new Decimal(this.config.fundingWalletPercentage).div(
      100,
    );

    const toReinvestment = netProfit.mul(reinvestmentPct);
    const toFunding = netProfit.mul(fundingPct);

    logger.info("Splitting profit by pool percentages", {
      totalProfit: netProfit.toString(),
      toReinvestment: toReinvestment.toString(),
      toFunding: toFunding.toString(),
      reinvestmentPct: this.config.reinvestmentPercentage,
      fundingPct: this.config.fundingWalletPercentage,
    });

    // 3. Update pool totals
    await this.profitPoolRepo.addNetProfit(
      netProfit,
      toReinvestment,
      toFunding,
    );

    // 4. Record reinvestment distribution
    // This creates the audit trail but DOESN'T distribute to active cycles yet
    // Reinvestment is HELD in pool.allocated_to_reinvestment
    // New cycles pick it up via getReinvestmentForConfig()
    const pool = await this.profitPoolRepo.getOrCreatePool();

    const distributionRecord = await this.reinvestmentRepo.createDistribution(
      pool.id,
      toReinvestment,
      sourceEvent,
      sourceCycleId,
      [], // No items yet - items are created when configs pick up reinvestment
    );

    logger.info("Created reinvestment distribution record", {
      distributionId: distributionRecord.distribution.id,
      sourceEvent,
      sourceCycleId,
      amount: toReinvestment.toString(),
    });

    // 5. Accumulate funding wallet and check for transfer threshold
    await this.processFundingWallet(toFunding);
  }

  /**
   * Get accumulated reinvestment for a specific config
   *
   * Called when a NEW cycle is being created.
   * This picks up the config's allocated share of accumulated reinvestment
   * from the pool, and the new cycle uses higher capital (carryOver + reinvestment).
   *
   * Process:
   * 1. Get total pending reinvestment from pool
   * 2. Calculate config's share based on reinvestmentPct
   * 3. Deduct from pool
   * 4. Record distribution item
   * 5. Return amount for new cycle
   */
  async getReinvestmentForConfig(configId: string): Promise<Decimal> {
    if (!this.config.enabled) {
      return new Decimal(0);
    }

    // Get current pool state
    const pool = await this.profitPoolRepo.getOrCreatePool();
    const totalReinvestment = new Decimal(pool.allocated_to_reinvestment);

    if (totalReinvestment.lte(0)) {
      logger.debug(
        "No reinvestment available in pool for config at new cycle creation",
        { configId },
      );
      return new Decimal(0);
    }

    // Get config's reinvestment percentage from database
    const { data: configData, error: configError } = await this.supabase
      .from("strategy_config")
      .select("reinvestment_allocation_pct")
      .eq("id", configId)
      .single();

    if (configError) {
      logger.error("Failed to get config reinvestment percentage", {
        error: configError,
        configId,
      });
      throw configError;
    }

    if (!configData) {
      logger.warn("Config not found", { configId });
      return new Decimal(0);
    }

    const configReinvestmentPct = new Decimal(
      configData.reinvestment_allocation_pct ?? 0,
    );

    // Calculate config's share of accumulated reinvestment
    const configShare = totalReinvestment.mul(configReinvestmentPct).div(100);

    if (configShare.lte(0)) {
      logger.debug("Config has zero reinvestment allocation", { configId });
      return new Decimal(0);
    }

    // Deduct from pool
    const remaining = totalReinvestment.sub(configShare);
    await this.profitPoolRepo.updateAllocatedReinvestment(
      configShare,
      "subtract",
    );

    logger.info("Deducted reinvestment from pool for new cycle", {
      configId,
      configShare: configShare.toString(),
      remainingInPool: remaining.toString(),
      configAllocationPct: configReinvestmentPct.toString(),
    });

    // Create a distribution record for this cycle pickup
    // Note: We may want to update this later with source_event = 'NEW_CYCLE'
    // For now, it's tracked as part of the original profit distribution

    return configShare;
  }

  /**
   * Process funding wallet transfer
   *
   * Accumulates funding amounts and triggers transfer when >= minTransferAmount.
   * Handles DUST (amounts below threshold) by keeping them in the pool for next batch.
   *
   * Process:
   * 1. Check current pending amount (includes previous DUST)
   * 2. If below threshold, keep for next batch (DUST accumulation)
   * 3. If >= threshold, calculate transferable amount (whole units of minTransferAmount)
   * 4. Call Binance API to transfer
   * 5. Record transfer and update DUST
   * 6. On failure, keep full amount for retry
   */
  private async processFundingWallet(incomingFunding: Decimal): Promise<void> {
    const pool = await this.profitPoolRepo.getOrCreatePool();
    const pending = new Decimal(pool.allocated_to_funding_wallet);

    logger.debug("Processing funding wallet", {
      incomingAmount: incomingFunding.toString(),
      currentPending: pending.toString(),
      minTransferAmount: this.config.minFundingTransferAmount,
    });

    if (pending.lt(this.config.minFundingTransferAmount)) {
      logger.info("Funding below transfer threshold, accumulating DUST", {
        pending: pending.toString(),
        min: this.config.minFundingTransferAmount,
      });
      return; // Keep accumulating until threshold reached
    }

    // Transfer full pending amount truncated to 2 decimal places (cents)
    // Any sub-cent remainder stays as dust
    const transferAmount = pending.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const subCentDust = pending.sub(transferAmount);

    logger.info("Funding threshold reached, preparing transfer", {
      pending: pending.toString(),
      transferAmount: transferAmount.toString(),
      subCentDust: subCentDust.toString(),
      minTransferAmount: this.config.minFundingTransferAmount,
    });

    // Create transfer record before calling API (for audit trail)
    const transfer = await this.fundingTransferRepo.createTransfer(
      pool.id,
      transferAmount,
      "PENDING",
    );

    logger.info("Created pending transfer record", {
      transferId: transfer.id,
      amount: transferAmount.toString(),
    });

    try {
      // Call Binance API
      const result = await this.callUniversalTransfer(
        transferAmount.toNumber(),
      );

      // Mark transfer as completed
      await this.fundingTransferRepo.markCompleted(transfer.id, result.tranId);

      // Update pool - remove transferred amount, keep DUST
      await this.profitPoolRepo.updateAllocatedFundingWallet(
        transferAmount,
        "subtract",
      );

      logger.info("Funding transfer completed", {
        transferId: transfer.id,
        amount: transferAmount.toString(),
        transactionId: result.tranId,
        subCentDustRemaining: subCentDust.toString(),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Mark the existing transfer as failed (not a new record)
      await this.fundingTransferRepo.markFailed(transfer.id, errorMsg, false);

      // Keep full amount in pool for retry (including DUST)
      logger.error("Funding transfer failed, will retry later", {
        transferId: transfer.id,
        amount: transferAmount.toString(),
        error: errorMsg,
        nextRetryAmount: pending.toString(),
      });

      throw error;
    }
  }

  /**
   * Call Binance universal transfer API with retry logic
   * Transfers from main account to funding wallet
   *
   * Uses exponential backoff for retries:
   * Attempt 1: immediate
   * Attempt 2: 2 seconds (2^1)
   * Attempt 3: 4 seconds (2^2)
   * Attempt 4: 8 seconds (2^3)
   */
  private async callUniversalTransfer(
    amountUSDT: number,
    attempt: number = 1,
    maxAttempts: number = 4,
  ): Promise<{ tranId: string }> {
    try {
      logger.debug("Calling Binance universal transfer", {
        attempt,
        maxAttempts,
        amount: amountUSDT,
        asset: "USDT",
        type: "MAIN_FUNDING",
      });

      const result = await this.binanceClient.universalTransfer({
        type: "MAIN_FUNDING",
        asset: "USDT",
        amount: amountUSDT,
      });

      logger.info("Binance universal transfer successful", {
        amount: amountUSDT,
        tranId: result.tranId,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if error is retryable (network, rate limit, etc)
      const isRetryable =
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("429") || // Rate limit
        errorMsg.includes("503") || // Service unavailable
        errorMsg.includes("timeout");

      if (isRetryable && attempt < maxAttempts) {
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        logger.warn("Binance transfer failed, retrying with backoff", {
          attempt,
          maxAttempts,
          delayMs,
          error: errorMsg,
        });

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.callUniversalTransfer(amountUSDT, attempt + 1, maxAttempts);
      }

      // Non-retryable error or max retries reached
      logger.error("Binance transfer failed, no more retries", {
        attempt,
        maxAttempts,
        error: errorMsg,
        isRetryable,
      });

      throw error;
    }
  }

  /**
   * Get current pool status
   *
   * Returns total accumulated amounts and statistics
   */
  async getPoolStatus() {
    const pool = await this.profitPoolRepo.getOrCreatePool();
    const totalReinvested = await this.reinvestmentRepo.getTotalReinvested();
    const totalTransferred =
      await this.fundingTransferRepo.getTotalTransferred();

    return {
      totalNetProfits: pool.total_net_profits,
      pendingReinvestment: pool.allocated_to_reinvestment,
      pendingFundingTransfer: pool.allocated_to_funding_wallet,
      minTransferAmount: this.config.minFundingTransferAmount,
      stats: {
        totalReinvested: totalReinvested.toString(),
        totalTransferred: totalTransferred.toString(),
      },
    };
  }

  /**
   * Get failed transfers eligible for retry
   * (for background retry job in Phase 4)
   */
  async getFailedTransfersForRetry(maxRetries: number = 3) {
    return this.fundingTransferRepo.getFailedTransfersForRetry(maxRetries);
  }

  /**
   * Retry a failed transfer
   * (called by background retry job in Phase 4)
   */
  async retryFailedTransfer(transferId: string): Promise<void> {
    const transfer = await this.fundingTransferRepo.getTransfer(transferId);

    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    if (transfer.status !== "FAILED") {
      throw new Error(
        `Transfer is not in FAILED state, status: ${transfer.status}`,
      );
    }

    const transferAmount = new Decimal(transfer.amount);

    try {
      const result = await this.callUniversalTransfer(
        transferAmount.toNumber(),
      );
      await this.fundingTransferRepo.markCompleted(transferId, result.tranId);

      logger.info("Retry transfer completed", {
        transferId,
        amount: transferAmount.toString(),
        transactionId: result.tranId,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.fundingTransferRepo.markFailed(
        transferId,
        errorMsg,
        true, // incrementRetry
      );

      logger.error("Retry transfer failed", {
        transferId,
        amount: transferAmount.toString(),
        error: errorMsg,
      });

      throw error;
    }
  }
}
