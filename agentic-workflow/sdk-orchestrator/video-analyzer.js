/**
 * VIDEO ANALYZER — Frame Extraction & Analysis Pipeline for BugGenie
 *
 * Extracts frames from screen recording videos using ffmpeg, enabling
 * vision-capable LLMs to analyze bug reproduction flows frame-by-frame.
 *
 * Architecture:
 *   Video file → ffprobe metadata → ffmpeg 1fps extraction → hybrid frame selection → SDK image attachments
 *
 * Dependencies (already in package.json):
 *   - ffmpeg-static ^5.3.0  — bundled ffmpeg binary
 *   - fluent-ffmpeg ^2.1.3  — Node.js ffmpeg wrapper
 *
 * @module sdk-orchestrator/video-analyzer
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// ─── Constants ──────────────────────────────────────────────────────────────

const ALLOWED_VIDEO_MIMES = new Set([
    'video/mp4', 'video/webm', 'video/quicktime',
    'video/x-msvideo', 'video/x-matroska',
]);

/** First 4–12 bytes → format signatures for magic byte validation */
const VIDEO_MAGIC_BYTES = [
    { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], format: 'mp4' },   // 'ftyp'
    { offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3], format: 'webm' },  // EBML header (WebM/MKV)
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], format: 'avi' },   // 'RIFF' (AVI)
    { offset: 4, bytes: [0x6D, 0x6F, 0x6F, 0x76], format: 'mov' },   // 'moov' (QuickTime)
    { offset: 4, bytes: [0x66, 0x72, 0x65, 0x65], format: 'mov' },   // 'free' (QuickTime variant)
];

/** Domain allowlist for external video link fetching */
const ALLOWED_EXTERNAL_DOMAINS = new Set([
    'loom.com', 'www.loom.com',
    'drive.google.com',
    'sharepoint.com',
    '1drv.ms',
]);

/** Private IP ranges — reject to prevent SSRF */
const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
    /^fd/i,
];


// ─── VideoAnalyzer Class ────────────────────────────────────────────────────

class VideoAnalyzer {

    /**
     * @param {Object} [options]
     * @param {number} [options.frameRate=1]        — Frames per second to extract
     * @param {number} [options.maxFrames=30]        — Max frames after hybrid selection
     * @param {number} [options.maxDurationSec=300]  — Max video duration to analyze (5 min)
     * @param {number} [options.maxFileSizeMB=200]   — Max file size in MB
     * @param {number} [options.outputResolution=768] — Max width for SDK frames (low-res)
     * @param {number} [options.jpegQuality=4]       — ffmpeg JPEG quality for SDK (2=high, 5=medium)
     * @param {number} [options.jiraOutputResolution=1280] — Max width for Jira frames (high-res)
     * @param {number} [options.jiraJpegQuality=2]   — ffmpeg JPEG quality for Jira (2=high, 5=medium)
     * @param {number} [options.deduplicationThreshold=0.05] — Min pixel diff (0-1) to keep a frame (0=keep all)
     * @param {string} [options.frameSelectionStrategy='hybrid'] — 'hybrid' | 'dense' | 'scene'
     * @param {string} [options.outputDir]           — Custom output directory (default: os.tmpdir())
     */
    constructor(options = {}) {
        this.frameRate = options.frameRate || 1;
        this.maxFrames = options.maxFrames || 30;
        this.maxDurationSec = options.maxDurationSec || 300;
        this.maxFileSizeMB = options.maxFileSizeMB || 200;
        this.outputResolution = options.outputResolution || 768;
        this.jpegQuality = options.jpegQuality || 4;
        this.jiraOutputResolution = options.jiraOutputResolution || 1280;
        this.jiraJpegQuality = options.jiraJpegQuality || 2;
        this.deduplicationThreshold = options.deduplicationThreshold ?? 0.05;
        this.maxSDKFrames = options.maxSDKFrames || 10;
        this.frameSelectionStrategy = options.frameSelectionStrategy || 'hybrid';
        this.outputDir = options.outputDir || path.join(os.tmpdir(), 'video-analyzer');

        // Ensure output dir exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }

        // Lazy-resolve ffmpeg paths
        this._ffmpegPath = null;
        this._ffprobePath = null;
    }

