import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    IPC, cleanHarness, clearModRecords, confirmMod, invoke, launch, modRecord, resetHarness, sourceManifest, stateOf, writeMod,
} from './loaderHarness';
import { checkFoliumMod } from '../../../dev/folium/check.mjs';

// test/unit/mod-system/folium2SourceContract.test.ts
// The main process's half of Folium 2.0 S3: the version each track of mods reads (plan §9), the negotiation of
// `sources[].requires` against the capabilities this host implements (plan §4.1), and the source exemptions a
// running copy loses when its client registered none of the sources it declares (plan §5.2). And folium:check's
// look at a source mod.

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');

beforeEach(() => {
    resetHarness();
    clearModRecords();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
});

describe('the Folium version a main entry reads', () => {
    it('is 1.9 for a folium 1 mod and 2.0 for a folium 2 mod', () => {
        confirmMod(writeMod('user', { id: 'old' }, { main: true }), 'old');
        confirmMod(writeMod('user', sourceManifest('radio', ['station']), { main: true }), 'radio');
        launch();
        expect((modRecord('old')!.api.host as { folium: unknown }).folium).toEqual({ major: 1, minor: 9 });
        expect((modRecord('radio')!.api.host as { folium: unknown }).folium).toEqual({ major: 2, minor: 0 });
    });
});

describe('sources[].requires', () => {
    const base = { folium: 2, id: 'radio', name: 'Radio', version: '1.0.0', client: 'client.mjs' };
    const withRequires = (requires: string[]) => validateManifest({ ...base, sources: [{ id: 'station', name: 'S', requires }] });

    it('takes the capabilities this host implements', () => {
        expect(withRequires(['search@1', 'songs@1', 'playback.audio@1', 'lyrics@1', 'covers@1', 'raw@1']).ok).toBe(true);
    });

    it('refuses one it does not implement, rather than running pretending', () => {
        expect(withRequires(['search@2']).errors).toEqual(['sources[0].requires "search@2": this host does not implement it']);
        expect(withRequires(['playback.surface@1']).errors).toEqual(['sources[0].requires "playback.surface@1": this host does not implement it']);
        expect(withRequires(['comments@1']).errors).toEqual(['sources[0].requires "comments@1": this host does not implement it']);
        expect(withRequires(['x.other.comments@1']).errors).toEqual(['sources[0].requires "x.other.comments@1": a custom capability is another mod\'s, not the host\'s to provide']);
    });
});

describe('a source mod whose client registered none of its sources', () => {
    it('loses the exemptions of that running copy: net.fetch, the data file and the secret slots', async () => {
        confirmMod(writeMod('user', sourceManifest('radio', ['station'], { secrets: ['token'] }), { main: true }), 'radio');
        const system = launch();
        expect(stateOf(system, 'radio')?.status).toBe('loaded');
        expect(await invoke(IPC.storage, 'radio', 'set', 'k', 1)).toEqual({ ok: true, result: null });
        const url = system.listMods().find((mod) => mod.id === 'radio')!.clientUrl;
        expect(await invoke(IPC.sourcesRegistered, 'radio', ['station'], url)).toEqual({ ok: true, revoked: false });
        // A report of a copy replaced meanwhile (another content tag) is not the running copy's.
        expect(await invoke(IPC.sourcesRegistered, 'radio', [], 'folia-mod://radio/client.mjs?v=old')).toEqual({ ok: false, error: 'stale-copy' });
        expect(await invoke(IPC.storage, 'radio', 'get', 'k')).toEqual({ ok: true, result: 1 });
        expect(await invoke(IPC.sourcesRegistered, 'radio', [], url)).toEqual({ ok: true, revoked: true });
        expect(await invoke(IPC.storage, 'radio', 'get', 'k')).toEqual({ ok: false, error: 'permission-denied:filesystem.data' });
        expect(await invoke(IPC.netFetch, 'radio', 'https://example.com/a', {})).toEqual({ ok: false, error: 'permission-denied:net.fetch' });
        expect(await invoke(IPC.secrets, 'radio', 'set', 'token', 'x')).toMatchObject({ ok: false });
    });

    it('is told only of a source mod', async () => {
        confirmMod(writeMod('user', { id: 'plain' }, { main: true }), 'plain');
        launch();
        expect(await invoke(IPC.sourcesRegistered, 'plain', [])).toEqual({ ok: false, error: 'mod-not-a-source-mod' });
        expect(await invoke(IPC.sourcesRegistered, 'nobody', [])).toEqual({ ok: false, error: 'mod-not-a-source-mod' });
    });
});

