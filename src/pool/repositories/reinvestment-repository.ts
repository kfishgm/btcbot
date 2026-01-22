/**
 * Reinvestment Distribution Repository
 *
 * Data access layer for reinvestment distribution records.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  ReinvestmentDistribution,
  ReinvestmentDistributionInsert,
  ReinvestmentDistributionItem,
  ReinvestmentDistributionItemInsert,
} from "../../types/pool.types";
import Decimal from "decimal.js";
import { logger } from "../../utils/logger";

export interface DistributionRecord {
  distribution: ReinvestmentDistribution;
  items: ReinvestmentDistributionItem[];
}

/** Row type returned from Supabase join query */
interface DistributionRow {
  id: string;
  pool_id: string;
  total_amount: string;
  timestamp: string;
  source_event: "SELL" | "CYCLE_CLOSED" | "NEW_CYCLE";
  source_cycle_id: string | null;
  created_at: string;
  reinvestment_distribution_items: ReinvestmentDistributionItem[];
}

/** Fields to select in distribution queries */
const DISTRIBUTION_SELECT = `
  id,
  pool_id,
  total_amount,
  timestamp,
  source_event,
  source_cycle_id,
  created_at,
  reinvestment_distribution_items (*)
`;

export class ReinvestmentRepository {
  constructor(private supabase: SupabaseClient) {}

  /** Convert a database row to a DistributionRecord */
  private toDistributionRecord(row: DistributionRow): DistributionRecord {
    return {
      distribution: {
        id: row.id,
        pool_id: row.pool_id,
        total_amount: row.total_amount,
        timestamp: row.timestamp,
        source_event: row.source_event,
        source_cycle_id: row.source_cycle_id,
        created_at: row.created_at,
      },
      items: row.reinvestment_distribution_items,
    };
  }

  /**
   * Check if profit has already been added to pool (idempotency)
   */
  async alreadyAdded(
    sourceCycleId: string | null,
    sourceEvent: "SELL" | "CYCLE_CLOSED",
  ): Promise<boolean> {
    if (!sourceCycleId) {
      return false;
    }

    const { data, error } = await this.supabase
      .from("reinvestment_distributions")
      .select("id", { count: "exact" })
      .eq("source_cycle_id", sourceCycleId)
      .eq("source_event", sourceEvent)
      .limit(1);

    if (error) {
      logger.error("Error checking if profit already added", { error });
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  /**
   * Create a new distribution record with items
   */
  async createDistribution(
    poolId: string,
    totalAmount: Decimal,
    sourceEvent: "SELL" | "CYCLE_CLOSED" | "NEW_CYCLE",
    sourceCycleId: string | null,
    items: Array<{
      configId: string;
      amount: Decimal;
      normalizedPct: Decimal;
      originalCapitalPct: Decimal;
    }>,
  ): Promise<DistributionRecord> {
    // Create distribution
    const { data: distData, error: distError } = await this.supabase
      .from("reinvestment_distributions")
      .insert({
        pool_id: poolId,
        total_amount: totalAmount.toString(),
        source_event: sourceEvent,
        source_cycle_id: sourceCycleId,
      } as ReinvestmentDistributionInsert)
      .select()
      .single();

    if (distError) {
      logger.error("Failed to create distribution record", {
        error: distError,
      });
      throw distError;
    }

    const distribution = distData as ReinvestmentDistribution;

    // Create distribution items
    const itemInserts = items.map(
      (item) =>
        ({
          distribution_id: distribution.id,
          config_id: item.configId,
          amount: item.amount.toString(),
          normalized_pct: item.normalizedPct.toString(),
          original_capital_pct: item.originalCapitalPct.toString(),
        }) as ReinvestmentDistributionItemInsert,
    );

    const { data: itemsData, error: itemsError } = await this.supabase
      .from("reinvestment_distribution_items")
      .insert(itemInserts)
      .select();

    if (itemsError) {
      logger.error("Failed to create distribution items", {
        error: itemsError,
      });
      // Clean up distribution if items fail
      await this.supabase
        .from("reinvestment_distributions")
        .delete()
        .eq("id", distribution.id);
      throw itemsError;
    }

    logger.info("Created distribution record", {
      distributionId: distribution.id,
      totalAmount: totalAmount.toString(),
      itemCount: itemsData.length,
    });

    return {
      distribution,
      items: itemsData as ReinvestmentDistributionItem[],
    };
  }

  /**
   * Get distribution history
   */
  async getDistributions(
    limit: number = 50,
    offset: number = 0,
  ): Promise<{
    distributions: DistributionRecord[];
    total: number;
  }> {
    const { data, count, error } = await this.supabase
      .from("reinvestment_distributions")
      .select(DISTRIBUTION_SELECT, { count: "exact" })
      .order("timestamp", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    return {
      distributions: (data ?? []).map((row) =>
        this.toDistributionRecord(row as DistributionRow),
      ),
      total: count ?? 0,
    };
  }

  /**
   * Get a specific distribution with items
   */
  async getDistribution(
    distributionId: string,
  ): Promise<DistributionRecord | null> {
    const { data, error } = await this.supabase
      .from("reinvestment_distributions")
      .select(DISTRIBUTION_SELECT)
      .eq("id", distributionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null; // Not found
      }
      throw error;
    }

    return this.toDistributionRecord(data as DistributionRow);
  }

  /**
   * Get total reinvested amount (sum of completed distributions)
   */
  async getTotalReinvested(): Promise<Decimal> {
    const { data, error } = await this.supabase.rpc(
      "sum_reinvestment_distributions",
    );

    if (error) {
      logger.error("Error calculating total reinvested", { error });
      return new Decimal(0);
    }

    return new Decimal(data ?? 0);
  }
}
