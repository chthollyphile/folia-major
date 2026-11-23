import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mod-system/modMarket.test.ts
// The mod market of the main process (market.cjs): which catalog entries are offered (the site's own links
// only, https elsewhere), the catalog cache (ETag, ten fresh minutes, the last one when offline), and an
// install, which checks the package's SHA-256 and hands the zip installer what the files must be. The
// installer's half of that (zipInstall.cjs `expect`) is checked here too.

const require = createRequire(import.meta.url);
const market = require('../../../electron/modSystem/market.cjs') as {
    CATALOG_FORMAT: string;
    createModMarket: (options: Record<string, unknown>) => {
        getCatalog: (options?: { force?: boolean }) => Promise<Record<string, any>>;
        getReadme: (url: string) => Promise<Record<string, any>>;
        install: (id: string) => Promise<Record<string, any>>;
    };
    feedbackUrlOf: (manifest: unknown) => string | null;
    issuesUrlOf: (repository: unknown) => string | null;
    normalizeCatalog: (raw: unknown, origin: string) => Record<string, any> | null;
    resolveMarketOrigin: (options: { isPackaged: boolean; env?: Record<string, string | undefined> }) => string;
};
const { createZipInstall } = require('../../../electron/modSystem/zipInstall.cjs');
const shared = require('../../../electron/modSystem/foliumShared.json') as { market: { origin: string } };

const ORIGIN = 'https://market.example';
const sha = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex');
const DIGEST = `sha256:${'a'.repeat(64)}`;

const modEntry = (more: Record<string, unknown> = {}) => ({
    id: 'nice-mod',
    name: 'Nice mod',
    version: '1.2.0',
    digest: DIGEST,
    download: { url: '/downloads/nice-mod-1.2.0.zip', sha256: 'b'.repeat(64), size: 100 },
    ...more,
});

const catalogOf = (mods: unknown[], more: Record<string, unknown> = {}) => ({ format: market.CATALOG_FORMAT, version: 3, mods, ...more });

let work: string;
beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-market-test-'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

describe('market origin', () => {
    it('is the shared one in a packaged app, whatever the environment says', () => {
        expect(market.resolveMarketOrigin({ isPackaged: true, env: { FOLIA_MOD_MARKET_ORIGIN: 'http://localhost:4173' } })).toBe(shared.market.origin);
    });

    it('can point a development build at a local site', () => {
        expect(market.resolveMarketOrigin({ isPackaged: false, env: { FOLIA_MOD_MARKET_ORIGIN: 'http://localhost:4173/x' } })).toBe('http://localhost:4173');
        expect(market.resolveMarketOrigin({ isPackaged: false, env: { FOLIA_MOD_MARKET_ORIGIN: 'file:///c:/x' } })).toBe(shared.market.origin);
        expect(market.resolveMarketOrigin({ isPackaged: false, env: {} })).toBe(shared.market.origin);
    });
});

describe('feedback links', () => {
    it.each([
        ['https://github.com/me/mod', 'https://github.com/me/mod/issues'],
        ['https://github.com/me/mod.git', 'https://github.com/me/mod/issues'],
        ['https://github.com/me/mod/tree/main/sub', 'https://github.com/me/mod/issues'],
        ['https://gitlab.com/me/mod', 'https://gitlab.com/me/mod/-/issues'],
        ['https://codeberg.org/me/mod', 'https://codeberg.org/me/mod/issues'],
        ['https://example.com/me/mod', null],
        ['https://github.com/me', null],
        ['http://github.com/me/mod', null],
        [42, null],
    ])('the issues of %s are %s', (repository, issues) => {
        expect(market.issuesUrlOf(repository)).toBe(issues);
    });

    it('takes bugs first, then the repository issues, then the repository itself', () => {
        expect(market.feedbackUrlOf({ bugs: 'https://bugs.example/mod', repository: 'https://github.com/me/mod' })).toBe('https://bugs.example/mod');
        expect(market.feedbackUrlOf({ repository: 'https://github.com/me/mod' })).toBe('https://github.com/me/mod/issues');
        expect(market.feedbackUrlOf({ repository: 'https://git.example/mod' })).toBe('https://git.example/mod');
        expect(market.feedbackUrlOf({ bugs: 'javascript:alert(1)' })).toBeNull();
        expect(market.feedbackUrlOf(null)).toBeNull();
    });
});

