import { describe, expect, it } from 'vitest';
import {
    buildLibrarySuiteIndex,
    DEFAULT_LIBRARY_SUITE_ID,
    intersectDeclaredActions,
    isLibrarySuiteChoiceAvailable,
    LIBRARY_SUITE_INITIAL_CHOICE,
    LIBRARY_ACCOUNT_ACTION_IDS,
    LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS,
    LIBRARY_ACTION_IDS,
    LIBRARY_ACTION_MUTATION_CAPABILITY,
    LIBRARY_ARTIST_ACTION_IDS,
    LIBRARY_SURFACE_IDS,
    resolveDeclaredMutationActions,
    resolveLibrarySuiteInitialChoice,
} from '@/library/core/suite/librarySuites';
import { EMPTY_COLLECTION_MUTATION_SNAPSHOT } from '@/library/core/collection/mutations/collectionMutationCapabilities';
import type { LibraryActionId, LibrarySuiteManifest } from '@/library/core/suite/suite.contract';
import type { LibraryAccountActionId } from '@/library/core/account/account.contract';
import type { CollectionMutationCapabilities } from '@/library/core/collection/mutations/mutations.contract';

// test/unit/library/core/librarySuites.test.ts
// suite 清单的纯规则：回退默认 suite、清单自检、声明与 core 能力取交集。喂的是假清单，不经过 glob。

const component = (name: string) => Object.assign(() => name, { displayName: name });

const gridLike = (): LibrarySuiteManifest => ({
    id: 'grid',
    labelKey: 'grid',
    surfaces: {
        home: { component: component('grid-home'), actions: [] },
        collection: { component: component('grid-collection'), actions: ['play', 'play-scope', 'resync-folder'], extraActions: ['toggle-info-panel'] },
        artist: { component: component('grid-artist'), actions: ['play'] },
        account: { component: component('grid-account'), actions: [...LIBRARY_ACCOUNT_ACTION_IDS] },
    },
});

const listLike = (overrides: Partial<LibrarySuiteManifest> = {}): LibrarySuiteManifest => ({
    id: 'list',
    labelKey: 'list',
    surfaces: { collection: { component: component('list-collection'), actions: ['play', 'play-scope'] } },
    ...overrides,
});

describe('library suite index', () => {
    it('resolves a surface to the selected suite and falls back to the default one', () => {
        const index = buildLibrarySuiteIndex([listLike(), gridLike()]);
        const collection = index.resolve('collection', 'list');
        expect(collection.suite.id).toBe('list');
        expect(collection.isFallback).toBe(false);
        expect(collection.declaredActions).toEqual({ actions: ['play', 'play-scope'], extraActions: [] });

        for (const surface of ['home', 'artist', 'account'] as const) {
            const resolved = index.resolve(surface, 'list');
            expect(resolved.suite.id).toBe('grid');
            expect(resolved.isFallback).toBe(true);
            // 回退时用的就是默认 suite 自己的那份声明（同一个对象）。
            expect(resolved.declaredActions).toBe(index.resolve(surface, 'grid').declaredActions);
        }
        expect(index.resolve('collection', 'unknown').suite.id).toBe('grid');
    });

    it('answers with the same object every time, so the result can be passed as props', () => {
        const index = buildLibrarySuiteIndex([gridLike(), listLike()]);
        expect(index.resolve('collection', 'grid')).toBe(index.resolve('collection', 'grid'));
        expect(index.resolve('collection', 'grid').declaredActions.extraActions).toEqual(['toggle-info-panel']);
    });

    it('lists the default suite first and drops unavailable suites', () => {
        const index = buildLibrarySuiteIndex([listLike({ id: 'b' }), listLike({ id: 'a' }), gridLike(), listLike({ id: 'off', available: false })]);
        expect(index.suites.map(suite => suite.id)).toEqual(['grid', 'a', 'b']);
        expect(index.has('off')).toBe(false);
        expect(index.resolve('collection', 'off').suite.id).toBe('grid');
        expect(index.defaultSuite.id).toBe(DEFAULT_LIBRARY_SUITE_ID);
    });

    it('refuses broken manifests at startup', () => {
        expect(() => buildLibrarySuiteIndex([gridLike(), gridLike()])).toThrow(/Duplicate/);
        expect(() => buildLibrarySuiteIndex([listLike()])).toThrow(/Default suite "grid" is missing/);
        const partialGrid = gridLike();
        expect(() => buildLibrarySuiteIndex([{ ...partialGrid, surfaces: { collection: partialGrid.surfaces.collection } }]))
            .toThrow(/must implement every surface; missing home, artist, account/);
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { collection: { component: component('x'), actions: ['teleport' as LibraryActionId] } },
        })])).toThrow(/unknown action "teleport"/);
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { search: { component: component('x'), actions: [] } } as unknown as LibrarySuiteManifest['surfaces'],
        })])).toThrow(/unknown surface "search"/);
    });

    it('checks artist declarations against the artist action list (P4.2)', () => {
        // 每个页面有自己的动作清单：集合页的 sort 在歌手页上是未知动作，首页的 directory-filter 在集合页上也是
        // （open-album / open-artist 两个页面都有：P4.4 起集合的曲目行 / 卡片上也能打开专辑 / 歌手）。
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { artist: { component: component('x'), actions: ['play-scope', 'open-album', 'open-artist', 'resume-sync'] } },
        })])).not.toThrow();
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { artist: { component: component('x'), actions: ['sort'] } },
        })])).toThrow(/unknown action "sort" on artist/);
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { collection: { component: component('x'), actions: ['open-album', 'open-artist'] } },
        })])).not.toThrow();
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { collection: { component: component('x'), actions: ['directory-filter' as LibraryActionId] } },
        })])).toThrow(/unknown action "directory-filter" on collection/);
        expect(new Set(LIBRARY_ARTIST_ACTION_IDS).size).toBe(LIBRARY_ARTIST_ACTION_IDS.length);
    });

    it('knows the four surfaces', () => {
        expect(LIBRARY_SURFACE_IDS).toEqual(['home', 'collection', 'artist', 'account']);
    });
});

