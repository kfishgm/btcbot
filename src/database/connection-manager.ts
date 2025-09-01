import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.js";
import { EventEmitter } from "events";

// Type definitions
export interface ConnectionConfig {
  url: string;
  key: string;
  poolOptions?: ConnectionPoolOptions;
  retryOptions?: RetryOptions;
  sslOptions?: SSLOptions;
  degradationOptions?: DegradationOptions;
}

export interface ConnectionPoolOptions {
  maxConnections?: number;
  minConnections?: number;
  connectionTimeout?: number;
  idleTimeout?: number;
  maxWaitingRequests?: number;
  queueTimeout?: number;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  factor?: number;
  jitter?: boolean;
  retryCondition?: (error: ConnectionError) => boolean;
  onRetry?: (attempt: number, error: ConnectionError) => void;
}

export interface SSLOptions {
  enabled?: boolean;
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface DegradationOptions {
  enableCaching?: boolean;
  readOnlyMode?: boolean;
  fallbackData?: unknown;
  cacheTimeout?: number;
}

export interface ShutdownOptions {
  gracefulTimeout?: number;
  force?: boolean;
}

export interface QueryOptions {
  timeout?: number;
  priority?: "high" | "normal" | "low";
}

export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  totalQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  connectionRetries: number;
  lastConnectionTime?: Date;
  lastQueryTime?: Date;
}

export interface ConnectionPoolStats {
  size: number;
  available: number;
  pending: number;
  maxSize: number;
  waitingRequests: number;
}

export interface HealthStatus {
  healthy: boolean;
  lastCheck: Date;
  errors?: string[];
  latency?: number;
  poolStatus?: ConnectionPoolStats;
}

export interface ConnectionError extends Error {
  code?: string;
  type?: "network" | "auth" | "timeout" | "rate_limit" | "unknown";
  context?: Record<string, unknown>;
  retryable?: boolean;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "closing"
  | "closed";

interface ConnectionPoolEntry {
  client: SupabaseClient<Database>;
  inUse: boolean;
  lastUsed: Date;
  created: Date;
}

interface QueuedOperation {
  execute: (client: SupabaseClient<Database>) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  priority: "high" | "normal" | "low";
  timestamp: Date;
}

export class ConnectionManager extends EventEmitter {
  private config: ConnectionConfig;
  private pool: ConnectionPoolEntry[] = [];
  private state: ConnectionState = "disconnected";
  private metrics: ConnectionMetrics;
  private isShuttingDown = false;
  private operationQueue: QueuedOperation[] = [];
  private reconnectTimer?: NodeJS.Timeout;
  private idleCheckTimer?: NodeJS.Timeout;
  private retryAttempt = 0;
  private cache = new Map<string, { data: unknown; timestamp: number }>();
  private isDegraded = false;

  constructor(config: ConnectionConfig) {
    super();
    this.config = this.validateConfig(config);
    this.metrics = this.initializeMetrics();
    this.setupIdleCheck();
  }

  private validateConfig(config: ConnectionConfig): ConnectionConfig {
    if (!config.url || !config.key) {
      throw new Error("Supabase URL and key are required");
    }

    // Set defaults
    return {
      ...config,
      poolOptions: {
        maxConnections: 10,
        minConnections: 2,
        connectionTimeout: 10000,
        idleTimeout: 60000,
        maxWaitingRequests: 100,
        queueTimeout: 30000,
        ...config.poolOptions,
      },
      retryOptions: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        factor: 2,
        jitter: true,
        ...config.retryOptions,
      },
      sslOptions: {
        enabled: true,
        rejectUnauthorized: true,
        ...config.sslOptions,
      },
      degradationOptions: {
        enableCaching: true,
        readOnlyMode: false,
        cacheTimeout: 300000, // 5 minutes
        ...config.degradationOptions,
      },
    };
  }

