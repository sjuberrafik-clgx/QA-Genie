'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
// Perf: scope xterm CSS to this component so it only loads when the terminal
// is actually rendered (was previously imported in root layout, shipping to
// every page).
import '@xterm/xterm/css/xterm.css';

const THEME_PRESETS = {
    midnight: {
        background: '#020617',
        foreground: '#dbeafe',
        cursor: '#93c5fd',
        cursorAccent: '#020617',
        selectionBackground: 'rgba(59, 130, 246, 0.35)',
        black: '#0b1220',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#334155',
        brightRed: '#fca5a5',
        brightGreen: '#6ee7b7',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
    },
    graphite: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#f8fafc',
        cursorAccent: '#0f172a',
        selectionBackground: 'rgba(148, 163, 184, 0.36)',
        black: '#111827',
        red: '#fb7185',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#f472b6',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#4b5563',
        brightRed: '#fda4af',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#f9a8d4',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
    },
    solarizedDark: {
        background: '#002b36',
        foreground: '#93a1a1',
        cursor: '#b58900',
        cursorAccent: '#002b36',
        selectionBackground: 'rgba(181, 137, 0, 0.3)',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#586e75',
        brightRed: '#cb4b16',
        brightGreen: '#93a1a1',
        brightYellow: '#657b83',
        brightBlue: '#839496',
        brightMagenta: '#6c71c4',
        brightCyan: '#93a1a1',
        brightWhite: '#fdf6e3',
    },
    highContrast: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#00e5ff',
        cursorAccent: '#000000',
        selectionBackground: 'rgba(255, 255, 255, 0.36)',
        black: '#000000',
        red: '#ff4d4d',
        green: '#44ff88',
        yellow: '#ffea00',
        blue: '#4da3ff',
        magenta: '#ff66cc',
        cyan: '#00e5ff',
        white: '#ffffff',
        brightBlack: '#666666',
        brightRed: '#ff8080',
        brightGreen: '#8effb8',
        brightYellow: '#fff176',
        brightBlue: '#8cbcff',
        brightMagenta: '#ff99dd',
        brightCyan: '#80f7ff',
        brightWhite: '#ffffff',
    },
};

const DEFAULT_THEME_KEY = 'midnight';
const DEFAULT_THEME = THEME_PRESETS[DEFAULT_THEME_KEY];
const TERMINAL_FONT_FAMILY = "'Cascadia Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const TERMINAL_OPTIONS = {
    allowTransparency: true,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: 'block',
    drawBoldTextInBrightColors: true,
    fontFamily: TERMINAL_FONT_FAMILY,
    lineHeight: 1.28,
    scrollback: 8000,
    smoothScrollDuration: 60,
};
const DEFAULT_ON_REQUEST_NEW_TAB = () => { };

export const TERMINAL_THEME_KEYS = Object.freeze(Object.keys(THEME_PRESETS));

function clampFontSize(value, fallback = 12, min = 10, max = 22) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function readThemePreset(value) {
    if (!value || typeof value !== 'string') return DEFAULT_THEME;
    return THEME_PRESETS[value] || DEFAULT_THEME;
}

function isMacPlatform() {
    if (typeof navigator === 'undefined') return false;
    const platform = String(navigator.platform || navigator.userAgent || '').toLowerCase();
    return platform.includes('mac');
}

