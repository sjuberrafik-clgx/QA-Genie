'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSSE } from '@/hooks/useSSE';
import useModelCatalog from '@/hooks/useModelCatalog';
import useAgentCatalog from '@/hooks/useAgentCatalog';
import apiClient from '@/lib/api-client';
import { getDefaultModel, hasModelValue, isVisionModel } from '@/lib/model-options';
import { truncateTitle } from '@/lib/constants';
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
import ToolCallCard from '@/components/ToolCallCard';
import RobotMascotLogo from '@/components/RobotMascotLogo';
import useResetScrollOnRouteChange from '@/hooks/useResetScrollOnRouteChange';

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

const USER_INPUT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_INPUT_REQUEST_ID_RE = /^uir_[a-z0-9_\-]+$/i;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isOpaquePromptValue(value) {
    if (!isNonEmptyString(value)) return false;
    const trimmed = value.trim();
    return USER_INPUT_UUID_RE.test(trimmed) || USER_INPUT_REQUEST_ID_RE.test(trimmed);
}

function getDefaultUserInputQuestion(inputType = 'default') {
    if (inputType === 'credentials') return 'The agent needs your username and password to continue.';
    if (inputType === 'password') return 'The agent needs your password to continue.';
    if (inputType === 'confirmation') return 'The agent needs your confirmation to continue.';
    return 'The agent needs your input to continue.';
}

function normalizeUserInputRequestEvent(data = {}) {
    const nestedPayload = data.options && typeof data.options === 'object' && !Array.isArray(data.options)
        ? data.options
        : null;
    const meta = {
        ...(nestedPayload?.meta && typeof nestedPayload.meta === 'object' && !Array.isArray(nestedPayload.meta) ? nestedPayload.meta : {}),
        ...(data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {}),
    };
    const explicitType = isNonEmptyString(data.type) ? data.type : null;
    const nestedType = isNonEmptyString(nestedPayload?.type) ? nestedPayload.type : null;
    const inputType = explicitType && explicitType !== 'default'
        ? explicitType
        : (nestedType || explicitType || 'default');
    const options = Array.isArray(data.options)
        ? data.options
        : Array.isArray(nestedPayload?.options)
            ? nestedPayload.options
            : [];

    const candidates = [
        data.question,
        data.message,
        nestedPayload?.question,
        nestedPayload?.message,
    ].filter(isNonEmptyString).map(value => value.trim());

    let fallbackCandidate = '';
    let question = '';
    for (const candidate of candidates) {
        if (!fallbackCandidate) fallbackCandidate = candidate;
        if (!isOpaquePromptValue(candidate)) {
            question = candidate;
            break;
        }
    }

    if (!question) {
        question = isOpaquePromptValue(fallbackCandidate)
            ? getDefaultUserInputQuestion(inputType)
            : (fallbackCandidate || getDefaultUserInputQuestion(inputType));
    }

    return {
        requestId: data.requestId,
        question,
        options,
        type: inputType,
        meta,
        resolved: !!data.resolved,
    };
}

function hasRenderableMessageContent(message) {
    const content = message?.content || message?.data?.content || '';
    const attachments = message?.attachments || message?.data?.attachments || [];
    return (typeof content === 'string' && content.trim().length > 0)
        || (Array.isArray(attachments) && attachments.length > 0);
}

function mapChatMessage(message) {
    const mapped = {
        role: message?.role || message?.data?.role || 'assistant',
        content: message?.content || message?.data?.content || '',
        timestamp: message?.timestamp,
    };
    const attachments = message?.attachments || message?.data?.attachments;
    if (Array.isArray(attachments) && attachments.length > 0) {
        mapped.attachments = attachments;
    }
    if (message?.reasoning || message?.data?.reasoning) {
        mapped.reasoning = message.reasoning || message.data.reasoning;
    }
    return mapped;
}

function needsSessionResume(session) {
    return session?.runtimeState === 'resume_required'
        || session?.runtimeState === 'recovering'
        || session?.runtimeState === 'failed';
}

function isSessionBooting(session) {
    return session?.runtimeState === 'initializing'
        || session?.runtimeState === 'queued';
}

function sortSessionsByRecency(nextSessions = []) {
    return [...nextSessions].sort((a, b) => new Date(b.lastActivityAt || b.createdAt) - new Date(a.lastActivityAt || a.createdAt));
}

