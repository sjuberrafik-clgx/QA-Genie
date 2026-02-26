# Knowledge Base Connector System

## Overview

The Knowledge Base (KB) Connector integrates external documentation sources — **Confluence**, **Notion**, **SharePoint**, and **custom REST APIs** — into the agentic workflow's grounding pipeline. This gives agents real-time access to project documentation, business rules, acceptance criteria, architecture decisions, and domain knowledge without relying solely on local codebase context.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Session                                │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ GroundingStore │  │ Custom Tools │  │ AgentSessionFactory       │ │
│  │  .buildKBContext() │  │  search_knowledge_base    │  │  KB context auto-inject │ │
│  │  .queryKnowledgeBase()│  │  get_knowledge_base_page │  │                          │ │
│  └───────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
│          │                 │                      │             │
│  ┌───────▼─────────────────▼──────────────────────▼───────────┐ │
│  │               KnowledgeBaseConnector                        │ │
│  │  .query()     → hybrid fetch (cache → live → cache result)  │ │
│  │  .queryForAgent() → agent-specific boost terms              │ │
│  │  .buildKBContext() → formatted string for system prompt     │ │
│  │  .syncPages()  → pre-index specific pages/spaces            │ │
│  └──────┬──────────────┬───────────────┬──────────────────────┘ │
│         │              │               │                        │
│  ┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐                │
│  │IntentDetector│ │  KBCache   │ │ Providers  │                │
│  │ domainTerms  │ │ BM25 local │ │ Confluence │                │
│  │ triggerTerms  │ │ TTL/LRU   │ │ Notion     │                │
│  │ confidence    │ │ JSON perst │ │ SharePoint │                │
│  └──────────────┘ └────────────┘ │ Custom     │                │
│                                  └────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Configure Credentials

In `agentic-workflow/.env`:

```bash
# Confluence (reuses Jira credentials)
CONFLUENCE_BASE_URL=https://your-org.atlassian.net/wiki
CONFLUENCE_SPACE_KEYS=PROJ,DOCS          # Optional: restrict to specific spaces
KB_ENABLED=true
```

### 2. Add Provider Config

In `agentic-workflow/config/grounding-config.json`, the `knowledgeBase` section is pre-configured:

```json
{
    "knowledgeBase": {
        "enabled": true,
        "providers": [{
            "type": "confluence",
            "name": "My Confluence",
            "enabled": true,
            "baseUrl": "",
            "spaceKeys": [],
            "labels": [],
            "ancestorPageIds": []
        }]
    }
}
```

### 3. Test Connection

```bash
node agentic-workflow/scripts/kb-setup.js validate
node agentic-workflow/scripts/kb-setup.js init
```

### 4. Query

```bash
node agentic-workflow/scripts/kb-setup.js query "property search filters"
```

## How It Works

### Hybrid Fetch Model

1. **Intent Detection** — Analyzes the query to determine if KB content is relevant (domain terms, trigger words, question patterns)
2. **Cache Check** — BM25 search over locally cached pages (sub-millisecond)
3. **Live Fallback** — If cache misses or is stale, queries the live API
4. **Cache Update** — New results are cached for future queries

### Automatic Context Injection

When agents start, the system:
1. Initializes KB connector in `AgentSessionFactory` constructor (non-blocking)
2. On `createAgentSession()`, fetches KB context for the task description
3. Injects KB content as **Section 7: KNOWLEDGE BASE** in the grounding context
4. Budget: 4000 chars for KB (configurable), 8000 chars for code grounding

### On-Demand Tool Access

Agents can also query KB explicitly via SDK tools:
- **`search_knowledge_base`** — Search across all providers
- **`get_knowledge_base_page`** — Fetch full page content by ID

## Configuration Reference

### grounding-config.json → knowledgeBase

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Master toggle |
| `providers` | array | `[]` | Provider configurations |
| `cache.ttlMinutes` | number | `30` | Cache freshness TTL |
| `cache.maxEntries` | number | `200` | Max cached pages (LRU eviction) |
| `intentDetection.confidenceThreshold` | number | `0.3` | Min score to trigger KB fetch |
| `intentDetection.domainTerms` | string[] | `[]` | Project-specific terms |
| `intentDetection.triggerTerms` | string[] | `[]` | Knowledge-seeking indicators |
| `retrieval.maxResults` | number | `10` | Max results per query |
| `retrieval.maxContentChars` | number | `4000` | KB char budget in context |
| `retrieval.includeChildPages` | boolean | `true` | Fetch child pages |
| `retrieval.childPageDepth` | number | `2` | Page tree traversal depth |
| `sync.autoSyncOnStart` | boolean | `false` | Pre-fetch on pipeline start |
| `sync.syncPageIds` | string[] | `[]` | Pages to pre-sync |

