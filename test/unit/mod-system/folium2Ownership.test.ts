import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import {
    cleanHarness, clearModRecords, computeModDigest, confirmMod, dialogAnswer, dialogs, launch, modRecord, persisted,
    resetHarness, sourceManifest, stateOf, writeAppPackage, writeMod,
} from './loaderHarness';

// test/unit/mod-system/folium2Ownership.test.ts
// Who runs under which source id (dev/folium/folium-2-plan.md §5.1): the override of a built-in copy, and the
// compliance plan's takeover of a source the installation does not carry, with each of its six points:
//   1. the installation declares what it carries (`foliaBundledSources`; without it, all nine);
//   2. a source it does not carry is taken over by `sources[].claims`, unsigned and at any version;
//   3. a signature that does not match may not take over: the source runs under the mod's own id;
//   4. one short id goes to one mod: the first confirmed holds it;
//   5. declared but missing from the built-in folder is a broken installation: nothing may claim it;
//   6. once the installation carries it again, the built-in copy wins and the claim is an override again.

const require = createRequire(import.meta.url);
const { resolveSourceOwnership } = require('../../../electron/modSystem/sourceOwnership.cjs');
const { builtinSourceRow, builtinModOfSource, readBundledSources, BUILTIN_SOURCE_IDS } = require('../../../electron/modSystem/builtinSources.cjs');

type Row = { storeKeys: string[]; partitions: string[]; userDataDirs: string[] };
const sourceRow = (shortId: string): Row | null => builtinSourceRow(builtinModOfSource(shortId));
/* A claim that says again what the trusted row of `shortId` says (plan §5.1). */
const rowClaims = (shortId: string) => {
    const row = sourceRow(shortId);
    return { id: shortId, storeKeys: row?.storeKeys ?? [], partitions: row?.partitions ?? [], userDataDirs: row?.userDataDirs ?? [] };
};

type Copy = { manifest: Record<string, unknown> & { id: string; version: string }; dirPath: string; digest?: string; signature?: { status: string }; enabled?: boolean };

const manifestOf = (id: string, sources: Array<Record<string, unknown>>, version = '1.0.0') => ({ id, version, folium: 2, sources });
const builtin = (id: string, version = '1.0.0'): Copy => ({ manifest: manifestOf(id, [{ id: builtinSourceRow(id)?.sources[0] ?? id, name: id }], version), dirPath: `/b/${id}` });
const candidate = (id: string, { version = '2.0.0', status = 'unsigned', enabled = true, claims = null as string | null, sources = null as Array<Record<string, unknown>> | null } = {}): Copy => ({
    manifest: manifestOf(id, sources ?? [{ id: claims ? 'main' : (builtinSourceRow(id)?.sources[0] ?? 'main'), name: id, ...(claims ? { claims: rowClaims(claims) } : {}) }], version),
    dirPath: `/u/${id}`,
    digest: `sha256:${id}`,
    signature: { status },
    enabled,
});

const resolve = (
    builtins: Copy[],
    candidates: Copy[],
    { bundled = BUILTIN_SOURCE_IDS as string[], confirmed = [] as string[], claims = {} as Record<string, string>, hostVersion = '0.8.0' } = {},
) => resolveSourceOwnership(
    new Map(builtins.map((copy) => [copy.manifest.id, copy])),
    new Map(candidates.map((copy) => [copy.manifest.id, copy])),
    bundled,
    {
        hostVersion,
        tableRow: builtinSourceRow,
        sourceRow,
        isOverrideConfirmed: (modId: string) => confirmed.includes(modId),
        claimRecord: (shortId: string) => claims[shortId] ?? null,
    },
);