describe('reading a catalog', () => {
    it('refuses anything that is not one', () => {
        expect(market.normalizeCatalog({ format: 'other', mods: [] }, ORIGIN)).toBeNull();
        expect(market.normalizeCatalog({ format: market.CATALOG_FORMAT }, ORIGIN)).toBeNull();
        expect(market.normalizeCatalog(null, ORIGIN)).toBeNull();
    });

    it('reads a version 2 catalog with defaults for the newer fields', () => {
        const catalog = market.normalizeCatalog({ format: market.CATALOG_FORMAT, version: 2, mods: [modEntry({ source: 'https://github.com/me/nice-mod' })] }, ORIGIN)!;
        expect(catalog.version).toBe(2);
        expect(catalog.categories).toEqual([]);
        expect(catalog.awesome).toEqual([]);
        const [mod] = catalog.mods;
        expect(mod).toMatchObject({
            id: 'nice-mod', origin: 'community', channel: 'release', kind: 'standard', category: null, tags: [], readmeUrl: null,
            repository: 'https://github.com/me/nice-mod', bugs: 'https://github.com/me/nice-mod/issues',
            page: `${ORIGIN}/#mod-nice-mod`,
        });
        expect(mod.download.url).toBe(`${ORIGIN}/downloads/nice-mod-1.2.0.zip`);
    });

    it('reads the version 3 fields', () => {
        const catalog = market.normalizeCatalog(catalogOf([modEntry({
            origin: 'official', channel: 'beta', kind: 'source', category: 'lyrics', tags: ['node', 'network'],
            readme: '/readmes/nice-mod-1.2.0.md', owners: ['someone', { login: 'other', url: 'https://github.com/other' }, { login: '' }],
            bugs: 'https://bugs.example/nice', preview: { url: '/previews/nice.webp', width: 640, height: 360 },
        })], {
            categories: [{ id: 'lyrics', label: { 'zh-CN': '歌词显示', en: 'Lyrics' } }, { id: 'Bad Id' }],
            awesome: [
                { id: 'outside', name: 'Outside', kind: 'source', url: 'https://github.com/me/outside', owners: ['me'] },
                { id: 'plain', kind: 'weird', url: 'https://example.com/plain' },
                { id: 'insecure', url: 'http://example.com/x' },
                { id: 'outside', url: 'https://github.com/me/again' },
            ],
        }), ORIGIN)!;
        expect(catalog.categories).toEqual([{ id: 'lyrics', label: { 'zh-CN': '歌词显示', en: 'Lyrics' } }]);
        expect(catalog.mods[0]).toMatchObject({
            origin: 'official', channel: 'beta', kind: 'source', category: 'lyrics', tags: ['node', 'network'],
            readmeUrl: `${ORIGIN}/readmes/nice-mod-1.2.0.md`, bugs: 'https://bugs.example/nice',
            owners: [{ login: 'someone', url: null }, { login: 'other', url: 'https://github.com/other' }],
            preview: { url: `${ORIGIN}/previews/nice.webp`, width: 640, height: 360 },
        });
        expect(catalog.awesome.map((entry: { id: string }) => entry.id)).toEqual(['outside', 'plain']);
        expect(catalog.awesome[0]).toMatchObject({ kind: 'source', bugs: 'https://github.com/me/outside/issues' });
        expect(catalog.awesome[1].kind).toBe('other');
    });

    it('drops a mod whose package is not on the site, and keeps other links to the site', () => {
        const catalog = market.normalizeCatalog(catalogOf([
            modEntry({ id: 'elsewhere', download: { url: 'https://evil.example/downloads/x.zip', sha256: 'b'.repeat(64) } }),
            modEntry({ id: 'climbing', download: { url: '/downloads/../catalog.json', sha256: 'b'.repeat(64) } }),
            modEntry({ id: 'no-digest', digest: 'nope' }),
            modEntry({ id: 'bad-version', version: 'latest' }),
            modEntry({ id: 'kept', readme: 'https://evil.example/readmes/x.md', preview: { url: 'https://evil.example/previews/x.png' } }),
            modEntry({ id: 'kept' }),
        ]), ORIGIN)!;
        expect(catalog.mods.map((mod: { id: string }) => mod.id)).toEqual(['kept']);
        expect(catalog.mods[0]).toMatchObject({ readmeUrl: null, preview: null });
    });
});

