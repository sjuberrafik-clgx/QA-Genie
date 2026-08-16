# Glass MCP

Glass is a local stdio MCP server for deterministic browser automation. It exposes nine composable verbs instead of a large selector-oriented tool catalog:

| Verb | Purpose |
|---|---|
| `open` | Navigate, inspect, and manage tabs |
| `see` | Return ranked affordances with durable handles |
| `do` | Act on a target and return an effect receipt |
| `read` | Extract assertion-ready page content |
| `wait` | Wait for bounded page conditions |
| `net` | Record, await, mock, or disable network traffic |
| `devtool` | Call Chrome DevTools Protocol methods |
| `script` | Run audited JavaScript in the page |
| `sense` | Infer app intent, rank the happy path, and judge outcomes (opt-in cognition) |

## Requirements

- Node.js 20 or newer
- Playwright 1.58.2 and its Chromium browser for browser operations

```powershell
cd glass-mcp
npm install
npx playwright install chromium
```

## Run

```powershell
npm start
```

Use the direct CDP driver instead of the default Playwright driver:

```powershell
$env:GLASS_DRIVER = 'cdp'
npm start
```

The server communicates through newline-delimited JSON-RPC on stdin/stdout. Operational messages are written to stderr so stdout remains a valid MCP channel.

## Protocol Support

Glass uses `@modelcontextprotocol/server` v2 and supports both protocol eras from the same stdio entry:

- MCP `2026-07-28`: `server/discover`, per-request metadata, structured results, cacheable tool discovery, cancellation, progress, and W3C Trace Context.
- Initialization-based clients: served through the SDK's legacy stdio compatibility path.

Every tool advertises JSON Schema 2020-12 input and output schemas. Successful and recoverable failure results are returned as both a JSON text block and `structuredContent`. Recoverable failures include a stable `code`; unknown tools and protocol failures remain JSON-RPC errors.

Screenshot calls with `returnData: true` return native MCP `image` content and compact metadata in `structuredContent`. File-backed screenshots continue to return a local path.

## Video Evidence

Glass can record the active tab without closing it. Recording stays inside the existing `do` verb:

```json
{"action":"videoStart","path":"C:\\evidence\\AOTF-18537.mp4","fps":10,"quality":80,"tab":"t1"}
```

```json
{"action":"videoStatus","tab":"t1"}
```

```json
{"action":"videoStop","tab":"t1"}
```

`videoStop` finalizes the MP4 or WebM and returns its absolute path, byte size, duration, and frame counts. The tab remains open and usable. Closing a recorded tab or stopping the server also finalizes its recording, but an explicit `videoStop` is preferred because it returns the artifact receipt directly.

Recording captures the browser tab viewport only and does not include audio or operating-system UI. Glass uses the bundled `ffmpeg-static` binary by default; set `GLASS_FFMPEG_PATH` to use a managed FFmpeg installation instead. Each tab can own one active recording.

### Direct CDP Driver

The raw driver uses one browser WebSocket with flattened target sessions. At startup it calls `Browser.getVersion` and reduces Chromium's `/json/protocol` response to an internal catalog of supported domain, command, event, and type names. The complete schema is not returned to the model.

- `devtool({ list: true })` returns compact runtime capability counts and domain names.
- Unsupported methods are rejected locally before a CDP round trip.
- `devtool` automatically routes browser domains such as `Browser` and `Target` to the root session; `scope: "page"|"browser"` can override routing.
- Navigation distinguishes `commit`, `domcontentloaded`, `load`, and `networkidle`. Timeouts fail rather than returning soft success.
- `networkidle` uses per-page inflight request accounting plus a 500 ms quiet window. WebSocket and EventSource connections do not keep the page permanently busy.
- Network recording and Fetch mocks are owned per tab, and completed request metadata is discarded.
- The affordance extractor and handle resolver install once per main-document epoch. Repeated calls use compact expressions, while cross-document navigation invalidates the cache automatically.
- Cross-origin iframe targets are discovered with a narrow `iframe` filter and recursively auto-attached over the same flattened browser connection. Chromium builds without filtered target attachment degrade to the existing top-document path instead of failing startup.
- `see` perceives the top document and attached OOPIF sessions concurrently, then scores and packs them once under the caller's existing element and token budgets. No protocol schema, frame tree, or extra MCP tool is exposed to the model.
- OOPIF pointer actions use frame-local coordinates. Before mutation, Glass maps the action point through every parent frame content quad and performs a live parent hit test; hidden, detached, or covered frame hosts fail closed.

