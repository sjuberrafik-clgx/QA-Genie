'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useSSE } from '@/hooks/useSSE';
import useModelCatalog from '@/hooks/useModelCatalog';
import useAgentCatalog from '@/hooks/useAgentCatalog';
import apiClient from '@/lib/api-client';
import { getDefaultModel, hasModelValue, isVisionModel } from '@/lib/model-options';
import { truncateTitle, LIMITS } from '@/lib/constants';
import ChatMessage from '@/components/ChatMessage';
import ChatInput from '@/components/ChatInput';
import SessionList from '@/components/SessionList';
import ModelSelect from '@/components/ModelSelect';
import AgentSelect from '@/components/AgentSelect';
import MyAgentsLauncher from '@/components/MyAgentsLauncher';
import { buildCoreAgentId, getAgentConfig } from '@/lib/agent-options';
import { DocumentIcon, CodeIcon, GlobeIcon, PlayIcon, SparkleIcon, MenuIcon, ChatBubbleIcon, WrenchIcon, CheckIcon, XIcon, FileIcon } from '@/components/Icons';
import DirectoryPicker from '@/components/DirectoryPicker';
import ErrorBanner from '@/components/ErrorBanner';
import FollowupChips from '@/components/FollowupChips';
import UserInputPrompt from '@/components/UserInputPrompt';
import ApprovalBatch, { isApprovalBatchCandidate } from '@/components/ApprovalBatch';
import ReasoningPanel from '@/components/ReasoningPanel';
import MemoryHud from '@/components/MemoryHud';
import ToolCallCard from '@/components/ToolCallCard';
import DelegationThread from '@/components/DelegationThread';
import RobotMascotLogo from '@/components/RobotMascotLogo';
import useResetScrollOnRouteChange from '@/hooks/useResetScrollOnRouteChange';
import { useMemoryGuard } from '@/hooks/useMemoryGuard';
import {
    normalizeUserInputRequestEvent,
    hydrateChatHistory,
    needsSessionResume,
    isSessionBooting,
    mergeSessionSnapshots,
    sortSessionsByRecency,
} from '@/lib/chat-helpers';

const AGENT_ICON_MAP = {
    tpm: SparkleIcon,
    document: DocumentIcon,
    docgenie: DocumentIcon,
    code: CodeIcon,
    bug: WrenchIcon,
    task: CheckIcon,
    file: FileIcon,
};

const AGENT_WELCOME_COPY = {
    'core:tpm': 'Run planning, test generation, automation, bugs, tasks, and file work from one mode.',
    testgenie: 'Build manual coverage and Excel-ready test steps from Jira context.',
    scriptgenerator: 'Create grounded Playwright automation from live MCP exploration.',
    buggenie: 'Convert failures and evidence into structured Jira defect tickets.',
    taskgenie: 'Create linked testing tasks, subtasks, and assignment-ready Jira details.',
    filegenie: 'Search, organize, and inspect local project files in the workspace you choose.',
    docgenie: 'Turn workbooks, notes, and reports into polished decks, docs, and visuals.',
};

function getWelcomeCopy(agent) {
    return AGENT_WELCOME_COPY[agent.id]
        || AGENT_WELCOME_COPY[String(agent.agentMode)]
        || agent.description;
}

// Keep the live streaming buffer bounded so very long agent responses don't grow
// the renderer heap without limit (Chrome STATUS_BREAKPOINT). Retains the most
// recent `max` chars with a leading marker; the server still delivers the full,
// untruncated content on message finalization (chat_message/chat_idle).
function capStreamingBuffer(text, max) {
    if (!max || text.length <= max) return text;
    return '…[earlier output trimmed for performance — full text shown on completion]\n\n'
        + text.slice(text.length - max);
}

// Truncate large tool-result payloads before they're stored in React state.
// Tool cards only show a summary; full MCP snapshots / command logs can be MBs
// each and, accumulated across a long session, pin large amounts of heap.
function capToolResult(result, max = LIMITS.MAX_TOOL_RESULT_DISPLAY_CHARS) {
    if (typeof result !== 'string') return result;
    if (!max || result.length <= max) return result;
    return result.slice(0, max) + `\n…[truncated ${result.length - max} chars]`;
}

// Approximate the in-memory footprint of an attachment's inline bytes. base64
// string length closely tracks the retained heap cost; fall back to the decoded
// `size` (inflated by the ~1.37x base64 overhead) when no inline string is held.
function estimateAttachmentBytes(att) {
    if (!att || typeof att !== 'object') return 0;
    if (typeof att.dataUrl === 'string') return att.dataUrl.length;
    if (typeof att.data === 'string') return att.data.length;
    if (typeof att.base64 === 'string') return att.base64.length;
    // A blob: URL points to a Blob held in the browser's blob store; the bytes
    // aren't on the JS heap but the decoded bitmap is, and that's the dominant
    // renderer-memory cost. Use the source size (×1 for blobs since the blob
    // already holds the binary form, not base64).
    if (typeof att.url === 'string' && att.url.startsWith('blob:') && Number.isFinite(att.size)) return att.size;
    if (Number.isFinite(att.size)) return Math.ceil(att.size * 1.37);
    return 0;
}

function isInlineImageAttachment(att) {
    if (!att || typeof att !== 'object') return false;
    const hasInline = !!(att.dataUrl || att.data || att.base64
        || (typeof att.url === 'string' && att.url.startsWith('blob:')));
    if (!hasInline) return false;
    return att.kind === 'image'
        || (att.kind !== 'document' && att.kind !== 'artifact' && att.kind !== 'video');
}

// Drop heavy inline base64 from an attachment, leaving a lightweight descriptor
// the UI can render as a placeholder. Marked `evicted` so ChatMessage can show a
// "unloaded to save memory" tile instead of an <img>. blob: URLs are also
// revoked here so the underlying Blob (and its decoded bitmap on any mounted
// <img>) is actually freed — this is what real chat apps do to keep long
// image-heavy sessions stable.
function evictAttachmentInline(att) {
    if (!att || typeof att !== 'object' || att.evicted) return att;
    const { dataUrl, data, base64, url, ...rest } = att;
    const isBlobUrl = typeof url === 'string' && url.startsWith('blob:');
    if (!dataUrl && !data && !base64 && !isBlobUrl) return att;
    if (isBlobUrl) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    return { ...rest, kind: rest.kind || 'image', evicted: true };
}

// Drop inline base64 from an attachment WITHOUT marking it evicted, preserving a
// durable reference (url/path) for display. Used for tool-result attachments,
// which are server-provided references that must never carry inline bytes into
// React state. blob: URLs are NOT durable — they live in the renderer's blob
// store — so they go through full eviction instead.
function stripInlineAttachmentBytes(att) {
    if (!att || typeof att !== 'object') return att;
    if (!att.dataUrl && !att.data && !att.base64) return att;
    const isBlobUrl = typeof att.url === 'string' && att.url.startsWith('blob:');
    if ((att.url && !isBlobUrl) || att.relativePath || att.path) {
        const { dataUrl, data, base64, ...rest } = att;
        return rest;
    }
    return evictAttachmentInline(att);
}

// Build an optimistic image preview URL for a user-uploaded screenshot. The
// uploaded base64 may be megapixels; mounting it directly forces the browser to
// decode the full-resolution bitmap (W*H*4 bytes RGBA) into renderer memory,
// which is the largest single contributor to Chrome STATUS_BREAKPOINT in
// image-heavy chats. Real chat apps (Slack/Linear/etc.) downscale the local
// preview to the tile size and keep the original only for the lightbox. We mirror
// that: produce a small thumbnail blob URL for the tile, falling back to the
// full-resolution blob URL only when the canvas pipeline isn't available.
const OPTIMISTIC_TILE_MAX_WIDTH = 480;

function base64ToBlob(base64, mimeType) {
    const byteChars = atob(base64);
    const len = byteChars.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || 'image/png' });
}

async function buildOptimisticImagePreview(base64, mimeType) {
    if (typeof base64 !== 'string' || base64.length === 0) return null;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    let sourceBlob;
    try { sourceBlob = base64ToBlob(base64, mimeType); } catch { return null; }
    try {
        if (typeof createImageBitmap !== 'function') {
            return URL.createObjectURL(sourceBlob);
        }
        const bitmap = await createImageBitmap(sourceBlob);
        const ratio = Math.min(1, OPTIMISTIC_TILE_MAX_WIDTH / bitmap.width);
        if (ratio >= 1) {
            bitmap.close?.();
            return URL.createObjectURL(sourceBlob);
        }
        const w = Math.max(1, Math.round(bitmap.width * ratio));
        const h = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = (typeof OffscreenCanvas === 'function')
            ? new OffscreenCanvas(w, h)
            : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            bitmap.close?.();
            return URL.createObjectURL(sourceBlob);
        }
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const outBlob = canvas.convertToBlob
            ? await canvas.convertToBlob({ type: mimeType || 'image/png', quality: 0.85 })
            : await new Promise(resolve => canvas.toBlob(resolve, mimeType || 'image/png', 0.85));
        return outBlob ? URL.createObjectURL(outBlob) : URL.createObjectURL(sourceBlob);
    } catch {
        try { return URL.createObjectURL(sourceBlob); } catch { return null; }
    }
}

