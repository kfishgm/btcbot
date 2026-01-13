/**
 * Pool System Metrics and Observability
 *
 * Tracks key metrics for the profit pool system:
 * - Profit additions (count, total amount)
 * - Reinvestment distributions (count, amounts per config)
 * - Funding transfers (success/failure rates, retry attempts)
 * - DUST accumulation (amounts stuck below threshold)
 * - System health indicators
 */

import { logger } from "../utils/logger";

export interface PoolMetrics {
  profitAdditions: {
    count: number;
    totalAmount: string;
    lastTimestamp: string | null;
  };
  reinvestmentDistributions: {
    count: number;
    totalAmount: string;
    lastTimestamp: string | null;
  };
  fundingTransfers: {
    completed: number;
    failed: number;
    pending: number;
    totalTransferred: string;
    successRate: number;
  };
  dustAccumulation: {
    currentDust: string;
    accumulationRate: string; // per day estimate
    daysToThreshold: number;
  };
  health: {
    status: "healthy" | "degraded" | "unhealthy";
    issues: string[];
  };
}

export class PoolMetricsTracker {
  private metrics: PoolMetrics = {
    profitAdditions: { count: 0, totalAmount: "0", lastTimestamp: null },
    reinvestmentDistributions: {
      count: 0,
      totalAmount: "0",
      lastTimestamp: null,
    },
    fundingTransfers: {
      completed: 0,
      failed: 0,
      pending: 0,
      totalTransferred: "0",
      successRate: 0,
    },
    dustAccumulation: {
      currentDust: "0",
      accumulationRate: "0",
      daysToThreshold: 0,
    },
    health: { status: "healthy", issues: [] },
  };

  private startTime: number = Date.now();

  /**
   * Record a profit addition event
   */
  recordProfitAddition(amount: string): void {
    this.metrics.profitAdditions.count++;
    this.metrics.profitAdditions.lastTimestamp = new Date().toISOString();

    logger.debug("Profit addition recorded", {
      amount,
      totalCount: this.metrics.profitAdditions.count,
    });
  }

  /**
   * Record a reinvestment distribution event
   */
  recordReinvestmentDistribution(amount: string): void {
    this.metrics.reinvestmentDistributions.count++;
    this.metrics.reinvestmentDistributions.lastTimestamp =
      new Date().toISOString();

    logger.debug("Reinvestment distribution recorded", {
      amount,
      totalCount: this.metrics.reinvestmentDistributions.count,
    });
  }

  /**
   * Record a funding transfer result
   */
  recordTransferResult(
    status: "completed" | "failed" | "pending",
    amount: string,
  ): void {
    if (status === "completed") {
      this.metrics.fundingTransfers.completed++;
    } else if (status === "failed") {
      this.metrics.fundingTransfers.failed++;
    } else if (status === "pending") {
      this.metrics.fundingTransfers.pending++;
    }

    // Update success rate
    const totalTransfers =
      this.metrics.fundingTransfers.completed +
      this.metrics.fundingTransfers.failed;
    if (totalTransfers > 0) {
      this.metrics.fundingTransfers.successRate =
        this.metrics.fundingTransfers.completed / totalTransfers;
    }

    logger.debug("Transfer result recorded", {
      status,
      amount,
      successRate: `${(this.metrics.fundingTransfers.successRate * 100).toFixed(1)}%`,
    });
  }

  /**
   * Update DUST accumulation metrics
   */
  updateDustMetrics(currentDust: string, minTransferAmount: number): void {
    const dustNum = parseFloat(currentDust);
    const dustRatioPerMinute = dustNum / (Date.now() - this.startTime);
    const dustPerDay = dustRatioPerMinute * 60 * 60 * 24 * 1000;

    const daysToThreshold =
      dustPerDay > 0 ? (minTransferAmount - dustNum) / dustPerDay : Infinity;

    this.metrics.dustAccumulation = {
      currentDust,
      accumulationRate: dustPerDay.toFixed(2),
      daysToThreshold: Math.ceil(daysToThreshold),
    };

    // Log warning if DUST accumulation is slow
    if (daysToThreshold > 7) {
      logger.warn("DUST accumulation slow", {
        currentDust,
        minTransferAmount,
        daysToThreshold: Math.ceil(daysToThreshold),
      });
    }
  }

  /**
   * Evaluate health status
   */
  evaluateHealth(
    failedTransfersCount: number,
    maxFailedTransfers: number = 5,
  ): void {
    const issues: string[] = [];

    // Check for too many failed transfers
    if (failedTransfersCount > maxFailedTransfers) {
      issues.push(
        `Too many failed transfers (${failedTransfersCount}/${maxFailedTransfers})`,
      );
    }

    // Check for low transfer success rate
    const successRate = this.metrics.fundingTransfers.successRate;
    if (successRate < 0.8 && this.metrics.fundingTransfers.completed > 0) {
      issues.push(
        `Low transfer success rate (${(successRate * 100).toFixed(1)}%)`,
      );
    }

    // Check for DUST accumulation taking too long
    if (this.metrics.dustAccumulation.daysToThreshold > 14) {
      issues.push(
        `DUST accumulation very slow (${this.metrics.dustAccumulation.daysToThreshold} days to threshold)`,
      );
    }

    // Determine health status
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (issues.length === 0) {
      status = "healthy";
    } else if (issues.length === 1) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }

    this.metrics.health = { status, issues };

    if (status !== "healthy") {
      logger.warn("Pool health status changed", {
        status,
        issues,
      });
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /**
   * Get health status
   */
  getHealthStatus(): "healthy" | "degraded" | "unhealthy" {
    return this.metrics.health.status;
  }

  /**
   * Get health issues
   */
  getHealthIssues(): string[] {
    return [...this.metrics.health.issues];
  }

  /**
   * Reset metrics (for testing)
   */
  reset(): void {
    this.metrics = {
      profitAdditions: { count: 0, totalAmount: "0", lastTimestamp: null },
      reinvestmentDistributions: {
        count: 0,
        totalAmount: "0",
        lastTimestamp: null,
      },
      fundingTransfers: {
        completed: 0,
        failed: 0,
        pending: 0,
        totalTransferred: "0",
        successRate: 0,
      },
      dustAccumulation: {
        currentDust: "0",
        accumulationRate: "0",
        daysToThreshold: 0,
      },
      health: { status: "healthy", issues: [] },
    };
    this.startTime = Date.now();
  }
}

/**
 * Global metrics tracker instance
 */
let globalMetricsTracker: PoolMetricsTracker | null = null;

/**
 * Get or create global metrics tracker
 */
export function getPoolMetricsTracker(): PoolMetricsTracker {
  if (!globalMetricsTracker) {
    globalMetricsTracker = new PoolMetricsTracker();
  }
  return globalMetricsTracker;
}
