'use client';

import { Children, isValidElement } from 'react';

// Map of GitHub-style alert keys → label, icon (as SVG path `d`), and theme class
const ALERT_META = {
    note: {
        label: 'Note',
        cls: 'chat-alert chat-alert--note',
        // info circle
        d: 'M12 9v3m0 3.5h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z',
    },
    tip: {
        label: 'Tip',
        cls: 'chat-alert chat-alert--tip',
        // light bulb
        d: 'M9.663 17h4.673M12 3a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1.3A7 7 0 0 0 12 3Z',
    },
    important: {
        label: 'Important',
        cls: 'chat-alert chat-alert--important',
        // sparkle/exclamation
        d: 'M12 8v5m0 3.5h.01M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z',
    },
    warning: {
        label: 'Warning',
        cls: 'chat-alert chat-alert--warning',
        // triangle exclamation
        d: 'M12 9v4m0 3.5h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
    },
    caution: {
        label: 'Caution',
        cls: 'chat-alert chat-alert--caution',
        // shield
        d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
    },
    success: {
        label: 'Success',
        cls: 'chat-alert chat-alert--success',
        // check circle
        d: 'm9 12 2 2 4-4m5 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    },
};

const PATTERN = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|SUCCESS)\]\s*/i;

// Walk children to find the first text node and see if it starts with [!TYPE]
function detectAlertType(children) {
    let firstText = '';
    const arr = Children.toArray(children);
    const first = arr.find((c) => isValidElement(c) && c.props?.children != null) || arr[0];
    if (!first) return null;
    const inner = isValidElement(first) ? Children.toArray(first.props.children) : [first];
    const firstInner = inner[0];
    if (typeof firstInner === 'string') firstText = firstInner;
    else if (isValidElement(firstInner) && typeof firstInner.props?.children === 'string') {
        firstText = firstInner.props.children;
    }
    const m = firstText.match(PATTERN);
    return m ? m[1].toLowerCase() : null;
}

// Strip the `[!TYPE]` prefix (and leading whitespace/newline) from the first text node
function stripMarker(children) {
    const arr = Children.toArray(children);
    if (arr.length === 0) return arr;
    const first = arr[0];
    if (!isValidElement(first)) return arr;
    const innerArr = Children.toArray(first.props.children);
    if (innerArr.length === 0) return arr;
    const firstInner = innerArr[0];

    const replaceText = (txt) => txt.replace(PATTERN, '').replace(/^\s+/, '');

    let nextInner = innerArr;
    if (typeof firstInner === 'string') {
        const cleaned = replaceText(firstInner);
        nextInner = cleaned ? [cleaned, ...innerArr.slice(1)] : innerArr.slice(1);
    } else if (isValidElement(firstInner) && typeof firstInner.props?.children === 'string') {
        // e.g. text inside an <em>/<strong>
        const cleaned = replaceText(firstInner.props.children);
        const patched = cleaned
            ? [{ ...firstInner, props: { ...firstInner.props, children: cleaned } }, ...innerArr.slice(1)]
            : innerArr.slice(1);
        nextInner = patched;
    }

    const patchedFirst = { ...first, props: { ...first.props, children: nextInner } };
    return [patchedFirst, ...arr.slice(1)];
}

export function tryRenderAlert(children) {
    const kind = detectAlertType(children);
    if (!kind) return null;
    const meta = ALERT_META[kind];
    const stripped = stripMarker(children);
    return (
        <div className={meta.cls} role="note" aria-label={meta.label}>
            <div className="chat-alert__head">
                <span className="chat-alert__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={meta.d} />
                    </svg>
                </span>
                <span className="chat-alert__label">{meta.label}</span>
            </div>
            <div className="chat-alert__body">{stripped}</div>
        </div>
    );
}

export default tryRenderAlert;
