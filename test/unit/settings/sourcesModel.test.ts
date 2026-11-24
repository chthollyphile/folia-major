import { describe, expect, it } from 'vitest';
import type { ModRuntimeInfo, ModSourceStateRow } from '@/mods/types';
import { buildSourceNotices, buildSourceRows, manifestSourceName, shownSourceUsage } from '@/components/modal/settings/pages/sources/sourcesModel';

// test/unit/settings/sourcesModel.test.ts
// "Settings → Sources" (Folium 2.0 plan §5.3): the rows it draws from the main process's source states and the mod
// list, and the takeover and override notes (plan §5.1) with the action each offers.

const stateRow = (patch: Partial<ModSourceStateRow> & { sourceId: string }): ModSourceStateRow => ({
    modId: null,
    tier: 'host',
    state: 'enabled',
    keepForMatching: false,
    takeover: false,
    loaded: false,
    mainState: 'none',
    ...patch,
});

const mod = (patch: Partial<ModRuntimeInfo> & { id: string }): ModRuntimeInfo => ({
    name: patch.id,
    version: '1.0.0',
    author: null,
    description: null,
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: true,
    clientUrl: null,
    folium: 2,
    kind: 'source',
    ...patch,
});

const ORDER = ['netease', 'kugou', 'qq', 'bodian'];
const inputs = {
    canMatchOnly: (id: string) => id === 'netease' || id === 'qq',
    sort: (ids: readonly string[]) => [...ids].sort((a, b) => {
        const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : 99);
        return rank(a) - rank(b);
    }),
};

