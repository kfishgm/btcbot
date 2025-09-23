/**
 * Jest E2E Test Configuration
 *
 * Separate configuration for E2E tests to ensure:
 * - Tests run in isolation
 * - Use test environment variables
 * - Don't interfere with unit tests
 */

import baseConfig from './jest.config.mjs';

export default {
  ...baseConfig,

  // E2E specific test pattern
  testMatch: ['**/tests/e2e/**/*.e2e.test.ts'],

  // Setup test environment before tests run
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup/test-env.ts'],

  // E2E tests need more time
  testTimeout: 15000,

  // Run tests sequentially for E2E
  maxWorkers: 1,

  // Separate coverage directory
  coverageDirectory: 'coverage-e2e',

  // Coverage for production code tested by E2E
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/testing/**', // Exclude old testing directory
  ],

  // Verbose output for debugging
  verbose: true,

  // Force exit after tests complete
  forceExit: true,

  // Don't detect open handles (E2E may have some)
  detectOpenHandles: false,

  // Test environment name for reporting
  displayName: 'E2E Tests',
};