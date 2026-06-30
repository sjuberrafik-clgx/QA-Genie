const fs = require('fs');
const path = require('path');
const { normalizeText } = require('../utils/text-normalizers');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SKILLS_ROOT = path.join(PROJECT_ROOT, '.github', 'skills');
const STUDIO_WORKSPACES_ROOT = path.join(PROJECT_ROOT, 'studio-workspaces');

// Confidence tiers for skill routing
const CONFIDENCE = {
    HIGH: 'HIGH',     // score >= 15 — auto-activate, agent should read SKILL.md
    MEDIUM: 'MEDIUM', // score 7–14 — likely relevant, mention in hint
    LOW: 'LOW',       // score < 7  — suppress from injection
};
const HIGH_THRESHOLD = 15;
const MEDIUM_THRESHOLD = 7;
const MAX_SKILLS_PER_MESSAGE = 3;

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'but', 'by', 'for', 'from', 'how', 'if',
    'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'them', 'then',
    'this', 'to', 'use', 'user', 'users', 'using', 'via', 'when', 'with', 'work', 'works', 'your',
]);

let cachedCatalog = null;
let cachedSignature = null;

function getCatalogSignature() {
    const parts = [];

    // Scan .github/skills/
    if (fs.existsSync(SKILLS_ROOT)) {
        const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillFilePath = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillFilePath)) continue;
            const stat = fs.statSync(skillFilePath);
            parts.push(`gh:${entry.name}:${stat.mtimeMs}`);
        }
    }

    // Scan studio-workspaces/*/skills/*/
    if (fs.existsSync(STUDIO_WORKSPACES_ROOT)) {
        const wsEntries = fs.readdirSync(STUDIO_WORKSPACES_ROOT, { withFileTypes: true });
        for (const wsEntry of wsEntries) {
            if (!wsEntry.isDirectory()) continue;
            const skillsDir = path.join(STUDIO_WORKSPACES_ROOT, wsEntry.name, 'skills');
            if (!fs.existsSync(skillsDir)) continue;
            const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const skillEntry of skillEntries) {
                if (!skillEntry.isDirectory()) continue;
                const skillFilePath = path.join(skillsDir, skillEntry.name, 'SKILL.md');
                if (!fs.existsSync(skillFilePath)) continue;
                const stat = fs.statSync(skillFilePath);
                parts.push(`ws:${wsEntry.name}/${skillEntry.name}:${stat.mtimeMs}`);
            }
        }
    }

    return parts.sort().join('|') || 'empty';
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

    // Helper to build a skill entry from a SKILL.md path
    function scanSkillDir(dirPath, folderName, source, sourceLabel) {
        const skillFilePath = path.join(dirPath, 'SKILL.md');
        if (!fs.existsSync(skillFilePath)) return;

        // For studio skills, check manifest status — skip drafts (they're work-in-progress)
        const manifestPath = path.join(dirPath, 'skill.json');
        if (source === 'studio' && fs.existsSync(manifestPath)) {
            try {
                const statusCheck = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                if (statusCheck.status && statusCheck.status !== 'published') return;
            } catch { /* proceed if manifest unreadable */ }
        }

        const raw = fs.readFileSync(skillFilePath, 'utf-8');
        const { attributes, body } = parseFrontmatter(raw);
        const name = String(attributes.name || folderName).trim();
        const description = String(attributes.description || '').trim();
        const keywords = extractKeywords(body, description);
        const useCasePhrases = extractUseCasePhrases(body);
        const aliasPhrases = buildAliasPhrases(name, folderName);
        const explicitKeywordEntries = buildPhraseEntries(keywords);
        const useCaseEntries = buildPhraseEntries(useCasePhrases);
        const aliasEntries = buildPhraseEntries(aliasPhrases);
        const triggerTokens = collectTriggerTokens(
            name,
            folderName,
            description,
            keywords.join(' '),
            useCasePhrases.join(' '),
        );

        // Load skill.json manifest for studio skills (agent bindings, allowed tools)
        let agentBindings = [];
        let manifestKeywords = [];
        let alwaysActiveForBoundAgents = false;
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                agentBindings = Array.isArray(manifest.agentBindings) ? manifest.agentBindings : [];
                manifestKeywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
                alwaysActiveForBoundAgents = !!manifest.alwaysActiveForBoundAgents;
            } catch { /* ignore malformed manifests */ }
        }

        // Merge manifest keywords into the keyword set
        if (manifestKeywords.length > 0) {
            for (const kw of manifestKeywords) {
                const cleaned = String(kw).trim();
                if (cleaned && !keywords.includes(cleaned)) keywords.push(cleaned);
            }
        }

        skills.push({
            id: folderName,
            folderName,
            name,
            description,
            source,
            sourceLabel,
            skillFilePath,
            relativeSkillFilePath: path.relative(PROJECT_ROOT, skillFilePath).replace(/\\/g, '/'),
            keywords,
            normalizedKeywords: keywords.map(normalizeText).filter(Boolean),
            explicitKeywordEntries: buildPhraseEntries(keywords),
            useCasePhrases,
            useCaseEntries,
            aliasPhrases,
            aliasEntries,
            triggerTokens,
            agentBindings,
            alwaysActiveForBoundAgents,
            body,
        });
    }

    // Scan .github/skills/
    if (fs.existsSync(SKILLS_ROOT)) {
        const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            scanSkillDir(path.join(SKILLS_ROOT, entry.name), entry.name, 'project', '.github/skills');
        }
    }

    // Scan studio-workspaces/*/skills/*/
    if (fs.existsSync(STUDIO_WORKSPACES_ROOT)) {
        const wsEntries = fs.readdirSync(STUDIO_WORKSPACES_ROOT, { withFileTypes: true });
        for (const wsEntry of wsEntries) {
            if (!wsEntry.isDirectory()) continue;
            const skillsDir = path.join(STUDIO_WORKSPACES_ROOT, wsEntry.name, 'skills');
            if (!fs.existsSync(skillsDir)) continue;
            const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const skillEntry of skillEntries) {
                if (!skillEntry.isDirectory()) continue;
                scanSkillDir(
                    path.join(skillsDir, skillEntry.name),
                    skillEntry.name,
                    'studio',
                    `studio-workspaces/${wsEntry.name}`,
                );
            }
        }
    }

    cachedCatalog = {
        skillsRoot: SKILLS_ROOT,
        studioWorkspacesRoot: STUDIO_WORKSPACES_ROOT,
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

/**
 * Detect which project skills are relevant for a user message.
 *
 * @param {string} message - The user's raw message
 * @param {Object} [options]
 * @param {string} [options.activeAgent] - Current agent name (for agent-binding boost)
 * @param {Object} [options.catalog] - Pre-loaded catalog (default: load fresh)
 * @returns {Array<Object>} Matched skills with score, confidence, and match details
 */
function detectProjectSkillsForMessage(message, options = {}) {
    // Support legacy signature: detectProjectSkillsForMessage(message, catalog)
    let catalog, activeAgent;
    if (options && options.skills && Array.isArray(options.skills)) {
        catalog = options;
        activeAgent = null;
    } else {
        catalog = options.catalog || loadProjectSkillsCatalog();
        activeAgent = options.activeAgent || null;
    }

    const normalizedMessage = normalizeText(message);
    if (!normalizedMessage) return [];

    const messageTokens = new Set(collectTriggerTokens(message));
    const hasPhraseMatch = (entry) => entry.tokenCount === 1
        ? messageTokens.has(entry.normalized)
        : normalizedMessage.includes(entry.normalized);

    return catalog.skills
        .map(skill => {
            // Always-active binding: if skill is flagged and active agent matches, force HIGH confidence
            // This bypasses keyword matching entirely — the skill activates on every message for its bound agent
            const isAgentBound = activeAgent
                && Array.isArray(skill.agentBindings) && skill.agentBindings.length > 0
                && skill.agentBindings.some(binding => binding.toLowerCase() === activeAgent.toLowerCase());

            if (skill.alwaysActiveForBoundAgents && isAgentBound) {
                return {
                    ...skill,
                    matchedKeywords: [],
                    matchedPhrases: [],
                    matchedAliases: [],
                    matchedTokens: [],
                    score: HIGH_THRESHOLD,
                    confidence: CONFIDENCE.HIGH,
                    alwaysActive: true,
                };
            }

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

            // Agent-binding boost: if this skill is bound to the active agent, add +10
            if (isAgentBound) {
                score += 10;
            }

            const hasStrongPhraseMatch = matchedKeywords.length > 0 || matchedPhrases.length > 0 || matchedAliases.length > 0;
            const meetsThreshold = hasStrongPhraseMatch || matchedTokens.length >= 2 || score >= MEDIUM_THRESHOLD;
            if (!meetsThreshold) return null;

            // Assign confidence tier
            const confidence = score >= HIGH_THRESHOLD ? CONFIDENCE.HIGH
                : score >= MEDIUM_THRESHOLD ? CONFIDENCE.MEDIUM
                    : CONFIDENCE.LOW;

            return {
                ...skill,
                matchedKeywords,
                matchedPhrases,
                matchedAliases,
                matchedTokens,
                score,
                confidence,
            };
        })
        .filter(Boolean)
        .filter(match => match.confidence !== CONFIDENCE.LOW) // Suppress LOW confidence
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            if (right.matchedKeywords.length !== left.matchedKeywords.length) return right.matchedKeywords.length - left.matchedKeywords.length;
            return right.matchedTokens.length - left.matchedTokens.length;
        })
        .slice(0, MAX_SKILLS_PER_MESSAGE); // Cap to prevent context bloat
}

