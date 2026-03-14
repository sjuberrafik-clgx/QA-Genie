'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSSE } from '@/hooks/useSSE';
import useModelCatalog from '@/hooks/useModelCatalog';
import apiClient from '@/lib/api-client';
import { getDefaultModel, hasModelValue, isVisionModel } from '@/lib/model-options';
import { truncateTitle } from '@/lib/constants';
import ChatMessage from '@/components/ChatMessage';
import ChatInput from '@/components/ChatInput';
import SessionList from '@/components/SessionList';
import ModelSelect from '@/components/ModelSelect';
import AgentSelect from '@/components/AgentSelect';
import { AGENT_MODES, getAgentConfig } from '@/lib/agent-options';
import { DocumentIcon, CodeIcon, GlobeIcon, PlayIcon, SparkleIcon, MenuIcon, ChatBubbleIcon, WrenchIcon, CheckIcon, XIcon, FileIcon } from '@/components/Icons';
import DirectoryPicker from '@/components/DirectoryPicker';
import ErrorBanner from '@/components/ErrorBanner';
import FollowupChips from '@/components/FollowupChips';
import UserInputPrompt from '@/components/UserInputPrompt';
import ReasoningPanel from '@/components/ReasoningPanel';
import ToolCallCard from '@/components/ToolCallCard';
import RobotMascotLogo from '@/components/RobotMascotLogo';
import useResetScrollOnRouteChange from '@/hooks/useResetScrollOnRouteChange';

const AGENT_ICON_MAP = {
    tpm: SparkleIcon,
    document: DocumentIcon,
    code: CodeIcon,
    bug: WrenchIcon,
    task: CheckIcon,
    file: FileIcon,
};

const AGENT_WELCOME_COPY = {
    null: 'Unified command mode for planning, test generation, automation, bugs, tasks, and file workflows.',
    testgenie: 'Turn Jira context into optimized manual test cases and Excel-ready test steps.',
    scriptgenerator: 'Generate Playwright automation with MCP-backed exploration and stable selector discovery.',
    buggenie: 'Convert failures and evidence into structured Jira defect tickets.',
    taskgenie: 'Create linked testing tasks with assignment-ready Jira details.',
    filegenie: 'Browse, organize, and inspect local files in the directory you explicitly choose for that chat.',
};

const WELCOME_AGENT_CARDS = AGENT_MODES.map((agent) => ({
    ...agent,
    desc: AGENT_WELCOME_COPY[String(agent.value)] || agent.description,
    Icon: AGENT_ICON_MAP[agent.icon] || SparkleIcon,
}));

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

