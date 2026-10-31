import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_LIBRARY_SUITE_ID,
    forgetLibraryLayouts,
    getLibrarySuite,
    hasLibrarySuite,
    listLibrarySuiteOverlays,
    listLibrarySuites,
    resolveLibraryStage,
    resolveLibrarySurface,
    resolveLibrarySurfaceActions,
} from '@/library/registry';
import {
    buildLibrarySuiteIndex,
    LIBRARY_ACCOUNT_ACTION_IDS,
    LIBRARY_ACTION_IDS,
    LIBRARY_ARTIST_ACTION_IDS,
    LIBRARY_HOME_ACTION_IDS,
} from '@/library/core/suite/librarySuites';
import type { LibrarySuiteManifest } from '@/library/core/suite/suite.contract';

// test/unit/library/registry.test.ts
// 真实的 suite 注册表（eager glob 发现 suites/*/entry.ts）。Vitest 的 DEV 为 true，且测试配置显式
// 启用 VITE_LIBRARY_TUI=true，所以开发验证 TUI 也在。纯规则的边界情况在 core/librarySuites.test.ts。

describe('library suite registry', () => {
    it('discovers the grid (default, first), bravais and the dev-only TUI', () => {
        // B6 起 bravais 进 registry（正式 suite，不门控）。
        expect(listLibrarySuites().map(suite => suite.id)).toEqual(['grid', 'bravais', 'tui']);
        expect(DEFAULT_LIBRARY_SUITE_ID).toBe('grid');
        expect(hasLibrarySuite('tui')).toBe(true);
        expect(hasLibrarySuite('renderer')).toBe(false);
        expect(getLibrarySuite('tui')?.labelKey).toBe('libraryTui.rendererTui');
    });

    it('renders every TUI surface itself, the artist page included (P4.3)', () => {
        for (const surface of ['home', 'collection', 'artist'] as const) {
            expect(resolveLibrarySurface(surface, 'tui')).toMatchObject({ suiteId: 'tui', isFallback: false });
            expect(resolveLibrarySurface(surface, 'tui').component).not.toBe(resolveLibrarySurface(surface, 'grid').component);
        }
        expect(resolveLibrarySurface('collection', 'nope').suiteId).toBe('grid');
    });

    it('renders the TUI account surface itself (A6) and declares all seven account actions', () => {
        const grid = resolveLibrarySurface('account', 'grid');
        const tui = resolveLibrarySurface('account', 'tui');
        expect(grid).toMatchObject({ suiteId: 'grid', isFallback: false });
        expect(tui).toMatchObject({ suiteId: 'tui', isFallback: false });
        expect(tui.component).not.toBe(grid.component);
        expect(tui.component).toBe(getLibrarySuite('tui')?.surfaces.account?.component);
        expect([...tui.declaredActions.actions].sort()).toEqual([...LIBRARY_ACCOUNT_ACTION_IDS].sort());
        expect(resolveLibrarySurface('account', 'tui')).toBe(tui);
    });

    it('answers bravais with the grid account surface as a whole: its sign-in is the shared window, its switch confirm grid\'s', () => {
        // 登录在共用的登录窗口里，缝里不再有登录态 / 确认态：bravais 不声明 account surface，整体回退 grid 的确认框。
        const bravais = resolveLibrarySurface('account', 'bravais');
        const grid = resolveLibrarySurface('account', 'grid');
        expect(getLibrarySuite('bravais')?.surfaces.account).toBeUndefined();
        expect(bravais).toMatchObject({ suiteId: 'grid', isFallback: true });
        expect(bravais.component).toBe(grid.component);
        expect(bravais.declaredActions).toBe(grid.declaredActions);
    });

    it('still answers a suite without an account surface with the grid one as a whole', () => {
        // TUI 有了 account surface 之后，真实注册表里没有回退的例子：用真实的网格清单加一套只有首页的假 suite 验证。
        const grid = getLibrarySuite('grid')!;
        const homeOnly: LibrarySuiteManifest = {
            id: 'home-only',
            labelKey: 'home-only',
            surfaces: { home: { component: () => null, actions: [] } },
        };
        const index = buildLibrarySuiteIndex([grid, homeOnly]);
        const account = index.resolve('account', 'home-only');
        expect(account).toMatchObject({ isFallback: true });
        expect(account.suite.id).toBe('grid');
        expect(account.declaration.component).toBe(grid.surfaces.account!.component);
        // 同一份声明（含可选的诊断与后端重启）：回退时那两项照样显示。
        expect(account.declaredActions).toBe(index.resolve('account', 'grid').declaredActions);
    });

    it('still falls back to the grid artist page for a suite that does not implement it', () => {
        // TUI 实现歌手页之后，真实注册表里已经没有回退的例子：用真实的网格清单加一套只有集合页的假 suite 验证同一条规则。
        const grid = getLibrarySuite('grid')!;
        const listOnly: LibrarySuiteManifest = {
            id: 'list-only',
            labelKey: 'list-only',
            surfaces: { collection: { component: () => null, actions: ['play'] } },
        };
        const index = buildLibrarySuiteIndex([grid, listOnly]);
        const artist = index.resolve('artist', 'list-only');
        expect(artist).toMatchObject({ isFallback: true });
        expect(artist.suite.id).toBe('grid');
        expect(artist.declaration.component).toBe(grid.surfaces.artist!.component);
        expect(artist.declaredActions).toBe(index.resolve('artist', 'grid').declaredActions);
    });

    it('hands out stable results so the host can pass them as props', () => {
        expect(resolveLibrarySurface('collection', 'grid')).toBe(resolveLibrarySurface('collection', 'grid'));
        expect(resolveLibrarySurfaceActions('home', 'tui')).toBe(resolveLibrarySurfaceActions('home', 'tui'));
        expect(resolveLibrarySurfaceActions('artist', 'tui')).toBe(resolveLibrarySurfaceActions('artist', 'tui'));
    });

    it.each(['home', 'collection', 'artist', 'account'] as const)('shares the default %s result across unknown suite ids', surface => {
        const defaultSurface = resolveLibrarySurface(surface, DEFAULT_LIBRARY_SUITE_ID);
        for (let index = 0; index < 1000; index += 1) {
            // 输入可以任意变化；解析后的组件、动作与转场相同，就不应分配无限多份缓存对象。
            const unknownSurface = resolveLibrarySurface(surface, `unknown-suite-${index}`);
            expect(unknownSurface).toBe(defaultSurface);
            expect(unknownSurface.isFallback).toBe(false);
        }
    });

    it('declares what each suite implements today', () => {
        expect([...resolveLibrarySurfaceActions('collection', 'grid').actions].sort()).toEqual([...LIBRARY_ACTION_IDS].sort());
        expect(resolveLibrarySurfaceActions('collection', 'grid').extraActions)
            .toEqual(['toggle-info-panel', 'toggle-track-list', 'toggle-edit-mode']);
        // TUI 实现了除 Navidrome「加入歌单 / 新建歌单」、本地集合「设置封面」、速记簿（collect / collect-scope）与
        // 「收藏到歌单」（save-to-playlist）以外的全部集合动作（前两个需要歌单选择器，只在网格里；后面几个是 TUI 冻结
        // 之后才有的，不再加入口）。
        expect(resolveLibrarySurfaceActions('collection', 'tui')).toEqual({
            actions: [
                'play', 'enqueue', 'play-scope', 'enqueue-scope', 'filter', 'sort', 'reload', 'resume-sync',
                'remove-entry', 'subscribe', 'rename', 'delete-collection', 'resync-folder', 'resync-all-folders',
                'export-playlist', 'edit-entity', 'organize-song-info', 'match-song', 'daily-date',
                'open-album', 'open-artist',
            ],
            extraActions: [],
        });
        expect(LIBRARY_ACTION_IDS.filter(action => !resolveLibrarySurfaceActions('collection', 'tui').actions.includes(action)))
            .toEqual(['collect', 'collect-scope', 'save-to-playlist', 'set-cover', 'add-to-playlist', 'create-playlist']);
        // 歌手页（P4.2 / P4.3）：两套都实现了全部歌手页动作（网格的播放全部只经命令面板，TUI 还有 Ctrl+Enter）。
        expect([...resolveLibrarySurfaceActions('artist', 'grid').actions].sort()).toEqual([...LIBRARY_ARTIST_ACTION_IDS].sort());
        expect([...resolveLibrarySurfaceActions('artist', 'tui').actions].sort()).toEqual([...LIBRARY_ARTIST_ACTION_IDS].sort());
        // B8：bravais 的歌手页自己渲染，声明全部 10 个歌手页动作（不回退 grid）。
        expect(resolveLibrarySurface('artist', 'bravais')).toMatchObject({ suiteId: 'bravais', isFallback: false });
        expect([...resolveLibrarySurfaceActions('artist', 'bravais').actions].sort()).toEqual([...LIBRARY_ARTIST_ACTION_IDS].sort());
        // 首页：两套都实现了全部首页动作（网格的焦点类动作在卡片与目录树的按钮上，TUI 的在命令面板与键盘上）。
        expect([...resolveLibrarySurfaceActions('home', 'grid').actions].sort()).toEqual([...LIBRARY_HOME_ACTION_IDS].sort());
        expect([...resolveLibrarySurfaceActions('home', 'tui').actions].sort()).toEqual([...LIBRARY_HOME_ACTION_IDS].sort());
        // 账户（A5 / A6）：两套都实现全部 7 个账户动作（TUI 的诊断只复制报告，后端重启是 Enter）。
        expect(resolveLibrarySurface('account', 'grid').declaredActions).toEqual({ actions: LIBRARY_ACCOUNT_ACTION_IDS, extraActions: [] });
        expect([...resolveLibrarySurfaceActions('account', 'tui').actions].sort()).toEqual([...LIBRARY_ACCOUNT_ACTION_IDS].sort());
    });

    // P4.5：「完成」时宿主让每套 suite 忘掉这一层的布局记录；网格的两份（集合、歌手页）都在 sessionStorage 里，TUI 没有。
    it('forgets the grid layout records of one layer and leaves the others', () => {
        // 测试环境是 node：Node 25 自带 Web Storage，CI 的 Node 24 没有，所以用内存实现顶上。
        const values = new Map<string, string>();
        vi.stubGlobal('sessionStorage', {
            getItem: (name: string) => values.get(name) ?? null,
            setItem: (name: string, value: string) => { values.set(name, value); },
            removeItem: (name: string) => { values.delete(name); },
            clear: () => values.clear(),
        });
        const key = 'online:netease:playlist:1';
        sessionStorage.setItem(`folia_gridview_state:v2:${key}`, '{}');
        sessionStorage.setItem(`folia_artist_grid_state:v2:${key}`, '{}');
        sessionStorage.setItem('folia_gridview_state:v2:online:netease:playlist:2', '{}');
        expect(getLibrarySuite('grid')?.layout?.forget).toBeTypeOf('function');
        expect(getLibrarySuite('tui')?.layout).toBeUndefined();

        forgetLibraryLayouts(key);
        expect(sessionStorage.getItem(`folia_gridview_state:v2:${key}`)).toBeNull();
        expect(sessionStorage.getItem(`folia_artist_grid_state:v2:${key}`)).toBeNull();
        expect(sessionStorage.getItem('folia_gridview_state:v2:online:netease:playlist:2')).toBe('{}');
        vi.unstubAllGlobals();
    });

    it('only the grid brings a transition layer', () => {
        expect(listLibrarySuiteOverlays().map(overlay => overlay.suiteId)).toEqual(['grid']);
        expect(resolveLibrarySurface('collection', 'tui').transitions).toBeUndefined();
        expect(resolveLibrarySurface('artist', 'tui').transitions).toBeUndefined();
        expect(resolveLibrarySurface('artist', 'grid').transitions?.beforeBack).toBeTypeOf('function');
    });

    it('mounts a stage only for bravais; grid, the TUI and unknown ids have none (B1, B6)', () => {
        // 只有 bravais 带 stage；grid 与 TUI 没有，未知 id 生效的是 grid，同样没有。没有 stage 时宿主照旧垫背景板、藏首页。
        expect(listLibrarySuites().filter(suite => suite.stage).map(suite => suite.id)).toEqual(['bravais']);
        expect(resolveLibraryStage('bravais')?.suiteId).toBe('bravais');
        expect(resolveLibraryStage('bravais')?.component).toBe(getLibrarySuite('bravais')?.stage);
        expect(resolveLibraryStage('grid')).toBeNull();
        expect(resolveLibraryStage('tui')).toBeNull();
        expect(resolveLibraryStage('nope')).toBeNull();
    });
});
