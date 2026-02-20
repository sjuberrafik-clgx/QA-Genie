// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const os = require('os');
require('dotenv').config();

/**
 * Local helper — formats date/time in IST.
 * Replaces the external import from tests/utils/general so this config
 * is self-contained within the agentic-workflow folder.
 */
function getDateAndTimeIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}




const projectName = process.env.MODULE_NAME || process.env.REPORT_PROJECT_NAME || 'Default Module';

const reportConfig = {
  open: process.env.CI ? "never" : "always",
  folderPath: "my-report",
  filename: "index.html",
  title: "Ortoni Test Report",
  showProject: false,
  projectName: projectName,
  testType: "Regression Testing",
  authorName: os.userInfo().username,
  base64Image: false,
  stdIO: false,
  meta: {
    "Test Cycle": process.env.TEST_CYCLE || `Run ${getDateAndTimeIST()}`,
    version: "4",
    description: `Automation Regression Suite for ${projectName}`,
    release: "5.12.0",
    platform: os.type(),
  },
};


/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

let baseUrl =
  process.env.USE_DEV === "true"
    ? (process.env.DEV_URL || "")
    : process.env.USE_INT === "true"
      ? (process.env.INT_URL || "")
      : process.env.USE_PROD === "true"
        ? (process.env.PROD_URL || "")
        : (process.env.UAT_URL || "");
/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({

  //testDir: './tests/specs/agentPreviewModeBCC',
  //testDir: './tests/specs/authentification',
  //testDir: './tests/specs/groups',
  //testDir: './tests/specs',

  /* Global timeout for each test - reduced for faster execution */
  timeout: 60000,

  /* Timeout for beforeAll/afterAll hooks */
  globalTimeout: 300000,

  /* Expect timeout - reduced for faster assertions */
  expect: {
    timeout: 5000,
  },

  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    ['allure-playwright', { outputFolder: 'allure-results' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit-report.xml' }],
    ["ortoni-report", reportConfig],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: baseUrl,
    /* HEADLESS mode - controlled by environment variable, defaults to true for speed */
    headless: process.env.HEADLESS !== 'false',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Reduce action timeout for faster feedback */
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  /* Configure projects for major browsers */
  // projects: [
  //   {
  //     name: 'chromium',
  //     use: { ...devices['Desktop Chrome'] },
  //   },

  //   {
  //     name: 'firefox',
  //     use: { ...devices['Desktop Firefox'] },
  //   },

  //   {
  //     name: 'webkit',
  //     use: { ...devices['Desktop Safari'] },
  //   },

  //   /* Test against mobile viewports. */
  //   // {
  //   //   name: 'Mobile Chrome',
  //   //   use: { ...devices['Pixel 5'] },
  //   // },
  //   // {
  //   //   name: 'Mobile Safari',
  //   //   use: { ...devices['iPhone 12'] },
  //   // },

  //   /* Test against branded browsers. */
  //   // {
  //   //   name: 'Microsoft Edge',
  //   //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
  //   // },
  //   // {
  //   //   name: 'Google Chrome',
  //   //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
  //   // },
  // ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },

});

