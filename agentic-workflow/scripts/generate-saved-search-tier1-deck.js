/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');

// ----------------------------
// Config
// ----------------------------
const OUTPUT_PATH = 'C:\\Users\\sjuberrafik\\OneDrive - CoreLogic Solutions, LLC\\Downloads\\Consumer Saved Search Notifications - Tier1.pptx';
const SCREENSHOT_PATH = 'C:\\Users\\sjuberrafik\\OneDrive - CoreLogic Solutions, LLC\\Downloads\\Images\\Screenshots-Work\\Saved Search.PNG';

const THEME = {
  fontHead: 'Segoe UI',
  fontBody: 'Segoe UI',
  colors: {
    bg: 'FFFFFF',
    text: '111827',
    muted: '6B7280',
    line: 'E5E7EB',
    accent: '0B5CAB', // CoreLogic-like blue
    accent2: '0EA5A4',
    good: '16A34A',
    warn: 'F59E0B',
    bad: 'DC2626',
    card: 'F8FAFC',
  },
};

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';

// Reduce default margins in exported notes view
pptx.author = 'CoreLogic';
pptx.company = 'CoreLogic Solutions, LLC';
pptx.subject = 'Consumer Saved Search Notifications – Tier-1 Meeting Summary';

// ----------------------------
// Helpers
// ----------------------------
function svgToDataUri(svg) {
  const cleaned = svg.replace(/\n/g, '').replace(/\s{2,}/g, ' ').trim();
  const base64 = Buffer.from(cleaned, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

function pngFileToDataUri(filePath) {
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:image/png;base64,${base64}`;
}

function addHeader(slide, title) {
  // Top bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.6,
    fill: { color: THEME.colors.accent },
    line: { color: THEME.colors.accent },
  });

  slide.addText(title, {
    x: 0.6,
    y: 0.14,
    w: 10.8,
    h: 0.35,
    fontFace: THEME.fontHead,
    fontSize: 16,
    bold: true,
    color: 'FFFFFF',
  });

  slide.addText('Confidential — Internal', {
    x: 11.2,
    y: 0.18,
    w: 2.0,
    h: 0.3,
    fontFace: THEME.fontBody,
    fontSize: 10,
    color: 'DBEAFE',
    align: 'right',
  });

  // Footer line
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6,
    y: 7.15,
    w: 12.133,
    h: 0,
    line: { color: THEME.colors.line, width: 1 },
  });

  slide.addText('Consumer Saved Search Notifications — Meeting Summary', {
    x: 0.6,
    y: 7.2,
    w: 9.5,
    h: 0.25,
    fontFace: THEME.fontBody,
    fontSize: 9,
    color: THEME.colors.muted,
  });

  slide.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }), {
    x: 10.2,
    y: 7.2,
    w: 2.533,
    h: 0.25,
    fontFace: THEME.fontBody,
    fontSize: 9,
    color: THEME.colors.muted,
    align: 'right',
  });
}

function addSectionTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.6,
    y: 0.95,
    w: 12.133,
    h: 0.5,
    fontFace: THEME.fontHead,
    fontSize: 30,
    bold: true,
    color: THEME.colors.text,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6,
      y: 1.45,
      w: 12.133,
      h: 0.35,
      fontFace: THEME.fontBody,
      fontSize: 14,
      color: THEME.colors.muted,
    });
  }
}

function addBullets(slide, bullets, box) {
  const text = bullets.map((b) => `• ${b}`).join('\n');
  slide.addText(text, {
    ...box,
    fontFace: THEME.fontBody,
    fontSize: 16,
    color: THEME.colors.text,
    lineSpacingMultiple: 1.2,
  });
}

function addCard(slide, { x, y, w, h, title, body, iconDataUri }) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill: { color: THEME.colors.card },
    line: { color: THEME.colors.line, width: 1 },
    radius: 10,
  });

  if (iconDataUri) {
    slide.addImage({ data: iconDataUri, x: x + 0.25, y: y + 0.25, w: 0.35, h: 0.35 });
  }

  slide.addText(title, {
    x: x + 0.7,
    y: y + 0.18,
    w: w - 0.95,
    h: 0.35,
    fontFace: THEME.fontHead,
    fontSize: 14,
    bold: true,
    color: THEME.colors.text,
  });
  slide.addText(body, {
    x: x + 0.25,
    y: y + 0.6,
    w: w - 0.5,
    h: h - 0.75,
    fontFace: THEME.fontBody,
    fontSize: 12,
    color: THEME.colors.muted,
    valign: 'top',
  });
}

function addPipeline(slide, x, y, w, stageTitles, stageSubtitles) {
  const gap = 0.35;
  const boxW = (w - gap * (stageTitles.length - 1)) / stageTitles.length;
  for (let i = 0; i < stageTitles.length; i += 1) {
    const bx = x + i * (boxW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: bx,
      y,
      w: boxW,
      h: 1.25,
      fill: { color: i === 1 ? 'EAF2FF' : 'FFFFFF' },
      line: { color: THEME.colors.line, width: 1 },
      radius: 10,
    });
    slide.addText(stageTitles[i], {
      x: bx + 0.25,
      y: y + 0.18,
      w: boxW - 0.5,
      h: 0.35,
      fontFace: THEME.fontHead,
      fontSize: 14,
      bold: true,
      color: THEME.colors.text,
      align: 'center',
    });
    slide.addText(stageSubtitles[i], {
      x: bx + 0.25,
      y: y + 0.55,
      w: boxW - 0.5,
      h: 0.6,
      fontFace: THEME.fontBody,
      fontSize: 11,
      color: THEME.colors.muted,
      align: 'center',
      valign: 'mid',
    });

    if (i < stageTitles.length - 1) {
      const ax = bx + boxW;
      slide.addShape(pptx.ShapeType.rightArrow, {
        x: ax + 0.05,
        y: y + 0.43,
        w: gap - 0.1,
        h: 0.35,
        fill: { color: THEME.colors.accent },
        line: { color: THEME.colors.accent },
      });
    }
  }
}

// Simple, clean inline SVG icons
const ICONS = {
  search: svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0B5CAB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  `),
  bell: svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0EA5A4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7"/>
      <path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  `),
  email: svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0B5CAB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <path d="M3 7l9 6 9-6"/>
    </svg>
  `),
  scale: svgToDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0B5CAB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v18"/>
      <path d="M3 6h18"/>
      <path d="M6 6l-3 7h6l-3-7z"/>
      <path d="M18 6l-3 7h6l-3-7z"/>
      <path d="M5 21h14"/>
    </svg>
  `),
};

function addProsCons(slide, x, y, w, pros, cons) {
  const colW = (w - 0.3) / 2;

  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w: colW,
    h: 2.3,
    fill: { color: 'ECFDF5' },
    line: { color: 'BBF7D0', width: 1 },
    radius: 10,
  });
  slide.addText('Pros', {
    x: x + 0.25,
    y: y + 0.18,
    w: colW - 0.5,
    h: 0.3,
    fontFace: THEME.fontHead,
    fontSize: 14,
    bold: true,
    color: THEME.colors.good,
  });
  addBullets(slide, pros, { x: x + 0.25, y: y + 0.55, w: colW - 0.5, h: 1.65 });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: x + colW + 0.3,
    y,
    w: colW,
    h: 2.3,
    fill: { color: 'FEF2F2' },
    line: { color: 'FECACA', width: 1 },
    radius: 10,
  });
  slide.addText('Cons / Risks', {
    x: x + colW + 0.55,
    y: y + 0.18,
    w: colW - 0.5,
    h: 0.3,
    fontFace: THEME.fontHead,
    fontSize: 14,
    bold: true,
    color: THEME.colors.bad,
  });
  addBullets(slide, cons, { x: x + colW + 0.55, y: y + 0.55, w: colW - 0.5, h: 1.65 });
}

// ----------------------------
// Slides
// ----------------------------

// 1) Title
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };

  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: 'FFFFFF' } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.2, fill: { color: THEME.colors.accent } });

  slide.addText('Consumer Saved Search', {
    x: 0.8,
    y: 0.32,
    w: 12,
    h: 0.45,
    fontFace: THEME.fontHead,
    fontSize: 26,
    bold: true,
    color: 'FFFFFF',
  });
  slide.addText('Email / Push Notifications', {
    x: 0.8,
    y: 0.72,
    w: 12,
    h: 0.45,
    fontFace: THEME.fontHead,
    fontSize: 26,
    bold: true,
    color: 'DBEAFE',
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 2.0,
    w: 11.8,
    h: 3.9,
    fill: { color: 'F8FAFC' },
    line: { color: THEME.colors.line },
    radius: 18,
  });

  slide.addText('Meeting Summary: Problem, Options, Direction', {
    x: 1.2,
    y: 2.35,
    w: 11,
    h: 0.6,
    fontFace: THEME.fontBody,
    fontSize: 18,
    color: THEME.colors.text,
  });

  slide.addText('Focus: match detection vs notification delivery, scaling, and syndication alignment', {
    x: 1.2,
    y: 3.05,
    w: 11,
    h: 0.5,
    fontFace: THEME.fontBody,
    fontSize: 14,
    color: THEME.colors.muted,
  });

  // Icon row
  slide.addImage({ data: ICONS.search, x: 1.2, y: 4.15, w: 0.45, h: 0.45 });
  slide.addText('Saved Search', { x: 1.7, y: 4.16, w: 3.0, h: 0.4, fontFace: THEME.fontBody, fontSize: 12, color: THEME.colors.text });

  slide.addImage({ data: ICONS.scale, x: 4.0, y: 4.15, w: 0.45, h: 0.45 });
  slide.addText('Match Engine', { x: 4.5, y: 4.16, w: 3.0, h: 0.4, fontFace: THEME.fontBody, fontSize: 12, color: THEME.colors.text });

  slide.addImage({ data: ICONS.email, x: 6.7, y: 4.15, w: 0.45, h: 0.45 });
  slide.addText('Email', { x: 7.2, y: 4.16, w: 1.5, h: 0.4, fontFace: THEME.fontBody, fontSize: 12, color: THEME.colors.text });

  slide.addImage({ data: ICONS.bell, x: 8.5, y: 4.15, w: 0.45, h: 0.45 });
  slide.addText('Push', { x: 9.0, y: 4.16, w: 1.5, h: 0.4, fontFace: THEME.fontBody, fontSize: 12, color: THEME.colors.text });

  slide.addText('Option A leaning', {
    x: 1.2,
    y: 5.0,
    w: 11,
    h: 0.5,
    fontFace: THEME.fontHead,
    fontSize: 14,
    bold: true,
    color: THEME.colors.accent,
  });

  slide.addNotes(
    [
      'Purpose of this deck: capture the Tier-1 meeting summary for Consumer Saved Search Notifications.',
      'We aligned on the core problem (saved searches exist but there is no notification experience), reviewed three architecture options (A/B/C), and converged on a direction with Option A as the long-term fit.',
      'Slides intentionally separate match detection (compute “what changed”) from notification delivery (how we message users), because most risk and cost live at that boundary.',
    ].join('\n')
  );
}

// 2) Executive Summary
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Executive Summary');

  addSectionTitle(slide, 'Executive Summary', 'What we agreed on and where we are headed');

  addBullets(
    slide,
    [
      'There is significant latent demand: ~24M searches, ~2.4M saved searches, but no alerts are being sent today.',
      'We evaluated three options; key decision is where match detection should live and how to minimize criteria-mapping + syndication risk.',
      'Consensus direction: lean Option A (OneHome match engine) to align with long-term syndication + scale; Option C as a practical fallback for email delivery.',
    ],
    { x: 0.8, y: 2.05, w: 7.2, h: 3.2 }
  );

  // Screenshot (if available)
  if (fs.existsSync(SCREENSHOT_PATH)) {
    const img = pngFileToDataUri(SCREENSHOT_PATH);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 8.4,
      y: 2.05,
      w: 4.2,
      h: 3.2,
      fill: { color: 'FFFFFF' },
      line: { color: THEME.colors.line },
      radius: 12,
    });
    slide.addImage({ data: img, x: 8.55, y: 2.2, w: 3.9, h: 2.9 });
    slide.addText('Current Saved Search UI (reference)', {
      x: 8.4,
      y: 5.3,
      w: 4.2,
      h: 0.3,
      fontFace: THEME.fontBody,
      fontSize: 10,
      color: THEME.colors.muted,
      align: 'center',
    });
  }

  slide.addNotes(
    [
      'Executive summary of the discussion.',
      'We quantified the opportunity and framed the decision as “match vs notify.”',
      'The group generally leaned toward Option A because it keeps match logic in a system designed for search criteria and syndication, and it avoids a heavy criteria translation layer.',
      'Screenshot is included only as visual context for what users interact with today; it is not a design review.',
    ].join('\n')
  );
}

// 3) Problem & Impact
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Problem & Impact');

  addSectionTitle(slide, 'Problem & Impact', 'High volume of searches; saved searches have no alert experience');

  // Funnel (stacked blocks)
  const fx = 0.8;
  const fy = 2.15;
  const fh = 0.85;
  const fgap = 0.12;

  const blocks = [
    { label: '24M searches (total)', w: 6.4, color: 'EAF2FF' },
    { label: '2.4M saved searches (~10%)', w: 5.3, color: 'DDEBFF' },
    { label: '0 notifications sent today', w: 4.2, color: 'FFE4E6' },
  ];

  blocks.forEach((b, i) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: fx + (6.4 - b.w) / 2,
      y: fy + i * (fh + fgap),
      w: b.w,
      h: fh,
      fill: { color: b.color },
      line: { color: THEME.colors.line },
      radius: 10,
    });
    slide.addText(b.label, {
      x: fx + (6.4 - b.w) / 2,
      y: fy + i * (fh + fgap) + 0.18,
      w: b.w,
      h: 0.5,
      fontFace: THEME.fontHead,
      fontSize: 16,
      bold: true,
      color: THEME.colors.text,
      align: 'center',
    });
  });

  slide.addShape(pptx.ShapeType.downArrow, {
    x: 3.7,
    y: 4.95,
    w: 0.6,
    h: 0.55,
    fill: { color: THEME.colors.accent },
    line: { color: THEME.colors.accent },
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.7,
    y: 2.15,
    w: 4.9,
    h: 3.1,
    fill: { color: 'FFFFFF' },
    line: { color: THEME.colors.line },
    radius: 12,
  });

  slide.addText('Impact', {
    x: 8.0,
    y: 2.35,
    w: 4.4,
    h: 0.4,
    fontFace: THEME.fontHead,
    fontSize: 16,
    bold: true,
    color: THEME.colors.text,
  });

  addBullets(
    slide,
    [
      'Missed engagement loop (new listings, price drops, status changes).',
      'No cross-channel consistency (email + push) for saved search users.',
      'Difficult to scale without a clear match engine + notification contract.',
    ],
    { x: 8.0, y: 2.8, w: 4.4, h: 2.2 }
  );

  slide.addNotes(
    [
      'We anchored on scale: approximately 24M searches exist and roughly 2.4M are saved searches.',
      'Despite the volume, there is currently no end-to-end notification experience to alert users when their saved criteria matches new or changed inventory.',
      'This creates a gap in consumer engagement and also means we do not have a durable “match-to-notify” platform boundary for future channel expansion.',
    ].join('\n')
  );
}

// 4) Desired Outcomes & Requirements
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Desired Outcomes & Requirements');

  addSectionTitle(slide, 'Desired Outcomes & Requirements', 'Build once, support multi-channel and syndication');

  const cards = [
    {
      title: 'Multi-channel notifications',
      body: 'Email now; push support designed-in. Common event model across channels.',
      icon: ICONS.email,
    },
    {
      title: 'Visibility & user rules',
      body: 'Respect listing visibility rules, user permissions, and opt-in preferences.',
      icon: ICONS.bell,
    },
    {
      title: 'Syndication alignment',
      body: 'Criteria should be portable across surfaces and partners; avoid brittle translations.',
      icon: ICONS.scale,
    },
    {
      title: 'Scale + reliability',
      body: 'Support millions of saved searches with throttling, dedup, and observability.',
      icon: ICONS.search,
    },
    {
      title: 'Lower maintenance cost',
      body: 'Minimize duplicated criteria logic; keep responsibilities clean (match vs notify).',
      icon: ICONS.scale,
    },
    {
      title: 'Deliverability ready',
      body: 'Support digest, rate limits, unsubscribe/complaint handling, and templates.',
      icon: ICONS.email,
    },
  ];

  const startX = 0.8;
  const startY = 2.05;
  const cw = 4.0;
  const ch = 1.45;
  const xGap = 0.45;
  const yGap = 0.35;

  cards.forEach((c, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    addCard(slide, {
      x: startX + col * (cw + xGap),
      y: startY + row * (ch + yGap),
      w: cw,
      h: ch,
      title: c.title,
      body: c.body,
      iconDataUri: c.icon,
    });
  });

  slide.addNotes(
    [
      'We documented requirements that are non-negotiable for a Tier-1 implementation.',
      'The goal is not “send an email” but to establish a platform: a stable match event contract, consistent preference handling, and operational controls (throttling/digest/observability).',
      'Syndication is a key constraint: we want criteria to remain portable and not be locked into a single internal representation that other systems cannot reuse.',
    ].join('\n')
  );
}

// 5) End-to-end Concept
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'End-to-end Concept');

  addSectionTitle(slide, 'End-to-end Concept', 'Separate match detection from notification delivery');

  addPipeline(
    slide,
    0.8,
    2.2,
    12.533,
    ['Saved Search', 'Match Detection', 'Notification Delivery'],
    [
      'Criteria + frequency\n(user intent)',
      'Compute which listings\nmatch what changed',
      'Email + push via\npreferences + templates',
    ]
  );

  // Boundary annotation
  slide.addShape(pptx.ShapeType.line, {
    x: 0.8,
    y: 3.8,
    w: 12.533,
    h: 0,
    line: { color: THEME.colors.line, width: 2, dash: 'dash' },
  });
  slide.addText('Boundary: Match vs Notify', {
    x: 5.05,
    y: 3.62,
    w: 3.4,
    h: 0.3,
    fontFace: THEME.fontBody,
    fontSize: 11,
    color: THEME.colors.muted,
    align: 'center',
  });

  // Key idea callouts
  addCard(slide, {
    x: 0.8,
    y: 4.25,
    w: 6.05,
    h: 2.55,
    title: 'Match event contract',
    body: 'Emit a canonical event: {savedSearchId, listingIds, changeType, timestamp}.\nDownstream can throttle/digest without re-running criteria logic.',
    iconDataUri: ICONS.scale,
  });

  addCard(slide, {
    x: 7.283,
    y: 4.25,
    w: 6.05,
    h: 2.55,
    title: 'Delivery orchestration',
    body: 'Routing, preferences, templates, and deliverability controls live in the notification layer; multiple channels consume the same match events.',
    iconDataUri: ICONS.bell,
  });

  slide.addNotes(
    [
      'We agreed the cleanest mental model is a three-stage pipeline: save criteria, detect matches, then deliver notifications.',
      'The “boundary” is critical: match detection should own criteria evaluation at scale; notification delivery should own messaging, rate-limits, templates, and user preferences.',
      'This separation reduces maintenance and makes it easier to add push notifications after email without duplicating logic.',
    ].join('\n')
  );
}

// 6) Option A
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Option A — OneHome Match Engine');

  addSectionTitle(slide, 'Option A (Preferred)', 'Use OneHome for match detection + notification orchestration');

  // Architecture diagram
  const x = 0.8;
  const y = 2.1;

  slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.6, h: 0.85, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Saved Searches\n(consumer store)', { x: x + 0.2, y: y + 0.15, w: 3.2, h: 0.6, fontFace: THEME.fontHead, fontSize: 12, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addShape(pptx.ShapeType.rightArrow, { x: x + 3.7, y: y + 0.25, w: 0.45, h: 0.35, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });

  slide.addShape(pptx.ShapeType.roundRect, { x: x + 4.25, y, w: 3.9, h: 0.85, fill: { color: 'EAF2FF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('OneHome Match Engine', { x: x + 4.45, y: y + 0.28, w: 3.5, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addShape(pptx.ShapeType.rightArrow, { x: x + 8.25, y: y + 0.25, w: 0.45, h: 0.35, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });

  slide.addShape(pptx.ShapeType.roundRect, { x: x + 8.8, y, w: 3.8, h: 0.85, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Notification Service\n(preferences + digest)', { x: x + 9.0, y: y + 0.12, w: 3.4, h: 0.65, fontFace: THEME.fontHead, fontSize: 12, bold: true, color: THEME.colors.text, align: 'center' });

  // Channels
  slide.addImage({ data: ICONS.email, x: 10.2, y: 3.2, w: 0.35, h: 0.35 });
  slide.addText('Email', { x: 10.55, y: 3.19, w: 1.2, h: 0.3, fontFace: THEME.fontBody, fontSize: 12, color: THEME.colors.text });
  slide.addImage({ data: ICONS.bell, x: 11.35, y: 3.2, w: 0.35, h: 0.35 });
  slide.addText('Push', { x: 11.7, y: 3.19, w: 1.2, h: 0.3, fontFace: THEME.fontBody, fontSize: 12, color: THEME.colors.text });

  slide.addShape(pptx.ShapeType.line, { x: 9.0, y: 2.95, w: 0, h: 0.6, line: { color: THEME.colors.line, width: 1 } });
  slide.addShape(pptx.ShapeType.line, { x: 9.0, y: 2.95, w: 1.0, h: 0, line: { color: THEME.colors.line, width: 1 } });

  addProsCons(
    slide,
    0.8,
    4.0,
    12.533,
    ['Best fit for syndication + shared criteria model', 'Avoids large criteria mapping layer', 'Clear match-to-notify contract; scales to push'],
    ['Requires OneHome investment for eventing + ops', 'Need throttling/digest strategy early', 'Integration sequencing across systems']
  );

  slide.addNotes(
    [
      'Option A places match detection in OneHome, which is already closest to the search/criteria domain and the syndication direction.',
      'A notification service consumes match events to handle digest, throttling, preferences, and channel routing (email now, push later).',
      'The primary work is building robust event emission and operational controls, but it avoids a fragile criteria translation layer.',
    ].join('\n')
  );
}

// 7) Option B
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Option B — Matrix Match + Email');

  addSectionTitle(slide, 'Option B', 'Matrix performs match detection + email generation');

  const x = 0.8;
  const y = 2.1;

  slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 4.2, h: 0.85, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Saved Searches\n(consumer store)', { x: x + 0.2, y: y + 0.15, w: 3.8, h: 0.6, fontFace: THEME.fontHead, fontSize: 12, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addShape(pptx.ShapeType.rightArrow, { x: x + 4.35, y: y + 0.25, w: 0.5, h: 0.35, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });

  slide.addShape(pptx.ShapeType.roundRect, { x: x + 5.0, y, w: 3.9, h: 0.85, fill: { color: 'FFF7ED' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Matrix\n(Match + Email)', { x: x + 5.2, y: y + 0.12, w: 3.5, h: 0.65, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addShape(pptx.ShapeType.rightArrow, { x: x + 9.05, y: y + 0.25, w: 0.5, h: 0.35, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });

  slide.addShape(pptx.ShapeType.roundRect, { x: x + 9.75, y, w: 3.6, h: 0.85, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Email Delivery\n(SMTP / provider)', { x: x + 9.95, y: y + 0.12, w: 3.2, h: 0.65, fontFace: THEME.fontHead, fontSize: 12, bold: true, color: THEME.colors.text, align: 'center' });

  // Mapping risk callout
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 3.25,
    w: 12.533,
    h: 0.6,
    fill: { color: 'FEF3C7' },
    line: { color: 'FDE68A' },
    radius: 10,
  });
  slide.addText('Risk: criteria/schema mapping — saved search model must be translated into Matrix rules (potentially brittle).', {
    x: 1.05,
    y: 3.4,
    w: 12.0,
    h: 0.3,
    fontFace: THEME.fontBody,
    fontSize: 12,
    color: '92400E',
    bold: true,
  });

  addProsCons(
    slide,
    0.8,
    4.0,
    12.533,
    ['Potentially fastest to get email out the door', 'Single system owns match + email', 'Leverages existing Matrix email capabilities'],
    ['Syndication misalignment; hard to reuse criteria elsewhere', 'High mapping risk + long-term maintenance', 'Push channel becomes harder (email-centric design)']
  );

  slide.addNotes(
    [
      'Option B moves both match detection and email composition into Matrix.',
      'The biggest risk discussed is criteria translation: saved search criteria would need to be mapped to Matrix’s internal representation; changes to the schema or partner requirements can create churn.',
      'This option can look fast initially but increases long-term maintenance and is blocked by the desired syndication direction.',
    ].join('\n')
  );
}

// 8) Option C
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Option C — Hybrid');

  addSectionTitle(slide, 'Option C (Hybrid)', 'OneHome match detection + Matrix SMTP for email delivery');

  const x = 0.8;
  const y = 2.1;

  slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.6, h: 0.85, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Saved Searches', { x: x + 0.2, y: y + 0.25, w: 3.2, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addShape(pptx.ShapeType.rightArrow, { x: x + 3.7, y: y + 0.25, w: 0.45, h: 0.35, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });

  slide.addShape(pptx.ShapeType.roundRect, { x: x + 4.25, y, w: 3.9, h: 0.85, fill: { color: 'EAF2FF' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('OneHome Match Engine', { x: x + 4.45, y: y + 0.28, w: 3.5, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addShape(pptx.ShapeType.rightArrow, { x: x + 8.25, y: y + 0.25, w: 0.45, h: 0.35, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });

  slide.addShape(pptx.ShapeType.roundRect, { x: x + 8.8, y, w: 3.8, h: 0.85, fill: { color: 'FFF7ED' }, line: { color: THEME.colors.line }, radius: 10 });
  slide.addText('Matrix SMTP\n(Email send)', { x: x + 9.0, y: y + 0.12, w: 3.4, h: 0.65, fontFace: THEME.fontHead, fontSize: 13, bold: true, color: THEME.colors.text, align: 'center' });

  slide.addText('Push remains in notification service / channel layer', {
    x: 0.8,
    y: 3.25,
    w: 12.533,
    h: 0.35,
    fontFace: THEME.fontBody,
    fontSize: 12,
    color: THEME.colors.muted,
  });

  addProsCons(
    slide,
    0.8,
    4.0,
    12.533,
    ['Keeps match logic in OneHome (syndication-aligned)', 'Can reuse Matrix email delivery if mature', 'Reduces criteria mapping vs Option B'],
    ['Still requires integration + contracts across systems', 'Email templating/ownership boundaries must be clear', 'Potential double-ops if responsibilities blur']
  );

  slide.addNotes(
    [
      'Option C is a hybrid: keep match detection in OneHome, but use Matrix as the outbound email delivery mechanism.',
      'This keeps criteria evaluation close to the search domain while leveraging existing SMTP/deliverability tooling if it is already proven.',
      'Key risk is organizational/technical boundaries: who owns templates, unsubscribe, throttling, and audit logs—these must be explicit.',
    ].join('\n')
  );
}

// 9) Comparison Table
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Option Comparison');

  addSectionTitle(slide, 'Option Comparison', 'Trade-offs across A / B / C');

  const rows = [
    ['Criteria mapping risk', { t: 'Low', c: THEME.colors.good }, { t: 'High', c: THEME.colors.bad }, { t: 'Low', c: THEME.colors.good }],
    ['Syndication alignment', { t: 'Strong', c: THEME.colors.good }, { t: 'Weak', c: THEME.colors.bad }, { t: 'Strong', c: THEME.colors.good }],
    ['Time to MVP (email)', { t: 'Medium', c: THEME.colors.warn }, { t: 'Fast', c: THEME.colors.good }, { t: 'Medium', c: THEME.colors.warn }],
    ['Push-ready architecture', { t: 'Strong', c: THEME.colors.good }, { t: 'Weak', c: THEME.colors.bad }, { t: 'Medium', c: THEME.colors.warn }],
    ['Ops burden (long-term)', { t: 'Medium', c: THEME.colors.warn }, { t: 'High', c: THEME.colors.bad }, { t: 'Medium', c: THEME.colors.warn }],
    ['Email complexity ownership', { t: 'In notify svc', c: THEME.colors.warn }, { t: 'In Matrix', c: THEME.colors.good }, { t: 'Split', c: THEME.colors.warn }],
  ];

  const tableRows = [
    [
      { text: 'Dimension', options: { bold: true, color: 'FFFFFF', fill: THEME.colors.accent, fontFace: THEME.fontHead } },
      { text: 'Option A', options: { bold: true, color: 'FFFFFF', fill: THEME.colors.accent, fontFace: THEME.fontHead, align: 'center' } },
      { text: 'Option B', options: { bold: true, color: 'FFFFFF', fill: THEME.colors.accent, fontFace: THEME.fontHead, align: 'center' } },
      { text: 'Option C', options: { bold: true, color: 'FFFFFF', fill: THEME.colors.accent, fontFace: THEME.fontHead, align: 'center' } },
    ],
  ];

  rows.forEach((r) => {
    tableRows.push([
      { text: r[0], options: { color: THEME.colors.text, fontFace: THEME.fontBody } },
      { text: r[1].t, options: { bold: true, color: r[1].c, fontFace: THEME.fontBody, align: 'center' } },
      { text: r[2].t, options: { bold: true, color: r[2].c, fontFace: THEME.fontBody, align: 'center' } },
      { text: r[3].t, options: { bold: true, color: r[3].c, fontFace: THEME.fontBody, align: 'center' } },
    ]);
  });

  slide.addTable(tableRows, {
    x: 0.8,
    y: 2.1,
    w: 12.533,
    colW: [5.6, 2.3, 2.3, 2.3],
    fontSize: 12,
    border: { type: 'solid', color: THEME.colors.line, pt: 1 },
    fill: 'FFFFFF',
  });

  slide.addText('Legend: green = favorable, amber = trade-off, red = risk', {
    x: 0.8,
    y: 6.65,
    w: 12.533,
    h: 0.3,
    fontFace: THEME.fontBody,
    fontSize: 11,
    color: THEME.colors.muted,
  });

  slide.addNotes(
    [
      'This table summarizes the trade-offs we discussed.',
      'Option A and C score well on mapping risk and syndication alignment, while Option B is weaker due to the criteria translation and long-term reuse concerns.',
      'Option B can appear faster for email MVP but creates more downstream complexity when adding push and when aligning to syndication requirements.',
    ].join('\n')
  );
}

// 10) Key Challenges
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Key Challenges');

  addSectionTitle(slide, 'Key Challenges', 'What must be solved regardless of option');

  const challenges = [
    { title: 'Criteria schema & normalization', body: 'Canonical representation; versioning; avoid drift across systems.', icon: ICONS.scale },
    { title: 'Scale + state management', body: 'Dedup, cursoring, and “already notified” state for millions of saved searches.', icon: ICONS.search },
    { title: 'Throttling / digest', body: 'Per-user limits, batching, quiet hours, and frequency controls.', icon: ICONS.bell },
    { title: 'Stale / invalid searches', body: 'Lifecycle of searches; suppression rules; clean-up processes.', icon: ICONS.search },
    { title: 'Elastic / index load', body: 'Manage query volume to avoid load spikes (e.g., Trestle Elastic impacts).', icon: ICONS.scale },
    { title: 'Deliverability & compliance', body: 'Unsubscribe, complaints, template governance, and sender reputation.', icon: ICONS.email },
  ];

  const startX = 0.8;
  const startY = 2.05;
  const cw = 4.0;
  const ch = 1.45;
  const xGap = 0.45;
  const yGap = 0.35;

  challenges.forEach((c, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    addCard(slide, {
      x: startX + col * (cw + xGap),
      y: startY + row * (ch + yGap),
      w: cw,
      h: ch,
      title: c.title,
      body: c.body,
      iconDataUri: c.icon,
    });
  });

  slide.addNotes(
    [
      'These challenges apply no matter which option is chosen.',
      'The largest technical risks are criteria/schema consistency and operating at scale (state, dedup, batching) without overloading search infrastructure.',
      'On the delivery side, we must treat this as a mature notification program with deliverability and compliance baked in.',
    ].join('\n')
  );
}

// 11) Current Direction + Next Steps
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Current Direction');

  addSectionTitle(slide, 'Current Direction', 'Option A leaning; focus on a stable match event + notify layer');

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 2.1,
    w: 12.533,
    h: 1.2,
    fill: { color: 'EAF2FF' },
    line: { color: 'BFDBFE' },
    radius: 14,
  });
  slide.addText('Recommendation', {
    x: 1.1,
    y: 2.25,
    w: 3.0,
    h: 0.4,
    fontFace: THEME.fontHead,
    fontSize: 16,
    bold: true,
    color: THEME.colors.accent,
  });
  slide.addText('Proceed with Option A as the target architecture; keep Option C as an email delivery contingency.', {
    x: 3.3,
    y: 2.25,
    w: 9.8,
    h: 0.4,
    fontFace: THEME.fontBody,
    fontSize: 14,
    color: THEME.colors.text,
  });
  slide.addText('Rationale: minimizes mapping risk, aligns with syndication, and scales cleanly to push.', {
    x: 3.3,
    y: 2.65,
    w: 9.8,
    h: 0.35,
    fontFace: THEME.fontBody,
    fontSize: 12,
    color: THEME.colors.muted,
  });

  // Two-column: why A / why not B
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 3.55, w: 6.1, h: 3.0, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 12 });
  slide.addText('Why Option A aligns', { x: 1.1, y: 3.75, w: 5.6, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text });
  addBullets(slide, ['Syndication-first criteria model', 'Match events reusable by multiple channels', 'Avoid duplicated criteria logic'], { x: 1.1, y: 4.15, w: 5.6, h: 1.2 });
  slide.addText('Immediate next steps', { x: 1.1, y: 5.3, w: 5.6, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text });
  addBullets(slide, ['Agree on canonical match event schema', 'Define digest + throttling policy', 'Identify MVP cohort and rollout controls'], { x: 1.1, y: 5.7, w: 5.6, h: 0.8 });

  slide.addShape(pptx.ShapeType.roundRect, { x: 7.233, y: 3.55, w: 6.1, h: 3.0, fill: { color: 'FFFFFF' }, line: { color: THEME.colors.line }, radius: 12 });
  slide.addText('Why Option B is blocked', { x: 7.533, y: 3.75, w: 5.6, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text });
  addBullets(slide, ['Syndication misalignment', 'High criteria mapping + long-term maintenance', 'Email-centric design makes push harder'], { x: 7.533, y: 4.15, w: 5.6, h: 1.2 });
  slide.addText('Decision checkpoints', { x: 7.533, y: 5.3, w: 5.6, h: 0.35, fontFace: THEME.fontHead, fontSize: 14, bold: true, color: THEME.colors.text });
  addBullets(slide, ['OneHome eventing feasibility + timeline', 'Matrix SMTP suitability (if Option C needed)', 'Elastic load test thresholds'], { x: 7.533, y: 5.7, w: 5.6, h: 0.8 });

  slide.addNotes(
    [
      'This slide captures the meeting outcome: we are leaning Option A as the target architecture.',
      'Option B is considered blocked because it does not align to syndication goals and introduces a large criteria translation surface area.',
      'We also listed concrete next steps and decision checkpoints so the team can move from conceptual alignment to execution planning.',
    ].join('\n')
  );
}

// 12) Phased Plan + Success Metrics
{
  const slide = pptx.addSlide();
  slide.background = { color: THEME.colors.bg };
  addHeader(slide, 'Phased Plan');

  addSectionTitle(slide, 'Phased Plan + Success Metrics', 'Deliver incrementally while proving scale + value');

  // Timeline
  const x = 0.8;
  const y = 2.1;

  slide.addShape(pptx.ShapeType.line, { x, y: y + 0.55, w: 12.533, h: 0, line: { color: THEME.colors.line, width: 3 } });

  const phases = [
    { name: 'Phase 0 — Align', when: '2–3 wks', body: 'Event schema + ownership\nLoad test plan\nMVP cohort definition', color: 'EAF2FF' },
    { name: 'Phase 1 — MVP Email', when: '6–8 wks', body: 'Match events\nDigest + throttling\nEmail templates + tracking', color: 'ECFDF5' },
    { name: 'Phase 2 — Expand', when: '8–12 wks', body: 'Push notifications\nSyndication surfaces\nAdvanced preferences', color: 'FFF7ED' },
  ];

  phases.forEach((p, i) => {
    const px = x + i * 4.2;
    slide.addShape(pptx.ShapeType.ellipse, { x: px + 0.15, y: y + 0.42, w: 0.25, h: 0.25, fill: { color: THEME.colors.accent }, line: { color: THEME.colors.accent } });
    slide.addShape(pptx.ShapeType.roundRect, { x: px, y: y + 0.8, w: 3.95, h: 1.55, fill: { color: p.color }, line: { color: THEME.colors.line }, radius: 12 });
    slide.addText(p.name, { x: px + 0.25, y: y + 0.95, w: 3.45, h: 0.3, fontFace: THEME.fontHead, fontSize: 13, bold: true, color: THEME.colors.text });
    slide.addText(p.when, { x: px + 0.25, y: y + 1.25, w: 3.45, h: 0.25, fontFace: THEME.fontBody, fontSize: 11, color: THEME.colors.muted });
    slide.addText(p.body, { x: px + 0.25, y: y + 1.52, w: 3.45, h: 0.75, fontFace: THEME.fontBody, fontSize: 11, color: THEME.colors.text });
  });

  // Metrics cards
  slide.addText('Success metrics (examples)', {
    x: 0.8,
    y: 4.95,
    w: 12.533,
    h: 0.35,
    fontFace: THEME.fontHead,
    fontSize: 14,
    bold: true,
    color: THEME.colors.text,
  });

  const metrics = [
    { title: 'Delivery', body: '≥ 99% send success\nBounce/complaints within thresholds', icon: ICONS.email },
    { title: 'Engagement', body: 'CTR uplift\nReturn sessions from notifications', icon: ICONS.bell },
    { title: 'Latency', body: 'Match → notify within target\nPredictable batch windows', icon: ICONS.scale },
    { title: 'Cost / load', body: 'Elastic/query load stays within SLO\nStable ops burden', icon: ICONS.search },
  ];

  metrics.forEach((m, i) => {
    addCard(slide, {
      x: 0.8 + i * (3.05 + 0.25),
      y: 5.35,
      w: 3.05,
      h: 1.4,
      title: m.title,
      body: m.body,
      iconDataUri: m.icon,
    });
  });

  slide.addNotes(
    [
      'We closed with a phased plan to deliver value early while validating performance at scale.',
      'Phase 0 focuses on alignment and the contract (event schema + ownership). Phase 1 ships an email MVP with digest/throttling. Phase 2 expands to push and broader syndication surfaces.',
      'Success metrics ensure we measure deliverability, engagement, latency, and platform cost—not just “emails sent.”',
    ].join('\n')
  );
}

// ----------------------------
// Write output
// ----------------------------
(async () => {
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await pptx.writeFile({ fileName: OUTPUT_PATH });

  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`PPTX was not created at: ${OUTPUT_PATH}`);
  }

  const stat = fs.statSync(OUTPUT_PATH);
  console.log(`Created: ${OUTPUT_PATH}`);
  console.log(`Size: ${Math.round(stat.size / 1024)} KB`);
})();