function isAcceleratorPressed(event) {
    return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

function isShiftShortcut(event, key) {
    return event.shiftKey && String(event.key || '').toLowerCase() === key;
}

function isNewTabShortcut(event) {
    const key = String(event.key || '').toLowerCase();
    if (key !== 'n' || !event.shiftKey) return false;
    return isAcceleratorPressed(event) || event.altKey;
}

function readSeq(entry, fallback = -1) {
    return Number.isFinite(entry?.seq) ? entry.seq : fallback;
}

function writeTerminalEntry(terminal, entry) {
    if (!entry || entry.type !== 'output') return;
    const text = typeof entry.text === 'string' ? entry.text : '';
    if (!text) return;
    terminal.write(text);
}

export default function TerminalXtermPane({
    sessionId,
    entries = [],
    autoScroll = true,
    isActive = false,
    onActivate,
    onInput,
    onResize,
    themePreset = DEFAULT_THEME_KEY,
    fontSize = 12,
    onRequestNewTab = DEFAULT_ON_REQUEST_NEW_TAB,
}) {
    const hostRef = useRef(null);
    const terminalRef = useRef(null);
    const fitAddonRef = useRef(null);
    const observerRef = useRef(null);
    const fitFrameRef = useRef(null);
    const inputDisposeRef = useRef(null);
    const lastRenderedSeqRef = useRef(0);
    const lastReportedSizeRef = useRef({ cols: 0, rows: 0 });

    const onInputRef = useRef(onInput);
    const onResizeRef = useRef(onResize);
    const onActivateRef = useRef(onActivate);
    const onRequestNewTabRef = useRef(onRequestNewTab);

    useEffect(() => {
        onInputRef.current = onInput;
    }, [onInput]);

    useEffect(() => {
        onResizeRef.current = onResize;
    }, [onResize]);

    useEffect(() => {
        onActivateRef.current = onActivate;
    }, [onActivate]);

    useEffect(() => {
        onRequestNewTabRef.current = onRequestNewTab;
    }, [onRequestNewTab]);

    const outputEntries = useMemo(() => (Array.isArray(entries) ? entries : []), [entries]);

    const scheduleFit = useRef(null);
    if (!scheduleFit.current) {
        scheduleFit.current = () => {
            if (fitFrameRef.current) {
                cancelAnimationFrame(fitFrameRef.current);
            }

            fitFrameRef.current = requestAnimationFrame(() => {
                fitFrameRef.current = null;

                const terminal = terminalRef.current;
                const fitAddon = fitAddonRef.current;
                if (!terminal || !fitAddon) return;

                fitAddon.fit();

                const cols = terminal.cols;
                const rows = terminal.rows;
                const lastSize = lastReportedSizeRef.current;
                if (!sessionId) return;

                if (cols !== lastSize.cols || rows !== lastSize.rows) {
                    lastReportedSizeRef.current = { cols, rows };
                    onResizeRef.current?.(sessionId, cols, rows, { fallbackToHttp: true }).catch(() => {
                        // Resize failures are surfaced through hook error state.
                    });
                }
            });
        };
    }

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !sessionId) return undefined;

        const terminal = new Terminal({
            ...TERMINAL_OPTIONS,
            fontSize: 12,
            theme: DEFAULT_THEME,
        });

        terminal.attachCustomKeyEventHandler((event) => {
            if (!sessionId || event.type !== 'keydown') return true;

            try {
                if (isAcceleratorPressed(event) && isShiftShortcut(event, 'c')) {
                    const selected = terminal.getSelection();
                    if (selected) {
                        navigator?.clipboard?.writeText?.(selected).catch(() => { });
                    }
                    event.preventDefault();
                    return false;
                }

                if (isAcceleratorPressed(event) && isShiftShortcut(event, 'v')) {
                    navigator?.clipboard?.readText?.()
                        ?.then((text) => {
                            if (!text) return;
                            onInputRef.current?.(sessionId, text, { fallbackToHttp: true }).catch(() => { });
                        })
                        .catch(() => { });
                    event.preventDefault();
                    return false;
                }

                if (isAcceleratorPressed(event) && String(event.key || '').toLowerCase() === 'l') {
                    onInputRef.current?.(sessionId, '\u000c', { fallbackToHttp: true }).catch(() => { });
                    event.preventDefault();
                    return false;
                }

                if (isAcceleratorPressed(event) && isShiftShortcut(event, 'k')) {
                    terminal.clear();
                    event.preventDefault();
                    return false;
                }

                if (isNewTabShortcut(event)) {
                    onRequestNewTabRef.current?.();
                    event.preventDefault();
                    return false;
                }
            } catch {
                return true;
            }

            return true;
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(host);

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        lastRenderedSeqRef.current = 0;

        inputDisposeRef.current = terminal.onData((data) => {
            if (!sessionId || !data) return;
            onInputRef.current?.(sessionId, data, { fallbackToHttp: true }).catch(() => {
                // Input fallback behavior is managed by hook options.
            });
        });

        scheduleFit.current?.();

        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(() => {
                scheduleFit.current?.();
            });
            observer.observe(host);
            observerRef.current = observer;
        }

        const handleWindowResize = () => {
            scheduleFit.current?.();
        };
        window.addEventListener('resize', handleWindowResize);

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                scheduleFit.current?.();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('resize', handleWindowResize);

            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }

            if (fitFrameRef.current) {
                cancelAnimationFrame(fitFrameRef.current);
                fitFrameRef.current = null;
            }

            if (inputDisposeRef.current) {
                inputDisposeRef.current.dispose();
                inputDisposeRef.current = null;
            }

            terminalRef.current = null;
            fitAddonRef.current = null;
            terminal.dispose();
        };
    }, [sessionId]);

    useEffect(() => {
        const terminal = terminalRef.current;
        if (!terminal) return;

        terminal.options.theme = readThemePreset(themePreset);
        terminal.options.fontSize = clampFontSize(fontSize, 12, 10, 22);
        scheduleFit.current?.();
    }, [fontSize, themePreset]);

    useEffect(() => {
        const terminal = terminalRef.current;
        if (!terminal || !sessionId) return;

        if (outputEntries.length === 0) {
            terminal.reset();
            lastRenderedSeqRef.current = 0;
            return;
        }

        const lastRenderedSeq = lastRenderedSeqRef.current;
        const firstSeq = readSeq(outputEntries[0], 0);
        const lastSeq = readSeq(outputEntries[outputEntries.length - 1], 0);

        const shouldReplay = lastRenderedSeq === 0 || lastRenderedSeq < firstSeq;
        const nextEntries = shouldReplay
            ? outputEntries
            : outputEntries.filter((entry) => readSeq(entry, -1) > lastRenderedSeq);

        if (shouldReplay) {
            terminal.reset();
        }

        for (const entry of nextEntries) {
            writeTerminalEntry(terminal, entry);
        }

        if (autoScroll) {
            terminal.scrollToBottom();
        }

        if (Number.isFinite(lastSeq) && lastSeq > 0) {
            lastRenderedSeqRef.current = lastSeq;
        }
    }, [autoScroll, outputEntries, sessionId]);

    useEffect(() => {
        if (!isActive) return;
        terminalRef.current?.focus();
    }, [isActive, sessionId]);

    return (
        <div
            className={`terminal-xterm-shell ${isActive ? 'terminal-xterm-shell-active' : ''}`}
            onClick={() => {
                onActivateRef.current?.();
                terminalRef.current?.focus();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                // Only treat Space/Enter as an activation shortcut when the
                // wrapper div itself is the focused target (keyboard user
                // tabbing to the pane). If the event bubbled up from the
                // inner xterm textarea, let xterm handle the keystroke so
                // characters like space and enter reach the shell instead
                // of being swallowed by preventDefault().
                if (event.target !== event.currentTarget) {
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onActivateRef.current?.();
                    terminalRef.current?.focus();
                }
            }}
            aria-label={sessionId ? `Terminal output ${sessionId}` : 'Terminal output'}
        >
            <div ref={hostRef} className="terminal-xterm-host" />
        </div>
    );
}
