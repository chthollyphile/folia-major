import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import {
    cleanHarness, clearModRecords, dialogAnswer, dialogs, launch, resetHarness, sourceManifest, writeMod,
} from './loaderHarness';

// test/unit/mod-system/folium2Manifest.test.ts
// Manifest v2 (dev/folium/folium-2-plan.md §5.1): `folium` is 1 or 2; `sources`, `locales`, `assets`, `secrets`,
// `contexts`, `native` (and `sources[].claims`, `keepForMatching`) are for 2 only; a folium 1 manifest reads
// exactly as in 1.9. The enable confirmation of a third-party source mod says what it provides (§5.2).

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');

const base = { id: 'radio', name: 'Radio', version: '1.0.0', client: 'client.mjs' };
const v2 = (extra: Record<string, unknown>) => validateManifest({ ...base, folium: 2, ...extra });
const errorsOf = (extra: Record<string, unknown>) => v2(extra).errors ?? [];

describe('folium versions', () => {
    it('reads 1 and 2, nothing else', () => {
        expect(validateManifest({ ...base, folium: 1 }).ok).toBe(true);
        expect(validateManifest({ ...base, folium: 2 }).ok).toBe(true);
        expect(validateManifest({ ...base, folium: 3 }).ok).toBe(false);
        expect(validateManifest({ ...base, folium: '2' }).ok).toBe(false);
    });

    it('refuses every folium 2 field on a folium 1 manifest, and keeps its 1.9 reading otherwise', () => {
        for (const field of ['sources', 'locales', 'assets', 'secrets', 'contexts', 'native']) {
            expect(validateManifest({ ...base, folium: 1, [field]: ['x'] }).errors, field).toEqual([`"${field}" needs "folium": 2`]);
        }
        expect(validateManifest({ ...base, folium: 1 }).value).toMatchObject({ sources: null, secrets: null, contexts: null });
    });
});

describe('sources', () => {
    it('takes ids, names (one string or one per language), requires, keepForMatching and claims', () => {
        expect(v2({
            sources: [
                { id: 'station', name: { en: 'Station', 'zh-CN': '电台' }, requires: ['search@1'], keepForMatching: true },
                { id: 'appleMusic', name: 'Apple', claims: { id: 'appleMusic', storeKeys: ['A_KEY'], partitions: ['persist:a'], userDataDirs: ['a-dir'] } },
            ],
        }).ok).toBe(true);
    });

    it('refuses an empty list, a missing client, bad and repeated ids, bad names and unknown fields', () => {
        expect(errorsOf({ sources: [] })).toEqual(['mod.sources must list at least one source; a mod without sources leaves the field out']);
        expect(validateManifest({ ...base, client: undefined, main: 'index.cjs', folium: 2, sources: [{ id: 'a', name: 'A' }] }).errors)
            .toContain('a source mod needs a "client" entry: its sources are registered there');
        expect(errorsOf({ sources: [{ id: 'a b', name: 'A' }] })[0]).toContain('sources[0].id must match');
        expect(errorsOf({ sources: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] })).toEqual(['sources[1].id "a" is listed twice']);
        expect(errorsOf({ sources: [{ id: 'a', name: '' }] })[0]).toContain('sources[0].name');
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', extra: 1 }] })).toEqual(['sources[0] has an unknown field "extra"']);
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', keepForMatching: 'yes' }] })).toEqual(['sources[0].keepForMatching must be true or false']);
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', certificateExceptions: ['not a host'] }] })).toEqual(['sources[0].certificateExceptions must be a list of host names']);
    });

    it('checks claims field by field', () => {
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', claims: { storeKeys: [] } }] })).toEqual(['sources[0].claims.id must be the short source id it takes over']);
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', claims: { id: 'qq', userDataDirs: ['../up'] } }] })).toEqual(['sources[0].claims.userDataDirs must be a list where each entry is a folder name under userData']);
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', claims: { id: 'qq', storeKeys: ['K', 'K'] } }] })).toEqual(['sources[0].claims.storeKeys lists an entry twice']);
        expect(errorsOf({ sources: [{ id: 'a', name: 'A', claims: { id: 'qq', other: [] } }] })).toEqual(['sources[0].claims has an unknown field "other"']);
    });
});

describe('the other folium 2 fields', () => {
    it('locales and assets are folders inside the mod', () => {
        expect(v2({ locales: 'locales', assets: 'assets/img' }).ok).toBe(true);
        expect(errorsOf({ locales: '../x' })).toEqual(['mod.locales must be a relative folder path inside the mod directory']);
    });

    it('secrets are at most 64 distinct key names', () => {
        expect(v2({ secrets: ['token', 'refresh.token'] }).ok).toBe(true);
        expect(errorsOf({ secrets: Array.from({ length: 65 }, (_, index) => `k${index}`) })).toEqual(['mod.secrets has at most 64 keys']);
        expect(errorsOf({ secrets: ['a', 'a'] })).toEqual(['mod.secrets lists a key twice']);
    });

    it('contexts are main and export; a source mod\'s client never runs in the export window', () => {
        expect(v2({ contexts: ['main'] }).ok).toBe(true);
        expect(errorsOf({ contexts: ['remote'] })).toEqual(['mod.contexts must list where the client runs: "main", "export"']);
        expect(errorsOf({ contexts: ['main', 'export'], sources: [{ id: 'a', name: 'A' }] }))
            .toEqual(['a source mod\'s client never runs in the export window; leave "export" out of mod.contexts']);
    });

    it('native names are short ids', () => {
        expect(v2({ native: ['librespot'] }).ok).toBe(true);
        expect(errorsOf({ native: ['../lib.node'] })[0]).toContain('mod.native must be a list of names');
    });
});

describe('the enable confirmation of a third-party source mod (§5.2)', () => {
    beforeEach(() => {
        resetHarness();
        clearModRecords();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
    });
    afterEach(() => {
        cleanHarness();
        vi.restoreAllMocks();
    });

    it('says which sources it provides, that it keeps sign-ins, is outside the limits and starts with the app', async () => {
        writeMod('user', sourceManifest('radio', [{ id: 'station', name: 'Station' }]), { main: true });
        const system = launch();
        dialogAnswer.response = 1;
        expect(await system.setModEnabled('radio', true)).toMatchObject({ ok: true });
        const detail = dialogs.at(-1)!.detail!;
        expect(detail).toContain('This mod provides music sources: Station (folium.radio.station).');
        expect(detail).toContain('keeps your sign-in on these platforms');
        expect(detail).toContain('Signature: none');
        expect(detail).not.toContain('takes over');
    });

    it('adds nothing to an ordinary mod\'s confirmation', async () => {
        writeMod('user', { id: 'plain' }, { main: true });
        const system = launch();
        await system.setModEnabled('plain', true);
        expect(dialogs.at(-1)!.detail).not.toContain('music sources');
    });
});
