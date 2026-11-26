const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// electron/analysis/strokesModelFetch.cjs
// On-demand download of 雾笺's two font-stroke weight files (bihua full6 + own2) from Hugging Face.
//
// LICENCE, OPEN DECISION: these weights are CC BY-NC-ND 4.0. shared/modelManifest.json states that the app
// downloads nothing at runtime and that NC models cannot be listed while Folia is AGPL, so they are
// deliberately NOT in that manifest or in build/fetchModels.mjs; this module has its own pinned table.
// Shipping a build that runs this download needs the owner's licence decision first.
//
// Plain node (global fetch, no 'electron'), so it is unit-testable with a mocked fetch. Nothing about the
// listener is sent: no cookies, no identifying headers, a generic User-Agent.

const HF_REVISION = '59909dddf12ba3aadffb73dd1ecf71c48e1168b5';
const HF_PATH = `lantudou/bihua/resolve/${HF_REVISION}`;
/** hf-mirror first (reachable where huggingface.co is not), then the origin. */
const MIRRORS = [`https://hf-mirror.com/${HF_PATH}`, `https://huggingface.co/${HF_PATH}`];

/** modelPaths.cjs MODEL_FILES name -> the pinned remote file. */
const STROKES_MODELS = {
    strokes_full6: {
        remote: 'full6/full6-folia.bin',
        fileName: 'strokes-full6-wgsl.bin',
        bytes: 19608698,
        sha256: '24361ecb2f048fe91a188018644090b2d39f09a239cd771c3ab89d87861c142c',
    },
    strokes_own2: {
        remote: 'own2/own2-folia.bin',
        fileName: 'strokes-own2-wgsl.bin',
        bytes: 4009690,
        sha256: '0dff64ec6b9a51b1782b2acebf358476aaa025b1c06fea9df0de388908404825',
    },
};

const TIMEOUT_MS = 60_000;
/** One in-flight download per destination file. */
const inflight = new Map();

/** Downloads `url` to `tmp` while hashing; throws on HTTP error, timeout, size or hash mismatch. */
const downloadOne = async (url, tmp, spec, fetchImpl, timeoutMs, onLog) => {
    const controller = new AbortController();
    // Idle timeout: re-armed on every chunk, so a slow but moving download is not killed.
    let timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    const rearm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs); };
    try {
        const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'folia-model-fetch' } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        let nextLog = 0.25;
        const meter = new Transform({
            transform(chunk, _enc, cb) {
                rearm();
                hash.update(chunk);
                bytes += chunk.length;
                if (bytes / spec.bytes >= nextLog) {
                    onLog(`${spec.fileName} ${Math.round((bytes / spec.bytes) * 100)}%`);
                    nextLog += 0.25;
                }
                cb(null, chunk);
            },
        });
        await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp), { signal: controller.signal });
        if (bytes !== spec.bytes) throw new Error(`size ${bytes} != ${spec.bytes}`);
        const digest = hash.digest('hex');
        if (digest !== spec.sha256) throw new Error(`sha256 ${digest} != ${spec.sha256}`);
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Makes sure the stroke model `name` (a STROKES_MODELS key) is in `destDir` and resolves to its path.
 * Tries each mirror in order, via a temp file that is renamed over the final name only once size and
 * sha256 match. Concurrent calls for one file share one promise. Rejects when every mirror fails.
 */
const ensureStrokesModel = (name, destDir, { fetchImpl = globalThis.fetch, mirrors = MIRRORS, timeoutMs = TIMEOUT_MS, log = console.log } = {}) => {
    const spec = STROKES_MODELS[name];
    if (!spec) return Promise.reject(new Error(`unknown strokes model ${name}`));
    const dest = path.join(destDir, spec.fileName);
    const existing = inflight.get(dest);
    if (existing) return existing;
    const run = (async () => {
        await fs.promises.mkdir(destDir, { recursive: true });
        const tmp = `${dest}.${process.pid}.part`;
        const errors = [];
        for (const mirror of mirrors) {
            const url = `${mirror}/${spec.remote}`;
            try {
                log(`[strokes-fetch] downloading ${url}`);
                await downloadOne(url, tmp, spec, fetchImpl, timeoutMs, (line) => log(`[strokes-fetch] ${line}`));
                await fs.promises.rename(tmp, dest);
                log(`[strokes-fetch] ${spec.fileName} ready`);
                return dest;
            } catch (error) {
                errors.push(`${new URL(url).host}: ${error?.message || error}`);
                log(`[strokes-fetch] ${url} failed: ${error?.message || error}`);
                await fs.promises.rm(tmp, { force: true });
            }
        }
        throw new Error(`could not download ${spec.fileName} (${errors.join('; ')})`);
    })().finally(() => inflight.delete(dest));
    inflight.set(dest, run);
    return run;
};

module.exports = { STROKES_MODELS, MIRRORS, HF_REVISION, ensureStrokesModel };
