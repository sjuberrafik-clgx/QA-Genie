'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import apiClient from '@/lib/api-client';
import PageHeader from '@/components/PageHeader';
import ErrorBanner from '@/components/ErrorBanner';
import BouncingLoader from '@/components/BouncingLoader';
import { CalendarIcon, CheckIcon, ChatBubbleIcon, PlusIcon, PlayIcon, ChevronDownIcon, ChevronRightIcon, LightningIcon, XIcon, ClockIcon, ClipboardIcon, SearchIcon } from '@/components/Icons';

// ─── Static metadata ─────────────────────────────────────────────────────────

const ACTION_TYPES = [
    { value: 'jira.transition', label: 'Transition / close a ticket', description: 'Move a ticket to a target status', Icon: CheckIcon },
    { value: 'jira.comment', label: 'Add a comment', description: 'Post a comment on a ticket', Icon: ChatBubbleIcon },
    { value: 'jira.create', label: 'Create a ticket', description: 'Compose a Bug, Story, or Task', Icon: PlusIcon },
    { value: 'pipeline.run', label: 'Run a pipeline', description: 'Kick off a test run for a ticket', Icon: PlayIcon },
    { value: 'agent.invoke', label: 'Run an agent', description: 'Have an agent perform a task from a prompt', Icon: LightningIcon },
];

