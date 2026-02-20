// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright configuration for the tests/ directory.
 * Individual test scripts use launchBrowser() from tests/config/config.js
 * for browser setup, so most browser options here are defaults.
 */
module.exports = defineConfig({
  testDir: './tests/specs',
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
