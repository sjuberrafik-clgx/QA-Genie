const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SKILLS_ROOT = path.join(PROJECT_ROOT, '.github', 'skills');

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'but', 'by', 'for', 'from', 'how', 'if',
    'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'them', 'then',
    'this', 'to', 'use', 'user', 'users', 'using', 'via', 'when', 'with', 'work', 'works', 'your',
]);

let cachedCatalog = null;
let cachedSignature = null;

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getCatalogSignature() {
    if (!fs.existsSync(SKILLS_ROOT)) return 'missing';

    const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
    const parts = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFilePath = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFilePath)) continue;
        const stat = fs.statSync(skillFilePath);
        parts.push(`${entry.name}:${stat.mtimeMs}`);
    }

    return parts.sort().join('|');
}

function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        return { attributes: {}, body: raw };
    }

    const attributes = {};
    for (const line of match[1].split(/\r?\n/)) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key) attributes[key] = value;
    }

    return {
        attributes,
        body: raw.slice(match[0].length),
    };
}

function tokenize(value) {
    return normalizeText(value).split(' ').filter(Boolean);
}

function expandTokenVariants(token) {
    const variants = new Set([token]);
    if (token.endsWith('ies') && token.length > 4) {
        variants.add(`${token.slice(0, -3)}y`);
    } else if (token.endsWith('s') && token.length > 4) {
        variants.add(token.slice(0, -1));
    }
    return [...variants];
}

function collectTriggerTokens(...sources) {
    const tokens = new Set();
    for (const source of sources) {
        for (const token of tokenize(source)) {
            if (token.length < 3 && token !== 'qa' && token !== 'ux' && token !== 'ui') continue;
            if (STOP_WORDS.has(token)) continue;
            for (const variant of expandTokenVariants(token)) {
                if (!STOP_WORDS.has(variant)) tokens.add(variant);
            }
        }
    }
    return [...tokens];
}

function buildPhraseEntries(phrases = []) {
    return phrases
        .map(phrase => ({
            original: phrase,
            normalized: normalizeText(phrase),
        }))
        .filter(entry => entry.normalized)
        .map(entry => ({
            ...entry,
            tokenCount: entry.normalized.split(' ').filter(Boolean).length,
        }));
}

function extractKeywords(body, description) {
    const keywordSet = new Set();
    const sources = [description || '', body || ''];

    for (const source of sources) {
        const lines = source.split(/\r?\n/);
        for (const line of lines) {
            const keywordMatch = line.match(/^Keywords\s*:\s*(.+)$/i);
            if (keywordMatch) {
                for (const keyword of keywordMatch[1].split(',')) {
                    const cleaned = keyword.trim();
                    if (cleaned) keywordSet.add(cleaned);
                }
            }
        }
    }

    return [...keywordSet];
}

function extractSectionLines(body, headingMatcher) {
    const lines = String(body || '').split(/\r?\n/);
    const sectionLines = [];
    let inSection = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const headingMatch = line.match(/^##+\s+(.+)$/);

        if (headingMatch) {
            if (inSection) break;
            inSection = headingMatcher.test(headingMatch[1].trim());
            continue;
        }

        if (!inSection || !line) continue;
        sectionLines.push(line);
    }

    return sectionLines;
}

function extractUseCasePhrases(body) {
    const lines = extractSectionLines(body, /^(when to use|when to use this skill|use cases?|examples?|triggers?)/i);
    const phrases = new Set();

    for (const line of lines) {
        const bulletMatch = line.match(/^[-*]\s+(.+)$/);
        const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
        const candidate = (bulletMatch?.[1] || numberedMatch?.[1] || '').trim();
        if (!candidate) continue;
        phrases.add(candidate.replace(/[.:]$/, '').trim());
    }

    return [...phrases];
}

function buildAliasPhrases(name, folderName) {
    const phrases = new Set();
    for (const value of [name, folderName]) {
        if (!value) continue;
        const trimmed = String(value).trim();
        if (!trimmed) continue;
        phrases.add(trimmed);
        if (/[-_]/.test(trimmed)) {
            phrases.add(trimmed.replace(/[-_]+/g, ' '));
        }
    }
    return [...phrases];
}

function summarizeSkill(skill) {
    const folderName = skill.folderName;
    if (folderName === 'ppt') {
        return 'PowerPoint skill for presentation setup, executive deck generation, and polished PPT workflows.';
    }
    return skill.description || `${folderName} skill`;
}

