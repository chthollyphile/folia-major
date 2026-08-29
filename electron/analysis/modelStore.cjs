const { createHash } = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { unzipSync } = require('fflate');
const {
    MODEL_NAMES, RUNTIME_BIN, resolveModelFile, resolveRuntimeDir, downloadables,
} = require('./modelPaths.cjs');

// electron/analysis/modelStore.cjs
// Getting the weights onto the listener's disk: over the network, or off a file they already have.
//
// Both routes end at the same place and pass the same test. A file that arrives by netdisk is verified
// exactly like one we downloaded, because the risk is identical and it is not the kind of risk a human
// carrying the file reduces: a truncated or substituted ONNX does not fail loudly, it loads and answers
// confidently and wrongly. There is no second, laxer trust level here.
//
// The hash is also what makes the local scan work at all. Names are worthless for this - a browser writes
// "beat_this (1).onnx", a netdisk client appends ".download", some strip the extension - so the scan
// matches on SIZE first (one stat, and 83077778 bytes is effectively unique) and confirms with sha256.
// That recognises a correct file under any name, and refuses a wrong one under the right name.

const manifest = require('../../shared/modelManifest.json');

/** Progress is reported at most this often. A 166MB download is thousands of chunks. */
const PROGRESS_INTERVAL_MS = 200;
/** How long a mirror gets to START answering, as opposed to to finish. See build/fetchModels.mjs. */
const RESPOND_TIMEOUT_MS = 45_000;

const hashFile = (file) => new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
        .on('data', chunk => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')));
});

/** Whether this exact file is the model it claims to be. Size first: it rejects almost everything. */
const fileIsModel = async (file, model) => {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size !== model.bytes) return false;
    return await hashFile(file).catch(() => null) === model.sha256;
};

/** Bytes on disk at `target`, which since the runtime arrived may be a directory of 1400 files. */
const sizeOf = async (target) => {
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of await fsp.readdir(target, { withFileTypes: true })) {
        total += await sizeOf(path.join(target, entry.name));
    }
    return total;
};

/**
 * Unpacks a verified archive into `home`, replacing whatever was there. The archive is left
 * alone - whether it should survive depends on whose it is, and only the caller knows that.
 *
 * Staged under `.part` and renamed for the same reason the downloads are: extracting 1400 files
 * straight into `runtime/` means a run interrupted half way leaves a directory that LOOKS
 * installed. The rename is the only moment the real name exists, and it is atomic.
 *
 * The chmod is not optional off Windows. A zip stores unix permission bits by convention and
 * fflate does not restore them, so every extracted file arrives 0644 - including the interpreter,
 * which then cannot be executed at all. One file needs it: the build drops everything else in bin/.
 */
const unpack = async (archive, home) => {
    const staging = `${home}.part`;
    await fsp.rm(staging, { recursive: true, force: true });
    for (const [name, body] of Object.entries(unzipSync(await fsp.readFile(archive)))) {
        if (name.endsWith('/')) continue;
        const out = path.join(staging, name);
        // Defence in depth: both callers unpack only after a sha256 check, but a zip entry named
        // `../x` would still `path.join` its way out of staging. The file header promises there is no
        // second, looser trust level - so this must hold without leaning on the hash upstream of it.
        if (!path.resolve(out).startsWith(path.resolve(staging) + path.sep)) {
            throw new Error(`refusing zip entry outside staging: ${name}`);
        }
        await fsp.mkdir(path.dirname(out), { recursive: true });
        await fsp.writeFile(out, body);
    }
    if (process.platform !== 'win32') await fsp.chmod(path.join(staging, ...RUNTIME_BIN), 0o755);

    await fsp.rm(home, { recursive: true, force: true });
    await fsp.rename(staging, home);
};