// Bound the in-memory messages array. Independent of DOM windowing — this caps
// the JS heap and the per-event cost of rebuilding/sorting the timeline. The full
// transcript stays available server-side via /history. Returns the same reference
// when no trim is needed so React can skip needless work.
function capMessages(messages) {
    if (!Array.isArray(messages) || messages.length <= LIMITS.MAX_RENDERED_MESSAGES) return messages;
    return messages.slice(messages.length - LIMITS.MAX_RENDERED_MESSAGES);
}

// Bound the inline image base64 retained in React state across the whole session.
// Walks newest → oldest and keeps full bytes only for the most recent images
// (capped by count AND total bytes); older inline images are evicted to a
// descriptor. This prevents the renderer heap from growing without limit over
// many agent runs (Chrome STATUS_BREAKPOINT). Returns the same array reference
// when nothing changed so React can skip needless re-renders.
function pruneAttachmentHeap(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    let keptImages = 0;
    let keptBytes = 0;
    let mutated = false;
    const next = new Array(messages.length);
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const atts = msg?.attachments;
        if (!Array.isArray(atts) || atts.length === 0) {
            next[i] = msg;
            continue;
        }
        let attsMutated = false;
        const nextAtts = atts.map(att => {
            if (!isInlineImageAttachment(att) || att.evicted) return att;
            const bytes = estimateAttachmentBytes(att);
            if (keptImages < LIMITS.MAX_RETAINED_ATTACHMENT_IMAGES
                && keptBytes + bytes <= LIMITS.MAX_RETAINED_ATTACHMENT_BYTES) {
                keptImages += 1;
                keptBytes += bytes;
                return att;
            }
            attsMutated = true;
            return evictAttachmentInline(att);
        });
        if (attsMutated) {
            mutated = true;
            next[i] = { ...msg, attachments: nextAtts };
        } else {
            next[i] = msg;
        }
    }
    return mutated ? next : messages;
}

// Stable per-message keys for the virtualized timeline. Index-based keys break
// virtualization when the message array is trimmed from the front (capMessages)
// or when an attachment is evicted (pruneAttachmentHeap rebuilds the object):
// shifting keys force Virtuoso to remount otherwise-unchanged rows. A WeakMap
// assigns each message object a durable id that survives array slicing; only a
// genuinely replaced object (rare — e.g. image eviction) receives a fresh key.
const _messageKeyMap = new WeakMap();
let _messageKeySeq = 0;
function stableMessageKey(message) {
    if (!message || typeof message !== 'object') return `msg_anon_${++_messageKeySeq}`;
    let key = _messageKeyMap.get(message);
    if (!key) {
        key = `msg_${++_messageKeySeq}`;
        _messageKeyMap.set(message, key);
    }
    return key;
}

