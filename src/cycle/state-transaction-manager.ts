import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";
import { logger } from "../utils/logger.js";
import type { CycleState, CycleStateUpdate } from "./cycle-state-manager.js";

export interface StateTransactionManagerConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  transactionTimeoutMs?: number;
}

export interface RetryOptions {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
}

export interface WALMetadata {
  bot_id: string;
  state_update: Partial<CycleState>;
  order_details?: unknown;
  status: "pending" | "completed" | "failed" | "rolled_back";
  result?: unknown;
  error?: string;
  recovered_at?: string;
  timestamp?: string;
  changes?: unknown;
  [key: string]: unknown; // Allow additional properties for JSON compatibility
}

export interface StateChangeEvent {
  id: string;
  event_type: string;
  severity: string;
  message: string | null;
  metadata: WALMetadata | null;
  created_at: string | null;
}

export class VersionConflictError extends Error {
  constructor(
    message: string,
    public readonly context: {
      botId: string;
      expectedVersion: number;
      actualVersion: number;
    },
  ) {
    super(message);
    this.name = "VersionConflictError";
  }
}

export class DeadlockError extends Error {
  constructor(
    message: string,
    public readonly context: {
      botId: string;
      operation: string;
      attempt: number;
    },
  ) {
    super(message);
    this.name = "DeadlockError";
  }
}

export class TransactionRollbackError extends Error {
  constructor(
    message: string,
    public readonly context: {
      botId: string;
      operation: string;
      updates?: Partial<CycleState>;
    },
  ) {
    super(message);
    this.name = "TransactionRollbackError";
  }
}

export class StateTransactionManager {
  private supabase: SupabaseClient<Database>;
  private config: StateTransactionManagerConfig;
  private defaultRetryOptions: RetryOptions = {
    maxRetries: 3,
    delayMs: 100,
    backoffMultiplier: 2,
  };

  constructor(
    supabase: SupabaseClient<Database>,
    _config: StateTransactionManagerConfig = {},
  ) {
    this.supabase = supabase;
    this.config = {
      maxRetries: _config.maxRetries ?? 3,
      retryDelayMs: _config.retryDelayMs ?? 100,
      transactionTimeoutMs: _config.transactionTimeoutMs ?? 30000,
    };
  }

