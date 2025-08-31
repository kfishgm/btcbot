import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import type { Config } from "../../src/config/index.js";

describe("Configuration Module", () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules before each test
    jest.resetModules();
    // Clear process.env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("Configuration Interface", () => {
    it("should export a type-safe Config interface", async () => {
      // This will fail - module doesn't exist yet
      const configModule = await import("../../src/config/index.js");

      // Config should be a TypeScript type/interface
      // We'll verify its structure through usage
      const config: Config = {
        supabase: {
          url: "https://example.supabase.co",
          serviceRoleKey: "service-key",
          anonKey: "anon-key",
        },
        app: {
          nodeEnv: "development",
          isDevelopment: true,
          isProduction: false,
          isTest: false,
        },
        aws: {
          secretsManagerRegion: "us-east-1",
          secretsManagerSecretName: "btcbot/config",
        },
      };

      expect(config).toBeDefined();
      expect(configModule).toBeDefined();
    });

    it("should export a getConfig function that returns Config", async () => {
      // This will fail - function doesn't exist yet
      const { getConfig } = await import("../../src/config/index.js");

      // Set required env vars
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
      process.env.SUPABASE_ANON_KEY = "test-anon-key";

      const config = getConfig();

      expect(config).toBeDefined();
      expect(config.supabase).toBeDefined();
      expect(config.app).toBeDefined();
      expect(config.aws).toBeDefined();
    });
  });

  describe("Configuration Loading", () => {
    it("should load configuration from environment variables", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // Set environment variables
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://myproject.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "my-service-role-key";
      process.env.SUPABASE_ANON_KEY = "my-anon-key";
      process.env.NODE_ENV = "development";

      const config = getConfig();

      expect(config.supabase.url).toBe("https://myproject.supabase.co");
      expect(config.supabase.serviceRoleKey).toBe("my-service-role-key");
      expect(config.supabase.anonKey).toBe("my-anon-key");
      expect(config.app.nodeEnv).toBe("development");
      expect(config.app.isDevelopment).toBe(true);
      expect(config.app.isProduction).toBe(false);
    });

    it("should support .env file loading in development", async () => {
      process.env.NODE_ENV = "development";

      // Mock dotenv functionality
      jest.doMock("dotenv", () => ({
        config: jest.fn(() => {
          // Simulate loading .env file
          process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fromenv.supabase.co";
          process.env.SUPABASE_SERVICE_ROLE_KEY = "env-service-key";
          process.env.SUPABASE_ANON_KEY = "env-anon-key";
        }),
      }));

      const { getConfig } = await import("../../src/config/index.js");
      const config = getConfig();

      expect(config.supabase.url).toBe("https://fromenv.supabase.co");
    });

    it("should NOT load .env file in production", async () => {
      process.env.NODE_ENV = "production";

      // Mock dotenv functionality
      const dotenvMock = {
        config: jest.fn(),
      };
      jest.doMock("dotenv", () => dotenvMock);

      // Set only one env var to test production mode
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prod.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "prod-service-key";
      process.env.SUPABASE_ANON_KEY = "prod-anon-key";

      const { getConfig } = await import("../../src/config/index.js");
      const config = getConfig();

      // dotenv.config should NOT be called in production
      expect(dotenvMock.config).not.toHaveBeenCalled();
      expect(config.app.isProduction).toBe(true);
      expect(config.app.isDevelopment).toBe(false);
    });

    it("should properly detect environment flags", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // Test development
      process.env.NODE_ENV = "development";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      process.env.SUPABASE_ANON_KEY = "test-anon";

      let config = getConfig();
      expect(config.app.isDevelopment).toBe(true);
      expect(config.app.isProduction).toBe(false);
      expect(config.app.isTest).toBe(false);

      // Reset and test production
      jest.resetModules();
      process.env.NODE_ENV = "production";
      const module2 = await import("../../src/config/index.js");
      config = module2.getConfig();
      expect(config.app.isDevelopment).toBe(false);
      expect(config.app.isProduction).toBe(true);
      expect(config.app.isTest).toBe(false);

      // Reset and test test
      jest.resetModules();
      process.env.NODE_ENV = "test";
      const module3 = await import("../../src/config/index.js");
      config = module3.getConfig();
      expect(config.app.isDevelopment).toBe(false);
      expect(config.app.isProduction).toBe(false);
      expect(config.app.isTest).toBe(true);
    });
  });

  describe("Validation", () => {
    it("should validate Supabase URL format", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // Invalid URL
      process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      expect(() => getConfig()).toThrow(/invalid.*url/i);
    });

    it("should accept valid URLs including localhost and custom domains", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // Test various valid URLs
      const validUrls = [
        "https://project.supabase.co",
        "http://localhost:54321",
        "https://custom-domain.com",
        "https://api.example.org",
      ];

      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      for (const url of validUrls) {
        jest.resetModules();
        process.env.NEXT_PUBLIC_SUPABASE_URL = url;

        const module = await import("../../src/config/index.js");
        expect(() => module.getConfig()).not.toThrow();
      }
    });

    it("should validate non-empty strings for keys", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";

      // Test empty service role key
      process.env.SUPABASE_SERVICE_ROLE_KEY = "";
      process.env.SUPABASE_ANON_KEY = "anon";

      expect(() => getConfig()).toThrow(/service.*role.*key/i);

      // Test empty anon key
      jest.resetModules();
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
      process.env.SUPABASE_ANON_KEY = "";

      const module2 = await import("../../src/config/index.js");
      expect(() => module2.getConfig()).toThrow(/anon.*key/i);
    });

    it("should validate NODE_ENV values", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";
      process.env.NODE_ENV = "invalid-env";

      expect(() => getConfig()).toThrow(
        /node_env.*must be.*development.*production.*test/i,
      );
    });

    it("should default NODE_ENV to development if not set", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      delete process.env.NODE_ENV;
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      const config = getConfig();

      expect(config.app.nodeEnv).toBe("development");
      expect(config.app.isDevelopment).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should fail fast with clear error for missing required variables", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // No env vars set
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;

      expect(() => getConfig()).toThrow(/missing.*required.*configuration/i);
    });

    it("should list all missing variables in error message", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // No env vars set
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;

      try {
        getConfig();
        fail("Should have thrown an error");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
        expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
        expect(message).toContain("SUPABASE_ANON_KEY");
      }
    });

    it("should provide helpful error messages for invalid values", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      try {
        getConfig();
        fail("Should have thrown an error");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toMatch(/invalid.*url.*format/i);
        expect(message).toContain("not-a-url");
      }
    });

    it("should throw custom ConfigurationError", async () => {
      const { getConfig, ConfigurationError } = await import(
        "../../src/config/index.js"
      );

      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      try {
        getConfig();
        fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
      }
    });
  });

  describe("AWS Secrets Manager Integration", () => {
    it("should read AWS configuration from environment", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";
      process.env.AWS_SECRETS_MANAGER_REGION = "us-west-2";
      process.env.AWS_SECRETS_MANAGER_SECRET_NAME = "my-app/config";

      const config = getConfig();

      expect(config.aws.secretsManagerRegion).toBe("us-west-2");
      expect(config.aws.secretsManagerSecretName).toBe("my-app/config");
    });

    it("should have default AWS configuration values", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      // Don't set AWS env vars
      delete process.env.AWS_SECRETS_MANAGER_REGION;
      delete process.env.AWS_SECRETS_MANAGER_SECRET_NAME;

      const config = getConfig();

      expect(config.aws.secretsManagerRegion).toBe("us-east-1");
      expect(config.aws.secretsManagerSecretName).toBe("btcbot/config");
    });

    it("should export loadFromSecretsManager as a stub function", async () => {
      const { loadFromSecretsManager } = await import(
        "../../src/config/index.js"
      );

      expect(loadFromSecretsManager).toBeDefined();
      expect(typeof loadFromSecretsManager).toBe("function");

      // Should be a stub that returns a promise
      const result = await loadFromSecretsManager();
      expect(result).toBeNull(); // Stub returns null for MVP
    });

    it("should attempt AWS Secrets Manager in production but fall back to env vars", async () => {
      process.env.NODE_ENV = "production";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prod.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "prod-key";
      process.env.SUPABASE_ANON_KEY = "prod-anon";

      const { getConfig } = await import("../../src/config/index.js");

      // Even in production, should work with env vars (AWS is optional for MVP)
      const config = getConfig();

      expect(config.supabase.url).toBe("https://prod.supabase.co");
      expect(config.app.isProduction).toBe(true);

      // AWS config should still be present
      expect(config.aws).toBeDefined();
    });
  });

  describe("Configuration Caching", () => {
    it("should cache configuration after first load", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      const config1 = getConfig();

      // Change env var
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://changed.supabase.co";

      const config2 = getConfig();

      // Should still have original value due to caching
      expect(config2.supabase.url).toBe("https://test.supabase.co");
      expect(config1).toBe(config2); // Same object reference
    });

    it("should provide clearConfigCache for testing", async () => {
      const { getConfig, clearConfigCache } = await import(
        "../../src/config/index.js"
      );

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      const config1 = getConfig();

      // Clear cache
      clearConfigCache();

      // Change env var
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://changed.supabase.co";

      const config2 = getConfig();

      // Should have new value after cache clear
      expect(config2.supabase.url).toBe("https://changed.supabase.co");
      expect(config1).not.toBe(config2); // Different object reference
    });
  });

  describe("Type Safety", () => {
    it("should export strongly typed configuration", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      const config = getConfig();

      // TypeScript should enforce these types
      const url: string = config.supabase.url;
      const isDev: boolean = config.app.isDevelopment;
      const env: "development" | "production" | "test" = config.app.nodeEnv;

      expect(typeof url).toBe("string");
      expect(typeof isDev).toBe("boolean");
      expect(["development", "production", "test"]).toContain(env);
    });

    it("should validate types at runtime", async () => {
      const { validateConfig } = await import("../../src/config/index.js");

      // Invalid config object
      const invalidConfig = {
        supabase: {
          url: 123, // Should be string
          serviceRoleKey: "key",
          anonKey: "anon",
        },
        app: {
          nodeEnv: "development",
          isDevelopment: "true", // Should be boolean
          isProduction: false,
          isTest: false,
        },
      };

      expect(() => validateConfig(invalidConfig as unknown)).toThrow(
        /type.*validation/i,
      );
    });
  });

  describe("Integration Examples", () => {
    it("should work with Next.js environment variable patterns", async () => {
      const { getConfig } = await import("../../src/config/index.js");

      // Next.js uses NEXT_PUBLIC_ prefix for client-side vars
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key"; // Alternative naming

      // Server-only vars don't have prefix
      process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-key";
      process.env.SUPABASE_ANON_KEY = "anon-key";

      const config = getConfig();

      // Should handle both patterns
      expect(config.supabase.url).toBe("https://test.supabase.co");
      expect(config.supabase.serviceRoleKey).toBe("secret-key");
      expect(config.supabase.anonKey).toBe("anon-key");
    });

    it("should provide isConfigured helper", async () => {
      const { isConfigured } = await import("../../src/config/index.js");

      // Initially not configured
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(isConfigured()).toBe(false);

      // Set required vars
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      expect(isConfigured()).toBe(true);
    });

    it("should provide getConfigSafe for optional usage", async () => {
      const { getConfigSafe } = await import("../../src/config/index.js");

      // Without required vars
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const result = getConfigSafe();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toMatch(/missing.*required/i);
      }

      // With required vars
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      process.env.SUPABASE_ANON_KEY = "anon";

      const result2 = getConfigSafe();

      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.config.supabase.url).toBe("https://test.supabase.co");
      }
    });
  });

  describe(".env.example Generation", () => {
    it("should have a corresponding .env.example file", async () => {
      // This test verifies that .env.example exists and contains all required vars
      const fs = await import("fs");
      const path = await import("path");

      const envExamplePath = path.join(process.cwd(), ".env.example");
      const exists = fs.existsSync(envExamplePath);

      expect(exists).toBe(true);

      if (exists) {
        const content = fs.readFileSync(envExamplePath, "utf-8");

        // Should contain all required variables with descriptions
        expect(content).toContain("NEXT_PUBLIC_SUPABASE_URL");
        expect(content).toContain("SUPABASE_SERVICE_ROLE_KEY");
        expect(content).toContain("SUPABASE_ANON_KEY");

        // Should have helpful comments
        expect(content).toMatch(/# .*supabase.*url/i);
        expect(content).toMatch(/# .*service.*role/i);
        expect(content).toMatch(/# .*anon.*key/i);

        // Optional AWS vars
        expect(content).toContain("AWS_SECRETS_MANAGER_REGION");
        expect(content).toContain("AWS_SECRETS_MANAGER_SECRET_NAME");
      }
    });
  });
});
