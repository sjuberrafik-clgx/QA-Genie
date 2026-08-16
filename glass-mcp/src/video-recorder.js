'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const VIDEO_ACTIONS = new Set(['videoStart', 'videoStop', 'videoStatus']);
const DEFAULT_FPS = 10;
const DEFAULT_QUALITY = 80;

function isVideoAction(action) {
    return VIDEO_ACTIONS.has(action);
}

function resolveFfmpegPath(explicitPath) {
    if (explicitPath) return explicitPath;
    if (process.env.GLASS_FFMPEG_PATH) return process.env.GLASS_FFMPEG_PATH;
    try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}

function videoPath(requestedPath, artifactsDir) {
    const destination = requestedPath || path.join(
        artifactsDir || os.tmpdir(),
        `glass-video-${Date.now()}.mp4`,
    );
    const extension = path.extname(destination).toLowerCase();
    if (!['.mp4', '.webm'].includes(extension)) {
        const error = new Error('video path must use .mp4 or .webm');
        error.code = 'GLASS_VIDEO_FORMAT_INVALID';
        throw error;
    }
    return path.resolve(destination);
}

function encoderArgs(destination, fps) {
    const common = [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
        '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    ];
    if (path.extname(destination).toLowerCase() === '.webm') {
        return [...common, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '6', '-pix_fmt', 'yuv420p', destination];
    }
    return [...common, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination];
}

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
}

class VideoRecorder {
    constructor(transport, options = {}) {
        this.transport = transport;
        this.destination = videoPath(options.path, options.artifactsDir);
        this.ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
        this.fps = boundedInteger(options.fps, DEFAULT_FPS, 1, 30);
        this.quality = boundedInteger(options.quality, DEFAULT_QUALITY, 1, 100);
        this.maxWidth = boundedInteger(options.maxWidth, 1280, 16, 7680);
        this.maxHeight = boundedInteger(options.maxHeight, 720, 16, 4320);
        this.startedAt = null;
        this.sourceFrames = 0;
        this.encodedFrames = 0;
        this.lastFrame = null;
        this.lastFrameAt = null;
        this.encoder = null;
        this.stderr = '';
        this.active = false;
        this.queue = Promise.resolve();
        this.exitPromise = null;
        this.frameHandler = (frame) => this._acceptFrame(frame);
    }

    async start() {
        fs.mkdirSync(path.dirname(this.destination), { recursive: true });
        this.encoder = spawn(this.ffmpegPath, encoderArgs(this.destination, this.fps), {
            stdio: ['pipe', 'ignore', 'pipe'],
            windowsHide: true,
        });
        this.encoder.stderr.on('data', (chunk) => {
            this.stderr = (this.stderr + chunk.toString()).slice(-12000);
        });
        this.exitPromise = new Promise((resolve) => {
            this.encoder.once('exit', (code, signal) => resolve({ code, signal }));
        });
        await waitForSpawn(this.encoder);

        this.transport.on('Page.screencastFrame', this.frameHandler);
        try {
            await this.transport.send('Page.startScreencast', {
                format: 'jpeg',
                quality: this.quality,
                maxWidth: this.maxWidth,
                maxHeight: this.maxHeight,
                everyNthFrame: 1,
            });
            this.startedAt = Date.now();
            this.active = true;
            const initial = await this.transport.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: this.quality,
                captureBeyondViewport: false,
            });
            if (initial && initial.data) this._acceptFrame({ data: initial.data });
        } catch (error) {
            this.transport.off('Page.screencastFrame', this.frameHandler);
            this.encoder.kill();
            throw error;
        }

        return this.status('videoStart');
    }

    status(action = 'videoStatus') {
        return {
            ok: true,
            action,
            recording: this.active,
            path: this.destination,
            format: path.extname(this.destination).slice(1),
            fps: this.fps,
            quality: this.quality,
            audio: false,
            durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
            sourceFrames: this.sourceFrames,
            encodedFrames: this.encodedFrames,
        };
    }

    async stop() {
        if (!this.active) return this.status('videoStop');
        this.active = false;
        await this.transport.send('Page.stopScreencast').catch(() => {});
        this.transport.off('Page.screencastFrame', this.frameHandler);

        await this.queue;
        if (this.lastFrame) {
            const elapsed = Math.max(0, Date.now() - this.lastFrameAt);
            const repeats = Math.max(1, Math.round(elapsed / (1000 / this.fps)));
            for (let index = 0; index < repeats; index++) await this._write(this.lastFrame);
        }
        this.encoder.stdin.end();
        const exit = await waitForExit(this.exitPromise, this.encoder, 30000);
        if (exit.code !== 0) {
            const error = new Error(this.stderr.trim() || `FFmpeg exited with code ${exit.code}`);
            error.code = 'GLASS_VIDEO_ENCODE_ERROR';
            throw error;
        }

        const receipt = this.status('videoStop');
        receipt.bytes = fs.statSync(this.destination).size;
        return receipt;
    }

    _acceptFrame(frame) {
        if (!frame || !frame.data) return;
        if (frame.sessionId != null) {
            this.transport.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
        }
        const current = Buffer.from(frame.data, 'base64');
        const now = Date.now();
        const previous = this.lastFrame;
        const previousAt = this.lastFrameAt;
        this.lastFrame = current;
        this.lastFrameAt = now;
        this.sourceFrames++;
        this.queue = this.queue.then(async () => {
            if (previous) {
                const elapsed = Math.max(0, now - previousAt);
                const repeats = Math.max(1, Math.min(this.fps * 10, Math.round(elapsed / (1000 / this.fps))));
                for (let index = 0; index < repeats; index++) await this._write(previous);
            }
            await this._write(current);
        });
    }

    _write(frame) {
        return new Promise((resolve, reject) => {
            if (!this.encoder || !this.encoder.stdin || this.encoder.stdin.destroyed) {
                reject(new Error('video encoder input is closed'));
                return;
            }
            this.encoder.stdin.write(frame, (error) => {
                if (error) reject(error);
                else {
                    this.encodedFrames++;
                    resolve();
                }
            });
        });
    }
}