describe('sourcesModel · rows', () => {
    it('lists every source in the registry order, with three states only where matching is possible', () => {
        const rows = buildSourceRows([
            stateRow({ sourceId: 'bodian', modId: 'bodian', tier: 'builtin', loaded: true, mainState: 'ready' }),
            stateRow({ sourceId: 'qq', state: 'matching' }),
            stateRow({ sourceId: 'kugou', state: 'disabled' }),
            stateRow({ sourceId: 'netease' }),
        ], [mod({ id: 'bodian' })], inputs);
        expect(rows.map(row => row.sourceId)).toEqual(['netease', 'kugou', 'qq', 'bodian']);
        expect(rows.map(row => row.threeStates)).toEqual([true, false, true, false]);
        // The host's platforms say what switching them cannot do; only a source mod's data can be cleared.
        expect(rows.map(row => row.run)).toEqual(['host', 'host', 'host', 'running']);
        expect(rows.map(row => row.clearable)).toEqual([false, false, false, true]);
    });

    it('carries whether a source accepts self-signed certificates from servers the user enters (absent reads as no)', () => {
        const rows = buildSourceRows([
            stateRow({ sourceId: 'fnmusic', modId: 'fnmusic', tier: 'builtin', selfSignedUserServers: true }),
            stateRow({ sourceId: 'bodian', modId: 'bodian', tier: 'builtin' }),
        ], [], inputs);
        expect(rows.map(row => [row.sourceId, row.selfSignedUserServers])).toEqual([['bodian', false], ['fnmusic', true]]);
    });

    it("carries a source's enableNotice from its manifest, null where it has none", () => {
        const notice = { en: 'Runs scripts you import.', 'zh-CN': '运行你导入的脚本。' };
        const rows = buildSourceRows([
            stateRow({ sourceId: 'bodian', modId: 'bodian', tier: 'builtin' }),
            stateRow({ sourceId: 'folium.lx.lx', modId: 'lx', tier: 'builtin', state: 'disabled', enableNotice: notice }),
        ], [], inputs);
        expect(rows.map(row => row.enableNotice)).toEqual([null, notice]);
        expect(rows[1].state).toBe('disabled');
    });

    it('keeps the three states for a source already used only for matching, even when it is not offered them now', () => {
        const [row] = buildSourceRows([stateRow({ sourceId: 'folium.x.y', modId: 'x', tier: 'user', state: 'matching' })], [], { ...inputs, canMatchOnly: () => false });
        expect(row.threeStates).toBe(true);
    });

    it('tells a source that cannot be used only for matching from one whose answer is not known yet', () => {
        const knowsMatchOnly = (id: string) => id !== 'folium.never.ran';
        const rows = buildSourceRows([
            stateRow({ sourceId: 'folium.never.ran', modId: 'never', tier: 'user', state: 'disabled' }),
            stateRow({ sourceId: 'folium.cannot.match', modId: 'cannot', tier: 'user', state: 'disabled' }),
        ], [], { ...inputs, canMatchOnly: () => false, knowsMatchOnly, sort: ids => [...ids] });
        expect(rows.map(row => [row.threeStates, row.matchOnlyKnown])).toEqual([[false, false], [false, true]]);
    });

    it('says how a source mod runs: off, running (used only for matching too), starting, failed with its error, or stopped', () => {
        const rows = buildSourceRows([
            stateRow({ sourceId: 'a', modId: 'a', tier: 'user', state: 'disabled', loaded: false }),
            stateRow({ sourceId: 'b', modId: 'b', tier: 'user', state: 'matching', loaded: true, mainState: 'ready' }),
            stateRow({ sourceId: 'c', modId: 'c', tier: 'user', loaded: true, mainState: 'activating' }),
            stateRow({ sourceId: 'd', modId: 'd', tier: 'user', loaded: false }),
            stateRow({ sourceId: 'e', modId: 'e', tier: 'user', loaded: false }),
        ], [mod({ id: 'd', status: 'error', error: 'boom' })], inputs);
        expect(rows.map(row => [row.sourceId, row.run, row.error])).toEqual([
            ['a', 'off', null], ['b', 'running', null], ['c', 'starting', null], ['d', 'failed', 'boom'], ['e', 'stopped', null],
        ]);
    });

    it('says when the whole mod is switched off on the Mods page, whatever the state here', () => {
        const [row] = buildSourceRows([stateRow({ sourceId: 'bodian', modId: 'bodian', tier: 'builtin', loaded: false })], [mod({ id: 'bodian', enabled: false, status: 'disabled' })], inputs);
        expect(row.run).toBe('mod-off');
    });

    it('names a source mod not registered now by its manifest, in the language asked for', () => {
        const rows = buildSourceRows(
            [stateRow({ sourceId: 'folium.x.radio', modId: 'x', tier: 'user', state: 'disabled' })],
            [mod({ id: 'x', sources: [{ id: 'folium.x.radio', localId: 'radio', name: { en: 'Radio', 'zh-CN': '电台' }, state: 'disabled', keepForMatching: false, takeover: false, requires: [] }] })],
            inputs,
        );
        expect(manifestSourceName(rows[0].manifestName, 'zh-CN', 'fallback')).toBe('电台');
        expect(manifestSourceName(rows[0].manifestName, 'vi', 'fallback')).toBe('Radio');
        expect(manifestSourceName(null, 'en', 'fallback')).toBe('fallback');
        expect(manifestSourceName('Plain', 'en', 'fallback')).toBe('Plain');
    });
});

