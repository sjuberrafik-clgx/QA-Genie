/**
 * Session Persistence Utilities — Sanitization helpers for disk persistence.
 * @module sdk-orchestrator/chat-utils/session-persistence-utils
 */

const fs = require('fs');
const {
    isNonEmptyString,
    MAX_PERSISTED_SESSION_ATTACHMENTS,
    MAX_PERSISTED_VIDEO_CONTEXT_ITEMS,
    MAX_PERSISTED_VIDEO_FRAMES_PER_ITEM,
} = require('./chat-constants');

function isExistingFilePath(value) {
    if (!isNonEmptyString(value)) return false;
    try {
        return fs.existsSync(value) && fs.statSync(value).isFile();
    } catch {
        return false;
    }
}

function sanitizeSessionContextForHistory(sessionId, sessionContext = {}) {
    return {
        sessionId,
        latestUserMessageId: isNonEmptyString(sessionContext?.latestUserMessageId)
            ? sessionContext.latestUserMessageId.trim()
            : null,
        latestUserMessageTimestamp: isNonEmptyString(sessionContext?.latestUserMessageTimestamp)
            ? sessionContext.latestUserMessageTimestamp.trim()
            : null,
        activeEvidenceMessageId: isNonEmptyString(sessionContext?.activeEvidenceMessageId)
            ? sessionContext.activeEvidenceMessageId.trim()
            : null,
        activeEvidenceTimestamp: isNonEmptyString(sessionContext?.activeEvidenceTimestamp)
            ? sessionContext.activeEvidenceTimestamp.trim()
            : null,
    };
}

function sanitizeSessionAttachmentForHistory(attachment) {
    if (!attachment || typeof attachment !== 'object') return null;

    const type = isNonEmptyString(attachment.type) ? attachment.type.trim() : '';
    if (!type) return null;

    const base = {
        type,
        media_type: isNonEmptyString(attachment.media_type) ? attachment.media_type.trim() : undefined,
        filename: isNonEmptyString(attachment.filename) ? attachment.filename.trim() : undefined,
        messageId: isNonEmptyString(attachment.messageId) ? attachment.messageId.trim() : undefined,
        timestamp: isNonEmptyString(attachment.timestamp) ? attachment.timestamp : undefined,
    };

    if (type === 'image') {
        const hasData = isNonEmptyString(attachment.data);
        const hasPath = isExistingFilePath(attachment.path);
        if (!hasData && !hasPath) return null;
        return {
            ...base,
            data: hasData ? attachment.data : undefined,
            path: hasPath ? attachment.path : undefined,
        };
    }

    if (type === 'video') {
        const tempPath = isExistingFilePath(attachment.tempPath) ? attachment.tempPath : '';
        if (!tempPath) return null;
        return {
            ...base,
            tempPath,
            size: Number.isFinite(attachment.size) ? attachment.size : undefined,
        };
    }

    if (type === 'video_link') {
        if (!isNonEmptyString(attachment.url)) return null;
        return {
            ...base,
            url: attachment.url.trim(),
            provider: isNonEmptyString(attachment.provider) ? attachment.provider.trim() : undefined,
        };
    }

    if (type === 'document') {
        const docPath = isExistingFilePath(attachment.path) ? attachment.path : '';
        if (!docPath) return null;
        return {
            ...base,
            path: docPath,
            size: Number.isFinite(attachment.size) ? attachment.size : undefined,
        };
    }

    return null;
}

function sanitizeSessionAttachmentsForHistory(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];

    return attachments
        .slice(-MAX_PERSISTED_SESSION_ATTACHMENTS)
        .map(sanitizeSessionAttachmentForHistory)
        .filter(Boolean);
}

function sanitizeVideoMetadataForHistory(metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    const safe = {};
    if (Number.isFinite(metadata.width)) safe.width = metadata.width;
    if (Number.isFinite(metadata.height)) safe.height = metadata.height;
    if (Number.isFinite(metadata.duration)) safe.duration = metadata.duration;
    if (Number.isFinite(metadata.fps)) safe.fps = metadata.fps;
    if (isNonEmptyString(metadata.codec)) safe.codec = metadata.codec.trim();
    if (Number.isFinite(metadata.fileSize)) safe.fileSize = metadata.fileSize;
    return Object.keys(safe).length > 0 ? safe : null;
}

