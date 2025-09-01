import { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../types/supabase.js";
import type { CycleState } from "./cycle-state-manager.js";

type Tables = Database["public"]["Tables"];
type BotEvent = Tables["bot_events"]["Row"];

export class VersionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Version conflict: expected ${expected}, got ${actual}`);
    this.name = "VersionConflictError";
  }
}

export class DeadlockError extends Error {
  constructor(
    message: string,
    public attempts: number,
  ) {
    super(message);
    this.name = "DeadlockError";
  }
}

export interface RetryOptions {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
}

interface BatchUpdate {
  botId: string;
  changes: Partial<CycleState>;
}

/**
 * Manages atomic state updates with proper PostgreSQL transaction support
 * Uses Supabase RPC functions that are automatically wrapped in transactions
 */
export class StateTransactionManager {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Atomically update bot state with automatic transaction wrapping
   * RPC calls in Supabase are automatically wrapped in transactions
   */
  async updateStateAtomic(
    botId: string,
    updates: Partial<CycleState>,
  ): Promise<CycleState> {
    const { data, error } = await this.supabase.rpc("update_state_atomic", {
      p_bot_id: botId,
      p_updates: updates,
      p_expected_version: null,
    });

    if (error) {
      throw new Error(`State update failed: ${error.message}`);
    }

    if (!data) {
      throw new Error("No data returned from state update");
    }

    return data as CycleState;
  }

  /**
   * Update state with optimistic locking using version field
   */
  async updateStateWithVersion(
    botId: string,
    updates: Partial<CycleState>,
    expectedVersion: number,
  ): Promise<CycleState> {
    const { data, error } = await this.supabase.rpc("update_state_atomic", {
      p_bot_id: botId,
      p_updates: updates,
      p_expected_version: expectedVersion,
    });

    if (error) {
      if (error.message.includes("Version conflict")) {
        const match = error.message.match(/Expected: (\d+), Current: (\d+)/);
        if (match) {
          throw new VersionConflictError(
            parseInt(match[1]),
            parseInt(match[2]),
          );
        }
        throw new VersionConflictError(expectedVersion, -1);
      }
      throw new Error(`State update failed: ${error.message}`);
    }

    if (!data) {
      throw new Error("No data returned from state update");
    }

    return data as CycleState;
  }

  /**
   * Execute operation with write-ahead logging for recovery
   */
  async executeWithWriteAheadLog<T>(
    botId: string,
    stateUpdate: Partial<CycleState>,
    operation: () => Promise<T>,
    operationMetadata: Json = {},
  ): Promise<T> {
    // Create WAL entry and update state atomically
    const { error: walError } = await this.supabase.rpc("execute_with_wal", {
      p_bot_id: botId,
      p_state_update: stateUpdate,
      p_operation_metadata: operationMetadata,
    });

    if (walError) {
      throw new Error(`WAL execution failed: ${walError.message}`);
    }

    // Execute the operation
    // The WAL entry is already marked as failed by the DB function if this throws
    const result = await operation();
    return result;
  }

  /**
   * Update state with retry logic for handling deadlocks and conflicts
   */
  async updateStateWithRetry(
    botId: string,
    updates: Partial<CycleState>,
    options: RetryOptions = { maxRetries: 3, delayMs: 100 },
  ): Promise<CycleState> {
    let lastError: Error | null = null;
    const backoffMultiplier = options.backoffMultiplier ?? 2;

    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
      try {
        return await this.updateStateAtomic(botId, updates);
      } catch (error) {
        lastError = error as Error;

        // Check if it's a deadlock or serialization error
        const errorMessage = (error as Error).message.toLowerCase();
        const isRetriable =
          errorMessage.includes("deadlock") ||
          errorMessage.includes("serialization") ||
          errorMessage.includes("concurrent update");

        if (!isRetriable || attempt === options.maxRetries - 1) {
          throw new DeadlockError(
            `Failed after ${attempt + 1} retries: ${errorMessage}`,
            attempt + 1,
          );
        }

        // Exponential backoff
        const delay = options.delayMs * Math.pow(backoffMultiplier, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("Update failed after retries");
  }

  /**
   * Perform critical state updates with serializable isolation
   */
  async updateStateCritical(
    botId: string,
    updates: Partial<CycleState>,
  ): Promise<CycleState> {
    // Validate critical constraints before sending to DB
    if (
      updates.capital_available !== undefined &&
      updates.capital_available < 0
    ) {
      throw new Error("Cannot set negative capital");
    }

    if (
      updates.purchases_remaining !== undefined &&
      updates.purchases_remaining < 0
    ) {
      throw new Error("Cannot set negative purchases remaining");
    }

    const { data, error } = await this.supabase.rpc("update_state_critical", {
      p_bot_id: botId,
      p_updates: updates,
    });

    if (error) {
      throw new Error(`Critical update failed: ${error.message}`);
    }

    if (!data) {
      throw new Error("No data returned from critical update");
    }

    return data as CycleState;
  }

  /**
   * Update multiple bot states in a single atomic transaction
   */
  async batchUpdateState(updates: BatchUpdate[]): Promise<void> {
    const batchData = updates.map((u) => ({
      bot_id: u.botId,
      changes: u.changes,
    }));

    const { error } = await this.supabase.rpc("batch_update_states", {
      p_updates: batchData,
    });

    if (error) {
      throw new Error(`Batch update failed: ${error.message}`);
    }
  }

  /**
   * Recover incomplete transactions from WAL on startup
   */
  async recoverIncompleteTransactions(botId: string): Promise<{
    recovered: number;
    failed: number;
  }> {
    const { data, error } = await this.supabase.rpc("recover_incomplete_wal", {
      p_bot_id: botId,
    });

    if (error) {
      throw new Error(`WAL recovery failed: ${error.message}`);
    }

    if (!data) {
      return { recovered: 0, failed: 0 };
    }

    const result = data as {
      recovered: number;
      failed: number;
      total?: number;
    };
    // Return only recovered and failed, ignore total
    return { recovered: result.recovered, failed: result.failed };
  }

  /**
   * Get state change history from audit trail
   */
  async getStateHistory(botId: string, limit = 100): Promise<BotEvent[]> {
    const { data, error } = await this.supabase
      .from("bot_events")
      .select("*")
      .or(
        "event_type.eq.STATE_UPDATE,event_type.eq.CRITICAL_UPDATE,event_type.eq.BATCH_UPDATE",
      )
      .filter("metadata->bot_id", "eq", botId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch state history: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get current state with version for optimistic locking
   */
  async getCurrentStateWithVersion(
    botId: string,
  ): Promise<CycleState & { version: number }> {
    const { data, error } = await this.supabase
      .from("cycle_state")
      .select("*")
      .eq("id", botId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch current state: ${error.message}`);
    }

    if (!data) {
      throw new Error(`Bot state not found: ${botId}`);
    }

    return data as CycleState & { version: number };
  }
}
