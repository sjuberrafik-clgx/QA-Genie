'use client';

import { useState, memo, useEffect, useRef } from 'react';
// Perf: PrismLight pulls only the core highlighter (~30 kB) instead of
// react-syntax-highlighter's "Prism" entry which statically imports ~150
// languages (~250 kB). Languages are registered on demand below, keyed by
// the fenced-code language tag.
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';

// Static language registry: aliases → loader thunk. Loaders return the
// language module's default export which we register on the highlighter.
// Keep this list aligned with the languages users actually paste — anything
// outside this set falls through to plain-text rendering (no highlight, no
// extra JS).
const LANGUAGE_LOADERS = {
    javascript: () => import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
    js: () => import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
    jsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
    typescript: () => import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
    ts: () => import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
    tsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
    python: () => import('react-syntax-highlighter/dist/esm/languages/prism/python'),
    py: () => import('react-syntax-highlighter/dist/esm/languages/prism/python'),
    json: () => import('react-syntax-highlighter/dist/esm/languages/prism/json'),
    bash: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
    sh: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
    shell: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
    powershell: () => import('react-syntax-highlighter/dist/esm/languages/prism/powershell'),
    yaml: () => import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
    yml: () => import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
    markdown: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
    md: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
    css: () => import('react-syntax-highlighter/dist/esm/languages/prism/css'),
    sql: () => import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
    diff: () => import('react-syntax-highlighter/dist/esm/languages/prism/diff'),
    docker: () => import('react-syntax-highlighter/dist/esm/languages/prism/docker'),
    dockerfile: () => import('react-syntax-highlighter/dist/esm/languages/prism/docker'),
};

// Track which languages have been registered to avoid duplicate imports.
const registeredLanguages = new Set();

async function ensureLanguageRegistered(lang) {
    if (!lang || registeredLanguages.has(lang)) return;
    const loader = LANGUAGE_LOADERS[lang];
    if (!loader) {
        registeredLanguages.add(lang); // negative cache so we don't retry
        return;
    }
    try {
        const mod = await loader();
        SyntaxHighlighter.registerLanguage(lang, mod.default);
        registeredLanguages.add(lang);
    } catch {
        registeredLanguages.add(lang);
    }
}

const LANGUAGE_LABELS = {
    js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
    ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
    py: 'Python', python: 'Python',
    json: 'JSON', html: 'HTML', css: 'CSS', scss: 'SCSS',
    sql: 'SQL', bash: 'Bash', sh: 'Shell', shell: 'Shell',
    yaml: 'YAML', yml: 'YAML', xml: 'XML', markdown: 'Markdown', md: 'Markdown',
    java: 'Java', cpp: 'C++', c: 'C', csharp: 'C#', cs: 'C#',
    go: 'Go', rust: 'Rust', ruby: 'Ruby', php: 'PHP', swift: 'Swift',
    kotlin: 'Kotlin', dart: 'Dart', graphql: 'GraphQL', docker: 'Dockerfile',
    dockerfile: 'Dockerfile', powershell: 'PowerShell', diff: 'Diff',
    plaintext: 'Text', text: 'Text', http: 'HTTP',
};

function CodeBlock({ className, children }) {
    const [copied, setCopied] = useState(false);
    // Bump `langReady` once the language module is registered so PrismLight
    // re-renders with proper highlighting (first paint shows plain text).
    const [langReady, setLangReady] = useState(0);
    const code = String(children).replace(/\n$/, '');
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : 'text';
    const label = LANGUAGE_LABELS[lang] || lang.toUpperCase() || 'CODE';
    const showLineNumbers = code.split('\n').length > 4;

    // Lazy-register the requested language. Effect re-runs only when `lang`
    // changes (typically once per CodeBlock instance).
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        if (lang && lang !== 'text' && !registeredLanguages.has(lang)) {
            ensureLanguageRegistered(lang).then(() => {
                if (mountedRef.current) setLangReady((n) => n + 1);
            });
        }
        return () => { mountedRef.current = false; };
    }, [lang]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    return (
        <div className="code-block-wrapper group/code">
            {/* Header bar */}
            <div className="code-block-header">
                <span className="code-block-lang">{label}</span>
                <button
                    onClick={handleCopy}
                    className="code-block-copy"
                    title="Copy code"
                >
                    {copied ? (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Copied!</span>
                        </>
                    ) : (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>
            {/* Highlighted code */}
            <SyntaxHighlighter
                style={oneDark}
                language={lang || 'text'}
                showLineNumbers={showLineNumbers}
                lineNumberStyle={{ color: '#636d83', fontSize: '12px', paddingRight: '16px', userSelect: 'none' }}
                customStyle={{
                    margin: 0,
                    borderRadius: '0 0 0.75rem 0.75rem',
                    padding: '16px',
                    fontSize: '13px',
                    background: '#1e1e2e',
                }}
                codeTagProps={{ style: { fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace" } }}
            >
                {code}
            </SyntaxHighlighter>
        </div>
    );
}

export default memo(CodeBlock);