describe('sourcesModel · takeover and override notes', () => {
    const claiming = (id: string, shortId: string, patch: Partial<ModRuntimeInfo> = {}) => mod({
        id,
        sources: [{ id: `folium.${id}.s`, localId: 's', name: 's', state: 'enabled', keepForMatching: false, takeover: false, requires: [], claims: shortId }],
        ...patch,
    });

    it('offers to confirm a takeover nobody confirmed, naming the short id the manifest claims', () => {
        const [notice] = buildSourceNotices([claiming('alt-qq', 'qq', { notes: ['claim-unconfirmed'] })]);
        expect(notice).toMatchObject({ kind: 'claim-unconfirmed', modId: 'alt-qq', sourceId: 'qq', action: { kind: 'assign-claim', shortId: 'qq', modId: 'alt-qq' } });
    });

    it('offers to hand a held id over to a mod refused because another holds it', () => {
        const notices = buildSourceNotices([
            claiming('first', 'qq'),
            claiming('second', 'qq', { status: 'error', error: 'claim-taken:first' }),
        ]);
        expect(notices).toEqual([expect.objectContaining({
            kind: 'claim-taken', modId: 'second', sourceId: 'qq', otherModId: 'first', otherModName: 'first',
            action: { kind: 'assign-claim', shortId: 'qq', modId: 'second' },
        })]);
    });

    it('says a takeover nobody confirmed once per claimed id, however many notes the loader left', () => {
        const notices = buildSourceNotices([claiming('alt-qq', 'qq', { notes: ['claim-unconfirmed', 'claim-unconfirmed'] })]);
        expect(notices).toHaveLength(1);
    });

    it('explains the claims that cannot take over, with no action', () => {
        const notices = buildSourceNotices([claiming('bad', 'qq', { notes: ['claim-signature-invalid', 'claim-outside-row', 'something-else'] })]);
        expect(notices.map(notice => [notice.kind, notice.action])).toEqual([['claim-signature-invalid', null], ['claim-outside-row', null]]);
    });

    it('offers to confirm an override of a built-in copy, and only says why the other refusals keep it', () => {
        const notices = buildSourceNotices([
            mod({ id: 'bodian', tier: 'builtin', alternate: { tier: 'user', version: '2.0.0', dirPath: null, reason: 'override-unconfirmed' } }),
            mod({ id: 'qishui', tier: 'builtin', alternate: { tier: 'user', version: '0.1.0', dirPath: null, reason: 'override-not-newer' } }),
            mod({ id: 'fnmusic', tier: 'builtin', alternate: { tier: 'user', version: '9.0.0', dirPath: null, reason: null } }),
        ]);
        expect(notices.map(notice => [notice.kind, notice.modId, notice.version, notice.action])).toEqual([
            ['override-unconfirmed', 'bodian', '2.0.0', { kind: 'confirm-override', modId: 'bodian' }],
            ['override-not-newer', 'qishui', '0.1.0', null],
        ]);
    });

    it('says which copy runs in place of a built-in one, and a broken installation', () => {
        const notices = buildSourceNotices([
            mod({ id: 'bodian', tier: 'override', version: '2.0.0', alternate: { tier: 'builtin', version: '1.0.0', dirPath: null, reason: null } }),
            mod({ id: 'kugou', name: 'KuGou', tier: 'builtin', shadowedBy: 'alt-kugou' }),
            claiming('alt-kugou', 'kugou', { name: 'Alt KuGou', tier: 'override' }),
            claiming('lost', 'qq', { status: 'error', error: 'bundled-source-missing:qq' }),
        ]);
        expect(notices.map(notice => [notice.kind, notice.modId, notice.sourceId, notice.otherModName, notice.version])).toEqual([
            ['override-running', 'bodian', null, null, '2.0.0'],
            ['shadowed', 'kugou', null, 'Alt KuGou', null],
            ['bundled-source-missing', 'lost', 'qq', null, null],
        ]);
    });
});

describe('the disk use a row shows', () => {
    it('shows a measure that keeps something', () => {
        expect(shownSourceUsage({ ok: true, data: 10, cache: 0 })).toEqual({ data: 10, cache: 0 });
        expect(shownSourceUsage({ ok: true, data: 0, cache: 5 })).toEqual({ data: 0, cache: 5 });
    });

    it('shows nothing, never 0, for an answer that is not a measure or keeps nothing', () => {
        expect(shownSourceUsage(undefined)).toBeNull();
        expect(shownSourceUsage({ ok: false, error: 'source-usage-failed' })).toBeNull();
        expect(shownSourceUsage({ ok: false, error: 'no-electron-bridge' })).toBeNull();
        expect(shownSourceUsage({ ok: true })).toBeNull();
        expect(shownSourceUsage({ ok: true, data: 3 })).toBeNull();
        expect(shownSourceUsage({ ok: true, data: Number.NaN, cache: 1 })).toBeNull();
        expect(shownSourceUsage({ ok: true, data: 0, cache: 0 })).toBeNull();
    });
});