function mergeSessionSnapshots(previousSessions = [], incomingSessions = []) {
    const previousById = new Map(previousSessions.map(session => [session.sessionId, session]));
    const merged = incomingSessions.map(session => ({
        ...(previousById.get(session.sessionId) || {}),
        ...session,
    }));
    return sortSessionsByRecency(merged);
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

    const messagesEndRef = useRef(null);
    const messageScrollRef = useRef(null);
    const streamingContentRef = useRef('');
    const streamingReasoningRef = useRef('');
    const currentToolGroupRef = useRef(null);               // tracks the active tool group ID
    const createSessionInFlightRef = useRef(false);
    const autoLaunchedRef = useRef(false);

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
                streamingContentRef.current += data.deltaContent || '';
                setStreamingContent(streamingContentRef.current);
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
                        return [...prev, msg];
                    });
                }
                // Close current tool group so the next tool call starts a new one
                currentToolGroupRef.current = null;
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
                    // Create new tool group
                    const newGroupId = `tg_${Date.now()}`;
                    currentToolGroupRef.current = newGroupId;
                    return [...prev, { id: newGroupId, timestamp: ts, tools: [tool] }];
                });
                break;
            }

            case 'chat_tool_complete':
                setToolGroups(prev =>
                    prev.map(g => ({
                        ...g,
                        tools: g.tools.map(t => t.id === data.toolCallId
                            ? {
                                ...t,
                                status: 'complete',
                                result: data.result,
                                success: data.success,
                                attachments: Array.isArray(data.attachments) ? data.attachments : [],
                            }
                            : t
                        ),
                    }))
                );
                break;

            case 'chat_tool_progress':
                // Update the matching running tool with live progress info
                setToolGroups(prev =>
                    prev.map(g => ({
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
                    }))
                );
                break;

            case 'chat_reasoning':
                streamingReasoningRef.current += (data.deltaContent || '');
                setStreamingReasoning(streamingReasoningRef.current);
                break;

            case 'chat_idle':
                setIsProcessing(false);
                if (streamingContentRef.current) {
                    const idleReasoning = streamingReasoningRef.current || null;
                    setMessages(prev => {
                        const msg = { role: 'assistant', content: streamingContentRef.current, timestamp: ts };
                        if (idleReasoning) msg.reasoning = idleReasoning;
                        return [...prev, msg];
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
                    return [...prev, {
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
                });
                // Auto-scroll to show the prompt
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
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
                        return [...prev, msg];
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

    // Auto-scroll only when the timeline actually has conversational content.
    useEffect(() => {
        const hasTimelineContent = messages.length > 0
            || toolGroups.length > 0
            || userInputRequests.length > 0
            || Boolean(streamingContent)
            || Boolean(streamingReasoning);

        if (!activeSessionId || !hasTimelineContent) return;

        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeSessionId, messages, streamingContent, toolGroups, streamingReasoning, userInputRequests]);

    // Load sessions on mount
    useEffect(() => {
        loadSessions();
    }, []);

    useEffect(() => {
        if (sessions.length === 0) return undefined;

        let disposed = false;
        const poll = async () => {
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

        const timer = setInterval(poll, 3000);
        return () => {
            disposed = true;
            clearInterval(timer);
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
                setMessages(
                    history
                        .filter(hasRenderableMessageContent)
                        .map(mapChatMessage)
                );
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

        try {
            await ensureLiveSession(activeSessionId);
        } catch (err) {
            setError(`Failed to send: ${err.message}`);
            setIsProcessing(false);
            return;
        }

        // Build user message with optional attachments for local display
        const userMessage = { role: 'user', content, timestamp: new Date().toISOString() };
        const allLocalAttachments = [
            ...imageAttachments, // { id, name, type, size, dataUrl, base64, kind:'image' }
            ...docAttachments.map(d => ({ ...d, kind: 'document' })),
            ...videoAttachments.map(v => ({ ...v, kind: 'video' })),
        ];
        if (allLocalAttachments.length > 0) {
            userMessage.attachments = allLocalAttachments;
        }

        setMessages(prev => [...prev, userMessage]);
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
    }, [activeSessionId, ensureLiveSession, model, upsertSessionMeta]);

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
    const handleUserInputSubmit = async (requestId, answer) => {
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
    };

    // Build merged timeline: interleave messages + tool groups + user-input prompts by timestamp (memoized)
    const timeline = useMemo(() => {
        // Combine all timeline-worthy items with their timestamps and types
        const items = [
            ...messages.map((m, i) => ({ type: 'message', data: m, key: `msg_${i}`, ts: m.timestamp || '' })),
            ...toolGroups.map(g => ({ type: 'tools', data: g, key: `tg_${g.id}`, ts: g.timestamp || '' })),
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
    }, [messages, toolGroups, userInputRequests]);

    // Count active (running) tools across all groups
    const runningToolCount = toolGroups.reduce((acc, g) => acc + g.tools.filter(t => t.status === 'running').length, 0);

    return (
        <div className="flex h-screen min-h-0 bg-surface-50 overflow-hidden">
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

                        {/* Interleaved timeline: messages + tool groups + user-input prompts in chronological order */}
                        {timeline.map((item) => {
                            if (item.type === 'message') {
                                return (
                                    <div key={item.key}>
                                        {/* Per-message reasoning (persisted from history) */}
                                        {item.data.reasoning && (
                                            <ReasoningPanel
                                                reasoning={item.data.reasoning}
                                                compact
                                            />
                                        )}
                                        <ChatMessage message={item.data} />
                                    </div>
                                );
                            }
                            if (item.type === 'user_input') {
                                const req = item.data;
                                return (
                                    <UserInputPrompt
                                        key={item.key}
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
                            }
                            if (item.type === 'approval_batch') {
                                return (
                                    <ApprovalBatch
                                        key={item.key}
                                        requests={item.data}
                                        onSubmit={handleUserInputSubmit}
                                        disabled={!isProcessing}
                                    />
                                );
                            }
                            // Tool group — delegated to ToolCallCard component
                            const group = item.data;
                            return (
                                <ToolCallCard key={item.key} group={group} />
                            );
                        })}

                        {/* Streaming reasoning — live thinking display */}
                        {streamingReasoning && (
                            <ReasoningPanel
                                reasoning={streamingReasoning}
                                isStreaming
                                defaultExpanded
                            />
                        )}

                        {/* Streaming content */}
                        {streamingContent && (
                            <ChatMessage message={{ role: 'assistant', content: streamingContent }} isStreaming />
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                </div>

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
