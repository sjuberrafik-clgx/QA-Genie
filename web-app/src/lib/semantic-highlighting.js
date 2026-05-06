const SEMANTIC_CALLOUTS = [
    {
        kind: 'CAUTION',
        pattern: /^(?:#{1,6}\s*)?(?:\*\*)?(observation(?:\s+summary)?|issue(?:\s+summary)?|blocker|problem)(?:\*\*)?(?:\s*[:\-]|$)/i,
    },
    {
        kind: 'WARNING',
        pattern: /^(?:#{1,6}\s*)?(?:\*\*)?(risk(?:\s+summary)?|warning|concern)(?:\*\*)?(?:\s*[:\-]|$)/i,
    },
];

function getSemanticCalloutKind(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('> [!')) return null;

    for (const callout of SEMANTIC_CALLOUTS) {
        if (callout.pattern.test(trimmed)) {
            return callout.kind;
        }
    }

    return null;
}

export function normalizeSemanticCallouts(markdown) {
    if (!markdown || typeof markdown !== 'string') return markdown || '';

    const lines = markdown.split('\n');
    const output = [];
    let index = 0;
    let inCodeFence = false;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (/^```/.test(trimmed)) {
            inCodeFence = !inCodeFence;
            output.push(line);
            index += 1;
            continue;
        }

        if (!inCodeFence) {
            const calloutKind = getSemanticCalloutKind(line);
            if (calloutKind) {
                output.push(`> [!${calloutKind}]`);

                while (index < lines.length) {
                    const blockLine = lines[index];
                    const blockTrimmed = blockLine.trim();

                    if (/^```/.test(blockTrimmed)) {
                        break;
                    }

                    if (!blockTrimmed) {
                        output.push('>');
                        index += 1;
                        break;
                    }

                    output.push(`> ${blockLine.trimEnd()}`);
                    index += 1;
                }

                continue;
            }
        }

        output.push(line);
        index += 1;
    }

    return output.join('\n');
}