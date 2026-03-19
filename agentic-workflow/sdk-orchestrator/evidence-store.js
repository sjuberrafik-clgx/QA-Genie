/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EVIDENCE STORE — Durable Manifest Builder for QA Mission Artifacts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Aggregates run artifacts, Playwright attachments, and filesystem evidence
 * into a single manifest the dashboard can render and download against.
 *
 * @module sdk-orchestrator/evidence-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, readJSONSync, writeJSONSync } = require('./utils');
const { ObservationRecorder } = require('./observation-recorder');

const EVIDENCE_FILE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif',
    '.webm', '.mp4', '.mov', '.avi',
    '.zip', '.trace', '.json', '.txt', '.log', '.html', '.xml',
]);

class EvidenceStore {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || path.join(__dirname, '..', '..');
        this.baseDir = options.baseDir || path.join(__dirname, '..', 'test-artifacts', 'evidence');
        this.maxScannedFiles = options.maxScannedFiles || 200;
        this.observationRecorder = new ObservationRecorder({ projectRoot: this.projectRoot });
        ensureDir(this.baseDir);
    }

    /**
     * Build and persist an evidence manifest for a pipeline run.
     *
     * @param {Object} context
     * @param {Object} [options]
     * @param {string} [options.phase]
     * @param {string} [options.reportPath]
     * @returns {{ manifestPath: string, manifest: Object }}
     */
    saveManifest(context, options = {}) {
        const scenarioSuffix = context.scenarioSlug ? `-${context.scenarioSlug}` : '';
        const manifestPath = path.join(this.baseDir, `${context.runId}${scenarioSuffix}-manifest.json`);
        const existing = readJSONSync(manifestPath, null);
        const manifest = this._buildManifest(context, options, existing);
        writeJSONSync(manifestPath, manifest);
        return { manifestPath, manifest };
    }

    _buildManifest(context, options = {}, existing = null) {
        const rawResultsPath = context.testResults?.rawResultsFile || null;
        const rawResultsPayload = rawResultsPath ? readJSONSync(rawResultsPath, null) : null;
        const contextArtifacts = context.contextStore?.getAllArtifacts?.() || {};

        const manifest = {
            version: '1.0.0',
            runId: context.runId,
            ticketId: context.ticketId,
            mode: context.mode,
            generatedAt: new Date().toISOString(),
            updatedFromPhase: options.phase || null,
            pipeline: {
                startTime: new Date(context.startTime).toISOString(),
                specPath: context.specPath || null,
                explorationPath: context.explorationPath || null,
                reportPath: options.reportPath || context.reportPath || null,
                rawResultsPath,
                evidenceRoot: this._getRunEvidenceDir(context),
            },
            scenario: context.scenarioId ? {
                id: context.scenarioId,
                name: context.scenarioName || context.scenarioId,
                authState: context.authState || 'unspecified',
            } : null,
            summary: {
                totalArtifacts: 0,
                screenshots: 0,
                videos: 0,
                traces: 0,
                logs: 0,
                reports: 0,
                attachments: 0,
                observations: 0,
                failedTests: context.testResults?.failedCount || 0,
                passedTests: context.testResults?.passedCount || 0,
            },
            artifacts: [],
            tests: [],
            observations: [],
            sharedContextArtifacts: Object.entries(contextArtifacts).map(([key, value]) => ({
                key,
                path: value.path,
                agent: value.agent,
                metadata: value.metadata || {},
                registeredAt: value.registeredAt || null,
            })),
            evidenceScans: [],
            previousManifest: existing ? {
                generatedAt: existing.generatedAt || null,
                updatedFromPhase: existing.updatedFromPhase || null,
            } : null,
        };

        const artifactMap = new Map();
        const addArtifact = (artifact) => {
            if (!artifact || !artifact.path) return;
            const normalizedPath = path.resolve(artifact.path);
            const key = `${artifact.kind || 'artifact'}:${normalizedPath}`;
            if (artifactMap.has(key)) return;

            const stat = fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath) : null;
            const record = {
                ...artifact,
                path: normalizedPath,
                exists: !!stat,
                size: stat?.size || 0,
                modifiedAt: stat?.mtime?.toISOString?.() || null,
            };

            artifactMap.set(key, record);
            manifest.artifacts.push(record);
        };

        this._collectCoreArtifacts(context, options, addArtifact);
        this._collectPlaywrightEvidence(rawResultsPayload, manifest, addArtifact);
        this._collectRecordedObservations(context, manifest, addArtifact);
        this._collectFilesystemEvidence(context, manifest, addArtifact);

        manifest.summary.totalArtifacts = manifest.artifacts.length;
        manifest.summary.screenshots = manifest.artifacts.filter(a => a.kind === 'screenshot').length;
        manifest.summary.videos = manifest.artifacts.filter(a => a.kind === 'video').length;
        manifest.summary.traces = manifest.artifacts.filter(a => a.kind === 'trace').length;
        manifest.summary.logs = manifest.artifacts.filter(a => a.kind === 'log').length;
        manifest.summary.reports = manifest.artifacts.filter(a => a.kind === 'report').length;
        manifest.summary.attachments = manifest.tests.reduce((sum, test) => sum + (test.attachments?.length || 0), 0);
        manifest.summary.observations = manifest.observations.length;

        return manifest;
    }

    _collectCoreArtifacts(context, options, addArtifact) {
        const candidates = [
            { kind: 'test-case', label: 'Generated test cases', path: context.testCasesPath },
            { kind: 'exploration', label: 'Exploration data', path: context.explorationPath },
            { kind: 'spec', label: 'Generated spec', path: context.specPath },
            { kind: 'report', label: 'Raw test results', path: context.testResults?.rawResultsFile },
            { kind: 'report', label: 'Pipeline report', path: options.reportPath || context.reportPath },
        ];

        for (const candidate of candidates) {
            if (candidate.path) addArtifact(candidate);
        }
    }

    _collectPlaywrightEvidence(rawResultsPayload, manifest, addArtifact) {
        const playwrightResult = rawResultsPayload?.playwrightResult;
        if (!playwrightResult) return;

        const suites = Array.isArray(playwrightResult.suites) ? playwrightResult.suites : [];
        const tests = [];

        const visitSuite = (suite, ancestors = []) => {
            const titleParts = [...ancestors, suite.title].filter(Boolean);

            for (const spec of suite.specs || []) {
                const results = (spec.tests || []).flatMap(test => test.results || []);
                const attachments = [];

                for (const result of results) {
                    for (const attachment of result.attachments || []) {
                        const resolved = this._resolveAttachmentPath(attachment.path);
                        const record = {
                            name: attachment.name || 'attachment',
                            contentType: attachment.contentType || 'application/octet-stream',
                            path: resolved,
                            status: result.status || null,
                            error: result.error?.message || null,
                        };
                        attachments.push(record);

                        if (resolved) {
                            addArtifact({
                                kind: this._classifyArtifactKind(resolved, attachment.contentType),
                                label: attachment.name || path.basename(resolved),
                                path: resolved,
                                source: 'playwright-attachment',
                            });
                        }
                    }
                }

                tests.push({
                    title: [...titleParts, spec.title].filter(Boolean).join(' › '),
                    file: spec.file || null,
                    line: spec.line || null,
                    column: spec.column || null,
                    results: results.map(result => ({
                        status: result.status || null,
                        retry: result.retry || 0,
                        duration: result.duration || 0,
                        error: result.error?.message || null,
                    })),
                    attachments,
                });
            }

            for (const child of suite.suites || []) {
                visitSuite(child, titleParts);
            }
        };

        for (const suite of suites) {
            visitSuite(suite);
        }

        manifest.tests = tests;
    }

    _collectFilesystemEvidence(context, manifest, addArtifact) {
        const runEvidenceDir = this._getRunEvidenceDir(context);
        const scanTargets = [
            runEvidenceDir,
            path.join(this.projectRoot, 'test-results'),
            path.join(this.projectRoot, 'playwright-report'),
        ];

        const sinceMs = context.startTime || Date.now() - (60 * 60 * 1000);
        const seen = new Set();

        for (const target of scanTargets) {
            if (!fs.existsSync(target)) continue;

            const discovered = this._scanDirectory(target, sinceMs);
            manifest.evidenceScans.push({ directory: target, discovered: discovered.length });

            for (const filePath of discovered) {
                const resolved = path.resolve(filePath);
                if (seen.has(resolved)) continue;
                seen.add(resolved);

                addArtifact({
                    kind: this._classifyArtifactKind(resolved),
                    label: path.basename(resolved),
                    path: resolved,
                    source: target === runEvidenceDir ? 'run-evidence-dir' : 'scan',
                });
            }
        }
    }

    _collectRecordedObservations(context, manifest, addArtifact) {
        const observations = this.observationRecorder
            .readObservations(context.runId, 500)
            .filter(observation => !context.scenarioId || observation.scenarioId === context.scenarioId);
        manifest.observations = observations;

        for (const observation of observations) {
            if (observation.screenshotPath) {
                addArtifact({
                    kind: 'screenshot',
                    label: path.basename(observation.screenshotPath),
                    path: observation.screenshotPath,
                    source: 'observation-recorder',
                });
            }

            if (observation.artifactPath && observation.artifactPath !== observation.screenshotPath) {
                addArtifact({
                    kind: this._classifyArtifactKind(observation.artifactPath),
                    label: path.basename(observation.artifactPath),
                    path: observation.artifactPath,
                    source: 'observation-recorder',
                });
            }
        }
    }

    _scanDirectory(dirPath, sinceMs) {
        const results = [];
        const stack = [dirPath];

        while (stack.length > 0 && results.length < this.maxScannedFiles) {
            const current = stack.pop();
            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                    continue;
                }

                const ext = path.extname(entry.name).toLowerCase();
                if (!EVIDENCE_FILE_EXTENSIONS.has(ext)) continue;

                let stat = null;
                try {
                    stat = fs.statSync(fullPath);
                } catch {
                    continue;
                }

                if (stat.mtimeMs >= sinceMs - (2 * 60 * 1000)) {
                    results.push(fullPath);
                    if (results.length >= this.maxScannedFiles) break;
                }
            }
        }

        return results;
    }

    _resolveAttachmentPath(attachmentPath) {
        if (!attachmentPath) return null;
        if (path.isAbsolute(attachmentPath)) return attachmentPath;
        return path.resolve(this.projectRoot, attachmentPath);
    }

    _classifyArtifactKind(filePath, contentType = '') {
        const ext = path.extname(filePath || '').toLowerCase();
        if (contentType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return 'screenshot';
        if (contentType.startsWith('video/') || ['.webm', '.mp4', '.mov', '.avi'].includes(ext)) return 'video';
        if (ext === '.zip' || ext === '.trace') return 'trace';
        if (['.json', '.xml', '.html'].includes(ext)) return 'report';
        if (['.txt', '.log'].includes(ext)) return 'log';
        return 'artifact';
    }

    _getRunEvidenceDir(contextOrRunId) {
        if (typeof contextOrRunId === 'string') {
            return path.join(this.projectRoot, 'test-results', 'mission-evidence', contextOrRunId);
        }

        const runId = contextOrRunId?.runId;
        const scenarioSlug = contextOrRunId?.scenarioSlug;
        const baseDir = path.join(this.projectRoot, 'test-results', 'mission-evidence', runId);
        return scenarioSlug ? path.join(baseDir, scenarioSlug) : baseDir;
    }
}

module.exports = { EvidenceStore };