const createModelStore = ({ getModelsDirs, getDownloadDir, onProgress, onChanged }) => {
    const dirs = () => (getModelsDirs?.() ?? []).filter(Boolean);

    /**
     * The manifest as it applies to this machine - see `downloadables`.
     *
     * Read when the store is BUILT rather than when this module is imported. At module scope it is
     * evaluated the moment anything requires this file, which in production is indistinguishable
     * and under test is a whole class of silent wrongness: a suite that rewrites the manifest to
     * describe stand-in weights got the real hashes anyway, because the fold had already happened.
     * The app builds one store, so this costs one pass over three objects.
     */
    const ENTRIES = downloadables(manifest);

    /** Only ever something this machine can install, so no caller has to check `supported`. */
    const modelBy = (name) => ENTRIES.find(entry => entry.name === name && entry.supported) ?? null;

    /** Where this entry is installed, or null. A model is a file; the runtime is a directory. */
    const installedPath = (entry) => (entry.unpack
        ? resolveRuntimeDir(dirs())
        : resolveModelFile(dirs(), entry.name));

    /** name -> AbortController, so a download in flight can be called off. */
    const running = new Map();

    const report = (event) => {
        try { onProgress?.(event); } catch { /* a closed window is not news */ }
    };

    /**
     * Streams one model in, hashing as it goes, and only then puts it where the worker looks.
     *
     * Written to a `.part` file and renamed, because the alternative is a half-file sitting under
     * the real name: resolveModelFile would find it, the settings page would call the model
     * installed, and onnxruntime would be handed a truncated graph.
     */
    const downloadTo = async (model, url, target, signal) => {
        const host = new URL(url).host;
        const controller = new AbortController();
        const abort = () => controller.abort(new Error('canceled'));
        signal?.addEventListener('abort', abort, { once: true });
        // Covers the headers only. A mirror doing a cold pull of 166MB from its origin is slow, not
        // dead, and a budget spanning the transfer judged exactly that case wrong once already.
        let deadline = setTimeout(() => controller.abort(new Error('no response')), RESPOND_TIMEOUT_MS);

        const part = `${target}.part`;
        try {
            const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
            clearTimeout(deadline);
            deadline = null;
            if (!response.ok) return `${host}: ${response.status} ${response.statusText}`;

            const total = Number(response.headers.get('content-length')) || model.bytes;
            const hash = createHash('sha256');
            const handle = await fsp.open(part, 'w');
            let received = 0;
            let announced = 0;
            try {
                for await (const chunk of response.body) {
                    hash.update(chunk);
                    await handle.write(chunk);
                    received += chunk.length;
                    const now = Date.now();
                    if (now - announced >= PROGRESS_INTERVAL_MS) {
                        announced = now;
                        report({ name: model.name, status: 'downloading', received, total, host });
                    }
                }
            } finally {
                await handle.close();
            }

            const digest = hash.digest('hex');
            if (received !== model.bytes || digest !== model.sha256) {
                // Same treatment as a mirror that is down. A host serving the wrong bytes is not a
                // host to keep asking, so we move to the next one.
                await fsp.rm(part, { force: true });
                return `${host}: ${received} bytes, sha256 ${digest.slice(0, 12)}`
                    + ` (wanted ${model.bytes}, ${model.sha256.slice(0, 12)})`;
            }

            await fsp.rename(part, target);
            return null;
        } catch (error) {
            await fsp.rm(part, { force: true }).catch(() => { });
            return `${host}: ${error?.cause?.message || error?.message || String(error)}`;
        } finally {
            if (deadline) clearTimeout(deadline);
            signal?.removeEventListener('abort', abort);
        }
    };

    /**
     * Fetches one model, trying every mirror in turn.
     *
     * Resolves with the reasons rather than throwing when they all fail: the caller is a settings
     * page that has to SHOW them, and every one of them is ordinary - a blocked host, a cold
     * mirror, no network - rather than exceptional.
     */
    const download = async (name) => {
        const model = modelBy(name);
        if (!model) return { ok: false, skipped: [`unknown model ${name}`] };
        if (running.has(name)) return { ok: false, skipped: ['already downloading'] };

        const dir = getDownloadDir();
        await fsp.mkdir(dir, { recursive: true });
        const target = path.join(dir, model.file);

        const controller = new AbortController();
        running.set(name, controller);
        report({ name, status: 'downloading', received: 0, total: model.bytes, host: null });

        const skipped = [];
        try {
            for (const template of manifest.mirrors) {
                if (controller.signal.aborted) {
                    skipped.push('canceled');
                    break;
                }
                const url = template.replace('{file}', model.file);
                const failure = await downloadTo(model, url, target, controller.signal);
                if (failure === null) {
                    // Unpacked only AFTER the hash matched, never straight out of the response:
                    // this writes 1400 files into the models directory, and doing that from bytes
                    // nobody has checked is how a bad mirror would get to choose them.
                    const home = model.unpack && path.join(dir, model.unpack);
                    if (home) {
                        await unpack(target, home);
                        // Ours, downloaded seconds ago, a third the size of what it unpacked to,
                        // and never read again - what counts as installed is the interpreter in
                        // the directory. Deleted here rather than inside `unpack`, because the
                        // other caller's archive belongs to the listener. See installLocal.
                        await fsp.rm(target, { force: true });
                    }
                    report({ name, status: 'ready', received: model.bytes, total: model.bytes, host: null });
                    onChanged?.();
                    return { ok: true, skipped, path: home || target };
                }
                skipped.push(failure);
            }
        } finally {
            running.delete(name);
        }

        // Logged whether or not a later mirror worked - see build/fetchModels.mjs for why a silent
        // fallback is the failure mode worth designing against here.
        for (const failure of skipped) console.warn(`[models] ${name}: skipped ${failure}`);
        report({ name, status: 'failed', received: 0, total: model.bytes, host: null });
        return { ok: false, skipped };
    };

    const cancel = (name) => {
        const controller = running.get(name);
        controller?.abort(new Error('canceled'));
        return controller !== undefined;
    };

    /**
     * The places a file the listener already has might be sitting, searched one level deep.
     *
     * Aimed at the netdisk route specifically: the file lands in Downloads, on the Desktop, or in
     * whatever folder the netdisk client made under Documents. Depth one covers
     * "Documents/BaiduNetdiskDownload/..." without turning this into a scan of the whole disk,
     * which would be slow, invasive, and no more likely to find anything.
     */
    const scanRoots = (extraDirs) => [...extraDirs, ...dirs(), getDownloadDir()].filter(Boolean);

    const filesUnder = async (root) => {
        const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
        const files = [];
        for (const entry of entries) {
            const full = path.join(root, entry.name);
            if (entry.isFile()) { files.push(full); continue; }
            if (!entry.isDirectory()) continue;
            const nested = await fsp.readdir(full, { withFileTypes: true }).catch(() => []);
            for (const child of nested) if (child.isFile()) files.push(path.join(full, child.name));
        }
        return files;
    };

    /**
     * Looks for models the listener already has on this machine.
     *
     * Matched by CONTENT, never by name - see the note at the top of this file. Only files whose
     * size is exactly a model's size are hashed, so a scan costs a stat per file plus a hash for
     * the one or two that could possibly be it.
     */
    const scan = async (extraDirs = []) => {
        // Asked per entry rather than off modelsPresent, which answers the different question of
        // whether a FEATURE can run - it reports htdemucs missing when the runtime is missing, and
        // scanning for a file that is already on disk finds nothing and says so, which reads as the
        // scan being broken. The runtime is in this list too: its archive is on the netdisk beside
        // the models, and someone who carried it over deserves the same install-from-disk route.
        const wanted = ENTRIES.filter(entry => entry.supported && !installedPath(entry));
        if (!wanted.length) return { found: [], scanned: 0 };

        const seen = new Set();
        const found = [];
        let scanned = 0;
        for (const root of scanRoots(extraDirs)) {
            const key = path.resolve(root);
            if (seen.has(key)) continue;
            seen.add(key);
            for (const file of await filesUnder(root)) {
                scanned += 1;
                const stat = await fsp.stat(file).catch(() => null);
                if (!stat?.isFile()) continue;
                const model = wanted.find(candidate => candidate.bytes === stat.size);
                if (!model || found.some(hit => hit.name === model.name)) continue;
                if (await hashFile(file).catch(() => null) !== model.sha256) continue;
                found.push({ name: model.name, file: model.file, path: file, bytes: stat.size });
            }
        }
        return { found, scanned };
    };

    /**
     * Copies a verified local file into the models directory. Copy, never move.
     *
     * The listener downloaded it and may well want it again - for another machine, or after they
     * change the model directory. Taking their file away as a side effect of installing it is a
     * surprise, and disk is cheaper than that surprise.
     */
    const installLocal = async (name, source) => {
        const model = modelBy(name);
        if (!model) return { ok: false, reason: `unknown model ${name}` };
        if (!await fileIsModel(source, model)) {
            return { ok: false, reason: 'that file is not this model, or is damaged' };
        }

        const dir = getDownloadDir();
        await fsp.mkdir(dir, { recursive: true });
        const target = path.join(dir, model.file);

        // An archive is unpacked straight out of where the listener already has it. Copying it in
        // first would mean holding two copies of a 60MB zip to produce a directory that needs
        // neither, and `unpack` puts the result behind the same staged rename either way.
        if (model.unpack) {
            const home = path.join(dir, model.unpack);
            try {
                await unpack(source, home);
            } catch (error) {
                return { ok: false, reason: error?.message || String(error) };
            }
            onChanged?.();
            return { ok: true, path: home };
        }

        if (path.resolve(source) === path.resolve(target)) {
            onChanged?.();
            return { ok: true, path: target };
        }

        // Through a `.part` file and a rename, for the same reason the download is: a copy
        // interrupted half way must not be discoverable under the real name.
        const part = `${target}.part`;
        try {
            await fsp.copyFile(source, part);
            await fsp.rename(part, target);
        } catch (error) {
            await fsp.rm(part, { force: true }).catch(() => { });
            return { ok: false, reason: error?.message || String(error) };
        }
        onChanged?.();
        return { ok: true, path: target };
    };

    /**
     * Deletes every copy of every model this app can reach, and says what it could not.
     *
     * Deliberately deletes the RESOLVED path rather than only the download directory. A listener who
     * points the models directory somewhere, fills it, then points it elsewhere expects "delete all" to
     * mean the ones the page is currently reporting as installed - which is what resolveModelFile answers.
     * Deleting only one directory would leave the page still saying 已安装 off a copy somewhere else, a
     * button that visibly did nothing.
     *
     * A copy inside the installer's own resources cannot always be removed - Program Files is read-only
     * for a normal user - so a failure there is reported rather than swallowed. That case is honest either
     * way: the page re-resolves afterwards and goes on saying installed, because it still is.
     *
     * `.part` files go too. They are ours, worth up to 166MB each, and nothing else will ever clean them up.
     */
    const removeAll = async () => {
        const searched = dirs();
        const removed = [];
        const failed = [];
        let freed = 0;

        for (const model of ENTRIES) {
            const target = installedPath(model);
            if (target) {
                try {
                    // The runtime is 1400 files, so this is a tree walk rather than a stat - and
                    // it is what makes the freed figure honest for the biggest item on the page.
                    const size = await sizeOf(target);
                    await fsp.rm(target, { recursive: true, force: true });
                    freed += size;
                    removed.push(model.name);
                } catch (error) {
                    failed.push({ name: model.name, reason: error?.message || String(error) });
                }
            }
            // Any half-finished copy of the same thing, wherever it was being written. The runtime
            // leaves both kinds behind: a partial archive, and a partial extraction directory.
            for (const dir of searched) {
                if (model.file) await fsp.rm(path.join(dir, `${model.file}.part`), { force: true }).catch(() => { });
                if (model.unpack) {
                    await fsp.rm(path.join(dir, `${model.unpack}.part`), { recursive: true, force: true }).catch(() => { });
                    await fsp.rm(path.join(dir, model.file), { force: true }).catch(() => { });
                }
            }
        }

        console.log(
            `[Models] removeAll: deleted ${removed.length} (${Math.round(freed / 1048576)}MB)`
            + `${failed.length ? `, could not delete ${failed.map(f => f.name).join(', ')}` : ''}`,
        );
        if (removed.length > 0) onChanged?.();
        return { ok: failed.length === 0, removed, freed, failed };
    };

    /** What the settings page draws: per entry, whether it is here and where it came from. */
    const status = () => ({
        manual: manifest.manual,
        downloadDir: getDownloadDir(),
        models: ENTRIES.map(model => ({
            name: model.name,
            file: model.file ?? null,
            bytes: model.bytes ?? 0,
            enables: model.enables,
            license: model.license,
            // False only for the runtime, and only on a platform with no build - see the manifest.
            // The page needs the row either way: a machine that cannot run separation should be
            // told so, not left looking for a download button that was never drawn.
            supported: model.supported,
            path: model.supported ? installedPath(model) : null,
            downloading: running.has(model.name),
        })),
    });

    return { download, cancel, scan, installLocal, removeAll, status, MODEL_NAMES };
};

module.exports = { createModelStore, fileIsModel, hashFile };
