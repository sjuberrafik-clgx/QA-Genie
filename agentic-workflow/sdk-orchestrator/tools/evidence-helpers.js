/**
 * Evidence collection, session documents, attachment utilities,
 * and media comment builders.
 * Extracted from custom-tools.js
 */
const fs = require('fs');
const path = require('path');
const { markdownToAdf, markdownToWikiMarkup } = require('../adf-converter');
const {
    COMMENT_IMAGE_EXTENSIONS,
    COMMENT_IMAGE_MIME_MAP,
    COMMENT_VIDEO_EXTENSIONS,
    COMMENT_VIDEO_MIME_MAP,
    VALID_IMAGE_MIME_TYPES,
    VALID_VIDEO_MIME_TYPES,
    PROJECT_ROOT,
} = require('./constants');
const { isNonEmptyString } = require('./general-helpers');
const {
    buildJiraIssueApiUrl,
    buildJiraAttachmentUrl,
    sanitizeFileName,
    buildMultipartPayload,
    buildJiraAttachmentHeaders,
} = require('./jira-api-helpers');

function getEvidenceItemTimestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveEvidenceScopeMessageId(entry, options = {}) {
    const explicitMessageId = isNonEmptyString(options?.messageId) ? options.messageId.trim() : '';
    if (explicitMessageId) return explicitMessageId;

    const activeEvidenceMessageId = isNonEmptyString(options?.activeEvidenceMessageId)
        ? options.activeEvidenceMessageId.trim()
        : (isNonEmptyString(entry?.sessionContext?.activeEvidenceMessageId)
            ? entry.sessionContext.activeEvidenceMessageId.trim()
            : '');
    if (activeEvidenceMessageId) return activeEvidenceMessageId;

    if (options?.latestOnly !== true) return null;

    let latestMessageId = null;
    let latestTimestamp = 0;
    const consider = (item) => {
        if (!isNonEmptyString(item?.messageId)) return;
        const itemTimestamp = getEvidenceItemTimestamp(item?.timestamp);
        if (!latestMessageId || itemTimestamp >= latestTimestamp) {
            latestMessageId = item.messageId.trim();
            latestTimestamp = itemTimestamp;
        }
    };

    if (Array.isArray(entry?.sessionAttachments)) {
        for (const item of entry.sessionAttachments) consider(item);
    }
    if (Array.isArray(entry?.videoContext)) {
        for (const item of entry.videoContext) consider(item);
    }

    return latestMessageId;
}

function isEvidenceItemInScope(item, scopeMessageId) {
    if (!scopeMessageId) return true;
    return isNonEmptyString(item?.messageId) && item.messageId.trim() === scopeMessageId;
}

function collectSessionEvidence(entry, options = {}) {
    const scopeMessageId = resolveEvidenceScopeMessageId(entry, options);
    const images = Array.isArray(entry?.sessionAttachments)
        ? entry.sessionAttachments.filter(att => att?.type === 'image' && isNonEmptyString(att?.data) && isEvidenceItemInScope(att, scopeMessageId))
        : [];

    const videosByKey = new Map();

    const upsertVideo = (video) => {
        if (!video) return;

        const videoPath = isNonEmptyString(video.videoPath) ? video.videoPath
            : (isNonEmptyString(video.tempPath) ? video.tempPath : '');
        const url = isNonEmptyString(video.url) ? video.url : '';
        const messageId = isNonEmptyString(video.messageId) ? video.messageId.trim() : '';
        const keyBase = videoPath || url || `${video.filename || 'video'}:${video.timestamp || ''}`;
        const key = messageId ? `${messageId}::${keyBase}` : keyBase;
        if (!key) return;

        const normalized = {
            messageId: messageId || undefined,
            filename: video.filename || (videoPath ? path.basename(videoPath) : 'recording.mp4'),
            media_type: video.media_type || undefined,
            videoPath: videoPath || undefined,
            url: url || undefined,
            provider: video.provider || undefined,
            duration: Number.isFinite(video.duration) ? video.duration : null,
            frameCount: Number.isFinite(video.frameCount) ? video.frameCount : 0,
            frames: Array.isArray(video.frames) ? video.frames.filter(frame => isNonEmptyString(frame?.path)) : [],
            metadata: video.metadata || null,
            timestamp: video.timestamp || undefined,
        };

        const existing = videosByKey.get(key);
        if (!existing) {
            videosByKey.set(key, normalized);
            return;
        }

        const mergedFrames = [];
        const seenFramePaths = new Set();
        for (const frame of [...existing.frames, ...normalized.frames]) {
            if (!isNonEmptyString(frame?.path) || seenFramePaths.has(frame.path)) continue;
            seenFramePaths.add(frame.path);
            mergedFrames.push(frame);
        }

        videosByKey.set(key, {
            ...existing,
            ...normalized,
            filename: existing.filename || normalized.filename,
            media_type: existing.media_type || normalized.media_type,
            videoPath: existing.videoPath || normalized.videoPath,
            url: existing.url || normalized.url,
            provider: existing.provider || normalized.provider,
            duration: existing.duration ?? normalized.duration,
            frameCount: Math.max(existing.frameCount || 0, normalized.frameCount || 0, mergedFrames.length),
            frames: mergedFrames,
            metadata: existing.metadata || normalized.metadata,
            timestamp: existing.timestamp || normalized.timestamp,
        });
    };

    if (Array.isArray(entry?.sessionAttachments)) {
        for (const att of entry.sessionAttachments) {
            if (att?.type === 'video' && (isNonEmptyString(att?.tempPath) || isNonEmptyString(att?.url)) && isEvidenceItemInScope(att, scopeMessageId)) {
                upsertVideo(att);
            }
        }
    }

    if (Array.isArray(entry?.videoContext)) {
        for (const ctx of entry.videoContext) {
            if (((Array.isArray(ctx?.frames) && ctx.frames.length > 0) || isNonEmptyString(ctx?.videoPath)) && isEvidenceItemInScope(ctx, scopeMessageId)) {
                upsertVideo(ctx);
            }
        }
    }

    const videos = Array.from(videosByKey.values()).filter(video =>
        (Array.isArray(video.frames) && video.frames.length > 0)
        || isNonEmptyString(video.videoPath)
    );

    return {
        images,
        videos,
        scopeMessageId,
        hasEvidence: images.length > 0 || videos.length > 0,
    };
}