/**
 * Build a routing hint block for injection into agent context.
 * Only HIGH and MEDIUM confidence skills are included.
 *
 * @param {string} message - User message
 * @param {Object} [options]
 * @param {string} [options.activeAgent]
 * @param {Object} [options.catalog]
 * @returns {{ hint: string, matches: Array, activatedSkills: Array<string> }}
 */
function buildProjectSkillRoutingHint(message, options = {}) {
    const matches = detectProjectSkillsForMessage(message, options);
    if (!matches.length) return { hint: '', matches: [], activatedSkills: [] };

    const activatedSkills = matches
        .filter(m => m.confidence === CONFIDENCE.HIGH)
        .map(m => m.name);

    const lines = [
        '[INTERNAL PROJECT SKILLS HINT]',
        'The user message matches project skills. Read the matched SKILL.md files for guidance before responding.',
        '',
    ];

    for (const match of matches) {
        const confidenceTag = match.confidence === CONFIDENCE.HIGH ? '🔴 AUTO-ACTIVATE' : '🟡 RELEVANT';
        const reasons = match.alwaysActive
            ? 'agent-bound (always active for this agent)'
            : [
                match.matchedKeywords.length > 0 ? `keywords: ${match.matchedKeywords.join(', ')}` : '',
                match.matchedPhrases.length > 0 ? `use-cases: ${match.matchedPhrases.join(', ')}` : '',
                match.matchedTokens.length > 0 ? `tokens: ${match.matchedTokens.slice(0, 5).join(', ')}` : '',
            ].filter(Boolean).join(' | ');
        lines.push(`- [${confidenceTag}] **${match.name}** (score: ${match.score}, file: ${match.relativeSkillFilePath})`);
        if (reasons) lines.push(`  Matched: ${reasons}`);
        if (match.confidence === CONFIDENCE.HIGH) {
            lines.push(`  → Read \`${match.relativeSkillFilePath}\` NOW and follow its instructions.`);
        }
    }

    if (matches.length > 1) {
        lines.push('');
        lines.push('Multiple skills matched. Apply all HIGH-confidence skills. For MEDIUM, mention availability to the user.');
    }

    return { hint: lines.join('\n'), matches, activatedSkills };
}

module.exports = {
    buildProjectSkillActivationGuide,
    buildProjectSkillRoutingHint,
    detectProjectSkillsForMessage,
    loadProjectSkillsCatalog,
    CONFIDENCE,
    HIGH_THRESHOLD,
    MEDIUM_THRESHOLD,
    MAX_SKILLS_PER_MESSAGE,
};