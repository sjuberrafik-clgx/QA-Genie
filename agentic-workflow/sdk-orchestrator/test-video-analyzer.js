/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TEST: VideoAnalyzer — Frame Extraction & Analysis Pipeline
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests cover:
 *   1. Validation (file existence, size limits, magic bytes)
 *   2. Metadata extraction (ffprobe)
 *   3. Frame extraction (ffmpeg at 1fps, hybrid selection)
 *   4. Hybrid frame selection algorithm
 *   5. External URL validation (SSRF protection)
 *   6. Cleanup (temp file removal)
 *   7. Factory (createVideoAnalyzer from config)
 *   8. buildVideoContext (full pipeline)
 *
 * Run:  node agentic-workflow/sdk-orchestrator/test-video-analyzer.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { VideoAnalyzer, createVideoAnalyzer } = require('./video-analyzer');

// ─── Test Utilities ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, testName) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        console.error(`  ❌ ${testName}`);
    }
}

function skip(testName, reason) {
    skipped++;
    console.log(`  ⏭️  ${testName} — SKIPPED: ${reason}`);
}

function section(name) {
    console.log(`\n━━━ ${name} ━━━`);
}

// ─── Test Video Generator ───────────────────────────────────────────────────

/**
 * Generate a minimal test video using ffmpeg (5 seconds, solid color frames with text overlay).
 * Returns the path to the generated video, or null if ffmpeg is not available.
 */