type FakeResponse = { status: number; ok: boolean; headers: Map<string, string>; body: null; arrayBuffer: () => Promise<ArrayBuffer> };
const respond = (status: number, body: string | Uint8Array = '', headers: Record<string, string> = {}): FakeResponse => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Map(Object.entries(headers)),
        body: null,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
};

describe('the catalog cache', () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    let answer: () => FakeResponse | Promise<FakeResponse>;
    const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        return answer();
    };
    const create = () => market.createModMarket({ origin: ORIGIN, cacheDir: path.join(work, 'mod-market'), fetchImpl, installModFromZip: async () => ({ ok: true }) });

    beforeEach(() => {
        calls.length = 0;
    });

    it('reads once, keeps it fresh for a while, and asks with the ETag after', async () => {
        answer = () => respond(200, JSON.stringify(catalogOf([modEntry()])), { etag: '"v1"' });
        const first = create();
        const read = await first.getCatalog();
        expect(read).toMatchObject({ ok: true, stale: false });
        expect(read.catalog.mods).toHaveLength(1);
        expect(calls).toEqual([{ url: `${ORIGIN}/catalog.json`, headers: {} }]);

        await first.getCatalog();
        expect(calls).toHaveLength(1);

        // A new process reads the kept copy; asked to refresh, it sends the ETag and takes a 304.
        answer = () => respond(304);
        const second = create();
        const again = await second.getCatalog({ force: true });
        expect(calls.at(-1)?.headers).toEqual({ 'if-none-match': '"v1"' });
        expect(again).toMatchObject({ ok: true, stale: false });
        expect(again.catalog.mods[0].id).toBe('nice-mod');
    });

    it('gives the last one, marked stale, when the site cannot be reached', async () => {
        answer = () => respond(200, JSON.stringify(catalogOf([modEntry()])));
        await create().getCatalog();
        answer = () => { throw new Error('getaddrinfo ENOTFOUND'); };
        const offline = await create().getCatalog({ force: true });
        expect(offline).toMatchObject({ ok: true, stale: true });
        expect(offline.error).toMatch(/^market-offline:/);
        expect(offline.catalog.mods).toHaveLength(1);
    });

    it('fails with the reason when there is nothing kept', async () => {
        answer = () => respond(503);
        expect(await create().getCatalog()).toEqual({ ok: false, error: 'market-http:503' });
        answer = () => respond(200, JSON.stringify({ format: 'something-else', mods: [] }));
        expect(await create().getCatalog({ force: true })).toEqual({ ok: false, error: 'market-catalog-format' });
    });

    it('reads a README from the site only, and keeps it', async () => {
        answer = () => respond(200, '# Hello');
        const instance = create();
        expect(await instance.getReadme('https://evil.example/readmes/x.md')).toEqual({ ok: false, error: 'market-readme-url' });
        expect(await instance.getReadme(`${ORIGIN}/downloads/x.md`)).toEqual({ ok: false, error: 'market-readme-url' });
        expect(calls).toHaveLength(0);
        expect(await instance.getReadme(`${ORIGIN}/readmes/nice-mod-1.2.0.md`)).toEqual({ ok: true, text: '# Hello' });
        expect(await instance.getReadme(`${ORIGIN}/readmes/nice-mod-1.2.0.md`)).toEqual({ ok: true, text: '# Hello' });
        expect(calls).toHaveLength(1);
    });
});

