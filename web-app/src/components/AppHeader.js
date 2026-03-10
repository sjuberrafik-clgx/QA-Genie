'use client';

/**
 * AppHeader — Nuxt UI v4–style responsive header, ported to React / Next.js.
 *
 * Renders a sticky `<header>` with three zones (left · center · right),
 * a mobile hamburger toggle, and a drawer / modal menu for small screens.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  {top}                                                         │
 * │  ┌───────┬──────────────────────────┬────────┐                 │
 * │  │ left  │        center (nav)      │  right │  ← Container   │
 * │  └───────┴──────────────────────────┴────────┘                 │
 * │  {bottom}                                                      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Props (mirror Nuxt UI's UHeader API):
 * ──────────────────────────────────────
 * @prop {string}           [title]       – Title text (also used as aria-label)
 * @prop {string}           [to='/']      – Link destination for the title
 * @prop {'modal'|'drawer'} [mode]        – Mobile menu mode
 * @prop {boolean|object}   [toggle]      – Show toggle button, or button props
 * @prop {'left'|'right'}   [toggleSide]  – Side for the toggle button
 * @prop {boolean}          [autoClose]   – Close menu on route change
 * @prop {object}           [ui]          – Per-slot theme overrides
 *
 * Named section props (React equivalent of Vue named slots):
 * @prop {ReactNode}   [left]            – Override the left zone (replaces title)
 * @prop {ReactNode}   [children]        – Center zone (navigation items)
 * @prop {ReactNode}   [right]           – Right zone (CTAs, icons)
 * @prop {ReactNode}   [titleContent]    – Custom title (e.g. logo component)
 * @prop {ReactNode}   [body]            – Mobile menu body content
 * @prop {ReactNode}   [content]         – Full mobile menu content (overrides body)
 * @prop {ReactNode}   [top]             – Above the header bar
 * @prop {ReactNode}   [bottom]          – Below the header bar
 * @prop {Function}    [renderToggle]    – Render prop: ({ open, toggle, ui }) => ReactNode
 *
 * @see https://ui.nuxt.com/docs/components/header
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mergeUi, cx } from '@/lib/merge-ui';
import { MenuIcon, XIcon } from '@/components/Icons';
import Container from '@/components/Container';

/* ─── Default Theme Slots (exact Nuxt UI v4 classes, adapted for Tailwind) ─── */
const defaultUi = {
    root: 'app-header',
    container: 'flex items-center justify-between gap-3 h-full',
    left: 'lg:flex-1 flex items-center gap-1.5',
    center: 'hidden lg:flex items-center',
    right: 'flex items-center justify-end lg:flex-1 gap-1.5',
    title: 'shrink-0 font-bold text-xl text-surface-800 flex items-end gap-1.5',
    toggle: 'lg:hidden',
    content: 'lg:hidden',
    overlay: 'lg:hidden',
    header: 'px-4 sm:px-6 h-[var(--ui-header-height)] shrink-0 flex items-center justify-between gap-3',
    body: 'p-4 sm:p-6 overflow-y-auto',
};

/* ─── Toggle Button ─────────────────────────────────────────────── */
function ToggleButton({ open, onClick, side, customProps, renderToggle, ui }) {
    const sideClass = side === 'left' ? '-ms-1.5' : '-me-1.5';

    if (renderToggle) {
        return renderToggle({ open, toggle: onClick, ui });
    }

    // If toggle is an object, spread it as className / color overrides
    const extra = typeof customProps === 'object' && customProps !== null && customProps !== true
        ? customProps
        : {};

    return (
        <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={onClick}
            className={cx(
                'inline-flex items-center justify-center rounded-lg p-2 text-surface-500 hover:text-surface-800 hover:bg-surface-100 transition-colors duration-150',
                sideClass,
                extra.className,
            )}
        >
            {open
                ? <XIcon className="w-5 h-5" strokeWidth={2} />
                : <MenuIcon className="w-5 h-5" strokeWidth={2} />
            }
        </button>
    );
}

