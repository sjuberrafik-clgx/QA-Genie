// config.js
const { chromium, firefox, webkit } = require('playwright');

async function launchBrowser() {
  const browserType = process.env.BROWSER_TYPE || 'chromium'; // Default to chromium
  const headless = process.env.HEADLESS !== 'false'; // Defaults to true, unless explicitly set to 'false'
  const viewPort = headless ? { width: 1280, height: 720 } : null;


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

  const context = await browser.newContext({ viewport: viewPort });
  const page = await context.newPage();

  return { browser, context, page };
}

module.exports = { launchBrowser };
