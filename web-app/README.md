# QA Automation Dashboard + AI Chat

A Next.js web application powered by the GitHub Copilot SDK and the existing SDK orchestrator backend.

## Architecture

```
┌──────────────────────┐       ┌──────────────────────────┐
│  Next.js (port 3001) │ HTTP  │  SDK Server (port 3100)  │
│  React 19 / App Rtr  │ ───►  │  Node.js + Copilot SDK   │
│  Tailwind CSS 3      │ SSE◄  │  Pipeline + Chat routes   │
└──────────────────────┘       └──────────────────────────┘
```

- **Dashboard** — Launch & monitor QA pipelines (test-only, script-only, full)
- **Chat** — AI assistant powered by Copilot SDK with QA-domain tools
- **My Agents** — User-created agents published from isolated Studio workspaces
- **Studio** — Workspace-based agent, skill, file, and MCP authoring surface
- **Results** — Pipeline run history with filters and stage drill-down
- **Analytics** — Pass rates, failure trends, selector stability

## Prerequisites

- Node.js 18+  
- `GITHUB_TOKEN` with Copilot access (set in `agentic-workflow/.env`)  
- Backend dependencies already installed (`agentic-workflow/sdk-orchestrator/`)

## Quick Start

```bash
# 1. Install frontend dependencies
cd web-app
npm install

# 2. Ensure backend .env is configured
#    Copy agentic-workflow/.env.example → agentic-workflow/.env
#    Set GITHUB_TOKEN and other required values

# 3. Start both servers (frontend + backend)
npm run dev:full

# Or start individually:
npm run dev           # Next.js only (port 3001)
npm run dev:backend   # SDK server only (port 3100)
```

Open **http://localhost:3001** in your browser.

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server (port 3001) |
| `npm run verify:nav-routes` | Verify that every sidebar route has a matching `src/app/**/page.*` file |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run dev:backend` | Start SDK orchestrator server (port 3100) |
| `npm run dev:full` | Start both servers concurrently |

## Troubleshooting

### `/my-agents` or `/studio` shows the app 404 page

This is usually a **missing route file / stale branch** problem, not a backend outage. The sidebar links are defined in `src/lib/navigation.js`, so those links can still appear even when the corresponding route files are missing from a clone.

Check that these files exist in your branch:

- `src/app/my-agents/page.js`
- `src/app/studio/page.js`

Then run:

```bash
npm run verify:nav-routes
```

If that command fails, pull the branch that contains the route implementation or restore the missing page files before testing again.

### Page loads but shows backend/API errors

That is a different failure mode. The Studio and My Agents pages depend on the SDK orchestrator backend, so start the frontend and backend together with `npm run dev:full`. If the backend is down, the UI should surface fetch/API errors rather than a Next.js 404 page.

### Hydration warning mentioning `cz-shortcut-listen`

That usually comes from a browser extension or local environment tool mutating the page before React hydrates. Re-test in a clean browser profile or disable extensions before treating it as an app defect.

## Project Structure

```
web-app/
├── src/
│   ├── app/
│   │   ├── layout.js          # Root layout (sidebar nav)
│   │   ├── page.js            # Redirect → /dashboard
│   │   ├── globals.css        # Tailwind + chat styles
│   │   ├── dashboard/page.js  # Pipeline launcher + monitor
│   │   ├── chat/page.js       # AI chat interface
│   │   ├── results/page.js    # Run history + filters
│   │   └── analytics/page.js  # Charts + stats
│   ├── components/
│   │   ├── ChatMessage.js     # Chat bubble with markdown
│   │   ├── ChatInput.js       # Message input bar
│   │   ├── SessionList.js     # Chat session sidebar
│   │   ├── StageProgress.js   # Pipeline stage cards
│   │   ├── PipelineCard.js    # Run summary card
│   │   └── ToolCallCard.js    # Tool call display
│   ├── hooks/
│   │   ├── useSSE.js          # EventSource with reconnect
│   │   └── usePipeline.js     # Pipeline state management
│   └── lib/
│       ├── api-client.js      # HTTP client for backend
│       └── api-config.js      # Endpoint URLs
├── package.json
├── next.config.js             # API proxy rewrites
├── tailwind.config.js
└── jsconfig.json              # Path aliases
```

## Backend API Endpoints

Proxied through Next.js rewrites at `/api/backend/*` → `localhost:3100/api/*`:

### Pipeline
- `POST /api/pipeline/run` — Start pipeline
- `GET  /api/pipeline/stream/:runId` — SSE events
- `POST /api/pipeline/cancel/:runId` — Cancel run
- `GET  /api/pipeline/runs` — List runs

### Chat
- `POST /api/chat/sessions` — Create session
- `GET  /api/chat/sessions` — List sessions
- `POST /api/chat/sessions/:id/messages` — Send message
- `GET  /api/chat/sessions/:id/stream` — SSE stream
- `GET  /api/chat/sessions/:id/history` — Get history
- `POST /api/chat/sessions/:id/abort` — Abort response
- `DELETE /api/chat/sessions/:id` — Delete session

### Analytics
- `GET /api/analytics/overview` — Summary stats
- `GET /api/analytics/failures` — Failure trends
- `GET /api/analytics/selectors` — Selector stability
