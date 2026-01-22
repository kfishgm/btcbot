/**
 * Funding Wallet Transfer Repository
 *
 * Data access layer for funding wallet transfer tracking.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  FundingWalletTransfer,
  FundingWalletTransferInsert,
  FundingWalletTransferUpdate,
} from "../../types/pool.types";
import Decimal from "decimal.js";
import { logger } from "../../utils/logger";

export class FundingTransferRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new funding wallet transfer record
   */
  async createTransfer(
    poolId: string,
    amount: Decimal,
    status: "PENDING" | "COMPLETED" | "FAILED" = "PENDING",
  ): Promise<FundingWalletTransfer> {
    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .insert({
        pool_id: poolId,
        amount: amount.toString(),
        status,
      } as FundingWalletTransferInsert)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create funding transfer record", { error });
      throw error;
    }

    logger.info("Created funding transfer record", {
      transferId: data.id,
      amount: amount.toString(),
      status,
    });

    return data as FundingWalletTransfer;
  }

  /**
   * Update transfer status to COMPLETED
   */
  async markCompleted(
    transferId: string,
    transactionId: string,
  ): Promise<FundingWalletTransfer> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .update({
        status: "COMPLETED",
        transaction_id: transactionId,
        completed_at: now,
      } as FundingWalletTransferUpdate)
      .eq("id", transferId)
      .select()
      .single();

    if (error) {
      logger.error("Failed to mark transfer as completed", {
        error,
        transferId,
      });
      throw error;
    }

    logger.info("Transfer marked as completed", {
      transferId,
      transactionId,
    });

    return data as FundingWalletTransfer;
  }

  /**
   * Update transfer status to FAILED
   */
  async markFailed(
    transferId: string,
    errorMessage: string,
    incrementRetry: boolean = true,
  ): Promise<FundingWalletTransfer> {
    const transfer = await this.getTransfer(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    const updates: FundingWalletTransferUpdate = {
      status: "FAILED",
      error_message: errorMessage,
    };

    if (incrementRetry) {
      updates.retry_count = transfer.retry_count + 1;
    }

    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .update(updates)
      .eq("id", transferId)
      .select()
      .single();

    if (error) {
      logger.error("Failed to mark transfer as failed", {
        error,
        transferId,
      });
      throw error;
    }

    logger.warn("Transfer marked as failed", {
      transferId,
      errorMessage,
      retryCount: updates.retry_count ?? 0,
    });

    return data as FundingWalletTransfer;
  }

  /**
   * Get a specific transfer
   */
  async getTransfer(transferId: string): Promise<FundingWalletTransfer | null> {
    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .select("*")
      .eq("id", transferId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null; // Not found
      }
      throw error;
    }

    return data as FundingWalletTransfer;
  }

  /**
   * Get transfer history
   */
  async getTransfers(
    limit: number = 50,
    offset: number = 0,
    status?: "PENDING" | "COMPLETED" | "FAILED",
  ): Promise<{
    transfers: FundingWalletTransfer[];
    total: number;
  }> {
    let query = this.supabase
      .from("funding_wallet_transfers")
      .select("*", { count: "exact" });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, count, error } = await query
      .order("timestamp", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return {
      transfers: data as FundingWalletTransfer[],
      total: count ?? 0,
    };
  }

  /**
   * Get failed transfers eligible for retry
   * (status = FAILED and retry_count < maxRetries)
   */
  async getFailedTransfersForRetry(
    maxRetries: number = 3,
  ): Promise<FundingWalletTransfer[]> {
    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .select("*")
      .eq("status", "FAILED")
      .lt("retry_count", maxRetries)
      .order("timestamp", { ascending: true });

    if (error) {
      logger.error("Error getting failed transfers for retry", { error });
      throw error;
    }

    return data as FundingWalletTransfer[];
  }

  /**
   * Get total completed transfers amount
   */
  async getTotalTransferred(): Promise<Decimal> {
    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .select("amount")
      .eq("status", "COMPLETED");

    if (error) {
      logger.error("Error calculating total transferred", { error });
      return new Decimal(0);
    }

    const total = (data ?? []).reduce(
      (sum, row) => sum.add(new Decimal(row.amount)),
      new Decimal(0),
    );

    return total;
  }

  /**
   * Check if there are pending transfers
   */
  async hasPendingTransfers(): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING")
      .limit(1);

    if (error) {
      logger.error("Error checking for pending transfers", { error });
      return false;
    }

    return (data?.length ?? 0) > 0;
  }

  /**
   * Retry a failed transfer (mark back as PENDING)
   */
  async retryTransfer(transferId: string): Promise<FundingWalletTransfer> {
    const { data, error } = await this.supabase
      .from("funding_wallet_transfers")
      .update({
        status: "PENDING",
        error_message: null,
      } as FundingWalletTransferUpdate)
      .eq("id", transferId)
      .select()
      .single();

    if (error) {
      logger.error("Failed to retry transfer", { error, transferId });
      throw error;
    }

    logger.info("Transfer retried", { transferId });

    return data as FundingWalletTransfer;
  }
}
