import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/core/librarySuiteStore.test.ts
// suite 选择的持久化（B0）：只在选择时写 localStorage `library_suite`，读回的是上次的选择；
// 没有记录时用初始选择（LIBRARY_SUITE_INITIAL_CHOICE，开发阶段 bravais，可被 VITE_LIBRARY_INITIAL_SUITE 覆盖）；
// 存储坏了退回初始选择、写不进去时这次会话仍然生效。合法性不归 store 管（见 librarySuiteChoice.test）。

const STORAGE_KEY = 'library_suite';

const loadStore = async (initial?: string, options: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) => {
    const storage = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
    const setItem = vi.fn((key: string, value: string) => {
        if (options.throwOnSet) throw new Error('quota');
        storage.set(key, value);
    });
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => {
            if (options.throwOnGet) throw new Error('denied');
            return storage.get(key) ?? null;
        },
        setItem,
    });
    vi.resetModules();
    const { useLibrarySuiteStore } = await import('@/library/core/suite/useLibrarySuiteStore');
    return { useLibrarySuiteStore, storage, setItem };
};

describe('library suite store', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('starts from the initial choice and writes nothing until the user chooses', async () => {
        // 测试配置把初始选择钉在 grid（vitest.config.ts 的 test.env）。
        const { useLibrarySuiteStore, setItem } = await loadStore();
        expect(useLibrarySuiteStore.getState().suite).toBe('grid');
        expect(setItem).not.toHaveBeenCalled();
    });

    it('uses the built-in initial choice (bravais) when the build does not override it', async () => {
        vi.stubEnv('VITE_LIBRARY_INITIAL_SUITE', undefined);
        const { useLibrarySuiteStore, setItem } = await loadStore();
        expect(useLibrarySuiteStore.getState().suite).toBe('bravais');
        expect(setItem).not.toHaveBeenCalled();
    });

    it('persists a choice and reads it back after a restart', async () => {
        const first = await loadStore();
        first.useLibrarySuiteStore.getState().setSuite('tui');
        expect(first.storage.get(STORAGE_KEY)).toBe('tui');
        expect(first.useLibrarySuiteStore.getState().suite).toBe('tui');

        const second = await loadStore(first.storage.get(STORAGE_KEY));
        expect(second.useLibrarySuiteStore.getState().suite).toBe('tui');
    });

    it('keeps a stored choice over the initial choice, even one this build does not have', async () => {
        // 合法性由 registry 在渲染时判定：store 原样保留，bravais 合入之后这条记录就会生效。
        const { useLibrarySuiteStore } = await loadStore('some-future-suite');
        expect(useLibrarySuiteStore.getState().suite).toBe('some-future-suite');
    });

    it('falls back to the initial choice when storage cannot be read, and keeps a choice it cannot write', async () => {
        const { useLibrarySuiteStore } = await loadStore('tui', { throwOnGet: true, throwOnSet: true });
        expect(useLibrarySuiteStore.getState().suite).toBe('grid');
        useLibrarySuiteStore.getState().setSuite('tui');
        expect(useLibrarySuiteStore.getState().suite).toBe('tui');
    });

    it('hydrate re-reads storage written elsewhere and returns to the initial choice when it is cleared', async () => {
        const { useLibrarySuiteStore, storage } = await loadStore();
        storage.set(STORAGE_KEY, 'tui');
        useLibrarySuiteStore.getState().hydrate();
        expect(useLibrarySuiteStore.getState().suite).toBe('tui');
        storage.delete(STORAGE_KEY);
        useLibrarySuiteStore.getState().hydrate();
        expect(useLibrarySuiteStore.getState().suite).toBe('grid');
    });
});
