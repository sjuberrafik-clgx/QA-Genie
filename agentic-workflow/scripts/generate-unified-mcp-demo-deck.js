/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const pptxgen = require('pptxgenjs');
const ShapeType = new pptxgen().ShapeType;

const ROOT = path.resolve(__dirname, '..', '..');
const MCP_ROOT = path.join(ROOT, 'agentic-workflow');
const OUTPUT_PATH = path.join(ROOT, 'web-app', 'Unified-MCP-Server-Demo.pptx');

const THEME = {
  fontHead: 'Segoe UI',
  fontBody: 'Segoe UI',
  colors: {
    accent: '0B5CAB',
    accent2: '0EA5A4',
    accent3: '1D4ED8',
    bg: 'FFFFFF',
    text: '0F172A',
    muted: '64748B',
    line: 'DCE3EE',
    card: 'F8FAFC',
    panel: 'EFF6FF',
    success: '16A34A',
    warn: 'D97706',
    danger: 'DC2626',
    dark: '0B1F33',
  },
};

function addChrome(slide, title, subtitle = '') {
  slide.background = { color: THEME.colors.bg };

  slide.addShape(ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.55,
    line: { color: THEME.colors.accent, transparency: 100 },
    fill: { color: THEME.colors.accent },
  });

  slide.addText(title, {
    x: 0.55,
    y: 0.12,
    w: 8.5,
    h: 0.25,
    fontFace: THEME.fontHead,
    fontSize: 18,
    bold: true,
    color: 'FFFFFF',
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.55,
      y: 0.78,
      w: 12.0,
      h: 0.35,
      fontFace: THEME.fontBody,
      fontSize: 13,
      color: THEME.colors.muted,
    });
  }

  slide.addShape(ShapeType.line, {
    x: 0.55,
    y: 7.08,
    w: 12.2,
    h: 0,
    line: { color: THEME.colors.line, width: 1 },
  });

  slide.addText('Unified MCP Server Demo', {
    x: 0.55,
    y: 7.13,
    w: 5.5,
    h: 0.18,
    fontFace: THEME.fontBody,
    fontSize: 9,
    color: THEME.colors.muted,
  });

  slide.addText(new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }), {
    x: 10.6,
    y: 7.13,
    w: 2.1,
    h: 0.18,
    fontFace: THEME.fontBody,
    fontSize: 9,
    align: 'right',
    color: THEME.colors.muted,
  });
}

function addHeroTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.7,
    y: 1.0,
    w: 7.0,
    h: 0.8,
    fontFace: THEME.fontHead,
    fontSize: 28,
    bold: true,
    color: THEME.colors.text,
  });

  slide.addText(subtitle, {
    x: 0.7,
    y: 1.86,
    w: 6.4,
    h: 1.0,
    fontFace: THEME.fontBody,
    fontSize: 16,
    color: THEME.colors.muted,
    breakLine: false,
    valign: 'mid',
  });
}

function addPill(slide, text, x, y, w, color, textColor = 'FFFFFF') {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.38,
    rectRadius: 0.08,
    line: { color, transparency: 100 },
    fill: { color },
  });

  slide.addText(text, {
    x,
    y: y + 0.04,
    w,
    h: 0.22,
    fontFace: THEME.fontBody,
    fontSize: 10,
    bold: true,
    color: textColor,
    align: 'center',
  });
}

function addCard(slide, config) {
  const {
    x, y, w, h, title, body, titleColor = THEME.colors.text, fill = THEME.colors.card,
  } = config;

  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: THEME.colors.line, width: 1 },
    fill: { color: fill },
  });

  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.16,
    w: w - 0.36,
    h: 0.32,
    fontFace: THEME.fontHead,
    fontSize: 14,
    bold: true,
    color: titleColor,
  });

  slide.addText(body, {
    x: x + 0.18,
    y: y + 0.5,
    w: w - 0.36,
    h: h - 0.6,
    fontFace: THEME.fontBody,
    fontSize: 11,
    color: THEME.colors.muted,
    valign: 'top',
  });
}

