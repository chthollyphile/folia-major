import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/library/registry';
import {
    chooseLibrarySuite,
    getActiveLibrarySuiteId,
    hasOnboardingLibrarySuiteChoice,
    LIBRARY_HOME_SESSION_KEY,
    listLibrarySuiteOptions,
    listOnboardingLibrarySuiteIds,
    pickOnboardingLibrarySuiteIds,
    resolveCurrentLibrarySessionKey,
} from '@/library/app/librarySuiteChoice';
import { switchLibrarySuite } from '@/library/app/switchLibrarySuite';
import { hasLibrarySuiteChoice, resolveActiveLibrarySuiteId } from '@/library/registry';
import { useLibrarySuiteStore } from '@/library/core/suite/useLibrarySuiteStore';
import { registerLibrarySessionFlush } from '@/library/core/shared/useLibraryBrowseSessionStore';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';

// test/unit/library/app/librarySuiteChoice.test.ts
// 正式 suite 选项（B0）的 app 层：store 里的选择可能不可用（开发阶段的初始选择 bravais 还没合入、旧记录），
// 展示与比较一律用实际生效的 suite；切换经当前会话 key 走 switchLibrarySuite；只有一套可用时没得选。
// 真实 registry：测试配置启用了 TUI，B6 起 bravais 也在，所以有 grid、bravais 与 tui 三套。
// 「不可用的选择」改用一个本构建没有的 id（'retired'）：bravais 已经可用。

const album = (id: string): GridViewCollectionDescriptor => ({
    source: 'online',
    providerId: 'netease',
    id,
    name: `Album ${id}`,
    type: 'album',
} as unknown as GridViewCollectionDescriptor);

let storage: Map<string, string>;

beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    });
    useCollectionNavigationStore.getState().clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    useLibrarySuiteStore.setState({ suite: 'grid' });
    useCollectionNavigationStore.getState().clear();
});

describe('effective library suite', () => {
    it('resolves an unavailable initial choice and unknown ids to grid', () => {
        expect(resolveActiveLibrarySuiteId('retired')).toBe('grid');
        expect(resolveActiveLibrarySuiteId('renderer')).toBe('grid');
        expect(resolveActiveLibrarySuiteId('tui')).toBe('tui');
        expect(resolveActiveLibrarySuiteId('bravais')).toBe('bravais');

        useLibrarySuiteStore.setState({ suite: 'retired' });
        expect(getActiveLibrarySuiteId()).toBe('grid');
        useLibrarySuiteStore.setState({ suite: 'tui' });
        expect(getActiveLibrarySuiteId()).toBe('tui');
    });

    it('lists the available suites as options, default first', () => {
        expect(listLibrarySuiteOptions()).toEqual([
            { id: 'grid', labelKey: 'libraryTui.rendererGrid' },
            { id: 'bravais', labelKey: 'libraryBravais.suiteName' },
            { id: 'tui', labelKey: 'libraryTui.rendererTui' },
        ]);
        expect(listLibrarySuiteOptions()).toBe(listLibrarySuiteOptions());
    });
});

describe('switching suites', () => {
    it('treats choosing the suite already in effect as no choice: nothing flushed, nothing written', () => {
        useLibrarySuiteStore.setState({ suite: 'retired' });
        const flush = vi.fn();
        const unregister = registerLibrarySessionFlush('home', flush);

        switchLibrarySuite('home', 'grid');

        expect(flush).not.toHaveBeenCalled();
        expect(useLibrarySuiteStore.getState().suite).toBe('retired');
        expect(storage.has('library_suite')).toBe(false);
        unregister();
    });

    it('flushes the session, then stores and persists a real switch', () => {
        useLibrarySuiteStore.setState({ suite: 'retired' });
        const flush = vi.fn();
        const unregister = registerLibrarySessionFlush('home', flush);

        switchLibrarySuite('home', 'tui');

        expect(flush).toHaveBeenCalledTimes(1);
        expect(useLibrarySuiteStore.getState().suite).toBe('tui');
        expect(storage.get('library_suite')).toBe('tui');

        switchLibrarySuite('home', 'grid');
        expect(useLibrarySuiteStore.getState().suite).toBe('grid');
        expect(storage.get('library_suite')).toBe('grid');
        unregister();
    });

    it('ignores ids this build does not have', () => {
        switchLibrarySuite('home', 'retired');
        switchLibrarySuite('home', 'nope');
        expect(useLibrarySuiteStore.getState().suite).toBe('grid');
        expect(storage.has('library_suite')).toBe(false);
    });
});

