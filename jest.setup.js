// Setup file for Jest - mock fetch globally
// In ESM mode, we need to mock fetch differently
if (typeof global.fetch !== "undefined") {
  // Save the original fetch in case we need it
  global.originalFetch = global.fetch;
}

// Create a simple mock that tests can override
global.fetch = function () {
  throw new Error("fetch must be mocked in tests");
};