describe('folium:check of a source mod', () => {
    const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'folium-check-'));
    let made: string[] = [];
    afterEach(() => {
        made.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
        made = [];
    });
    const write = (manifest: Record<string, unknown>, client: string) => {
        const directory = path.join(root(), String(manifest.id));
        made.push(path.dirname(directory));
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({ name: 'x', version: '1.0.0', client: 'client.mjs', ...manifest }));
        fs.writeFileSync(path.join(directory, 'client.mjs'), client);
        return directory;
    };

    it('needs no net.fetch or filesystem.data, and wants each declared source registered', () => {
        const good = write(
            { folium: 2, id: 'radio', sources: [{ id: 'station', name: 'S' }] },
            "export default function activate(folium) {\n  folium.storage.set('a', 1);\n  folium.net.fetch('https://example.com');\n  folium.sources.register({ id: 'station', displayName: 'S', capabilities: { 'search@1': {} } });\n}\n",
        );
        expect(checkFoliumMod(good).problems).toEqual([]);
        const missing = write(
            { folium: 2, id: 'radio', sources: [{ id: 'station', name: 'S' }, { id: 'other', name: 'O' }] },
            "export default function activate(folium) {\n  folium.sources.register({ id: 'station', displayName: 'S', capabilities: {} });\n}\n",
        );
        expect(checkFoliumMod(missing).problems).toEqual([
            'mod.json declares the source "other" and the client never names it: register it with folium.sources.register({ id: \'other\', … })',
        ]);
        const none = write({ folium: 2, id: 'radio', sources: [{ id: 'station', name: 'S' }] }, 'export default function activate() {}\n');
        expect(checkFoliumMod(none).problems[0]).toMatch(/never calls folium\.sources\.register/);
    });

    it('names a capability this host leaves out, and a custom one of another mod', () => {
        const directory = write(
            { folium: 2, id: 'radio', sources: [{ id: 'station', name: 'S' }] },
            "export default function activate(folium) {\n  folium.sources.register({ id: 'station', displayName: 'S', capabilities: { 'playback.surface@1': {}, 'x.other.y@1': {} } });\n}\n",
        );
        const { problems, notes } = checkFoliumMod(directory);
        expect(problems).toEqual([]);
        expect(notes.some((note: string) => note.includes('capability "x.other.y@1" is another mod\'s'))).toBe(true);
        expect(notes.some((note: string) => note.includes('capability "playback.surface@1": this host does not implement it'))).toBe(true);
        const badOwn = write(
            { folium: 2, id: 'radio', sources: [{ id: 'station', name: 'S' }] },
            "export default function activate(folium) {\n  folium.sources.register({ id: 'station', displayName: 'S', capabilities: { 'x.radio.Bad Name@1': {} } });\n}\n",
        );
        expect(checkFoliumMod(badOwn).problems).toEqual(['capability "x.radio.Bad Name@1": a custom capability of this mod is named x.radio.<name>@<version>']);
        // An aliased call is not taken for no call at all.
        const aliased = write(
            { folium: 2, id: 'radio', sources: [{ id: 'station', name: 'S' }] },
            "export default function activate(folium) {\n  const s = folium.sources;\n  s.register({ id: 'station', displayName: 'S', capabilities: {} });\n}\n",
        );
        expect(checkFoliumMod(aliased).problems).toEqual([]);
    });

    it('keeps the ordinary limits and refuses Folium 2 members to a folium 1 mod', () => {
        const plain = write({ folium: 2, id: 'plain' }, "export default function activate(folium) {\n  folium.net.fetch('https://example.com');\n  folium.sources.register({});\n}\n");
        expect(checkFoliumMod(plain).problems).toEqual([
            'folium.sources.register is for a source mod: declare the sources under "sources" in mod.json',
            'folium.net.fetch needs the permission "net.fetch" in mod.json',
        ]);
        const old = write({ folium: 1, id: 'old' }, "export default function activate(folium) {\n  folium.i18n.key('a');\n}\n");
        expect(checkFoliumMod(old).problems).toEqual(['folium.i18n is Folium 2: mod.json says "folium": 1, and such a mod has none']);
        const oldHelpers = write({ folium: 1, id: 'old-helpers' }, "export default function activate(folium) {\n  folium.lyrics.isPureMusicText('x');\n  folium.omni?.capability('a', 'b');\n  folium.lyrics.parse;\n}\n");
        expect(checkFoliumMod(oldHelpers).problems).toEqual([
            'folium.lyrics.isPureMusicText is Folium 2: mod.json says "folium": 1, and such a mod has none',
            'folium.omni.capability is Folium 2: mod.json says "folium": 1, and such a mod has none',
        ]);
        const empty = write({ folium: 2, id: 'empty', sources: [] }, 'export default function activate() {}\n');
        expect(checkFoliumMod(empty).problems[0]).toMatch(/mod\.sources must list at least one source/);
    });
});
