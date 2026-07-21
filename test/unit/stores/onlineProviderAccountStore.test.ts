import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/onlineProviderAccountStore.test.ts

const createStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
    };
};

describe('online provider account store', () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.unstubAllGlobals());

    it('defaults legacy state to NetEase and persists the selected provider', async () => {
        const storage = createStorage();
        vi.stubGlobal('localStorage', storage);
        const { useOnlineProviderAccountStore } = await import('@/stores/useOnlineProviderAccountStore');

        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe('netease');
        useOnlineProviderAccountStore.getState().setActiveProviderId('kugou');

        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe('kugou');
        expect(storage.getItem('active_online_provider_id')).toBe('kugou');
    });

    it('keeps provider accounts isolated and does not switch on logout', async () => {
        vi.stubGlobal('localStorage', createStorage({ active_online_provider_id: 'kugou' }));
        const { useOnlineProviderAccountStore } = await import('@/stores/useOnlineProviderAccountStore');
        const store = useOnlineProviderAccountStore.getState();
        store.updateAccount('netease', { status: 'authenticated', user: { id: 1, nickname: 'Netease' } });
        store.updateAccount('kugou', { status: 'authenticated', user: { id: 2, nickname: 'Kugou' } });
        store.clearAccount('kugou');

        const state = useOnlineProviderAccountStore.getState();
        expect(state.accounts.netease.user?.nickname).toBe('Netease');
        expect(state.accounts.kugou).toMatchObject({ status: 'anonymous', user: null });
        expect(state.activeProviderId).toBe('kugou');
    });

    it('keeps the cloud collection in the second slot when collections refresh', async () => {
        vi.stubGlobal('localStorage', createStorage());
        const { useOnlineProviderAccountStore } = await import('@/stores/useOnlineProviderAccountStore');
        const first = { providerId: 'kugou' as const, id: 'first', name: 'First', type: 'playlist' as const };
        const cloud = { providerId: 'kugou' as const, id: 'cloud', name: 'Cloud', type: 'cloud' as const };
        const second = { providerId: 'kugou' as const, id: 'second', name: 'Second', type: 'playlist' as const };

        useOnlineProviderAccountStore.getState().updateAccount('kugou', {
            collections: [cloud, first, second],
        });

        expect(useOnlineProviderAccountStore.getState().accounts.kugou.collections).toEqual([first, cloud, second]);
    });

    it('preserves unchanged collection references during a silent refresh', async () => {
        vi.stubGlobal('localStorage', createStorage());
        const { useOnlineProviderAccountStore } = await import('@/stores/useOnlineProviderAccountStore');
        const original = { providerId: 'netease' as const, id: 1, name: 'Daily Mix', type: 'playlist' as const };
        useOnlineProviderAccountStore.getState().updateAccount('netease', { collections: [original] });
        const previousCollections = useOnlineProviderAccountStore.getState().accounts.netease.collections;

        useOnlineProviderAccountStore.getState().updateAccount('netease', {
            collections: [{ ...original }],
        });

        const nextCollections = useOnlineProviderAccountStore.getState().accounts.netease.collections;
        expect(nextCollections).toBe(previousCollections);
        expect(nextCollections[0]).toBe(original);
    });

    it('replaces only changed collection cards during a silent refresh', async () => {
        vi.stubGlobal('localStorage', createStorage());
        const { useOnlineProviderAccountStore } = await import('@/stores/useOnlineProviderAccountStore');
        const first = { providerId: 'netease' as const, id: 1, name: 'First', type: 'playlist' as const };
        const second = { providerId: 'netease' as const, id: 2, name: 'Second', type: 'playlist' as const };
        useOnlineProviderAccountStore.getState().updateAccount('netease', { collections: [first, second] });

        useOnlineProviderAccountStore.getState().updateAccount('netease', {
            collections: [{ ...first }, { ...second, name: 'Updated' }],
        });

        const collections = useOnlineProviderAccountStore.getState().accounts.netease.collections;
        expect(collections[0]).toBe(first);
        expect(collections[1]).not.toBe(second);
        expect(collections[1].name).toBe('Updated');
    });
});