function addBulletList(slide, items, x, y, w, h, fontSize = 16, bulletColor = THEME.colors.accent) {
  let currentY = y;
  items.forEach((item) => {
    slide.addText('•', {
      x,
      y: currentY,
      w: 0.18,
      h: 0.22,
      fontFace: THEME.fontBody,
      fontSize,
      color: bulletColor,
      bold: true,
    });

    slide.addText(item, {
      x: x + 0.22,
      y: currentY,
      w: w - 0.22,
      h: 0.45,
      fontFace: THEME.fontBody,
      fontSize,
      color: THEME.colors.text,
    });

    currentY += 0.42;
  });
}

function addArrow(slide, x, y, w = 0.45, h = 0.24, color = THEME.colors.accent) {
  slide.addShape(ShapeType.rightArrow, {
    x,
    y,
    w,
    h,
    line: { color, transparency: 100 },
    fill: { color },
  });
}

function addFlowStep(slide, index, title, body, x, y, w, h, fill = 'FFFFFF') {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.06,
    line: { color: THEME.colors.line, width: 1 },
    fill: { color: fill },
  });

  slide.addShape(ShapeType.ellipse, {
    x: x + 0.16,
    y: y + 0.16,
    w: 0.34,
    h: 0.34,
    line: { color: THEME.colors.accent, transparency: 100 },
    fill: { color: THEME.colors.accent },
  });

  slide.addText(String(index), {
    x: x + 0.16,
    y: y + 0.2,
    w: 0.34,
    h: 0.16,
    fontFace: THEME.fontBody,
    fontSize: 10,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
  });

  slide.addText(title, {
    x: x + 0.58,
    y: y + 0.14,
    w: w - 0.72,
    h: 0.24,
    fontFace: THEME.fontHead,
    fontSize: 12,
    bold: true,
    color: THEME.colors.text,
  });

  slide.addText(body, {
    x: x + 0.58,
    y: y + 0.43,
    w: w - 0.72,
    h: h - 0.52,
    fontFace: THEME.fontBody,
    fontSize: 10,
    color: THEME.colors.muted,
    valign: 'top',
  });
}

function addMetric(slide, label, value, x, y, w) {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.9,
    rectRadius: 0.06,
    line: { color: THEME.colors.line, width: 1 },
    fill: { color: 'FFFFFF' },
  });

  slide.addText(value, {
    x,
    y: y + 0.12,
    w,
    h: 0.28,
    fontFace: THEME.fontHead,
    fontSize: 21,
    bold: true,
    align: 'center',
    color: THEME.colors.accent,
  });

  slide.addText(label, {
    x,
    y: y + 0.46,
    w,
    h: 0.18,
    fontFace: THEME.fontBody,
    fontSize: 10,
    align: 'center',
    color: THEME.colors.muted,
  });
}

async function loadFacts() {
  const workflowConfig = JSON.parse(
    fs.readFileSync(path.join(MCP_ROOT, 'config', 'workflow-config.json'), 'utf8'),
  );
  const mcpPackage = JSON.parse(
    fs.readFileSync(path.join(MCP_ROOT, 'mcp-server', 'package.json'), 'utf8'),
  );

  const toolModuleUrl = pathToFileURL(
    path.join(MCP_ROOT, 'mcp-server', 'tools', 'tool-definitions.js'),
  ).href;
  const { ALL_TOOLS, getToolStats, getAlwaysLoadedTools } = await import(toolModuleUrl);

  const toolStats = getToolStats();
  const categoryCounts = toolStats.byCategory || {};

  return {
    packageName: mcpPackage.name,
    version: mcpPackage.version,
    totalTools: ALL_TOOLS.length,
    toolStats,
    alwaysLoaded: getAlwaysLoadedTools().length,
    firstToolCall: workflowConfig.mcpExploration?.mcpFirstArchitecture?.firstToolCall || 'mcp_unified-autom_unified_navigate',
    transports: ['stdio', 'sse', 'http'],
    eventCategories: ['console', 'network', 'pageerror', 'dialog', 'mutation', 'navigation'],
    sampleCategories: [
      ['Assertions', categoryCounts.assertions || 0],
      ['Selectors', categoryCounts.selectors || 0],
      ['Interaction', categoryCounts.interaction || 0],
      ['Element content', categoryCounts['element-content'] || 0],
      ['Storage', categoryCounts.storage || 0],
      ['Network interception', categoryCounts['network-interception'] || 0],
    ],
  };
}

