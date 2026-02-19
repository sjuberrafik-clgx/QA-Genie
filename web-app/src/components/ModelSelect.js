'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { MODEL_GROUPS, getModelLabel } from '@/lib/model-options';

/**
 * Custom AI Model dropdown — always opens downward, supports search & grouped options.
 * Replaces native <select> to fix browser-controlled upward opening.
 */
export default function ModelSelect({ value, onChange, className = '' }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);
    const searchInputRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
                setSearch('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Focus search input on open
    useEffect(() => {
        if (open && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [open]);

    // Keyboard support
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (e.key === 'Escape') {
                setOpen(false);
                setSearch('');
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    // Filtered models based on search
    const filteredGroups = useMemo(() => {
        if (!search.trim()) return MODEL_GROUPS;

        const q = search.toLowerCase();
        return MODEL_GROUPS
            .map(group => ({
                ...group,
                models: group.models.filter(
                    m => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
                ),
            }))
            .filter(group => group.models.length > 0);
    }, [search]);

    const handleSelect = (val) => {
        onChange(val);
        setOpen(false);
        setSearch('');
    };

    const selectedLabel = getModelLabel(value);

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            {/* Trigger button — matches custom-select styling */}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className={`w-full bg-white border rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-surface-800 cursor-pointer text-left transition-all duration-150 ${
                    open
                        ? 'border-brand-400 ring-2 ring-brand-500/20'
                        : 'border-surface-200 hover:border-brand-300 hover:bg-brand-50/30'
                }`}
            >
                <span className="truncate block">{selectedLabel}</span>
                {/* Chevron */}
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg
                        className={`w-4 h-4 text-surface-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 20 20"
                    >
                        <path
                            fillRule="evenodd"
                            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                            clipRule="evenodd"
                            fill="currentColor"
                        />
                    </svg>
                </span>
            </button>

            {/* Dropdown panel — always opens downward */}
            {open && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-surface-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    {/* Search input */}
                    <div className="p-2 border-b border-surface-100">
                        <div className="relative">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                            </svg>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search models..."
                                className="w-full pl-9 pr-3 py-2 text-xs bg-surface-50 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
                            />
                        </div>
                    </div>

                    {/* Options list */}
                    <div className="max-h-[280px] overflow-y-auto py-1">
                        {filteredGroups.length === 0 ? (
                            <div className="px-4 py-6 text-center text-xs text-surface-400">
                                No models match &quot;{search}&quot;
                            </div>
                        ) : (
                            filteredGroups.map((group) => (
                                <div key={group.group}>
                                    {/* Group header */}
                                    <div className="px-3 py-1.5 text-[10px] font-bold text-surface-400 uppercase tracking-wider bg-surface-50/80 sticky top-0">
                                        {group.group}
                                    </div>
                                    {group.models.map((model) => {
                                        const isSelected = model.value === value;
                                        return (
                                            <button
                                                key={model.value}
                                                type="button"
                                                onClick={() => handleSelect(model.value)}
                                                className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 ${
                                                    isSelected
                                                        ? 'bg-brand-50 text-brand-700 font-semibold'
                                                        : 'text-surface-700 hover:bg-surface-100'
                                                }`}
                                            >
                                                {isSelected && (
                                                    <svg className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                                    </svg>
                                                )}
                                                <span className={isSelected ? '' : 'pl-5.5'}>{model.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