const ISSUE_TYPES = ['Bug', 'Story', 'Task'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const PIPELINE_MODES = ['full', 'testcase', 'generate', 'heal', 'execute'];

// Attachment limits for the "Run an agent" action (match chat + backend).
const ATTACH_MAX_IMAGES = 3;
const ATTACH_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ATTACH_MAX_VIDEOS = 1;
const ATTACH_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

const DELAY_UNITS = [
    { value: 'minutes', label: 'minutes', ms: 60_000 },
    { value: 'hours', label: 'hours', ms: 3_600_000 },
    { value: 'days', label: 'days', ms: 86_400_000 },
];

const STATUS_TONES = {
    scheduled: 'bg-sky-100 text-sky-700 ring-sky-200',
    running: 'bg-amber-100 text-amber-800 ring-amber-200',
    completed: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    failed: 'bg-rose-100 text-rose-700 ring-rose-200',
    cancelled: 'bg-surface-100 text-surface-600 ring-surface-200',
    missed: 'bg-orange-100 text-orange-700 ring-orange-200',
};

// Job list filter tabs — each carries a matcher so counts + filtering stay in sync.
const JOB_FILTERS = [
    { value: 'all', label: 'All', match: () => true },
    { value: 'pending', label: 'Pending', match: (j) => j.status === 'scheduled' || j.status === 'running' },
    { value: 'completed', label: 'Completed', match: (j) => j.status === 'completed' },
    { value: 'failed', label: 'Failed', match: (j) => j.status === 'failed' || j.status === 'missed' },
    { value: 'cancelled', label: 'Cancelled', match: (j) => j.status === 'cancelled' },
];

const JOBS_PAGE_SIZE = 8;


const TICKET_RE = /^[A-Za-z][A-Za-z0-9]+-\d+$/;
const BROWSER_TZ = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function friendlyAgentId(id) {
    if (!id) return 'agent';
    return String(id).split(':').pop() || String(id);
}

function describeAction(action = {}) {
    const p = action.params || {};
    switch (action.type) {
        case 'jira.transition':
            return `Transition ${p.ticketId || '?'} → ${p.targetStatus || p.transitionId || '?'}`;
        case 'jira.comment':
            return `Comment on ${p.ticketId || '?'}`;
        case 'jira.create':
            return `Create ${p.issueType || 'ticket'}: ${p.summary || ''}`;
        case 'pipeline.run':
            return `Run pipeline for ${p.ticketId || '?'} (${p.mode || 'full'})`;
        case 'agent.invoke':
            return p.agentLabel || friendlyAgentId(p.agentId);
        default:
            return action.type || 'Unknown action';
    }
}

function relativeTo(iso) {
    if (!iso) return '';
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    const mins = Math.round(abs / 60000);
    if (mins < 1) return diff >= 0 ? 'in <1 min' : 'just now';
    if (mins < 60) return diff >= 0 ? `in ${mins} min` : `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return diff >= 0 ? `in ${hours} h` : `${hours} h ago`;
    const days = Math.round(hours / 24);
    return diff >= 0 ? `in ${days} d` : `${days} d ago`;
}

// ─── Custom action dropdown (icons + descriptions) ───────────────────────────

function ActionDropdown({ value, onChange, options }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
    }, [open]);

    const selected = options.find(o => o.value === value) || options[0];
    const SelectedIcon = selected.Icon;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-left transition-all duration-150 ${open ? 'border-sky-400 ring-2 ring-sky-100' : 'border-surface-200 hover:border-sky-300 hover:bg-sky-50/30'}`}
            >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><SelectedIcon className="w-4 h-4" /></span>
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-surface-800">{selected.label}</span>
                    <span className="block text-[11px] text-surface-400 truncate">{selected.description}</span>
                </span>
                <ChevronDownIcon className={`w-4 h-4 shrink-0 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-surface-200 bg-white p-1.5 shadow-xl shadow-surface-900/10">
                    {options.map((o) => {
                        const OptionIcon = o.Icon;
                        const active = o.value === value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                onClick={() => { onChange(o.value); setOpen(false); }}
                                className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-sky-50' : 'hover:bg-surface-50'}`}
                            >
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-sky-600 text-white' : 'bg-surface-100 text-surface-500'}`}><OptionIcon className="w-4 h-4" /></span>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-semibold text-surface-800">{o.label}</span>
                                    <span className="block text-[11px] text-surface-400">{o.description}</span>
                                </span>
                                {active && <CheckIcon className="w-4 h-4 shrink-0 text-sky-600" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Custom agent dropdown (avatars + grouped core / custom) ─────────────────

const AGENT_AVATAR_TONES = [
    'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-indigo-100 text-indigo-700',
    'bg-teal-100 text-teal-700', 'bg-fuchsia-100 text-fuchsia-700',
];

function agentInitials(label) {
    if (!label) return '?';
    const words = String(label).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function agentTone(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AGENT_AVATAR_TONES[h % AGENT_AVATAR_TONES.length];
}

function AgentDropdown({ value, onChange, agents }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
    }, [open]);

    const selected = agents.find(a => a.id === value) || null;
    const core = agents.filter(a => a.source !== 'workspace');
    const custom = agents.filter(a => a.source === 'workspace');

    const renderOption = (a) => {
        const active = a.id === value;
        return (
            <button
                key={a.id}
                type="button"
                onClick={() => { onChange(a.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-sky-50' : 'hover:bg-surface-50'}`}
            >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${agentTone(a.id)}`}>{agentInitials(a.label)}</span>
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-surface-800 truncate">{a.label}</span>
                    {a.description && <span className="block text-[11px] text-surface-400 truncate">{a.description}</span>}
                </span>
                {active && <CheckIcon className="w-4 h-4 shrink-0 text-sky-600" />}
            </button>
        );
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                disabled={agents.length === 0}
                className={`w-full flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-left transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed ${open ? 'border-sky-400 ring-2 ring-sky-100' : 'border-surface-200 hover:border-sky-300 hover:bg-sky-50/30'}`}
            >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${selected ? agentTone(selected.id) : 'bg-surface-100 text-surface-400'}`}>{selected ? agentInitials(selected.label) : '?'}</span>
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-surface-800 truncate">{selected ? selected.label : (agents.length ? 'Select an agent' : 'No agents available')}</span>
                    <span className="block text-[11px] text-surface-400 truncate">{selected?.description || (selected?.source === 'workspace' ? 'Custom agent' : 'Core specialist')}</span>
                </span>
                <ChevronDownIcon className={`w-4 h-4 shrink-0 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && agents.length > 0 && (
                <div className="absolute z-50 mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl border border-surface-200 bg-white p-1.5 shadow-xl shadow-surface-900/10">
                    {core.length > 0 && <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-surface-400">Core agents</p>}
                    {core.map(renderOption)}
                    {custom.length > 0 && <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-surface-400">Custom agents</p>}
                    {custom.map(renderOption)}
                </div>
            )}
        </div>
    );
}

function ReviewRow({ label, value }) {
    return (
        <div className="flex items-start gap-3 px-3 py-2">
            <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-surface-400">{label}</span>
            <span className="flex-1 text-[13px] font-medium text-surface-700 break-words">{value}</span>
        </div>
    );
}

// ─── Reusable styled dropdown (replaces native <select> for a consistent look) ─

function SimpleDropdown({ value, onChange, options, ariaLabel }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    // Normalize to { value, label } tuples so callers can pass plain strings too.
    const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));

    useEffect(() => {
        if (!open) return undefined;
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
    }, [open]);

    const selected = items.find(o => o.value === value) || items[0];

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-left transition-all duration-150 ${open ? 'border-sky-400 ring-2 ring-sky-100' : 'border-surface-200 hover:border-sky-300 hover:bg-sky-50/30'}`}
            >
                <span className="truncate text-sm font-medium text-surface-800">{selected?.label ?? '—'}</span>
                <ChevronDownIcon className={`w-4 h-4 shrink-0 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div role="listbox" className="absolute z-50 mt-1.5 w-full max-h-60 overflow-y-auto rounded-xl border border-surface-200 bg-white p-1.5 shadow-xl shadow-surface-900/10">
                    {items.map((o) => {
                        const active = o.value === value;
                        return (
                            <button
                                key={o.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => { onChange(o.value); setOpen(false); }}
                                className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors ${active ? 'bg-sky-50 text-sky-700' : 'text-surface-700 hover:bg-surface-50'}`}
                            >
                                <span className="truncate">{o.label}</span>
                                {active && <CheckIcon className="w-4 h-4 shrink-0 text-sky-600" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Job detail helpers ──────────────────────────────────────────────────────

function resultOutputText(job) {
    const r = job?.result;
    if (!r) return '';
    if (typeof r.output === 'string' && r.output.trim()) return r.output.trim();
    if (typeof r.outcome === 'string' && r.outcome.trim()) return r.outcome.trim();
    return '';
}

function formatDuration(job) {
    const sec = job?.result?.durationSec;
    if (Number.isFinite(sec) && sec > 0) {
        if (sec < 60) return `${sec}s`;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return s ? `${m}m ${s}s` : `${m}m`;
    }
    if (job?.firedAt && job?.completedAt) {
        const ms = new Date(job.completedAt).getTime() - new Date(job.firedAt).getTime();
        if (ms > 0) return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
    }
    return null;
}

/** Structured [label, value] rows describing an action's parameters. */
function actionParamRows(action = {}) {
    const p = action.params || {};
    const rows = [];
    switch (action.type) {
        case 'jira.transition':
            rows.push(['Ticket', p.ticketId], ['Target status', p.targetStatus || p.transitionId]);
            if (p.resolution) rows.push(['Resolution', p.resolution]);
            break;
        case 'jira.comment':
            rows.push(['Ticket', p.ticketId], ['Comment', p.comment]);
            break;
        case 'jira.create':
            rows.push(['Project', p.projectKey || 'Default project'], ['Type', p.issueType], ['Priority', p.priority], ['Summary', p.summary]);
            if (p.description) rows.push(['Description', p.description]);
            if (Array.isArray(p.labels) && p.labels.length) rows.push(['Labels', p.labels.join(', ')]);
            break;
        case 'pipeline.run':
            rows.push(['Ticket', p.ticketId], ['Mode', p.mode || 'full'], ['Environment', p.environment || 'UAT']);
            break;
        case 'agent.invoke':
            rows.push(['Agent', p.agentLabel || friendlyAgentId(p.agentId)], ['Prompt', p.prompt]);
            if (Array.isArray(p.attachments) && p.attachments.length) {
                rows.push(['Attachments', p.attachments.map(a => a.filename).join(', ')]);
            }
            break;
        default:
            break;
    }
    return rows.filter(r => r && r[1]);
}

function DetailField({ label, value }) {
    return (
        <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-400">{label}</p>
            <p className="mt-0.5 text-[13px] font-medium text-surface-700">{value}</p>
        </div>
    );
}

// ─── Job detail drawer (slide-over) ──────────────────────────────────────────

function JobDetailDrawer({ job, onClose, onRunNow, onCancel }) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const esc = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [onClose]);

    if (!job || typeof document === 'undefined') return null;

    const tone = STATUS_TONES[job.status] || STATUS_TONES.scheduled;
    const output = resultOutputText(job);
    const rows = actionParamRows(job.action);
    const duration = formatDuration(job);
    const history = Array.isArray(job.history) ? [...job.history].slice().reverse() : [];

    const copyOutput = async () => {
        try {
            await navigator.clipboard.writeText(output);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable — no-op */ }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[9998] flex justify-end bg-surface-900/40 backdrop-blur-sm"
            style={{ animation: 'chatTableModalIn 0.18s ease-out' }}
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Scheduled job details"
                onClick={(e) => e.stopPropagation()}
                style={{ animation: 'schedulerDrawerIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}
                className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 border-b border-surface-200 px-5 py-4">
                    <div className="min-w-0">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}>
                            {job.status}
                        </span>
                        <h3 className="mt-2 text-[15px] font-semibold leading-snug text-surface-900 break-words">{describeAction(job.action)}</h3>
                        <p className="mt-0.5 text-[11px] text-surface-400">{job.action?.type}</p>
                    </div>
                    <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600" aria-label="Close details">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* Timing */}
                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-surface-200 bg-surface-50/60 p-3.5">
                        <DetailField label="Scheduled for" value={formatDateTime(job.schedule?.runAt)} />
                        <DetailField label="Timezone" value={job.schedule?.timezone || 'UTC'} />
                        {job.firedAt && <DetailField label="Fired at" value={formatDateTime(job.firedAt)} />}
                        {job.completedAt && <DetailField label="Completed at" value={formatDateTime(job.completedAt)} />}
                        {duration && <DetailField label="Duration" value={duration} />}
                        {job.attempts > 0 && <DetailField label="Attempts" value={`${job.attempts}${job.maxAttempts ? ` / ${job.maxAttempts}` : ''}`} />}
                    </div>

                    {/* Action parameters */}
                    {rows.length > 0 && (
                        <div>
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-400">Action details</p>
                            <div className="divide-y divide-surface-200/70 rounded-xl border border-surface-200 bg-white">
                                {rows.map(([label, value]) => (
                                    <div key={label} className="flex items-start gap-3 px-3 py-2">
                                        <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-surface-400">{label}</span>
                                        <span className="flex-1 whitespace-pre-wrap break-words text-[13px] font-medium text-surface-700">{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Result / output */}
                    {output && (
                        <div>
                            <div className="mb-1.5 flex items-center justify-between">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-400">Result</p>
                                <button onClick={copyOutput} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600">
                                    <ClipboardIcon className="w-3 h-3" /> {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-surface-200 bg-surface-50/60 p-3 text-[13px] leading-relaxed text-surface-700">
                                {output}
                            </div>
                        </div>
                    )}

                    {/* Ticket link */}
                    {job.result?.ticketUrl && (
                        <a href={job.result.ticketUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-2 text-[12px] font-semibold text-sky-700 transition-colors hover:bg-sky-100">
                            View ticket →
                        </a>
                    )}

                    {/* Error */}
                    {job.lastError && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-500">Error</p>
                            <p className="whitespace-pre-wrap break-words text-[13px] font-medium text-rose-700">{job.lastError}</p>
                        </div>
                    )}

                    {/* History timeline */}
                    {history.length > 0 && (
                        <div>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-400">Timeline</p>
                            <ol className="space-y-0">
                                {history.map((h, i) => (
                                    <li key={`${h.at}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                                        <div className="flex flex-col items-center">
                                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-400 ring-2 ring-sky-100" />
                                            {i < history.length - 1 && <span className="w-px flex-1 bg-surface-200" />}
                                        </div>
                                        <div className="min-w-0 flex-1 -mt-0.5">
                                            <p className="text-[12px] font-semibold capitalize text-surface-700">{String(h.event || '').replace(/[._-]/g, ' ')}</p>
                                            {h.detail && <p className="mt-0.5 break-words text-[12px] text-surface-500">{h.detail}</p>}
                                            <p className="mt-0.5 text-[10.5px] text-surface-400">{formatDateTime(h.at)}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>

                {/* Footer actions — only pending jobs can be run/cancelled */}
                {job.status === 'scheduled' && (
                    <div className="flex gap-2 border-t border-surface-200 px-5 py-3">
                        <button
                            onClick={() => onRunNow(job.jobId)}
                            className="flex-1 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
                        >
                            Run now
                        </button>
                        <button
                            onClick={() => onCancel(job.jobId)}
                            className="flex-1 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100"
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
    const [jobs, setJobs] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    // Jobs list controls (scale as job count grows)
    const [jobFilter, setJobFilter] = useState('all');   // all | pending | completed | failed | cancelled
    const [jobSearch, setJobSearch] = useState('');
    const [visibleCount, setVisibleCount] = useState(JOBS_PAGE_SIZE);
    const [detailJobId, setDetailJobId] = useState(null);

    // Form state
    const [actionType, setActionType] = useState('jira.transition');
    const [ticketId, setTicketId] = useState('');
    const [targetStatus, setTargetStatus] = useState('Done');
    const [resolution, setResolution] = useState('');
    const [comment, setComment] = useState('');
    const [pipelineMode, setPipelineMode] = useState('full');
    const [environment, setEnvironment] = useState('UAT');

    // Create-ticket fields
    const [projectKey, setProjectKey] = useState('');
    const [issueType, setIssueType] = useState('Task');
    const [summary, setSummary] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('Medium');
    const [labels, setLabels] = useState('');
    const [reviewing, setReviewing] = useState(false);

    // Agent-invoke fields
    const [agentId, setAgentId] = useState('');
    const [agentPrompt, setAgentPrompt] = useState('');
    const [availableAgents, setAvailableAgents] = useState([]);
    const [agentAttachments, setAgentAttachments] = useState([]); // { id, kind:'image'|'video', name, media_type, data?, tempPath?, size, previewUrl? }
    const [attachmentError, setAttachmentError] = useState(null);
    const [uploadingRecording, setUploadingRecording] = useState(false);

    // Schedule state
    const [scheduleMode, setScheduleMode] = useState('in'); // 'in' | 'at'
    const [delayValue, setDelayValue] = useState(30);
    const [delayUnit, setDelayUnit] = useState('minutes');
    const [runAtLocal, setRunAtLocal] = useState('');

    const loadJobs = useCallback(async () => {
        try {
            const data = await apiClient.listSchedulerJobs({ limit: 200 });
            setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
            setStats(data?.stats || null);
            setError(null);
        } catch (err) {
            setError(`Failed to load scheduled jobs: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial load + polling every 5s
    useEffect(() => {
        loadJobs();
        const timer = setInterval(loadJobs, 5000);
        return () => clearInterval(timer);
    }, [loadJobs]);

    // Auto-dismiss transient notices
    useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(t);
    }, [notice]);

    // Load available agents for the "Run an agent" action (core specialists + published studio agents)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiClient.listChatAgents();
                const items = Array.isArray(data?.items) ? data.items : [];
                // Exclude the master/TPM — its full-pipeline capability is covered by the pipeline.run action.
                const specialists = items.filter(a => a && (a.source === 'workspace' || a.agentMode));
                if (cancelled) return;
                setAvailableAgents(specialists);
                setAgentId(prev => prev || (specialists[0]?.id || ''));
            } catch {
                if (!cancelled) setAvailableAgents([]);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const addImageFiles = useCallback(async (fileList) => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        setAttachmentError(null);
        const additions = [];
        let imageCount = agentAttachments.filter(a => a.kind === 'image').length;
        for (const file of files) {
            if (!ATTACH_IMAGE_TYPES.includes(file.type)) { setAttachmentError(`Unsupported image type: ${file.type || 'unknown'}.`); continue; }
            if (file.size > ATTACH_MAX_IMAGE_BYTES) { setAttachmentError('Each image must be under 5 MB.'); continue; }
            if (imageCount >= ATTACH_MAX_IMAGES) { setAttachmentError(`Up to ${ATTACH_MAX_IMAGES} images.`); break; }
            imageCount++;
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('Failed to read image.'));
                    reader.readAsDataURL(file);
                });
                const base64 = String(dataUrl).split(',')[1] || '';
                additions.push({ id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, kind: 'image', name: file.name, media_type: file.type, data: base64, size: file.size, previewUrl: dataUrl });
            } catch (err) {
                setAttachmentError(err.message || 'Failed to read image.');
            }
        }
        if (additions.length) setAgentAttachments(prev => [...prev, ...additions]);
    }, [agentAttachments]);

    const addRecording = useCallback(async (file) => {
        if (!file) return;
        setAttachmentError(null);
        if (agentAttachments.filter(a => a.kind === 'video').length >= ATTACH_MAX_VIDEOS) { setAttachmentError(`Only ${ATTACH_MAX_VIDEOS} recording allowed.`); return; }
        if (!String(file.type || '').startsWith('video/')) { setAttachmentError('Please select a video recording.'); return; }
        setUploadingRecording(true);
        try {
            const res = await apiClient.uploadVideo(file);
            setAgentAttachments(prev => [...prev, { id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, kind: 'video', name: res.filename || file.name, media_type: res.mediaType || file.type, tempPath: res.tempPath, size: res.size || file.size }]);
        } catch (err) {
            setAttachmentError(err.message || 'Recording upload failed.');
        } finally {
            setUploadingRecording(false);
        }
    }, [agentAttachments]);

    const removeAttachment = useCallback((id) => {
        setAgentAttachments(prev => prev.filter(a => a.id !== id));
    }, []);

    const buildAction = useCallback(() => {
        const id = ticketId.trim();
        if (actionType === 'jira.transition') {
            return { type: 'jira.transition', params: { ticketId: id, targetStatus: targetStatus.trim(), ...(resolution.trim() ? { resolution: resolution.trim() } : {}) } };
        }
        if (actionType === 'jira.comment') {
            return { type: 'jira.comment', params: { ticketId: id, comment: comment.trim() } };
        }
        if (actionType === 'jira.create') {
            return {
                type: 'jira.create',
                params: {
                    ...(projectKey.trim() ? { projectKey: projectKey.trim() } : {}),
                    issueType,
                    summary: summary.trim(),
                    description: description.trim(),
                    priority,
                    ...(labels.trim() ? { labels: labels.split(',').map(l => l.trim()).filter(Boolean) } : {}),
                },
            };
        }
        if (actionType === 'agent.invoke') {
            const sel = availableAgents.find(a => a.id === agentId);
            const attachments = agentAttachments.map(a => a.kind === 'image'
                ? { type: 'image', media_type: a.media_type, data: a.data, filename: a.name }
                : { type: 'video', media_type: a.media_type, tempPath: a.tempPath, filename: a.name });
            return { type: 'agent.invoke', params: { agentId, agentLabel: sel?.label || agentId, prompt: agentPrompt.trim(), ...(attachments.length ? { attachments } : {}) } };
        }
        return { type: 'pipeline.run', params: { ticketId: id, mode: pipelineMode, environment: environment.trim() || 'UAT' } };
    }, [actionType, ticketId, targetStatus, resolution, comment, pipelineMode, environment, projectKey, issueType, summary, description, priority, labels, agentId, agentPrompt, availableAgents, agentAttachments]);

    const buildSchedule = useCallback(() => {
        if (scheduleMode === 'in') {
            const unit = DELAY_UNITS.find(u => u.value === delayUnit) || DELAY_UNITS[0];
            const delayMs = Math.max(0, Number(delayValue) || 0) * unit.ms;
            return { kind: 'delay', delayMs, timezone: BROWSER_TZ };
        }
        return { kind: 'datetime', runAt: runAtLocal ? new Date(runAtLocal).toISOString() : '', timezone: BROWSER_TZ };
    }, [scheduleMode, delayValue, delayUnit, runAtLocal]);

    const validationError = useMemo(() => {
        if (actionType === 'jira.create') {
            if (!summary.trim()) return 'Summary is required.';
        } else if (actionType === 'agent.invoke') {
            if (!agentId) return 'Select an agent to run.';
            if (!agentPrompt.trim()) return 'Describe what the agent should do.';
        } else {
            const id = ticketId.trim();
            if (!TICKET_RE.test(id)) return 'Enter a valid ticket ID (e.g. AOTF-123).';
            if (actionType === 'jira.transition' && !targetStatus.trim()) return 'Target status is required.';
            if (actionType === 'jira.comment' && !comment.trim()) return 'A comment is required.';
        }
        if (scheduleMode === 'in' && (!(Number(delayValue) > 0))) return 'Delay must be greater than zero.';
        if (scheduleMode === 'at') {
            if (!runAtLocal) return 'Pick a date and time.';
            if (new Date(runAtLocal).getTime() < Date.now() - 60000) return 'Scheduled time is in the past.';
        }
        return null;
    }, [actionType, ticketId, targetStatus, comment, summary, agentId, agentPrompt, scheduleMode, delayValue, runAtLocal]);

    const changeActionType = (val) => {
        setActionType(val);
        setReviewing(false);
    };

    const scheduleSummary = () => {
        if (scheduleMode === 'in') return `in ${delayValue} ${delayUnit}`;
        return runAtLocal ? `at ${new Date(runAtLocal).toLocaleString()}` : 'at the selected time';
    };

    const handleReview = () => {
        if (validationError) { setError(validationError); return; }
        setError(null);
        setReviewing(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (validationError) { setError(validationError); return; }
        setSubmitting(true);
        setError(null);
        try {
            const job = await apiClient.createSchedulerJob({
                schedule: buildSchedule(),
                action: buildAction(),
                source: 'web-app',
            });
            setNotice(`Scheduled: ${describeAction(job?.job?.action || buildAction())}`);
            setReviewing(false);
            if (actionType === 'jira.create') { setSummary(''); setDescription(''); setLabels(''); }
            if (actionType === 'agent.invoke') { setAgentPrompt(''); setAgentAttachments([]); setAttachmentError(null); }
            await loadJobs();
        } catch (err) {
            setError(err.message || 'Failed to schedule job.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async (jobId) => {
        try {
            await apiClient.cancelSchedulerJob(jobId);
            setNotice('Job cancelled.');
            await loadJobs();
        } catch (err) {
            setError(`Failed to cancel: ${err.message}`);
        }
    };

    const handleRunNow = async (jobId) => {
        try {
            await apiClient.runSchedulerJobNow(jobId);
            setNotice('Job fired.');
            await loadJobs();
        } catch (err) {
            setError(`Failed to run now: ${err.message}`);
        }
    };

    // ─── Jobs list: filter + search + pagination ───
    const filterCounts = useMemo(() => {
        const counts = {};
        for (const f of JOB_FILTERS) counts[f.value] = jobs.filter(f.match).length;
        return counts;
    }, [jobs]);

    const filteredJobs = useMemo(() => {
        const def = JOB_FILTERS.find(f => f.value === jobFilter) || JOB_FILTERS[0];
        const q = jobSearch.trim().toLowerCase();
        return jobs.filter(j => {
            if (!def.match(j)) return false;
            if (!q) return true;
            const hay = [
                describeAction(j.action),
                j.action?.type,
                j.action?.params?.ticketId,
                j.action?.params?.prompt,
                j.action?.params?.summary,
                j.action?.params?.agentLabel,
                resultOutputText(j),
                j.lastError,
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        });
    }, [jobs, jobFilter, jobSearch]);

    const visibleJobs = filteredJobs.slice(0, visibleCount);
    const selectedJob = detailJobId ? (jobs.find(j => j.jobId === detailJobId) || null) : null;

    // Reset pagination whenever the filter or search term changes.
    useEffect(() => { setVisibleCount(JOBS_PAGE_SIZE); }, [jobFilter, jobSearch]);

    const pendingCount = stats ? stats.scheduled + stats.running : jobs.filter(j => j.status === 'scheduled' || j.status === 'running').length;

    return (
        <div className="motion-page-calm app-page space-y-6">
            <PageHeader
                title="ScheduleGenie"
                subtitle="Schedule a one-time action — close a ticket, add a comment, create a ticket, or run a pipeline at a future time."
                Icon={CalendarIcon}
                actions={(
                    <div className="flex flex-wrap items-center gap-1.5">
                        <div className="page-header-panel rounded-xl px-2.5 py-1.5 text-left">
                            <p className="page-header-panel-subtle text-[0.5rem] font-semibold uppercase tracking-[0.16em]">Pending</p>
                            <p className="text-[0.82rem] font-bold tracking-[-0.02em] text-white mt-0.5">{pendingCount}</p>
                        </div>
                        <div className="page-header-panel rounded-xl px-2.5 py-1.5 text-left">
                            <p className="page-header-panel-subtle text-[0.5rem] font-semibold uppercase tracking-[0.16em]">Total</p>
                            <p className="text-[0.82rem] font-bold tracking-[-0.02em] text-white mt-0.5">{stats?.total ?? jobs.length}</p>
                        </div>
                    </div>
                )}
            />

            <ErrorBanner error={error} onDismiss={() => setError(null)} />
            {notice && (
                <div className="bg-emerald-50 border border-emerald-200/80 text-emerald-700 px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm">
                    {notice}
                </div>
            )}

            <div className="grid gap-4 lg:gap-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
                {/* ─── Create form ─── */}
                <aside className="surface-panel p-5 min-w-0 self-start lg:sticky lg:top-6">
                    <h2 className="type-card-title text-[1.05rem] mb-4">New schedule</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {reviewing ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                                        <PlusIcon className="w-3.5 h-3.5" /> Review copy
                                    </span>
                                </div>
                                <p className="text-[12px] text-surface-500">Confirm this ticket will be created exactly as shown when the schedule fires.</p>
                                <div className="rounded-xl border border-surface-200 bg-surface-50/60 divide-y divide-surface-200/70">
                                    <ReviewRow label="Project" value={projectKey.trim() || 'Default project'} />
                                    <ReviewRow label="Type" value={issueType} />
                                    <ReviewRow label="Priority" value={priority} />
                                    <ReviewRow label="Summary" value={summary.trim()} />
                                    {labels.trim() && <ReviewRow label="Labels" value={labels.trim()} />}
                                </div>
                                {description.trim() && (
                                    <div className="rounded-xl border border-surface-200 bg-white p-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 mb-1">Description</p>
                                        <p className="whitespace-pre-wrap text-[13px] text-surface-700">{description.trim()}</p>
                                    </div>
                                )}
                                <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-[12px] text-sky-800">
                                    Will be created {scheduleSummary()} · {BROWSER_TZ}
                                </div>
                            </div>
                        ) : (
                            <>
                        <div>
                            <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Action</label>
                            <ActionDropdown value={actionType} onChange={changeActionType} options={ACTION_TYPES} />
                        </div>

                        {actionType !== 'jira.create' && actionType !== 'agent.invoke' && (
                        <div>
                            <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Ticket ID</label>
                            <input
                                type="text"
                                value={ticketId}
                                onChange={(e) => setTicketId(e.target.value.toUpperCase())}
                                placeholder="AOTF-123"
                                className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                            />
                        </div>
                        )}

                        {actionType === 'jira.transition' && (
                            <>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Target status</label>
                                    <input
                                        type="text"
                                        value={targetStatus}
                                        onChange={(e) => setTargetStatus(e.target.value)}
                                        placeholder="Done"
                                        className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Resolution <span className="font-normal text-surface-400">(optional)</span></label>
                                    <input
                                        type="text"
                                        value={resolution}
                                        onChange={(e) => setResolution(e.target.value)}
                                        placeholder="Done"
                                        className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                    />
                                </div>
                            </>
                        )}

                        {actionType === 'jira.comment' && (
                            <div>
                                <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Comment</label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    rows={3}
                                    placeholder="Auto-closed by scheduler."
                                    className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                />
                            </div>
                        )}

                        {actionType === 'jira.create' && (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Issue type</label>
                                        <SimpleDropdown value={issueType} onChange={setIssueType} options={ISSUE_TYPES} ariaLabel="Issue type" />
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Priority</label>
                                        <SimpleDropdown value={priority} onChange={setPriority} options={PRIORITIES} ariaLabel="Priority" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Project key <span className="font-normal text-surface-400">(optional)</span></label>
                                    <input type="text" value={projectKey} onChange={(e) => setProjectKey(e.target.value.toUpperCase())} placeholder="Defaults to configured project" className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Summary</label>
                                    <input type="text" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Short ticket title" className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Description</label>
                                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Details (markdown supported)" className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Labels <span className="font-normal text-surface-400">(optional, comma-separated)</span></label>
                                    <input type="text" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="regression, sanity" className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                                </div>
                            </>
                        )}

                        {actionType === 'pipeline.run' && (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Mode</label>
                                    <SimpleDropdown value={pipelineMode} onChange={setPipelineMode} options={PIPELINE_MODES} ariaLabel="Pipeline mode" />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Environment</label>
                                    <input
                                        type="text"
                                        value={environment}
                                        onChange={(e) => setEnvironment(e.target.value)}
                                        className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                    />
                                </div>
                            </div>
                        )}

                        {actionType === 'agent.invoke' && (
                            <>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Agent</label>
                                    <AgentDropdown value={agentId} onChange={setAgentId} agents={availableAgents} />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">Task prompt</label>
                                    <textarea
                                        value={agentPrompt}
                                        onChange={(e) => setAgentPrompt(e.target.value)}
                                        rows={4}
                                        placeholder="e.g. Generate test cases for AOTF-16422 and export them to Excel."
                                        className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                    />
                                    <p className="mt-1 text-[11px] text-surface-400">Runs unattended at the scheduled time and auto-approves its own Jira/file writes.</p>
                                </div>
                                <div>
                                    <label className="block text-[13px] font-semibold text-surface-600 mb-1.5">
                                        Attachments <span className="font-normal text-surface-400">(optional — screenshots or a recording)</span>
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-surface-600 transition-colors hover:border-sky-300 hover:bg-sky-50/40">
                                            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImageFiles(e.target.files); e.target.value = ''; }} />
                                            + Screenshot
                                        </label>
                                        <label className={`inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-surface-600 transition-colors ${uploadingRecording ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-sky-300 hover:bg-sky-50/40'}`}>
                                            <input type="file" accept="video/*" className="hidden" disabled={uploadingRecording} onChange={(e) => { addRecording(e.target.files?.[0]); e.target.value = ''; }} />
                                            {uploadingRecording ? 'Uploading…' : '+ Recording'}
                                        </label>
                                    </div>
                                    {agentAttachments.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {agentAttachments.map(a => (
                                                <div key={a.id} className="flex items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-50 px-2 py-1 text-[11px] text-surface-600">
                                                    {a.kind === 'image' && a.previewUrl
                                                        ? <img src={a.previewUrl} alt={a.name} className="h-6 w-6 rounded object-cover" />
                                                        : <span className="flex h-6 w-6 items-center justify-center rounded bg-surface-200 text-surface-500"><PlayIcon className="w-3 h-3" /></span>}
                                                    <span className="max-w-[120px] truncate" title={a.name}>{a.name}</span>
                                                    <button type="button" onClick={() => removeAttachment(a.id)} className="ml-0.5 text-surface-400 transition-colors hover:text-rose-600" aria-label={`Remove ${a.name}`}>×</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {attachmentError && <p className="mt-1 text-[11px] font-medium text-rose-600">{attachmentError}</p>}
                                    <p className="mt-1 text-[11px] text-surface-400">Stored securely and passed to the agent when the job runs — like attaching evidence in chat.</p>
                                </div>
                            </>
                        )}

                        {/* Schedule picker */}
                        <div className="border-t border-surface-200/70 pt-4">
                            <label className="block text-[13px] font-semibold text-surface-600 mb-2">When</label>
                            <div className="flex gap-2 mb-3">
                                <button
                                    type="button"
                                    onClick={() => setScheduleMode('in')}
                                    className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${scheduleMode === 'in' ? 'bg-sky-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
                                >
                                    In…
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScheduleMode('at')}
                                    className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${scheduleMode === 'at' ? 'bg-sky-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
                                >
                                    At…
                                </button>
                            </div>

                            {scheduleMode === 'in' ? (
                                <div className="grid grid-cols-2 gap-3">
                                    <input
                                        type="number"
                                        min="1"
                                        value={delayValue}
                                        onChange={(e) => setDelayValue(e.target.value)}
                                        className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                    />
                                    <SimpleDropdown value={delayUnit} onChange={setDelayUnit} options={DELAY_UNITS} ariaLabel="Delay unit" />
                                </div>
                            ) : (
                                <input
                                    type="datetime-local"
                                    value={runAtLocal}
                                    onChange={(e) => setRunAtLocal(e.target.value)}
                                    className="w-full rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                />
                            )}
                            <p className="mt-2 text-[11px] text-surface-400">Timezone: {BROWSER_TZ}</p>
                        </div>

                        {validationError && (
                            <p className="text-[12px] font-medium text-rose-600">{validationError}</p>
                        )}
                            </>
                        )}

                        {actionType === 'jira.create' && !reviewing ? (
                            <button
                                type="button"
                                onClick={handleReview}
                                disabled={!!validationError}
                                className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Review ticket →
                            </button>
                        ) : reviewing ? (
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setReviewing(false)}
                                    className="flex-1 rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-sm font-semibold text-surface-600 transition-colors hover:bg-surface-50"
                                >
                                    ← Edit
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {submitting ? 'Scheduling…' : 'Confirm & schedule'}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="submit"
                                disabled={submitting || !!validationError}
                                className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? 'Scheduling…' : 'Schedule action'}
                            </button>
                        )}
                    </form>
                </aside>

                {/* ─── Jobs list ─── */}
                <section className="surface-panel p-5 min-h-[400px] min-w-0">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h2 className="type-card-title text-[1.05rem]">Scheduled jobs</h2>
                        {stats && (
                            <div className="hidden sm:flex flex-wrap gap-1.5 text-[11px]">
                                {['scheduled', 'completed', 'failed', 'missed'].map(s => (
                                    stats[s] > 0 ? (
                                        <span key={s} className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${STATUS_TONES[s]}`}>
                                            {stats[s]} {s}
                                        </span>
                                    ) : null
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Filter tabs + search — appear once at least one job exists */}
                    {jobs.length > 0 && (
                        <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {JOB_FILTERS.filter(f => f.value === 'all' || filterCounts[f.value] > 0).map(f => {
                                    const active = jobFilter === f.value;
                                    return (
                                        <button
                                            key={f.value}
                                            type="button"
                                            onClick={() => setJobFilter(f.value)}
                                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${active ? 'bg-sky-600 text-white shadow-sm' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
                                        >
                                            {f.label}
                                            <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-white text-surface-500'}`}>{filterCounts[f.value]}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="relative lg:w-64">
                                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                                <input
                                    type="text"
                                    value={jobSearch}
                                    onChange={(e) => setJobSearch(e.target.value)}
                                    placeholder="Search jobs…"
                                    className="w-full rounded-xl border border-surface-200 bg-white pl-9 pr-8 py-2 text-sm text-surface-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                />
                                {jobSearch && (
                                    <button type="button" onClick={() => setJobSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600" aria-label="Clear search">
                                        <XIcon className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex justify-center py-16"><BouncingLoader /></div>
                    ) : jobs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <CalendarIcon className="w-10 h-10 text-surface-300 mb-3" />
                            <p className="text-sm font-medium text-surface-500">No scheduled jobs yet</p>
                            <p className="text-[13px] text-surface-400 mt-1">Create one with the form to auto-close a ticket later.</p>
                        </div>
                    ) : filteredJobs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <SearchIcon className="w-9 h-9 text-surface-300 mb-3" />
                            <p className="text-sm font-medium text-surface-500">No jobs match your filters</p>
                            <button
                                type="button"
                                onClick={() => { setJobFilter('all'); setJobSearch(''); }}
                                className="mt-2 rounded-lg bg-surface-100 px-3 py-1.5 text-[12px] font-semibold text-surface-600 hover:bg-surface-200 transition-colors"
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : (
                        <div className="-mr-2 max-h-[32rem] lg:max-h-[calc(100vh-18rem)] min-h-[260px] overflow-y-auto pr-2">
                            <ul className="space-y-2.5">
                                {visibleJobs.map((job) => (
                                    <li key={job.jobId}>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setDetailJobId(job.jobId)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailJobId(job.jobId); } }}
                                            className="group w-full cursor-pointer rounded-xl border border-surface-200/80 bg-white/70 px-4 py-3 text-left shadow-sm transition-all hover:border-sky-300 hover:bg-white hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-100"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${STATUS_TONES[job.status] || STATUS_TONES.scheduled}`}>
                                                            {job.status}
                                                        </span>
                                                        <span className="text-sm font-semibold text-surface-800 truncate">{describeAction(job.action)}</span>
                                                    </div>
                                                    <p className="mt-1 text-[12px] text-surface-500">
                                                        {formatDateTime(job.schedule?.runAt)}
                                                        <span className="text-surface-400"> · {relativeTo(job.schedule?.runAt)}</span>
                                                        {job.attempts > 0 && <span className="text-surface-400"> · attempt {job.attempts}</span>}
                                                    </p>
                                                    {job.action?.type === 'agent.invoke' && job.action?.params?.prompt && (
                                                        <p className="mt-1 text-[12px] text-surface-600 truncate" title={job.action.params.prompt}>
                                                            <span className="text-surface-400">Task: </span>{job.action.params.prompt}
                                                        </p>
                                                    )}
                                                    {job.status === 'completed' && resultOutputText(job) && (
                                                        <p className="mt-1 text-[12px] text-surface-500 truncate" title={resultOutputText(job)}>
                                                            <span className="text-surface-400">Result: </span>{resultOutputText(job)}
                                                        </p>
                                                    )}
                                                    {job.action?.type === 'agent.invoke' && Array.isArray(job.action?.params?.attachments) && job.action.params.attachments.length > 0 && (
                                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                            <span className="text-[11px] text-surface-400">Attachments:</span>
                                                            {job.action.params.attachments.map(att => (
                                                                <span
                                                                    key={att.id}
                                                                    className="inline-flex items-center gap-1 rounded-md border border-surface-200 bg-surface-50 px-1.5 py-0.5 text-[11px] text-surface-500"
                                                                    title={`${att.filename}${att.size ? ` (${Math.round(att.size / 1024)} KB)` : ''}`}
                                                                >
                                                                    {att.type === 'video' && <PlayIcon className="w-3 h-3" />}
                                                                    <span className="max-w-[130px] truncate">{att.filename}</span>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {job.lastError && (
                                                        <p className="mt-1 text-[12px] font-medium text-rose-600 truncate" title={job.lastError}>{job.lastError}</p>
                                                    )}
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    {job.status === 'scheduled' && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleRunNow(job.jobId); }}
                                                                className="rounded-lg bg-surface-100 px-2.5 py-1 text-[12px] font-medium text-surface-600 hover:bg-surface-200 transition-colors"
                                                                title="Run now"
                                                            >
                                                                Run now
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleCancel(job.jobId); }}
                                                                className="rounded-lg bg-rose-50 px-2.5 py-1 text-[12px] font-medium text-rose-600 hover:bg-rose-100 transition-colors"
                                                                title="Cancel"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}
                                                    <ChevronRightIcon className="w-4 h-4 text-surface-300 transition-colors group-hover:text-sky-500" />
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>

                            {filteredJobs.length > visibleCount ? (
                                <div className="mt-4 flex flex-col items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setVisibleCount(c => c + JOBS_PAGE_SIZE)}
                                        className="rounded-xl border border-surface-200 bg-white px-4 py-2 text-[13px] font-semibold text-surface-600 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50/40"
                                    >
                                        Show more ({filteredJobs.length - visibleCount} remaining)
                                    </button>
                                    <p className="text-[11px] text-surface-400">Showing {visibleJobs.length} of {filteredJobs.length}</p>
                                </div>
                            ) : (
                                filteredJobs.length > JOBS_PAGE_SIZE && (
                                    <p className="mt-4 text-center text-[11px] text-surface-400">Showing all {filteredJobs.length} jobs</p>
                                )
                            )}
                        </div>
                    )}
                </section>
            </div>

            {selectedJob && (
                <JobDetailDrawer
                    job={selectedJob}
                    onClose={() => setDetailJobId(null)}
                    onRunNow={handleRunNow}
                    onCancel={handleCancel}
                />
            )}
        </div>
    );
}