function buildDeck(facts) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'GitHub Copilot';
  pptx.company = 'CoreLogic Solutions, LLC';
  pptx.subject = 'Unified MCP Server Demo';
  pptx.title = 'Unified MCP Server Demo';
  pptx.lang = 'en-US';
  pptx.theme = {
    headFontFace: THEME.fontHead,
    bodyFontFace: THEME.fontBody,
    lang: 'en-US',
  };

  const generatedDate = new Date().toISOString().slice(0, 10);

  // Slide 1
  {
    const slide = pptx.addSlide();
    slide.background = { color: 'F7FAFF' };

    slide.addShape(ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 7.5,
      line: { color: 'F7FAFF', transparency: 100 },
      fill: { color: 'F7FAFF' },
    });

    slide.addShape(ShapeType.roundRect, {
      x: 7.75,
      y: 0.85,
      w: 4.8,
      h: 5.65,
      rectRadius: 0.08,
      line: { color: 'D7E6FF', width: 1 },
      fill: { color: 'FFFFFF' },
    });

    addHeroTitle(
      slide,
      'Unified MCP Server Demo',
      'A single automation surface that combines Playwright MCP, Chrome DevTools MCP, intelligent routing, event streaming, and quality guardrails.',
    );

    addPill(slide, `${facts.packageName} v${facts.version}`, 0.7, 2.95, 2.2, THEME.colors.accent);
    addPill(slide, `${facts.totalTools} unified tools`, 2.98, 2.95, 1.9, THEME.colors.accent2);
    addPill(slide, `${facts.transports.length} transports`, 4.96, 2.95, 1.45, THEME.colors.accent3);

    addBulletList(slide, [
      'One MCP endpoint for navigation, accessibility snapshots, selectors, assertions, debugging, and performance.',
      'Intelligent routing sends each call to the best underlying bridge without changing the client-facing tool contract.',
      'Built for QA automation: live exploration, script generation, self-healing, and reliable execution feedback.',
    ], 0.8, 3.65, 6.25, 2.1, 15);

    addCard(slide, {
      x: 8.1,
      y: 1.18,
      w: 4.1,
      h: 1.08,
      title: 'Playwright bridge',
      body: 'Live navigation, snapshots, refs, semantic selectors, interactions, and assertions.',
      fill: 'EFF6FF',
    });
    addCard(slide, {
      x: 8.1,
      y: 2.42,
      w: 4.1,
      h: 1.08,
      title: 'Chrome DevTools bridge',
      body: 'Performance traces, network detail, console visibility, DOM introspection, and recovery depth.',
      fill: 'ECFEFF',
    });
    addCard(slide, {
      x: 8.1,
      y: 3.66,
      w: 4.1,
      h: 1.08,
      title: 'Router + guardrails',
      body: 'Profiles, tool search, blocker recovery, enforcement hooks, and OODA checks protect quality.',
      fill: 'F8FAFC',
    });
    addCard(slide, {
      x: 8.1,
      y: 4.9,
      w: 4.1,
      h: 1.08,
      title: 'Demo goal',
      body: 'Show how a single request becomes an observable, structured, automation-ready response.',
      fill: 'FEF3C7',
      titleColor: THEME.colors.dark,
    });

    slide.addText(`Generated ${generatedDate}`, {
      x: 0.8,
      y: 6.25,
      w: 2.0,
      h: 0.2,
      fontFace: THEME.fontBody,
      fontSize: 10,
      color: THEME.colors.muted,
    });
  }

  // Slide 2
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'Why we built a unified server', 'From fragmented tooling to one observable automation interface');

    addCard(slide, {
      x: 0.7,
      y: 1.35,
      w: 2.8,
      h: 1.45,
      title: 'Before',
      body: 'Agents needed to reason about multiple backends, inconsistent capabilities, and when to switch tools.',
      fill: 'FFF7ED',
    });
    addCard(slide, {
      x: 0.7,
      y: 2.98,
      w: 2.8,
      h: 1.45,
      title: 'Selector drift',
      body: 'Without live snapshots and semantic validation, scripts can be built on guessed or stale locators.',
      fill: 'FEF2F2',
    });
    addCard(slide, {
      x: 0.7,
      y: 4.61,
      w: 2.8,
      h: 1.45,
      title: 'Low visibility',
      body: 'Console errors, dialogs, network issues, and blockers were harder to surface in one place.',
      fill: 'F8FAFC',
    });

    slide.addShape(ShapeType.rightArrow, {
      x: 3.85,
      y: 3.05,
      w: 0.65,
      h: 0.5,
      fill: { color: THEME.colors.accent },
      line: { color: THEME.colors.accent },
    });

    addCard(slide, {
      x: 4.75,
      y: 1.35,
      w: 3.4,
      h: 4.7,
      title: 'Unified MCP server',
      body: [
        'Single tool namespace: `unified_*`.',
        '',
        'Intelligent router decides whether Playwright or Chrome DevTools is the better execution path.',
        '',
        'Event manager centralizes console, network, page errors, dialogs, and navigation telemetry.',
        '',
        'Tool profiles and deferred loading reduce context cost while preserving capability depth.',
      ].join('\n'),
      fill: 'EFF6FF',
    });

    addCard(slide, {
      x: 8.45,
      y: 1.35,
      w: 4.1,
      h: 1.35,
      title: 'Outcome 1',
      body: 'Cleaner prompts and easier demos because the client sees one contract instead of two servers.',
      fill: 'ECFDF5',
      titleColor: THEME.colors.success,
    });
    addCard(slide, {
      x: 8.45,
      y: 2.95,
      w: 4.1,
      h: 1.35,
      title: 'Outcome 2',
      body: 'Higher script reliability from live refs, semantic selectors, content extraction, and URL validation.',
      fill: 'EFF6FF',
    });
    addCard(slide, {
      x: 8.45,
      y: 4.55,
      w: 4.1,
      h: 1.35,
      title: 'Outcome 3',
      body: 'Better operational control with OODA health checks, blocker recovery, transport flexibility, and streaming feedback.',
      fill: 'F0FDFA',
    });
  }

  // Slide 3
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'Architecture overview', 'How requests move across the unified server');

    addCard(slide, {
      x: 0.8,
      y: 1.4,
      w: 2.25,
      h: 0.95,
      title: 'Agents / dashboard',
      body: 'ScriptGenerator, orchestrator, CLI, or web UI',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 3.45,
      y: 1.4,
      w: 2.7,
      h: 0.95,
      title: 'UnifiedAutomationServer',
      body: 'tools/list, tools/call, resources, transports',
      fill: 'EFF6FF',
    });
    addCard(slide, {
      x: 6.55,
      y: 1.4,
      w: 2.15,
      h: 0.95,
      title: 'IntelligentRouter',
      body: 'Chooses source by tool, state, and category',
      fill: 'ECFEFF',
    });
    addCard(slide, {
      x: 9.15,
      y: 0.95,
      w: 3.1,
      h: 1.05,
      title: 'Playwright bridge',
      body: 'Navigate, snapshot, interact, assert',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 9.15,
      y: 2.15,
      w: 3.1,
      h: 1.05,
      title: 'Chrome DevTools bridge',
      body: 'Trace, inspect, debug, recover',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 9.15,
      y: 3.35,
      w: 3.1,
      h: 1.05,
      title: 'Browser / UAT app',
      body: 'OneHome pages, dialogs, requests, DOM state',
      fill: 'F8FAFC',
    });
    addCard(slide, {
      x: 3.45,
      y: 4.7,
      w: 5.25,
      h: 1.15,
      title: 'EventManager + OODA + enforcement',
      body: 'Streams console/network/page events, checks environment health, scores snapshot quality, and enforces MCP-first sequencing.',
      fill: 'F8FAFC',
    });

    addArrow(slide, 3.05, 1.76, 0.32, 0.16);
    addArrow(slide, 6.18, 1.76, 0.28, 0.16);
    addArrow(slide, 8.74, 1.3, 0.3, 0.16);
    addArrow(slide, 8.74, 2.5, 0.3, 0.16);
    addArrow(slide, 10.35, 3.02, 0.18, 0.24, THEME.colors.accent2);

    slide.addShape(ShapeType.line, {
      x: 7.55,
      y: 5.15,
      w: 2.75,
      h: -1.32,
      line: { color: THEME.colors.accent2, width: 1.5, beginArrowType: 'none', endArrowType: 'triangle' },
    });

    slide.addText('Single client contract\n`unified_*` tools', {
      x: 0.95,
      y: 2.75,
      w: 2.0,
      h: 0.55,
      fontFace: THEME.fontBody,
      fontSize: 12,
      color: THEME.colors.muted,
      align: 'center',
    });

    slide.addText('The router hides backend complexity while keeping deep capability coverage.', {
      x: 0.85,
      y: 6.2,
      w: 11.8,
      h: 0.28,
      fontFace: THEME.fontBody,
      fontSize: 12,
      color: THEME.colors.muted,
      italic: true,
    });
  }

  // Slide 4
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'How a request flows', 'The lifecycle from agent intent to structured result');

    const steps = [
      ['Profile tools', 'Server exposes the right tool surface for the session profile or deferred mode.'],
      ['Search on demand', 'If needed, `unified_tool_search` discovers hidden capabilities without loading every schema upfront.'],
      ['Call unified tool', 'Agent invokes one stable tool name such as `unified_snapshot` or `unified_evaluate_cdp`.'],
      ['Route intelligently', 'Router uses tool source, category, and runtime state to pick Playwright or Chrome DevTools.'],
      ['Capture telemetry', 'Events and blocker signals are recorded for diagnostics, dashboards, and recovery logic.'],
      ['Return structure', 'Client gets refs, text, assertions, traces, or errors in a single normalized response path.'],
    ];

    let x = 0.7;
    steps.forEach((step, index) => {
      addFlowStep(slide, index + 1, step[0], step[1], x, 1.55 + ((index % 2) * 1.55), 1.92, 1.16, index === 1 || index === 4 ? 'EFF6FF' : 'FFFFFF');
      if (index < steps.length - 1) {
        addArrow(slide, x + 2.0, 2.02 + ((index % 2) * 1.55), 0.32, 0.16);
      }
      x += 2.12;
    });

    addCard(slide, {
      x: 0.85,
      y: 5.35,
      w: 3.8,
      h: 1.0,
      title: 'Why this matters for demos',
      body: 'You can explain one clean request path instead of teaching users which MCP backend to think about.',
      fill: 'F8FAFC',
    });
    addCard(slide, {
      x: 4.78,
      y: 5.35,
      w: 3.8,
      h: 1.0,
      title: 'Why this matters for automation',
      body: 'The response includes real page intelligence instead of guessed selectors, reducing failure propagation downstream.',
      fill: 'F8FAFC',
    });
    addCard(slide, {
      x: 8.71,
      y: 5.35,
      w: 3.8,
      h: 1.0,
      title: 'Why this matters for operations',
      body: 'Visibility into routing, health, blockers, and events makes troubleshooting far faster.',
      fill: 'F8FAFC',
    });
  }

  // Slide 5
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'Suggested live demo flow', 'Use actual unified tools to show how the server works end to end');

    const demoSteps = [
      ['Fresh start', 'Launch the server and explain the single `unified-automation-mcp` endpoint.'],
      ['Navigate', 'Call the required first action: `mcp_unified-autom_unified_navigate`.'],
      ['Snapshot', 'Run `unified_snapshot` to capture the accessibility tree and element refs.'],
      ['Validate selectors', 'Use `unified_get_by_role` or `unified_get_by_test_id` to prove semantic discovery.'],
      ['Extract content', 'Use `unified_get_text_content` or `unified_get_attribute` for assertion-ready values.'],
      ['Verify navigation', 'Use `unified_get_page_url` or `unified_expect_url` to confirm page state.'],
      ['Show downstream value', 'Explain how exploration JSON and generated Playwright scripts inherit these exact findings.'],
    ];

    demoSteps.forEach((step, idx) => {
      addFlowStep(slide, idx + 1, step[0], step[1], 0.8, 1.33 + (idx * 0.73), 11.7, 0.56, idx === 1 || idx === 2 ? 'EFF6FF' : 'FFFFFF');
    });

    addCard(slide, {
      x: 9.55,
      y: 1.25,
      w: 2.6,
      h: 1.1,
      title: 'Enforced sequence',
      body: 'The config and hooks require navigation + snapshot before script creation.',
      fill: 'FEF3C7',
      titleColor: THEME.colors.dark,
    });

    slide.addText(`Configured first tool call: ${facts.firstToolCall}`, {
      x: 0.9,
      y: 6.65,
      w: 7.3,
      h: 0.2,
      fontFace: THEME.fontBody,
      fontSize: 11,
      color: THEME.colors.muted,
      italic: true,
    });
  }

  // Slide 6
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'Reliability and guardrails', 'What keeps the unified server trustworthy in practice');

    addCard(slide, {
      x: 0.8,
      y: 1.4,
      w: 3.0,
      h: 1.35,
      title: 'OODA health check',
      body: 'Before the pipeline runs, environment readiness is scored and can PROCEED, WARN, or ABORT.',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 4.05,
      y: 1.4,
      w: 3.0,
      h: 1.35,
      title: 'Exploration quality',
      body: 'Snapshots are scored so sparse pages, spinners, or poor coverage can trigger WARN or RETRY_RECOMMENDED.',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 7.3,
      y: 1.4,
      w: 3.0,
      h: 1.35,
      title: 'Enforcement hooks',
      body: 'Sequencing rules are structural: script creation is blocked until MCP evidence exists.',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 0.8,
      y: 3.2,
      w: 3.0,
      h: 1.35,
      title: 'Runtime blocker recovery',
      body: 'Dialogs and blocking overlays are detected, classified, and retried through the proper recovery path.',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 4.05,
      y: 3.2,
      w: 3.0,
      h: 1.35,
      title: 'Event manager',
      body: 'Console, network, page errors, dialogs, mutations, and navigation signals are buffered and queryable.',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 7.3,
      y: 3.2,
      w: 3.0,
      h: 1.35,
      title: 'Transport flexibility',
      body: 'The same server can run over stdio, SSE, or streamable HTTP depending on the client.',
      fill: 'FFFFFF',
    });

    addCard(slide, {
      x: 10.6,
      y: 1.4,
      w: 1.9,
      h: 3.15,
      title: 'Use this line',
      body: '“The unified MCP server is not only a tool catalog. It is a control plane for quality, routing, and observability.”',
      fill: 'EFF6FF',
    });

    addPill(slide, 'PROCEED / WARN / ABORT', 1.0, 4.85, 2.05, THEME.colors.accent);
    addPill(slide, 'ACCEPT / WARN / RETRY', 4.28, 4.85, 1.95, THEME.colors.accent2);
    addPill(slide, 'Detect -> recover -> retry', 7.52, 4.85, 2.1, THEME.colors.accent3);
  }

  // Slide 7
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'Scale and efficiency', 'Why tool management matters as the server grows');

    addMetric(slide, 'Total unified tools', String(facts.totalTools), 0.8, 1.45, 1.8);
    addMetric(slide, 'Core tools', String(facts.toolStats.core), 2.9, 1.45, 1.6);
    addMetric(slide, 'Enhanced tools', String(facts.toolStats.enhanced), 4.8, 1.45, 1.7);
    addMetric(slide, 'Advanced tools', String(facts.toolStats.advanced), 6.8, 1.45, 1.7);
    addMetric(slide, 'Always loaded', String(facts.alwaysLoaded), 8.8, 1.45, 1.7);

    addCard(slide, {
      x: 10.85,
      y: 1.45,
      w: 1.85,
      h: 0.9,
      title: '~85% token savings',
      body: 'Deferred loading + `unified_tool_search` keep context lean.',
      fill: 'ECFDF5',
      titleColor: THEME.colors.success,
    });

    addCard(slide, {
      x: 0.8,
      y: 2.9,
      w: 5.25,
      h: 2.8,
      title: 'What is optimized',
      body: [
        'Tool profiles scope what is exposed in `tools/list`.',
        'Deferred mode keeps only the always-loaded set visible and finds the rest with BM25-style search.',
        'Filtering optimizes context cost, but `tools/call` can still route valid tools when needed.',
        'This is important in long agent sessions where tool schemas would otherwise consume a large share of the context window.',
      ].join('\n'),
      fill: 'F8FAFC',
    });

    addCard(slide, {
      x: 6.35,
      y: 2.9,
      w: 3.0,
      h: 2.8,
      title: 'Representative categories',
      body: facts.sampleCategories.map(([name, count]) => `${name}: ${count}`).join('\n'),
      fill: 'FFFFFF',
    });

    addCard(slide, {
      x: 9.65,
      y: 2.9,
      w: 3.0,
      h: 2.8,
      title: 'Supported transports',
      body: facts.transports.map((transport) => `- ${transport}`).join('\n'),
      fill: 'FFFFFF',
    });
  }

  // Slide 8
  {
    const slide = pptx.addSlide();
    addChrome(slide, 'What to emphasize in the demo', 'Show both technical depth and business value');

    addCard(slide, {
      x: 0.8,
      y: 1.4,
      w: 5.55,
      h: 4.95,
      title: 'Live walkthrough talking points',
      body: [
        '1. Start with one server name and one tool namespace.',
        '2. Show a navigation request, then snapshot the real page.',
        '3. Validate one semantic selector and one extracted text value.',
        '4. Explain how the router chooses the underlying bridge.',
        '5. Point out event visibility and blocker recovery as operational differentiators.',
        '6. Close by tying the MCP output to generated scripts, retries, and defect creation.',
      ].join('\n'),
      fill: 'EFF6FF',
    });

    addCard(slide, {
      x: 6.7,
      y: 1.4,
      w: 2.7,
      h: 1.25,
      title: 'Business value',
      body: 'Faster demo comprehension and less friction for users adopting the workflow.',
      fill: 'ECFDF5',
      titleColor: THEME.colors.success,
    });
    addCard(slide, {
      x: 9.7,
      y: 1.4,
      w: 2.55,
      h: 1.25,
      title: 'Engineering value',
      body: 'Higher selector accuracy, easier debugging, and cleaner integration boundaries.',
      fill: 'FFFFFF',
    });
    addCard(slide, {
      x: 6.7,
      y: 2.95,
      w: 5.55,
      h: 1.35,
      title: 'Suggested close',
      body: '“Unified MCP gives us one place to explore, route, observe, validate, and recover. That is why our automation pipeline is simpler to use and more reliable to operate.”',
      fill: 'F8FAFC',
    });
    addCard(slide, {
      x: 6.7,
      y: 4.6,
      w: 5.55,
      h: 1.8,
      title: 'Optional next version',
      body: 'Add real screenshots from a live exploration session, one event-stream screenshot, and one example of tool routing to make the demo even more concrete.',
      fill: 'FEF3C7',
      titleColor: THEME.colors.dark,
    });
  }

  return pptx;
}

async function main() {
  const facts = await loadFacts();
  const pptx = buildDeck(facts);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  await pptx.writeFile({ fileName: OUTPUT_PATH });

  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`PPTX was not created at ${OUTPUT_PATH}`);
  }

  const stat = fs.statSync(OUTPUT_PATH);
  console.log(`Created: ${OUTPUT_PATH}`);
  console.log(`Size: ${(stat.size / 1024).toFixed(1)} KB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




