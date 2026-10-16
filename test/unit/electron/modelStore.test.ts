import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// test/unit/electron/modelStore.test.ts
// The two ways weights reach a listener - downloaded, or found on their own disk - and the one rule
// both obey: nothing lands under the real filename until its sha256 matches. A truncated or
// substituted model does not fail loudly; it loads and answers confidently and wrongly, which for a
// beat grid means every transition is off the beat with nothing in the log to say why.
//
// Run against a real local HTTP server rather than a mocked fetch, because everything worth testing
// here is something a mock would have to be TOLD to do: 404, serve the wrong bytes, work. A mock
// that returns what I told it to return proves only that I can write a mock.

const require = createRequire(import.meta.url);
const { createModelStore } = require('../../../electron/analysis/modelStore.cjs');
const manifest = require('../../../shared/modelManifest.json');
const { LEGACY_RUNTIME_BIN } = require('../../../electron/analysis/modelPaths.cjs');

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

// Stand-in weights. Small on purpose - the real 41MB would make this suite slow to prove nothing
// extra, since every rule under test is about bytes matching a hash, not about how many there are.
const goodBytes = Buffer.alloc(4096, 7);
const wrongBytes = Buffer.alloc(4096, 9);

const model = manifest.models[0];

let root: string;
let downloadDir: string;
let elsewhere: string;
let server: Server;
/** What each mirror path should do on the next request, so one server covers every behaviour. */
let serve: Record<string, 'good' | 'wrong' | 'missing'>;

const makeStore = (overrides: Record<string, unknown> = {}) => createModelStore({
    getModelsDirs: () => [downloadDir],
    getDownloadDir: () => downloadDir,
    ...overrides,
});

