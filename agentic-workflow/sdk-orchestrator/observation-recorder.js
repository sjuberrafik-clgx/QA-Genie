/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OBSERVATION RECORDER — Runtime Observations + Optional Screenshot Evidence
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Persists runtime observations in a stable per-run JSONL log and optionally
 * captures page screenshots for browser-side anomalies.
 *
 * @module sdk-orchestrator/observation-recorder
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils');

class ObservationRecorder {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || path.join(__dirname, '..', '..');
        this.baseDir = options.baseDir || path.join(this.projectRoot, 'test-results', 'mission-evidence');
        ensureDir(this.baseDir);
    }

    async capturePageObservation(page, observation = {}) {
        const screenshotPath = await this._captureScreenshot(page, observation);
        return this.recordObservation({
            ...observation,
            screenshotPath,
            artifactPath: observation.artifactPath || screenshotPath || null,
        });
    }

    recordObservation(observation = {}) {
        const runId = observation.runId || 'adhoc-run';
        const entry = {
            id: observation.id || `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            runId,
            ticketId: observation.ticketId || null,
            source: observation.source || 'runtime',
            type: observation.type || 'observation',
            severity: observation.severity || 'info',
            stage: observation.stage || null,
            toolName: observation.toolName || null,
            scenarioId: observation.scenarioId || null,
            message: observation.message || '',
            pageUrl: observation.pageUrl || null,
            screenshotPath: observation.screenshotPath || null,
            artifactPath: observation.artifactPath || null,
            metadata: observation.metadata || {},
            timestamp: observation.timestamp || new Date().toISOString(),
        };

        const logPath = this.getObservationLogPath(runId);
        ensureDir(path.dirname(logPath));
        fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
        return { observation: entry, logPath };
    }

    getObservationLogPath(runId) {
        return path.join(this._getObservationDir(runId), 'observations.jsonl');
    }

    readObservations(runId, limit = 200) {
        const logPath = this.getObservationLogPath(runId);
        if (!fs.existsSync(logPath)) return [];

        try {
            const lines = fs.readFileSync(logPath, 'utf-8').split(/\r?\n/).filter(Boolean);
            return lines.slice(-limit).map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            }).filter(Boolean);
        } catch {
            return [];
        }
    }

    async _captureScreenshot(page, observation = {}) {
        if (!page || typeof page.screenshot !== 'function') return null;

        const runId = observation.runId || 'adhoc-run';
        const screenshotsDir = this._getScreenshotsDir(runId, observation.scenarioId);
        ensureDir(screenshotsDir);

        const safeType = this._slug(observation.type || 'observation');
        const fileName = `${Date.now()}-${safeType}.png`;
        const filePath = path.join(screenshotsDir, fileName);

        try {
            await page.screenshot({ path: filePath, fullPage: !!observation.fullPage });
            return filePath;
        } catch {
            return null;
        }
    }

    _getRunDir(runId) {
        return path.join(this.baseDir, runId);
    }

    _getObservationDir(runId) {
        return path.join(this._getRunDir(runId), 'observations');
    }

    _getScreenshotsDir(runId, scenarioId) {
        const baseDir = path.join(this._getRunDir(runId), 'screenshots');
        if (!scenarioId) return baseDir;
        return path.join(baseDir, this._slug(scenarioId));
    }

    _slug(value) {
        return String(value || 'observation')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'observation';
    }
}

module.exports = { ObservationRecorder };