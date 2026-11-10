'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { resolveFfmpeg, TRANSCODE_RUNTIME_DIR } = require('../ffmpeg.cjs');
const { transcodeAudioFile } = require('./runner.cjs');
const {
    buildTranscodeCacheKey,
    clearTranscodeCacheEntries,
    getTranscodeCacheDirectory,
    listTranscodeCacheEntries,
    publishCacheEntry,
    readValidCacheEntry,
    removeTranscodeCacheEntry,
    removeInvalidTranscodeCacheEntries,
} = require('./cache.cjs');
const { TRANSCODE_PROTOCOL_SCHEME, registerTranscodeProtocol } = require('./protocol.cjs');

// Coordinates trusted temporary files, de-duplicated FFmpeg jobs, cache publication and IPC.

const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,160}$/;
/** Active deck, warm deck, and enough slack for a transition to hold both ends. */
const MAX_PINNED_CACHE_KEYS = 4;

const safeExtension = fileName => {
    const extension = path.extname(String(fileName || '')).toLowerCase();
    return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.audio';
};

const validateSource = source => {
    if (!source || (source.kind !== 'local' && source.kind !== 'navidrome')) return false;
    if (typeof source.songKey !== 'string' || source.songKey.length < 1 || source.songKey.length > 512) return false;
    if (typeof source.sourceRevision !== 'string' || source.sourceRevision.length < 1 || source.sourceRevision.length > 1024) return false;
    if (source.kind === 'local') return source.data instanceof ArrayBuffer || ArrayBuffer.isView(source.data);
    if (source.data instanceof ArrayBuffer || ArrayBuffer.isView(source.data)) return true;
    try {
        const url = new URL(source.url);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

const shouldUseWavFallback = error => /(?:Unknown encoder|Requested output format).*flac/i.test(String(error?.message || ''));

const createTranscodeService = ({ app, protocol, net, spawnProcess, onCacheWrite } = {}) => {
    const cacheDirectory = getTranscodeCacheDirectory(app.getPath('userData'));
    const temporaryRoot = path.join(cacheDirectory, 'tmp');
    const jobs = new Map();
    const requestJobs = new Map();
    // Keys the renderer is playing from. A fully buffered media element stops reading the file, so
    // its mtime goes stale and an LRU prune would drop the entry out from under playback.
    const pinnedCacheKeys = new Set();
    let ffmpegPromise = null;
    const pendingJobs = [];
    let isJobRunning = false;

    const pinCacheKey = cacheKey => {
        pinnedCacheKeys.delete(cacheKey);
        pinnedCacheKeys.add(cacheKey);
        while (pinnedCacheKeys.size > MAX_PINNED_CACHE_KEYS) {
            pinnedCacheKeys.delete(pinnedCacheKeys.values().next().value);
        }
    };
    const getPinnedCacheKeys = () => [...pinnedCacheKeys];

    const log = (level, event, details = {}) => {
        const writer = level === 'warn' ? console.warn : console.info;
        writer('[TranscodeFallback]', event, details);
    };

    const pumpQueue = async () => {
        if (isJobRunning) return;
        const pending = pendingJobs.shift();
        if (!pending) return;
        isJobRunning = true;
        try {
            pending.resolve(await pending.run());
        } catch (error) {
            pending.reject(error);
        } finally {
            isJobRunning = false;
            void pumpQueue();
        }
    };

    const enqueue = (run, priority) => new Promise((resolve, reject) => {
        pendingJobs.push({ run, resolve, reject, priority });
        pendingJobs.sort((left, right) => left.priority - right.priority);
        void pumpQueue();
    });

    // The protocol is registered before any filesystem work: cached entries stay servable even when
    // the scratch directory cannot be prepared, and no failure here can abort the caller's startup.
    const initialize = async () => {
        registerTranscodeProtocol({ protocol, resolveEntry });
        try {
            await fs.promises.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            await fs.promises.mkdir(temporaryRoot, { recursive: true });
            await removeInvalidTranscodeCacheEntries(cacheDirectory);
        } catch (error) {
            log('warn', 'initialize-failed', { code: error?.code || 'UNKNOWN' });
        }
    };

    const listCacheEntries = () => listTranscodeCacheEntries(cacheDirectory);
    const removeCacheEntry = cacheKey => {
        pinnedCacheKeys.delete(cacheKey);
        return removeTranscodeCacheEntry(cacheDirectory, cacheKey);
    };
    const clearCache = async () => {
        log('info', 'cache-clear', { activeJobs: jobs.size });
        jobs.forEach(job => job.controller.abort());
        pinnedCacheKeys.clear();
        await clearTranscodeCacheEntries(cacheDirectory);
    };

    const resolveEntry = async (cacheKey, format) => {
        const entry = await readValidCacheEntry(cacheDirectory, cacheKey);
        if (entry?.format !== format) return null;
        pinCacheKey(cacheKey);
        return entry;
    };

    const resolveExecutable = async () => {
        // The bundled audio-only runtime lives in its own directory; a mod export must never
        // reach it, and it must never be shadowed by whatever the mods slot holds.
        ffmpegPromise ??= resolveFfmpeg({ appGetAppPath: () => app.getAppPath(), packagedDirName: TRANSCODE_RUNTIME_DIR });
        const status = await ffmpegPromise;
        if (!status.available || !status.path) {
            const error = new Error('FFmpeg is not available');
            error.code = 'FFMPEG_UNAVAILABLE';
            throw error;
        }
        return status.path;
    };

    const writeSource = async (source, inputPath, signal) => {
        if (source.kind === 'local' || source.data) {
            const buffer = Buffer.from(source.data.buffer || source.data, source.data.byteOffset || 0, source.data.byteLength || source.data.byteLength);
            if (buffer.byteLength === 0 || buffer.byteLength > MAX_SOURCE_BYTES) {
                const error = new Error('Local audio size is outside the supported range');
                error.code = 'SOURCE_SIZE_INVALID';
                throw error;
            }
            await fs.promises.writeFile(inputPath, buffer, { signal });
            return buffer.byteLength;
        }

        const response = await net.fetch(source.url, { method: 'GET', redirect: 'follow', signal });
        if (!response.ok || !response.body) {
            const error = new Error(`Navidrome returned HTTP ${response.status}`);
            error.code = 'SOURCE_HTTP_ERROR';
            throw error;
        }
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (/json|xml|text\/html/.test(contentType)) {
            const error = new Error('Navidrome response is not audio');
            error.code = 'SOURCE_NOT_AUDIO';
            throw error;
        }
        const declaredSize = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && (declaredSize <= 0 || declaredSize > MAX_SOURCE_BYTES)) {
            const error = new Error('Navidrome audio size is outside the supported range');
            error.code = 'SOURCE_SIZE_INVALID';
            throw error;
        }
        let received = 0;
        const limiter = new TransformStream({
            transform(chunk, controller) {
                received += chunk.byteLength;
                if (received > MAX_SOURCE_BYTES) throw Object.assign(new Error('Navidrome audio is too large'), { code: 'SOURCE_SIZE_INVALID' });
                controller.enqueue(chunk);
            },
        });
        await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), fs.createWriteStream(inputPath), { signal });
        return received;
    };

    const runJob = async (source, cacheKey, controller, limitBytes) => {
        const logId = cacheKey.slice(0, 12);
        const startedAt = Date.now();
        const cached = await readValidCacheEntry(cacheDirectory, cacheKey);
        if (cached) {
            log('info', 'cache-hit', { cacheKey: logId, format: cached.format });
            return cached;
        }
        log('info', 'cache-miss', { cacheKey: logId, sourceKind: source.kind });
        const executable = await resolveExecutable();
        // Recreated per job so a scratch root that initialize could not prepare still self-heals.
        await fs.promises.mkdir(temporaryRoot, { recursive: true });
        const jobDirectory = await fs.promises.mkdtemp(path.join(temporaryRoot, `${cacheKey.slice(0, 12)}-`));
        const inputPath = path.join(jobDirectory, `input${safeExtension(source.fileName)}`);
        try {
            const inputBytes = await writeSource(source, inputPath, controller.signal);
            log('info', 'encode-start', { cacheKey: logId, inputBytes, sourceKind: source.kind });
            let format = 'flac';
            let outputPath = path.join(jobDirectory, 'output.flac');
            let outputBytes = 0;
            try {
                ({ size: outputBytes } = await transcodeAudioFile({ executable, inputPath, outputPath, format, signal: controller.signal, spawnProcess }));
            } catch (error) {
                if (!shouldUseWavFallback(error)) throw error;
                log('warn', 'wav-fallback', { cacheKey: logId });
                format = 'wav';
                outputPath = path.join(jobDirectory, 'output.wav');
                ({ size: outputBytes } = await transcodeAudioFile({ executable, inputPath, outputPath, format, signal: controller.signal, spawnProcess }));
            }
            const entry = await publishCacheEntry({
                cacheDirectory,
                cacheKey,
                format,
                temporaryAudioPath: outputPath,
                metadata: {
                    songKey: source.songKey,
                    sourceRevision: source.sourceRevision,
                    createdAt: Date.now(),
                },
            });
            // The size comes from the encode rather than a fresh stat of the published file: a
            // concurrent prune or cache clear would otherwise fail a job that fully succeeded.
            await onCacheWrite?.(limitBytes, {
                cacheKey,
                size: outputBytes,
                usedAt: Date.now(),
            });
            log('info', 'complete', {
                cacheKey: logId,
                elapsedMs: Date.now() - startedAt,
                format,
                outputBytes,
            });
            return entry;
        } finally {
            // Windows releases the FFmpeg handles a beat after kill(), and an EBUSY raised here
            // would replace the cancellation or timeout this block is unwinding.
            await fs.promises.rm(jobDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
                .catch(error => log('warn', 'cleanup-failed', { cacheKey: logId, code: error?.code || 'UNKNOWN' }));
        }
    };

    const request = async payload => {
        const requestId = payload?.requestId;
        const source = payload?.source;
        if (
            !REQUEST_ID_PATTERN.test(String(requestId || ''))
            || (payload?.priority !== 'playback' && payload?.priority !== 'warm')
            || !validateSource(source)
        ) {
            log('warn', 'invalid-request', {
                requestId: REQUEST_ID_PATTERN.test(String(requestId || '')) ? requestId : 'invalid',
            });
            return { ok: false, errorCode: 'INVALID_REQUEST', message: 'Invalid transcode request' };
        }
        const cacheKey = buildTranscodeCacheKey(source);
        const logId = cacheKey.slice(0, 12);
        log('info', 'request', { requestId, cacheKey: logId, priority: payload.priority, sourceKind: source.kind });
        let job = jobs.get(cacheKey);
        if (!job) {
            const controller = new AbortController();
            job = { controller, consumers: new Set(), promise: null };
            const queuedRun = enqueue(() => {
                if (controller.signal.aborted) {
                    throw Object.assign(new Error('Transcode cancelled'), { code: 'CANCELLED' });
                }
                return runJob(source, cacheKey, controller, payload.limitBytes);
            }, payload.priority === 'playback' ? 0 : 1);
            job.promise = queuedRun.finally(() => jobs.delete(cacheKey));
            jobs.set(cacheKey, job);
        }
        job.consumers.add(requestId);
        requestJobs.set(requestId, job);
        try {
            const entry = await job.promise;
            pinCacheKey(cacheKey);
            log('info', 'representation-ready', {
                requestId,
                cacheKey: logId,
                format: entry.format,
            });
            return {
                ok: true,
                representation: {
                    songKey: source.songKey,
                    sourceRevision: source.sourceRevision,
                    representationId: `transcode:${cacheKey}`,
                    kind: 'transcoded',
                    url: `${TRANSCODE_PROTOCOL_SCHEME}://media/${cacheKey}/audio.${entry.format}`,
                    mimeType: entry.mimeType,
                    timelineOffsetSec: 0,
                },
            };
        } catch (error) {
            log('warn', error?.code === 'CANCELLED' || error?.name === 'AbortError' ? 'cancelled' : 'failed', {
                requestId,
                cacheKey: logId,
                code: error?.code || error?.name || 'TRANSCODE_FAILED',
            });
            return { ok: false, errorCode: error?.code || 'TRANSCODE_FAILED', message: String(error?.message || error) };
        } finally {
            job.consumers.delete(requestId);
            requestJobs.delete(requestId);
        }
    };

    const cancel = requestId => {
        const job = requestJobs.get(requestId);
        if (!job) return false;
        job.consumers.delete(requestId);
        requestJobs.delete(requestId);
        if (job.consumers.size === 0) job.controller.abort();
        log('info', 'cancel-request', { requestId, abortedJob: job.consumers.size === 0 });
        return true;
    };

    const dispose = () => {
        jobs.forEach(job => job.controller.abort());
        jobs.clear();
        requestJobs.clear();
    };

    return {
        cacheDirectory,
        cancel,
        clearCache,
        dispose,
        getPinnedCacheKeys,
        initialize,
        listCacheEntries,
        removeCacheEntry,
        request,
        resolveEntry,
    };
};

module.exports = { createTranscodeService, safeExtension, shouldUseWavFallback, validateSource };