beforeAll(async () => {
    // The manifest describes the real weights; this rewrites the loaded copy to describe the
    // stand-ins, so the store is tested against a manifest of exactly the shape it reads in
    // production - one whose hash and size are simply the ones the server will really send.
    manifest.models.length = 1;
    model.bytes = goodBytes.length;
    model.sha256 = sha256(goodBytes);

    server = createServer((request, response) => {
        const mode = serve[request.url?.split('/')[1] ?? ''] ?? 'missing';
        if (mode === 'missing') { response.writeHead(404); response.end(); return; }
        const body = mode !== 'good' ? wrongBytes : goodBytes;
        response.writeHead(200, { 'content-length': String(body.length) });
        response.end(body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    manifest.mirrors = [
        `http://127.0.0.1:${port}/down/{file}`,
        `http://127.0.0.1:${port}/up/{file}`,
    ];
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'folia-store-'));
    downloadDir = path.join(root, 'models');
    elsewhere = path.join(root, 'Downloads');
    mkdirSync(downloadDir);
    mkdirSync(elsewhere);
    serve = { down: 'missing', up: 'missing' };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const installed = () => path.join(downloadDir, model.file);

describe('downloading a model', () => {
    it('writes it once the hash matches, and reports finishing', async () => {
        serve = { down: 'good', up: 'good' };
        const progress: Array<Record<string, unknown>> = [];
        const store = makeStore({ onProgress: (event: Record<string, unknown>) => progress.push(event) });

        const result = await store.download(model.name);

        expect(result.ok).toBe(true);
        expect(sha256(readFileSync(installed()))).toBe(model.sha256);
        expect(progress.at(-1)).toMatchObject({ name: model.name, status: 'ready' });
    });

    // The whole reason there is a list of mirrors rather than a URL.
    it('falls through to the next mirror when the first is down', async () => {
        serve = { down: 'missing', up: 'good' };

        const result = await makeStore().download(model.name);

        expect(result.ok).toBe(true);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('404');
    });

    // A mirror is a host we do not control, which is the entire reason the hash exists. Serving the
    // wrong bytes must be treated exactly like being down: move on, and leave nothing behind.
    it('rejects a mirror that serves the wrong bytes and keeps looking', async () => {
        serve = { down: 'wrong', up: 'good' };

        const result = await makeStore().download(model.name);

        expect(result.ok).toBe(true);
        expect(result.skipped[0]).toContain('sha256');
        expect(sha256(readFileSync(installed()))).toBe(model.sha256);
    });

    it('leaves nothing behind when every mirror fails, not even a partial file', async () => {
        serve = { down: 'wrong', up: 'wrong' };

        const result = await makeStore().download(model.name);

        expect(result.ok).toBe(false);
        expect(result.skipped).toHaveLength(2);
        // Not under the real name, and not as a .part either: resolveModelFile would find the
        // first and report the model installed, handing the runtime a truncated graph.
        expect(readdirSync(downloadDir)).toEqual([]);
    });

});

describe('finding a model already on the machine', () => {
    // The netdisk route in one test. Browsers and netdisk clients rename downloads, so matching on
    // filename would miss the exact case this feature exists for.
    it('recognises the weights under a completely different name', async () => {
        writeFileSync(path.join(elsewhere, 'beat_this-wgsl (1).bin.download'), goodBytes);

        const { found } = await makeStore().scan([elsewhere]);

        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ name: model.name });
        expect(path.basename(found[0].path)).toBe('beat_this-wgsl (1).bin.download');
    });

    it('is not fooled by a wrong file wearing the right name', async () => {
        writeFileSync(path.join(elsewhere, model.file), wrongBytes);

        expect((await makeStore().scan([elsewhere])).found).toEqual([]);
    });

    it('looks one level down, which is where a netdisk client puts things', async () => {
        const nested = path.join(elsewhere, 'BaiduNetdiskDownload');
        mkdirSync(nested);
        writeFileSync(path.join(nested, 'anything.bin'), goodBytes);

        expect((await makeStore().scan([elsewhere])).found).toHaveLength(1);
    });

    it('installs by copying, so the listener keeps their own download', async () => {
        const source = path.join(elsewhere, 'downloaded.bin');
        writeFileSync(source, goodBytes);

        const result = await makeStore().installLocal(model.name, source);

        expect(result.ok).toBe(true);
        expect(existsSync(source)).toBe(true);
        expect(sha256(readFileSync(installed()))).toBe(model.sha256);
    });

    it('refuses to install a file that is not this model', async () => {
        const source = path.join(elsewhere, 'wrong.bin');
        writeFileSync(source, wrongBytes);

        const result = await makeStore().installLocal(model.name, source);

        expect(result.ok).toBe(false);
        expect(readdirSync(downloadDir)).toEqual([]);
    });

    // Nothing missing, so nothing is walked - not one stat.
    it('does not go looking once everything is already installed', async () => {
        writeFileSync(installed(), goodBytes);
        writeFileSync(path.join(elsewhere, 'spare.bin'), goodBytes);

        expect(await makeStore().scan([elsewhere])).toEqual({ found: [], scanned: 0 });
    });

    it('deletes the resolved copy wherever it is, not just the download directory', async () => {
        // The listener pointed the models directory somewhere, filled it, then pointed it back.
        // "Delete all" has to mean the copies the page is CURRENTLY reporting as installed.
        writeFileSync(path.join(elsewhere, model.file), goodBytes);
        const store = makeStore({ getModelsDirs: () => [downloadDir, elsewhere] });

        const result = await store.removeAll();

        expect(result.ok).toBe(true);
        expect(result.removed).toEqual([model.name]);
        expect(result.freed).toBe(goodBytes.length);
        expect(existsSync(path.join(elsewhere, model.file))).toBe(false);
    });

    // What an earlier version installed and this one cannot run: nothing resolves it, so nothing else
    // would ever delete it. Freed, but not listed as a removed model - the page never showed it as one.
    it('deletes an earlier version\'s models and Python runtime too', async () => {
        writeFileSync(installed(), goodBytes);
        writeFileSync(path.join(downloadDir, 'beat_this.onnx'), goodBytes);
        writeFileSync(path.join(downloadDir, 'htdemucs-v2.onnx'), goodBytes);
        const exe = path.join(downloadDir, 'runtime', ...LEGACY_RUNTIME_BIN);
        mkdirSync(path.dirname(exe), { recursive: true });
        writeFileSync(exe, goodBytes);
        expect(makeStore().status().leftoverBytes).toBe(3 * goodBytes.length);

        const result = await makeStore().removeAll();

        expect(result.removed).toEqual([model.name]);
        expect(result.freed).toBe(4 * goodBytes.length);
        expect(readdirSync(downloadDir)).toEqual([]);
        expect(makeStore().status().leftoverBytes).toBe(0);
    });

    it('sweeps up half-finished downloads, which nothing else ever would', async () => {
        writeFileSync(installed(), goodBytes);
        const part = `${installed()}.part`;
        writeFileSync(part, goodBytes.subarray(0, 100));

        await makeStore().removeAll();

        expect(existsSync(part)).toBe(false);
        expect(readdirSync(downloadDir)).toEqual([]);
    });

    it('is a no-op that still succeeds when nothing is installed', async () => {
        const result = await makeStore().removeAll();

        expect(result).toMatchObject({ ok: true, removed: [], freed: 0, failed: [] });
    });

    // NOT covered: the `failed` branch, where a copy cannot be deleted - in production that is a
    // weight inside the installer's own read-only directory. There is no way to provoke it here.
    // On this platform `fsp.rm` clears the read-only attribute itself and deletes through an open
    // handle, both verified, and a directory under the model's filename is never resolved as
    // installed in the first place (resolveModelFile uses isFile). Faking it would mean mocking
    // fs/promises out from under the tests above that depend on it being the real one.
});
