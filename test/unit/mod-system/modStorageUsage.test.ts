// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mod-system/modStorageUsage.test.ts
// The expanded mod row's file section: counted only when the row of a `filesystem.data` mod opens,
// "clear cache" disabled while there is nothing to clear (but offered for a broken cache root, which
// counts 0), and a clear re-counts and reports how much went (or that it was partial) through the
// manager's notice line.

const store = vi.hoisted(() => ({
    getModStorageUsage: vi.fn(),
    clearModCache: vi.fn(),
}));

vi.mock('@/mods/useModsStore', () => ({
    useModsStore: { getState: () => store },
    modSettingsRowId: (modId: string) => `mod:${modId}`,
}));

vi.mock('@/mods/manager/ModSurfaceRenderer', () => ({
    ModSurfaceRenderer: () => null,
}));

// Keys with the interpolated values that matter here, so assertions read the real arguments.
const t = (key: string, options?: Record<string, unknown>) => {
    const params = ['name', 'size', 'value']
        .filter((name) => options && name in options)
        .map((name) => `${name}=${String(options![name])}`);
    return params.length > 0 ? `${key}(${params.join(',')})` : key;
};

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Theme } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import { ModStorageUsage } from '@/mods/manager/ModStorageUsage';
import { ModListItem } from '@/mods/manager/ModListItem';
import { modManagerClassesFor } from '@/mods/manager/modManagerClasses';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const classes = modManagerClassesFor(false);

const modInfo = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'mod-b',
    name: 'Mod B',
    version: '1.0.0',
    author: null,
    description: null,
    permissions: ['filesystem.data'],
    status: 'disabled',
    error: null,
    enabled: false,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: true,
    clientUrl: null,
    loadOrder: null,
    ...overrides,
});

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
    store.getModStorageUsage.mockReset();
    store.clearModCache.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
});

const renderSection = async (onNotice = vi.fn()) => {
    await act(async () => {
        root!.render(React.createElement(ModStorageUsage, { mod: modInfo(), isDaylight: false, classes, onNotice }));
    });
    return onNotice;
};

const clearButton = () => host.querySelector<HTMLButtonElement>('button')!;

