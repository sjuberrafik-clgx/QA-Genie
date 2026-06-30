/**
 * One-off generator: Cotality patent-idea table → Excel (.xlsx)
 * Single consolidated umbrella row. Uses ExcelJS (existing dependency).
 */
const path = require('path');
const ExcelJS = require('exceljs');

const OUTPUT = path.resolve(__dirname, '..', '..', 'Cotality-Patent-Idea.xlsx');

const COLUMNS = [
  { header: 'Account', key: 'account', width: 14 },
  { header: 'Patent Idea', key: 'idea', width: 40 },
  { header: 'Problem Statement', key: 'problem', width: 40 },
  { header: 'Core Innovation', key: 'innovation', width: 60 },
  { header: 'AI Techniques', key: 'ai', width: 40 },
  { header: 'BFS Use Cases', key: 'bfs', width: 40 },
  { header: 'Implementation Approach', key: 'impl', width: 50 },
  { header: 'Tech Stack', key: 'stack', width: 60 },
];

const ROW = {
  account: 'Cotality',
  idea:
    'Governed No-Code Agentic Platform ("Agent Operating System") with In-Browser Agent/Skill Authoring, ' +
    'Capability-Scoped Access Control, and a Provenance-Verified Cognitive Context Engine — QA Automation as ' +
    'Flagship Application',
  problem:
    'Enterprises need domain-specific AI agents but have no safe, governed, no-code way to build, scope, and ' +
    'orchestrate them. General LLM agents hallucinate, over-reach on tools/data, cannot prove they had ' +
    'sufficient context, demand engineering effort to create, and leave no audit trail — unacceptable for ' +
    'regulated use.',
  innovation:
    'A single web platform unifying four layers: ' +
    '(a) Agent Studio — in-browser, no-code authoring of custom agents, auto-invoked skills, MCP servers, and ' +
    'files, with one-shot AI "Generate with AI" scaffolding, isolated workspaces with runtime separation, and ' +
    'publish-to-chat. ' +
    '(b) Capability-scoped governance — declarative per-agent capability profiles, fine-grained tool ' +
    'categories, filesystem read/write scoping, browser gateway (dry-run delegated), cross-agent tool broker, ' +
    'model selection, and federated MCP-server selection that define exactly what each agent can and cannot ' +
    'access (least privilege, un-bypassable enforcement). ' +
    '(c) A deterministic Cognitive Context Engine — lossless multi-resolution code "DNA" compression, ' +
    'demand-driven focus-decay context allocation, provenance extraction/verification with hallucination-risk ' +
    'scoring, coverage telemetry, cross-run learning, and zero-LLM OODA quality gates. ' +
    '(d) A unified multi-MCP perception/action layer federating browser automation (Playwright + Chrome ' +
    'DevTools, 141 tools), Jira, Confluence, GitHub, Slack, and Notion. ' +
    'QA automation (test-case generation -> grounded script generation -> execution -> self-healing -> defect ' +
    'filing -> reporting) ships as the flagship reference application, while Studio lets users build agents for ' +
    'any function.',
  ai:
    'Multi-agent LLM orchestration (Claude / GPT / Copilot SDK via MCP); declarative manifest-driven agent ' +
    'composition; capability-based access control (least privilege); AI-assisted asset authoring (one-shot ' +
    'generation); deterministic semantic extraction; custom BM25/TF-IDF retrieval (no embeddings); focus-decay ' +
    'attention + knapsack optimization; provenance chain-of-custody + confidence fusion; deterministic intent ' +
    'classification; heuristic OODA scoring; online cross-run learning with hotspot/regression detection; ' +
    'agentic self-healing; predictive-prioritization-ready.',
  bfs:
    'Domain-agnostic. Within BFS: QA/regression for core-banking, payments & trading SPAs; auditable ' +
    'model-risk evidence (SR 11-7) for AI-assisted work; KYC/onboarding & embedded-iframe flows. Beyond QA, ' +
    'user-built Studio agents for documentation, release & team coordination, API testing, code review, ' +
    'summarization, podcast/briefing generation, and reporting — extensible to any regulated business function ' +
    'without code.',
  impl:
    'Next.js web app with Agent Studio (scaffold + AI-generate agents/skills/MCP-servers/files -> validate -> ' +
    'publish to chat) over a Node.js orchestration runtime; per-agent capability resolution + enforcement hooks ' +
    'govern tool/data/model scope; a federated MCP connection manager exposes built-in, community, and custom ' +
    'servers; a deterministic grounding/cognitive layer compiles code DNA, allocates context, verifies ' +
    'provenance, and learns across runs; flagship QA pipeline (PREFLIGHT -> TestGen -> ScriptGen -> Execute -> ' +
    'Self-Heal -> BugGen -> Report) streams real-time SSE/WebSocket telemetry to dashboards.',
  stack:
    'Runtime: Node.js 20+, JavaScript (CommonJS+ESM), TypeScript. ' +
    'Agent/LLM: GitHub Copilot SDK, Anthropic Claude + OpenAI GPT (BYOK, incl. GPT-5/GPT-4.1), Zod, Model ' +
    'Context Protocol (@modelcontextprotocol/sdk), manifest-driven (Markdown/JSON) agents & skills. ' +
    'Federated MCP servers: Unified Automation (Playwright + Chrome DevTools, 141 tools), Atlassian Jira, ' +
    'Atlassian Confluence, GitHub (REST/GraphQL), Slack, Notion. ' +
    'Automation: Playwright, @playwright/mcp, Chrome DevTools Protocol. ' +
    'Retrieval (no vector DB): custom BM25/TF-IDF, Porter stemmer, SHA-256. ' +
    'Data/Transport: SQLite session store, JSON document stores, node-pty, ws (WebSocket), native HTTP+SSE. ' +
    'Docs/Evidence: ExcelJS, docx, pdf-lib, pdf-parse, mammoth, pptxgenjs, adm-zip, sharp, pngjs, pixelmatch, ' +
    'ffmpeg (static/ffprobe/fluent). ' +
    'Dashboard: Next.js 15, React 19, Tailwind CSS, PostCSS, xterm.js, Mermaid, react-markdown + ' +
    'remark-gfm/remark-math/rehype-katex, react-syntax-highlighter, react-virtuoso, DOMPurify. ' +
    'Integrations: Jira & Confluence REST, KB connectors (Confluence/Notion/SharePoint), axios, Atlassian MCP. ' +
    'Reporting/Test: Allure, ortoni-report, Mocha, Chai. ' +
    'Tooling: dotenv, patch-package, cross-env, rimraf, concurrently, lodash, uuid. ' +
    'Extensible: Databricks, Snowflake, Power BI, XGBoost for fleet-scale predictive prioritization.',
};

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cotality';
  wb.created = new Date();
  const ws = wb.addWorksheet('Patent Idea', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = COLUMNS;

  // Header styling
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 28;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    };
  });

  // Data row
  const dataRow = ws.addRow(ROW);
  dataRow.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  dataRow.font = { size: 10 };
  dataRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
    };
  });
  // Emphasize the Account cell
  dataRow.getCell('account').font = { size: 11, bold: true, color: { argb: 'FF1F4E78' } };
  dataRow.getCell('account').alignment = { vertical: 'top', horizontal: 'center', wrapText: true };

  await wb.xlsx.writeFile(OUTPUT);
  console.log('Excel written to: ' + OUTPUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
