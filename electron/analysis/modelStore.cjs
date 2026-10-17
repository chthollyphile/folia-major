const { createHash } = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { MODEL_NAMES, resolveModelFile, legacyLeftovers } = require('./modelPaths.cjs');

// electron/analysis/modelStore.cjs
// Getting the weights onto the listener's disk: over the network, or off a file they already have.
//
// Both routes end at the same place and pass the same test. A file that arrives by netdisk is verified
// exactly like one we downloaded, because the risk is identical and it is not the kind of risk a human
// carrying the file reduces: a truncated or substituted model does not fail loudly, it loads and answers
// confidently and wrongly. There is no second, laxer trust level here.
//
// The hash is also what makes the local scan work at all. Names are worthless for this - a browser writes
// "beat_this-wgsl (1).bin", a netdisk client appends ".download", some strip the extension - so the scan
// matches on SIZE first (one stat, and a model's byte count is effectively unique) and confirms with sha256.
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

/** sizeOf below, synchronously, for `status`: it only ever walks the leftovers, a handful of files and one old runtime. */
const sizeOfSync = (target) => {
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) return 0;
    if (!stat.isDirectory()) return stat.size;
    return fs.readdirSync(target).reduce((total, name) => total + sizeOfSync(path.join(target, name)), 0);
};

/** Bytes on disk at `target`, which for a leftover Python runtime is a directory of 1400 files. */
const sizeOf = async (target) => {
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of await fsp.readdir(target, { withFileTypes: true })) {
        total += await sizeOf(path.join(target, entry.name));
    }
    return total;
};

const createModelStore = ({ getModelsDirs, getDownloadDir, onProgress, onChanged }) => {
    const dirs = () => (getModelsDirs?.() ?? []).filter(Boolean);

    /**
     * The manifest's models. Read when the store is BUILT rather than when this module is imported: a
     * suite that rewrites the manifest to describe stand-in weights must get those, not whatever was
     * captured the moment something first required this file.
     */
    const ENTRIES = manifest.models.map(entry => ({ ...entry }));

    const modelBy = (name) => ENTRIES.find(entry => entry.name === name) ?? null;

    /** Where this model is installed, or null. */
    const installedPath = (entry) => resolveModelFile(dirs(), entry.name);

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
     * installed, and the runtime would be handed a truncated graph.
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
                    report({ name, status: 'ready', received: model.bytes, total: model.bytes, host: null });
                    onChanged?.();
                    return { ok: true, skipped, path: target };
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
        // Only what is not installed yet: scanning for a file that is already on disk finds nothing and
        // says so, which reads as the scan being broken.
        const wanted = ENTRIES.filter(entry => !installedPath(entry));
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
     * `.part` files go too. They are ours, worth up to 190MB each, and nothing else will ever clean them up.
     * So does what earlier versions installed and this one no longer runs - the ONNX models and the Python
     * runtime (modelPaths.cjs LEGACY_FILES) - which nothing else would ever clean up either.
     */
    const removeAll = async () => {
        const searched = dirs();
        const removed = [];
        const failed = [];
        let freed = 0;

        for (const model of ENTRIES) {
            // Until nothing resolves: a copy can sit in more than one of the directories, and deleting
            // only the first would leave the page saying installed off the other.
            for (let target; (target = installedPath(model));) {
                try {
                    const size = await sizeOf(target);
                    await fsp.rm(target, { recursive: true, force: true });
                    freed += size;
                    if (!removed.includes(model.name)) removed.push(model.name);
                } catch (error) {
                    failed.push({ name: model.name, reason: error?.message || String(error) });
                    break;
                }
            }
            // Any half-finished copy of the same thing, wherever it was being written.
            for (const dir of searched) {
                await fsp.rm(path.join(dir, `${model.file}.part`), { force: true }).catch(() => { });
            }
        }
        // Not reported as `removed`: the page never listed them. They only count toward what was freed.
        for (const leftover of legacyLeftovers(searched)) {
            try {
                // The old runtime is 1400 files, so this is a tree walk rather than a stat - and it is
                // what makes the freed figure honest.
                const size = await sizeOf(leftover);
                await fsp.rm(leftover, { recursive: true, force: true });
                freed += size;
            } catch (error) {
                console.warn(`[Models] could not delete ${leftover}: ${error?.message || error}`);
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
        // Bytes an earlier version installed and this one cannot run (modelPaths.cjs LEGACY_FILES):
        // the page offers "delete all" for them even when no current model is installed, and counts
        // them in what it says that will free.
        leftoverBytes: legacyLeftovers(dirs()).reduce((total, file) => total + sizeOfSync(file), 0),
        models: ENTRIES.map(model => ({
            name: model.name,
            file: model.file,
            bytes: model.bytes,
            enables: model.enables,
            license: model.license,
            path: installedPath(model),
            downloading: running.has(model.name),
        })),
    });

    return { download, cancel, scan, installLocal, removeAll, status, MODEL_NAMES };
};

module.exports = { createModelStore, fileIsModel, hashFile };
