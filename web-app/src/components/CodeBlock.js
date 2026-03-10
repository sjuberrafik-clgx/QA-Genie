'use client';

import { useState, memo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
    const code = String(children).replace(/\n$/, '');
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : 'text';
    const label = LANGUAGE_LABELS[lang] || lang.toUpperCase() || 'CODE';
    const showLineNumbers = code.split('\n').length > 4;

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