### workflow-config.json → sdk.grounding.knowledgeBase

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable KB in agent sessions |
| `maxContextChars` | number | `4000` | KB context budget |
| `autoInitOnStart` | boolean | `true` | Init KB with grounding store |
| `fallbackToLocalOnly` | boolean | `true` | Continue without KB on failure |

### Environment Variables (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `KB_ENABLED` | No | Master toggle (overrides config) |
| `CONFLUENCE_BASE_URL` | For Confluence | e.g., `https://org.atlassian.net/wiki` |
| `CONFLUENCE_SPACE_KEYS` | No | Comma-separated space keys |
| `CONFLUENCE_CACHE_TTL_MINUTES` | No | Override cache TTL |
| `CONFLUENCE_MAX_PAGES` | No | Max pages per sync |
| `CONFLUENCE_PAGE_TREE_DEPTH` | No | Tree traversal depth |
| `JIRA_EMAIL` | For Confluence | Reused from Jira config |
| `JIRA_API_TOKEN` | For Confluence | Reused from Jira config |

## Adding New Providers

### Using a Built-in Provider (Notion/SharePoint)

1. Install the dependency:
   ```bash
   # Notion
   npm install @notionhq/client
   # SharePoint — uses axios (already installed)
   ```

2. Set credentials in `.env`:
   ```bash
   # Notion
   NOTION_API_KEY=ntn_xxxxx
   NOTION_DATABASE_IDS=db1,db2
   
   # SharePoint
   SHAREPOINT_TENANT_ID=...
   SHAREPOINT_CLIENT_ID=...
   SHAREPOINT_CLIENT_SECRET=...
   SHAREPOINT_SITE_ID=...
   ```

3. Add provider in `grounding-config.json`:
   ```json
   {
       "providers": [
           { "type": "notion", "name": "My Notion", "enabled": true }
       ]
   }
   ```

### Creating a Custom Provider

1. Add provider config with endpoint mapping:
   ```json
   {
       "type": "custom",
       "name": "Internal Wiki",
       "baseUrl": "https://wiki.internal.com/api",
       "auth": { "type": "bearer", "tokenEnvVar": "WIKI_TOKEN" },
       "endpoints": {
           "search": { "path": "/search", "queryParam": "q" },
           "getPage": { "path": "/pages/{id}" }
       },
       "responseMapping": {
           "search": {
               "resultsPath": "data.results",
               "id": "id", "title": "name", "content": "body"
           }
       }
   }
   ```

2. Or extend `KBProvider` class:
   ```javascript
   const { KBProvider } = require('../knowledge-base/kb-provider');
   
   class MyProvider extends KBProvider {
       async search(query, options) { /* ... */ }
       async getPage(pageId) { /* ... */ }
       async testConnection() { /* ... */ }
   }
   ```

## CLI Reference

```bash
# Initialize and test connections
node agentic-workflow/scripts/kb-setup.js init

# Pre-sync pages into cache
node agentic-workflow/scripts/kb-setup.js sync

# Search the KB
node agentic-workflow/scripts/kb-setup.js query "search panel filters"

# Show statistics
node agentic-workflow/scripts/kb-setup.js stats

# Clear cache
node agentic-workflow/scripts/kb-setup.js clear

# Validate config and credentials
node agentic-workflow/scripts/kb-setup.js validate

# List available spaces
node agentic-workflow/scripts/kb-setup.js spaces
```

## File Structure

```
agentic-workflow/
├── knowledge-base/
│   ├── kb-provider.js          # Abstract base class + shared utilities
│   ├── confluence-provider.js  # Confluence REST API v1 implementation
│   ├── kb-cache.js             # Local BM25-indexed cache with TTL/LRU
│   ├── intent-detector.js      # Deterministic query intent analysis
│   ├── kb-connector.js         # Main orchestrator + singleton
│   ├── notion-provider.js      # Notion API skeleton
│   ├── sharepoint-provider.js  # SharePoint Graph API skeleton
│   └── custom-provider.js      # Generic REST API provider
├── knowledge-base-data/
│   └── kb-cache.json           # Persisted cache (auto-generated, gitignored)
├── config/
│   ├── grounding-config.json   # knowledgeBase section
│   └── grounding-config.schema.json  # JSON Schema for knowledgeBase
├── scripts/
│   └── kb-setup.js             # CLI management tool
└── .env                        # KB credentials (section 11)
```

## How Teams Adopt This

Since the KB connector is **config-driven**, any team can use it by:

1. Forking the repo or using it as a template
2. Editing `grounding-config.json → knowledgeBase.providers` with their KB details
3. Setting credentials in `.env`
4. Customizing `intentDetection.domainTerms` with their project vocabulary

No code changes needed — the provider system reads everything from config.