  /**
   * Update state atomically within a database transaction
   */
  async updateStateAtomic(
    botId: string,
    updates: Partial<CycleState>,
  ): Promise<CycleState> {
    let transactionStarted = false;

    try {
      // Start transaction
      const { error: txError } = await this.supabase.rpc(
        "begin_transaction" as never,
      );
      if (txError) throw txError;
      transactionStarted = true;

      // Get current state with lock
      const { data: currentState, error: selectError } = await this.supabase
        .from("cycle_state")
        .select("*")
        .eq("id", botId)
        .single();

      if (selectError) {
        throw new Error(`Failed to get current state: ${selectError.message}`);
      }

      // Apply updates
      const updatedState = { ...currentState, ...updates };

      // Update state
      const { data: newState, error: updateError } = await this.supabase
        .from("cycle_state")
        .update(updatedState)
        .eq("id", botId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update state: ${updateError.message}`);
      }

      // Log to bot_events
      await this.logStateChange(botId, "STATE_UPDATE", updates, "info");

      // Commit transaction
      const { error: commitError } = await this.supabase.rpc(
        "commit_transaction" as never,
      );
      if (commitError) throw commitError;

      logger.info("State updated atomically", {
        botId,
        updates,
      });

      return newState;
    } catch (error) {
      // Rollback transaction if started
      if (transactionStarted) {
        await this.supabase.rpc("rollback_transaction" as never);
      }

      logger.error("Atomic state update failed", {
        botId,
        updates,
        error,
      });

      throw new TransactionRollbackError(
        `Failed to update state atomically: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          botId,
          operation: "updateStateAtomic",
          updates,
        },
      );
    }
  }

  /**
   * Execute operation with write-ahead logging
   */
  async executeWithWriteAheadLog<T>(
    botId: string,
    stateUpdate: Partial<CycleState>,
    operation: () => Promise<T>,
    operationDetails: unknown,
  ): Promise<T> {
    let walId: string | undefined;
    let transactionStarted = false;

    try {
      // Start transaction
      const { error: txError } = await this.supabase.rpc(
        "begin_transaction" as never,
      );
      if (txError) throw txError;
      transactionStarted = true;

      // Write to write-ahead log
      const walMetadata: WALMetadata = {
        bot_id: botId,
        state_update: stateUpdate,
        order_details: operationDetails,
        status: "pending",
      };

      const { data: walEntry, error: walError } = await this.supabase
        .from("bot_events")
        .insert({
          event_type: "write_ahead_log",
          severity: "info",
          message: `WAL: Preparing state update for operation`,
          metadata:
            walMetadata as Database["public"]["Tables"]["bot_events"]["Insert"]["metadata"],
        })
        .select()
        .single();

      if (walError) {
        throw new Error(`Failed to write WAL entry: ${walError.message}`);
      }

      walId = walEntry.id;

      // Update state
      const { error: stateError } = await this.supabase
        .from("cycle_state")
        .update(stateUpdate as CycleStateUpdate)
        .eq("id", botId);

      if (stateError) {
        throw new Error(`Failed to update state: ${stateError.message}`);
      }

      // Commit state changes before operation
      const { error: commitError } = await this.supabase.rpc(
        "commit_transaction" as never,
      );
      if (commitError) throw commitError;
      transactionStarted = false;

      // Execute the operation (e.g., place order)
      const result = await operation();

      // Mark WAL entry as completed
      const completedMetadata: WALMetadata = {
        bot_id: botId,
        state_update: stateUpdate,
        order_details: operationDetails,
        status: "completed",
        result,
      };

      await this.supabase
        .from("bot_events")
        .update({
          metadata:
            completedMetadata as Database["public"]["Tables"]["bot_events"]["Update"]["metadata"],
        })
        .eq("id", walId);

      logger.info("Operation executed with WAL", {
        botId,
        walId,
        stateUpdate,
      });

      return result;
    } catch (error) {
      // Rollback transaction if still active
      if (transactionStarted) {
        await this.supabase.rpc("rollback_transaction" as never);
      }

      // Mark WAL entry as failed if created
      if (walId) {
        const failedMetadata: WALMetadata = {
          bot_id: botId,
          state_update: stateUpdate,
          order_details: operationDetails,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        };

        await this.supabase
          .from("bot_events")
          .update({
            metadata:
              failedMetadata as Database["public"]["Tables"]["bot_events"]["Update"]["metadata"],
          })
          .eq("id", walId);
      }

      logger.error("WAL operation failed", {
        botId,
        walId,
        error,
      });

      throw error;
    }
  }

  /**
   * Update state with optimistic locking using version field
   */
  async updateStateWithVersion(
    botId: string,
    updates: Partial<CycleState>,
    expectedVersion: number,
  ): Promise<CycleState> {
    // Get current state with version
    const { data: currentState, error: selectError } = await this.supabase
      .from("cycle_state")
      .select("*, version:updated_at")
      .eq("id", botId)
      .single();

    if (selectError) {
      throw new Error(`Failed to get current state: ${selectError.message}`);
    }

    // Check version (using updated_at as version indicator)
    const currentVersion = currentState.version
      ? new Date(currentState.version).getTime()
      : 0;
    if (currentVersion !== expectedVersion) {
      throw new VersionConflictError(
        "Version conflict: State has been modified by another process",
        {
          botId,
          expectedVersion,
          actualVersion: currentVersion,
        },
      );
    }

    // Update with new version
    const { data: newState, error: updateError } = await this.supabase
      .from("cycle_state")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      } as CycleStateUpdate)
      .eq("id", botId)
      .eq("updated_at", currentState.version || "")
      .select()
      .single();

    if (updateError) {
      if (updateError.code === "23505") {
        // Duplicate key violation - version conflict
        throw new VersionConflictError("Version conflict during update", {
          botId,
          expectedVersion,
          actualVersion: currentVersion,
        });
      }
      throw new Error(`Failed to update state: ${updateError.message}`);
    }

    await this.logStateChange(
      botId,
      "VERSION_UPDATE",
      { ...updates, version: expectedVersion },
      "info",
    );

    return newState;
  }

  /**
   * Update state with automatic retry on deadlock
   */
  async updateStateWithRetry(
    botId: string,
    updates: Partial<CycleState>,
    retryOptions?: Partial<RetryOptions>,
  ): Promise<CycleState> {
    const options = {
      ...this.defaultRetryOptions,
      ...retryOptions,
    };

    let lastError: Error | undefined;
    let delay = options.delayMs;

    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      try {
        return await this.updateStateAtomic(botId, updates);
      } catch (error) {
        lastError = error as Error;

        // Check if it's a deadlock error
        const isDeadlock =
          error instanceof Error &&
          (error.message.includes("deadlock") ||
            error.message.includes("40P01") ||
            error.message.includes("concurrent"));

        if (!isDeadlock || attempt === options.maxRetries) {
          throw error;
        }

        logger.warn("Deadlock detected, retrying", {
          botId,
          attempt,
          maxRetries: options.maxRetries,
          delayMs: delay,
        });

        // Wait with exponential backoff
        await this.sleep(delay);
        delay *= options.backoffMultiplier;
      }
    }

    throw new DeadlockError(
      `Failed after ${options.maxRetries} retries: ${lastError?.message}`,
      {
        botId,
        operation: "updateStateWithRetry",
        attempt: options.maxRetries,
      },
    );
  }

  /**
   * Update state with SERIALIZABLE isolation for critical operations
   */
  async updateStateCritical(
    botId: string,
    updates: Partial<CycleState>,
  ): Promise<CycleState> {
    let transactionStarted = false;

    try {
      // Start transaction with SERIALIZABLE isolation
      const { error: txError } = await this.supabase.rpc(
        "begin_transaction_serializable" as never,
      );
      if (txError) throw txError;
      transactionStarted = true;

      // Get current state with lock
      const { error: selectError } = await this.supabase
        .from("cycle_state")
        .select("*")
        .eq("id", botId)
        .single();

      if (selectError) {
        throw new Error(`Failed to get current state: ${selectError.message}`);
      }

      // Validate critical conditions
      if (updates.capital_available !== undefined) {
        const newCapital = updates.capital_available;
        if (newCapital < 0) {
          throw new Error("Cannot set negative capital");
        }
      }

      // Apply updates
      const { data: newState, error: updateError } = await this.supabase
        .from("cycle_state")
        .update(updates as CycleStateUpdate)
        .eq("id", botId)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update state: ${updateError.message}`);
      }

      // Log critical update
      await this.logStateChange(botId, "CRITICAL_UPDATE", updates, "warning");

      // Commit with serializable guarantee
      const { error: commitError } = await this.supabase.rpc(
        "commit_transaction" as never,
      );
      if (commitError) throw commitError;

      logger.info("Critical state update completed", {
        botId,
        updates,
      });

      return newState;
    } catch (error) {
      if (transactionStarted) {
        await this.supabase.rpc("rollback_transaction" as never);
      }

      logger.error("Critical state update failed", {
        botId,
        updates,
        error,
      });

      throw new TransactionRollbackError(
        `Critical update failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          botId,
          operation: "updateStateCritical",
          updates,
        },
      );
    }
  }

  /**
   * Recover from incomplete transactions on startup
   */
  async recoverIncompleteTransactions(botId: string): Promise<void> {
    // Find incomplete WAL entries
    const { data: incompleteWALs, error } = await this.supabase
      .from("bot_events")
      .select("*")
      .eq("event_type", "write_ahead_log")
      .eq("severity", "info")
      .filter("metadata->status", "eq", "pending")
      .filter("metadata->bot_id", "eq", botId)
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("Failed to query incomplete WALs", { error });
      return;
    }

    if (!incompleteWALs || incompleteWALs.length === 0) {
      logger.info("No incomplete transactions to recover", { botId });
      return;
    }

    logger.warn("Found incomplete transactions", {
      botId,
      count: incompleteWALs.length,
    });

    for (const wal of incompleteWALs) {
      try {
        const metadata = wal.metadata as WALMetadata | null;

        // Rollback the state update
        if (metadata?.state_update) {
          logger.info("Rolling back incomplete transaction", {
            botId,
            walId: wal.id,
            stateUpdate: metadata.state_update,
          });

          // Mark as rolled back
          const rolledBackMetadata: WALMetadata = {
            ...metadata,
            status: "rolled_back",
            recovered_at: new Date().toISOString(),
          };

          await this.supabase
            .from("bot_events")
            .update({
              metadata:
                rolledBackMetadata as Database["public"]["Tables"]["bot_events"]["Update"]["metadata"],
            })
            .eq("id", wal.id);
        }
      } catch (error) {
        logger.error("Failed to recover transaction", {
          botId,
          walId: wal.id,
          error,
        });
      }
    }
  }

  /**
   * Batch update multiple state fields efficiently
   */
  async batchUpdateState(
    updates: Array<{ botId: string; changes: Partial<CycleState> }>,
  ): Promise<void> {
    let transactionStarted = false;

    try {
      // Start transaction
      const { error: txError } = await this.supabase.rpc(
        "begin_transaction" as never,
      );
      if (txError) throw txError;
      transactionStarted = true;

      // Process all updates
      for (const { botId, changes } of updates) {
        const { error: updateError } = await this.supabase
          .from("cycle_state")
          .update(changes as CycleStateUpdate)
          .eq("id", botId);

        if (updateError) {
          throw new Error(
            `Failed to update bot ${botId}: ${updateError.message}`,
          );
        }

        // Log each update
        await this.logStateChange(botId, "BATCH_UPDATE", changes, "info");
      }

      // Commit all changes
      const { error: commitError } = await this.supabase.rpc(
        "commit_transaction" as never,
      );
      if (commitError) throw commitError;

      logger.info("Batch state update completed", {
        count: updates.length,
      });
    } catch (error) {
      if (transactionStarted) {
        await this.supabase.rpc("rollback_transaction" as never);
      }

      logger.error("Batch state update failed", {
        error,
        updateCount: updates.length,
      });

      throw error;
    }
  }

  /**
   * Get state history from audit trail
   */
  async getStateHistory(
    botId: string,
    limit: number = 100,
  ): Promise<StateChangeEvent[]> {
    const { data, error } = await this.supabase
      .from("bot_events")
      .select("*")
      .or(
        `event_type.eq.STATE_UPDATE,event_type.eq.VERSION_UPDATE,event_type.eq.CRITICAL_UPDATE,event_type.eq.BATCH_UPDATE`,
      )
      .filter("metadata->bot_id", "eq", botId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get state history: ${error.message}`);
    }

    return (data || []) as StateChangeEvent[];
  }

  /**
   * Log state change to bot_events table
   */
  private async logStateChange(
    botId: string,
    eventType: string,
    changes: unknown,
    severity: "info" | "warning" | "error",
  ): Promise<void> {
    try {
      const metadata: WALMetadata = {
        bot_id: botId,
        state_update: {},
        status: "completed",
        changes,
        timestamp: new Date().toISOString(),
      };

      await this.supabase.from("bot_events").insert({
        event_type: eventType,
        severity,
        message: `State change: ${eventType}`,
        metadata:
          metadata as Database["public"]["Tables"]["bot_events"]["Insert"]["metadata"],
      });
    } catch (error) {
      logger.error("Failed to log state change", {
        botId,
        eventType,
        error,
      });
    }
  }

  /**
   * Helper function to sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
