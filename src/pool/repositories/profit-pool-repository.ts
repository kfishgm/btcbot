/**
 * Profit Pool Repository
 *
 * Data access layer for profit pool operations.
 * Handles all database operations for the pool singleton table.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  ProfitPool,
  ProfitPoolInsert,
  ProfitPoolUpdate,
} from "../../types/pool.types";
import Decimal from "decimal.js";
import { logger } from "../../utils/logger";

export class ProfitPoolRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get the singleton profit pool instance
   * Creates one if it doesn't exist
   */
  async getOrCreatePool(): Promise<ProfitPool> {
    const { data, error } = await this.supabase
      .from("profit_pool")
      .select("*")
      .limit(1)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Not found, create new
        logger.info("Profit pool not found, creating new instance");
        return this.createPool();
      }
      throw error;
    }

    return data as ProfitPool;
  }

  /**
   * Create initial profit pool
   */
  async createPool(): Promise<ProfitPool> {
    const { data, error } = await this.supabase
      .from("profit_pool")
      .insert({} as ProfitPoolInsert)
      .select()
      .single();

    if (error) {
      logger.error("Failed to create profit pool", { error });
      throw error;
    }

    logger.info("Profit pool created", { poolId: data.id });
    return data as ProfitPool;
  }

  /**
   * Get current pool state
   */
  async getPoolState(): Promise<ProfitPool> {
    const pool = await this.getOrCreatePool();
    return pool;
  }

  /**
   * Add net profit to pool
   * Updates total_net_profits, allocated_to_reinvestment, and allocated_to_funding_wallet
   */
  async addNetProfit(
    totalNetProfit: Decimal,
    allocatedToReinvestment: Decimal,
    allocatedToFunding: Decimal,
  ): Promise<ProfitPool> {
    const pool = await this.getOrCreatePool();

    const updates: ProfitPoolUpdate = {
      total_net_profits: new Decimal(pool.total_net_profits)
        .add(totalNetProfit)
        .toString(),
      allocated_to_reinvestment: new Decimal(pool.allocated_to_reinvestment)
        .add(allocatedToReinvestment)
        .toString(),
      allocated_to_funding_wallet: new Decimal(pool.allocated_to_funding_wallet)
        .add(allocatedToFunding)
        .toString(),
      last_updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("profit_pool")
      .update(updates)
      .eq("id", pool.id)
      .select()
      .single();

    if (error) {
      logger.error("Failed to add net profit to pool", {
        error,
        poolId: pool.id,
        totalNetProfit: totalNetProfit.toString(),
      });
      throw error;
    }

    logger.debug("Added net profit to pool", {
      totalNetProfit: totalNetProfit.toString(),
      allocatedToReinvestment: allocatedToReinvestment.toString(),
      allocatedToFunding: allocatedToFunding.toString(),
    });

    return data as ProfitPool;
  }

  /**
   * Update allocated reinvestment amount
   */
  async updateAllocatedReinvestment(
    amount: Decimal,
    operation: "add" | "subtract" = "add",
  ): Promise<ProfitPool> {
    const pool = await this.getOrCreatePool();
    const current = new Decimal(pool.allocated_to_reinvestment);
    const updated =
      operation === "add" ? current.add(amount) : current.sub(amount);

    return this.updatePoolField(
      "allocated_to_reinvestment",
      updated.toString(),
    );
  }

  /**
   * Update allocated funding wallet amount
   */
  async updateAllocatedFundingWallet(
    amount: Decimal,
    operation: "add" | "subtract" | "set" = "add",
  ): Promise<ProfitPool> {
    const pool = await this.getOrCreatePool();
    let updated: Decimal;

    if (operation === "set") {
      updated = amount;
    } else {
      const current = new Decimal(pool.allocated_to_funding_wallet);
      updated = operation === "add" ? current.add(amount) : current.sub(amount);
    }

    return this.updatePoolField(
      "allocated_to_funding_wallet",
      updated.toString(),
    );
  }

  /**
   * Generic pool field update
   */
  private async updatePoolField(
    field: keyof ProfitPoolUpdate,
    value: string,
  ): Promise<ProfitPool> {
    const pool = await this.getOrCreatePool();

    const updates: Record<string, unknown> = {
      [field]: value,
      last_updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from("profit_pool")
      .update(updates)
      .eq("id", pool.id)
      .select()
      .single();

    if (error) {
      logger.error(`Failed to update pool field ${String(field)}`, {
        error,
        poolId: pool.id,
      });
      throw error;
    }

    return data as ProfitPool;
  }

  /**
   * Get pool state with decimal conversions for calculation
   */
  async getPoolStateForCalculations(): Promise<{
    totalNetProfits: Decimal;
    allocatedToReinvestment: Decimal;
    allocatedToFundingWallet: Decimal;
  }> {
    const pool = await this.getOrCreatePool();

    return {
      totalNetProfits: new Decimal(pool.total_net_profits),
      allocatedToReinvestment: new Decimal(pool.allocated_to_reinvestment),
      allocatedToFundingWallet: new Decimal(pool.allocated_to_funding_wallet),
    };
  }

  /**
   * Reset pool to initial state (for testing only)
   */
  async resetPool(): Promise<ProfitPool> {
    const pool = await this.getOrCreatePool();

    const { data, error } = await this.supabase
      .from("profit_pool")
      .update({
        total_net_profits: "0",
        allocated_to_reinvestment: "0",
        allocated_to_funding_wallet: "0",
        last_updated_at: new Date().toISOString(),
      } as ProfitPoolUpdate)
      .eq("id", pool.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.warn("Profit pool reset to initial state");
    return data as ProfitPool;
  }
}