describe('the override of a built-in copy (pure rules)', () => {
    it('replaces it only when signed, newer, in range and confirmed; says why otherwise', () => {
        const cases: Array<[Partial<Parameters<typeof candidate>[1]> & { folia?: string }, string[], string | null]> = [
            [{ status: 'verified' }, ['qq'], null],
            [{ status: 'beta' }, ['qq'], 'override-not-verified'],
            [{ status: 'unsigned' }, ['qq'], 'override-not-verified'],
            [{ status: 'verified', version: '1.0.0' }, ['qq'], 'override-not-newer'],
            [{ status: 'verified', folia: '>=9.0.0' }, ['qq'], 'override-host-range'],
            [{ status: 'verified' }, [], 'override-unconfirmed'],
        ];
        for (const [options, confirmed, refusal] of cases) {
            const copy = candidate('qq', options);
            if (options.folia) copy.manifest.folia = options.folia;
            const result = resolve([builtin('qq')], [copy], { confirmed });
            expect(result.overrides.get('qq') ?? null, JSON.stringify(options)).toBe(refusal ? null : 'qq');
            expect(result.refused.get('qq')?.reason ?? null, JSON.stringify(options)).toBe(refusal);
        }
        expect(resolve([builtin('qq')], [candidate('qq', { status: 'verified' })]).pendingOverride.get('qq')).toBe('qq');
    });

    // A copy that does not replace the built-in one must leave the built-in copy's row alone: its short id and old
    // data. (It used to overwrite it, and the built-in source ran as folium.<id>.<id> without its sign-in.)
    it('keeps the built-in row while a same-id copy is refused or waits for its confirmation', () => {
        for (const copy of [candidate('qq', { status: 'verified' }), candidate('qq', { status: 'verified', version: '0.1.0' }), candidate('qq')]) {
            const result = resolve([builtin('qq')], [copy]);
            expect(result.overrides.size).toBe(0);
            expect(result.sources.get('qq')).toEqual([expect.objectContaining({
                sourceId: 'qq', takeover: false, legacy: expect.objectContaining({ storeKeys: ['QQ_API_AUTH_SESSION_V1'] }),
            })]);
        }
    });

    it('gives a signed override the built-in row: its short id and the old data', () => {
        const result = resolve([builtin('qq')], [candidate('qq', { status: 'verified' })], { confirmed: ['qq'] });
        expect(result.sources.get('qq')).toEqual([expect.objectContaining({ sourceId: 'qq', legacy: expect.objectContaining({ storeKeys: ['QQ_API_AUTH_SESSION_V1'] }) })]);
    });
});

