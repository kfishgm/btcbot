/**
 * Earn Flex Service Type Definitions
 *
 * Types for Binance Simple Earn Flexible integration
 * per-config principal/interest tracking.
 */

import { Decimal } from "decimal.js";

/**
 * Supported assets for Earn Flex
 */
export type EarnFlexAsset = "USDT" | "BTC";

/**
 * Transaction types for audit trail
 */
export type EarnFlexTransactionType =
  | "SUBSCRIBE_USDT"
  | "SUBSCRIBE_BTC"
  | "REDEEM_USDT"
  | "REDEEM_BTC"
  | "PENDING_USDT"
  | "PENDING_BTC"
  | "PENDING_TO_SUBSCRIBE"
  | "INTEREST_SYNC";

/**
 * Transaction status
 */
export type EarnFlexTransactionStatus = "PENDING" | "SUCCESS" | "FAILED";

/**
 * Database row type for earn_flex_positions
 */
export interface EarnFlexPosition {
  id: string;
  strategy_config_id: string;
  asset: EarnFlexAsset;
  principal_amount: string; // DECIMAL as string
  pending_amount: string; // DECIMAL as string
  interest_earned: string; // DECIMAL as string
  binance_product_id: string | null;
  last_interest_sync: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * Insert type for earn_flex_positions
 */
export interface EarnFlexPositionInsert {
  id?: string;
  strategy_config_id: string;
  asset: EarnFlexAsset;
  principal_amount?: string;
  pending_amount?: string;
  interest_earned?: string;
  binance_product_id?: string | null;
  last_interest_sync?: string | null;
}

/**
 * Update type for earn_flex_positions
 */
export interface EarnFlexPositionUpdate {
  principal_amount?: string;
  pending_amount?: string;
  interest_earned?: string;
  binance_product_id?: string | null;
  last_interest_sync?: string | null;
  updated_at?: string;
}

/**
 * Database row type for earn_flex_transactions
 */
export interface EarnFlexTransaction {
  id: string;
  strategy_config_id: string;
  cycle_id: string | null;
  transaction_type: EarnFlexTransactionType;
  asset: EarnFlexAsset;
  amount: string; // DECIMAL as string
  binance_tran_id: string | null;
  status: EarnFlexTransactionStatus;
  error_message: string | null;
  created_at: string; // ISO timestamp
}

/**
 * Insert type for earn_flex_transactions
 */
export interface EarnFlexTransactionInsert {
  id?: string;
  strategy_config_id: string;
  cycle_id?: string | null;
  transaction_type: EarnFlexTransactionType;
  asset: EarnFlexAsset;
  amount: string;
  binance_tran_id?: string | null;
  status?: EarnFlexTransactionStatus;
  error_message?: string | null;
}

/**
 * Update type for earn_flex_transactions
 */
export interface EarnFlexTransactionUpdate {
  binance_tran_id?: string | null;
  status?: EarnFlexTransactionStatus;
  error_message?: string | null;
}

/**
 * Runtime position info with Decimal for precision
 */
export interface PositionInfo {
  principal: Decimal; // In earn, available for redemption
  pending: Decimal; // Below min, waiting to accumulate
  interest: Decimal; // Earned, not available for trading
}

/**
 * Product info cached from Binance
 */
export interface ProductInfo {
  productId: string;
  minAmount: Decimal;
}

/**
 * Result of a subscribe operation
 */
export interface SubscribeResult {
  success: boolean;
  purchaseId?: number;
  amountSubscribed: Decimal;
  amountPending: Decimal;
  error?: string;
}

/**
 * Result of a redeem operation
 */
export interface RedeemResult {
  success: boolean;
  redeemId?: number;
  amountRedeemed: Decimal;
  error?: string;
}

/**
 * Capital accounting for a single config
 */
export interface ConfigCapitalAccounting {
  configId: string;
  usdt: {
    inEarn: Decimal; // principal_amount - in Binance Earn
    inSpot: Decimal; // pending_amount - in SPOT account
    interest: Decimal; // interest_earned - tracked, not used
    total: Decimal; // inEarn + inSpot (excludes interest)
  };
  btc: {
    inEarn: Decimal;
    inSpot: Decimal;
    interest: Decimal;
    total: Decimal;
  };
}

/**
 * Result of startup reconciliation
 */
export interface ReconciliationResult {
  configId: string;
  accounting: ConfigCapitalAccounting;
  actions: {
    usdtSubscribed: Decimal; // Amount moved from pending to Earn
    btcSubscribed: Decimal;
  };
  warnings: string[];
}

/**
 * Cross-config SPOT balance check
 */
export interface SpotBalanceCheck {
  asset: EarnFlexAsset;
  actualSpotBalance: Decimal;
  expectedInSpot: Decimal; // Sum of all configs' pending amounts
  difference: Decimal; // actual - expected (positive = untracked funds)
  isReconciled: boolean;
}