function loadProjectSkillsCatalog() {
    const signature = getCatalogSignature();
    if (cachedCatalog && cachedSignature === signature) {
        return cachedCatalog;
    }

    const skills = [];
    if (fs.existsSync(SKILLS_ROOT)) {
        const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillFilePath = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillFilePath)) continue;

            const raw = fs.readFileSync(skillFilePath, 'utf-8');
            const { attributes, body } = parseFrontmatter(raw);
            const name = String(attributes.name || entry.name).trim();
            const description = String(attributes.description || '').trim();
            const keywords = extractKeywords(body, description);
            const useCasePhrases = extractUseCasePhrases(body);
            const aliasPhrases = buildAliasPhrases(name, entry.name);
            const explicitKeywordEntries = buildPhraseEntries(keywords);
            const useCaseEntries = buildPhraseEntries(useCasePhrases);
            const aliasEntries = buildPhraseEntries(aliasPhrases);
            const triggerTokens = collectTriggerTokens(
                name,
                entry.name,
                description,
                keywords.join(' '),
                useCasePhrases.join(' '),
            );

            skills.push({
                id: entry.name,
                folderName: entry.name,
                name,
                description,
                skillFilePath,
                relativeSkillFilePath: path.relative(PROJECT_ROOT, skillFilePath).replace(/\\/g, '/'),
                keywords,
                normalizedKeywords: keywords.map(normalizeText).filter(Boolean),
                explicitKeywordEntries,
                useCasePhrases,
                useCaseEntries,
                aliasPhrases,
                aliasEntries,
                triggerTokens,
                body,
            });
        }
    }

    cachedCatalog = {
        skillsRoot: SKILLS_ROOT,
        skills: skills.sort((left, right) => left.folderName.localeCompare(right.folderName)),
    };
    cachedSignature = signature;
    return cachedCatalog;
}

function buildProjectSkillActivationGuide(catalog = loadProjectSkillsCatalog()) {
    if (!catalog.skills.length) return '';

    const lines = [
        '## Project Skills',
        'Project skills are discovered from `.github/skills/<skill>/SKILL.md` folders, following the native awesome-copilot style.',
    ];

    for (const skill of catalog.skills) {
        const keywordPreview = skill.keywords.slice(0, 8).map(keyword => `"${keyword}"`).join(', ');
        lines.push(`- **${skill.name}** — ${summarizeSkill(skill)} Skill file: ${skill.relativeSkillFilePath}.${keywordPreview ? ` Keywords: ${keywordPreview}.` : ''}`);
    }

    lines.push('- Prefer the skill folder and its markdown references as the source of truth; do not depend on a separate registry file.');
    return lines.join('\n');
}

function detectProjectSkillsForMessage(message, catalog = loadProjectSkillsCatalog()) {
    const normalizedMessage = normalizeText(message);
    if (!normalizedMessage) return [];

    const messageTokens = new Set(collectTriggerTokens(message));
    const hasPhraseMatch = (entry) => entry.tokenCount === 1
        ? messageTokens.has(entry.normalized)
        : normalizedMessage.includes(entry.normalized);

    return catalog.skills
        .map(skill => {
            const matchedKeywords = skill.explicitKeywordEntries
                .filter(hasPhraseMatch)
                .map(entry => entry.original);
            const matchedPhrases = skill.useCaseEntries
                .filter(hasPhraseMatch)
                .map(entry => entry.original);
            const matchedAliases = skill.aliasEntries
                .filter(hasPhraseMatch)
                .map(entry => entry.original);
            const matchedTokens = skill.triggerTokens.filter(token => messageTokens.has(token));

            let score = 0;
            for (const keyword of matchedKeywords) {
                const tokenCount = tokenize(keyword).length;
                score += tokenCount > 1 ? 8 : 6;
            }
            for (const phrase of matchedPhrases) {
                const tokenCount = tokenize(phrase).length;
                score += tokenCount > 2 ? 5 : 4;
            }
            for (const alias of matchedAliases) {
                const tokenCount = tokenize(alias).length;
                score += tokenCount > 1 ? 5 : 4;
            }
            score += Math.min(matchedTokens.length, 6);

            const hasStrongPhraseMatch = matchedKeywords.length > 0 || matchedPhrases.length > 0 || matchedAliases.length > 0;
            const meetsThreshold = hasStrongPhraseMatch || matchedTokens.length >= 2 || score >= 7;
            if (!meetsThreshold) return null;

            return {
                ...skill,
                matchedKeywords,
                matchedPhrases,
                matchedAliases,
                matchedTokens,
                score,
            };
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            if (right.matchedKeywords.length !== left.matchedKeywords.length) return right.matchedKeywords.length - left.matchedKeywords.length;
            return right.matchedTokens.length - left.matchedTokens.length;
        });
}

function buildProjectSkillRoutingHint(message, catalog = loadProjectSkillsCatalog()) {
    const matches = detectProjectSkillsForMessage(message, catalog);
    if (!matches.length) return '';

    const lines = [
        '[INTERNAL PROJECT SKILLS HINT]',
        'The user message matches folder-based project skills under `.github/skills/<skill>/SKILL.md`.',
    ];

    for (const match of matches) {
        const reasons = [
            match.matchedKeywords.length > 0 ? `keywords: ${match.matchedKeywords.join(', ')}` : '',
            match.matchedPhrases.length > 0 ? `use-cases: ${match.matchedPhrases.join(', ')}` : '',
            match.matchedTokens.length > 0 ? `tokens: ${match.matchedTokens.join(', ')}` : '',
        ].filter(Boolean).join(' | ');
        lines.push(`- Skill match: ${match.name} (folder: ${match.folderName}, score: ${match.score}${reasons ? `, ${reasons}` : ''})`);
    }

    const pptSkill = matches.find(match => match.folderName === 'ppt');
    if (pptSkill) {
        lines.push('- Use the PPT skill guidance from `.github/skills/ppt/SKILL.md` and its local references before generating the deck.');
    }

    return lines.join('\n');
}

module.exports = {
    buildProjectSkillActivationGuide,
    buildProjectSkillRoutingHint,
    detectProjectSkillsForMessage,
    loadProjectSkillsCatalog,
};