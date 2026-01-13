/**
 * Pool System API Handlers
 *
 * Framework-agnostic handler functions for pool monitoring and management:
 * - GET  /api/pool/status         - Current pool state
 * - GET  /api/pool/reinvestments  - Reinvestment distribution history
 * - GET  /api/pool/transfers      - Funding wallet transfer history
 * - POST /api/pool/transfers/:id/retry - Retry a failed transfer
 * - GET  /api/pool/stats          - Aggregated pool statistics
 *
 * Can be integrated with Express, Fastify, or any HTTP framework.
 * Usage:
 *   const handlers = new PoolApiHandlers(config);
 *   app.get('/api/pool/status', handlers.getPoolStatus.bind(handlers));
 */

import { logger } from "../utils/logger";
import type { ProfitPoolService } from "../pool/profit-pool-service";
import type { ReinvestmentRepository } from "../pool/repositories/reinvestment-repository";
import type { FundingTransferRepository } from "../pool/repositories/funding-transfer-repository";
import Decimal from "decimal.js";

export interface PoolRoutesConfig {
  profitPoolService: ProfitPoolService;
  reinvestmentRepository: ReinvestmentRepository;
  fundingTransferRepository: FundingTransferRepository;
}

export interface ApiRequest {
  query?: Record<string, string | string[]>;
  params?: Record<string, string>;
}

export interface ApiResponse {
  json: (data: unknown) => void;
  status: (code: number) => ApiResponse;
  currentStatus?: number;
}

/**
 * Pool API Handler Functions
 * Framework-agnostic handlers for pool APIs
 */
export class PoolApiHandlers {
  private profitPoolService: ProfitPoolService;
  private reinvestmentRepository: ReinvestmentRepository;
  private fundingTransferRepository: FundingTransferRepository;

  constructor(config: PoolRoutesConfig) {
    this.profitPoolService = config.profitPoolService;
    this.reinvestmentRepository = config.reinvestmentRepository;
    this.fundingTransferRepository = config.fundingTransferRepository;
  }

  /**
   * GET /api/pool/status
   * Returns current pool status with accumulated amounts and statistics
   */
  async getPoolStatus(_req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const status = await this.profitPoolService.getPoolStatus();

      res.json({
        success: true,
        data: {
          totalNetProfits: status.totalNetProfits,
          pendingReinvestment: status.pendingReinvestment,
          pendingFundingTransfer: status.pendingFundingTransfer,
          minTransferAmount: status.minTransferAmount,
          stats: status.stats,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error fetching pool status", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET /api/pool/reinvestments
   * Returns paginated reinvestment distribution history
   */
  async getReinvestments(req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const limit = Math.min(
        Math.max(parseInt((req.query?.limit as string) || "50"), 1),
        500,
      );
      const offset = Math.max(
        parseInt((req.query?.offset as string) || "0"),
        0,
      );

      const result = await this.reinvestmentRepository.getDistributions(
        limit,
        offset,
      );

      res.json({
        success: true,
        data: {
          distributions: result.distributions,
          pagination: {
            limit,
            offset,
            total: result.total,
            hasMore: offset + limit < result.total,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error fetching reinvestment history", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET /api/pool/reinvestments/:id
   * Returns a specific reinvestment distribution with items
   */
  async getReinvestment(req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const id = req.params?.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Distribution ID is required",
        });
      }

      const distribution =
        await this.reinvestmentRepository.getDistribution(id);

      if (!distribution) {
        return res.status(404).json({
          success: false,
          error: "Reinvestment distribution not found",
        });
      }

      res.json({
        success: true,
        data: distribution,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Error fetching reinvestment distribution", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET /api/pool/transfers
   * Returns paginated funding wallet transfer history
   * Optional status filter: PENDING, COMPLETED, FAILED
   */
  async getTransfers(req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const limit = Math.min(
        Math.max(parseInt((req.query?.limit as string) || "50"), 1),
        500,
      );
      const offset = Math.max(
        parseInt((req.query?.offset as string) || "0"),
        0,
      );
      const status = req.query?.status as
        | "PENDING"
        | "COMPLETED"
        | "FAILED"
        | undefined;

      const result = await this.fundingTransferRepository.getTransfers(
        limit,
        offset,
        status,
      );

      res.json({
        success: true,
        data: {
          transfers: result.transfers,
          pagination: {
            limit,
            offset,
            total: result.total,
            hasMore: offset + limit < result.total,
          },
          filters: {
            status: status || "all",
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error fetching transfer history", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET /api/pool/transfers/:id
   * Returns a specific funding wallet transfer
   */
  async getTransfer(req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const id = req.params?.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Transfer ID is required",
        });
      }

      const transfer = await this.fundingTransferRepository.getTransfer(id);

      if (!transfer) {
        return res.status(404).json({
          success: false,
          error: "Transfer not found",
        });
      }

      res.json({
        success: true,
        data: transfer,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Error fetching transfer", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * POST /api/pool/transfers/:id/retry
   * Retry a failed transfer
   */
  async retryTransfer(req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const id = req.params?.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Transfer ID is required",
        });
      }

      // Verify transfer exists and is failed
      const transfer = await this.fundingTransferRepository.getTransfer(id);
      if (!transfer) {
        return res.status(404).json({
          success: false,
          error: "Transfer not found",
        });
      }

      if (transfer.status !== "FAILED") {
        return res.status(400).json({
          success: false,
          error: `Transfer is not in FAILED state (current: ${transfer.status})`,
        });
      }

      if (transfer.retry_count >= 3) {
        return res.status(400).json({
          success: false,
          error: `Transfer has reached maximum retry attempts (${transfer.retry_count})`,
        });
      }

      // Attempt retry
      await this.profitPoolService.retryFailedTransfer(id);

      const updatedTransfer =
        await this.fundingTransferRepository.getTransfer(id);

      res.json({
        success: true,
        data: {
          message: "Transfer retry initiated",
          transfer: updatedTransfer,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Error retrying transfer", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * GET /api/pool/stats
   * Returns aggregated pool statistics
   */
  async getStats(_req: ApiRequest, res: ApiResponse): Promise<void> {
    try {
      const status = await this.profitPoolService.getPoolStatus();
      const failedTransfers =
        await this.fundingTransferRepository.getFailedTransfersForRetry(3);

      res.json({
        success: true,
        data: {
          pool: {
            totalNetProfits: status.totalNetProfits,
            pendingReinvestment: status.pendingReinvestment,
            pendingFundingTransfer: status.pendingFundingTransfer,
            minTransferAmount: status.minTransferAmount,
          },
          statistics: {
            totalReinvested: status.stats.totalReinvested,
            totalTransferred: status.stats.totalTransferred,
            failedTransfersEligibleForRetry: failedTransfers.length,
          },
          health: {
            hasReinvestmentPending: new Decimal(status.pendingReinvestment).gt(
              0,
            ),
            hasFundingPending: new Decimal(status.pendingFundingTransfer).gt(0),
            hasFailedTransfers: failedTransfers.length > 0,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error fetching pool statistics", { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

/**
 * Helper function to create default response object for testing
 */
export function createMockResponse(): ApiResponse & {
  statusCode: number;
  body?: unknown;
} {
  let statusCode = 200;
  let body: unknown;

  return {
    statusCode,
    body,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: unknown) {
      body = data;
    },
  };
}
