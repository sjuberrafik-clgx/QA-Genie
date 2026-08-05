/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SDK ATTACHMENT BUILDER — Wire Attachments → Agent-Consumable SDK Files
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Converts the wire attachment format used across the workflow
 *   [{ type:'image', media_type, data(base64) },
 *    { type:'video', media_type, tempPath, filename }]
 * into the SDK file-attachment shape an agent session consumes via
 * `sendAndWait(prompt, { attachments })`:
 *   [{ type:'file', path, displayName }]
 *
 * Images are decoded to temp files; recordings are frame-sampled (first + last +
 * evenly spaced, capped) via the VideoAnalyzer, mirroring AiTicketDrafter so a
 * scheduled agent "sees" the same evidence a chat user would attach.
 *
 * @module sdk-orchestrator/sdk-attachment-builder
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const IMAGE_EXT_BY_MIME = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

const MAX_SDK_VIDEO_FRAMES = 8;

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

/** Sample up to `max` frames (first + last + evenly spaced) for the model. */
function sampleFrames(frames, max) {
    if (!Array.isArray(frames) || frames.length <= max) return frames || [];
    const sampled = [frames[0]];
    const inner = max - 2;
    const step = (frames.length - 2) / (inner + 1);
    for (let k = 1; k <= inner; k++) {
        const idx = Math.min(Math.round(step * k), frames.length - 2);
        if (idx > 0) sampled.push(frames[idx]);
    }
    sampled.push(frames[frames.length - 1]);
    return sampled;
}

/**
 * Build SDK attachments from wire attachments.
 *
 * @param {Array} attachments - Wire attachments (images w/ base64 data, videos w/ tempPath)
 * @param {Object} [opts]
 * @param {Function} [opts.logger] - (message, level) => void
 * @returns {Promise<{ sdkAttachments: Array, tempFiles: string[], videoContextPrompt: string }>}
 */
async function buildSdkAttachments(attachments, opts = {}) {
    const log = typeof opts.logger === 'function' ? opts.logger : () => {};
    const sdkAttachments = [];
    const tempFiles = [];
    let videoContextPrompt = '';

    if (!Array.isArray(attachments) || attachments.length === 0) {
        return { sdkAttachments, tempFiles, videoContextPrompt };
    }

    const tempDir = os.tmpdir();
    for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i] || {};
        try {
            if (att.type === 'image' && isNonEmptyString(att.data)) {
                const ext = IMAGE_EXT_BY_MIME[att.media_type] || '.png';
                const filePath = path.join(tempDir, `sched-img-${Date.now()}-${i}${ext}`);
                fs.writeFileSync(filePath, Buffer.from(att.data, 'base64'));
                tempFiles.push(filePath);
                sdkAttachments.push({
                    type: 'file',
                    path: filePath,
                    displayName: isNonEmptyString(att.filename) ? att.filename : `attachment-${i + 1}${ext}`,
                });
            } else if (att.type === 'video' && isNonEmptyString(att.tempPath) && fs.existsSync(att.tempPath)) {
                const { createVideoAnalyzer } = require('./video-analyzer');
                const analyzer = createVideoAnalyzer();
                const result = await analyzer.buildVideoContext(att.tempPath);
                if (result?.frames?.length) {
                    for (const frame of result.frames) tempFiles.push(frame.path);
                    const sdkFrames = (result.sdkFrames && result.sdkFrames.length > 0) ? result.sdkFrames : result.frames;
                    for (const sf of sdkFrames) tempFiles.push(sf.path);

                    const sampled = sampleFrames(sdkFrames, MAX_SDK_VIDEO_FRAMES);
                    for (const frame of sampled) {
                        sdkAttachments.push({ type: 'file', path: frame.path, displayName: `video-frame-${frame.timestamp}s.jpg` });
                    }
                    if (isNonEmptyString(result.contextPrompt)) {
                        videoContextPrompt += (videoContextPrompt ? '\n\n' : '') + result.contextPrompt;
                    }
                    log(`[SchedAttach] Sampled ${sampled.length}/${sdkFrames.length} frames from recording`, 'info');
                }
            }
        } catch (err) {
            log(`[SchedAttach] Attachment ${i} skipped: ${err.message}`, 'warn');
        }
    }

    return { sdkAttachments, tempFiles, videoContextPrompt };
}

/** Best-effort cleanup of temp files produced by buildSdkAttachments. */
function cleanupTempFiles(tempFiles) {
    if (!Array.isArray(tempFiles)) return;
    for (const fp of tempFiles) {
        try { if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* best-effort */ }
    }
}

module.exports = {
    buildSdkAttachments,
    cleanupTempFiles,
    sampleFrames,
    MAX_SDK_VIDEO_FRAMES,
};
