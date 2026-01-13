/**
 * Retry Failed Transfers Job
 *
 * Background job that periodically retries failed funding wallet transfers.
 * Should be run on a schedule (every 30 minutes) to recover from temporary failures.
 *
 * Usage:
 * const job = new RetryFailedTransfersJob(profitPoolService, logger);
 * setInterval(() => job.execute(), 30 * 60 * 1000); // Run every 30 minutes
 */

import { logger as defaultLogger } from "../utils/logger";
import type { ProfitPoolService } from "./profit-pool-service";

export class RetryFailedTransfersJob {
  constructor(
    private profitPoolService: ProfitPoolService,
    private logger = defaultLogger,
  ) {}

  /**
   * Execute the retry job
   * Finds failed transfers eligible for retry and attempts to retry them
   */
  async execute(): Promise<void> {
    try {
      this.logger.debug("Starting retry failed transfers job");

      // Get failed transfers eligible for retry (max 3 retries)
      const failedTransfers =
        await this.profitPoolService.getFailedTransfersForRetry(3);

      if (failedTransfers.length === 0) {
        this.logger.debug("No failed transfers to retry");
        return;
      }

      this.logger.info("Found failed transfers to retry", {
        count: failedTransfers.length,
        transferIds: failedTransfers.map((t) => t.id),
      });

      // Retry each transfer
      const results: Array<{
        transferId: string;
        success: boolean;
        error?: unknown;
      }> = [];

      for (const transfer of failedTransfers) {
        try {
          await this.profitPoolService.retryFailedTransfer(transfer.id);
          results.push({ transferId: transfer.id, success: true });
          this.logger.info("Transfer retry successful", {
            transferId: transfer.id,
            amount: transfer.amount,
          });
        } catch (error) {
          results.push({
            transferId: transfer.id,
            success: false,
            error,
          });
          this.logger.error("Transfer retry failed", {
            transferId: transfer.id,
            error,
          });
        }
      }

      // Summary
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      this.logger.info("Retry failed transfers job completed", {
        total: results.length,
        successful: successCount,
        failed: failureCount,
      });
    } catch (error) {
      this.logger.error("Retry failed transfers job error", { error });
    }
  }
}
