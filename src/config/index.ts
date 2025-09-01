import * as dotenv from "dotenv";

// Configuration Error class
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Type-safe Config interface
export interface Config {
  supabase: {
    url: string;
    serviceRoleKey: string;
    anonKey: string;
  };
  app: {
    nodeEnv: "development" | "production" | "test";
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
  };
  aws: {
    secretsManagerRegion: string;
    secretsManagerSecretName: string;
  };
  binance: {
    apiKey: string;
    apiSecret: string;
    testnet: boolean;
  };
}

// Cache for configuration
let cachedConfig: Config | null = null;

// Load environment variables from .env file in development
function loadDotenv(): void {
  const nodeEnv = process.env.NODE_ENV || "development";

  // Only load .env file in development
  if (nodeEnv === "development" || nodeEnv === "test") {
    try {
      // Load dotenv
      dotenv.config();
    } catch {
      // dotenv not available or .env file doesn't exist - that's okay
      // We'll rely on environment variables being set directly
    }
  }
}

// Validate URL format
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Validate NODE_ENV value
function isValidNodeEnv(
  env: string,
): env is "development" | "production" | "test" {
  return ["development", "production", "test"].includes(env);
}

// Validate configuration values
function validateConfiguration(_config?: Partial<Config>): void {
  const errors: string[] = [];
  const missing: string[] = [];

  // Check for missing Supabase configuration
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (
    !process.env.SUPABASE_ANON_KEY &&
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    missing.push("SUPABASE_ANON_KEY");
  }

  // If there are missing variables, throw early
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Missing required configuration variables:\n${missing.join("\n")}`,
    );
  }

  // Validate Supabase URL format
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && !isValidUrl(supabaseUrl)) {
    errors.push(
      `Invalid URL format for NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl}`,
    );
  }

  // Validate non-empty strings for keys
  if (process.env.SUPABASE_SERVICE_ROLE_KEY === "") {
    errors.push("SUPABASE_SERVICE_ROLE_KEY cannot be empty");
  }

  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey === "") {
    errors.push("SUPABASE_ANON_KEY cannot be empty");
  }

  // Validate NODE_ENV
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv && !isValidNodeEnv(nodeEnv)) {
    errors.push(
      `NODE_ENV must be one of: development, production, test. Got: ${nodeEnv}`,
    );
  }

  // If there are validation errors, throw them
  if (errors.length > 0) {
    throw new ConfigurationError(errors.join("\n"));
  }
}

// Main getConfig function
export function getConfig(): Config {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  // Load .env file if in development
  loadDotenv();

  // Validate before building config
  validateConfiguration();

  // Get NODE_ENV with default
  const nodeEnv = (process.env.NODE_ENV || "development") as
    | "development"
    | "production"
    | "test";

  // Ensure NODE_ENV is valid
  if (!isValidNodeEnv(nodeEnv)) {
    throw new ConfigurationError(
      `NODE_ENV must be one of: development, production, test. Got: ${nodeEnv}`,
    );
  }

  // Build configuration object
  // We've already validated these exist, so we can safely assert
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ConfigurationError(
      "Required configuration is missing after validation",
    );
  }

  const config: Config = {
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: serviceRoleKey,
      anonKey:
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        "",
    },
    app: {
      nodeEnv,
      isDevelopment: nodeEnv === "development",
      isProduction: nodeEnv === "production",
      isTest: nodeEnv === "test",
    },
    aws: {
      secretsManagerRegion:
        process.env.AWS_SECRETS_MANAGER_REGION || "us-east-1",
      secretsManagerSecretName:
        process.env.AWS_SECRETS_MANAGER_SECRET_NAME || "btcbot/config",
    },
    binance: {
      apiKey: process.env.BINANCE_API_KEY || "",
      apiSecret: process.env.BINANCE_API_SECRET || "",
      testnet:
        process.env.BINANCE_TESTNET === "true" || nodeEnv !== "production",
    },
  };

  // Cache the configuration
  cachedConfig = config;

  return config;
}

// Clear config cache (for testing)
export function clearConfigCache(): void {
  cachedConfig = null;
}

// Validate config object at runtime
export function validateConfig(config: unknown): void {
  if (typeof config !== "object" || config === null) {
    throw new ConfigurationError("Configuration must be an object");
  }

  const cfg = config as Record<string, unknown>;

  // Validate supabase section
  if (typeof cfg.supabase !== "object" || cfg.supabase === null) {
    throw new ConfigurationError("Configuration must have a supabase section");
  }

  const supabase = cfg.supabase as Record<string, unknown>;
  if (typeof supabase.url !== "string") {
    throw new ConfigurationError(
      "Type validation failed: supabase.url must be a string",
    );
  }
  if (typeof supabase.serviceRoleKey !== "string") {
    throw new ConfigurationError(
      "Type validation failed: supabase.serviceRoleKey must be a string",
    );
  }
  if (typeof supabase.anonKey !== "string") {
    throw new ConfigurationError(
      "Type validation failed: supabase.anonKey must be a string",
    );
  }

  // Validate app section
  if (typeof cfg.app !== "object" || cfg.app === null) {
    throw new ConfigurationError("Configuration must have an app section");
  }

  const app = cfg.app as Record<string, unknown>;
  if (typeof app.isDevelopment !== "boolean") {
    throw new ConfigurationError(
      "Type validation failed: app.isDevelopment must be a boolean",
    );
  }
  if (typeof app.isProduction !== "boolean") {
    throw new ConfigurationError(
      "Type validation failed: app.isProduction must be a boolean",
    );
  }
  if (typeof app.isTest !== "boolean") {
    throw new ConfigurationError(
      "Type validation failed: app.isTest must be a boolean",
    );
  }
}

// Helper function to check if configuration is available
export function isConfigured(): boolean {
  try {
    // Try to validate configuration without throwing
    const hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const hasAnonKey = !!(
      process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    return hasSupabaseUrl && hasServiceKey && hasAnonKey;
  } catch {
    return false;
  }
}

// Safe configuration getter that returns a result object
export function getConfigSafe():
  | { success: true; config: Config }
  | { success: false; error: Error } {
  try {
    const config = getConfig();
    return { success: true, config };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error
          : new Error("Unknown configuration error"),
    };
  }
}

// Export type for use in other modules
export type { Config as ConfigType };
