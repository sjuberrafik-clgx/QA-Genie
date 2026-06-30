'use client';

/**
 * StatusPill — renders well-known status keywords and Jira keys as colored
 * pills. Used by the inline-code renderer in ChatMessage when the literal
 * text inside `<code>` matches a known pattern.
 *
 * Detection is deterministic (no LLM) and case-insensitive. Recognized
 * statuses come from typical Jira/QA workflow vocabulary used in this repo.
 */

const STATUS_TOKENS = [
    // Jira workflow statuses
    { match: /^to\s*do$/i, label: 'To Do', tone: 'neutral' },
    { match: /^in\s*progress$/i, label: 'In Progress', tone: 'info' },
    { match: /^in\s*review$/i, label: 'In Review', tone: 'info' },
    { match: /^code\s*review$/i, label: 'Code Review', tone: 'info' },
    { match: /^blocked$/i, label: 'Blocked', tone: 'danger' },
    { match: /^on\s*hold$/i, label: 'On Hold', tone: 'warning' },
    { match: /^ready\s*for\s*qa$/i, label: 'Ready for QA', tone: 'warning' },
    { match: /^in\s*qa$/i, label: 'In QA', tone: 'warning' },
    { match: /^uat$/i, label: 'UAT', tone: 'warning' },
    { match: /^ready\s*for\s*release$/i, label: 'Ready for Release', tone: 'success-soft' },
    { match: /^released$/i, label: 'Released', tone: 'success' },
    { match: /^closed[-\s]?completed$/i, label: 'Closed-Completed', tone: 'success' },
    { match: /^done[-\s]?completed$/i, label: 'Done-Completed', tone: 'success' },
    { match: /^done$/i, label: 'Done', tone: 'success' },
    { match: /^completed$/i, label: 'Completed', tone: 'success' },
    { match: /^closed$/i, label: 'Closed', tone: 'neutral' },
    { match: /^cancelled|canceled$/i, label: 'Cancelled', tone: 'neutral' },
    { match: /^reopened$/i, label: 'Reopened', tone: 'danger' },
    { match: /^rejected$/i, label: 'Rejected', tone: 'danger' },

    // Environments
    { match: /^prod(uction)?$/i, label: 'PROD', tone: 'danger' },
    { match: /^stage|staging$/i, label: 'Staging', tone: 'warning' },
    { match: /^int(egration)?$/i, label: 'INT', tone: 'info' },
    { match: /^dev$/i, label: 'DEV', tone: 'neutral' },

    // Priorities
    { match: /^highest|critical$/i, label: 'Critical', tone: 'danger' },
    { match: /^high$/i, label: 'High', tone: 'warning' },
    { match: /^medium$/i, label: 'Medium', tone: 'info' },
    { match: /^low$/i, label: 'Low', tone: 'neutral' },
];

// Jira key like AOTF-12345
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;

const TONE_CLASSES = {
    success: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    'success-soft': 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
    info: 'bg-sky-100 text-sky-700 ring-sky-200',
    warning: 'bg-amber-100 text-amber-800 ring-amber-200',
    danger: 'bg-rose-100 text-rose-700 ring-rose-200',
    neutral: 'bg-surface-100 text-surface-700 ring-surface-200',
    jira: 'bg-violet-100 text-violet-700 ring-violet-200',
};

function getJiraBaseUrl() {
    if (typeof window === 'undefined') return null;
    // Prefer a runtime-configured URL if the app injects one; otherwise build
    // from a known cloud host pattern based on the env.
    const fromEnv = process.env.NEXT_PUBLIC_JIRA_BASE_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    return null;
}

/**
 * Attempt to render a status pill from a raw inline-code text. Returns
 * `null` when no rule matches, allowing the caller to fall back to a
 * regular `<code>` element.
 */
export function tryRenderStatusPill(rawText, key) {
    if (!rawText) return null;
    const text = String(rawText).trim();
    if (!text || text.length > 40) return null;

    // Jira key chip — clickable when a base URL is known
    if (JIRA_KEY_RE.test(text)) {
        const base = getJiraBaseUrl();
        const href = base ? `${base}/browse/${text}` : null;
        const cls = `chat-status-pill chat-status-pill--jira ${TONE_CLASSES.jira}`;
        if (href) {
            return (
                <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                    <span className="chat-status-pill__dot" aria-hidden />
                    {text}
                </a>
            );
        }
        return (
            <span key={key} className={cls}>
                <span className="chat-status-pill__dot" aria-hidden />
                {text}
            </span>
        );
    }

    // Status tokens
    for (const rule of STATUS_TOKENS) {
        if (rule.match.test(text)) {
            const cls = `chat-status-pill chat-status-pill--status ${TONE_CLASSES[rule.tone] || TONE_CLASSES.neutral}`;
            return (
                <span key={key} className={cls} data-tone={rule.tone}>
                    <span className="chat-status-pill__dot" aria-hidden />
                    {rule.label}
                </span>
            );
        }
    }

    return null;
}

export default tryRenderStatusPill;