describe('current session key', () => {
    it('is the home key on the home screen and the top layer of the stack otherwise', () => {
        expect(resolveCurrentLibrarySessionKey()).toBe(LIBRARY_HOME_SESSION_KEY);
        useCollectionNavigationStore.getState().openRoot(album('a'), 'home');
        expect(resolveCurrentLibrarySessionKey()).toBe('online:netease:album:a');
        useCollectionNavigationStore.getState().push(album('b'));
        expect(resolveCurrentLibrarySessionKey()).toBe('online:netease:album:b');
    });

    it('is what the settings choice flushes', () => {
        useCollectionNavigationStore.getState().openRoot(album('a'), 'home');
        const flush = vi.fn();
        const unregister = registerLibrarySessionFlush('online:netease:album:a', flush);

        chooseLibrarySuite('tui');

        expect(flush).toHaveBeenCalledTimes(1);
        expect(useLibrarySuiteStore.getState().suite).toBe('tui');
        unregister();
    });
});

describe('whether there is a choice', () => {
    it('offers one with grid, bravais and the dev TUI available', () => {
        expect(hasLibrarySuiteChoice()).toBe(true);
    });

    it('hides the settings commands with the same predicate the settings section uses', () => {
        const context = (canChoose: boolean) => ({
            settings: { canChooseLibrarySuite: () => canChoose },
        } as unknown as CommandPaletteContext);
        for (const id of ['settings-library-suite', 'library-suite-picker']) {
            const command = COMMAND_PALETTE_COMMANDS.find(candidate => candidate.id === id);
            expect(command?.isAvailable?.(context(true))).toBe(true);
            expect(command?.isAvailable?.(context(false))).toBe(false);
        }
    });

    describe('with only grid available', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
            vi.resetModules();
        });

        it('offers none', async () => {
            vi.resetModules();
            vi.stubEnv('VITE_LIBRARY_TUI', 'false');
            // B6 起 bravais 总在 registry 里：用替身把它标成不可用，复现「只有 grid」的构建。
            vi.doMock('@/library/suites/bravais/entry', async importOriginal => {
                const actual = await importOriginal<typeof import('@/library/suites/bravais/entry')>();
                return { ...actual, default: { ...actual.default, available: false } };
            });
            const registry = await import('@/library/registry');
            expect(registry.listLibrarySuites().map(suite => suite.id)).toEqual(['grid']);
            expect(registry.hasLibrarySuiteChoice()).toBe(false);
            // 初始选择不可用时回退网格（B0 合入时 bravais 不在 registry 里）。
            expect(registry.resolveActiveLibrarySuiteId('bravais')).toBe('grid');
            vi.doUnmock('@/library/suites/bravais/entry');
        });
    });
});

// 2026-10-10：首启引导第一页只问网格（经典）与 bravais（无限）；TUI 在测试构建里可用也不出现。
describe('first-run onboarding suite page', () => {
    it('lists grid and bravais, in that order, and leaves the dev TUI out', () => {
        expect(listLibrarySuiteOptions().map(option => option.id)).toContain('tui');
        expect(listOnboardingLibrarySuiteIds()).toEqual(['grid', 'bravais']);
        expect(hasOnboardingLibrarySuiteChoice()).toBe(true);
    });

    it('keeps the fixed order whatever the registry order is, and drops suites the build lacks', () => {
        expect(pickOnboardingLibrarySuiteIds(['tui', 'bravais', 'grid'])).toEqual(['grid', 'bravais']);
        expect(pickOnboardingLibrarySuiteIds(['grid', 'tui'])).toEqual(['grid']);
        expect(pickOnboardingLibrarySuiteIds(['grid'])).toEqual(['grid']);
    });

    it('writes the pick through the same path as the settings section', () => {
        useLibrarySuiteStore.setState({ suite: 'grid' });
        chooseLibrarySuite('bravais');
        expect(useLibrarySuiteStore.getState().suite).toBe('bravais');
        expect(storage.get('library_suite')).toBe('bravais');
    });
});