    // ─── FFmpeg Path Resolution ─────────────────────────────────────

    _getFfmpegPath() {
        if (this._ffmpegPath) return this._ffmpegPath;
        try {
            this._ffmpegPath = require('ffmpeg-static');
            return this._ffmpegPath;
        } catch {
            throw new Error('ffmpeg-static not installed. Run: npm install ffmpeg-static');
        }
    }

    _getFfprobePath() {
        if (this._ffprobePath) return this._ffprobePath;
        // ffprobe is bundled alongside ffmpeg-static in the same directory
        const ffmpegDir = path.dirname(this._getFfmpegPath());
        const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
        const probePath = path.join(ffmpegDir, ffprobeName);
        if (fs.existsSync(probePath)) {
            this._ffprobePath = probePath;
            return probePath;
        }
        // Fallback: try ffprobe-static package
        try {
            const ffprobeStatic = require('ffprobe-static');
            if (ffprobeStatic && ffprobeStatic.path && fs.existsSync(ffprobeStatic.path)) {
                this._ffprobePath = ffprobeStatic.path;
                return this._ffprobePath;
            }
        } catch { /* not installed */ }
        // Last resort: bare 'ffprobe' on PATH
        this._ffprobePath = 'ffprobe';
        return this._ffprobePath;
    }

    // ─── Validation ─────────────────────────────────────────────────

    /**
     * Validate a video file: existence, size, magic bytes.
     * @param {string} videoPath
     * @returns {{ valid: boolean, error?: string, size?: number }}
     */
    validateVideoFile(videoPath) {
        if (!videoPath || typeof videoPath !== 'string') {
            return { valid: false, error: 'Video path is required' };
        }

        const safePath = path.resolve(videoPath);
        if (!fs.existsSync(safePath)) {
            return { valid: false, error: `File not found: ${path.basename(safePath)}` };
        }

        const stats = fs.statSync(safePath);
        const sizeMB = stats.size / (1024 * 1024);
        if (sizeMB > this.maxFileSizeMB) {
            return { valid: false, error: `File too large: ${sizeMB.toFixed(1)} MB (max ${this.maxFileSizeMB} MB)` };
        }

        // Magic byte validation
        const fd = fs.openSync(safePath, 'r');
        const header = Buffer.alloc(12);
        fs.readSync(fd, header, 0, 12, 0);
        fs.closeSync(fd);

        const isValidFormat = VIDEO_MAGIC_BYTES.some(sig => {
            if (header.length < sig.offset + sig.bytes.length) return false;
            return sig.bytes.every((b, i) => header[sig.offset + i] === b);
        });

        if (!isValidFormat) {
            return { valid: false, error: 'Invalid video format — file header does not match any supported format (MP4/WebM/MOV/AVI/MKV)' };
        }

        return { valid: true, size: stats.size };
    }

    // ─── Metadata Extraction ────────────────────────────────────────