## Tabs and Handles

Browser-facing verbs accept an optional `tab` argument containing an ID returned by `open({ action: "tabs" })`. Without it, Glass captures the active tab at the start of the call. Later tab switches cannot redirect an in-flight operation.

Handles emitted by `see` are bound to their originating tab. Passing a handle to another tab returns `GLASS_CROSS_TAB_HANDLE`.

New handles use version 3 and bind element identity to:

- the originating tab;
- the top-document epoch;
- a frame-local document token;
- a compact OOPIF target token when the owning document is in another renderer process.

Same-origin iframe handles carry a stable frame-selector chain and resolve inside that document. Cross-origin and nested OOPIF handles route to their owning CDP session. If the top page or frame navigates, the frame detaches, or the target no longer belongs to the tab, the old handle is rejected with `GLASS_STALE_DOCUMENT_HANDLE` or a frame-specific failure code. Covered OOPIF actions return `GLASS_FRAME_OCCLUDED` without mutating the child document.

Version 1 and version 2 handles remain decodable and retain their previous behavior.

Each tab owns an independent perception baseline, so switching tabs does not reset or contaminate novelty scoring. Mutating calls are serialized per tab; read-only calls may run concurrently.

## Bounded Concurrency

The direct CDP driver supports concurrent scenario lanes without adding another MCP tool. The existing `open` verb creates lanes:

```json
{"action":"fork","sourceTab":"t1","isolation":"shared","scenario":"same-user-search"}
```

```json
{"action":"fork","sourceTab":"t1","isolation":"context","scenario":"guest-search"}
```

- `shared` creates a tab in the source browser context. Cookies, local storage, service workers, and identity are shared intentionally.
- `context` creates an incognito-like CDP browser context. Glass copies cookies plus the source origin's local/session storage internally, then navigates the fork. Receipts contain only copied-item counts, never values.
- IndexedDB, Cache Storage, and service-worker state are not checkpointed. Applications that keep authentication there must log in within the isolated lane.
- Closing the last tab in an isolated context disposes that context and all of its targets.

`open`, `see`, `do`, `read`, and `wait` accept an optional `items` array. Items execute with bounded concurrency and return all-settled results in input order. Same-tab mutations and `see` baseline commits remain FIFO; independent tabs may overlap. A browser-scoped `devtool` call acts as an exclusive barrier.

```json
{
	"items": [
		{"tab":"t2","what":"title"},
		{"tab":"t3","what":"url"}
	]
}
```

Static limits are controlled with:

- `GLASS_CONCURRENCY_ENABLED=true`
- `GLASS_MAX_LANES=2`
- `GLASS_MAX_CONTEXTS=2`
- `GLASS_DEFAULT_ISOLATION=shared`

Queued calls observe MCP cancellation and never execute after cancellation. Scheduler timing is included under `audit.scheduler` with operation ID, operation class, queue time, and execution time.

## Exploration Failures

Recoverable browser failures use compact stable codes instead of raw Playwright call logs:

- `GLASS_TARGET_NOT_FOUND` means the requested element identity did not resolve.
- `GLASS_ACTION_TIMEOUT` means the element resolved but could not become actionable before the bound.
- `GLASS_WAIT_TIMEOUT` means the requested application condition never became true; it is not a transport failure.