/* ─── Mobile Menu (Modal or Drawer) ─────────────────────────────── */
function MobileMenu({ mode, open, onClose, side, content, body, headerBar, ui }) {
    const panelRef = useRef(null);

    // Close on Escape key
    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    // Lock body scroll when open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    if (!open) return null;

    const menuContent = content || (
        <>
            {/* Header bar inside mobile menu */}
            <div className={ui.header}>
                {headerBar}
            </div>
            {/* Body */}
            {body && <div className={ui.body}>{body}</div>}
        </>
    );

    if (mode === 'drawer') {
        return (
            <>
                <div className="header-overlay" onClick={onClose} />
                <div
                    ref={panelRef}
                    className="header-drawer"
                    data-side={side === 'left' ? 'left' : undefined}
                    role="dialog"
                    aria-modal="true"
                >
                    {menuContent}
                </div>
            </>
        );
    }

    // Default: modal mode
    return (
        <>
            <div className="header-overlay" onClick={onClose} />
            <div className="header-modal" role="dialog" aria-modal="true">
                <div ref={panelRef} className="header-modal-panel">
                    {menuContent}
                </div>
            </div>
        </>
    );
}

/* ─── Main Header Component ─────────────────────────────────────── */
export default function AppHeader({
    title = 'QA Automation',
    to = '/',
    mode = 'modal',
    toggle = true,
    toggleSide = 'right',
    autoClose = true,
    ui: uiOverrides,
    // Slot props
    left,
    children,
    right,
    titleContent,
    body,
    content,
    top,
    bottom,
    renderToggle,
}) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const ui = mergeUi(defaultUi, uiOverrides);

    // Auto-close on route change
    useEffect(() => {
        if (autoClose && open) {
            setOpen(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    const handleToggle = useCallback(() => setOpen((v) => !v), []);
    const handleClose = useCallback(() => setOpen(false), []);

    const showToggle = toggle && (body || content);

    /* ── Toggle Element ── */
    const toggleEl = showToggle ? (
        <div className={cx(ui.toggle)}>
            <ToggleButton
                open={open}
                onClick={handleToggle}
                side={toggleSide}
                customProps={toggle}
                renderToggle={renderToggle}
                ui={ui}
            />
        </div>
    ) : null;

    /* ── Title / Left Zone ── */
    const leftZone = left || (
        <Link href={to} aria-label={title} className={cx(ui.title, 'no-underline')}>
            {titleContent || title}
        </Link>
    );

    /* ── Header bar for inside mobile menu (replicates the main header) ── */
    const mobileHeaderBar = (
        <div className="flex items-center justify-between w-full">
            <Link href={to} aria-label={title} className={cx(ui.title, 'no-underline')}>
                {titleContent || title}
            </Link>
            <button
                type="button"
                onClick={handleClose}
                aria-label="Close menu"
                className="inline-flex items-center justify-center rounded-lg p-2 text-surface-500 hover:text-surface-800 hover:bg-surface-100 transition-colors"
            >
                <XIcon className="w-5 h-5" strokeWidth={2} />
            </button>
        </div>
    );

    return (
        <>
            <header className={cx(ui.root)} data-slot="header">
                {top}
                <Container>
                    <div className={cx(ui.container)}>
                        {/* Left zone */}
                        <div className={cx(ui.left)}>
                            {toggleSide === 'left' && toggleEl}
                            {leftZone}
                        </div>

                        {/* Center zone — hidden on mobile */}
                        <div className={cx(ui.center)}>
                            {children}
                        </div>

                        {/* Right zone */}
                        <div className={cx(ui.right)}>
                            {right}
                            {toggleSide === 'right' && toggleEl}
                        </div>
                    </div>
                </Container>
                {bottom}
            </header>

            {/* Mobile menu */}
            <MobileMenu
                mode={mode}
                open={open}
                onClose={handleClose}
                side={toggleSide}
                content={content}
                body={body}
                headerBar={mobileHeaderBar}
                ui={ui}
            />
        </>
    );
}
