'use client';

import { SparkleIcon, PlayIcon, CodeIcon, DocumentIcon, BugIcon, GlobeIcon } from './Icons';

/**
 * Icon mapping from followup provider's icon identifiers to React components.
 * Falls back to SparkleIcon for unknown icons.
 */
const ICON_MAP = {
    play: PlayIcon,
    code: CodeIcon,
    checklist: DocumentIcon,
    file: DocumentIcon,
    chart: DocumentIcon,
    search: GlobeIcon,
    bug: BugIcon,
    refresh: PlayIcon,
    wrench: CodeIcon,
    microscope: BugIcon,
    shield: CodeIcon,
    log: DocumentIcon,
    history: DocumentIcon,
    ticket: DocumentIcon,
};

/**
 * Category → pill color mapping for visual grouping.
 */
const CATEGORY_STYLES = {
    action: 'bg-brand-50 border-brand-200/80 text-brand-700 hover:bg-brand-100 hover:border-brand-300',
    explore: 'bg-violet-50 border-violet-200/80 text-violet-700 hover:bg-violet-100 hover:border-violet-300',
    review: 'bg-accent-50 border-accent-200/80 text-accent-700 hover:bg-accent-100 hover:border-accent-300',
    debug: 'bg-amber-50 border-amber-200/80 text-amber-700 hover:bg-amber-100 hover:border-amber-300',
};

const DEFAULT_STYLE = 'bg-surface-50 border-surface-200/80 text-surface-700 hover:bg-surface-100 hover:border-surface-300';

/**
 * Followup suggestion chips displayed after AI responses.
 * Clicking a chip either sends its prompt directly or pre-fills the input
 * box for the user to complete (when prefill: true).
 *
 * @param {Object} props
 * @param {Array}  props.followups - Array of { label, prompt, category, icon, prefill? }
 * @param {Function} props.onSelect - Called with the full followup object when a chip is clicked
 * @param {boolean} [props.disabled] - Disable clicks (e.g., while processing)
 */
export default function FollowupChips({ followups = [], onSelect, disabled = false }) {
    if (!followups || followups.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 transition-all duration-300">
            <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider self-center mr-1">
                Suggestions
            </span>
            {followups.map((f, i) => {
                const IconComponent = ICON_MAP[f.icon] || SparkleIcon;
                const style = CATEGORY_STYLES[f.category] || DEFAULT_STYLE;
                const isPrefill = !!f.prefill || /AOTF-\s*$/i.test(f.prompt || '');

                return (
                    <button
                        key={`${f.label}-${i}`}
                        onClick={() => !disabled && onSelect?.(f)}
                        disabled={disabled}
                        title={isPrefill ? `${f.prompt} (click to edit before sending)` : f.prompt}
                        className={`
                            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                            border cursor-pointer transition-all duration-150 shadow-sm
                            disabled:opacity-50 disabled:cursor-not-allowed
                            ${style}
                        `}
                    >
                        <IconComponent className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate max-w-[200px]">{f.label}</span>
                        {isPrefill && (
                            <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                            </svg>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
