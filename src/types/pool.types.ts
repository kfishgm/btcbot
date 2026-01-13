/**
 * Pool System Type Definitions
 *
 * Types for profit pool management, reinvestment distribution,
 * and funding wallet transfers.
 */

import { Decimal } from "decimal.js";

/**
 * ProfitPool - Singleton table tracking pool state
 */
export interface ProfitPool {
  id: string;
  total_net_profits: string; // DECIMAL(20,8) as string
  allocated_to_reinvestment: string;
  allocated_to_funding_wallet: string;
  last_updated_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
}

export interface ProfitPoolInsert {
  id?: string;
  total_net_profits?: string;
  allocated_to_reinvestment?: string;
  allocated_to_funding_wallet?: string;
}

export interface ProfitPoolUpdate {
  total_net_profits?: string;
  allocated_to_reinvestment?: string;
  allocated_to_funding_wallet?: string;
  last_updated_at?: string;
}

/**
 * ReinvestmentDistribution - Records each reinvestment event
 */
export interface ReinvestmentDistribution {
  id: string;
  pool_id: string;
  total_amount: string; // DECIMAL(20,8) as string
  timestamp: string; // ISO timestamp
  source_event: "SELL" | "CYCLE_CLOSED" | "NEW_CYCLE";
  source_cycle_id: string | null;
  created_at: string; // ISO timestamp
}

export interface ReinvestmentDistributionInsert {
  id?: string;
  pool_id: string;
  total_amount: string;
  timestamp?: string;
  source_event: "SELL" | "CYCLE_CLOSED" | "NEW_CYCLE";
  source_cycle_id?: string | null;
}

export interface ReinvestmentDistributionUpdate {
  total_amount?: string;
  timestamp?: string;
  source_event?: "SELL" | "CYCLE_CLOSED" | "NEW_CYCLE";
  source_cycle_id?: string | null;
}

/**
 * ReinvestmentDistributionItem - Per-config distribution amounts
 */
export interface ReinvestmentDistributionItem {
  id: string;
  distribution_id: string;
  config_id: string;
  amount: string; // DECIMAL(20,8) as string
  normalized_pct: string; // DECIMAL(5,2) as string
  original_capital_pct: string; // DECIMAL(5,2) as string
  created_at: string; // ISO timestamp
}

export interface ReinvestmentDistributionItemInsert {
  id?: string;
  distribution_id: string;
  config_id: string;
  amount: string;
  normalized_pct: string;
  original_capital_pct: string;
}

export interface ReinvestmentDistributionItemUpdate {
  amount?: string;
  normalized_pct?: string;
  original_capital_pct?: string;
}

/**
 * FundingWalletTransfer - External wallet transfer tracking
 */
export interface FundingWalletTransfer {
  id: string;
  pool_id: string;
  amount: string; // DECIMAL(20,8) as string
  timestamp: string; // ISO timestamp
  status: "PENDING" | "COMPLETED" | "FAILED";
  transaction_id: string | null;
  retry_count: number;
  error_message: string | null;
  completed_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
}

export interface FundingWalletTransferInsert {
  id?: string;
  pool_id: string;
  amount: string;
  timestamp?: string;
  status?: "PENDING" | "COMPLETED" | "FAILED";
  transaction_id?: string | null;
  retry_count?: number;
  error_message?: string | null;
  completed_at?: string | null;
}

export interface FundingWalletTransferUpdate {
  amount?: string;
  timestamp?: string;
  status?: "PENDING" | "COMPLETED" | "FAILED";
  transaction_id?: string | null;
  retry_count?: number;
  error_message?: string | null;
  completed_at?: string | null;
}

/**
 * Pool Configuration
 */
export interface PoolConfig {
  enabled: boolean;
  reinvestmentPercentage: number; // 0-100
  fundingWalletPercentage: number; // 0-100, must sum to 100 with above
  minFundingTransferAmount: number; // Minimum USDT to transfer
}

/**
 * Runtime representations using Decimal for precision
 */
export interface ProfitPoolRuntime {
  id: string;
  totalNetProfits: Decimal;
  allocatedToReinvestment: Decimal;
  allocatedToFundingWallet: Decimal;
  lastUpdatedAt: Date;
  createdAt: Date;
}

export interface ReinvestmentDistributionRuntime {
  id: string;
  poolId: string;
  totalAmount: Decimal;
  timestamp: Date;
  sourceEvent: "SELL" | "CYCLE_CLOSED" | "NEW_CYCLE";
  sourceCycleId: string | null;
  items: ReinvestmentDistributionItemRuntime[];
  createdAt: Date;
}

export interface ReinvestmentDistributionItemRuntime {
  id: string;
  distributionId: string;
  configId: string;
  amount: Decimal;
  normalizedPct: Decimal;
  originalCapitalPct: Decimal;
  createdAt: Date;
}

export interface FundingWalletTransferRuntime {
  id: string;
  poolId: string;
  amount: Decimal;
  timestamp: Date;
  status: "PENDING" | "COMPLETED" | "FAILED";
  transactionId: string | null;
  retryCount: number;
  errorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

/**
 * Response types for API endpoints
 */
export interface PoolStatus {
  totalNetProfits: string;
  pendingReinvestment: string; // awaiting new cycle pickup
  pendingFundingTransfer: string; // current DUST
  minTransferAmount: string;
  stats: {
    totalReinvested: string; // already picked up
    totalTransferred: string;
  };
}

export interface ReconciliationReport {
  success: boolean;
  checks: {
    totalNetProfits: {
      expected: string;
      actual: string;
      match: boolean;
    };
    reinvestmentSum: {
      expected: string;
      actual: string;
      match: boolean;
    };
    fundingTransferSum: {
      expected: string;
      actual: string;
      match: boolean;
    };
  };
  discrepancies: Array<{
    field: string;
    expected: string;
    actual: string;
    diff: string;
  }>;
}
