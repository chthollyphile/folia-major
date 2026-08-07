import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getThemeRegistryEntries, upsertThemeRegistryEntries } from '@/services/db';

// Verifies the one-time localStorage migration into the dedicated IndexedDB registry store.

vi.mock('@/services/db', () => ({
    getThemeRegistryEntries: vi.fn(),
    upsertThemeRegistryEntries: vi.fn(),
}));

const LEGACY_KEY = 'folia_sync_theme_registry_v1';

const createLocalStorageMock = () => {
    const values = new Map<string, string>();
    return {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
        clear: vi.fn(() => values.clear()),
        key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
        get length() {
            return values.size;
        },
    } satisfies Storage;
};

const legacyRecord = {
    fingerprint: 'netease:id:42',
    cacheKey: 'dual_theme_42',
    updatedAt: '2026-07-01T00:00:00.000Z',
    source: 'manual' as const,
};

describe('themeSyncRegistry migration', () => {
    const getEntriesMock = vi.mocked(getThemeRegistryEntries);
    const upsertEntriesMock = vi.mocked(upsertThemeRegistryEntries);
    let localStorage: ReturnType<typeof createLocalStorageMock>;

    beforeEach(() => {
        vi.resetModules();
        getEntriesMock.mockReset();
        upsertEntriesMock.mockReset();
        localStorage = createLocalStorageMock();
        vi.stubGlobal('window', { localStorage });
        // Modules pulled in transitively read the bare `localStorage` global after a `typeof window` guard,
        // so stubbing it on `window` alone is not enough under the node test environment.
        vi.stubGlobal('localStorage', localStorage);
        vi.stubGlobal('indexedDB', {} as IDBFactory);
    });

    it('moves valid legacy records and removes localStorage after the write succeeds', async () => {
        localStorage.setItem(LEGACY_KEY, JSON.stringify({ [legacyRecord.fingerprint]: legacyRecord }));
        getEntriesMock.mockResolvedValueOnce([]).mockResolvedValueOnce([legacyRecord]);
        upsertEntriesMock.mockResolvedValue();

        const { readThemeSyncRegistry } = await import('@/services/sync/themeSyncRegistry');
        await expect(readThemeSyncRegistry()).resolves.toEqual({
            [legacyRecord.fingerprint]: legacyRecord,
        });

        expect(upsertEntriesMock).toHaveBeenCalledWith([legacyRecord]);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('does not overwrite a newer IndexedDB record during a retried migration', async () => {
        const newerRecord = { ...legacyRecord, updatedAt: '2026-07-02T00:00:00.000Z', source: 'edited' as const };
        localStorage.setItem(LEGACY_KEY, JSON.stringify({ [legacyRecord.fingerprint]: legacyRecord }));
        getEntriesMock.mockResolvedValueOnce([newerRecord]).mockResolvedValueOnce([newerRecord]);
        upsertEntriesMock.mockResolvedValue();

        const { readThemeSyncRegistry } = await import('@/services/sync/themeSyncRegistry');
        await expect(readThemeSyncRegistry()).resolves.toEqual({
            [newerRecord.fingerprint]: newerRecord,
        });

        expect(upsertEntriesMock).toHaveBeenCalledWith([]);
        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('keeps legacy localStorage data when the IndexedDB write fails', async () => {
        const raw = JSON.stringify({ [legacyRecord.fingerprint]: legacyRecord });
        localStorage.setItem(LEGACY_KEY, raw);
        getEntriesMock.mockResolvedValue([]);
        upsertEntriesMock.mockRejectedValue(new Error('write failed'));

        const { readThemeSyncRegistry } = await import('@/services/sync/themeSyncRegistry');
        await expect(readThemeSyncRegistry()).resolves.toEqual({});

        expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
    });
});