async function videoAction(recorders, key, transport, args = {}, defaults = {}) {
    const action = args.action;
    const current = recorders.get(key);
    if (action === 'videoStatus') {
        return current
            ? current.status()
            : { ok: true, action, recording: false, path: null, audio: false, durationMs: 0, sourceFrames: 0, encodedFrames: 0 };
    }
    if (action === 'videoStart') {
        if (current && current.active) {
            return { ok: false, code: 'GLASS_VIDEO_ALREADY_RECORDING', action, error: 'video recording is already active for this tab', path: current.destination };
        }
        const recorder = new VideoRecorder(transport, { ...defaults, ...args });
        try {
            const receipt = await recorder.start();
            recorders.set(key, recorder);
            return receipt;
        } catch (error) {
            return { ok: false, code: error.code || 'GLASS_VIDEO_START_ERROR', action, error: error.message };
        }
    }
    if (!current) {
        return { ok: false, code: 'GLASS_VIDEO_NOT_RECORDING', action, error: 'no active video recording for this tab' };
    }
    try {
        const receipt = await current.stop();
        recorders.delete(key);
        return receipt;
    } catch (error) {
        recorders.delete(key);
        return { ok: false, code: error.code || 'GLASS_VIDEO_STOP_ERROR', action, error: error.message, path: current.destination };
    }
}

async function stopVideoRecording(recorders, key) {
    const recorder = recorders.get(key);
    if (!recorder) return null;
    try { return await recorder.stop(); } finally { recorders.delete(key); }
}

async function stopAllVideoRecordings(recorders) {
    const recordings = [...recorders.entries()];
    return Promise.allSettled(recordings.map(([key]) => stopVideoRecording(recorders, key)));
}

function waitForSpawn(child) {
    return new Promise((resolve, reject) => {
        const onSpawn = () => { cleanup(); resolve(); };
        const onError = (error) => { cleanup(); reject(error); };
        const cleanup = () => {
            child.removeListener('spawn', onSpawn);
            child.removeListener('error', onError);
        };
        child.once('spawn', onSpawn);
        child.once('error', onError);
    });
}

async function waitForExit(exitPromise, child, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            exitPromise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    child.kill();
                    const error = new Error(`video encoder did not finish within ${timeoutMs}ms`);
                    error.code = 'GLASS_VIDEO_ENCODE_TIMEOUT';
                    reject(error);
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

module.exports = {
    VideoRecorder,
    isVideoAction,
    resolveFfmpegPath,
    stopAllVideoRecordings,
    stopVideoRecording,
    videoAction,
};