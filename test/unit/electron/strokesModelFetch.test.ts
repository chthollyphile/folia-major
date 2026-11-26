import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/strokesModelFetch.test.ts
// Pinned on-demand download of the stroke weights: mirror fallback, size/hash checks, dedupe, atomic rename.

const require = createRequire(import.meta.url);
const { ensureStrokesModel, STROKES_MODELS } = require('../../../electron/analysis/strokesModelFetch.cjs');
const { LEGACY_FILES, MODEL_FILES } = require('../../../electron/analysis/modelPaths.cjs');

const body = Buffer.from('stroke-weights-body');
const spec = STROKES_MODELS.strokes_own2;
const original = { bytes: spec.bytes, sha256: spec.sha256 };
const MIRRORS = ['https://a.test/r', 'https://b.test/r'];
const okResponse = (data: Buffer) => new Response(new Uint8Array(data), { status: 200 });

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'strokes-fetch-'));
    spec.bytes = body.length;
    spec.sha256 = createHash('sha256').update(body).digest('hex');
});
afterEach(() => {
    Object.assign(spec, original);
    rmSync(dir, { recursive: true, force: true });
});

const opts = (fetchImpl: unknown) => ({ fetchImpl, mirrors: MIRRORS, log: () => {} });

describe('ensureStrokesModel', () => {
    it('downloads, verifies and renames into place with no temp file left', async () => {
        const fetchImpl = vi.fn(async () => okResponse(body));
        const file = await ensureStrokesModel('strokes_own2', dir, opts(fetchImpl));
        expect(file).toBe(path.join(dir, spec.fileName));
        expect(readFileSync(file)).toEqual(body);
        expect(readdirSync(dir)).toEqual([spec.fileName]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('falls to the next mirror on a hash mismatch and leaves nothing from the bad one', async () => {
        const bad = Buffer.alloc(body.length, 1);
        const fetchImpl = vi.fn(async (url: string) => okResponse(url.startsWith('https://a.test') ? bad : body));
        const file = await ensureStrokesModel('strokes_own2', dir, opts(fetchImpl));
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(readFileSync(file)).toEqual(body);
        expect(readdirSync(dir)).toEqual([spec.fileName]);
    });

    it('rejects a size mismatch and an HTTP error on every mirror, creating no final file', async () => {
        const fetchImpl = vi.fn(async (url: string) => url.startsWith('https://a.test')
            ? okResponse(Buffer.concat([body, Buffer.from('x')])) : new Response('no', { status: 404 }));
        await expect(ensureStrokesModel('strokes_own2', dir, opts(fetchImpl))).rejects.toThrow(/size .*HTTP 404/s);
        expect(existsSync(path.join(dir, spec.fileName))).toBe(false);
        expect(readdirSync(dir)).toEqual([]);
    });

    it('shares one download between concurrent requests', async () => {
        const fetchImpl = vi.fn(async () => okResponse(body));
        const [a, b] = await Promise.all([
            ensureStrokesModel('strokes_own2', dir, opts(fetchImpl)),
            ensureStrokesModel('strokes_own2', dir, opts(fetchImpl)),
        ]);
        expect(a).toBe(b);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown name', async () => {
        await expect(ensureStrokesModel('nope', dir, opts(vi.fn()))).rejects.toThrow(/unknown/);
    });
});

describe('stroke models vs legacy cleanup', () => {
    it('are never swept as legacy files', () => {
        for (const { fileName } of Object.values(STROKES_MODELS) as { fileName: string }[]) expect(LEGACY_FILES).not.toContain(fileName);
        expect(MODEL_FILES.strokes_full6).toBe(STROKES_MODELS.strokes_full6.fileName);
        expect(MODEL_FILES.strokes_own2).toBe(STROKES_MODELS.strokes_own2.fileName);
    });
});