describe('installing from the market', () => {
    const zipBytes = new TextEncoder().encode('pretend this is a zip');

    const create = (packageBytes: Uint8Array, installModFromZip: (zipPath: string, options: unknown) => Promise<Record<string, unknown>>) => {
        const progress: Array<Record<string, unknown>> = [];
        const catalog = catalogOf([modEntry({ channel: 'beta', download: { url: '/downloads/nice-mod-1.2.0.zip', sha256: sha(zipBytes), size: zipBytes.length } })]);
        const instance = market.createModMarket({
            origin: ORIGIN,
            cacheDir: path.join(work, 'mod-market'),
            fetchImpl: async (url: string) => (url.endsWith('/catalog.json') ? respond(200, JSON.stringify(catalog)) : respond(200, packageBytes)),
            installModFromZip,
            onProgress: (event: Record<string, unknown>) => progress.push(event),
        });
        return { instance, progress };
    };

    it('hands the installer the checked package and what it must be', async () => {
        const seen: Array<{ zipPath: string; options: unknown; bytes: string }> = [];
        const { instance, progress } = create(zipBytes, async (zipPath, options) => {
            seen.push({ zipPath, options, bytes: fs.readFileSync(zipPath, 'utf8') });
            return { ok: true, id: 'nice-mod', mods: [] };
        });
        expect(await instance.install('nice-mod')).toMatchObject({ ok: true });
        expect(seen).toHaveLength(1);
        expect(seen[0].bytes).toBe('pretend this is a zip');
        expect(seen[0].options).toEqual({ expect: { id: 'nice-mod', version: '1.2.0', digest: DIGEST, channel: 'beta' } });
        expect(fs.existsSync(seen[0].zipPath)).toBe(false);
        expect(progress.map((event) => event.phase)).toEqual(expect.arrayContaining(['download', 'verify', 'install', 'done']));
    });

    it('refuses a package whose checksum is not the catalog\'s', async () => {
        let installed = false;
        const { instance, progress } = create(new TextEncoder().encode('something else'), async () => {
            installed = true;
            return { ok: true };
        });
        expect(await instance.install('nice-mod')).toEqual({ ok: false, error: 'market-checksum-mismatch' });
        expect(installed).toBe(false);
        expect(progress.at(-1)).toMatchObject({ phase: 'error', error: 'market-checksum-mismatch' });
    });

    it('knows only the catalog\'s mods', async () => {
        const { instance } = create(zipBytes, async () => ({ ok: true }));
        expect(await instance.install('missing-mod')).toEqual({ ok: false, error: 'market-mod-not-found' });
        expect(await instance.install('../escape')).toEqual({ ok: false, error: 'market-mod-not-found' });
    });
});

describe('the installer checks what the market expects', () => {
    const writeZip = (manifest: Record<string, unknown>) => {
        const zipPath = path.join(work, `${String(manifest.id)}.zip`);
        fs.writeFileSync(zipPath, zipSync({
            [`${String(manifest.id)}/mod.json`]: strToU8(JSON.stringify(manifest)),
            [`${String(manifest.id)}/client.mjs`]: strToU8('export default () => {};\n'),
        }));
        return zipPath;
    };
    const installer = () => {
        const userData = path.join(work, 'userdata');
        return {
            userData,
            zipInstall: createZipInstall({
                app: { getPath: () => userData },
                isModSystemEnabled: () => true,
                loadAll: async () => [],
                emitLog: () => {},
                serializeError: (error: Error) => error.message,
            }),
        };
    };
    const manifest = { id: 'nice-mod', name: 'Nice mod', version: '1.2.0', folium: 2, folia: '>=0.7.0', client: 'client.mjs' };

    it('installs an unsigned zip from the disk as before', async () => {
        const { zipInstall, userData } = installer();
        expect(await zipInstall.installModFromZip(writeZip(manifest))).toMatchObject({ ok: true, id: 'nice-mod' });
        expect(fs.existsSync(path.join(userData, 'mods', 'nice-mod', 'mod.json'))).toBe(true);
    });

    it('refuses another mod than the expected one', async () => {
        const { zipInstall, userData } = installer();
        const answer = await zipInstall.installModFromZip(writeZip(manifest), { expect: { id: 'other-mod', digest: DIGEST, channel: 'release' } });
        expect(answer).toEqual({ ok: false, error: 'market-id-mismatch' });
        expect(fs.existsSync(path.join(userData, 'mods', 'nice-mod'))).toBe(false);
    });

    it('refuses another version than the catalog announces', async () => {
        const { zipInstall, userData } = installer();
        const answer = await zipInstall.installModFromZip(writeZip(manifest), { expect: { id: 'nice-mod', version: '9.9.9', digest: DIGEST, channel: 'release' } });
        expect(answer).toEqual({ ok: false, error: 'market-version-mismatch' });
        expect(fs.existsSync(path.join(userData, 'mods', 'nice-mod'))).toBe(false);
    });

    it('refuses unsigned files the market said were signed', async () => {
        const { zipInstall, userData } = installer();
        for (const channel of ['release', 'beta']) {
            const answer = await zipInstall.installModFromZip(writeZip(manifest), { expect: { id: 'nice-mod', digest: DIGEST, channel } });
            expect(answer).toEqual({ ok: false, error: 'market-signature:unsigned' });
        }
        expect(fs.existsSync(path.join(userData, 'mods', 'nice-mod'))).toBe(false);
    });
});
