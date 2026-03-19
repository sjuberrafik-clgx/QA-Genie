// config.js
const fs = require('fs');
const path = require('path');
const { chromium, firefox, webkit } = require('playwright');
const { ObservationRecorder } = require('../../agentic-workflow/sdk-orchestrator/observation-recorder');

async function launchBrowser() {
  const browserType = process.env.BROWSER_TYPE || 'chromium'; // Default to chromium
  const headless = process.env.HEADLESS !== 'false'; // Defaults to true, unless explicitly set to 'false'
  const viewPort = headless ? { width: 1280, height: 720 } : null;
  const evidenceEnabled = process.env.QA_EVIDENCE_ENABLED !== 'false';
  const runId = process.env.SDK_RUN_ID || 'adhoc-run';
  const ticketId = process.env.SDK_TICKET_ID || 'adhoc-ticket';
  const scenarioId = process.env.SDK_SCENARIO_ID || '';
  const authState = process.env.SDK_AUTH_STATE || 'unspecified';
  const scenarioSlug = String(scenarioId || authState || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const evidenceRoot = path.join(
    __dirname,
    '..', '..',
    'test-results',
    'mission-evidence',
    runId,
    scenarioSlug || ''
  );
  const videoDir = path.join(evidenceRoot, 'videos');
  const traceDir = path.join(evidenceRoot, 'traces');
  const observationRecorder = evidenceEnabled ? new ObservationRecorder({ projectRoot: path.join(__dirname, '..', '..') }) : null;
  const observationCounts = new Map();

  if (evidenceEnabled) {
    fs.mkdirSync(videoDir, { recursive: true });
    fs.mkdirSync(traceDir, { recursive: true });
  }


  let browser;

  const launchOptions = {
    headless,
    args: ['--start-maximized'],
    //slowMo: 300,

  };

  switch (browserType) {
    case 'firefox':
      browser = await firefox.launch(launchOptions);
      break;
    case 'webkit':
      browser = await webkit.launch(launchOptions);
      break;
    case 'chromium':
    default:
      browser = await chromium.launch(launchOptions);
      break;
  }

  const context = await browser.newContext({
    viewport: viewPort,
    recordVideo: evidenceEnabled ? {
      dir: videoDir,
      size: viewPort || { width: 1280, height: 720 },
    } : undefined,
  });

  if (evidenceEnabled) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  }

  const page = await context.newPage();

  const recordObservation = async (targetPage, details) => {
    if (!observationRecorder || !targetPage || targetPage.isClosed()) return;

    const key = `${details.type}:${details.message}`.slice(0, 240);
    const currentCount = observationCounts.get(key) || 0;
    if (currentCount >= 3) return;
    observationCounts.set(key, currentCount + 1);

    await observationRecorder.capturePageObservation(targetPage, {
      runId,
      ticketId,
      scenarioId: scenarioId || null,
      source: 'browser-runtime',
      severity: details.severity || 'warning',
      type: details.type,
      message: details.message,
      pageUrl: targetPage.url(),
      metadata: { authState, ...(details.metadata || {}) },
      fullPage: details.fullPage === true,
    });
  };

  const bindPageObservers = (targetPage) => {
    targetPage.on('pageerror', (error) => {
      void recordObservation(targetPage, {
        type: 'page-error',
        severity: 'error',
        message: error?.message || 'Unhandled page error',
      });
    });

    targetPage.on('crash', () => {
      void recordObservation(targetPage, {
        type: 'page-crash',
        severity: 'error',
        message: 'Browser page crashed',
        fullPage: true,
      });
    });

    targetPage.on('dialog', (dialog) => {
      void recordObservation(targetPage, {
        type: 'browser-dialog',
        severity: 'warning',
        message: `${dialog.type()}: ${dialog.message()}`,
        metadata: { dialogType: dialog.type() },
      });
    });

    targetPage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      void recordObservation(targetPage, {
        type: 'console-error',
        severity: 'warning',
        message: msg.text(),
        metadata: { location: msg.location() },
      });
    });

    targetPage.on('requestfailed', (request) => {
      void recordObservation(targetPage, {
        type: 'request-failed',
        severity: 'warning',
        message: `${request.method()} ${request.url()} failed: ${request.failure()?.errorText || 'unknown error'}`,
      });
    });

    targetPage.on('response', (response) => {
      if (response.status() < 500) return;
      void recordObservation(targetPage, {
        type: 'server-error-response',
        severity: 'warning',
        message: `${response.status()} from ${response.url()}`,
        metadata: { status: response.status() },
      });
    });
  };

  bindPageObservers(page);
  context.on('page', bindPageObservers);

  const originalClose = context.close.bind(context);
  context.close = async (...args) => {
    if (evidenceEnabled) {
      const tracePath = path.join(traceDir, `${ticketId}-${Date.now()}.zip`);
      try {
        await context.tracing.stop({ path: tracePath });
      } catch {
        // Ignore tracing stop failures so browser cleanup still happens.
      }
    }

    return originalClose(...args);
  };

  return { browser, context, page };
}

module.exports = { launchBrowser };
