// electron/modSystem/exportService.cjs
// Off-screen transparent-window renderer that drives the in-app visualizer on a
// synthetic clock and pipes per-frame captures into ffmpeg to produce a MOV
// with an alpha channel (ProRes 4444). The window is shown but parked off-screen
// so the compositor/rAF run at full speed while staying invisible to the user.
// Designed for stability first: every spawned process and window is torn down
// deterministically on success, failure, or cancellation.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EXPORT_LIMITS = {
    minWidth: 320,
    maxWidth: 3840,
    minHeight: 180,
    maxHeight: 2160,
    minFps: 10,
    maxFps: 60,
    maxDurationSec: 15 * 60, // Guard against accidental full-album renders eating disk.
};

const sanitizeFileName = (value) => String(value ?? 'folia-export')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'folia-export';

const isElectronDevRuntime = () => process.env.ELECTRON_DEV === 'true' || process.env.NODE_ENV === 'development';

/*
 * createExportService({
 *   app, BrowserWindow,
 *   resolveFfmpeg()      -> cached resolver from ffmpeg.cjs,
 *   getModVisualizers()  -> mod visualizer descriptors for the export page,
 * })
 */
const createExportService = ({ app, BrowserWindow, resolveFfmpeg, getModVisualizers }) => {
    let activeSession = null;

    const getExportDirectory = () => path.join(app.getPath('videos'), 'Folia Exports');

    /*
     * Validates and normalizes a render spec. All numbers get clamped to safe
     * bounds before any process is spawned; invalid specs reject with a code
     * the renderer can map to a localized message.
     */
    const normalizeSpec = (spec) => {
        const errors = [];
        const clampNumber = (value, min, max, fallback) => {
            const num = Number(value);
            return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
        };
        const width = Math.round(clampNumber(spec.width, EXPORT_LIMITS.minWidth, EXPORT_LIMITS.maxWidth, 1920));
        const height = Math.round(clampNumber(spec.height, EXPORT_LIMITS.minHeight, EXPORT_LIMITS.maxHeight, 1080));
        const fps = Math.round(clampNumber(spec.fps, EXPORT_LIMITS.minFps, EXPORT_LIMITS.maxFps, 30));

        const lyricData = spec.lyricData && typeof spec.lyricData === 'object' ? spec.lyricData : null;
        const lines = Array.isArray(lyricData && lyricData.lines) ? lyricData.lines.filter(
            (line) => line && Number.isFinite(line.startTime) && Number.isFinite(line.endTime) && line.endTime >= line.startTime
        ) : [];

        if (lines.length === 0) {
            errors.push('export-no-lyrics');
        }

        const lyricEndSec = lines.length > 0 ? Math.max(...lines.map((line) => line.endTime)) : 0;
        const startSec = Math.max(0, Number.isFinite(Number(spec.startSec)) ? Number(spec.startSec) : 0);
        // Default end is the lyrics end plus a 2s buffer, floored at start + 1 so
        // a clip always has non-zero length; an explicit end later than start wins.
        const fallbackEndSec = Math.max(startSec + 1, lyricEndSec + 2);
        const requestedEndSec = (Number.isFinite(Number(spec.endSec)) && Number(spec.endSec) > startSec)
            ? Number(spec.endSec)
            : fallbackEndSec;
        // Clamp the render *duration* (not the absolute end timestamp) to the
        // limit, so late segments of long tracks (mixes/podcasts) stay exportable.
        const endSec = Math.min(requestedEndSec, startSec + EXPORT_LIMITS.maxDurationSec);
        if (endSec <= startSec) {
            errors.push('export-invalid-duration');
        }
        if (!['win32', 'linux', 'darwin'].includes(process.platform)) {
            errors.push('export-unsupported-platform');
        }
        // Only Windows preserves the alpha channel on capturePage. Other
        // platforms keep rendering but the alpha channel may come out black.
        const alphaGuaranteed = process.platform === 'win32';
        // 'none' renders lyrics-only on a fully transparent window; 'theme'
        // fills the render window with the song theme's background color.
        const backgroundMode = spec.backgroundMode === 'theme' ? 'theme' : 'none';
        // When disabled the window is opaque and the theme background applies
        // regardless of platform, guaranteeing a usable non-alpha video.
        const transparent = spec.transparent !== false;

        return {
            ok: errors.length === 0,
            errors,
            spec: {
                width, height, fps, startSec, endSec,
                lyricData,
                visualizerMode: typeof spec.visualizerMode === 'string' ? spec.visualizerMode : 'classic',
                visualizerTunings: spec.visualizerTunings && typeof spec.visualizerTunings === 'object' ? spec.visualizerTunings : null,
                theme: spec.theme && typeof spec.theme === 'object' ? spec.theme : null,
                songMeta: spec.songMeta && typeof spec.songMeta === 'object' ? spec.songMeta : {},
                outputPath: typeof spec.outputPath === 'string' && spec.outputPath.length > 0
                    ? spec.outputPath
                    : null,
                alphaGuaranteed,
                backgroundMode,
                transparent,
                codec: spec.codec === 'prores' ? 'prores' : 'vp9',
            },
        };
    };

    const buildDefaultOutputPath = (songMeta, codec) => {
        const titlePart = sanitizeFileName(songMeta && (songMeta.title || songMeta.name));
        const artistPart = sanitizeFileName(songMeta && (songMeta.artist || songMeta.artists?.[0]?.name));
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const base = artistPart ? `${artistPart} - ${titlePart}` : titlePart;
        const extension = codec === 'prores' ? '.mov' : '.webm';
        return path.join(getExportDirectory(), `${base} - ${stamp}${extension}`);
    };

    const waitForPageReady = async (win, timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const ready = await win.webContents.executeJavaScript('Boolean(window.__foliaModExport)');
                if (ready) {
                    return true;
                }
            } catch {
                // Page may still be booting; keep polling until the deadline.
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
    };

    const getModExportPageUrl = () => {
        if (isElectronDevRuntime()) {
            return new URL('http://localhost:3000/mod-export.html').toString();
        }
        return path.join(__dirname, '../../dist/mod-export.html');
    };

    /*
     * Mod visualizer descriptors for the export page, never allowed to break an
     * export: a failure here just means the page falls back to a builtin mode.
     */
    const safeModVisualizers = () => {
        try {
            const descriptors = typeof getModVisualizers === 'function' ? getModVisualizers() : [];
            return Array.isArray(descriptors) ? descriptors : [];
        } catch {
            return [];
        }
    };

    const renderFrame = (win, tSec) => win.webContents.executeJavaScript(
        `window.__foliaModExport.renderFrame(${tSec})`,
        true
    );

    /*
     * Runs one export session to completion. Returns { ok, outputPath?, error?,
     * cancelled?, warnings }. `onProgress` receives throttled updates.
     */
    const runExport = async ({ modId, spec, onProgress }) => {
        const normalized = normalizeSpec(spec);
        if (!normalized.ok) {
            return { ok: false, error: normalized.errors[0] ?? 'export-invalid-spec' };
        }
        const renderSpec = normalized.spec;

        if (activeSession) {
            return { ok: false, error: 'export-already-running' };
        }

        const ffmpeg = await resolveFfmpeg();
        if (!ffmpeg || !ffmpeg.available) {
            return { ok: false, error: 'export-ffmpeg-not-found' };
        }

        const outputPath = renderSpec.outputPath ?? buildDefaultOutputPath(renderSpec.songMeta, renderSpec.codec);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        const totalFrames = Math.max(1, Math.ceil((renderSpec.endSec - renderSpec.startSec) * renderSpec.fps));
        // Raw-pixel pipe instead of PNG frames: skipping per-frame PNG
        // compression/decode removes the biggest synchronous CPU cost in the
        // main process (the UI jank source) and speeds the whole export up.
        // Electron getBitmap() is BGRA on Windows/Linux and RGBA on macOS.
        const rawPixelFormat = process.platform === 'darwin' ? 'rgba' : 'bgra';
        // Encoder selection: ProRes 4444 is an intraframe editing codec (large, universally
        // compatible MOV); VP9 carries alpha and is ~10x smaller (WebM), but some editors
        // don't import WebM alpha. libx265 in this ffmpeg build has no alpha layer, so HEVC
        // is not offered.
        const encoderArgs = renderSpec.codec === 'prores'
            ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le']
            : ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1'];
        const ffmpegArgs = [
            '-hide_banner', '-loglevel', 'error',
            '-y',
            '-f', 'rawvideo',
            '-pixel_format', rawPixelFormat,
            '-video_size', `${renderSpec.width}x${renderSpec.height}`,
            '-framerate', String(renderSpec.fps),
            '-i', 'pipe:0',
            '-frames:v', String(totalFrames),
            ...encoderArgs,
            outputPath,
        ];
        // No +faststart here: moving the moov atom to the front forces ffmpeg
        // to rewrite the whole file at finalize. Alpha-enabled MOVs reach large
        // sizes (especially ProRes), so that rewrite adds extra I/O after the
        // progress bar is already at 100%. Editors read the trailing moov fine.

        let ffmpegProcess = null;
        let exportWindow = null;
        let cancelled = false;
        let keepOutput = false;

        const session = {
            get cancelled() { return cancelled; },
            cancel: () => { cancelled = true; },
        };
        activeSession = session;

        const finish = (result) => {
            activeSession = null;
            return result;
        };

        try {
            ffmpegProcess = spawn(ffmpeg.path, ffmpegArgs, {
                stdio: ['pipe', 'ignore', 'pipe'],
                windowsHide: true,
            });
            // Consume stderr so the pipe buffer can never fill and stall ffmpeg.
            ffmpegProcess.stderr.on('data', () => {});
            const ffmpegExit = new Promise((resolve) => {
                ffmpegProcess.on('error', (error) => resolve({ code: -1, error }));
                ffmpegProcess.on('exit', (code, signal) => resolve({ code, signal }));
            });

            exportWindow = new BrowserWindow({
                // A shown window keeps GPU compositing and rAF running at full
                // speed (a `show:false` window throttles rAF and falls back to a
                // slow software readback on capturePage). We park it off-screen
                // below so it stays invisible while still rendering normally.
                show: true,
                frame: false,
                transparent: renderSpec.transparent,
                backgroundColor: renderSpec.transparent
                    ? '#00000000'
                    : (renderSpec.theme && renderSpec.theme.backgroundColor) || '#09090b',
                x: -32000,
                y: -32000,
                width: renderSpec.width,
                height: renderSpec.height,
                useContentSize: true,
                resizable: false,
                minimizable: false,
                maximizable: false,
                skipTaskbar: true,
                focusable: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    backgroundThrottling: false,
                },
            });
            // No setFrameRate here: capping the compositor also caps RAF, which
            // used to stretch the per-frame settle wait far beyond a frame.

            const exportPageUrl = getModExportPageUrl();
            if (isElectronDevRuntime()) {
                await exportWindow.loadURL(exportPageUrl);
            } else {
                await exportWindow.loadFile(exportPageUrl);
            }

            const pageReady = await waitForPageReady(exportWindow);
            if (!pageReady || cancelled) {
                throw new Error(cancelled ? 'cancelled' : 'export-page-not-ready');
            }

            // The export window deliberately has no preload, so it cannot
            // query the mod bridge for contributed visualizers. Their
            // descriptors ride along in the render config instead, which is
            // what makes a `mod:` visualizerMode resolve here at all; without
            // them the page would silently fall back to a builtin mode.
            const injected = JSON.stringify({
                lyricData: renderSpec.lyricData,
                visualizerMode: renderSpec.visualizerMode,
                visualizerTunings: renderSpec.visualizerTunings,
                theme: renderSpec.theme,
                songMeta: renderSpec.songMeta,
                startSec: renderSpec.startSec,
                backgroundMode: renderSpec.backgroundMode,
                transparent: renderSpec.transparent,
                modVisualizers: safeModVisualizers(),
            });
            // configure() returns a promise (it imports the mod visualizer
            // modules); executeJavaScript resolves it, so the first frame is
            // only rendered once the requested mode is actually registered.
            await exportWindow.webContents.executeJavaScript(
                `window.__foliaModExport.configure(${injected})`,
                true
            );

            let lastPercent = -1;
            let alphaProbeDone = false;
            const runtimeWarnings = [];
            // Render the first frame up front so the loop below can overlap
            // each frame's settle RAF with the previous frame's pipe write:
            // the two slow steps (compositor settle, stdin drain) then run in
            // parallel instead of stacking.
            await renderFrame(exportWindow, renderSpec.startSec);
            let writeTail = Promise.resolve();
            for (let frame = 0; frame < totalFrames; frame += 1) {
                if (cancelled) {
                    break;
                }
                const tSec = renderSpec.startSec + frame / renderSpec.fps;
                let image = await exportWindow.webContents.capturePage();
                if (!image || image.isEmpty()) {
                    throw new Error('export-capture-empty');
                }
                const capturedSize = image.getSize();
                if (capturedSize.width !== renderSpec.width || capturedSize.height !== renderSpec.height) {
                    image = image.resize({ width: renderSpec.width, height: renderSpec.height });
                }
                const bitmap = Buffer.from(image.getBitmap());
                if (renderSpec.transparent && !alphaProbeDone) {
                    alphaProbeDone = true;
                    if (!probeBitmapAlpha(bitmap, renderSpec.width, renderSpec.height)) {
                        runtimeWarnings.push('export-alpha-unavailable');
                        onProgress({ phase: 'rendering', frame: frame + 1, totalFrames, percent: 0, message: 'export-alpha-unavailable' });
                    }
                }
                // Kick off the next frame's render before blocking on stdin so
                // its RAF settle overlaps this frame's pipe drain.
                const nextT = renderSpec.startSec + (frame + 1) / renderSpec.fps;
                const nextRender = frame + 1 < totalFrames ? renderFrame(exportWindow, nextT) : null;
                await writeTail;
                writeTail = writeToStdin(ffmpegProcess, bitmap);

                const percent = Math.round(((frame + 1) / totalFrames) * 100);
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    onProgress({
                        phase: 'rendering',
                        frame: frame + 1,
                        totalFrames,
                        percent,
                    });
                }

                if (nextRender) {
                    if (cancelled) {
                        nextRender.catch(() => {});
                        break;
                    }
                    await nextRender;
                }
            }

            if (cancelled) {
                ffmpegProcess.stdin.end();
                ffmpegProcess.kill('SIGKILL');
                await ffmpegExit;
                return finish({ ok: false, cancelled: true, error: 'export-cancelled' });
            }

            ffmpegProcess.stdin.end();
            const exitResult = await ffmpegExit;
            if (exitResult.code !== 0) {
                throw new Error('export-ffmpeg-failed');
            }
            const stat = fs.statSync(outputPath);
            keepOutput = true;
            onProgress({ phase: 'done', frame: totalFrames, totalFrames, percent: 100 });
            // Platform hint plus the first-frame alpha probe decide the final
            // warning set; a successful probe beats a platform assumption.
            if (!renderSpec.alphaGuaranteed && !runtimeWarnings.includes('export-alpha-unavailable')) {
                runtimeWarnings.push('export-alpha-not-guaranteed');
            }
            return finish({
                ok: true,
                outputPath,
                frameCount: totalFrames,
                sizeBytes: stat.size,
                durationSec: renderSpec.endSec - renderSpec.startSec,
                backgroundMode: renderSpec.backgroundMode,
                transparent: renderSpec.transparent,
                warnings: runtimeWarnings,
            });
        } catch (error) {
            const message = error && error.message ? error.message : 'export-failed';
            const isCancellation = message === 'cancelled';
            if (!isCancellation) {
                onProgress({ phase: 'error', frame: 0, totalFrames, percent: 0, message });
            }
            return finish({
                ok: false,
                cancelled: isCancellation,
                error: message,
            });
        } finally {
            settleTeardown(exportWindow, ffmpegProcess, outputPath, keepOutput);
        }
    };

    const writeToStdin = (childProcess, buffer) => new Promise((resolve, reject) => {
        const { stdin } = childProcess;
        if (!stdin || stdin.destroyed) {
            reject(new Error('export-ffmpeg-stdin-closed'));
            return;
        }
        const onError = (error) => {
            stdin.removeListener('drain', onDrain);
            reject(error);
        };
        const onDrain = () => {
            stdin.removeListener('error', onError);
            resolve();
        };
        const canContinue = stdin.write(buffer);
        if (canContinue) {
            stdin.removeListener('error', onError);
            resolve();
        } else {
            stdin.once('drain', onDrain);
            stdin.once('error', onError);
        }
    });

    /*
     * Checks whether the captured bitmap actually carries an alpha channel:
     * samples the four corners (lyric-safe areas) and reports success only
     * when at least one of them is below opaque. BGRA layout puts alpha in the
     * 4th byte of each pixel; RGBA (macOS) puts it first.
     */
    const probeBitmapAlpha = (bitmap, width, height) => {
        if (!bitmap || bitmap.length < width * height * 4) {
            return false;
        }
        const stride = Math.floor(bitmap.length / (width * height)) >= 4 ? 4 : 0;
        if (stride === 0) {
            return false;
        }
        // Determine byte order from the resolved raw pixel format: bgra on
        // Windows/Linux puts alpha at offset 3, rgba on macOS at offset 0.
        const alphaOffset = process.platform === 'darwin' ? 0 : 3;
        const sampleAlpha = (x, y) => bitmap.readUInt8(((y * width) + x) * stride + alphaOffset);
        const corners = [
            sampleAlpha(0, 0),
            sampleAlpha(Math.max(0, width - 1), 0),
            sampleAlpha(0, Math.max(0, height - 1)),
            sampleAlpha(Math.max(0, width - 1), Math.max(0, height - 1)),
        ];
        const minAlpha = Math.min(...corners);
        return minAlpha < 250;
    };

    /*
     * Deterministic cleanup: kill ffmpeg when it is still alive, destroy the
     * hidden window, and remove a partial output file for cancelled/failed
     * runs so no half-encoded MOV is ever left behind.
     */
    const settleTeardown = (exportWindow, ffmpegProcess, outputPath, keepOutput) => {
        if (exportWindow && !exportWindow.isDestroyed()) {
            try {
                exportWindow.webContents.executeJavaScript('window.__foliaModExport && window.__foliaModExport.dispose?.()');
            } catch {
                // The page may already be gone; disposal is best-effort only.
            }
            exportWindow.destroy();
        }
        if (ffmpegProcess && !ffmpegProcess.killed) {
            try {
                ffmpegProcess.stdin.end();
                ffmpegProcess.kill('SIGKILL');
            } catch {
                // Process already exited.
            }
        }
        if (!keepOutput) {
            try {
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
            } catch {
                // Partial file cleanup is best-effort.
            }
        }
    };

    const isExportRunning = () => Boolean(activeSession);

    const cancelActiveExport = () => {
        if (!activeSession) {
            return false;
        }
        activeSession.cancel();
        return true;
    };

    return { runExport, cancelActiveExport, isExportRunning };
};

module.exports = { createExportService, EXPORT_LIMITS };