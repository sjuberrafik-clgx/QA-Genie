/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCHEDULER ATTACHMENT STORE — Durable Attachments for Deferred Agent Runs
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A scheduled `agent.invoke` job may carry screenshots or a screen recording, the
 * same way BugGenie/TaskGenie accept media in chat. But a scheduled job fires
 * LATER (minutes → hours), and the chat video-upload temp dir is garbage-collected
 * after ~10 minutes. So attachments must be COPIED to a durable location at
 * SCHEDULING time and reloaded at FIRE time.
 *
 * Layout (per job):
 *   <storeDir>/<jobId>/<attId><ext>
 *
 * Images arrive inline as base64 and are decoded to a file. Recordings arrive as a
 * `tempPath` (from POST /api/chat/upload-video) and are COPIED out of the volatile
 * upload dir. Only lightweight refs — { id, type, media_type, filename, size,
 * file } — are persisted into the job record (never base64 / volatile temp paths).
 *
 * @module sdk-orchestrator/scheduler-attachment-store
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXT_BY_MIME = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

const VIDEO_EXT_BY_MIME = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/ogg': '.ogv',
};

// Chat-parity limits (see server.js chat message validation).
const DEFAULT_LIMITS = {
    maxImageBytes: 5 * 1024 * 1024,     // 5 MB per image
    maxVideoBytes: 200 * 1024 * 1024,   // 200 MB per recording
    maxImages: 3,
    maxVideos: 1,
};

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

function safeReal(p) {
    try { return fs.realpathSync(p); } catch { return null; }
}

/** Estimate decoded byte size of a base64 string (ignoring padding). */
function base64Bytes(b64) {
    if (typeof b64 !== 'string') return 0;
    const len = b64.length;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((len * 3) / 4) - padding;
}

class SchedulerAttachmentStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.storeDir]      - Durable root (default: test-artifacts/scheduler-attachments)
     * @param {string} [options.videoUploadDir] - Managed video upload dir for tempPath validation
     * @param {Object} [options.limits]         - Overrides for DEFAULT_LIMITS
     */
    constructor(options = {}) {
        this.storeDir = options.storeDir || path.join(
            __dirname, '..', 'test-artifacts', 'scheduler-attachments'
        );
        this.videoUploadDir = options.videoUploadDir || null;
        this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    }

    _jobDir(jobId) {
        return path.join(this.storeDir, String(jobId).replace(/[^A-Za-z0-9_-]/g, '_'));
    }

    /**
     * Validate wire attachments at scheduling time (before persistence).
     * @param {Array} attachments - [{type:'image', media_type, data}|{type:'video', media_type, tempPath, filename}]
     * @returns {{ ok: boolean, error?: string }}
     */
    validate(attachments) {
        if (attachments == null) return { ok: true };
        if (!Array.isArray(attachments)) return { ok: false, error: 'attachments must be an array.' };
        if (attachments.length === 0) return { ok: true };

        let images = 0;
        let videos = 0;
        for (const att of attachments) {
            if (!att || typeof att !== 'object') return { ok: false, error: 'Invalid attachment entry.' };
            if (att.type === 'image') {
                images++;
                if (!IMAGE_EXT_BY_MIME[att.media_type]) {
                    return { ok: false, error: `Unsupported image type: ${att.media_type || 'unknown'}.` };
                }
                if (!isNonEmptyString(att.data)) return { ok: false, error: 'Image attachment requires base64 data.' };
                if (base64Bytes(att.data) > this.limits.maxImageBytes) {
                    return { ok: false, error: `Image too large (max ${Math.round(this.limits.maxImageBytes / (1024 * 1024))} MB).` };
                }
            } else if (att.type === 'video') {
                videos++;
                if (!isNonEmptyString(att.tempPath)) return { ok: false, error: 'Recording attachment requires a tempPath from the upload endpoint.' };
                // Path-safety: tempPath must live inside the managed upload directory.
                if (this.videoUploadDir) {
                    const real = safeReal(att.tempPath);
                    const rootReal = safeReal(this.videoUploadDir);
                    if (!real || !rootReal || !(real === rootReal || real.startsWith(rootReal + path.sep))) {
                        return { ok: false, error: 'Recording path is outside the managed upload directory.' };
                    }
                }
                if (!fs.existsSync(att.tempPath)) {
                    return { ok: false, error: 'Recording file is no longer available. Please re-upload the recording.' };
                }
                try {
                    if (fs.statSync(att.tempPath).size > this.limits.maxVideoBytes) {
                        return { ok: false, error: `Recording too large (max ${Math.round(this.limits.maxVideoBytes / (1024 * 1024))} MB).` };
                    }
                } catch { /* existence already checked */ }
            } else {
                return { ok: false, error: `Unsupported attachment type: ${att.type || 'unknown'}.` };
            }
        }
        if (images > this.limits.maxImages) return { ok: false, error: `Too many images (max ${this.limits.maxImages}).` };
        if (videos > this.limits.maxVideos) return { ok: false, error: `Too many recordings (max ${this.limits.maxVideos}).` };
        return { ok: true };
    }

    /**
     * Persist wire attachments durably under the job's directory.
     * @param {string} jobId
     * @param {Array} attachments - Wire attachments (validated)
     * @returns {Array<Object>} Durable refs: [{ id, type, media_type, filename, size, file }]
     */
    persistForJob(jobId, attachments) {
        if (!Array.isArray(attachments) || attachments.length === 0) return [];
        const dir = this._jobDir(jobId);
        fs.mkdirSync(dir, { recursive: true });

        const refs = [];
        let index = 0;
        for (const att of attachments) {
            index++;
            const id = `att_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
            if (att.type === 'image' && isNonEmptyString(att.data)) {
                const ext = IMAGE_EXT_BY_MIME[att.media_type] || '.png';
                const file = `${id}${ext}`;
                const dest = path.join(dir, file);
                fs.writeFileSync(dest, Buffer.from(att.data, 'base64'));
                refs.push({
                    id, type: 'image', media_type: att.media_type,
                    filename: isNonEmptyString(att.filename) ? att.filename : `image-${index}${ext}`,
                    size: fs.statSync(dest).size, file,
                });
            } else if (att.type === 'video' && isNonEmptyString(att.tempPath) && fs.existsSync(att.tempPath)) {
                const ext = VIDEO_EXT_BY_MIME[att.media_type] || path.extname(att.tempPath) || '.mp4';
                const file = `${id}${ext}`;
                const dest = path.join(dir, file);
                fs.copyFileSync(att.tempPath, dest);
                refs.push({
                    id, type: 'video', media_type: att.media_type,
                    filename: isNonEmptyString(att.filename) ? att.filename : `recording-${index}${ext}`,
                    size: fs.statSync(dest).size, file,
                });
            }
        }
        return refs;
    }

    /**
     * Reload durable refs into the wire format the SDK attachment builder expects.
     * @param {string} jobId
     * @param {Array} refs - Durable refs from persistForJob
     * @returns {Array<Object>} [{type:'image', media_type, data}|{type:'video', media_type, tempPath, filename}]
     */
    loadForJob(jobId, refs) {
        if (!Array.isArray(refs) || refs.length === 0) return [];
        const dir = this._jobDir(jobId);
        const dirReal = safeReal(dir);
        if (!dirReal) return [];

        const out = [];
        for (const ref of refs) {
            if (!ref || !isNonEmptyString(ref.file)) continue;
            const dest = path.join(dir, path.basename(ref.file));
            const destReal = safeReal(dest);
            if (!destReal || !(destReal === dirReal || destReal.startsWith(dirReal + path.sep))) continue;
            if (!fs.existsSync(dest)) continue;
            if (ref.type === 'image') {
                out.push({ type: 'image', media_type: ref.media_type, data: fs.readFileSync(dest).toString('base64'), filename: ref.filename });
            } else if (ref.type === 'video') {
                out.push({ type: 'video', media_type: ref.media_type, tempPath: dest, filename: ref.filename });
            }
        }
        return out;
    }

    /**
     * Resolve a stored attachment file by id for serving/preview. Path-safe.
     * @param {string} jobId
     * @param {string} attId
     * @returns {{ path: string, size: number, mediaType: string|null }|null}
     */
    getAttachmentFile(jobId, attId) {
        if (!isNonEmptyString(attId)) return null;
        const dir = this._jobDir(jobId);
        const dirReal = safeReal(dir);
        if (!dirReal) return null;
        const safeId = String(attId).replace(/[^A-Za-z0-9_-]/g, '');
        let match = null;
        try {
            for (const f of fs.readdirSync(dir)) {
                if (f.startsWith(safeId)) { match = f; break; }
            }
        } catch { return null; }
        if (!match) return null;
        const dest = path.join(dir, match);
        const destReal = safeReal(dest);
        if (!destReal || !destReal.startsWith(dirReal + path.sep)) return null;
        const ext = path.extname(match).toLowerCase();
        const mediaType = Object.entries(IMAGE_EXT_BY_MIME).find(([, e]) => e === ext)?.[0]
            || Object.entries(VIDEO_EXT_BY_MIME).find(([, e]) => e === ext)?.[0]
            || null;
        return { path: dest, size: fs.statSync(dest).size, mediaType };
    }

    /** Delete all durable attachments for a job (terminal status / cancel / eviction). */
    cleanupJob(jobId) {
        const dir = this._jobDir(jobId);
        try {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        } catch { /* best-effort */ }
    }
}

module.exports = {
    SchedulerAttachmentStore,
    DEFAULT_LIMITS,
    IMAGE_EXT_BY_MIME,
    VIDEO_EXT_BY_MIME,
    base64Bytes,
};