describe('the compliance plan (pure rules)', () => {
    it('1. reads foliaBundledSources, and all nine without it', () => {
        expect(readBundledSources('/app', { readFile: () => JSON.stringify({ foliaBundledSources: ['netease'] }) })).toEqual({ ids: ['netease'], declared: true });
        expect(readBundledSources('/app', { readFile: () => JSON.stringify({ name: 'folia' }) })).toEqual({ ids: BUILTIN_SOURCE_IDS, declared: false });
        expect(readBundledSources('/app', { readFile: () => { throw new Error('none'); } }).ids).toEqual(BUILTIN_SOURCE_IDS);
        // A broken declaration never opens a takeover.
        expect(readBundledSources('/app', { readFile: () => JSON.stringify({ foliaBundledSources: 'qq' }) }).ids).toEqual(BUILTIN_SOURCE_IDS);
    });

    it('2. lets an unsigned claim of a source not carried take its short id and old data, at any version', () => {
        // Its enable confirmation named the takeover, which recorded it as the holder.
        const result = resolve([], [candidate('qq-community', { claims: 'qq', version: '0.0.1' })], { bundled: [], claims: { qq: 'qq-community' } });
        expect(result.refused.size).toBe(0);
        expect(result.claimHolders.get('qq')).toBe('qq-community');
        expect(result.sources.get('qq-community')).toEqual([{
            localId: 'main', sourceId: 'qq', takeover: true, keepForMatching: false,
            legacy: { storeKeys: ['QQ_API_AUTH_SESSION_V1'], partitions: [], userDataDirs: ['qq-auth-state'], native: [] },
        }]);
    });

    // Plan §12 item 9: in an installation that carries every source the takeover is closed. A claim can only
    // name a source the trusted table knows, and only the old data of that source's row (or part of it).
    it('2a. refuses a claim of an id the trusted table does not know, or of old data outside its row', () => {
        const unknown = candidate('evil', { sources: [{ id: 'main', name: 'x', claims: { id: 'whatever', storeKeys: ['QQ_API_AUTH_SESSION_V1'], userDataDirs: ['qq-auth-state'] } }] });
        const outside = candidate('greedy', { sources: [{ id: 'main', name: 'x', claims: { ...rowClaims('kugou'), storeKeys: ['KUGOU_API_SESSION_V2', 'QQ_API_AUTH_SESSION_V1'] } }] });
        const reserved = candidate('wiper', { sources: [{ id: 'main', name: 'x', claims: { ...rowClaims('ytm'), userDataDirs: ['mods'] } }] });
        const partial = candidate('modest', { enabled: false, sources: [{ id: 'main', name: 'x', claims: { id: 'ytm', storeKeys: ['YTM_SESSION_V1'] } }] });
        const result = resolve([], [unknown, outside, reserved, partial], { bundled: [] });
        expect(result.notes.get('evil')).toEqual(['claim-unknown-source']);
        expect(result.notes.get('greedy')).toEqual(['claim-outside-row']);
        expect(result.notes.get('wiper')).toEqual(['claim-outside-row']);
        for (const modId of ['evil', 'greedy', 'wiper']) {
            expect(result.sources.get(modId)![0], modId).toMatchObject({ sourceId: `folium.${modId}.main`, legacy: null, takeover: false });
        }
        expect(result.claimHolders.size).toBe(0);
        // Part of the row is enough: a claim need not take all of it.
        expect(result.sources.get('modest')![0]).toMatchObject({ sourceId: 'ytm', takeover: true, legacy: expect.objectContaining({ storeKeys: ['YTM_SESSION_V1'] }) });
    });

    it('3. does not let a mismatched signature take over: it runs under its own id', () => {
        const result = resolve([], [candidate('qq-community', { claims: 'qq', status: 'invalid' })], { bundled: [] });
        expect(result.claimHolders.has('qq')).toBe(false);
        expect(result.refused.has('qq-community')).toBe(false);
        expect(result.notes.get('qq-community')).toEqual(['claim-signature-invalid']);
        expect(result.sources.get('qq-community')![0]).toMatchObject({ sourceId: 'folium.qq-community.main', legacy: null, takeover: false });
    });

    it('4. gives one short id to one mod: the recorded holder, the one whose confirmation named the takeover', () => {
        const first = candidate('aaa', { claims: 'qq' });
        const second = candidate('bbb', { claims: 'qq' });
        const recorded = resolve([], [first, second], { bundled: [], claims: { qq: 'bbb' } });
        expect(recorded.claimHolders.get('qq')).toBe('bbb');
        expect(recorded.refused.get('aaa')).toEqual({ reason: 'claim-taken', detail: 'bbb' });
    });

    // Its holder gone (deleted, broken), a short id goes to nobody by itself: the other claimant was enabled while
    // the id was taken, so its confirmation never named the takeover. It runs under its own id until confirmed.
    it('4a. hands a short id whose holder is gone to nobody, not to another enabled claimant', () => {
        const enabled = candidate('bbb', { claims: 'qq' });
        const waiting = candidate('ccc', { claims: 'qq', enabled: false });
        const result = resolve([], [enabled, waiting], { bundled: [], claims: { qq: 'aaa' } });
        expect(result.claimHolders.has('qq')).toBe(false);
        expect(result.notes.get('bbb')).toEqual(['claim-unconfirmed']);
        expect(result.sources.get('bbb')![0]).toMatchObject({ sourceId: 'folium.bbb.main', legacy: null, takeover: false });
        // The one not yet enabled is described as taking it over, for the confirmation that would make it the holder.
        expect(result.sources.get('ccc')![0]).toMatchObject({ sourceId: 'qq', takeover: true });
        expect(resolve([], [enabled], { bundled: [] }).claimHolders.has('qq')).toBe(false);
    });

    it('5. refuses a claim of a carried source that has no built-in copy: the installation is broken', () => {
        const result = resolve([], [candidate('qq-community', { claims: 'qq', status: 'verified' })], { bundled: ['qq'], confirmed: ['qq-community'] });
        expect(result.brokenInstall).toEqual(['qq']);
        expect(result.refused.get('qq-community')).toEqual({ reason: 'bundled-source-missing', detail: 'qq' });
    });

    it('6. holds a claim of a carried source to the override rule once the built-in copy is back', () => {
        const unsigned = resolve([builtin('qq')], [candidate('qq-community', { claims: 'qq' })], { bundled: ['qq'] });
        expect(unsigned.refused.get('qq-community')).toEqual({ reason: 'override-not-verified', detail: 'qq' });
        expect(unsigned.overrides.size).toBe(0);
        const signed = resolve([builtin('qq')], [candidate('qq-community', { claims: 'qq', status: 'verified' })], { bundled: ['qq'], confirmed: ['qq-community'] });
        expect(signed.overrides.get('qq')).toBe('qq-community');
        // It then uses the trusted row, the same old keys the built-in copy uses.
        expect(signed.sources.get('qq-community')![0]).toMatchObject({ sourceId: 'qq', legacy: expect.objectContaining({ storeKeys: ['QQ_API_AUTH_SESSION_V1'] }) });
    });
});