export default function ChatPage() {
    const {
        groups: modelGroups,
        defaultModel,
        source: modelCatalogSource,
        warnings: modelCatalogWarnings,
        error: modelCatalogError,
        loading: modelCatalogLoading,
    } = useModelCatalog();

    const [sessions, setSessions] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [messages, setMessages] = useState([]);           // { role, content, timestamp }
    const [toolGroups, setToolGroups] = useState([]);       // [{ id, timestamp, tools: [...] }]
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingReasoning, setStreamingReasoning] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);
    const [model, setModelState] = useState('');
    const [modelTouched, setModelTouched] = useState(false);
    const [agentMode, setAgentMode] = useState(null);       // null = TPM (all agent capabilities), 'testgenie', 'scriptgenerator', 'buggenie', 'taskgenie'
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

    useResetScrollOnRouteChange([messageScrollRef]);

    const setModel = useCallback((nextModel) => {
        setModelTouched(true);
        setModelState(nextModel);
    }, []);

    // SSE connection for active chat session
    const streamUrl = activeSessionId ? apiClient.getChatStreamUrl(activeSessionId) : null;

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
                            ? { ...t, status: 'complete', result: data.result, success: data.success }
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

            case 'chat_user_input_request':
                setUserInputRequests(prev => {
                    // Avoid duplicates (e.g. from history replay)
                    if (prev.some(r => r.requestId === data.requestId)) {
                        // If replayed with resolved flag, update it
                        if (data.resolved) {
                            return prev.map(r => r.requestId === data.requestId
                                ? { ...r, resolved: true }
                                : r
                            );
                        }
                        return prev;
                    }
                    return [...prev, {
                        requestId: data.requestId,
                        question: data.question,
                        options: data.options || [],
                        type: data.type || 'default',
                        timestamp: ts,
                        resolved: data.resolved || false,
                        resolvedAnswer: null,
                        auto: false,
                    }];
                });
                // Auto-scroll to show the prompt
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                break;

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

    const { status: sseStatus } = useSSE(streamUrl, { onEvent: handleSSEEvent });

    // Auto-scroll to bottom on any content change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, streamingContent, toolGroups, streamingReasoning]);

    // Load sessions on mount
    useEffect(() => {
        loadSessions();
    }, []);

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
            const data = await apiClient.listChatSessions();
            const all = Array.isArray(data) ? data : [];
            // Auto-cleanup: remove empty sessions (no messages) from previous visits
            const active = all.filter(s => s.messageCount > 0);
            const empty = all.filter(s => s.messageCount === 0);
            setSessions(active);
            // Background delete — don't block UI or show errors
            empty.forEach(s => apiClient.deleteChatSession(s.sessionId).catch(() => { }));
        } catch {
            // Backend may not be running yet
        }
    };

    const createSession = async (overrideAgent) => {
        // Guard: only accept string or null — prevents React SyntheticEvent from onClick
        const agentForSession = (typeof overrideAgent === 'string' || overrideAgent === null)
            ? overrideAgent
            : agentMode;

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
            if (agentForSession !== agentMode) setAgentMode(agentForSession);
        };

        try {
            setError(null);
            setIsProcessing(false);
            const selectedModel = model || defaultModel || getDefaultModel(modelGroups);
            const session = await apiClient.createChatSession(selectedModel, agentForSession);
            applyNewSession(session);
            // Show welcome followup suggestions from the server
            if (Array.isArray(session.followups) && session.followups.length > 0) {
                setFollowups(session.followups);
            }
        } catch (err) {
            // Retry once on abort/signal errors (common with MCP server cold-start)
            if (err.message && (err.message.includes('abort') || err.message.includes('signal'))) {
                console.warn('[Chat] Session creation aborted, retrying...', err.message);
                try {
                    const selectedModel = model || defaultModel || getDefaultModel(modelGroups);
                    const session = await apiClient.createChatSession(selectedModel, agentForSession);
                    applyNewSession(session);
                    if (Array.isArray(session.followups) && session.followups.length > 0) {
                        setFollowups(session.followups);
                    }
                    setError(null);
                    return;
                } catch (retryErr) {
                    setError(`Failed to create session (retry): ${retryErr.message}`);
                    return;
                }
            }
            setError(`Failed to create session: ${err.message}`);
        }
    };

    const switchSession = async (sessionId) => {
        // Auto-delete the session we're leaving if it has no messages
        if (activeSessionId && activeSessionId !== sessionId && messages.length === 0) {
            apiClient.deleteChatSession(activeSessionId).catch(() => { });
            setSessions(prev => prev.filter(s => s.sessionId !== activeSessionId));
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

        // Restore agentMode from session metadata
        const sessionMeta = sessions.find(s => s.sessionId === sessionId);
        if (sessionMeta) {
            setAgentMode(sessionMeta.agentMode || null);
            // Restore FileGenie root if switching to a filegenie session
            if (sessionMeta.agentMode === 'filegenie') {
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

    const sendMessage = async (content, imageAttachments = [], docAttachments = [], videoAttachments = []) => {
        if (!activeSessionId || (!content.trim() && imageAttachments.length === 0 && docAttachments.length === 0 && videoAttachments.length === 0)) return;

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

            await apiClient.sendChatMessage(activeSessionId, content || defaultContent, finalAttachments, model);
        } catch (err) {
            setError(`Failed to send: ${err.message}`);
            setIsProcessing(false);
        }
    };

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
    const handleAgentChange = async (newAgent) => {
        if (newAgent === agentMode) return;
        setAgentMode(newAgent);
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

        // If no active session, just update state — next createSession will use it
        if (!activeSessionId) return;

        // If current session has messages, keep it and create a new one
        // If empty, destroy the empty session first
        const currentSession = sessions.find(s => s.sessionId === activeSessionId);
        if (currentSession && (currentSession.messageCount === 0) && messages.length === 0) {
            // Empty session — destroy before creating new
            try { await apiClient.deleteChatSession(activeSessionId); } catch { /* ignore */ }
            setSessions(prev => prev.filter(s => s.sessionId !== activeSessionId));
        }

        // Create new session with the new agent
        await createSession(newAgent);
    };

    const handleFollowupSelect = (followup) => {
        if (!activeSessionId || isProcessing) return;
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

    const activeAgentConfig = getAgentConfig(agentMode);

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
        return items;
    }, [messages, toolGroups, userInputRequests]);

    // Count active (running) tools across all groups
    const runningToolCount = toolGroups.reduce((acc, g) => acc + g.tools.filter(t => t.status === 'running').length, 0);

    return (
        <div className="flex h-screen bg-surface-50 overflow-hidden">
            {/* Session Sidebar */}
            <SessionList
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelect={switchSession}
                onCreate={createSession}
                onDelete={deleteSession}
                isOpen={sidebarOpen}
                onToggle={() => setSidebarOpen(prev => !prev)}
            />

            {/* Chat Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header — frosted glass */}
                <div className="px-6 py-3 border-b border-surface-200/60 bg-white/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
                    <div className="flex items-center gap-3">
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
                        <div>
                            <h1 className="text-sm font-bold text-surface-900 leading-tight">AI Chat Assistant</h1>
                            <p className="text-[11px] text-surface-500 truncate max-w-[280px]">
                                {activeSessionId
                                    ? (sessions.find(s => s.sessionId === activeSessionId)?.title || `Session ${activeSessionId.substring(0, 8)}`)
                                    : 'Conversation workspace'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 min-w-0 overflow-visible">
                        <AgentSelect value={agentMode} onChange={handleAgentChange} disabled={isProcessing} />
                        <ModelSelect value={model} onChange={setModel} groups={modelGroups} loading={modelCatalogLoading} className="w-[170px] flex-shrink-0" />
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

                {/* Error banner */}
                {error && (
                    <div className="px-6 pt-3">
                        <ErrorBanner error={error} onDismiss={() => setError(null)} className="max-w-4xl mx-auto" />
                    </div>
                )}

                {/* Messages area */}
                <div ref={messageScrollRef} className="flex-1 overflow-y-auto">
                    <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">
                        {/* Empty state — capability cards */}
                        {!activeSessionId && (
                            <div className="flex min-h-full items-center justify-center py-2 xl:py-4">
                                <div className="w-full max-w-6xl">
                                    <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)] xl:items-center">
                                        <div className="rounded-[28px] border border-surface-200/80 bg-[radial-gradient(circle_at_24%_18%,rgba(180,92,255,0.16),transparent_32%),radial-gradient(circle_at_78%_78%,rgba(31,158,171,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] px-6 py-6 text-center shadow-[0_22px_55px_rgba(15,23,42,0.08)] xl:px-7 xl:py-7 xl:text-left">
                                            <div className="flex items-center justify-center xl:justify-start">
                                                <div className="relative rounded-[28px] border border-surface-200/70 bg-white/70 px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                                                    <div className="absolute inset-x-8 bottom-2 h-4 rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.18),rgba(31,158,171,0.12),transparent_72%)] blur-lg" />
                                                    <RobotMascotLogo size={108} emphasis="hero" mood="glossy" className="relative z-[1]" />
                                                </div>
                                            </div>
                                            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-brand-50/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-600">
                                                <SparkleIcon className="w-3.5 h-3.5" />
                                                Conversation workspace
                                            </div>
                                            <h2 className="mt-3 text-[1.65rem] font-bold tracking-tight text-surface-900">QA Automation Assistant</h2>
                                            <p className="mt-2 text-sm leading-7 text-surface-500 xl:max-w-md">
                                                Start a new session from the primary action below, then stay with TPM for full workflow coverage or switch to a specialist agent for focused work.
                                            </p>

                                            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5 xl:justify-start">
                                                <span className="inline-flex items-center rounded-full border border-surface-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-surface-600">
                                                    6 agent modes ready
                                                </span>
                                                <span className="inline-flex items-center rounded-full border border-surface-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-surface-600">
                                                    TPM selected by default
                                                </span>
                                            </div>

                                            <div className="mt-6 flex flex-col items-center gap-3 xl:items-start">
                                                <button
                                                    onClick={() => createSession()}
                                                    className="gradient-brand text-white rounded-xl px-6 py-3 text-sm font-semibold shadow-md shadow-brand-500/20 hover:shadow-lg hover:shadow-brand-500/30 transition-all"
                                                >
                                                    Start New Chat
                                                </button>
                                                <p className="text-[12px] leading-6 text-surface-500 xl:max-w-sm">
                                                    A new session opens the composer immediately so users can start asking questions without extra setup.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="rounded-[28px] border border-surface-200/80 bg-white/92 p-4 shadow-[0_20px_48px_rgba(15,23,42,0.06)] xl:p-5">
                                            <div className="mb-4 flex items-center justify-between gap-3">
                                                <div className="text-left">
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-400">Agent modes</p>
                                                    <h3 className="mt-1 text-lg font-semibold tracking-tight text-surface-900">Pick the mode that matches the work.</h3>
                                                </div>
                                                <div className="hidden rounded-full border border-brand-100 bg-brand-50/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-600 sm:inline-flex">
                                                    No scroll needed
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                {WELCOME_AGENT_CARDS.map((card) => (
                                                    <div key={card.value ?? 'default'} className="text-left rounded-2xl border border-surface-200/80 bg-surface-50/60 p-3.5 transition-all hover:border-brand-200 hover:bg-white hover:shadow-sm group cursor-default">
                                                        <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${card.bgClass} ${card.textClass}`}>
                                                            <card.Icon className="w-4 h-4" />
                                                        </div>
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            <h3 className="text-[13px] font-semibold text-surface-800 leading-tight">{card.label}</h3>
                                                            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${card.badgeBg} ${card.badgeText}`}>
                                                                {card.shortLabel}
                                                            </span>
                                                        </div>
                                                        <p className="text-[11px] leading-5 text-surface-500">{card.desc}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Active session empty state */}
                        {activeSessionId && messages.length === 0 && !streamingContent && !isProcessing && (
                            <div className="flex items-center justify-center min-h-[40vh]">
                                <div className="text-center">
                                    {agentMode === 'filegenie' ? (
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
                                        resolved={req.resolved}
                                        resolvedAnswer={req.resolvedAnswer}
                                        auto={req.auto}
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
                {agentMode === 'filegenie' && activeSessionId && (
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