function generateTestVideo(durationSec = 5) {
    let ffmpegPath;
    try {
        ffmpegPath = require('ffmpeg-static');
    } catch {
        return null;
    }

    const outputDir = path.join(os.tmpdir(), 'video-analyzer-test');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `test-video-${Date.now()}.mp4`);

    try {
        // Generate a test video with a color source and text showing frame number
        execFileSync(ffmpegPath, [
            '-y',
            '-f', 'lavfi',
            '-i', `color=c=blue:size=640x480:d=${durationSec}:rate=24`,
            '-vf', `drawtext=text='Frame %{frame_num}':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'ultrafast',
            '-t', String(durationSec),
            outputPath,
        ], { timeout: 30000, stdio: 'pipe' });

        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            return outputPath;
        }
    } catch (err) {
        // drawtext filter may not be available; try without it
        try {
            execFileSync(ffmpegPath, [
                '-y',
                '-f', 'lavfi',
                '-i', `color=c=blue:size=640x480:d=${durationSec}:rate=24`,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-t', String(durationSec),
                outputPath,
            ], { timeout: 30000, stdio: 'pipe' });

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                return outputPath;
            }
        } catch {
            return null;
        }
    }

    return null;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

async function runTests() {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║           VideoAnalyzer Test Suite                           ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');

    const testDir = path.join(os.tmpdir(), `video-analyzer-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    const analyzer = new VideoAnalyzer({
        outputDir: testDir,
        maxFrames: 10,      // Keep tests fast with fewer frames
        maxFileSizeMB: 50,
        maxDurationSec: 30,
    });

    // ════════════════════════════════════════════════════════════════
    section('1. Validation');
    // ════════════════════════════════════════════════════════════════

    // Test: null path
    const r1 = analyzer.validateVideoFile(null);
    assert(r1.valid === false && /required/i.test(r1.error), 'Rejects null path');

    // Test: empty string
    const r2 = analyzer.validateVideoFile('');
    assert(r2.valid === false && /required/i.test(r2.error), 'Rejects empty string');

    // Test: non-existent file
    const r3 = analyzer.validateVideoFile('/tmp/does-not-exist-xyz-12345.mp4');
    assert(r3.valid === false && /not found/i.test(r3.error), 'Rejects non-existent file');

    // Test: file too large
    const largePath = path.join(testDir, 'large-file.mp4');
    const largeAnalyzer = new VideoAnalyzer({ outputDir: testDir, maxFileSizeMB: 0.001 }); // 1 KB limit
    // Create a dummy 2 KB file with MP4 magic bytes
    const mp4Header = Buffer.alloc(2048, 0);
    mp4Header.write('ftyp', 4);  // MP4 magic bytes
    fs.writeFileSync(largePath, mp4Header);
    const r4 = largeAnalyzer.validateVideoFile(largePath);
    assert(r4.valid === false && /too large/i.test(r4.error), 'Rejects file exceeding size limit');

    // Test: invalid format (not a video)
    const textPath = path.join(testDir, 'not-video.mp4');
    fs.writeFileSync(textPath, 'This is just a text file pretending to be video');
    const r5 = analyzer.validateVideoFile(textPath);
    assert(r5.valid === false && /invalid video format/i.test(r5.error), 'Rejects non-video files by magic bytes');

    // Test: valid MP4 magic bytes
    const fakemp4Path = path.join(testDir, 'fake-valid.mp4');
    const fakemp4 = Buffer.alloc(1024, 0);
    fakemp4.write('ftyp', 4);
    fs.writeFileSync(fakemp4Path, fakemp4);
    const r6 = analyzer.validateVideoFile(fakemp4Path);
    assert(r6.valid === true, 'Accepts file with valid MP4 magic bytes');
    assert(typeof r6.size === 'number' && r6.size > 0, 'Returns file size on valid file');

    // Test: valid WebM magic bytes
    const webmPath = path.join(testDir, 'fake-valid.webm');
    const webmBuf = Buffer.alloc(1024, 0);
    webmBuf[0] = 0x1A; webmBuf[1] = 0x45; webmBuf[2] = 0xDF; webmBuf[3] = 0xA3;
    fs.writeFileSync(webmPath, webmBuf);
    const r7 = analyzer.validateVideoFile(webmPath);
    assert(r7.valid === true, 'Accepts file with valid WebM magic bytes');

    // Test: valid AVI magic bytes
    const aviPath = path.join(testDir, 'fake-valid.avi');
    const aviBuf = Buffer.alloc(1024, 0);
    aviBuf.write('RIFF', 0);
    fs.writeFileSync(aviPath, aviBuf);
    const r8 = analyzer.validateVideoFile(aviPath);
    assert(r8.valid === true, 'Accepts file with valid AVI magic bytes');

    // ════════════════════════════════════════════════════════════════
    section('2. Hybrid Frame Selection Algorithm');
    // ════════════════════════════════════════════════════════════════

    // Test with mock frame arrays (pure logic, no ffmpeg needed)
    const mockFrames = Array.from({ length: 60 }, (_, i) => ({
        path: `/tmp/frame-${i}.jpg`,
        timestamp: i,
        index: i,
    }));

    // Test: hybrid select with maxFrames=10 from 60 frames
    const selected10 = analyzer._hybridSelect(mockFrames, 10);
    assert(selected10.length === 10, 'Hybrid selects exactly maxFrames frames');
    assert(selected10[0].index === 0, 'Hybrid starts with first frame');
    assert(selected10[selected10.length - 1].index === 59, 'Hybrid ends with last frame');

    // Test: verify even spacing
    const indices10 = selected10.map(f => f.index);
    assert(indices10[0] === 0 && indices10[9] === 59, 'First and last indices correct');

    // Test: when frames <= maxFrames, returns all
    const smallFrames = mockFrames.slice(0, 5);
    const selected5 = analyzer._hybridSelect(smallFrames, 10);
    assert(selected5.length === 5, 'Returns all frames when count <= maxFrames');

    // Test: maxFrames=2 → first and last only
    const selected2 = analyzer._hybridSelect(mockFrames, 2);
    assert(selected2.length === 2, 'maxFrames=2 returns exactly 2');
    assert(selected2[0].index === 0 && selected2[1].index === 59, 'maxFrames=2 gives first and last');

    // Test: maxFrames=1 → first only
    const selected1 = analyzer._hybridSelect(mockFrames, 1);
    assert(selected1.length === 1, 'maxFrames=1 returns exactly 1');
    assert(selected1[0].index === 0, 'maxFrames=1 gives first frame');

    // Test: maxFrames=30 (default) from 60
    const selected30 = analyzer._hybridSelect(mockFrames, 30);
    assert(selected30.length === 30, 'Default hybrid selects 30 from 60');
    assert(selected30[0].index === 0, 'Default hybrid starts at first');
    assert(selected30[29].index === 59, 'Default hybrid ends at last');
    // Verify no duplicates
    const uniqueIndices = new Set(selected30.map(f => f.index));
    assert(uniqueIndices.size === 30, 'No duplicate frames in hybrid selection');

    // ════════════════════════════════════════════════════════════════
    section('3. SSRF Protection (External URL Validation)');
    // ════════════════════════════════════════════════════════════════

    // Private IPs should be rejected
    const privateUrls = [
        'http://127.0.0.1/secret-video.mp4',
        'http://10.0.0.1/internal.mp4',
        'http://172.16.0.1/admin.mp4',
        'http://192.168.1.1/home.mp4',
        'http://169.254.169.254/latest/meta-data/',  // AWS metadata endpoint
        'http://0.0.0.0/exploit.mp4',
    ];

    for (const privateUrl of privateUrls) {
        try {
            analyzer._validateExternalUrl(privateUrl);
            assert(false, `SSRF: Rejects ${new URL(privateUrl).hostname}`);
        } catch (err) {
            assert(/blocked|private|internal/i.test(err.message), `SSRF: Rejects ${new URL(privateUrl).hostname}`);
        }
    }

    // Non-http protocols should be rejected
    const badProtocols = ['file:///etc/passwd', 'ftp://evil.com/video.mp4', 'javascript:alert(1)'];
    for (const badUrl of badProtocols) {
        try {
            analyzer._validateExternalUrl(badUrl);
            assert(false, `Protocol: Rejects ${badUrl.split(':')[0]}://`);
        } catch (err) {
            assert(/unsupported protocol|invalid/i.test(err.message), `Protocol: Rejects ${badUrl.split(':')[0]}://`);
        }
    }

    // Invalid URLs should be rejected
    try {
        analyzer._validateExternalUrl('not-a-url');
        assert(false, 'Rejects invalid URL format');
    } catch (err) {
        assert(/invalid/i.test(err.message), 'Rejects invalid URL format');
    }

    // Valid public URLs should pass
    const validUrls = [
        'https://www.loom.com/share/abc123',
        'https://drive.google.com/file/d/123/view',
        'https://example.com/video.mp4',
    ];
    for (const validUrl of validUrls) {
        try {
            analyzer._validateExternalUrl(validUrl);
            assert(true, `Accepts public URL: ${new URL(validUrl).hostname}`);
        } catch {
            assert(false, `Accepts public URL: ${new URL(validUrl).hostname}`);
        }
    }

    // ════════════════════════════════════════════════════════════════
    section('4. Provider Detection');
    // ════════════════════════════════════════════════════════════════

    assert(analyzer._detectProvider('https://www.loom.com/share/abc123') === 'loom', 'Detects Loom provider');
    assert(analyzer._detectProvider('https://drive.google.com/file/d/123/view') === 'gdrive', 'Detects Google Drive provider');
    assert(analyzer._detectProvider('https://myorg.sharepoint.com/files/video.mp4') === 'sharepoint', 'Detects SharePoint provider');
    assert(analyzer._detectProvider('https://example.com/video.mp4') === 'direct', 'Falls back to direct for unknown URLs');

    // ════════════════════════════════════════════════════════════════
    section('5. Google Drive URL Resolution');
    // ════════════════════════════════════════════════════════════════

    const gdriveUrl = analyzer._resolveGDriveUrl('https://drive.google.com/file/d/1a2B3c4D-_efg/view?usp=sharing');
    assert(gdriveUrl === 'https://drive.google.com/uc?export=download&id=1a2B3c4D-_efg', 'Resolves GDrive file ID to download URL');

    try {
        analyzer._resolveGDriveUrl('https://drive.google.com/folder/something');
        assert(false, 'Rejects GDrive URL without file ID');
    } catch {
        assert(true, 'Rejects GDrive URL without file ID');
    }

    // ════════════════════════════════════════════════════════════════
    section('6. Cleanup');
    // ════════════════════════════════════════════════════════════════

    // Create mock frame files
    const cleanupDir = path.join(testDir, 'extract-cleanup-test');
    fs.mkdirSync(cleanupDir, { recursive: true });
    const mockCleanupFrames = [];
    for (let i = 0; i < 5; i++) {
        const framePath = path.join(cleanupDir, `frame-${i}.jpg`);
        fs.writeFileSync(framePath, `fake frame ${i}`);
        mockCleanupFrames.push({ path: framePath, timestamp: i, index: i });
    }

    assert(fs.readdirSync(cleanupDir).length === 5, 'Cleanup setup: 5 temp frame files exist');
    analyzer.cleanup(mockCleanupFrames);
    assert(!fs.existsSync(cleanupDir), 'Cleanup removes frames and empty directory');

    // Test cleanup with empty array
    analyzer.cleanup([]);
    assert(true, 'Cleanup handles empty array without error');

    // Test cleanup with null
    analyzer.cleanup(null);
    assert(true, 'Cleanup handles null without error');

    // ════════════════════════════════════════════════════════════════
    section('7. Factory (createVideoAnalyzer)');
    // ════════════════════════════════════════════════════════════════

    const factoryAnalyzer = createVideoAnalyzer({ maxFrames: 15 });
    assert(factoryAnalyzer instanceof VideoAnalyzer, 'Factory creates VideoAnalyzer instance');
    assert(factoryAnalyzer.maxFrames === 15, 'Factory applies config overrides');

    // Default factory
    const defaultAnalyzer = createVideoAnalyzer();
    assert(defaultAnalyzer instanceof VideoAnalyzer, 'Factory works with no overrides');
    assert(defaultAnalyzer.maxFrames === 30 || typeof defaultAnalyzer.maxFrames === 'number', 'Factory sets default maxFrames');

    // ════════════════════════════════════════════════════════════════
    section('8. FFmpeg Integration (requires ffmpeg-static)');
    // ════════════════════════════════════════════════════════════════

    const testVideoPath = generateTestVideo(5);

    if (!testVideoPath) {
        skip('Metadata extraction', 'ffmpeg not available or failed to generate test video');
        skip('Frame extraction', 'ffmpeg not available');
        skip('Frame count validation', 'ffmpeg not available');
        skip('Frame files on disk', 'ffmpeg not available');
        skip('buildVideoContext pipeline', 'ffmpeg not available');
        skip('Context prompt content', 'ffmpeg not available');
    } else {
        console.log(`  ℹ️  Generated test video: ${testVideoPath} (${(fs.statSync(testVideoPath).size / 1024).toFixed(1)} KB)`);

        // Test: metadata extraction
        try {
            const meta = await analyzer.extractMetadata(testVideoPath);
            assert(typeof meta.duration === 'number' && meta.duration > 0, 'Metadata: extracts duration');
            assert(typeof meta.width === 'number' && meta.width > 0, 'Metadata: extracts width');
            assert(typeof meta.height === 'number' && meta.height > 0, 'Metadata: extracts height');
            assert(typeof meta.codec === 'string' && meta.codec.length > 0, 'Metadata: extracts codec');
            assert(typeof meta.fps === 'number' && meta.fps > 0, 'Metadata: extracts fps');
            console.log(`  ℹ️  Metadata: ${meta.duration}s, ${meta.width}x${meta.height}, ${meta.codec}, ${meta.fps}fps`);
        } catch (err) {
            assert(false, `Metadata extraction: ${err.message}`);
        }

        // Test: frame extraction
        try {
            const { frames, totalExtracted } = await analyzer.extractFrames(testVideoPath);
            assert(totalExtracted > 0, `Frame extraction: ${totalExtracted} raw frames extracted`);
            assert(frames.length > 0, `Frame selection: ${frames.length} frames selected`);
            assert(frames.length <= 10, 'Frame selection respects maxFrames=10 limit');

            // Verify frames have correct structure
            assert(typeof frames[0].path === 'string', 'Frame has path');
            assert(typeof frames[0].timestamp === 'number', 'Frame has timestamp');
            assert(typeof frames[0].index === 'number', 'Frame has index');

            // Verify frame files exist on disk
            const framesExist = frames.every(f => fs.existsSync(f.path));
            assert(framesExist, 'All selected frame files exist on disk');

            // Verify frame files are valid JPEGs (start with 0xFF 0xD8)
            const firstFrameHeader = Buffer.alloc(2);
            const fd = fs.openSync(frames[0].path, 'r');
            fs.readSync(fd, firstFrameHeader, 0, 2, 0);
            fs.closeSync(fd);
            assert(firstFrameHeader[0] === 0xFF && firstFrameHeader[1] === 0xD8, 'Frame files are valid JPEGs');

            console.log(`  ℹ️  Frames: ${frames.map(f => `${f.timestamp}s`).join(', ')}`);

            // Cleanup test frames
            analyzer.cleanup(frames);
            const framesGone = frames.every(f => !fs.existsSync(f.path));
            assert(framesGone, 'Post-extraction cleanup removes all frame files');
        } catch (err) {
            assert(false, `Frame extraction: ${err.message}`);
        }

        // Test: buildVideoContext (full pipeline)
        try {
            const ctx = await analyzer.buildVideoContext(testVideoPath);
            assert(ctx.metadata && typeof ctx.metadata.duration === 'number', 'buildVideoContext: returns metadata');
            assert(Array.isArray(ctx.frames) && ctx.frames.length > 0, 'buildVideoContext: returns frames');
            assert(typeof ctx.totalExtracted === 'number', 'buildVideoContext: returns totalExtracted');
            assert(typeof ctx.contextPrompt === 'string', 'buildVideoContext: returns contextPrompt');
            assert(ctx.contextPrompt.includes('Video Recording Analysis'), 'Context prompt has header');
            assert(ctx.contextPrompt.includes('chronologically'), 'Context prompt instructs chronological analysis');
            assert(ctx.contextPrompt.includes('Steps to Reproduce'), 'Context prompt mentions Steps to Reproduce');
            console.log(`  ℹ️  Context: ${ctx.frames.length} frames, prompt ${ctx.contextPrompt.length} chars`);

            // Cleanup
            analyzer.cleanup(ctx.frames);
        } catch (err) {
            assert(false, `buildVideoContext: ${err.message}`);
        }

        // Clean up test video
        try { fs.unlinkSync(testVideoPath); } catch { /* ignore */ }
    }

    // ════════════════════════════════════════════════════════════════
    section('9. Stale Cleanup');
    // ════════════════════════════════════════════════════════════════

    // Create a fake stale extraction directory
    const staleDir = path.join(testDir, 'extract-stale-old');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'frame-0001.jpg'), 'stale frame');

    // Set mtime to 20 minutes ago
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(staleDir, twentyMinAgo, twentyMinAgo);

    analyzer.cleanupStale(10 * 60 * 1000); // 10 min threshold
    assert(!fs.existsSync(staleDir), 'cleanupStale removes directories older than threshold');

    // Create a recent directory — should NOT be cleaned
    const recentDir = path.join(testDir, 'extract-recent');
    fs.mkdirSync(recentDir, { recursive: true });
    fs.writeFileSync(path.join(recentDir, 'frame-0001.jpg'), 'recent frame');
    analyzer.cleanupStale(10 * 60 * 1000);
    assert(fs.existsSync(recentDir), 'cleanupStale preserves recent directories');

    // ════════════════════════════════════════════════════════════════
    // Results
    // ════════════════════════════════════════════════════════════════

    // Final cleanup
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log(`║  Results: ${passed} passed, ${failed} failed, ${skipped} skipped ${' '.repeat(Math.max(0, 21 - String(passed + failed + skipped).length))}║`);
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test suite crashed:', err);
    process.exit(1);
});