    /**
     * Extract video metadata using ffprobe.
     * @param {string} videoPath
     * @returns {Promise<{ duration: number, width: number, height: number, codec: string, fps: number, fileSize: number }>}
     */
    async extractMetadata(videoPath) {
        const safePath = path.resolve(videoPath);
        const ffprobePath = this._getFfprobePath();

        return new Promise((resolve, reject) => {
            const args = [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                safePath,
            ];

            const proc = execFile(ffprobePath, args, { timeout: 15000 }, (err, stdout, stderr) => {
                if (err) {
                    return reject(new Error(`ffprobe failed: ${err.message}`));
                }
                try {
                    const data = JSON.parse(stdout);
                    const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
                    if (!videoStream) {
                        return reject(new Error('No video stream found in file'));
                    }

                    const duration = parseFloat(data.format?.duration || videoStream.duration || '0');
                    const [fpsNum, fpsDen] = (videoStream.r_frame_rate || '30/1').split('/');
                    const fps = fpsDen ? parseInt(fpsNum) / parseInt(fpsDen) : 30;

                    resolve({
                        duration: Math.round(duration * 10) / 10,
                        width: parseInt(videoStream.width) || 0,
                        height: parseInt(videoStream.height) || 0,
                        codec: videoStream.codec_name || 'unknown',
                        fps: Math.round(fps * 10) / 10,
                        fileSize: parseInt(data.format?.size) || 0,
                    });
                } catch (parseErr) {
                    reject(new Error(`ffprobe output parse error: ${parseErr.message}`));
                }
            });

            // Safety: kill if stuck
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 16000);
        });
    }

    // ─── Frame Extraction ───────────────────────────────────────────

    /**
     * Extract frames from a video file.
     *
     * @param {string} videoPath
     * @param {Object} [options]
     * @param {number} [options.frameRate]      — Override instance frameRate
     * @param {number} [options.maxFrames]      — Override instance maxFrames
     * @param {string} [options.strategy]       — Override instance frameSelectionStrategy
     * @returns {Promise<{ frames: Array<{ path: string, timestamp: number, index: number }>, totalExtracted: number }>}
     */
    async extractFrames(videoPath, options = {}) {
        const safePath = path.resolve(videoPath);
        const frameRate = options.frameRate || this.frameRate;
        const maxFrames = options.maxFrames || this.maxFrames;
        const strategy = options.strategy || this.frameSelectionStrategy;

        // Get metadata to know duration
        const metadata = await this.extractMetadata(safePath);
        const analyzeDuration = Math.min(metadata.duration, this.maxDurationSec);

        // Create unique temp dir for this extraction (high-quality Jira frames)
        const extractId = `extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const extractDir = path.join(this.outputDir, extractId);
        fs.mkdirSync(extractDir, { recursive: true });

        // Extract at HIGH QUALITY for Jira uploads
        const ffmpegPath = this._getFfmpegPath();
        const outputPattern = path.join(extractDir, 'frame-%04d.jpg');

        const args = [
            '-i', safePath,
            '-t', String(analyzeDuration),
            '-vf', `fps=${frameRate},scale=${this.jiraOutputResolution}:-1`,
            '-q:v', String(this.jiraJpegQuality),
            '-frames:v', String(Math.ceil(analyzeDuration * frameRate)),
            outputPattern,
        ];

        await this._runFfmpeg(ffmpegPath, args);

        // Read extracted frames
        const allFrameFiles = fs.readdirSync(extractDir)
            .filter(f => f.startsWith('frame-') && f.endsWith('.jpg'))
            .sort();

        const allFrames = allFrameFiles.map((file, idx) => ({
            path: path.join(extractDir, file),
            timestamp: Math.round((idx / frameRate) * 10) / 10,
            index: idx,
        }));

        const totalExtracted = allFrames.length;

        // Perceptual deduplication — drop near-identical consecutive frames
        let uniqueFrames = allFrames;
        if (this.deduplicationThreshold > 0 && allFrames.length > 2) {
            uniqueFrames = await this._deduplicateFrames(allFrames, this.deduplicationThreshold);
            if (uniqueFrames.length < allFrames.length) {
                console.log(`[VideoAnalyzer] Dedup: ${allFrames.length} → ${uniqueFrames.length} frames (threshold ${(this.deduplicationThreshold * 100).toFixed(0)}%)`);
            }
        }

        // Apply frame selection strategy on deduplicated frames
        let selectedFrames;
        if (strategy === 'dense' || uniqueFrames.length <= maxFrames) {
            selectedFrames = uniqueFrames.slice(0, maxFrames);
        } else {
            // Hybrid strategy: first + last + evenly-spaced in between
            selectedFrames = this._hybridSelect(uniqueFrames, maxFrames);
        }

        // Clean up unselected frames to save disk space
        const selectedPaths = new Set(selectedFrames.map(f => f.path));
        for (const frame of allFrames) {
            if (!selectedPaths.has(frame.path)) {
                try { fs.unlinkSync(frame.path); } catch { /* ignore */ }
            }
        }

        // Create low-res SDK copies (768px, q4) for Copilot API payload limits
        const sdkDir = path.join(this.outputDir, extractId + '-sdk');
        fs.mkdirSync(sdkDir, { recursive: true });
        const sdkFrames = await this._createSDKCopies(selectedFrames, sdkDir);

        console.log(`[VideoAnalyzer] Extracted ${totalExtracted} frames, deduped to ${uniqueFrames.length}, selected ${selectedFrames.length} (${strategy}), ${sdkFrames.length} SDK copies`);

        return { frames: selectedFrames, sdkFrames, totalExtracted };
    }

    /**
     * Hybrid frame selection: first + last + evenly-spaced in between.
     * @param {Array} frames
     * @param {number} maxFrames
     * @returns {Array}
     */
    _hybridSelect(frames, maxFrames) {
        if (frames.length <= maxFrames) return frames;
        if (maxFrames <= 2) return [frames[0], frames[frames.length - 1]].slice(0, maxFrames);

        const selected = [frames[0]]; // first frame
        const innerCount = maxFrames - 2;
        const step = (frames.length - 2) / (innerCount + 1);

        for (let i = 1; i <= innerCount; i++) {
            const idx = Math.round(step * i);
            if (idx > 0 && idx < frames.length - 1) {
                selected.push(frames[idx]);
            }
        }

        selected.push(frames[frames.length - 1]); // last frame
        return selected;
    }

    // ─── Perceptual Deduplication ────────────────────────────────────

    /**
     * Compute a lightweight perceptual hash for a frame image.
     * Downscales to 8×8 grayscale via ffmpeg and returns 64 average-intensity values.
     * @param {string} framePath
     * @returns {Promise<number[]>} 64-element array of pixel intensities (0-255)
     */
    async _computeFrameHash(framePath) {
        const ffmpegPath = this._getFfmpegPath();
        // Output raw grayscale pixels (8x8 = 64 bytes) to stdout
        return new Promise((resolve, reject) => {
            const args = [
                '-i', framePath,
                '-vf', 'scale=8:8,format=gray',
                '-f', 'rawvideo',
                '-frames:v', '1',
                'pipe:1',
            ];
            const chunks = [];
            const proc = execFile(ffmpegPath, args, { encoding: 'buffer', timeout: 5000, maxBuffer: 1024 }, (err, stdout) => {
                if (err) return resolve(null); // graceful fallback — treat as unique
                if (!stdout || stdout.length < 64) return resolve(null);
                const hash = [];
                for (let i = 0; i < 64; i++) hash.push(stdout[i]);
                resolve(hash);
            });
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 6000);
        });
    }

    /**
     * Remove near-identical consecutive frames using perceptual hashing.
     * Always keeps the first and last frames.
     * @param {Array<{ path: string, timestamp: number, index: number }>} frames
     * @param {number} threshold — Minimum normalized difference (0-1) to keep a frame
     * @returns {Promise<Array>} Deduplicated frames
     */
    async _deduplicateFrames(frames, threshold) {
        if (frames.length <= 2) return frames;

        // Compute hashes for all frames
        const hashes = [];
        for (const frame of frames) {
            hashes.push(await this._computeFrameHash(frame.path));
        }

        const kept = [frames[0]]; // always keep first
        let lastKeptHash = hashes[0];

        for (let i = 1; i < frames.length - 1; i++) {
            const hash = hashes[i];
            if (!hash || !lastKeptHash) {
                // Fallback: keep frame if hash computation failed
                kept.push(frames[i]);
                lastKeptHash = hash;
                continue;
            }

            // Compute normalized pixel difference (0 = identical, 1 = completely different)
            let diffSum = 0;
            for (let j = 0; j < 64; j++) {
                diffSum += Math.abs(hash[j] - lastKeptHash[j]);
            }
            const normalizedDiff = diffSum / (64 * 255);

            if (normalizedDiff >= threshold) {
                kept.push(frames[i]);
                lastKeptHash = hash;
            }
        }

        // Always keep last frame
        if (frames.length > 1) {
            const lastFrame = frames[frames.length - 1];
            if (!kept.includes(lastFrame)) {
                kept.push(lastFrame);
            }
        }

        return kept;
    }

    // ─── SDK Copy Creation ──────────────────────────────────────────

    /**
     * Create low-res copies of selected frames for SDK payload (avoids 413 errors).
     * Uses the instance's outputResolution and jpegQuality (the SDK-oriented settings).
     * @param {Array<{ path: string, timestamp: number }>} frames — High-res source frames
     * @param {string} sdkDir — Output directory for SDK copies
     * @returns {Promise<Array<{ path: string, timestamp: number }>>}
     */
    async _createSDKCopies(frames, sdkDir) {
        const ffmpegPath = this._getFfmpegPath();
        const sdkFrames = [];

        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const outPath = path.join(sdkDir, `sdk-frame-${String(i).padStart(4, '0')}.jpg`);
            try {
                await this._runFfmpeg(ffmpegPath, [
                    '-i', frame.path,
                    '-vf', `scale=${this.outputResolution}:-1`,
                    '-q:v', String(this.jpegQuality),
                    '-frames:v', '1',
                    outPath,
                ]);
                sdkFrames.push({ path: outPath, timestamp: frame.timestamp });
            } catch (err) {
                // If SDK copy fails, skip it — high-res version still available for Jira
                console.error(`[VideoAnalyzer] SDK copy failed for frame ${i}: ${err.message}`);
            }
        }

        return sdkFrames;
    }

    /**
     * Run ffmpeg with timeout and error handling.
     * @private
     */
    _runFfmpeg(ffmpegPath, args) {
        return new Promise((resolve, reject) => {
            const proc = execFile(ffmpegPath, args, {
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
            }, (err, stdout, stderr) => {
                if (err) {
                    // ffmpeg writes progress/info to stderr normally, only reject on actual errors
                    if (err.killed) {
                        return reject(new Error('ffmpeg timed out after 30 seconds'));
                    }
                    return reject(new Error(`ffmpeg error: ${err.message}`));
                }
                resolve({ stdout, stderr });
            });

            // Hard kill safety net
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 32000);
        });
    }

    // ─── High-Level Orchestrator ────────────────────────────────────

    /**
     * Full pipeline: validate → metadata → extract frames → build context.
     *
     * @param {string} videoPath
     * @param {Object} [options]       — Override extraction options
     * @returns {Promise<{
     *   metadata: Object,
     *   frames: Array<{ path: string, timestamp: number, index: number }>,
     *   totalExtracted: number,
     *   contextPrompt: string,
     * }>}
     */
    async buildVideoContext(videoPath, options = {}) {
        // Step 1: Validate
        const validation = this.validateVideoFile(videoPath);
        if (!validation.valid) {
            throw new Error(`Video validation failed: ${validation.error}`);
        }

        // Step 2: Metadata
        const metadata = await this.extractMetadata(videoPath);
        if (metadata.duration > this.maxDurationSec) {
            console.log(`[VideoAnalyzer] Video is ${metadata.duration}s, analyzing first ${this.maxDurationSec}s only`);
        }

        // Step 3: Extract frames (high-res for Jira + low-res SDK copies)
        const { frames, sdkFrames, totalExtracted } = await this.extractFrames(videoPath, options);

        // Step 4: Build context prompt
        const timestamps = frames.map(f => `${f.timestamp}s`).join(', ');
        const analyzeDuration = Math.min(metadata.duration, this.maxDurationSec);

        const contextPrompt = [
            `## Video Recording Analysis`,
            ``,
            `The user has provided a **${analyzeDuration}s** screen recording (${metadata.width}x${metadata.height}, ${metadata.codec}).`,
            `**${frames.length} frames** have been extracted at key timestamps and are attached as images in chronological order.`,
            ``,
            `**Frame timestamps:** ${timestamps}`,
            ``,
            `### Your Task`,
            `Analyze these frames **chronologically** to:`,
            `1. **Reconstruct the user's flow** — what actions were taken in each frame (navigation, clicks, form inputs, etc.)`,
            `2. **Identify the defect** — at which timestamp/frame does the bug become visible?`,
            `3. **Determine Steps to Reproduce** — generate numbered steps from the observed flow`,
            `4. **Expected Behaviour** — infer from pre-defect frames what should have happened`,
            `5. **Actual Behaviour** — describe what went wrong based on the defect frame(s)`,
            `6. **Reference timestamps** in your analysis (e.g., "At 0:23, user clicks...")`,
            ``,
            `The frames are attached as images in the order listed above.`,
        ].join('\n');

        return { metadata, frames, sdkFrames, totalExtracted, contextPrompt };
    }

    // ─── External Video Link Fetching ───────────────────────────────

    /**
     * Download a video from an external URL (Loom, Google Drive, SharePoint, direct link).
     *
     * @param {string} url
     * @param {string} [provider]  — 'loom' | 'gdrive' | 'sharepoint' | 'direct'
     * @returns {Promise<{ path: string, filename: string, size: number }>}
     */
    async fetchExternalVideo(url, provider) {
        // Security: validate URL
        this._validateExternalUrl(url);

        const detectedProvider = provider || this._detectProvider(url);
        let downloadUrl = url;

        // Provider-specific URL resolution
        if (detectedProvider === 'loom') {
            downloadUrl = await this._resolveLoomUrl(url);
        } else if (detectedProvider === 'gdrive') {
            downloadUrl = this._resolveGDriveUrl(url);
        }

        // Download with streaming
        const filename = `external-video-${Date.now()}.mp4`;
        const outputPath = path.join(this.outputDir, filename);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const resp = await fetch(downloadUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'VideoAnalyzer/1.0' },
                redirect: 'follow',
            });

            if (!resp.ok) {
                throw new Error(`Download failed: HTTP ${resp.status}`);
            }

            // Stream to file
            const contentLength = parseInt(resp.headers.get('content-length') || '0');
            if (contentLength > this.maxFileSizeMB * 1024 * 1024) {
                throw new Error(`Remote file too large: ${(contentLength / (1024 * 1024)).toFixed(1)} MB (max ${this.maxFileSizeMB} MB)`);
            }

            const arrayBuffer = await resp.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            if (buffer.length > this.maxFileSizeMB * 1024 * 1024) {
                throw new Error(`Downloaded file too large: ${(buffer.length / (1024 * 1024)).toFixed(1)} MB`);
            }

            fs.writeFileSync(outputPath, buffer);
            console.log(`[VideoAnalyzer] Downloaded external video: ${filename} (${(buffer.length / (1024 * 1024)).toFixed(1)} MB)`);

            return { path: outputPath, filename, size: buffer.length };
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Validate an external URL for safety (SSRF protection).
     * @private
     */
    _validateExternalUrl(url) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            throw new Error('Invalid URL format');
        }

        // Only allow http/https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Unsupported protocol: ${parsed.protocol} — only http/https allowed`);
        }

        // Check hostname against private IP patterns
        const hostname = parsed.hostname;
        for (const pattern of PRIVATE_IP_PATTERNS) {
            if (pattern.test(hostname)) {
                throw new Error(`Blocked: URL points to a private/internal address`);
            }
        }

        // Check domain allowlist (for structured providers)
        const domain = hostname.replace(/^www\./, '');
        const isAllowed = [...ALLOWED_EXTERNAL_DOMAINS].some(d => domain === d || domain.endsWith('.' + d));
        // For direct URLs, we allow any public domain but log a warning
        if (!isAllowed) {
            console.log(`[VideoAnalyzer] ⚠️ External URL domain "${domain}" is not in the allowlist — proceeding with direct download`);
        }
    }

    /**
     * Detect provider from URL pattern.
     * @private
     */
    _detectProvider(url) {
        if (/loom\.com\/share\//i.test(url)) return 'loom';
        if (/drive\.google\.com\/file\//i.test(url)) return 'gdrive';
        if (/sharepoint\.com/i.test(url) || /1drv\.ms/i.test(url)) return 'sharepoint';
        return 'direct';
    }

    /**
     * Resolve Loom share URL to downloadable video URL via oEmbed.
     * @private
     */
    async _resolveLoomUrl(shareUrl) {
        const oembedUrl = `https://www.loom.com/v1/oembed?url=${encodeURIComponent(shareUrl)}`;
        const resp = await fetch(oembedUrl, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) {
            // Fallback: try direct video URL pattern
            const match = shareUrl.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
            if (match) {
                return `https://www.loom.com/share/${match[1]}/download`;
            }
            throw new Error(`Loom oEmbed failed: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        // oEmbed returns an embed HTML; extract the video source if available
        const srcMatch = (data.html || '').match(/src="([^"]+)"/);
        if (srcMatch) {
            return srcMatch[1].replace('/embed/', '/share/') + '/download';
        }
        throw new Error('Could not resolve Loom download URL from oEmbed response');
    }

    /**
     * Resolve Google Drive file URL to direct download URL.
     * @private
     */
    _resolveGDriveUrl(shareUrl) {
        const match = shareUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
            return `https://drive.google.com/uc?export=download&id=${match[1]}`;
        }
        throw new Error('Could not extract Google Drive file ID from URL');
    }

    // ─── Cleanup ────────────────────────────────────────────────────

    /**
     * Delete extracted frame files and their parent directory.
     * @param {Array<{ path: string }>} frames
     */
    cleanup(frames) {
        if (!frames || frames.length === 0) return;

        const dirs = new Set();
        for (const frame of frames) {
            try {
                if (fs.existsSync(frame.path)) {
                    fs.unlinkSync(frame.path);
                    dirs.add(path.dirname(frame.path));
                }
            } catch (err) {
                console.error(`[VideoAnalyzer] Cleanup failed for ${path.basename(frame.path)}: ${err.message}`);
            }
        }

        // Remove empty extraction directories
        for (const dir of dirs) {
            try {
                const remaining = fs.readdirSync(dir);
                if (remaining.length === 0) {
                    fs.rmdirSync(dir);
                }
            } catch { /* ignore */ }
        }
    }

    /**
     * Clean up all temp files in the output directory older than the given age.
     * @param {number} [maxAgeMs=600000]  — Max age in ms (default: 10 minutes)
     */
    cleanupStale(maxAgeMs = 600000) {
        if (!fs.existsSync(this.outputDir)) return;

        const now = Date.now();
        const entries = fs.readdirSync(this.outputDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('extract-')) {
                const dirPath = path.join(this.outputDir, entry.name);
                try {
                    const stat = fs.statSync(dirPath);
                    if (now - stat.mtimeMs > maxAgeMs) {
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        console.log(`[VideoAnalyzer] Cleaned up stale extraction: ${entry.name}`);
                    }
                } catch { /* ignore */ }
            }
        }
    }
}


// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a VideoAnalyzer instance from workflow-config.json settings.
 * @param {Object} [configOverrides]
 * @returns {VideoAnalyzer}
 */
function createVideoAnalyzer(configOverrides = {}) {
    let fileConfig = {};
    try {
        const configPath = path.join(__dirname, '..', 'config', 'workflow-config.json');
        if (fs.existsSync(configPath)) {
            const wfConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            fileConfig = wfConfig.videoAnalysis || {};
        }
    } catch (err) {
        console.error(`[VideoAnalyzer] Could not load workflow-config.json: ${err.message}`);
    }

    return new VideoAnalyzer({
        frameRate: configOverrides.frameRate || fileConfig.frameRate,
        maxFrames: configOverrides.maxFrames || fileConfig.maxFrames,
        maxDurationSec: configOverrides.maxDurationSec || fileConfig.maxDurationSec,
        maxFileSizeMB: configOverrides.maxFileSizeMB || fileConfig.maxFileSizeMB,
        outputResolution: configOverrides.outputResolution || fileConfig.outputResolution,
        jpegQuality: configOverrides.jpegQuality || fileConfig.jpegQuality,
        jiraOutputResolution: configOverrides.jiraOutputResolution || fileConfig.jiraOutputResolution,
        jiraJpegQuality: configOverrides.jiraJpegQuality || fileConfig.jiraJpegQuality,
        deduplicationThreshold: configOverrides.deduplicationThreshold ?? fileConfig.deduplicationThreshold,
        maxSDKFrames: configOverrides.maxSDKFrames || fileConfig.maxSDKFrames,
        frameSelectionStrategy: configOverrides.frameSelectionStrategy || fileConfig.frameSelectionStrategy,
        outputDir: configOverrides.outputDir || fileConfig.outputDir,
    });
}


module.exports = { VideoAnalyzer, createVideoAnalyzer };
