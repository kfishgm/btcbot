/**
 * Earn Flex Repository
 *
 * Data access layer for Earn Flex operations.
 * Handles all database operations for earn_flex_positions and earn_flex_transactions.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { logger } from "../../utils/logger";
import type {
  EarnFlexAsset,
  EarnFlexPosition,
  EarnFlexPositionInsert,
  EarnFlexPositionUpdate,
  EarnFlexTransaction,
  EarnFlexTransactionInsert,
  EarnFlexTransactionUpdate,
  EarnFlexTransactionType,
  EarnFlexTransactionStatus,
} from "../earn-flex-service.types";

export class EarnFlexRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get or create a position for a config/asset pair
   */
  async getOrCreatePosition(
    configId: string,
    asset: EarnFlexAsset,
  ): Promise<EarnFlexPosition> {
    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .select("*")
      .eq("strategy_config_id", configId)
      .eq("asset", asset)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Not found, create new
        logger.info("Creating new earn flex position", { configId, asset });
        return this.createPosition(configId, asset);
      }
      logger.error("Failed to get earn flex position", {
        error,
        configId,
        asset,
      });
      throw error;
    }

    return data as EarnFlexPosition;
  }

  /**
   * Create a new position
   */
  async createPosition(
    configId: string,
    asset: EarnFlexAsset,
  ): Promise<EarnFlexPosition> {
    const insertData: EarnFlexPositionInsert = {
      strategy_config_id: configId,
      asset,
      principal_amount: "0",
      pending_amount: "0",
      interest_earned: "0",
    };

    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create earn flex position", {
        error,
        configId,
        asset,
      });
      throw error;
    }

    logger.info("Created earn flex position", { configId, asset, id: data.id });
    return data as EarnFlexPosition;
  }

  /**
   * Update position fields
   */
  async updatePosition(
    positionId: string,
    updates: EarnFlexPositionUpdate,
  ): Promise<EarnFlexPosition> {
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .update(updateData)
      .eq("id", positionId)
      .select()
      .single();

    if (error) {
      logger.error("Failed to update earn flex position", {
        error,
        positionId,
      });
      throw error;
    }

    return data as EarnFlexPosition;
  }

  /**
   * Add amount to pending (when below minimum threshold)
   */
  async addToPending(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
  ): Promise<EarnFlexPosition> {
    const position = await this.getOrCreatePosition(configId, asset);
    const newPending = new Decimal(position.pending_amount).add(amount);

    return this.updatePosition(position.id, {
      pending_amount: newPending.toString(),
    });
  }

  /**
   * Move pending amount to principal (when subscribed to Binance)
   */
  async movePendingToPrincipal(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
  ): Promise<EarnFlexPosition> {
    const position = await this.getOrCreatePosition(configId, asset);
    const newPending = new Decimal(position.pending_amount).sub(amount);
    const newPrincipal = new Decimal(position.principal_amount).add(amount);

    // Ensure pending doesn't go negative
    if (newPending.lt(0)) {
      throw new Error(
        `Cannot move ${amount} from pending: only ${position.pending_amount} available`,
      );
    }

    return this.updatePosition(position.id, {
      pending_amount: newPending.toString(),
      principal_amount: newPrincipal.toString(),
    });
  }

  /**
   * Add directly to principal (for cases where we skip pending)
   */
  async addToPrincipal(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
  ): Promise<EarnFlexPosition> {
    const position = await this.getOrCreatePosition(configId, asset);
    const newPrincipal = new Decimal(position.principal_amount).add(amount);

    return this.updatePosition(position.id, {
      principal_amount: newPrincipal.toString(),
    });
  }

  /**
   * Subtract from principal (when redeeming)
   */
  async subtractFromPrincipal(
    configId: string,
    asset: EarnFlexAsset,
    amount: Decimal,
  ): Promise<EarnFlexPosition> {
    const position = await this.getOrCreatePosition(configId, asset);
    const newPrincipal = new Decimal(position.principal_amount).sub(amount);

    if (newPrincipal.lt(0)) {
      throw new Error(
        `Cannot redeem ${amount} from principal: only ${position.principal_amount} available`,
      );
    }

    return this.updatePosition(position.id, {
      principal_amount: newPrincipal.toString(),
    });
  }

  /**
   * Update interest earned (from Binance sync)
   */
  async updateInterestEarned(
    configId: string,
    asset: EarnFlexAsset,
    totalInterest: Decimal,
  ): Promise<EarnFlexPosition> {
    const position = await this.getOrCreatePosition(configId, asset);

    return this.updatePosition(position.id, {
      interest_earned: totalInterest.toString(),
      last_interest_sync: new Date().toISOString(),
    });
  }

  /**
   * Update cached product ID for a position
   */
  async updateProductId(
    configId: string,
    asset: EarnFlexAsset,
    productId: string,
  ): Promise<EarnFlexPosition> {
    const position = await this.getOrCreatePosition(configId, asset);

    return this.updatePosition(position.id, {
      binance_product_id: productId,
    });
  }

  /**
   * Get position by config and asset (returns null if not found)
   */
  async getPosition(
    configId: string,
    asset: EarnFlexAsset,
  ): Promise<EarnFlexPosition | null> {
    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .select("*")
      .eq("strategy_config_id", configId)
      .eq("asset", asset)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw error;
    }

    return data as EarnFlexPosition;
  }

  /**
   * Get all positions for a config
   */
  async getPositionsForConfig(configId: string): Promise<EarnFlexPosition[]> {
    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .select("*")
      .eq("strategy_config_id", configId);

    if (error) {
      logger.error("Failed to get positions for config", { error, configId });
      throw error;
    }

    return (data || []) as EarnFlexPosition[];
  }

  // =============================================
  // Transaction methods
  // =============================================

  /**
   * Create a transaction record
   */
  async createTransaction(
    configId: string,
    transactionType: EarnFlexTransactionType,
    asset: EarnFlexAsset,
    amount: Decimal,
    cycleId?: string | null,
    status: EarnFlexTransactionStatus = "PENDING",
  ): Promise<EarnFlexTransaction> {
    const insertData: EarnFlexTransactionInsert = {
      strategy_config_id: configId,
      transaction_type: transactionType,
      asset,
      amount: amount.toString(),
      cycle_id: cycleId ?? null,
      status,
    };

    const { data, error } = await this.supabase
      .from("earn_flex_transactions")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create earn flex transaction", {
        error,
        configId,
        transactionType,
      });
      throw error;
    }

    return data as EarnFlexTransaction;
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(
    transactionId: string,
    status: EarnFlexTransactionStatus,
    binanceTranId?: string,
    errorMessage?: string,
  ): Promise<EarnFlexTransaction> {
    const updates: EarnFlexTransactionUpdate = { status };

    if (binanceTranId) {
      updates.binance_tran_id = binanceTranId;
    }
    if (errorMessage) {
      updates.error_message = errorMessage;
    }

    const { data, error } = await this.supabase
      .from("earn_flex_transactions")
      .update(updates)
      .eq("id", transactionId)
      .select()
      .single();

    if (error) {
      logger.error("Failed to update transaction status", {
        error,
        transactionId,
      });
      throw error;
    }

    return data as EarnFlexTransaction;
  }

  /**
   * Get recent transactions for a config
   */
  async getRecentTransactions(
    configId: string,
    limit: number = 50,
  ): Promise<EarnFlexTransaction[]> {
    const { data, error } = await this.supabase
      .from("earn_flex_transactions")
      .select("*")
      .eq("strategy_config_id", configId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error("Failed to get recent transactions", { error, configId });
      throw error;
    }

    return (data || []) as EarnFlexTransaction[];
  }

  /**
   * Get transactions by cycle
   */
  async getTransactionsByCycle(
    cycleId: string,
  ): Promise<EarnFlexTransaction[]> {
    const { data, error } = await this.supabase
      .from("earn_flex_transactions")
      .select("*")
      .eq("cycle_id", cycleId)
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("Failed to get transactions by cycle", { error, cycleId });
      throw error;
    }

    return (data || []) as EarnFlexTransaction[];
  }

  /**
   * Get total principal across all configs for an asset
   * (for reconciliation purposes)
   */
  async getTotalPrincipalForAsset(asset: EarnFlexAsset): Promise<Decimal> {
    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .select("principal_amount")
      .eq("asset", asset);

    if (error) {
      logger.error("Failed to get total principal for asset", { error, asset });
      throw error;
    }

    let total = new Decimal(0);
    for (const row of data || []) {
      total = total.add(new Decimal(row.principal_amount || 0));
    }

    return total;
  }

  /**
   * Get total pending across all configs for an asset
   */
  async getTotalPendingForAsset(asset: EarnFlexAsset): Promise<Decimal> {
    const { data, error } = await this.supabase
      .from("earn_flex_positions")
      .select("pending_amount")
      .eq("asset", asset);

    if (error) {
      logger.error("Failed to get total pending for asset", { error, asset });
      throw error;
    }

    let total = new Decimal(0);
    for (const row of data || []) {
      total = total.add(new Decimal(row.pending_amount || 0));
    }

    return total;
  }
}