export default function ChatPage() {
    const {
        groups: modelGroups,
        defaultModel,
        source: modelCatalogSource,
        warnings: modelCatalogWarnings,
        error: modelCatalogError,
        loading: modelCatalogLoading,
    } = useModelCatalog();

    const {
        agents,
        defaultAgent,
    } = useAgentCatalog();

    const [sessions, setSessions] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [messages, setMessages] = useState([]);           // { role, content, timestamp }
    const [toolGroups, setToolGroups] = useState([]);       // [{ id, timestamp, tools: [...] }]
    const [delegations, setDelegations] = useState([]);     // [{ id, agentLabel, agentId, task, text, tools, status }]
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingReasoning, setStreamingReasoning] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCreatingSession, setIsCreatingSession] = useState(false);
    const [error, setError] = useState(null);
    const [model, setModelState] = useState('');
    const [modelTouched, setModelTouched] = useState(false);
    const [agentModelMap, setAgentModelMap] = useState({});
    const [agentId, setAgentId] = useState(buildCoreAgentId(null));
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [followups, setFollowups] = useState([]);         // [{ label, prompt, category, icon, prefill? }]
    const [prefillText, setPrefillText] = useState('');      // text to pre-fill into the chat input
    const [userInputRequests, setUserInputRequests] = useState([]); // [{ requestId, question, options, timestamp, resolved, resolvedAnswer, auto }]
    const [filegenieRoot, setFilegenieRoot] = useState(null); // current workspace root for FileGenie

    // Virtualized timeline refs. <Virtuoso> physically mounts only the rows near
    // the viewport (plus a small overscan) and unmounts the rest, so the DOM-node
    // count, decoded image bitmaps, and React fibers stay bounded no matter how
    // long the conversation grows. This is the durable fix for the Chrome
    // STATUS_BREAKPOINT crash, which is driven by the renderer's "Other (HTML)"
    // memory — DOM nodes + decoded bitmaps — not the JS heap that
    // performance.memory measures.
    const virtuosoRef = useRef(null);
    const atBottomRef = useRef(true);

    // Runtime renderer-memory safety net (backstop). With virtualization bounding
    // the mounted DOM, the remaining lever is the inline image bytes retained in
    // React state across the session. If the guard samples renderer pressure,
    // re-run attachment eviction. The full transcript remains available
    // server-side via the /history endpoint.
    const handleMemoryPressure = useCallback(() => {
        setMessages((prev) => pruneAttachmentHeap(prev));
    }, []);
    useMemoryGuard(handleMemoryPressure);

    const messageScrollRef = useRef(null);
    const streamingContentRef = useRef('');
    const streamingReasoningRef = useRef('');
    const currentToolGroupRef = useRef(null);               // tracks the active tool group ID
    const createSessionInFlightRef = useRef(false);
    const autoLaunchedRef = useRef(false);
    // Blob object URLs created for optimistic image previews. Tracked so they can
    // be revoked (freeing the underlying blob) on unmount and on session switch,
    // since the durable copy is served from the backend attachment store.
    const localPreviewUrlsRef = useRef(new Set());

    // Perf: throttle React state updates for streaming content/reasoning.
    // chat_delta events fire at ~60Hz; without throttling, ReactMarkdown
    // re-parses an ever-growing string on every batch (effectively O(n^2)),
    // which builds enough renderer memory pressure for Chrome to abort the
    // tab with STATUS_BREAKPOINT during long responses.
    const STREAMING_FLUSH_MS = 90;
    const streamingFlushTimerRef = useRef(null);
    const streamingPendingContentRef = useRef(false);
    const streamingPendingReasoningRef = useRef(false);
    const scheduleStreamingFlush = useCallback(() => {
        if (streamingFlushTimerRef.current) return;
        // Skip the React re-render while the tab is hidden — nothing is on
        // screen, but ReactMarkdown re-parses still cost heap and CPU. Tokens
        // continue to accumulate in streamingContentRef and are flushed on the
        // next visibility change. Matches how real chat apps pause off-screen UI.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        streamingFlushTimerRef.current = setTimeout(() => {
            streamingFlushTimerRef.current = null;
            if (streamingPendingContentRef.current) {
                streamingPendingContentRef.current = false;
                setStreamingContent(streamingContentRef.current);
            }
            if (streamingPendingReasoningRef.current) {
                streamingPendingReasoningRef.current = false;
                setStreamingReasoning(streamingReasoningRef.current);
            }
        }, STREAMING_FLUSH_MS);
    }, []);
    const cancelStreamingFlush = useCallback(() => {
        if (streamingFlushTimerRef.current) {
            clearTimeout(streamingFlushTimerRef.current);
            streamingFlushTimerRef.current = null;
        }
        streamingPendingContentRef.current = false;
        streamingPendingReasoningRef.current = false;
    }, []);
    useEffect(() => () => cancelStreamingFlush(), [cancelStreamingFlush]);

    // Revoke optimistic image-preview blob URLs (frees the underlying blobs). The
    // durable copy is served from the backend attachment store, so revoking here
    // never loses an image that should persist.
    const revokeLocalPreviewUrls = useCallback(() => {
        for (const u of localPreviewUrlsRef.current) {
            try { URL.revokeObjectURL(u); } catch { /* ignore */ }
        }
        localPreviewUrlsRef.current.clear();
    }, []);
    useEffect(() => () => revokeLocalPreviewUrls(), [revokeLocalPreviewUrls]);

    // Page-Visibility eviction. Real chat apps (Slack, Linear) trim state when a
    // tab sits in the background — a hidden tab still accumulates SSE events,
    // tool results, and approval prompts, and Chrome quietly throttles its memory
    // budget. If the tab stays hidden long enough, snap the render window to a
    // small floor, prune retained image bytes, and pause streaming flushes; on
    // return the next user interaction or visibility change rebuilds whatever is
    // needed. The full transcript stays available server-side via /history.
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const HIDDEN_EVICT_MS = 30_000;
        let hiddenTimer = null;
        const evict = () => {
            hiddenTimer = null;
            setMessages(prev => pruneAttachmentHeap(prev));
            cancelStreamingFlush();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                if (hiddenTimer) clearTimeout(hiddenTimer);
                hiddenTimer = setTimeout(evict, HIDDEN_EVICT_MS);
            } else {
                if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
                // Flush any tokens that accumulated while we were hidden so the UI
                // catches up in a single re-render rather than 60/sec ones.
                if (streamingPendingContentRef.current || streamingPendingReasoningRef.current) {
                    scheduleStreamingFlush();
                }
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            if (hiddenTimer) clearTimeout(hiddenTimer);
        };
    }, [cancelStreamingFlush, scheduleStreamingFlush]);

    useResetScrollOnRouteChange([messageScrollRef]);

    const setModel = useCallback((nextModel) => {
        setModelTouched(true);
        setModelState(nextModel);
    }, []);

    // Per-agent model memory: remembers which model the user last paired with each agent
    // so switching agents (via the pill row, launcher, or deep-link) restores the associated
    // model in the header dropdown — no more mismatch between the selected agent and the
    // model pill.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = JSON.parse(window.localStorage.getItem('chat.agentModelMap') || '{}');
            if (saved && typeof saved === 'object') setAgentModelMap(saved);
        } catch { /* ignore corrupt storage */ }
    }, []);

    const rememberAgentModel = useCallback((targetAgentId, modelValue) => {
        if (!targetAgentId || !modelValue) return;
        setAgentModelMap((prev) => {
            if (prev[targetAgentId] === modelValue) return prev;
            const next = { ...prev, [targetAgentId]: modelValue };
            try {
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem('chat.agentModelMap', JSON.stringify(next));
                }
            } catch { /* storage quota / private mode — ignore */ }
            return next;
        });
    }, []);

    useEffect(() => {
        if (defaultAgent?.id && !agentId) {
            setAgentId(defaultAgent.id);
        }
    }, [agentId, defaultAgent]);

    // Support deep-linking an agent via ?agentId= query param (e.g. from /my-agents "Use in Chat").
    // Also honors an optional ?model= so users can pick the model at launch time, and ?newSession=1
    // to immediately create a fresh chat session bound to that agent + model (so the user lands in
    // a live conversation, not the welcome/preview screen).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (autoLaunchedRef.current) return;
        if (!Array.isArray(agents) || agents.length === 0) return;
        const params = new URLSearchParams(window.location.search);
        const requested = params.get('agentId');
        const requestedModel = params.get('model');
        const newSession = params.get('newSession');
        if (!requested && !requestedModel && !newSession) return;

        let matchedAgent = null;
        if (requested) {
            matchedAgent = agents.find((agent) => agent.id === requested) || null;
            // If the catalog hasn't loaded the requested agent yet (e.g. still showing fallback
            // core-only list while the real catalog is in flight), wait — do NOT clear the URL
            // or we'll lose the deep-link on the next render.
            if (!matchedAgent) return;
            setAgentId(matchedAgent.id);
        }
        if (requestedModel) setModel(requestedModel);
        if (matchedAgent && requestedModel) rememberAgentModel(matchedAgent.id, requestedModel);

        // Clear the launch params so refreshes don't re-create a session.
        params.delete('agentId');
        params.delete('model');
        params.delete('newSession');
        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
        window.history.replaceState({}, '', nextUrl);

        // Auto-create a fresh chat session so the user lands directly in a conversation with the
        // selected custom agent + model instead of the welcome preview page.
        if (matchedAgent && (newSession || requestedModel)) {
            autoLaunchedRef.current = true;
            createSession(matchedAgent.id, requestedModel || undefined);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agents, setModel]);

    const activeAgentConfig = useMemo(
        () => getAgentConfig(agentId || defaultAgent?.id || buildCoreAgentId(null), agents),
        [agentId, agents, defaultAgent]
    );

    // Memoize the streaming bubble's message object so React.memo on
    // ChatMessage compares stable references when streamingContent is unchanged.
    const streamingMessage = useMemo(
        () => ({ role: 'assistant', content: streamingContent }),
        [streamingContent]
    );

    const welcomeAgentCards = useMemo(() => agents.map((agent) => ({
        ...agent,
        desc: getWelcomeCopy(agent),
        Icon: AGENT_ICON_MAP[agent.icon] || SparkleIcon,
    })), [agents]);

    const coreWelcomeCards = useMemo(
        () => welcomeAgentCards.filter((card) => !card.isCustom),
        [welcomeAgentCards]
    );
    const customWelcomeCards = useMemo(
        () => welcomeAgentCards.filter((card) => card.isCustom),
        [welcomeAgentCards]
    );

    const isFilegenieAgent = activeAgentConfig.toolProfile === 'filegenie' || activeAgentConfig.agentMode === 'filegenie';

    // SSE connection for active chat session
    const streamUrl = activeSessionId ? apiClient.getChatStreamUrl(activeSessionId) : null;

    const upsertSessionMeta = useCallback((sessionMeta) => {
        if (!sessionMeta?.sessionId) return;
        setSessions(prev => {
            return sortSessionsByRecency([sessionMeta, ...prev.filter(s => s.sessionId !== sessionMeta.sessionId)]);
        });
    }, []);

    const refreshSessions = useCallback(async () => {
        const data = await apiClient.listChatSessions();
        const all = Array.isArray(data) ? data.filter(session => !session.archived) : [];
        setSessions(prev => mergeSessionSnapshots(prev, all));
        return all;
    }, []);

    const ensureLiveSession = useCallback(async (sessionId) => {
        if (!sessionId) throw new Error('No active session selected');
        const status = await apiClient.getChatSessionStatus(sessionId);
        upsertSessionMeta(status);

        if (status.archived) {
            throw new Error('This conversation is archived and can only be viewed from History.');
        }

        if (isSessionBooting(status)) {
            return status;
        }

        if (needsSessionResume(status)) {
            const resumed = await apiClient.resumeChatSession(sessionId);
            upsertSessionMeta(resumed);
            return resumed;
        }

        return status;
    }, [upsertSessionMeta]);

    const handleSSEEvent = useCallback((type, event) => {
        const data = event?.data || {};
        const ts = event?.timestamp || new Date().toISOString();

        switch (type) {
            case 'chat_delta':
                streamingContentRef.current = capStreamingBuffer(
                    streamingContentRef.current + (data.deltaContent || ''),
                    LIMITS.MAX_STREAMING_CONTENT_CHARS
                );
                streamingPendingContentRef.current = true;
                scheduleStreamingFlush();
                break;

            case 'chat_message': {
                const finalContent = data.content || streamingContentRef.current;
                // Capture reasoning: prefer persisted reasoning from server, fall back to streamed
                const messageReasoning = data.reasoning || streamingReasoningRef.current || null;
                const hasAttachments = Array.isArray(data.attachments) && data.attachments.length > 0;
                if ((finalContent && finalContent.trim()) || hasAttachments) {
                    setMessages(prev => {
                        if (!hasAttachments && prev.some(m => m.content === finalContent && m.role === 'assistant')) return prev;
                        const msg = { role: 'assistant', content: finalContent, timestamp: ts };
                        if (messageReasoning) msg.reasoning = messageReasoning;
                        if (hasAttachments) msg.attachments = data.attachments;
                        return capMessages(pruneAttachmentHeap([...prev, msg]));
                    });
                }
                // Close current tool group so the next tool call starts a new one
                currentToolGroupRef.current = null;
                cancelStreamingFlush();
                streamingContentRef.current = '';
                streamingReasoningRef.current = '';
                setStreamingContent('');
                setStreamingReasoning('');
                break;
            }

            case 'chat_tool_start': {
                const tool = { name: data.toolName, id: data.toolCallId, status: 'running' };
                setToolGroups(prev => {
                    const groupId = currentToolGroupRef.current;
                    if (groupId) {
                        // Append tool to existing group
                        return prev.map(g => g.id === groupId
                            ? { ...g, tools: [...g.tools, tool] }
                            : g
                        );
                    }
                    // Create new tool group (cap total groups — oldest drop off so a
                    // long orchestrator turn can't grow this array without bound).
                    const newGroupId = `tg_${Date.now()}`;
                    currentToolGroupRef.current = newGroupId;
                    const appended = [...prev, { id: newGroupId, timestamp: ts, tools: [tool] }];
                    return appended.length > LIMITS.MAX_RENDERED_TOOL_GROUPS
                        ? appended.slice(appended.length - LIMITS.MAX_RENDERED_TOOL_GROUPS)
                        : appended;
                });
                break;
            }

            case 'chat_tool_complete':
                // Only new-object the group that actually contains the completed
                // tool; every other group keeps its reference so memoized
                // ToolCallCards skip re-rendering (renderer-churn fix).
                setToolGroups(prev =>
                    prev.map(g => {
                        if (!g.tools.some(t => t.id === data.toolCallId)) return g;
                        return {
                            ...g,
                            tools: g.tools.map(t => t.id === data.toolCallId
                                ? {
                                    ...t,
                                    status: 'complete',
                                    result: capToolResult(data.result),
                                    success: data.success,
                                    // Defense-in-depth: tool attachments are URL/path
                                    // references from the server; drop any inline base64
                                    // so tool results never pin the renderer heap.
                                    attachments: Array.isArray(data.attachments)
                                        ? data.attachments.map(stripInlineAttachmentBytes)
                                        : [],
                                }
                                : t
                            ),
                        };
                    })
                );
                break;

            case 'chat_delegation_start':
                setDelegations(prev => {
                    if (prev.some(d => d.id === data.delegationId)) return prev;
                    const next = [...prev, {
                        id: data.delegationId,
                        agentLabel: data.agentLabel || 'Specialist',
                        agentId: data.agentId || '',
                        task: data.task || '',
                        text: '',
                        tools: [],
                        status: 'running',
                        timestamp: ts,
                    }];
                    return next.length > LIMITS.MAX_RENDERED_TOOL_GROUPS
                        ? next.slice(next.length - LIMITS.MAX_RENDERED_TOOL_GROUPS)
                        : next;
                });
                break;

            case 'chat_delegation_delta':
                setDelegations(prev => prev.map(d => d.id === data.delegationId
                    ? { ...d, text: capStreamingBuffer(d.text + (data.deltaContent || ''), LIMITS.MAX_STREAMING_CONTENT_CHARS) }
                    : d
                ));
                break;

            case 'chat_delegation_tool_start':
                setDelegations(prev => prev.map(d => d.id === data.delegationId
                    ? { ...d, tools: [...d.tools, { name: data.toolName, status: 'running', key: `${data.toolName}_${d.tools.length}_${Date.now()}` }] }
                    : d
                ));
                break;

            case 'chat_delegation_tool_complete':
                setDelegations(prev => prev.map(d => {
                    if (d.id !== data.delegationId) return d;
                    let marked = false;
                    const tools = [...d.tools];
                    for (let k = tools.length - 1; k >= 0; k--) {
                        if (!marked && tools[k].name === data.toolName && tools[k].status === 'running') {
                            tools[k] = { ...tools[k], status: 'complete', success: data.success };
                            marked = true;
                        }
                    }
                    return { ...d, tools };
                }));
                break;

            case 'chat_delegation_complete':
                setDelegations(prev => prev.map(d => d.id === data.delegationId
                    ? {
                        ...d,
                        status: data.success ? 'complete' : 'failed',
                        error: data.error || null,
                        text: (d.text && d.text.trim()) ? d.text : (data.output || d.text),
                        // Defensive: finalize any tool rows still marked running so the
                        // completed sub-thread never shows stuck "running…" rows.
                        tools: d.tools.map(t => t.status === 'running'
                            ? { ...t, status: 'complete', success: t.success !== false }
                            : t),
                    }
                    : d
                ));
                break;

            case 'chat_tool_progress':
                // Update the matching running tool with live progress info. Only
                // clone the group that holds the running tool so other memoized
                // ToolCallCards don't re-render on every high-frequency progress event.
                setToolGroups(prev =>
                    prev.map(g => {
                        if (!g.tools.some(t => t.name === data.toolName && t.status === 'running')) return g;
                        return {
                            ...g,
                            tools: g.tools.map(t =>
                                t.name === data.toolName && t.status === 'running'
                                    ? {
                                        ...t,
                                        progressPhase: data.phase,
                                        progressMessage: data.message,
                                        progressStep: data.step,
                                        ...(data.featureResult ? { featureResult: data.featureResult } : {}),
                                        ...(data.stepNum ? { stepNum: data.stepNum, totalSteps: data.totalSteps, stepDescription: data.stepDescription, stepStatus: data.stepStatus } : {}),
                                    }
                                    : t
                            ),
                        };
                    })
                );
                break;

            case 'chat_reasoning':
                streamingReasoningRef.current = capStreamingBuffer(
                    streamingReasoningRef.current + (data.deltaContent || ''),
                    LIMITS.MAX_STREAMING_REASONING_CHARS
                );
                streamingPendingReasoningRef.current = true;
                scheduleStreamingFlush();
                break;

            case 'chat_idle':
                setIsProcessing(false);
                cancelStreamingFlush();
                if (streamingContentRef.current) {
                    const idleReasoning = streamingReasoningRef.current || null;
                    setMessages(prev => {
                        const msg = { role: 'assistant', content: streamingContentRef.current, timestamp: ts };
                        if (idleReasoning) msg.reasoning = idleReasoning;
                        return capMessages([...prev, msg]);
                    });
                    streamingContentRef.current = '';
                    setStreamingContent('');
                }
                currentToolGroupRef.current = null;
                streamingReasoningRef.current = '';
                setStreamingReasoning('');
                // Keep toolGroups — don't clear them so completed tools remain visible
                break;

            case 'chat_error':
                setError(data.error || 'Chat error occurred');
                setIsProcessing(false);
                break;

            case 'chat_followup':
                if (Array.isArray(data.followups) && data.followups.length > 0) {
                    setFollowups(data.followups);
                }
                break;

            case 'chat_user_input_request': {
                const normalizedRequest = normalizeUserInputRequestEvent(data);
                setUserInputRequests(prev => {
                    // Avoid duplicates (e.g. from history replay)
                    if (prev.some(r => r.requestId === normalizedRequest.requestId)) {
                        // If replayed with resolved flag, update it
                        if (normalizedRequest.resolved) {
                            return prev.map(r => r.requestId === normalizedRequest.requestId
                                ? {
                                    ...r,
                                    question: normalizedRequest.question,
                                    options: normalizedRequest.options,
                                    type: normalizedRequest.type,
                                    meta: normalizedRequest.meta,
                                    resolved: true,
                                }
                                : r
                            );
                        }
                        return prev;
                    }
                    const appended = [...prev, {
                        requestId: normalizedRequest.requestId,
                        question: normalizedRequest.question,
                        options: normalizedRequest.options,
                        type: normalizedRequest.type,
                        meta: normalizedRequest.meta,
                        timestamp: ts,
                        resolved: normalizedRequest.resolved,
                        resolvedAnswer: null,
                        auto: false,
                    }];
                    // Cap retained prompts so the array can't grow unbounded over a
                    // long session (one prompt per gated Jira write adds up).
                    return appended.length > LIMITS.MAX_RETAINED_USER_INPUT_REQUESTS
                        ? appended.slice(appended.length - LIMITS.MAX_RETAINED_USER_INPUT_REQUESTS)
                        : appended;
                });
                // Auto-scroll to show the prompt
                setTimeout(() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' }), 100);
                break;
            }

            case 'chat_user_input_complete':
                setUserInputRequests(prev =>
                    prev.map(r => r.requestId === data.requestId
                        ? { ...r, resolved: true, resolvedAnswer: data.answer, auto: !!data.auto }
                        : r
                    )
                );
                break;

            case 'user_message':
                if (data.role === 'assistant') {
                    setMessages(prev => {
                        if ((!data.attachments || data.attachments.length === 0) && prev.some(m => m.content === data.content && m.role === 'assistant')) return prev;
                        const msg = { role: 'assistant', content: data.content, timestamp: ts };
                        if (data.reasoning) msg.reasoning = data.reasoning;
                        if (Array.isArray(data.attachments) && data.attachments.length > 0) msg.attachments = data.attachments;
                        return capMessages(pruneAttachmentHeap([...prev, msg]));
                    });
                }
                break;
        }
    }, []);

    const handleSSEDisconnect = useCallback(async (message) => {
        if (!activeSessionId) {
            setError(message);
            return;
        }

        try {
            const status = await apiClient.getChatSessionStatus(activeSessionId);
            upsertSessionMeta(status);

            if (status.archived) {
                setError('This conversation is archived and can only be viewed from History.');
                return;
            }

            if (needsSessionResume(status)) {
                setError('Live session runtime disconnected. It will be resumed automatically when you send the next message.');
                return;
            }
        } catch (err) {
            setError(err.message || message);
            return;
        }

        setError(message);
    }, [activeSessionId, upsertSessionMeta]);

    const { status: sseStatus } = useSSE(streamUrl, { onEvent: handleSSEEvent, onError: handleSSEDisconnect });

    // Auto-scroll while streaming. Committed rows (new messages, tool groups,
    // prompts) are followed automatically by Virtuoso's `followOutput` when the
    // user is already near the bottom. The streaming assistant bubble grows in
    // place as the final timeline row, so its growth doesn't change the row count
    // and must be followed explicitly: nudge Virtuoso to the last row on each
    // throttled (~90ms) streaming flush, but only while the user is at the bottom
    // so we never yank them back down after they scroll up to read.
    useEffect(() => {
        if (!activeSessionId) return;
        if (!streamingContent && !streamingReasoning) return;
        if (atBottomRef.current === false) return;
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
    }, [activeSessionId, streamingContent, streamingReasoning]);

    // Load sessions on mount
    useEffect(() => {
        loadSessions();
    }, []);

    useEffect(() => {
        if (sessions.length === 0) return undefined;

        let disposed = false;
        const poll = async () => {
            if (disposed) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            try {
                const latest = await refreshSessions();
                if (disposed) return;
                if (activeSessionId && !latest.some(session => session.sessionId === activeSessionId)) {
                    setActiveSessionId(null);
                    setMessages([]);
                    setToolGroups([]);
                    setFollowups([]);
                    setUserInputRequests([]);
                    setIsProcessing(false);
                }
            } catch {
                // Ignore transient polling failures.
            }
        };

        // Perf: 30s cadence + skip while tab is hidden. SSE handles
        // real-time updates; this poll is only a safety net for missed events.
        const timer = setInterval(poll, 30000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') poll();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            disposed = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [activeSessionId, refreshSessions, sessions.length]);

    useEffect(() => {
        if (!modelTouched && defaultModel && model !== defaultModel) {
            setModelState(defaultModel);
        }
    }, [defaultModel, model, modelTouched]);

    useEffect(() => {
        if (model && !hasModelValue(model, modelGroups)) {
            setModelState(getDefaultModel(modelGroups, defaultModel));
        }
    }, [defaultModel, model, modelGroups]);

    // Delegation sub-threads are ephemeral (SSE-only, not persisted history). Clear
    // them when the active session changes so a switched/new/reloaded session does
    // not show stale specialist threads.
    useEffect(() => { setDelegations([]); }, [activeSessionId]);

    const loadSessions = async () => {
        try {
            await refreshSessions();
        } catch {
            // Backend may not be running yet
        }
    };

    const createSession = async (overrideAgent, overrideModel) => {
        if (createSessionInFlightRef.current) return;

        const agentForSession = (typeof overrideAgent === 'string')
            ? overrideAgent
            : (agentId || defaultAgent?.id || buildCoreAgentId(null));

        const applyNewSession = (session) => {
            setSessions(prev => [session, ...prev]);
            setActiveSessionId(session.sessionId);
            setMessages([]);
            setToolGroups([]);
            setFollowups([]);
            setUserInputRequests([]);
            currentToolGroupRef.current = null;
            streamingContentRef.current = '';
            streamingReasoningRef.current = '';
            setStreamingContent('');
            setStreamingReasoning('');
            if (agentForSession !== agentId) setAgentId(agentForSession);
        };

        try {
            createSessionInFlightRef.current = true;
            setIsCreatingSession(true);
            setError(null);
            setIsProcessing(false);
            const selectedModel = (typeof overrideModel === 'string' && overrideModel)
                ? overrideModel
                : (model || defaultModel || getDefaultModel(modelGroups));
            const session = await apiClient.createChatSession(selectedModel, agentForSession);
            applyNewSession(session);
            // Show welcome followup suggestions from the server
            if (Array.isArray(session.followups) && session.followups.length > 0) {
                setFollowups(session.followups);
            }
        } catch (err) {
            setError(`Failed to create session: ${err.message}`);
        } finally {
            createSessionInFlightRef.current = false;
            setIsCreatingSession(false);
        }
    };

    const switchSession = async (sessionId) => {
        try {
            await ensureLiveSession(sessionId);
        } catch (err) {
            setError(`Failed to open session: ${err.message}`);
            return;
        }

        setActiveSessionId(sessionId);
        setMessages([]);
        setStreamingContent('');
        setStreamingReasoning('');
        streamingContentRef.current = '';
        streamingReasoningRef.current = '';
        setToolGroups([]);
        setFollowups([]);
        setUserInputRequests([]);
        currentToolGroupRef.current = null;
        setIsProcessing(false);

        const sessionMeta = sessions.find(s => s.sessionId === sessionId);
        if (sessionMeta) {
            setAgentId(sessionMeta.agent?.id || sessionMeta.agentId || buildCoreAgentId(sessionMeta.agentMode || null));
            const sessionIsFilegenie = sessionMeta.agent?.toolProfile === 'filegenie' || sessionMeta.agentMode === 'filegenie';
            if (sessionIsFilegenie) {
                apiClient.getWorkspaceRoot(sessionId).then(data => {
                    setFilegenieRoot(data?.root || null);
                }).catch(() => setFilegenieRoot(null));
            } else {
                setFilegenieRoot(null);
            }
        }

        try {
            const history = await apiClient.getChatHistory(sessionId);
            if (Array.isArray(history)) {
                const hydrated = hydrateChatHistory(history);
                setMessages(capMessages(pruneAttachmentHeap(hydrated.messages)));
                setUserInputRequests(hydrated.userInputRequests);
            }
        } catch { /* ignore */ }
    };

    const deleteSession = async (sessionId) => {
        try {
            await apiClient.deleteChatSession(sessionId);
            setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
            if (activeSessionId === sessionId) {
                setActiveSessionId(null);
                setMessages([]);
            }
        } catch (err) {
            setError(err.message);
        }
    };

    const sendMessage = useCallback(async (content, imageAttachments = [], docAttachments = [], videoAttachments = []) => {
        if (!activeSessionId || (!content.trim() && imageAttachments.length === 0 && docAttachments.length === 0 && videoAttachments.length === 0)) return;

        if (sseStatus !== 'connected') {
            setError('Chat stream is reconnecting. Please wait until the status shows connected before sending.');
            return;
        }

        try {
            await ensureLiveSession(activeSessionId);
        } catch (err) {
            setError(`Failed to send: ${err.message}`);
            setIsProcessing(false);
            return;
        }

        // Build user message with optional attachments for local display.
        // Optimistic image previews are downscaled client-side to the tile size
        // (~480px) BEFORE being mounted, so the renderer never has to decode the
        // full-resolution screenshot bitmap (W*H*4 bytes RGBA). The original is
        // forwarded to the API below for upload; the durable full-res copy is
        // served on demand from the backend attachment store. Decoded image
        // bitmaps were the dominant Chrome STATUS_BREAKPOINT vector in
        // image-heavy chats and this matches how real chat apps avoid it.
        const userMessage = { role: 'user', content, timestamp: new Date().toISOString() };
        const imagePreviews = await Promise.all(
            imageAttachments.map(img => buildOptimisticImagePreview(img.base64, img.type))
        );
        const allLocalAttachments = [
            ...imageAttachments.map((img, idx) => {
                const previewUrl = imagePreviews[idx];
                const { base64, dataUrl, ...rest } = img;
                if (previewUrl) {
                    localPreviewUrlsRef.current.add(previewUrl);
                    return { ...rest, kind: 'image', url: previewUrl };
                }
                return { ...rest, kind: 'image', evicted: true };
            }),
            ...docAttachments.map(d => ({ ...d, kind: 'document' })),
            ...videoAttachments.map(v => ({ ...v, kind: 'video' })),
        ];
        if (allLocalAttachments.length > 0) {
            userMessage.attachments = allLocalAttachments;
        }

        // Prune retained inline image bytes the same way every other add path does;
        // the optimistic user-send was the one path that bypassed pruning, letting
        // uploaded screenshots accumulate unbounded across multi-ticket sessions.
        setMessages(prev => capMessages(pruneAttachmentHeap([...prev, userMessage])));
        setIsProcessing(true);
        setError(null);
        setFollowups([]);  // Clear followups when user sends a new message
        setPrefillText(''); // Clear any prefill text
        streamingContentRef.current = '';
        streamingReasoningRef.current = '';
        setStreamingContent('');
        setStreamingReasoning('');
        setToolGroups([]);
        currentToolGroupRef.current = null;

        // Update session title from first message
        setSessions(prev => prev.map(s => {
            if (s.sessionId !== activeSessionId) return s;
            if (s.title) return s; // already has title
            return { ...s, title: truncateTitle(content || 'File attachment') };
        }));

        try {
            // Transform attachments to the format expected by the backend API
            const apiAttachments = [];

            // Image attachments
            for (const att of imageAttachments) {
                apiAttachments.push({
                    type: 'image',
                    media_type: att.type,    // e.g. 'image/png'
                    data: att.base64,         // raw base64 string
                });
            }

            // Document attachments
            for (const att of docAttachments) {
                apiAttachments.push({
                    type: 'document',
                    media_type: att.mimeType, // e.g. 'application/pdf'
                    data: att.base64,
                    filename: att.name,
                });
            }

            // Video attachments (path-based — already uploaded via streaming endpoint)
            for (const att of videoAttachments) {
                apiAttachments.push({
                    type: 'video',
                    media_type: att.mimeType, // e.g. 'video/mp4'
                    tempPath: att.tempPath,
                    filename: att.name,
                });
            }

            const finalAttachments = apiAttachments.length > 0 ? apiAttachments : undefined;
            const defaultContent = imageAttachments.length > 0 ? '(image attached)' : (docAttachments.length > 0 ? '(document attached)' : (videoAttachments.length > 0 ? '(video attached)' : ''));

            const result = await apiClient.sendChatMessage(activeSessionId, content || defaultContent, finalAttachments, model);
            if (result?.session) {
                upsertSessionMeta(result.session);
            }
        } catch (err) {
            setError(`Failed to send: ${err.message}`);
            setIsProcessing(false);
        }
    }, [activeSessionId, ensureLiveSession, model, sseStatus, upsertSessionMeta]);

    // Per-message toolbar actions (Regenerate / Continue / Simplify / Explain).
    // Each becomes a new turn — no destructive history rewrites.
    const handleMessageAction = useCallback(({ prompt }) => {
        if (!prompt || isProcessing) return;
        sendMessage(prompt);
    }, [sendMessage, isProcessing]);

    const handleAbort = async () => {
        if (!activeSessionId) return;
        try {
            await apiClient.abortChat(activeSessionId);
        } catch { /* ignore */ }
        setIsProcessing(false);
    };

    /**
     * Handle agent mode change.
     * SDK sessions are immutable — switching agents creates a new session.
     * If current session has no messages, destroy it first (clean swap).
     */
    const handleAgentChange = async (newAgent, preferredModel, options = {}) => {
        const { forceNewSession = false } = options;
        if (isProcessing || isCreatingSession) return;
        if (!forceNewSession && newAgent === agentId) return;
        setAgentId(newAgent);
        setFilegenieRoot(null);

        // Clear stale UI state from previous session
        setToolGroups([]);
        setFollowups([]);
        setUserInputRequests([]);
        currentToolGroupRef.current = null;
        setStreamingContent('');
        streamingContentRef.current = '';
        streamingReasoningRef.current = '';
        setStreamingReasoning('');
        setError(null);

        // Resolve the model this agent should run with. Priority:
        //   1. Explicit model passed in (from the My Agents launcher)
        //   2. Remembered model from a previous pairing with this agent
        //   3. Current header dropdown value (unchanged)
        // This keeps the header ModelSelect and the active agent pill visually in sync
        // and prevents a stale-closure race where createSession would otherwise read
        // the old `model` state before setModel flushed.
        const resolvedModel = preferredModel || agentModelMap[newAgent] || null;
        if (resolvedModel && resolvedModel !== model) {
            setModel(resolvedModel);
        }
        if (resolvedModel) rememberAgentModel(newAgent, resolvedModel);

        // If no active session, create one directly when the caller explicitly requested a
        // fresh session (e.g., the My Agents launcher). Otherwise leave it to the next
        // natural createSession call so the user can still land on the welcome screen.
        if (!activeSessionId) {
            if (forceNewSession) {
                await createSession(newAgent, resolvedModel || undefined);
            }
            return;
        }

        // If current session has messages, keep it and create a new one
        // If empty, destroy the empty session first
        const currentSession = sessions.find(s => s.sessionId === activeSessionId);
        if (currentSession && (currentSession.messageCount === 0) && messages.length === 0) {
            // Empty session — destroy before creating new
            try { await apiClient.deleteChatSession(activeSessionId); } catch { /* ignore */ }
            setSessions(prev => prev.filter(s => s.sessionId !== activeSessionId));
        }

        // Create new session with the new agent (and its paired model, if any) — pass the
        // resolved model explicitly so we don't depend on the pending setModel flush.
        await createSession(newAgent, resolvedModel || undefined);
    };

    const handleFollowupSelect = (followup) => {
        if (!activeSessionId || isProcessing || isCreatingSession) return;
        setFollowups([]);
        // Prefill if explicitly flagged OR if prompt ends with an incomplete placeholder (e.g., "AOTF-")
        const needsInput = followup.prefill || /AOTF-\s*$/i.test(followup.prompt);
        if (needsInput) {
            // Populate input box so user can complete the prompt (e.g., add ticket ID)
            setPrefillText(followup.prompt);
        } else {
            // Complete prompt — send directly
            setPrefillText('');
            sendMessage(followup.prompt);
        }
    };

    /**
     * Submit the user's answer to a pending agent ask_user request.
     */
    const handleUserInputSubmit = useCallback(async (requestId, answer) => {
        if (!activeSessionId) return;
        try {
            await apiClient.submitUserInput(activeSessionId, requestId, answer);
            // Optimistically update local state (SSE event will also arrive but dedup handles it)
            setUserInputRequests(prev =>
                prev.map(r => r.requestId === requestId
                    ? { ...r, resolved: true, resolvedAnswer: answer, auto: false }
                    : r
                )
            );
        } catch (err) {
            setError(`Failed to submit response: ${err.message}`);
        }
    }, [activeSessionId]);

    // Build merged timeline: interleave messages + tool groups + user-input prompts by timestamp (memoized)
    const timeline = useMemo(() => {
        // Combine all timeline-worthy items with their timestamps and types
        const items = [
            ...messages.map((m) => ({ type: 'message', data: m, key: stableMessageKey(m), ts: m.timestamp || '' })),
            ...toolGroups.map(g => ({ type: 'tools', data: g, key: `tg_${g.id}`, ts: g.timestamp || '' })),
            ...delegations.map(d => ({ type: 'delegation', data: d, key: `deleg_${d.id}`, ts: d.timestamp || '' })),
            ...userInputRequests.map(r => ({ type: 'user_input', data: r, key: `uir_${r.requestId}`, ts: r.timestamp || '' })),
        ];
        // Sort chronologically
        items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
        // Coalesce consecutive approval-type user_input items into a single `approval_batch`
        // so bulk requests render as a tray rather than N stacked cards. Only collapse runs
        // of ≥2 approvals; a single approval still renders as a standalone card.
        const coalesced = [];
        let i = 0;
        while (i < items.length) {
            const item = items[i];
            if (item.type === 'user_input' && isApprovalBatchCandidate(item.data)) {
                let j = i + 1;
                while (j < items.length
                    && items[j].type === 'user_input'
                    && isApprovalBatchCandidate(items[j].data)) {
                    j += 1;
                }
                const runLength = j - i;
                if (runLength >= 2) {
                    const runItems = items.slice(i, j);
                    const firstId = runItems[0].data.requestId;
                    const lastId = runItems[runItems.length - 1].data.requestId;
                    coalesced.push({
                        type: 'approval_batch',
                        data: runItems.map(x => x.data),
                        key: `approval_batch_${firstId}_${lastId}`,
                        ts: item.ts,
                    });
                    i = j;
                    continue;
                }
            }
            coalesced.push(item);
            i += 1;
        }
        return coalesced;
    }, [messages, toolGroups, delegations, userInputRequests]);

    // Rows fed to <Virtuoso>. The live streaming assistant bubble is appended as a
    // synthetic final row so it scrolls and virtualizes like any other row (and so
    // `scrollToIndex('LAST')` can follow it as it grows). When nothing is
    // streaming we return the memoized `timeline` reference unchanged so Virtuoso
    // doesn't see a new data array on unrelated re-renders.
    const renderItems = useMemo(() => {
        if (!streamingContent && !streamingReasoning) return timeline;
        return [...timeline, { type: 'streaming', key: '__streaming__' }];
    }, [timeline, streamingContent, streamingReasoning]);

    const showConversation = Boolean(activeSessionId) && renderItems.length > 0;

    // Renders one virtualized row. Each branch returns the same horizontally
    // centered column the non-virtualized layout used (max-w-4xl + padding), with
    // vertical rhythm via py-2.5 (replaces the old `space-y-5` on the parent).
    const renderTimelineItem = useCallback((index, item) => {
        let inner;
        if (item.type === 'message') {
            inner = (
                <>
                    {item.data.reasoning && (
                        <ReasoningPanel reasoning={item.data.reasoning} compact />
                    )}
                    <ChatMessage message={item.data} agent={activeAgentConfig} onAction={handleMessageAction} />
                </>
            );
        } else if (item.type === 'user_input') {
            const req = item.data;
            inner = (
                <UserInputPrompt
                    requestId={req.requestId}
                    question={req.question}
                    options={req.options}
                    type={req.type || 'default'}
                    meta={req.meta || {}}
                    resolved={req.resolved}
                    resolvedAnswer={req.resolvedAnswer}
                    auto={req.auto}
                    onSubmit={handleUserInputSubmit}
                    disabled={!isProcessing}
                />
            );
        } else if (item.type === 'approval_batch') {
            inner = (
                <ApprovalBatch
                    requests={item.data}
                    onSubmit={handleUserInputSubmit}
                    disabled={!isProcessing}
                />
            );
        } else if (item.type === 'streaming') {
            inner = (
                <div className="space-y-5">
                    {streamingReasoning && (
                        <ReasoningPanel reasoning={streamingReasoning} isStreaming defaultExpanded />
                    )}
                    {streamingContent && (
                        <ChatMessage message={streamingMessage} isStreaming agent={activeAgentConfig} />
                    )}
                </div>
            );
        } else if (item.type === 'delegation') {
            inner = <DelegationThread delegation={item.data} />;
        } else {
            inner = <ToolCallCard group={item.data} />;
        }
        return (
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
                <div className="py-2.5">{inner}</div>
            </div>
        );
    }, [activeAgentConfig, handleMessageAction, handleUserInputSubmit, isProcessing, streamingMessage, streamingReasoning, streamingContent]);

    // Small fixed spacers so the first/last rows aren't flush against the edges.
    const virtuosoComponents = useMemo(() => ({
        Header: () => <div className="h-3" aria-hidden />,
        Footer: () => <div className="h-6" aria-hidden />,
    }), []);

    // Count active (running) tools across all groups
    const runningToolCount = toolGroups.reduce((acc, g) => acc + g.tools.filter(t => t.status === 'running').length, 0);

    return (
        <div className="flex h-screen min-h-0 bg-surface-50 overflow-hidden">
            {/* Dev-only renderer-memory monitor (self-gates to dev / localStorage memDebug='1') */}
            <MemoryHud />
            {/* Session Sidebar */}
            <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={switchSession}
                onCreate={createSession}
                onDelete={deleteSession}
                isCreating={isCreatingSession}
                isOpen={sidebarOpen}
                onToggle={() => setSidebarOpen(prev => !prev)}
            />

            {/* Chat Area */}
            <div className="flex-1 flex min-h-0 min-w-0 flex-col">
                {/* Header — frosted glass */}
                <div className="relative z-20 shrink-0 border-b border-surface-200/60 bg-white/80 backdrop-blur-md">
                    <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-center gap-3 xl:max-w-[18rem] 2xl:max-w-[20rem]">
                            <button
                                onClick={() => setSidebarOpen(prev => !prev)}
                                className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors text-surface-500 hover:text-surface-700"
                                title={sidebarOpen ? 'Close conversations' : 'Open conversations'}
                            >
                                <MenuIcon />
                            </button>
                            <div className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-sm">
                                <SparkleIcon className="w-5 h-5 text-white" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-sm font-bold text-surface-900 leading-tight">AI Chat Assistant</h1>
                                <p className="max-w-[11rem] truncate text-[11px] text-surface-500 sm:max-w-[15rem] xl:max-w-[17rem] 2xl:max-w-[20rem]">
                                    {activeSessionId
                                        ? (sessions.find(s => s.sessionId === activeSessionId)?.title || `Session ${activeSessionId.substring(0, 8)}`)
                                        : 'Conversation workspace'}
                                </p>
                            </div>
                        </div>
                        <div className="flex w-full min-w-0 flex-1 flex-col gap-2.5 overflow-visible xl:items-end">
                            <div className="flex w-full min-w-0 items-center gap-2">
                                <AgentSelect agents={agents} value={agentId} onChange={handleAgentChange} disabled={isProcessing || isCreatingSession} className="min-w-0 flex-1 xl:max-w-[min(100%,54rem)] 2xl:max-w-[min(100%,62rem)]" />
                                <MyAgentsLauncher
                                    agents={agents}
                                    initialAgentId={activeAgentConfig?.isCustom ? activeAgentConfig.id : null}
                                    initialModel={activeAgentConfig?.isCustom ? (agentModelMap[activeAgentConfig.id] || model) : model}
                                    onLaunch={(agent, chosenModel) => {
                                        if (chosenModel) {
                                            rememberAgentModel(agent.id, chosenModel);
                                            setModel(chosenModel);
                                        }
                                        handleAgentChange(agent.id, chosenModel, { forceNewSession: true });
                                    }}
                                    className="shrink-0"
                                />
                            </div>
                            {activeAgentConfig?.isCustom && (
                                <div className="flex w-full items-center gap-2 rounded-xl border border-violet-200/70 bg-gradient-to-r from-violet-50/70 via-white to-white px-2.5 py-1.5 text-[11px]">
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-violet-100 text-violet-600">
                                        <SparkleIcon className="h-3 w-3" />
                                    </span>
                                    <span className="font-semibold text-surface-800 truncate max-w-[10rem]">{activeAgentConfig.label}</span>
                                    {activeAgentConfig.workspaceName && (
                                        <span className="truncate text-surface-500">· {activeAgentConfig.workspaceName}</span>
                                    )}
                                    <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                        Custom agent
                                    </span>
                                </div>
                            )}
                            <div className="flex w-full flex-wrap items-center gap-2 sm:gap-2.5 xl:justify-end">
                                <ModelSelect value={model} onChange={setModel} groups={modelGroups} loading={modelCatalogLoading} className="w-full sm:w-[190px] lg:w-[220px] xl:w-[240px]" />
                                <span
                                    title={modelCatalogError || modelCatalogWarnings[0] || (modelCatalogSource === 'sdk-discovered' ? 'Using runtime SDK model catalog' : 'Using fallback model catalog')}
                                    className={`px-2 py-1 rounded-full text-[10px] font-semibold border flex-shrink-0 ${modelCatalogError
                                        ? 'bg-red-50 text-red-600 border-red-200'
                                        : modelCatalogSource === 'sdk-discovered'
                                            ? 'bg-accent-50 text-accent-700 border-accent-200'
                                            : 'bg-amber-50 text-amber-700 border-amber-200'
                                        }`}
                                >
                                    {modelCatalogSource === 'sdk-discovered' ? 'Runtime' : 'Fallback'}
                                </span>
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-100/80 border border-surface-200/50 flex-shrink-0 whitespace-nowrap">
                                    <span className={`w-2 h-2 rounded-full transition-colors flex-shrink-0 ${sseStatus === 'connected' ? 'bg-accent-400 shadow-sm shadow-accent-400/40' :
                                        sseStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' :
                                            !activeSessionId ? 'bg-surface-300' : 'bg-red-400'
                                        }`} />
                                    <span className="text-[11px] font-medium text-surface-500 capitalize">{!activeSessionId ? 'Ready' : sseStatus}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error banner */}
                {error && (
                    <div className="px-6 pt-3">
                        <ErrorBanner error={error} onDismiss={() => setError(null)} className="max-w-4xl mx-auto" />
                    </div>
                )}

                {/* Messages area */}
                {showConversation ? (
                    <Virtuoso
                        key={activeSessionId}
                        ref={virtuosoRef}
                        className="chat-virtuoso flex-1 min-h-0"
                        data={renderItems}
                        computeItemKey={(_, item) => item.key}
                        itemContent={renderTimelineItem}
                        components={virtuosoComponents}
                        followOutput={(atBottom) => (atBottom ? 'auto' : false)}
                        atBottomThreshold={240}
                        atBottomStateChange={(atBottom) => { atBottomRef.current = atBottom; }}
                        initialTopMostItemIndex={Math.max(0, renderItems.length - 1)}
                        increaseViewportBy={{ top: 600, bottom: 600 }}
                    />
                ) : (
                    <div ref={messageScrollRef} className="flex-1 min-h-0 overflow-y-auto">
                        <div className={`mx-auto px-4 py-5 space-y-5 sm:px-6 ${activeSessionId ? 'max-w-4xl' : 'max-w-[78rem]'}`}>
                            {/* Empty state — capability cards */}
                            {!activeSessionId && (
                                <div className="flex min-h-[24rem] items-start justify-center py-3 sm:min-h-[26rem] sm:py-4 xl:min-h-[28rem] xl:items-center xl:py-5">
                                    <div className="w-full max-w-[78rem] overflow-visible">
                                        <div className="grid gap-4 overflow-visible xl:grid-cols-[minmax(250px,0.72fr)_minmax(0,1.38fr)] xl:items-start 2xl:items-center">
                                            <div className="relative overflow-visible rounded-[28px] border border-surface-200/80 bg-[radial-gradient(circle_at_24%_18%,rgba(180,92,255,0.16),transparent_32%),radial-gradient(circle_at_78%_78%,rgba(31,158,171,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] px-4 py-4 text-center shadow-[0_22px_55px_rgba(15,23,42,0.08)] xl:px-5 xl:py-5 xl:text-left">
                                                <div className="flex items-center justify-center pt-1 xl:justify-start">
                                                    <div className="relative overflow-visible rounded-[28px] border border-surface-200/70 bg-white/72 px-4 pb-3 pt-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] xl:px-5 xl:pb-4 xl:pt-5">
                                                        <div className="absolute inset-x-10 bottom-3 h-5 rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.18),rgba(31,158,171,0.12),transparent_72%)] blur-xl" />
                                                        <RobotMascotLogo size={96} emphasis="hero" mood="glossy" className="relative z-[1] mx-auto" />
                                                    </div>
                                                </div>
                                                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-brand-50/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600">
                                                    <SparkleIcon className="w-3.5 h-3.5" />
                                                    Conversation workspace
                                                </div>
                                                <h2 className="mt-3 text-[1.4rem] font-bold tracking-tight text-surface-900 xl:text-[1.55rem]">QA Automation Assistant</h2>
                                                <p className="mt-2 text-[13px] leading-6 text-surface-500 xl:max-w-sm">
                                                    Start a new session from the primary action below, then stay with TPM for full workflow coverage or switch to a specialist agent for focused work.
                                                </p>

                                                <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 xl:justify-start">
                                                    <span className="inline-flex items-center rounded-full border border-surface-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-surface-600">
                                                        {agents.length} agent modes ready
                                                    </span>
                                                    <span className="inline-flex items-center rounded-full border border-surface-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-surface-600">
                                                        TPM selected by default
                                                    </span>
                                                </div>

                                                <div className="mt-4 flex flex-col items-center gap-2.5 xl:items-start">
                                                    <button
                                                        onClick={() => createSession()}
                                                        disabled={isCreatingSession}
                                                        className="gradient-brand text-white rounded-xl px-6 py-3 text-sm font-semibold shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/30 transition-all"
                                                    >
                                                        {isCreatingSession ? 'Starting...' : 'Start New Chat'}
                                                    </button>
                                                    <p className="text-[11px] leading-5 text-surface-500 xl:max-w-sm">
                                                        A new session opens the composer immediately so users can start asking questions without extra setup.
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="rounded-[28px] border border-surface-200/80 bg-white/92 p-3 shadow-[0_20px_48px_rgba(15,23,42,0.06)] sm:p-3.5 xl:p-4">
                                                <div className="mb-3 flex items-center justify-between gap-3 sm:mb-3.5">
                                                    <div className="text-left">
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-400">Agent modes</p>
                                                        <h3 className="mt-1 text-lg font-semibold tracking-tight text-surface-900">Pick the mode that matches the work.</h3>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                                                    {coreWelcomeCards.map((card) => (
                                                        <div key={card.id} className="group flex h-full min-h-[7.25rem] cursor-default flex-col rounded-2xl border border-surface-200/80 bg-surface-50/60 p-2.5 transition-all hover:border-brand-200 hover:bg-white hover:shadow-sm">
                                                            <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${card.bgClass} ${card.textClass}`}>
                                                                <card.Icon className="w-3.5 h-3.5" />
                                                            </div>
                                                            <div className="mb-1 flex items-center gap-1.5">
                                                                <h3 className="text-[12px] font-semibold text-surface-800 leading-tight">{card.label}</h3>
                                                                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${card.badgeBg} ${card.badgeText}`}>
                                                                    {card.shortLabel}
                                                                </span>
                                                            </div>
                                                            <p className="agent-card-copy text-[10px] leading-[1rem] text-surface-500">{card.desc}</p>
                                                        </div>
                                                    ))}
                                                </div>

                                                {customWelcomeCards.length > 0 && (
                                                    <a
                                                        href="/my-agents"
                                                        className="group mt-4 flex items-center justify-between gap-3 rounded-2xl border border-violet-200/70 bg-gradient-to-r from-violet-50/70 via-white to-white p-3 transition-all hover:border-violet-300 hover:shadow-sm"
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                                                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.09 4.26L18.5 7l-3.25 3.17L16 14.5 12 12.27 8 14.5l.75-4.33L5.5 7l4.41-.74L12 2z" /></svg>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-500">My Agents</p>
                                                                <p className="truncate text-[13px] font-semibold text-surface-900">
                                                                    {customWelcomeCards.length} custom {customWelcomeCards.length === 1 ? 'agent' : 'agents'} published from Studio
                                                                </p>
                                                                <p className="truncate text-[11px] text-surface-500">Browse, activate, and use your own agents in chat.</p>
                                                            </div>
                                                        </div>
                                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-700 group-hover:bg-violet-50">
                                                            Open My Agents →
                                                        </span>
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Active session empty state */}
                            {activeSessionId && messages.length === 0 && !streamingContent && !isProcessing && (
                                <div className="flex items-center justify-center min-h-[40vh]">
                                    <div className="text-center">
                                        {isFilegenieAgent ? (
                                            <>
                                                <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-cyan-50 flex items-center justify-center">
                                                    <FileIcon className="w-5 h-5 text-cyan-600" />
                                                </div>
                                                <p className="text-sm text-surface-700 font-semibold">FileGenie is ready</p>
                                                <p className="text-xs text-surface-500 mt-1 max-w-xs mx-auto leading-relaxed">
                                                    {filegenieRoot
                                                        ? <>Working with <span className="font-mono text-cyan-600 text-[11px]">{filegenieRoot}</span></>
                                                        : 'Select a folder below to get started'
                                                    }
                                                </p>
                                                <div className="mt-4 flex flex-wrap justify-center gap-2">
                                                    {['Organize my files', 'Summarize a PDF', 'Search for documents', 'List folder contents'].map(q => (
                                                        <button key={q}
                                                            onClick={() => sendMessage(q)}
                                                            disabled={!filegenieRoot}
                                                            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors border border-cyan-200/60 ${filegenieRoot
                                                                ? 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 cursor-pointer'
                                                                : 'bg-surface-50 text-surface-400 cursor-not-allowed'
                                                                }`}>
                                                            {q}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-surface-100 flex items-center justify-center">
                                                    <ChatBubbleIcon className="w-5 h-5 text-surface-400" />
                                                </div>
                                                <p className="text-sm text-surface-500 font-medium">Start the conversation</p>
                                                <p className="text-xs text-surface-400 mt-0.5">Type a message below to begin</p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                )}

                {/* Followup suggestion chips */}
                {activeSessionId && followups.length > 0 && !isProcessing && (
                    <div className="px-6 py-2 border-t border-surface-100/60 bg-white/60 backdrop-blur-sm">
                        <div className="max-w-3xl mx-auto">
                            <FollowupChips
                                followups={followups}
                                onSelect={handleFollowupSelect}
                                disabled={isProcessing}
                            />
                        </div>
                    </div>
                )}

                {/* FileGenie directory picker */}
                {isFilegenieAgent && activeSessionId && (
                    <DirectoryPicker
                        sessionId={activeSessionId}
                        currentRoot={filegenieRoot}
                        onRootChange={setFilegenieRoot}
                    />
                )}

                {/* Input */}
                {activeSessionId && (
                    <ChatInput
                        onSend={sendMessage}
                        onAbort={handleAbort}
                        isProcessing={isProcessing}
                        disabled={!activeSessionId}
                        placeholder={activeAgentConfig.placeholder}
                        prefillText={prefillText}
                        supportsImages={isVisionModel(model, modelGroups)}
                    />
                )}
            </div>
        </div>
    );
}
