import { BinanceClient } from "./binance-client";
import { BinanceConfig } from "./types";
import { getConfig, ConfigurationError } from "../config";

/**
 * Factory function to create a BinanceClient with secure configuration
 * Reads credentials from environment variables and validates them
 */
export async function createBinanceClient(options?: {
  forceTestnet?: boolean;
  skipAuthTest?: boolean;
}): Promise<BinanceClient> {
  // Get configuration from environment
  const config = getConfig();

  // Validate Binance configuration exists
  if (!config.binance.apiKey || !config.binance.apiSecret) {
    throw new ConfigurationError(
      "Binance API credentials not configured. " +
        "Please set BINANCE_API_KEY and BINANCE_API_SECRET environment variables.",
    );
  }

  // Create Binance config
  const binanceConfig: BinanceConfig = {
    apiKey: config.binance.apiKey,
    apiSecret: config.binance.apiSecret,
    testnet: options?.forceTestnet ?? config.binance.testnet,
  };

  // Create client
  const client = new BinanceClient(binanceConfig);

  // Test authentication unless explicitly skipped
  if (!options?.skipAuthTest) {
    try {
      await client.testAuthentication();
      // Authentication successful - warnings can be retrieved via client.getWarnings()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to authenticate with Binance API: ${message}\n` +
          "Please check your API credentials and permissions.",
      );
    }
  }

  return client;
}

/**
 * Validates that Binance configuration is present without creating a client
 */
export function validateBinanceConfig(): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const config = getConfig();

    if (!config.binance.apiKey) {
      errors.push("BINANCE_API_KEY environment variable is not set");
    }

    if (!config.binance.apiSecret) {
      errors.push("BINANCE_API_SECRET environment variable is not set");
    }

    // Check for obvious test credentials
    if (config.binance.apiKey && config.binance.apiSecret) {
      const testPatterns = [/test/i, /demo/i, /xxx/i, /123456/];
      const looksLikeTest = testPatterns.some(
        (pattern) =>
          pattern.test(config.binance.apiKey) ||
          pattern.test(config.binance.apiSecret),
      );

      if (looksLikeTest && !config.binance.testnet) {
        warnings.push(
          "API credentials appear to be test/demo credentials but testnet is disabled",
        );
      }

      if (!looksLikeTest && config.binance.testnet) {
        warnings.push(
          "Using production-like credentials with testnet enabled - ensure this is intentional",
        );
      }
    }

    // Check NODE_ENV consistency
    if (config.app.isProduction && config.binance.testnet) {
      warnings.push(
        "Running in production mode but Binance testnet is enabled",
      );
    }

    if (!config.app.isProduction && !config.binance.testnet) {
      warnings.push(
        "Running in development mode but Binance testnet is disabled - using real API",
      );
    }
  } catch (error) {
    errors.push(
      `Configuration error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Gets Binance client singleton for the application
 * Lazy initialization with authentication test on first use
 */
let clientInstance: BinanceClient | null = null;

export async function getBinanceClient(): Promise<BinanceClient> {
  if (!clientInstance) {
    clientInstance = await createBinanceClient();
  }
  return clientInstance;
}

/**
 * Clears the cached client instance (useful for testing)
 */
export function clearBinanceClient(): void {
  clientInstance = null;
}