describe('account surface declarations (A5)', () => {
    const accountSurface = (actions: readonly LibraryAccountActionId[]) => ({
        surfaces: { account: { component: component('list-account'), actions } },
    });

    it('falls back to the default suite account surface as a whole when a suite has none', () => {
        const index = buildLibrarySuiteIndex([gridLike(), listLike()]);
        const account = index.resolve('account', 'list');
        expect(account).toMatchObject({ isFallback: true });
        expect(account.suite.id).toBe('grid');
        // 回退时整套用网格的：组件与声明（含可选动作）都是网格自己的那一份。
        expect(account.declaration.component).toBe(index.resolve('account', 'grid').declaration.component);
        expect(account.declaredActions).toBe(index.resolve('account', 'grid').declaredActions);
        expect(account.declaredActions.actions).toEqual(LIBRARY_ACCOUNT_ACTION_IDS);
    });

    it('lets a suite render its own account surface without the optional actions', () => {
        const index = buildLibrarySuiteIndex([gridLike(), listLike(accountSurface(LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS))]);
        const account = index.resolve('account', 'list');
        expect(account).toMatchObject({ isFallback: false });
        expect(account.suite.id).toBe('list');
        // 可选（诊断、后端重启）与推荐（选平台、登出）都没声明：不回退，那几项由这套 suite 自己不显示。
        expect(account.declaredActions.actions).toEqual(['account-login', 'account-login-method', 'account-switch-confirm']);
        expect(account.declaredActions.actions).not.toContain('account-login-diagnostics');
        expect(account.declaredActions.actions).not.toContain('account-backend-restart');
    });

    it('refuses an account surface that leaves out a required action instead of silently falling back', () => {
        expect(LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS).toEqual(['account-login', 'account-login-method', 'account-switch-confirm']);
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike(accountSurface(['account-login', 'account-switch-confirm']))]))
            .toThrow(/account surface without the required action\(s\) account-login-method/);
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike(accountSurface(['account-select', 'account-logout']))]))
            .toThrow(/required action\(s\) account-login, account-login-method, account-switch-confirm/);
        // 默认 suite 同样受这条约束（它是所有回退的落点）。
        const grid = gridLike();
        expect(() => buildLibrarySuiteIndex([{
            ...grid,
            surfaces: { ...grid.surfaces, account: { component: component('grid-account'), actions: ['account-login'] } },
        }])).toThrow(/Suite "grid" declares the account surface without/);
    });

    it('checks account declarations against the account action list', () => {
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike(accountSurface([
            ...LIBRARY_ACCOUNT_REQUIRED_ACTION_IDS,
            'play' as LibraryAccountActionId,
        ]))])).toThrow(/unknown action "play" on account/);
        expect(() => buildLibrarySuiteIndex([gridLike(), listLike({
            surfaces: { collection: { component: component('x'), actions: ['account-login' as LibraryActionId] } },
        })])).toThrow(/unknown action "account-login" on collection/);
        expect(new Set(LIBRARY_ACCOUNT_ACTION_IDS).size).toBe(7);
    });
});