describe('mod storage section', () => {
    it('shows the data and cache sizes once counted', async () => {
        store.getModStorageUsage.mockResolvedValue({ ok: true, data: 2048, cache: 1536 });
        await renderSection();
        expect(store.getModStorageUsage).toHaveBeenCalledWith('mod-b');
        expect(host.textContent).toContain('mods.storageData(size=2 KB)');
        expect(host.textContent).toContain('mods.storageCache(size=1.5 KB)');
        expect(clearButton().disabled).toBe(false);
    });

    it('offers no clear while the cache is empty or missing', async () => {
        store.getModStorageUsage.mockResolvedValue({ ok: true, data: 10, cache: 0 });
        await renderSection();
        expect(host.textContent).toContain('mods.storageCache(size=0 B)');
        expect(clearButton().disabled).toBe(true);
    });

    // A stray file or dead link where the cache should be counts 0, yet paths.cache throws until it goes.
    it('offers a clear for a broken cache root, and reports it without a size', async () => {
        store.getModStorageUsage
            .mockResolvedValueOnce({ ok: true, data: 10, cache: 0, cacheBroken: true })
            .mockResolvedValueOnce({ ok: true, data: 10, cache: 0 });
        store.clearModCache.mockResolvedValue({ ok: true, cleared: 1 });
        const onNotice = await renderSection();
        expect(host.textContent).toContain('mods.storageCacheBroken');
        expect(host.textContent).not.toContain('mods.storageCache(');
        expect(clearButton().disabled).toBe(false);
        await act(async () => { clearButton().click(); });
        expect(store.clearModCache).toHaveBeenCalledWith('mod-b');
        expect(onNotice).toHaveBeenCalledWith({ kind: 'ok', text: 'mods.cacheClearedUncounted(name=Mod B)' });
        expect(host.textContent).toContain('mods.storageCache(size=0 B)');
        expect(clearButton().disabled).toBe(true);
    });

    it('clears, re-counts and reports how much went', async () => {
        store.getModStorageUsage
            .mockResolvedValueOnce({ ok: true, data: 2048, cache: 1536 })
            .mockResolvedValueOnce({ ok: true, data: 2048, cache: 0 });
        store.clearModCache.mockResolvedValue({ ok: true, cleared: 2 });
        const onNotice = await renderSection();
        await act(async () => { clearButton().click(); });
        expect(store.clearModCache).toHaveBeenCalledWith('mod-b');
        expect(store.getModStorageUsage).toHaveBeenCalledTimes(2);
        expect(onNotice).toHaveBeenCalledWith({ kind: 'ok', text: 'mods.cacheCleared(name=Mod B,size=1.5 KB)' });
        expect(host.textContent).toContain('mods.storageCache(size=0 B)');
        expect(clearButton().disabled).toBe(true);
    });

    it('reports a partial clear as an error and still shows what is left', async () => {
        store.getModStorageUsage
            .mockResolvedValueOnce({ ok: true, data: 0, cache: 4096 })
            .mockResolvedValueOnce({ ok: true, data: 0, cache: 512 });
        store.clearModCache.mockResolvedValue({ ok: false, error: 'cache-clear-partial', cleared: 1 });
        const onNotice = await renderSection();
        await act(async () => { clearButton().click(); });
        expect(onNotice).toHaveBeenCalledWith({
            kind: 'error',
            text: 'mods.errors.cache-clear-partial(value=cache-clear-partial)',
        });
        expect(host.textContent).toContain('mods.storageCache(size=512 B)');
        expect(clearButton().disabled).toBe(false);
    });

    it('drops the old sizes when the re-count after a clear fails', async () => {
        store.getModStorageUsage
            .mockResolvedValueOnce({ ok: true, data: 2048, cache: 1536 })
            .mockResolvedValueOnce({ ok: false, error: 'storage-usage-failed' });
        store.clearModCache.mockResolvedValue({ ok: true, cleared: 2 });
        const onNotice = await renderSection();
        await act(async () => { clearButton().click(); });
        // How much went is unknown, so the notice does not claim the whole old cache.
        expect(onNotice).toHaveBeenCalledWith({ kind: 'ok', text: 'mods.cacheClearedUncounted(name=Mod B)' });
        expect(host.textContent).toContain('mods.errors.storage-usage-failed');
        expect(host.textContent).not.toContain('mods.storageCache');
        expect(clearButton().disabled).toBe(true);
    });

    it('drops the old sizes when the re-count after a partial clear fails', async () => {
        store.getModStorageUsage
            .mockResolvedValueOnce({ ok: true, data: 0, cache: 4096 })
            .mockResolvedValueOnce({ ok: false, error: 'storage-usage-failed' });
        store.clearModCache.mockResolvedValue({ ok: false, error: 'cache-clear-partial', cleared: 1 });
        const onNotice = await renderSection();
        await act(async () => { clearButton().click(); });
        expect(onNotice).toHaveBeenCalledWith({
            kind: 'error',
            text: 'mods.errors.cache-clear-partial(value=cache-clear-partial)',
        });
        expect(host.textContent).toContain('mods.errors.storage-usage-failed');
        expect(host.textContent).not.toContain('size=4 KB');
    });

    it('says so when the usage cannot be counted', async () => {
        store.getModStorageUsage.mockResolvedValue({ ok: false, error: 'storage-usage-failed' });
        await renderSection();
        expect(host.textContent).toContain('mods.errors.storage-usage-failed');
        expect(clearButton().disabled).toBe(true);
    });
});

describe('mod row storage section', () => {
    const renderRow = async (mod: ModRuntimeInfo, expanded: boolean) => {
        await act(async () => {
            root!.render(React.createElement(ModListItem, {
                mod,
                expanded,
                selected: false,
                selectionMode: false,
                isLast: true,
                isDaylight: false,
                theme: { secondaryColor: '#888888' } as Theme,
                classes,
                onToggleExpand: () => {},
                onToggleEnabled: () => {},
                onToggleSelected: () => {},
                onNotice: () => {},
            }));
        });
    };

    beforeEach(() => {
        store.getModStorageUsage.mockResolvedValue({ ok: true, data: 0, cache: 0 });
    });

    it('counts nothing while the row is collapsed', async () => {
        await renderRow(modInfo(), false);
        expect(host.querySelector('[data-mod-storage]')).toBeNull();
        expect(store.getModStorageUsage).not.toHaveBeenCalled();
    });

    it('appears in the expanded row of a mod that declares storage', async () => {
        await renderRow(modInfo(), true);
        expect(host.querySelector('[data-mod-storage="mod-b"]')).not.toBeNull();
        expect(store.getModStorageUsage).toHaveBeenCalledWith('mod-b');
    });

    it('stays away from a mod without storage', async () => {
        await renderRow(modInfo({ permissions: ['net.fetch'] }), true);
        expect(host.querySelector('[data-mod-storage]')).toBeNull();
        expect(store.getModStorageUsage).not.toHaveBeenCalled();
    });
});