describe('ownership in the loader', () => {
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

    it('keeps the built-in copy over an unsigned newer user copy, and the row says why', () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: true });
        const directory = writeMod('user', { ...sourceManifest('qq', ['qq']), version: '9.0.0' }, { main: true });
        confirmMod(directory, 'qq');
        const system = launch();
        expect(stateOf(system, 'qq')).toMatchObject({ tier: 'builtin', status: 'loaded', alternate: { tier: 'user', reason: 'override-not-verified' } });
        expect(system.listMods().filter((mod) => mod.id === 'qq')).toHaveLength(1);
        // The built-in copy keeps its short id and its old sign-in while the other copy is refused.
        expect(stateOf(system, 'qq')!.sources).toEqual([expect.objectContaining({ id: 'qq', takeover: false })]);
        const api = modRecord('qq')!.api as { legacy: { store: { get: (key: string) => unknown } } };
        expect(() => api.legacy.store.get('QQ_API_AUTH_SESSION_V1')).not.toThrow();
    });

    it('lets a claiming mod take over a source the installation does not carry, through the usual confirmation', async () => {
        writeAppPackage({ foliaBundledSources: ['netease'] });
        writeMod('user', sourceManifest('qq-community', [{ id: 'qq', claims: { id: 'qq', storeKeys: ['QQ_API_AUTH_SESSION_V1'], userDataDirs: ['qq-auth-state'] } }]), { main: true });
        const system = launch();
        expect(stateOf(system, 'qq-community')!.status).toBe('disabled');
        dialogAnswer.response = 1;
        expect(await system.setModEnabled('qq-community', true)).toMatchObject({ ok: true });
        // The enable confirmation says what it takes over and that it uses the sign-in already there.
        const detail = dialogs.at(-1)!.detail!;
        expect(detail).toContain('takes over sources this installation does not carry: qq');
        expect(detail).toContain('QQ_API_AUTH_SESSION_V1');
        expect(detail).toContain('userData/qq-auth-state');
        expect(detail).toContain('Signature: none');
        expect(stateOf(system, 'qq-community')).toMatchObject({ status: 'loaded', sources: [expect.objectContaining({ id: 'qq', takeover: true })] });
        expect(persisted.get('mods.sourceClaims')).toEqual({ qq: 'qq-community' });
        // It reaches the claimed key through api.legacy.store, and nothing else.
        const api = modRecord('qq-community')!.api as { legacy: { store: { get: (key: string) => unknown } } };
        expect(() => api.legacy.store.get('QQ_API_AUTH_SESSION_V1')).not.toThrow();
        expect(() => api.legacy.store.get('KUGOU_API_SESSION_V2')).toThrow('legacy-key-not-claimed');
    });

    it('takes over nothing while the installation carries every source, which is every installation today', () => {
        writeMod('user', sourceManifest('qq-community', [{ id: 'qq', claims: { id: 'qq' } }]));
        const system = launch();
        expect(stateOf(system, 'qq-community')).toMatchObject({ status: 'error', error: 'bundled-source-missing:qq' });
    });

    // A run started without mods plans no takeover: enabling a claimant then shows none in its confirmation, so it
    // must not take the record either (it did, and next start it held the id and the old sign-in).
    it('records no holder from an enable whose confirmation showed no takeover (a run started without mods)', async () => {
        writeAppPackage({ foliaBundledSources: [] });
        const first = writeMod('user', sourceManifest('aaa-qq', [{ id: 'qq', claims: { id: 'qq' } }]));
        writeMod('user', sourceManifest('bbb-qq', [{ id: 'qq', claims: { id: 'qq' } }]));
        confirmMod(first, 'aaa-qq');
        persisted.set('mods.sourceClaims', { qq: 'aaa-qq' });
        const system = launch();
        system.skipForThisRun();
        dialogAnswer.response = 1;
        await system.setModEnabled('bbb-qq', true);
        expect(dialogs.at(-1)?.detail ?? '').not.toContain('takes over');
        expect(persisted.get('mods.sourceClaims')).toEqual({ qq: 'aaa-qq' });
    });

    it('runs the claim of a second mod nowhere while the first holds the id', async () => {
        writeAppPackage({ foliaBundledSources: [] });
        const first = writeMod('user', sourceManifest('aaa-qq', [{ id: 'qq', claims: { id: 'qq' } }]));
        const second = writeMod('user', sourceManifest('bbb-qq', [{ id: 'qq', claims: { id: 'qq' } }]));
        confirmMod(first, 'aaa-qq');
        persisted.set('mods.sourceClaims', { qq: 'aaa-qq' });
        confirmMod(second, 'bbb-qq');
        const system = launch();
        expect(stateOf(system, 'aaa-qq')!.status).toBe('loaded');
        expect(stateOf(system, 'bbb-qq')).toMatchObject({ status: 'error', error: 'claim-taken:aaa-qq' });
        // "Settings → Sources" hands it over.
        expect(await system.assignSourceClaim('qq', 'bbb-qq')).toMatchObject({ ok: true });
        expect(stateOf(system, 'bbb-qq')!.status).toBe('loaded');
        expect(stateOf(system, 'aaa-qq')).toMatchObject({ status: 'error', error: 'claim-taken:bbb-qq' });
    });

    it('stops loading an unsigned takeover once the installation carries the source again, and the old keys stay', () => {
        writeAppPackage({ foliaBundledSources: [] });
        const directory = writeMod('user', sourceManifest('qq-community', [{ id: 'qq', claims: { id: 'qq', storeKeys: ['QQ_API_AUTH_SESSION_V1'] } }]), { main: true });
        confirmMod(directory, 'qq-community');
        launch();
        expect(modRecord('qq-community')?.activations).toBe(1);
        // The new installation carries qq again.
        writeAppPackage({});
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: true });
        const system = launch();
        expect(stateOf(system, 'qq')).toMatchObject({ tier: 'builtin', status: 'loaded', sources: [expect.objectContaining({ id: 'qq' })] });
        expect(stateOf(system, 'qq-community')).toMatchObject({ status: 'error', error: 'override-not-verified:qq' });
        expect(modRecord('qq-community')?.activations).toBe(1);
    });

    // A signed copy is accepted by the pure rules above (it needs an official key to sign one here). What the
    // loader must never do is let an approval stand in for the signature.
    it('keeps an unsigned copy out even with an override approval on record, and offers no confirmation for it', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: true });
        const directory = writeMod('user', { ...sourceManifest('qq', ['qq']), version: '2.0.0' }, { main: true });
        persisted.set('mods.override.qq', { digest: computeModDigest(directory) });
        const system = launch();
        expect(stateOf(system, 'qq')).toMatchObject({ tier: 'builtin', alternate: { reason: 'override-not-verified' } });
        expect(await system.confirmModOverride('qq')).toEqual(expect.objectContaining({ ok: false, error: 'no-pending-override' }));
        expect(fs.existsSync(path.join(directory, 'mod.json'))).toBe(true);
        expect(modRecord('qq')?.activations).toBe(1);
    });
});