describe('declared actions and core capabilities', () => {
    it('keeps only the actions the suite declared, in the order core reports them', () => {
        const declared = { actions: ['play-scope', 'reload', 'sort'] as LibraryActionId[], extraActions: [] };
        expect(intersectDeclaredActions(declared, ['sort', 'play-scope', 'enqueue-scope', 'remove-entry'])).toEqual(['sort', 'play-scope']);
    });

    it('maps every mutation capability except the renderer-owned edit mode to an action id', () => {
        const capabilityKeys = Object.keys(EMPTY_COLLECTION_MUTATION_SNAPSHOT.capabilities).filter(key => key !== 'editCollection');
        expect(Object.values(LIBRARY_ACTION_MUTATION_CAPABILITY).sort()).toEqual(capabilityKeys.sort());
        for (const action of Object.keys(LIBRARY_ACTION_MUTATION_CAPABILITY)) {
            expect(LIBRARY_ACTION_IDS).toContain(action);
        }
        expect(new Set(LIBRARY_ACTION_IDS).size).toBe(LIBRARY_ACTION_IDS.length);
    });

    it('offers a mutation action only when the suite declares it and the collection supports it', () => {
        const supported = { supported: true, enabled: false, pending: true } as const;
        const capabilities: CollectionMutationCapabilities = {
            ...EMPTY_COLLECTION_MUTATION_SNAPSHOT.capabilities,
            removeEntry: supported,
            subscribe: supported,
            rename: supported,
        };
        const declared = { actions: ['play', 'remove-entry', 'rename', 'export-playlist'] as LibraryActionId[], extraActions: [] };
        // 进行中（enabled=false）仍然出现；声明了但不支持的（export-playlist）、支持但没声明的（subscribe）不出现。
        expect(resolveDeclaredMutationActions(declared, capabilities)).toEqual(['remove-entry', 'rename']);
    });
});

describe('initial choice and the effective suite (B0)', () => {
    it('keeps the fallback suite and the initial choice apart', () => {
        expect(DEFAULT_LIBRARY_SUITE_ID).toBe('grid');
        // 测试配置用 VITE_LIBRARY_INITIAL_SUITE=grid 钉住；没有覆盖时是开发阶段的 bravais。
        expect(LIBRARY_SUITE_INITIAL_CHOICE).toBe('grid');
        expect(resolveLibrarySuiteInitialChoice(undefined)).toBe('bravais');
        expect(resolveLibrarySuiteInitialChoice('')).toBe('bravais');
        expect(resolveLibrarySuiteInitialChoice('  ')).toBe('bravais');
        expect(resolveLibrarySuiteInitialChoice(' tui ')).toBe('tui');
        expect(resolveLibrarySuiteInitialChoice(true)).toBe('bravais');
    });

    it('resolves an unavailable initial choice and unknown ids to the default suite', () => {
        const index = buildLibrarySuiteIndex([gridLike(), listLike()]);
        expect(index.resolveId('list')).toBe('list');
        expect(index.resolveId('grid')).toBe('grid');
        // 初始选择 bravais 还不在清单里（B0 合入时）：生效的是网格。
        expect(index.resolveId('bravais')).toBe('grid');
        expect(index.resolveId('nope')).toBe('grid');
        // available: false 等于不存在。
        expect(buildLibrarySuiteIndex([gridLike(), listLike({ available: false })]).resolveId('list')).toBe('grid');
    });

    it('offers a choice only when more than one suite is available', () => {
        expect(isLibrarySuiteChoiceAvailable(buildLibrarySuiteIndex([gridLike()]).suites)).toBe(false);
        expect(isLibrarySuiteChoiceAvailable(buildLibrarySuiteIndex([gridLike(), listLike({ available: false })]).suites)).toBe(false);
        expect(isLibrarySuiteChoiceAvailable(buildLibrarySuiteIndex([gridLike(), listLike()]).suites)).toBe(true);
    });
});

describe('suite stage (B1)', () => {
    it('resolves the stage of the effective suite only', () => {
        const stage = component('list-stage');
        const index = buildLibrarySuiteIndex([gridLike(), listLike({ stage })]);
        const resolved = index.resolveStage('list');
        expect(resolved).toEqual({ suiteId: 'list', component: stage });
        // 同一套 suite 总是同一个对象（宿主把它当 props 传给 memo 的挂载位）。
        expect(index.resolveStage('list')).toBe(resolved);
        // 默认 suite 没有 stage；未知 id 回退到它，也就没有 stage。
        expect(index.resolveStage('grid')).toBeNull();
        expect(index.resolveStage('nope')).toBeNull();
    });

    it('does not borrow a stage: a suite without one gets none, an unavailable one counts as absent', () => {
        const stage = component('list-stage');
        expect(buildLibrarySuiteIndex([gridLike(), listLike()]).resolveStage('list')).toBeNull();
        expect(buildLibrarySuiteIndex([gridLike(), listLike({ stage, available: false })]).resolveStage('list')).toBeNull();
        // 默认 suite 若声明了 stage，未知 id 回退时生效的就是它的；选中的 suite 没声明时不借默认 suite 的。
        const gridStage = component('grid-stage');
        const index = buildLibrarySuiteIndex([{ ...gridLike(), stage: gridStage }, listLike()]);
        expect(index.resolveStage('nope')).toEqual({ suiteId: 'grid', component: gridStage });
        expect(index.resolveStage('list')).toBeNull();
    });

    it('keeps surface resolution unchanged when a suite brings a stage', () => {
        const index = buildLibrarySuiteIndex([gridLike(), listLike({ stage: component('list-stage') })]);
        expect(index.resolve('collection', 'list').suite.id).toBe('list');
        expect(index.resolve('artist', 'list')).toMatchObject({ isFallback: true });
        expect(index.resolve('artist', 'list').suite.id).toBe('grid');
    });
});