function collectSessionDocuments(entry, options = {}) {
    const scopeMessageId = resolveEvidenceScopeMessageId(entry, options);
    const documents = Array.isArray(entry?.sessionAttachments)
        ? entry.sessionAttachments
            .filter(att => att?.type === 'document' && isNonEmptyString(att?.path) && isEvidenceItemInScope(att, scopeMessageId))
            .filter(att => {
                try {
                    return fs.existsSync(att.path);
                } catch {
                    return false;
                }
            })
            .sort((left, right) => getEvidenceItemTimestamp(right?.timestamp) - getEvidenceItemTimestamp(left?.timestamp))
        : [];

    return { documents, scopeMessageId };
}

function findSessionDocument(entry, filename, options = {}) {
    const { documents, scopeMessageId } = collectSessionDocuments(entry, options);
    if (documents.length === 0) {
        return { documents, scopeMessageId, match: null };
    }

    if (!isNonEmptyString(filename)) {
        return { documents, scopeMessageId, match: documents[0] };
    }

    const needle = filename.trim().toLowerCase();
    const exact = documents.find(doc => String(doc.filename || '').trim().toLowerCase() === needle);
    if (exact) return { documents, scopeMessageId, match: exact };

    const partial = documents.find(doc => String(doc.filename || '').trim().toLowerCase().includes(needle));
    return { documents, scopeMessageId, match: partial || null };
}

function selectVideoFrames(videoCtx, frameTimestamps, maxFrames = 8) {
    const selectedFrames = [];
    const seenPaths = new Set();

    for (const video of videoCtx) {
        if (!Array.isArray(video?.frames) || video.frames.length === 0) continue;

        if (Array.isArray(frameTimestamps) && frameTimestamps.length > 0) {
            for (const ts of frameTimestamps) {
                const match = video.frames.find(frame => Math.abs(frame.timestamp - ts) <= 1);
                if (match && !seenPaths.has(match.path)) {
                    seenPaths.add(match.path);
                    selectedFrames.push(match);
                }
            }
            continue;
        }

        const step = Math.max(1, Math.floor(video.frames.length / maxFrames));
        for (let i = 0; i < video.frames.length && selectedFrames.length < maxFrames; i += step) {
            const frame = video.frames[i];
            if (!seenPaths.has(frame.path)) {
                seenPaths.add(frame.path);
                selectedFrames.push(frame);
            }
        }
    }

    return selectedFrames.slice(0, maxFrames);
}

async function uploadJiraAttachment(attachUrl, jiraConfig, fileName, mimeType, buffer, boundaryPrefix, extra = {}) {
    try {
        const { boundary, body } = buildMultipartPayload(fileName, mimeType, buffer, boundaryPrefix);
        const response = await fetch(attachUrl, {
            method: 'POST',
            headers: buildJiraAttachmentHeaders(jiraConfig, boundary),
            body,
        });

        if (response.ok) {
            // Parse response to get attachment metadata (id, content URL, etc.)
            let attachmentMeta = null;
            try {
                const jsonResp = await response.json();
                // Jira returns an array of attachment objects
                attachmentMeta = Array.isArray(jsonResp) ? jsonResp[0] : jsonResp;
            } catch (_parseErr) { /* best-effort metadata extraction */ }

            return { fileName, success: true, attachmentMeta, ...extra };
        }

        const errText = await response.text();
        return {
            fileName,
            success: false,
            error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
            ...extra,
        };
    } catch (error) {
        return { fileName, success: false, error: error.message, ...extra };
    }
}

