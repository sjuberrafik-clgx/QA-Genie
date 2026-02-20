'use client';

import { memo } from 'react';
import { ClockIcon } from '@/components/Icons';

const MODE_LABELS = {
    full: 'Full Pipeline',
    generate: 'Generate Test Case Only',
    execute: 'Generate Script Only',
    heal: 'Repair Script',
    'test-only': 'Test Only',
    'script-only': 'Script Only',
};

const accentMap = {
    running: 'border-l-brand-500',
    completed: 'border-l-accent-500',
    failed: 'border-l-red-500',
    cancelled: 'border-l-surface-400',
    pending: 'border-l-amber-400',
};

const badgeMap = {
    running: 'bg-brand-100 text-brand-700 ring-1 ring-brand-200',
    completed: 'bg-accent-50 text-accent-700 ring-1 ring-accent-200',
    failed: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    cancelled: 'bg-surface-100 text-surface-600 ring-1 ring-surface-200',
    pending: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
};

export default memo(PipelineCard);

function PipelineCard({ run, onForceCancel }) {
    const { runId, ticketId, mode, status, duration, startedAt, createdAt } = run;

    const time = startedAt || createdAt;
    const formattedTime = time ? new Date(time).toLocaleString() : '';
    const formattedDuration = duration
        ? (typeof duration === 'number' ? `${(duration / 1000).toFixed(1)}s` : duration)
        : '';

    return (
        <div className={`glass-card border-l-4 ${accentMap[status] || accentMap.pending} hover-lift flex items-center justify-between py-3 px-4`}>
            <div className="flex items-center gap-3 min-w-0">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${badgeMap[status] || badgeMap.pending}`}>
                    {status === 'running' && (
                        <span className="inline-block w-1.5 h-1.5 bg-brand-500 rounded-full mr-1 align-middle" />
                    )}
                    {status}
                </span>
                <div className="min-w-0">
                    <span className="text-sm font-semibold text-surface-900">{ticketId}</span>
                    <span className="text-[10px] text-surface-500 ml-2 uppercase tracking-wider">{MODE_LABELS[mode] || mode}</span>
                </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-surface-500 flex-shrink-0">
                {formattedDuration && (
                    <span className="flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" />
                        {formattedDuration}
                    </span>
                )}
                <span className="hidden md:inline">{formattedTime}</span>
                <span className="font-mono text-[10px] text-surface-400">{runId?.substring(0, 8)}</span>
                {status === 'running' && onForceCancel && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onForceCancel(runId, ticketId);
                        }}
                        className="px-2.5 py-1 text-[10px] font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100 ring-1 ring-red-200 transition-all duration-150"
                        title="Force cancel this stuck run"
                    >
                        Force Cancel
                    </button>
                )}
            </div>
        </div>
    );
}
