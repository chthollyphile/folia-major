import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipSync } from 'fflate';
import {
    IPC, cleanHarness, clearModRecords, confirmMod, fetchModUrl, invoke, launch, modRecord, resetHarness,
    sourceManifest, stateOf, writeMod,
} from './loaderHarness';

// test/unit/mod-system/folium2Files.test.ts
// The files side of Folium 2.0 S2 (dev/folium/folium-2-plan.md §5.4, §13):
//   - the loader reads mod folders with Electron's original-fs (rawFs.cjs), so a dependency archive in a mod
//     folder is the file it is: hashed, signed, installed and measured like any other, whatever its name;
//   - folia-mod:// serves a folium 2 mod's .svg/.png/.webp/.json with nosniff (a folium 1 mod keeps the
//     scripts-only rule), and routes /_media/<name> to the handler its main entry registered, with Range;
//   - the trusted table of the built-in sources names the keys the platforms use today.

const require = createRequire(import.meta.url);
const { pickRawFs } = require('../../../electron/modSystem/rawFs.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');
const { measureDirectoryBytes } = require('../../../electron/modSystem/modFiles.cjs');
const { parseRangeHeader } = require('../../../electron/modSystem/modProtocol.cjs');
const { BUILTIN_SOURCE_TABLE } = require('../../../electron/modSystem/builtinSources.cjs');
const asar = require('@electron/asar') as { createPackage: (src: string, dest: string) => Promise<unknown> };

const ROOT = path.resolve(__dirname, '../../..');

beforeEach(() => {
    resetHarness();
    clearModRecords();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
});

describe('original-fs for mod folders (§13)', () => {
    it('picks original-fs where Electron has it, and the plain fs elsewhere', () => {
        const fake = { original: true };
        expect(pickRawFs((name: string) => (name === 'original-fs' ? fake : fs))).toBe(fake);
        expect(pickRawFs((name: string) => {
            if (name === 'original-fs') throw new Error('Cannot find module');
            return fs;
        })).toBe(fs);
    });

    it('is what the five files that read and write mod folders use', () => {
        for (const file of ['modDigest.cjs', 'modSignature.cjs', 'zipInstall.cjs', 'modFiles.cjs', 'discovery.cjs']) {
            const text = fs.readFileSync(path.join(ROOT, 'electron/modSystem', file), 'utf8');
            expect(text, file).toContain("const { rawFs: fs } = require('./rawFs.cjs');");
            expect(text, file).not.toMatch(/require\('fs'\)/);
        }
    });

    it('hashes, measures and installs a mod folder that holds a real .asar under any name', async () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-asar-'));
        try {
            const packageDir = path.join(work, 'pkg', 'node_modules', 'dep');
            fs.mkdirSync(packageDir, { recursive: true });
            fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = 42;\n');
            const archive = path.join(work, 'deps.3f9a1c.asar');
            await asar.createPackage(path.join(work, 'pkg'), archive);
            const bytes = fs.readFileSync(archive);
            const directory = writeMod('user', sourceManifest('asar-source', ['main']), {
                main: true,
                files: { 'deps.3f9a1c.asar': bytes },
            });
            const digest = computeModDigest(directory);
            expect(digest).toMatch(/^sha256:/);
            // The archive's bytes are in the digest: another archive is another digest.
            fs.writeFileSync(path.join(directory, 'deps.3f9a1c.asar'), Buffer.concat([bytes, Buffer.from([0])]));
            expect(computeModDigest(directory)).not.toBe(digest);
            expect(await measureDirectoryBytes(directory)).toBeGreaterThan(bytes.length);

            // Installed from a zip with the archive inside, then confirmed and run.
            const entries: Record<string, Uint8Array> = {
                'mod.json': Buffer.from(JSON.stringify({ folium: 2, id: 'zipped-source', name: 'z', version: '1.0.0', main: 'index.cjs', client: 'client.mjs', sources: [{ id: 'main', name: 'Z' }] })),
                'index.cjs': Buffer.from('module.exports = () => {};\n'),
                'client.mjs': Buffer.from('export default function activate() {}\n'),
                'deps.3f9a1c.asar': bytes,
            };
            const zipPath = path.join(work, 'mod.zip');
            fs.writeFileSync(zipPath, zipSync(entries));
            launch();
            expect(await invoke(IPC.installZip, zipPath)).toMatchObject({ ok: true, id: 'zipped-source' });
            const installed = path.join(path.dirname(directory), 'zipped-source', 'deps.3f9a1c.asar');
            expect(fs.readFileSync(installed)).toEqual(bytes);
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });
});

