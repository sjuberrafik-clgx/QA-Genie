import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', '..', 'learning-data', 'blocker-registry.json');

function normalizeText(value) {
    return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeSelector(value) {
    return (value || '')
        .toLowerCase()
        .replace(/#[a-z]+-[a-z0-9]{6,}/g, '#dynamic-id')
        .replace(/\b\d{3,}\b/g, ':n')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function compactText(text) {
    return normalizeText(text)
        .replace(/\b\d{1,4}\b/g, '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 14)
        .join(' ');
}

export class BlockerRegistry {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
        this.maxEntries = options.maxEntries ?? 200;
        this.data = { version: 1, entries: [] };
        this._load();
    }

    _load() {
        if (!this.enabled || !fs.existsSync(this.registryPath)) {
            return;
        }

        try {
            const raw = fs.readFileSync(this.registryPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.entries)) {
                this.data = parsed;
            }
        } catch {
            this.data = { version: 1, entries: [] };
        }
    }

    _persist() {
        if (!this.enabled) {
            return;
        }

        fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
        fs.writeFileSync(this.registryPath, JSON.stringify(this.data, null, 2));
    }

    _buildSignature(blocker, classification = {}) {
        return {
            category: classification.category || 'unknown',
            kind: blocker?.kind || 'unknown',
            role: blocker?.role || null,
            selectorHint: normalizeSelector(blocker?.selectorHint || ''),
            text: compactText([
                blocker?.text,
                blocker?.ariaLabel,
                blocker?.message,
            ].filter(Boolean).join(' ')),
        };
    }

    _keyForSignature(signature) {
        return [
            signature.category || 'unknown',
            signature.kind || 'unknown',
            signature.role || '',
            signature.selectorHint || '',
            signature.text || '',
        ].join('::');
    }

    _findEntry(signature) {
        const exactKey = this._keyForSignature(signature);
        const exact = this.data.entries.find((entry) => entry.key === exactKey);
        if (exact) {
            return exact;
        }

        return this.data.entries.find((entry) =>
            (entry.signature.category === signature.category || entry.signature.category === 'informational-modal' || signature.category === 'unknown-modal') &&
            ((entry.signature.text && signature.text && entry.signature.text === signature.text) ||
                (entry.signature.selectorHint && signature.selectorHint && entry.signature.selectorHint === signature.selectorHint))
        ) || null;
    }

    findResolution(blocker, classification = {}) {
        if (!this.enabled) {
            return null;
        }

        const signature = this._buildSignature(blocker, classification);
        const entry = this._findEntry(signature);
        if (!entry || !entry.preferredStrategy) {
            return null;
        }

        return {
            key: entry.key,
            signature: entry.signature,
            preferredStrategy: entry.preferredStrategy,
            resolveCount: entry.resolveCount || 0,
            lastResolvedAt: entry.lastResolvedAt || null,
        };
    }

    recordResolution({ blocker, classification = {}, strategy, control = null, source = 'runtime' }) {
        if (!this.enabled || !blocker || !strategy) {
            return null;
        }

        const signature = this._buildSignature(blocker, classification);
        const key = this._keyForSignature(signature);
        let entry = this.data.entries.find((item) => item.key === key);

        if (!entry) {
            entry = {
                key,
                signature,
                resolveCount: 0,
                firstResolvedAt: null,
                lastResolvedAt: null,
                strategies: [],
                preferredStrategy: null,
            };
            this.data.entries.unshift(entry);
        }

        const now = new Date().toISOString();
        entry.resolveCount += 1;
        entry.firstResolvedAt = entry.firstResolvedAt || now;
        entry.lastResolvedAt = now;

        const strategyKey = `${strategy}::${normalizeSelector(control?.selectorHint || '')}`;
        let strategyEntry = entry.strategies.find((item) => item.key === strategyKey);
        if (!strategyEntry) {
            strategyEntry = {
                key: strategyKey,
                name: strategy,
                count: 0,
                source,
                controlSelectorHint: control?.selectorHint || null,
                controlText: control?.text || control?.ariaLabel || null,
            };
            entry.strategies.push(strategyEntry);
        }

        strategyEntry.count += 1;
        strategyEntry.lastResolvedAt = now;
        entry.strategies.sort((left, right) => right.count - left.count);
        entry.preferredStrategy = {
            name: entry.strategies[0].name,
            controlSelectorHint: entry.strategies[0].controlSelectorHint,
            controlText: entry.strategies[0].controlText,
            count: entry.strategies[0].count,
        };

        this.data.entries = this.data.entries
            .sort((left, right) => new Date(right.lastResolvedAt || 0) - new Date(left.lastResolvedAt || 0))
            .slice(0, this.maxEntries);

        this._persist();
        return entry;
    }
}