function resolveWorkspaceFilePath(rawPath, workspaceRoot = PROJECT_ROOT) {
    let resolvedPath = String(rawPath || '');
    if (!path.isAbsolute(resolvedPath)) {
        resolvedPath = path.resolve(workspaceRoot, resolvedPath);
    }
    return resolvedPath;
}

function createUniqueAttachmentFileName(fileName, seenNames) {
    const normalizedName = sanitizeFileName(fileName || 'attachment');
    const ext = path.extname(normalizedName);
    const stem = ext ? normalizedName.slice(0, -ext.length) : normalizedName;

    let candidate = normalizedName || `attachment${ext}`;
    let suffix = 2;
    while (seenNames.has(candidate.toLowerCase())) {
        candidate = `${stem || 'attachment'}-${suffix}${ext}`;
        suffix += 1;
    }

    seenNames.add(candidate.toLowerCase());
    return candidate;
}

function formatAttachmentSize(sizeBytes) {
    const value = Number(sizeBytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
}

function createCommentScreenshotFileName(index, mimeType) {
    const ext = mimeType === 'image/jpeg' ? '.jpg'
        : mimeType === 'image/gif' ? '.gif'
            : mimeType === 'image/webp' ? '.webp'
                : mimeType === 'image/svg+xml' ? '.svg'
                    : '.png';
    return `comment-screenshot-${index}${ext}`;
}

function createCommentFrameFileName(videoFileName, timestamp) {
    const videoBase = path.basename(String(videoFileName || 'recording'), path.extname(String(videoFileName || 'recording')));
    const timeLabel = String(timestamp).replace(/[^0-9.]/g, '_');
    return `${sanitizeFileName(videoBase || 'recording')}-frame-${timeLabel || '0'}s.jpg`;
}

function createAdfTextNode(text, marks) {
    const node = {
        type: 'text',
        text,
    };
    if (Array.isArray(marks) && marks.length > 0) {
        node.marks = marks;
    }
    return node;
}

function appendAdfBulletSection(adf, title, items) {
    if (!adf || !Array.isArray(adf.content) || !Array.isArray(items) || items.length === 0) return;

    adf.content.push({
        type: 'paragraph',
        content: [createAdfTextNode(title, [{ type: 'strong' }])],
    });

    adf.content.push({
        type: 'bulletList',
        content: items.map(item => ({
            type: 'listItem',
            content: [{
                type: 'paragraph',
                content: item,
            }],
        })),
    });
}

async function resolveCommentMediaFileIds(apiConfig, ticketKey, uploadedAttachments) {
    const attachmentsNeedingIds = uploadedAttachments.filter(att => isNonEmptyString(att?.id));
    if (attachmentsNeedingIds.length === 0) return;

    try {
        const issueAttUrl = `${buildJiraIssueApiUrl(apiConfig, ticketKey)}?fields=attachment`;
        const issueAttResp = await fetch(issueAttUrl, {
            method: 'GET',
            headers: apiConfig.headers,
        });

        if (!issueAttResp.ok) return;

        const issueData = await issueAttResp.json();
        const jiraAttachments = issueData?.fields?.attachment || [];
        for (const att of attachmentsNeedingIds) {
            const match = jiraAttachments.find(item => String(item.id) === String(att.id));
            if (match?.mediaApiFileId) {
                att.mediaFileId = match.mediaApiFileId;
            }
        }
    } catch {
        // Best-effort only.
    }
}

function buildJiraMediaCommentWikiBody(comment, uploadedAttachments, skippedVideos) {
    const sections = [markdownToWikiMarkup(comment || '')];

    const uploadedVideos = uploadedAttachments.filter(att => att.category === 'video');
    const inlineAttachments = uploadedAttachments.filter(att => att.category !== 'video');

    if (uploadedVideos.length > 0 || skippedVideos.length > 0) {
        const lines = ['h3. Video evidence'];

        for (const video of uploadedVideos) {
            lines.push(`* ${video.filename}`);
        }

        for (const skipped of skippedVideos) {
            lines.push(`* ${skipped.fileName} - skipped original upload (${skipped.error})`);
        }

        sections.push(lines.join('\n'));
    }

    if (inlineAttachments.length > 0) {
        sections.push(inlineAttachments.map(att => `!${att.filename}|thumbnail!`).join('\n'));
    }

    return sections.filter(section => isNonEmptyString(section)).join('\n\n');
}

function buildJiraMediaCommentAdf(comment, uploadedAttachments, skippedVideos, layout, useInlineMedia) {
    const adf = markdownToAdf(comment || '');
    const uploadedVideos = uploadedAttachments.filter(att => att.category === 'video');
    const inlineAttachments = uploadedAttachments.filter(att => att.category !== 'video');

    const videoItems = uploadedVideos.map(video => [createAdfTextNode(video.filename)]);

    const skippedVideoItems = skippedVideos.map(skipped => [
        createAdfTextNode(`${skipped.fileName} - skipped original upload (${skipped.error})`),
    ]);

    appendAdfBulletSection(adf, 'Video evidence:', [...videoItems, ...skippedVideoItems]);

    if (useInlineMedia) {
        const unresolvedInlineAttachments = [];
        for (const att of inlineAttachments) {
            if (!isNonEmptyString(att.mediaFileId)) {
                unresolvedInlineAttachments.push(att);
                continue;
            }

            adf.content.push({
                type: 'mediaSingle',
                attrs: { layout },
                content: [{
                    type: 'media',
                    attrs: {
                        id: att.mediaFileId,
                        type: 'file',
                        collection: '',
                    },
                }],
            });
        }

        if (unresolvedInlineAttachments.length > 0) {
            const unresolvedItems = unresolvedInlineAttachments.map(att => {
                if (isNonEmptyString(att.contentUrl)) {
                    return [createAdfTextNode(att.filename, [{ type: 'link', attrs: { href: att.contentUrl } }])];
                }
                return [createAdfTextNode(att.filename)];
            });
            appendAdfBulletSection(adf, 'Attached previews:', unresolvedItems);
        }

        return adf;
    }

    const mediaItems = inlineAttachments.map(att => {
        if (isNonEmptyString(att.contentUrl)) {
            return [createAdfTextNode(att.filename, [{ type: 'link', attrs: { href: att.contentUrl } }])];
        }
        return [createAdfTextNode(att.filename)];
    });
    appendAdfBulletSection(adf, 'Attached previews:', mediaItems);
    return adf;
}

async function postJiraCommentWithMedia({ ticketKey, comment, uploadedAttachments, skippedVideos, apiConfig, imageLayout }) {
    let commentResult = { success: false };
    const layout = imageLayout || 'center';

    try {
        const v2Base = apiConfig.cloudId
            ? `https://api.atlassian.com/ex/jira/${apiConfig.cloudId}/rest/api/2`
            : `${(apiConfig.baseUrl || '').replace(/\/+$/, '')}/rest/api/2`;
        const v2CommentUrl = `${v2Base}/issue/${ticketKey}/comment`;
        const wikiBody = buildJiraMediaCommentWikiBody(comment, uploadedAttachments, skippedVideos);

        const v2Resp = await fetch(v2CommentUrl, {
            method: 'POST',
            headers: apiConfig.headers,
            body: JSON.stringify({ body: wikiBody }),
        });

        if (v2Resp.ok) {
            let data = null;
            try { data = await v2Resp.json(); } catch { /* best-effort */ }
            commentResult = {
                success: true,
                commentId: data?.id || null,
                strategy: 'v2-wiki-markup',
            };
        }
    } catch {
        // Non-fatal: fall through to ADF strategies.
    }

    if (!commentResult.success) {
        await resolveCommentMediaFileIds(apiConfig, ticketKey, uploadedAttachments);

        const hasInlineMediaFileIds = uploadedAttachments.some(att => att.category !== 'video' && isNonEmptyString(att.mediaFileId));
        if (hasInlineMediaFileIds) {
            const commentUrl = buildJiraIssueApiUrl(apiConfig, ticketKey, '/comment');
            const adf = buildJiraMediaCommentAdf(comment, uploadedAttachments, skippedVideos, layout, true);

            const resp = await fetch(commentUrl, {
                method: 'POST',
                headers: apiConfig.headers,
                body: JSON.stringify({ body: adf }),
            });

            if (resp.ok) {
                let data = null;
                try { data = await resp.json(); } catch { /* best-effort */ }
                commentResult = {
                    success: true,
                    commentId: data?.id || null,
                    strategy: 'v3-adf-mediaFileId',
                };
            }
        }
    }

    if (!commentResult.success) {
        const commentUrl = buildJiraIssueApiUrl(apiConfig, ticketKey, '/comment');
        const fallbackAdf = buildJiraMediaCommentAdf(comment, uploadedAttachments, skippedVideos, layout, false);

        const resp = await fetch(commentUrl, {
            method: 'POST',
            headers: apiConfig.headers,
            body: JSON.stringify({ body: fallbackAdf }),
        });

        if (resp.ok) {
            let data = null;
            try { data = await resp.json(); } catch { /* best-effort */ }
            commentResult = {
                success: true,
                commentId: data?.id || null,
                strategy: 'v3-adf-text-links',
                note: 'Videos are attached to the Jira issue and listed by file name in the comment because Jira Cloud does not support inline video playback for this REST workflow.',
            };
        } else {
            const errText = await resp.text();
            commentResult = {
                success: false,
                error: `Comment creation failed (all strategies exhausted). Last error: HTTP ${resp.status}: ${errText.slice(0, 300)}`,
            };
        }
    }

    return commentResult;
}

async function buildJiraMediaCommentPlan({
    imagePaths = [],
    videoPaths = [],
    entry,
    messageId,
    activeEvidenceMessageId,
    latestOnly = false,
    includeVideoFrames = true,
    frameTimestamps,
    maxVideoFrames = 4,
}) {
    const workspaceRoot = PROJECT_ROOT;
    const plan = {
        uploadTargets: [],
        skippedVideos: [],
        frameWarnings: [],
        cleanupItems: [],
        scopeMessageId: undefined,
        hasMedia: false,
    };
    const seenNames = new Set();
    let sessionImageIndex = 1;

    const pushTarget = (target) => {
        plan.uploadTargets.push({
            ...target,
            fileName: createUniqueAttachmentFileName(target.fileName, seenNames),
        });
    };

    for (const rawPath of imagePaths) {
        const resolvedPath = resolveWorkspaceFilePath(rawPath, workspaceRoot);
        if (!fs.existsSync(resolvedPath)) {
            return { error: `File not found: ${rawPath}` };
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
            return { error: `Path is not a file: ${rawPath}` };
        }
        if (stat.size > JIRA_MAX_ATTACHMENT_SIZE) {
            return { error: `File exceeds 50 MB limit: ${rawPath} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)` };
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        if (!COMMENT_IMAGE_EXTENSIONS.has(ext)) {
            return { error: `Unsupported image format: ${ext}. Supported: ${[...COMMENT_IMAGE_EXTENSIONS].join(', ')}` };
        }

        pushTarget({
            category: 'image',
            fileName: path.basename(resolvedPath),
            mimeType: COMMENT_IMAGE_MIME_MAP[ext] || 'application/octet-stream',
            size: stat.size,
            buffer: fs.readFileSync(resolvedPath),
        });
    }

    for (const rawPath of videoPaths) {
        const resolvedPath = resolveWorkspaceFilePath(rawPath, workspaceRoot);
        if (!fs.existsSync(resolvedPath)) {
            return { error: `File not found: ${rawPath}` };
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
            return { error: `Path is not a file: ${rawPath}` };
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        if (!COMMENT_VIDEO_EXTENSIONS.has(ext)) {
            return { error: `Unsupported video format: ${ext}. Supported: ${[...COMMENT_VIDEO_EXTENSIONS].join(', ')}` };
        }

        const fileName = path.basename(resolvedPath);
        const mimeType = COMMENT_VIDEO_MIME_MAP[ext] || 'application/octet-stream';

        if (stat.size <= JIRA_MAX_ATTACHMENT_SIZE) {
            pushTarget({
                category: 'video',
                fileName,
                mimeType,
                size: stat.size,
                buffer: fs.readFileSync(resolvedPath),
            });
        } else {
            plan.skippedVideos.push({
                fileName,
                error: 'Original recording exceeds Jira 50 MB attachment limit',
            });
        }

        if (includeVideoFrames) {
            try {
                const { createVideoAnalyzer } = require('./video-analyzer');
                const analyzer = createVideoAnalyzer({ maxFrames: Math.max(1, maxVideoFrames) });
                const result = await analyzer.buildVideoContext(resolvedPath);
                const selectedFrames = selectVideoFrames([{ frames: result.frames }], frameTimestamps, Math.max(1, maxVideoFrames));

                for (const frame of selectedFrames) {
                    pushTarget({
                        category: 'frame',
                        fileName: createCommentFrameFileName(fileName, frame.timestamp),
                        mimeType: 'image/jpeg',
                        size: fs.statSync(frame.path).size,
                        buffer: fs.readFileSync(frame.path),
                        timestamp: `${frame.timestamp}s`,
                    });
                }

                plan.cleanupItems.push({
                    analyzer,
                    frames: result.frames || [],
                    sdkFrames: result.sdkFrames || [],
                });
            } catch (error) {
                plan.frameWarnings.push({
                    fileName,
                    error: `Preview frame extraction failed: ${error.message}`,
                });
            }
        }
    }

    if (entry) {
        const evidence = collectSessionEvidence(entry, { messageId, activeEvidenceMessageId, latestOnly });
        plan.scopeMessageId = evidence.scopeMessageId;

        for (const att of evidence.images) {
            const mimeType = VALID_IMAGE_MIME_TYPES.has(att?.media_type) ? att.media_type : 'image/png';
            if (!isNonEmptyString(att?.data)) continue;

            const buffer = Buffer.from(att.data, 'base64');
            if (!buffer.length) continue;

            pushTarget({
                category: 'image',
                fileName: createCommentScreenshotFileName(sessionImageIndex, mimeType),
                mimeType,
                size: buffer.length,
                buffer,
            });
            sessionImageIndex += 1;
        }

        if (includeVideoFrames) {
            const selectedFrames = selectVideoFrames(evidence.videos, frameTimestamps, Math.max(1, maxVideoFrames));
            for (const frame of selectedFrames) {
                if (!isNonEmptyString(frame?.path) || !fs.existsSync(frame.path)) continue;
                const sourceVideo = evidence.videos.find(video => Array.isArray(video?.frames) && video.frames.some(candidate => candidate.path === frame.path));
                pushTarget({
                    category: 'frame',
                    fileName: createCommentFrameFileName(sourceVideo?.filename || sourceVideo?.videoPath || 'recording.mp4', frame.timestamp),
                    mimeType: 'image/jpeg',
                    size: fs.statSync(frame.path).size,
                    buffer: fs.readFileSync(frame.path),
                    timestamp: `${frame.timestamp}s`,
                });
            }
        }

        for (const video of evidence.videos) {
            const fileName = video.filename || path.basename(video.videoPath || 'recording.mp4');
            if (!isNonEmptyString(video?.videoPath) || !fs.existsSync(video.videoPath)) {
                plan.skippedVideos.push({
                    fileName,
                    error: 'Original video file is missing or no longer available.',
                });
                continue;
            }

            const stat = fs.statSync(video.videoPath);
            if (stat.size > JIRA_MAX_ATTACHMENT_SIZE) {
                plan.skippedVideos.push({
                    fileName,
                    error: 'Original recording exceeds Jira 50 MB attachment limit',
                });
                continue;
            }

            const ext = path.extname(fileName).toLowerCase();
            const mimeType = COMMENT_VIDEO_MIME_MAP[ext] || 'application/octet-stream';
            pushTarget({
                category: 'video',
                fileName,
                mimeType,
                size: stat.size,
                buffer: fs.readFileSync(video.videoPath),
            });
        }
    }

    plan.hasMedia = plan.uploadTargets.length > 0 || plan.skippedVideos.length > 0;
    return plan;
}

function cleanupJiraMediaCommentPlan(plan) {
    if (!plan || !Array.isArray(plan.cleanupItems)) return;
    for (const item of plan.cleanupItems) {
        try {
            item.analyzer?.cleanup?.(item.frames || []);
            item.analyzer?.cleanup?.(item.sdkFrames || []);
        } catch {
            // Best-effort cleanup.
        }
    }
}

async function addCommentWithMediaToJira({
    ticketKey,
    comment,
    jiraConfig,
    apiConfig,
    imagePaths = [],
    videoPaths = [],
    entry,
    messageId,
    activeEvidenceMessageId,
    latestOnly = false,
    includeVideoFrames = true,
    frameTimestamps,
    maxVideoFrames = 4,
    imageLayout,
    toolName = 'add_comment_with_media',
    deps,
}) {
    if (!isNonEmptyString(comment)) {
        return { success: false, error: 'Comment text is required.' };
    }

    const plan = await buildJiraMediaCommentPlan({
        imagePaths,
        videoPaths,
        entry,
        messageId,
        activeEvidenceMessageId,
        latestOnly,
        includeVideoFrames,
        frameTimestamps,
        maxVideoFrames,
    });

    if (plan.error) return { success: false, error: plan.error };
    if (!plan.hasMedia) {
        return {
            success: false,
            error: 'No images or videos were available to attach to the Jira comment.',
            scopeMessageId: plan.scopeMessageId,
        };
    }

    const attachUrl = buildJiraAttachmentUrl(ticketKey, jiraConfig);
    const uploadedAttachments = [];
    const failedUploads = [];

    try {
        if (deps?.chatManager?.broadcastToolProgress) {
            deps.chatManager.broadcastToolProgress(toolName, {
                phase: 'uploading',
                detail: `Uploading ${plan.uploadTargets.length} media attachment(s) to ${ticketKey}...`,
            });
        }

        for (const target of plan.uploadTargets) {
            const boundaryPrefix = target.category === 'video'
                ? 'CommentVideo'
                : target.category === 'frame'
                    ? 'CommentFrame'
                    : 'CommentImage';
            const result = await uploadJiraAttachment(
                attachUrl,
                jiraConfig,
                target.fileName,
                target.mimeType,
                target.buffer,
                boundaryPrefix,
                { category: target.category }
            );

            if (result.success) {
                uploadedAttachments.push({
                    id: result.attachmentMeta?.id ? String(result.attachmentMeta.id) : '',
                    filename: result.attachmentMeta?.filename || target.fileName,
                    mimeType: result.attachmentMeta?.mimeType || target.mimeType,
                    size: result.attachmentMeta?.size || target.size,
                    contentUrl: result.attachmentMeta?.content || '',
                    category: target.category,
                    timestamp: target.timestamp || undefined,
                });
            } else {
                failedUploads.push({
                    fileName: target.fileName,
                    category: target.category,
                    error: result.error,
                });
            }
        }

        if (uploadedAttachments.length === 0) {
            return {
                success: false,
                error: 'All media uploads failed. Cannot create a Jira comment with media.',
                failedUploads,
                skippedVideos: plan.skippedVideos.length > 0 ? plan.skippedVideos : undefined,
                frameWarnings: plan.frameWarnings.length > 0 ? plan.frameWarnings : undefined,
                scopeMessageId: plan.scopeMessageId,
            };
        }

        if (deps?.chatManager?.broadcastToolProgress) {
            deps.chatManager.broadcastToolProgress(toolName, {
                phase: 'commenting',
                detail: `Creating Jira comment on ${ticketKey} with uploaded media...`,
            });
        }

        const commentResult = await postJiraCommentWithMedia({
            ticketKey,
            comment,
            uploadedAttachments,
            skippedVideos: plan.skippedVideos,
            apiConfig,
            imageLayout,
        });

        const uploadedCounts = {
            images: uploadedAttachments.filter(att => att.category === 'image').length,
            frames: uploadedAttachments.filter(att => att.category === 'frame').length,
            videos: uploadedAttachments.filter(att => att.category === 'video').length,
        };

        if (deps?.chatManager?.broadcastToolProgress) {
            deps.chatManager.broadcastToolProgress(toolName, {
                phase: commentResult.success ? 'complete' : 'failed',
                detail: commentResult.success
                    ? `Comment with media added to ${ticketKey}`
                    : `Comment creation failed after upload: ${commentResult.error}`,
            });
        }

        return {
            success: commentResult.success,
            commentId: commentResult.commentId || undefined,
            strategy: commentResult.strategy || undefined,
            note: commentResult.note || (uploadedCounts.videos > 0 || plan.skippedVideos.length > 0
                ? 'Videos are attached to the Jira issue and listed by file name in the comment because Jira Cloud does not support inline video playback for this REST workflow.'
                : undefined),
            error: commentResult.error || undefined,
            scopeMessageId: plan.scopeMessageId,
            uploaded: uploadedCounts,
            failedUploads,
            skippedVideos: plan.skippedVideos.length > 0 ? plan.skippedVideos : undefined,
            frameWarnings: plan.frameWarnings.length > 0 ? plan.frameWarnings : undefined,
            uploadedAttachments,
        };
    } finally {
        cleanupJiraMediaCommentPlan(plan);
    }
}

async function attachEvidenceToJira({
    ticketKey,
    jiraConfig,
    entry,
    messageId,
    activeEvidenceMessageId,
    latestOnly = false,
    frameTimestamps,
    includeImages = true,
    includeFrames = false,
    includeVideos = true,
}) {
    const evidence = collectSessionEvidence(entry, { messageId, activeEvidenceMessageId, latestOnly });
    const attachUrl = buildJiraAttachmentUrl(ticketKey, jiraConfig);
    const result = {
        success: false,
        hasEvidence: evidence.hasEvidence,
        scopeMessageId: evidence.scopeMessageId || (isNonEmptyString(messageId) ? messageId.trim() : undefined),
        imageResults: [],
        frameResults: [],
        videoRecordings: [],
        totals: {
            images: includeImages ? evidence.images.length : 0,
            frames: includeFrames ? selectVideoFrames(evidence.videos, frameTimestamps, 8).length : 0,
            videos: includeVideos ? evidence.videos.length : 0,
        },
        uploaded: {
            images: 0,
            frames: 0,
            videos: 0,
        },
        failed: {
            images: 0,
            frames: 0,
            videos: 0,
        },
    };

    if (!evidence.hasEvidence) {
        return result;
    }

    if (includeImages) {
        for (let i = 0; i < evidence.images.length; i++) {
            const att = evidence.images[i];
            const mimeType = VALID_IMAGE_MIME_TYPES.has(att?.media_type) ? att.media_type : 'image/png';
            const ext = mimeType === 'image/png' ? '.png'
                : mimeType === 'image/jpeg' ? '.jpg'
                    : mimeType === 'image/gif' ? '.gif' : '.webp';
            const fileName = `bug-screenshot-${i + 1}${ext}`;

            if (!isNonEmptyString(att?.data)) {
                result.imageResults.push({ fileName, success: false, error: 'Attachment data is missing or invalid.' });
                continue;
            }

            const buffer = Buffer.from(att.data, 'base64');
            if (!buffer.length) {
                result.imageResults.push({ fileName, success: false, error: 'Attachment data decoded to an empty file.' });
                continue;
            }

            result.imageResults.push(await uploadJiraAttachment(
                attachUrl,
                jiraConfig,
                fileName,
                mimeType,
                buffer,
                'JiraAttachment'
            ));
        }

        result.uploaded.images = result.imageResults.filter(item => item.success).length;
        result.failed.images = result.imageResults.length - result.uploaded.images;
    }

    if (includeFrames) {
        const framesToUpload = selectVideoFrames(evidence.videos, frameTimestamps, 8);
        for (const frame of framesToUpload) {
            const fileName = `bug-video-frame-${frame.timestamp}s.jpg`;
            if (!isNonEmptyString(frame?.path) || !fs.existsSync(frame.path)) {
                result.frameResults.push({ fileName, success: false, error: 'Frame file is missing or no longer available.' });
                continue;
            }

            const buffer = fs.readFileSync(frame.path);
            result.frameResults.push(await uploadJiraAttachment(
                attachUrl,
                jiraConfig,
                fileName,
                'image/jpeg',
                buffer,
                'JiraVideoFrame',
                { timestamp: `${frame.timestamp}s` }
            ));
        }

        result.uploaded.frames = result.frameResults.filter(item => item.success).length;
        result.failed.frames = result.frameResults.length - result.uploaded.frames;
    }

    if (includeVideos) {
        for (const video of evidence.videos) {
            const fileName = video.filename || path.basename(video.videoPath || 'recording.mp4');
            if (!isNonEmptyString(video?.videoPath) || !fs.existsSync(video.videoPath)) {
                result.videoRecordings.push({ fileName, success: false, error: 'Original video file is missing or no longer available.' });
                continue;
            }

            const stat = fs.statSync(video.videoPath);
            if (stat.size > 50 * 1024 * 1024) {
                result.videoRecordings.push({ fileName, success: false, error: 'File exceeds 50 MB Jira attachment limit' });
                continue;
            }

            const ext = path.extname(fileName).toLowerCase();
            const detectedMimeType = {
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.mov': 'video/quicktime',
                '.avi': 'video/x-msvideo',
                '.mkv': 'video/x-matroska',
            }[ext] || 'application/octet-stream';
            const mimeType = VALID_VIDEO_MIME_TYPES.has(detectedMimeType) ? detectedMimeType : 'application/octet-stream';
            const buffer = fs.readFileSync(video.videoPath);

            result.videoRecordings.push(await uploadJiraAttachment(
                attachUrl,
                jiraConfig,
                fileName,
                mimeType,
                buffer,
                'JiraVideo'
            ));
        }

        result.uploaded.videos = result.videoRecordings.filter(item => item.success).length;
        result.failed.videos = result.videoRecordings.length - result.uploaded.videos;
    }

    result.success = result.imageResults.some(item => item.success)
        || result.frameResults.some(item => item.success)
        || result.videoRecordings.some(item => item.success);

    return result;
}

function getImageMimeTypeForFile(filePath) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return null;
}

function stripHtmlTags(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function normalizeWhitespace(value) {
    return String(value || '')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \u00a0]{2,}/g, ' ')
        .trim();
}

function extractTextFromAdf(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) {
        return node.map(extractTextFromAdf).filter(Boolean).join(' ');
    }

    const ownText = typeof node.text === 'string' ? node.text : '';
    const childText = extractTextFromAdf(node.content || []);
    const joiner = ['paragraph', 'listItem', 'bulletList', 'orderedList', 'tableRow'].includes(node.type) ? '\n' : ' ';
    return [ownText, childText].filter(Boolean).join(joiner);
}

function normalizeJiraText(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        return normalizeWhitespace(stripHtmlTags(value));
    }
    return normalizeWhitespace(extractTextFromAdf(value));
}

module.exports = {
    getEvidenceItemTimestamp,
    resolveEvidenceScopeMessageId,
    isEvidenceItemInScope,
    collectSessionEvidence,
    collectSessionDocuments,
    findSessionDocument,
    selectVideoFrames,
    resolveWorkspaceFilePath,
    createUniqueAttachmentFileName,
    formatAttachmentSize,
    createCommentScreenshotFileName,
    createCommentFrameFileName,
    createAdfTextNode,
    appendAdfBulletSection,
    buildJiraMediaCommentWikiBody,
    buildJiraMediaCommentAdf,
    cleanupJiraMediaCommentPlan,
    getImageMimeTypeForFile,
    stripHtmlTags,
    normalizeWhitespace,
    extractTextFromAdf,
    normalizeJiraText,
    uploadJiraAttachment,
    attachEvidenceToJira,
    addCommentWithMediaToJira,
};