describe('folia-mod:// for folium 2 (§4.6, §5.5)', () => {
    it('serves a folium 2 mod\'s images and json with nosniff, and keeps a folium 1 mod to scripts', async () => {
        const source = writeMod('builtin', sourceManifest('radio', ['station']), { files: { 'assets/icon.svg': '<svg/>', 'locales/en.json': '{"a":1}' } });
        const plain = writeMod('user', { id: 'plain' }, { files: { 'icon.png': 'png' } });
        confirmMod(plain, 'plain');
        launch();
        const svg = await fetchModUrl('folia-mod://radio/assets/icon.svg');
        expect(svg.status).toBe(200);
        expect(svg.headers.get('content-type')).toBe('image/svg+xml');
        expect(svg.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await (await fetchModUrl('folia-mod://radio/locales/en.json')).json()).toEqual({ a: 1 });
        expect((await fetchModUrl('folia-mod://plain/icon.png')).status).toBe(403);
        expect((await fetchModUrl('folia-mod://plain/client.mjs')).status).toBe(200);
        expect(fs.existsSync(source)).toBe(true);
    });

    it('routes /_media/<name> to the registered handler, with Range for a file, and 404 or 502 otherwise', async () => {
        const directory = writeMod('builtin', sourceManifest('radio', ['station']), {
            main: `'use strict';
const path = require('path');
module.exports = function activate(api) {
    api.media.serve('audio', (request) => {
        if (request.path === 'missing') return null;
        if (request.path === 'boom') throw new Error('upstream down');
        if (request.path === 'stream') return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'streamed:' + request.query.id };
        return { file: path.join(__dirname, 'track.bin'), contentType: 'audio/mpeg' };
    });
};`,
            files: { 'track.bin': Buffer.from('0123456789') },
        });
        launch();
        const whole = await fetchModUrl('folia-mod://radio/_media/audio/track');
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-type')).toBe('audio/mpeg');
        expect(await whole.text()).toBe('0123456789');
        const part = await fetchModUrl('folia-mod://radio/_media/audio/track', { range: 'bytes=2-4' });
        expect(part.status).toBe(206);
        expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
        expect(await part.text()).toBe('234');
        expect((await fetchModUrl('folia-mod://radio/_media/audio/track', { range: 'bytes=50-' })).status).toBe(416);
        expect(await (await fetchModUrl('folia-mod://radio/_media/audio/stream?id=7')).text()).toBe('streamed:7');
        expect((await fetchModUrl('folia-mod://radio/_media/audio/missing')).status).toBe(404);
        expect((await fetchModUrl('folia-mod://radio/_media/audio/boom')).status).toBe(502);
        expect((await fetchModUrl('folia-mod://radio/_media/video/x')).status).toBe(404);
        // An encoded slash would make one segment hold `..` steps and reach the handler as `x/../../config.json`.
        for (const sneaky of ['x%2F..%2F..%2Fconfig.json', '..%2Fconfig.json', 'a%5C..%5Cb']) {
            expect((await fetchModUrl(`folia-mod://radio/_media/audio/${sneaky}`)).status, sneaky).toBe(400);
        }
        expect(fs.existsSync(directory)).toBe(true);
    });

    it('stops answering a source\'s _media once the source stops', async () => {
        writeMod('builtin', sourceManifest('radio', ['radio']), {
            main: `'use strict';
module.exports = function activate(api) { api.media.serve('audio', () => ({ body: 'x' })); };`,
        });
        const system = launch();
        expect((await fetchModUrl('folia-mod://radio/_media/audio/a')).status).toBe(200);
        await system.setSourceState('folium.radio.radio', 'disabled');
        expect(stateOf(system, 'radio')!.status).toBe('disabled');
        expect((await fetchModUrl('folia-mod://radio/_media/audio/a')).status).toBe(404);
        expect(modRecord('radio')).toBeUndefined();
    });

    it('reads one Range header as the platforms\' players send it', () => {
        expect(parseRangeHeader('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
        expect(parseRangeHeader('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
        expect(parseRangeHeader('bytes=4-100', 10)).toEqual({ start: 4, end: 9 });
        expect(parseRangeHeader('bytes=10-', 10)).toBe('unsatisfiable');
        expect(parseRangeHeader(null, 10)).toBeNull();
        expect(parseRangeHeader('bytes=1-2,4-5', 10)).toBeNull();
    });
});

describe('the trusted table of the built-in sources (§5.1)', () => {
    // The keys are written out in builtinSources.cjs; here they are held to the platforms' own constants.
    const constant = (file: string, name: string) => {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        return new RegExp(`const ${name} = '([^']+)'`).exec(text)?.[1];
    };

    it('names the store keys the platform modules use', () => {
        const expected: Record<string, string[]> = {
            kugou: [constant('electron/kugou/kugouApiBridge.cjs', 'SESSION_KEY')!, constant('electron/kugou/kugouApiBridge.cjs', 'LEGACY_SESSION_KEY')!],
            qq: [constant('electron/qq/qqAuthSessionRepository.cjs', 'SESSION_KEY')!],
            bodian: [constant('sources/bodian/main/session.cjs', 'SESSION_KEY')!, constant('sources/bodian/main/session.cjs', 'DEVICE_KEY')!],
            qishui: [constant('electron/qishui/session.cjs', 'SESSION_KEY')!, constant('electron/qishui/session.cjs', 'DEVICE_KEY')!],
            ytm: [constant('electron/ytm/session.cjs', 'SESSION_KEY')!, constant('electron/ytm/webSignIn.cjs', 'WEB_SESSION_KEY')!],
            spotify: [
                constant('electron/spotify/session.cjs', 'SESSION_KEY')!,
                constant('electron/spotify/soloist.cjs', 'CONFIG_KEY')!,
                constant('electron/spotify/spotifyApiBridge.cjs', 'PLAYBACK_KEY')!,
                constant('electron/spotify/spotifyApiBridge.cjs', 'DEVICE_KEY')!,
            ],
            fnmusic: [constant('electron/fnmusic/fnmusicApiBridge.cjs', 'CONFIG_STORE_KEY')!, constant('electron/fnmusic/fnmusicApiBridge.cjs', 'DEVICE_STORE_KEY')!],
        };
        Object.entries(expected).forEach(([modId, keys]) => {
            expect(BUILTIN_SOURCE_TABLE[modId].storeKeys, modId).toEqual(keys);
        });
        expect(Object.keys(BUILTIN_SOURCE_TABLE)).toEqual(['netease', 'kugou', 'qq', 'bodian', 'qishui', 'ytm', 'spotify', 'apple-music', 'fnmusic']);
    });

    it('names the partitions and userData folders main.cjs gives the platforms', () => {
        const main = fs.readFileSync(path.join(ROOT, 'electron/main.cjs'), 'utf8');
        expect(main).toContain("session.fromPartition('folia-ytm')");
        expect(main).toContain("session.fromPartition('folia-spotify')");
        expect(main).toContain("'qq-auth-state'");
        expect(main).toContain("'ytm-sign-in'");
        expect(main).toContain("'apple-music-companion'");
        expect(main).toContain("'soloist'");
        expect(BUILTIN_SOURCE_TABLE.ytm.partitions).toEqual(['folia-ytm']);
        expect(BUILTIN_SOURCE_TABLE.spotify.partitions).toEqual(['folia-spotify']);
    });
});
