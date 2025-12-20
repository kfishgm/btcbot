import type { MainOrchestrator } from "./main-orchestrator.js";
import type { StrategyConfig } from "../config/strategy-config-loader.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger();

/**
 * Manages multiple MainOrchestrator instances for multi-config support
 * Each orchestrator runs independently with its own strategy configuration
 */
export class OrchestratorPool {
  private orchestrators: Map<string, MainOrchestrator> = new Map();
  private readonly configs: StrategyConfig[];

  constructor(configs: StrategyConfig[]) {
    this.configs = configs;
  }

  /**
   * Register an orchestrator for a specific config
   * Called during bootstrap to add orchestrators to the pool
   */
  registerOrchestrator(configId: string, orchestrator: MainOrchestrator): void {
    if (this.orchestrators.has(configId)) {
      throw new Error(`Orchestrator already registered for config ${configId}`);
    }
    this.orchestrators.set(configId, orchestrator);
  }

  /**
   * Initialize all orchestrators in parallel
   * Failures are logged but don't stop other orchestrators from initializing
   */
  async initializeAll(): Promise<void> {
    const initResults = await Promise.allSettled(
      Array.from(this.orchestrators.entries()).map(async ([configId, orch]) => {
        try {
          await orch.initialize();
          return { configId, success: true };
        } catch (error) {
          logger.error(
            `Failed to initialize orchestrator for config ${configId}`,
            { error },
          );
          throw error;
        }
      }),
    );

    // Check results
    const failures = initResults.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const failureCount = failures.length;
      const totalCount = initResults.length;
      logger.error(
        `Failed to initialize ${failureCount}/${totalCount} orchestrators`,
      );
      throw new Error(`${failureCount} orchestrator(s) failed to initialize`);
    }
  }

  /**
   * Start all orchestrators in parallel
   * Each orchestrator runs independently - one failure doesn't stop others
   */
  async startAll(): Promise<void> {
    const startResults = await Promise.allSettled(
      Array.from(this.orchestrators.entries()).map(async ([configId, orch]) => {
        try {
          await orch.start();
          return { configId, success: true };
        } catch (error) {
          logger.error(`Failed to start orchestrator for config ${configId}`, {
            error,
          });
          // Don't throw - let other orchestrators continue
          return { configId, success: false, error };
        }
      }),
    );

    // Check if all failed
    const failures = startResults.filter((r) => r.status === "rejected");
    if (failures.length === startResults.length) {
      throw new Error("All orchestrators failed to start");
    }
  }

  /**
   * Stop all orchestrators gracefully
   * Uses Promise.allSettled to ensure all stop attempts complete
   */
  async stopAll(): Promise<void> {
    const stopResults = await Promise.allSettled(
      Array.from(this.orchestrators.entries()).map(async ([configId, orch]) => {
        try {
          await orch.stop();
          return { configId, success: true };
        } catch (error) {
          logger.error(`Failed to stop orchestrator for config ${configId}`, {
            error,
          });
          return { configId, success: false, error };
        }
      }),
    );

    const failures = stopResults.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.warn(`${failures.length} orchestrator(s) failed to stop cleanly`);
    }

    // Clear the orchestrators map
    this.orchestrators.clear();
  }

  /**
   * Get health status of all orchestrators
   */
  getHealth(): Map<string, { status: string; timeframe: string }> {
    const health = new Map<string, { status: string; timeframe: string }>();

    for (const [configId, orch] of this.orchestrators.entries()) {
      const config = this.configs.find((c) => c.id === configId);
      const orchHealth = orch.getHealth();

      health.set(configId, {
        status: orchHealth.status,
        timeframe: config?.timeframe ?? "unknown",
      });
    }

    return health;
  }

  /**
   * Get count of registered orchestrators
   */
  getCount(): number {
    return this.orchestrators.size;
  }

  /**
   * Get an orchestrator by config ID
   */
  getOrchestrator(configId: string): MainOrchestrator | undefined {
    return this.orchestrators.get(configId);
  }

  /**
   * Get all config IDs
   */
  getConfigIds(): string[] {
    return Array.from(this.orchestrators.keys());
  }
}
