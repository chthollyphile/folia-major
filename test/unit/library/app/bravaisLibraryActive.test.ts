import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/library/registry';
import {
    BRAVAIS_LIBRARY_SUITE_ID,
    isBravaisLibraryActive,
    isBravaisLibrarySuite,
} from '@/library/app/bravaisLibraryActive';
import { useLibrarySuiteStore } from '@/library/core/suite/useLibrarySuiteStore';
import { buildLibrarySuiteIndex, isLibrarySuiteChoiceAvailable, LIBRARY_ACCOUNT_ACTION_IDS } from '@/library/core/suite/librarySuites';
import type { LibrarySuiteManifest } from '@/library/core/suite/suite.contract';

// test/unit/library/app/bravaisLibraryActive.test.ts
// 「当前是 bravais」的共享谓词（B6b②）：透光设置分区与两条命令都用它。比较的是生效 suite，不是 store 原值——
// B6 之前真实 registry 里还没有 bravais，store 存着 bravais 时生效的是 grid，谓词为假；B6 起 bravais 进了 registry，
// 存着 bravais 就生效、谓词为真（替身 registry 的用例仍钉住「跟着生效 suite 走」）。另钉住结构前提：bravais 能生效时一定「有得选」，
// 所以 LibrarySuiteSection 的 hasLibrarySuiteChoice 门控不会把透光设置一起藏掉。

afterEach(() => {
    useLibrarySuiteStore.setState({ suite: 'grid' });
    vi.doUnmock('@/library/registry');
    vi.resetModules();
});

describe('isBravaisLibrarySuite', () => {
    it('matches only the bravais id', () => {
        expect(BRAVAIS_LIBRARY_SUITE_ID).toBe('bravais');
        expect(isBravaisLibrarySuite('bravais')).toBe(true);
        expect(isBravaisLibrarySuite('grid')).toBe(false);
        expect(isBravaisLibrarySuite('tui')).toBe(false);
        expect(isBravaisLibrarySuite('Bravais')).toBe(false);
    });
});

describe('isBravaisLibraryActive with the real registry (bravais shipped in B6)', () => {
    it('is true while bravais is the stored choice, and false for an unknown id that resolves to grid', () => {
        useLibrarySuiteStore.setState({ suite: 'bravais' });
        expect(isBravaisLibraryActive()).toBe(true);
        useLibrarySuiteStore.setState({ suite: 'retired' });
        expect(isBravaisLibraryActive()).toBe(false);
    });

    it('is false for the grid and the TUI', () => {
        useLibrarySuiteStore.setState({ suite: 'grid' });
        expect(isBravaisLibraryActive()).toBe(false);
        useLibrarySuiteStore.setState({ suite: 'tui' });
        expect(isBravaisLibraryActive()).toBe(false);
    });
});

describe('isBravaisLibraryActive once bravais is available', () => {
    it('follows the effective suite', async () => {
        vi.resetModules();
        vi.doMock('@/library/registry', async importOriginal => {
            const actual = await importOriginal<typeof import('@/library/registry')>();
            return {
                ...actual,
                // 替身：bravais 可用，其余照真实 registry 解析。
                resolveActiveLibrarySuiteId: (id: string) => (id === 'bravais' ? 'bravais' : actual.resolveActiveLibrarySuiteId(id)),
            };
        });
        const { isBravaisLibraryActive: isActive } = await import('@/library/app/bravaisLibraryActive');
        const { useLibrarySuiteStore: store } = await import('@/library/core/suite/useLibrarySuiteStore');

        store.setState({ suite: 'bravais' });
        expect(isActive()).toBe(true);
        store.setState({ suite: 'grid' });
        expect(isActive()).toBe(false);
        store.setState({ suite: 'unknown' });
        expect(isActive()).toBe(false);
    });
});

describe('the library suite section gate', () => {
    const surface = (name: string) => Object.assign(() => name, { displayName: name });
    const grid: LibrarySuiteManifest = {
        id: 'grid',
        labelKey: 'grid',
        surfaces: {
            home: { component: surface('grid-home'), actions: [] },
            collection: { component: surface('grid-collection'), actions: ['play'] },
            artist: { component: surface('grid-artist'), actions: ['play'] },
            account: { component: surface('grid-account'), actions: [...LIBRARY_ACCOUNT_ACTION_IDS] },
        },
    };
    const bravais: LibrarySuiteManifest = {
        id: 'bravais',
        labelKey: 'bravais',
        surfaces: { collection: { component: surface('bravais-collection'), actions: ['play'] } },
    };

    it('always offers a choice when bravais can be the effective suite', () => {
        // 默认 suite（grid）总在，bravais 能生效就至少两套：hasLibrarySuiteChoice 为真，分区照常渲染。
        const index = buildLibrarySuiteIndex([grid, bravais]);
        expect(isBravaisLibrarySuite(index.resolveId('bravais'))).toBe(true);
        expect(isLibrarySuiteChoiceAvailable(index.suites)).toBe(true);

        // bravais 不可用时它不会生效，此时分区藏不藏都与透光设置无关。
        const withoutBravais = buildLibrarySuiteIndex([grid, { ...bravais, available: false }]);
        expect(isBravaisLibrarySuite(withoutBravais.resolveId('bravais'))).toBe(false);
        expect(isLibrarySuiteChoiceAvailable(withoutBravais.suites)).toBe(false);
    });
});
