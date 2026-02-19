# QA Automation Dashboard + AI Chat

A Next.js web application powered by the GitHub Copilot SDK and the existing SDK orchestrator backend.

## Architecture

```
┌──────────────────────┐       ┌──────────────────────────┐
│  Next.js (port 3000) │ HTTP  │  SDK Server (port 3100)  │
│  React 19 / App Rtr  │ ───►  │  Node.js + Copilot SDK   │
│  Tailwind CSS 3      │ SSE◄  │  Pipeline + Chat routes   │
└──────────────────────┘       └──────────────────────────┘
```

- **Dashboard** — Launch & monitor QA pipelines (test-only, script-only, full)
- **Chat** — AI assistant powered by Copilot SDK with QA-domain tools
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
npm run dev           # Next.js only (port 3000)
npm run dev:backend   # SDK server only (port 3100)
```

Open **http://localhost:3000** in your browser.

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server (port 3000) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run dev:backend` | Start SDK orchestrator server (port 3100) |
| `npm run dev:full` | Start both servers concurrently |

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