function sanitizeVideoFrameForHistory(frame) {
    if (!frame || typeof frame !== 'object') return null;
    if (!isExistingFilePath(frame.path)) return null;

    return {
        path: frame.path,
        timestamp: Number.isFinite(frame.timestamp) ? frame.timestamp : 0,
    };
}

function sanitizeVideoContextItemForHistory(videoItem) {
    if (!videoItem || typeof videoItem !== 'object') return null;

    const videoPath = isExistingFilePath(videoItem.videoPath) ? videoItem.videoPath : '';
    const frames = Array.isArray(videoItem.frames)
        ? videoItem.frames
            .map(sanitizeVideoFrameForHistory)
            .filter(Boolean)
            .slice(0, MAX_PERSISTED_VIDEO_FRAMES_PER_ITEM)
        : [];

    if (!videoPath && frames.length === 0) return null;

    return {
        messageId: isNonEmptyString(videoItem.messageId) ? videoItem.messageId.trim() : undefined,
        timestamp: isNonEmptyString(videoItem.timestamp) ? videoItem.timestamp : undefined,
        videoPath: videoPath || undefined,
        filename: isNonEmptyString(videoItem.filename) ? videoItem.filename.trim() : undefined,
        duration: Number.isFinite(videoItem.duration) ? videoItem.duration : undefined,
        frameCount: Number.isFinite(videoItem.frameCount)
            ? videoItem.frameCount
            : (frames.length > 0 ? frames.length : undefined),
        frames,
        metadata: sanitizeVideoMetadataForHistory(videoItem.metadata),
    };
}

function sanitizeVideoContextForHistory(videoContext) {
    if (!Array.isArray(videoContext) || videoContext.length === 0) return [];

    return videoContext
        .slice(-MAX_PERSISTED_VIDEO_CONTEXT_ITEMS)
        .map(sanitizeVideoContextItemForHistory)
        .filter(Boolean);
}

function collectVideoTempFilesFromEvidence(sessionAttachments, videoContext) {
    const paths = [];
    const seen = new Set();

    const addPath = (candidate) => {
        if (!isExistingFilePath(candidate)) return;
        if (seen.has(candidate)) return;
        seen.add(candidate);
        paths.push(candidate);
    };

    if (Array.isArray(sessionAttachments)) {
        for (const attachment of sessionAttachments) {
            if (attachment?.type === 'video') {
                addPath(attachment.tempPath);
            }
        }
    }

    if (Array.isArray(videoContext)) {
        for (const item of videoContext) {
            addPath(item?.videoPath);
            if (Array.isArray(item?.frames)) {
                for (const frame of item.frames) {
                    addPath(frame?.path);
                }
            }
        }
    }

    return paths;
}

function collectDocumentTempFilesFromEvidence(sessionAttachments) {
    if (!Array.isArray(sessionAttachments) || sessionAttachments.length === 0) {
        return [];
    }

    const paths = [];
    const seen = new Set();
    for (const attachment of sessionAttachments) {
        if (attachment?.type !== 'document') continue;
        if (!isExistingFilePath(attachment.path)) continue;
        if (seen.has(attachment.path)) continue;
        seen.add(attachment.path);
        paths.push(attachment.path);
    }

    return paths;
}

module.exports = {
    isExistingFilePath,
    sanitizeSessionContextForHistory,
    sanitizeSessionAttachmentForHistory,
    sanitizeSessionAttachmentsForHistory,
    sanitizeVideoMetadataForHistory,
    sanitizeVideoFrameForHistory,
    sanitizeVideoContextItemForHistory,
    sanitizeVideoContextForHistory,
    collectVideoTempFilesFromEvidence,
    collectDocumentTempFilesFromEvidence,
};
