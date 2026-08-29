import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { downloadables, resolveRuntimeDir, RUNTIME_BIN } from '../electron/analysis/modelPaths.cjs';

// build/fetchModels.mjs
// Puts the model weights where a dev checkout expects them, and refuses to hand over a file it
// cannot vouch for.
//
// WHICH files, WHERE from, and what they should hash to all live in shared/modelManifest.json -
// the same file the app reads when a listener downloads them. There is one description of a model
// in this project, because two would eventually disagree and the way they'd tell us is a beat grid
// that is confidently wrong.
//
// The weights are NOT in git: 240MB in an object store that every clone pays for forever, to hold
// files that never change and are downloadable in seconds. What this script is for is a developer
// checkout and a build machine, which is why it writes into the repo's models/.
//
// The hash is the point of this script, not the download; the manifest's own comment says why.

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'models');
const manifest = JSON.parse(await readFile(join(HERE, '..', 'shared', 'modelManifest.json'), 'utf8'));

/**
 * What THIS machine can install. The runtime is a different archive per platform, so a checkout on
 * a Mac and one on Windows want different files - and on a platform with no build there is nothing
 * to fetch, which is a skip rather than a failure.
 *
 * The same function the app resolves with, imported rather than reimplemented: a dev checkout that
 * fetched something other than what the app looks for is the drift this manifest exists to prevent.
 */
const WANTED = downloadables(manifest);

/**
 * How long a mirror gets to START answering. Deliberately NOT a budget for the whole download.
 *
 * It was one total budget of 120s, and that judged a working mirror dead. The first fetch of
 * beat_this landed seconds after it was uploaded, so hf-mirror had to cold-pull 83MB from the
 * origin before it could serve a byte - and the clock was running on the transfer as well as on
 * the wait. It fell through to GitHub, the one route our mainland users cannot use, and said
 * nothing about having done so.
 *
 * "Not answering" and "slow" are different failures, and only the first is worth abandoning a
 * mirror over. So this deadline covers the headers and the transfer gets its own.
 */
const RESPOND_TIMEOUT_MS = 45_000;

/** Backstop for the transfer, sized for 166MB on a bad connection rather than a good one. */
const TRANSFER_TIMEOUT_MS = 15 * 60_000;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const verified = (buffer, model) => buffer.length === model.bytes && sha256(buffer) === model.sha256;

const alreadyThere = async (path, model) => (model.unpack
    // A directory, and its contents were verified as an archive before they were ever unpacked.
    // Re-hashing 1400 loose files to answer "did I already do this" is not worth the disk.
    ? resolveRuntimeDir([MODELS]) !== null
    : existsSync(path) && verified(await readFile(path), model));

const urlsFor = (model) => manifest.mirrors.map(template => template.replace('{file}', model.file));

const reason = (error) => error?.cause?.message || error?.message || String(error);

await mkdir(MODELS, { recursive: true });

for (const model of WANTED) {
    if (!model.supported) {
        console.log(`[models] ${model.name} has no build for this platform, skipping`);
        continue;
    }
    const path = join(MODELS, model.file);
    if (await alreadyThere(path, model)) {
        console.log(`[models] ${model.file} already present and verified`);
        continue;
    }

    console.log(`[models] fetching ${model.file} (${(model.bytes / 1e6).toFixed(0)}MB)`);
    let written = false;
    const skipped = [];

    for (const url of urlsFor(model)) {
        const host = new URL(url).host;
        // Two deadlines on one controller: the first covers the headers, and the moment they
        // arrive it is replaced by the transfer's. `fetch` resolves as soon as the response
        // starts, so clearing it there is what stops a slow-but-working mirror being abandoned.
        const controller = new AbortController();
        let deadline = setTimeout(() => controller.abort(new Error('no response')), RESPOND_TIMEOUT_MS);
        try {
            const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
            clearTimeout(deadline);
            deadline = setTimeout(() => controller.abort(new Error('transfer stalled')), TRANSFER_TIMEOUT_MS);

            if (!response.ok) {
                skipped.push(`${host}: ${response.status} ${response.statusText}`);
                continue;
            }
            const buffer = Buffer.from(await response.arrayBuffer());

            // A mirror that serves the wrong bytes is treated exactly like one that is down: move
            // on. Nothing is written until something verifies, so an interrupted or substituted
            // download never leaves a half-file behind for the next run to package.
            if (!verified(buffer, model)) {
                skipped.push(`${host}: ${buffer.length} bytes, sha256 ${sha256(buffer).slice(0, 12)}`
                    + ` (wanted ${model.bytes}, ${model.sha256.slice(0, 12)})`);
                continue;
            }

            if (model.unpack) {
                // Straight from the buffer: this is a dev checkout, not the app's install path, and
                // the archive is not worth keeping once its 1400 files are on disk. The chmod is the
                // one thing a zip cannot carry, and without it the interpreter will not execute.
                const home = join(MODELS, model.unpack);
                await rm(home, { recursive: true, force: true });
                for (const [name, body] of Object.entries(unzipSync(buffer))) {
                    if (name.endsWith('/')) continue;
                    const out = join(home, name);
                    await mkdir(dirname(out), { recursive: true });
                    await writeFile(out, body);
                }
                if (process.platform !== 'win32') await chmod(join(home, ...RUNTIME_BIN), 0o755);
            } else {
                await writeFile(path, buffer);
            }
            console.log(`[models] ${model.file} verified and written, from ${host}`);
            written = true;
            break;
        } catch (error) {
            skipped.push(`${host}: ${reason(error)}`);
        } finally {
            clearTimeout(deadline);
        }
    }

    // Reported even when a later mirror worked, which is the whole point.
    //
    // These used to be printed only if EVERY route failed, so a successful run looked identical
    // whether the first choice was healthy or dead. The first choice is the only route our
    // mainland users can reach and the last is the only one they cannot, so a silent fallback
    // means the route that matters most can rot while every build goes on saying it is fine.
    for (const failure of skipped) console.warn(`[models]   skipped ${failure}`);

    if (!written) throw new Error(`[models] could not get a good copy of ${model.file}`);
}