  private initializeMetrics(): ConnectionMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalQueries: 0,
      failedQueries: 0,
      averageQueryTime: 0,
      connectionRetries: 0,
    };
  }

  private setupIdleCheck(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
    }

    this.idleCheckTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, 30000); // Check every 30 seconds
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    const idleTimeout = this.config.poolOptions?.idleTimeout || 60000;
    const minConnections = this.config.poolOptions?.minConnections || 2;

    this.pool = this.pool.filter((entry) => {
      if (
        !entry.inUse &&
        this.pool.filter((e) => !e.inUse).length > minConnections &&
        now - entry.lastUsed.getTime() > idleTimeout
      ) {
        this.metrics.idleConnections--;
        return false;
      }
      return true;
    });
  }

  async connect(): Promise<void> {
    if (this.state === "connected") {
      return;
    }

    this.setState("connecting");

    try {
      // Create initial connections
      const minConnections = this.config.poolOptions?.minConnections || 2;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < minConnections; i++) {
        promises.push(this.createConnection());
      }

      await Promise.all(promises);

      // Test connection
      await this.testConnection();

      this.setState("connected");
      this.metrics.lastConnectionTime = new Date();
      this.emit("connected");
    } catch (error) {
      this.setState("error");
      this.emit("error", error);
      throw this.wrapError(error as Error, "network");
    }
  }

  private async createConnection(): Promise<void> {
    const client = createClient<Database>(this.config.url, this.config.key, {
      auth: {
        persistSession: false,
      },
      global: {
        headers: this.config.sslOptions?.enabled
          ? { "X-SSL-Required": "true" }
          : {},
      },
    });

    const entry: ConnectionPoolEntry = {
      client,
      inUse: false,
      lastUsed: new Date(),
      created: new Date(),
    };

    this.pool.push(entry);
    this.metrics.totalConnections++;
    this.metrics.idleConnections++;
  }

  private async testConnection(): Promise<void> {
    const client = await this.acquireConnection();
    try {
      // Test query - check if we can access the database
      const { error } = await client
        .from("strategy_config")
        .select("id")
        .limit(0);
      if (error) {
        throw error;
      }
    } finally {
      this.releaseConnection(client);
    }
  }

  private async acquireConnection(
    timeout?: number,
  ): Promise<SupabaseClient<Database>> {
    const maxConnections = this.config.poolOptions?.maxConnections || 10;
    const connectionTimeout =
      timeout || this.config.poolOptions?.connectionTimeout || 10000;

    // Find available connection
    const available = this.pool.find((entry) => !entry.inUse);

    if (available) {
      available.inUse = true;
      available.lastUsed = new Date();
      this.metrics.activeConnections++;
      this.metrics.idleConnections--;
      return available.client;
    }

    // Create new connection if pool not full
    if (this.pool.length < maxConnections) {
      await this.createConnection();
      return this.acquireConnection(timeout);
    }

    // Wait for connection to become available
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkAvailable = setInterval(() => {
        const available = this.pool.find((entry) => !entry.inUse);

        if (available) {
          clearInterval(checkAvailable);
          available.inUse = true;
          available.lastUsed = new Date();
          this.metrics.activeConnections++;
          this.metrics.idleConnections--;
          resolve(available.client);
        } else if (Date.now() - startTime > connectionTimeout) {
          clearInterval(checkAvailable);
          reject(new Error("Connection timeout - pool exhausted"));
        }
      }, 100);
    });
  }

  private releaseConnection(client: SupabaseClient<Database>): void {
    const entry = this.pool.find((e) => e.client === client);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = new Date();
      this.metrics.activeConnections--;
      this.metrics.idleConnections++;
    }
  }

  async executeQuery<T>(
    operation: (client: SupabaseClient<Database>) => Promise<T>,
    options?: QueryOptions,
  ): Promise<T> {
    if (this.isShuttingDown) {
      throw new Error("Connection manager is shutting down");
    }

    if (this.state !== "connected") {
      if (this.state === "connecting" || this.state === "reconnecting") {
        // Queue the operation
        return this.queueOperation(operation, options);
      }

      // Try to connect
      await this.connect();
    }

    const startTime = Date.now();
    let client: SupabaseClient<Database> | null = null;

    try {
      client = await this.acquireConnection(options?.timeout);
      const result = await operation(client);

      this.metrics.totalQueries++;
      const queryTime = Date.now() - startTime;
      this.updateAverageQueryTime(queryTime);
      this.metrics.lastQueryTime = new Date();

      // Cache result if in degraded mode
      if (this.isDegraded && this.config.degradationOptions?.enableCaching) {
        const cacheKey = this.generateCacheKey(operation.toString());
        this.cache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      this.metrics.failedQueries++;

      // Check if we should retry
      if (this.shouldRetry(error as ConnectionError)) {
        return this.retryOperation(operation, options);
      }

      // Check if we can use cached data
      if (this.config.degradationOptions?.enableCaching) {
        const cachedResult = this.getCachedResult(operation.toString());
        if (cachedResult !== undefined) {
          return cachedResult as T;
        }
      }

      throw this.wrapError(error as Error, "unknown");
    } finally {
      if (client) {
        this.releaseConnection(client);
      }
    }
  }

  private queueOperation<T>(
    operation: (client: SupabaseClient<Database>) => Promise<T>,
    options?: QueryOptions,
  ): Promise<T> {
    const maxWaitingRequests =
      this.config.poolOptions?.maxWaitingRequests || 100;
    const queueTimeout = this.config.poolOptions?.queueTimeout || 30000;

    if (this.operationQueue.length >= maxWaitingRequests) {
      throw new Error("Operation queue is full");
    }

    return new Promise((resolve, reject) => {
      const queuedOp: QueuedOperation = {
        execute: operation as (
          client: SupabaseClient<Database>,
        ) => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        priority: options?.priority || "normal",
        timestamp: new Date(),
      };

      this.operationQueue.push(queuedOp);
      this.sortQueue();

      // Set timeout for queued operation
      setTimeout(() => {
        const index = this.operationQueue.indexOf(queuedOp);
        if (index !== -1) {
          this.operationQueue.splice(index, 1);
          reject(new Error("Operation timed out in queue"));
        }
      }, queueTimeout);
    });
  }

  private sortQueue(): void {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    this.operationQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
  }

  private async processQueue(): Promise<void> {
    while (this.operationQueue.length > 0 && this.state === "connected") {
      const operation = this.operationQueue.shift();
      if (operation) {
        try {
          const result = await this.executeQuery(operation.execute);
          operation.resolve(result);
        } catch (error) {
          operation.reject(error);
        }
      }
    }
  }

  private shouldRetry(error: ConnectionError): boolean {
    if (this.retryAttempt >= (this.config.retryOptions?.maxRetries || 3)) {
      return false;
    }

    if (this.config.retryOptions?.retryCondition) {
      return this.config.retryOptions.retryCondition(error);
    }

    // Default retry conditions
    return (
      error.retryable !== false &&
      (error.type === "network" ||
        error.type === "timeout" ||
        error.code === "ECONNRESET")
    );
  }

  private async retryOperation<T>(
    operation: (client: SupabaseClient<Database>) => Promise<T>,
    options?: QueryOptions,
  ): Promise<T> {
    this.retryAttempt++;
    this.metrics.connectionRetries++;

    const delay = this.calculateRetryDelay();

    if (this.config.retryOptions?.onRetry) {
      const error: ConnectionError = new Error("Retrying operation");
      error.type = "network";
      this.config.retryOptions.onRetry(this.retryAttempt, error);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const result = await this.executeQuery(operation, options);
      this.retryAttempt = 0; // Reset on success
      return result;
    } catch (error) {
      if (this.shouldRetry(error as ConnectionError)) {
        return this.retryOperation(operation, options);
      }
      this.retryAttempt = 0;
      throw error;
    }
  }

  private calculateRetryDelay(): number {
    const {
      initialDelay = 1000,
      maxDelay = 30000,
      factor = 2,
      jitter = true,
    } = this.config.retryOptions || {};

    let delay = Math.min(
      initialDelay * Math.pow(factor, this.retryAttempt - 1),
      maxDelay,
    );

    if (jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return delay;
  }

  async reconnect(): Promise<void> {
    if (this.state === "reconnecting") {
      return;
    }

    this.setState("reconnecting");
    this.retryAttempt = 0;

    const attemptReconnect = async (): Promise<void> => {
      try {
        // Clear existing pool
        this.pool = [];
        this.metrics.totalConnections = 0;
        this.metrics.activeConnections = 0;
        this.metrics.idleConnections = 0;

        await this.connect();

        // Process queued operations
        await this.processQueue();
      } catch (error) {
        this.retryAttempt++;

        if (this.retryAttempt < (this.config.retryOptions?.maxRetries || 3)) {
          const delay = this.calculateRetryDelay();
          this.reconnectTimer = setTimeout(() => {
            attemptReconnect();
          }, delay);
        } else {
          this.setState("error");
          this.emit("error", error);

          // Enable degraded mode if configured
          if (this.config.degradationOptions?.readOnlyMode) {
            this.isDegraded = true;
            this.emit("degraded");
          }
        }
      }
    };

    await attemptReconnect();
  }

  async disconnect(): Promise<void> {
    this.setState("closing");

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
    }

    // Wait for active connections to complete
    const maxWait = 5000;
    const startTime = Date.now();

    while (
      this.metrics.activeConnections > 0 &&
      Date.now() - startTime < maxWait
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Clear pool
    this.pool = [];
    this.metrics.activeConnections = 0;
    this.metrics.idleConnections = 0;

    this.setState("closed");
    this.emit("disconnected");
  }

  async shutdown(options?: ShutdownOptions): Promise<void> {
    this.isShuttingDown = true;
    const timeout = options?.gracefulTimeout || 30000;

    // Reject all queued operations
    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      if (operation) {
        operation.reject(new Error("Shutdown in progress"));
      }
    }

    if (!options?.force) {
      // Wait for active operations to complete
      const startTime = Date.now();
      while (
        this.metrics.activeConnections > 0 &&
        Date.now() - startTime < timeout
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    await this.disconnect();
  }

  getState(): ConnectionState {
    return this.state;
  }

  private setState(state: ConnectionState): void {
    const oldState = this.state;
    this.state = state;
    if (oldState !== state) {
      this.emit("stateChange", { from: oldState, to: state });
    }
  }

  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  getPoolStats(): ConnectionPoolStats {
    return {
      size: this.pool.length,
      available: this.pool.filter((e) => !e.inUse).length,
      pending: this.operationQueue.length,
      maxSize: this.config.poolOptions?.maxConnections || 10,
      waitingRequests: this.operationQueue.length,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();
    const status: HealthStatus = {
      healthy: false,
      lastCheck: new Date(),
      errors: [],
    };

    try {
      if (this.state !== "connected") {
        status.errors?.push(`Connection state: ${this.state}`);
      }

      // Test query
      await this.testConnection();

      status.healthy = true;
      status.latency = Date.now() - startTime;
      status.poolStatus = this.getPoolStats();
    } catch (error) {
      status.errors?.push((error as Error).message);
    }

    return status;
  }

  isHealthy(): boolean {
    return (
      this.state === "connected" && !this.isShuttingDown && !this.isDegraded
    );
  }

  private updateAverageQueryTime(queryTime: number): void {
    const totalTime =
      this.metrics.averageQueryTime * (this.metrics.totalQueries - 1);
    this.metrics.averageQueryTime =
      (totalTime + queryTime) / this.metrics.totalQueries;
  }

  private generateCacheKey(operation: string): string {
    // Simple hash function for cache key
    let hash = 0;
    for (let i = 0; i < operation.length; i++) {
      const char = operation.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `cache_${hash}`;
  }

  private getCachedResult(operation: string): unknown {
    const cacheKey = this.generateCacheKey(operation);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      const cacheTimeout =
        this.config.degradationOptions?.cacheTimeout || 300000;
      if (Date.now() - cached.timestamp < cacheTimeout) {
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }

    return undefined;
  }

  private wrapError(
    error: Error,
    type: ConnectionError["type"],
  ): ConnectionError {
    const wrappedError = error as ConnectionError;
    wrappedError.type = type;
    wrappedError.context = {
      state: this.state,
      metrics: this.getMetrics(),
      poolStats: this.getPoolStats(),
    };
    return wrappedError;
  }

  // Degradation mode methods
  enableDegradedMode(): void {
    this.isDegraded = true;
    this.emit("degraded");
  }

  disableDegradedMode(): void {
    this.isDegraded = false;
    this.emit("recovered");
  }

  isDegradedMode(): boolean {
    return this.isDegraded;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