Failed receipts include a query-free page route and title. When the browser is on a login route, `diagnostic.authRequired` explains that authentication must be restored before selector retries. A `networkidle` timeout on a live map or polling application includes guidance to use `domcontentloaded` plus a visible page-specific target.

URL waits report `matchedImmediately: true` with a warning when the predicate was already true at call start. After login or navigation, use a destination-specific path or an authenticated-only element rather than matching only the domain.

Placeholder-only fields carry a stable placeholder fingerprint, and descriptor resolution prefers visible matches when responsive duplicates exist. Click effect receipts include a bounded hash of form and ARIA state, so selections that change values, checked state, or expanded state are not misreported as no-ops; raw values never leave the page.

## Cancellation and Observability

Glass observes the MCP request abort signal before execution, while waiting in a mutation queue, and while the handler is active. A cancelled queued mutation is never executed. Playwright operations already in native browser execution may take a short time to settle after the MCP call is cancelled.

When supplied by the client, `traceparent`, `tracestate`, and `baggage` are copied into the result audit. `open`, `see`, `wait`, and `net` emit request-scoped progress notifications when a progress token is present.

## Cognition (opt-in)

Glass can reason about an unfamiliar application the way a person does — without any test cases, expected results, or pre-configured assertions — by recognising the business patterns that recur across the web. Cognition is a deterministic, zero-token layer (System 1); the host model is the optional deliberative critic (System 2), reached only when confidence is low. It is off by default: core `see`/`do` receipts are byte-identical unless you opt in.

Three questions, mapped to three capabilities:

- **Intent** — what kind of app is this, and where am I in its flow? Archetypes (e-commerce, B2B SaaS, fintech, CRM, auth, content, search) are inferred from URL, page text, and the affordance mix.
- **Plan** — which affordances advance the happy path versus which are edge cases or error loops? The next state is predicted as a runtime expectation (predict-then-verify), which replaces human-authored expected results.
- **Verdict** — did the last action succeed, error, or get blocked? A weighted fusion of URL deltas, new status/alert copy, HTTP status, console errors, form resets, infinite loaders, and journey-level loop/dead-end detection yields `success | error | blocked | neutral` with an evidence trail.

The `sense` verb (no mutation):

```jsonc
sense({ mode: "intent" | "plan" | "verdict" | "full", expect?: object })
```

Opt-in enrichment on the core verbs:

```jsonc
see({ allow: ["intuition"] })                 // appends { intuition: { intent, happyPath, edgeCases, nextExpectation } }
do({ target, action, allow: ["verdict"] })    // appends { verdict: { state, confidence, evidence[] } }
```

Guarantees: zero-config (universal archetypes ship in-tree), deterministic (the same observation yields byte-identical cognition), standalone (the kernel under `src/cognition/` has no browser or workspace dependency and can be reused directly), and driver-neutral (identical behaviour on the Playwright and raw-CDP drivers). No API keys are required; when System-1 confidence is low, a compact `deliberationRequest` is emitted for the host to reason over. An embedder may supply their own `CognitiveCritic` to answer it in-process.

## Intentional Non-Goals

Version 0.2 remains local and stdio-only. It does not expose Streamable HTTP, OAuth, Tasks, MCP Apps, resources, prompts, roots, sampling, elicitation, or MCP logging. These features should be added only when a concrete Glass workflow requires them. Live authenticated page state is intentionally not exposed as a cacheable resource.

## Test

```powershell
npm test
```

The suite covers pure handle/perception behavior, the deterministic cognition kernel (intent, happy-path, verdict, world-model), browser verbs, raw CDP capability and lifecycle semantics, tab isolation, document-bound stale-handle rejection, same-origin iframe routing, direct and nested OOPIF routing, covered-frame rejection, mutation serialization, a literal initialization-based wire exchange, and an official v2 client negotiating MCP `2026-07-28`.