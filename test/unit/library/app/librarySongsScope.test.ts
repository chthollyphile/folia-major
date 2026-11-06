import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchLibrarySongsScope } from '@/library/app/librarySongsScope.service';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';

// 退出、换人、换平台与来源切换同步清掉全库；同一在线来源切页签、更新红心不丢会话结果。
vi.mock('@/library/core/collection/resource/collectionResourceRegistry.service', () => ({ invalidateLibrarySongsResources: vi.fn() }));
let stop: (() => void) | undefined;
beforeEach(() => {
    useOnlineProviderAccountStore.setState({ activeProviderId: 'p', accounts: {} });
    useOnlineProviderAccountStore.getState().updateAccount('p', { user: { id: 'a', nickname: 'A' }, status: 'authenticated' });
    useSearchNavigationStore.setState({ homeViewTab: 'playlist' });
});
afterEach(() => stop?.());

describe('account library session lifetime', () => {
    it('keeps a scope through same-source navigation and unrelated account updates', () => {
        const invalidate = vi.fn();
        stop = watchLibrarySongsScope(invalidate);
        expect(invalidate).toHaveBeenLastCalledWith({ providerId: 'p', userId: 'a' });
        useSearchNavigationStore.setState({ homeViewTab: 'albums' });
        useOnlineProviderAccountStore.getState().updateAccount('p', { likedSongIds: [1] });
        expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('invalidates immediately on logout and re-enters as a fresh same-id account', () => {
        const invalidate = vi.fn();
        stop = watchLibrarySongsScope(invalidate);
        useOnlineProviderAccountStore.getState().clearAccount('p');
        expect(invalidate).toHaveBeenLastCalledWith(null);
        useOnlineProviderAccountStore.getState().updateAccount('p', { user: { id: 'a', nickname: 'A' }, status: 'authenticated' });
        expect(invalidate.mock.calls.map(call => call[0])).toEqual([{ providerId: 'p', userId: 'a' }, null, { providerId: 'p', userId: 'a' }]);
    });

    it('revokes scope on expired credentials even if the previous user remains in the account snapshot', () => {
        const invalidate = vi.fn();
        stop = watchLibrarySongsScope(invalidate);
        useOnlineProviderAccountStore.getState().updateAccount('p', { error: 'auth-required' });
        expect(invalidate).toHaveBeenLastCalledWith(null);
    });

    it('replaces owner when the account or provider changes and clears when leaving online', () => {
        const invalidate = vi.fn();
        stop = watchLibrarySongsScope(invalidate);
        useOnlineProviderAccountStore.getState().updateAccount('p', { user: { id: 'b', nickname: 'B' } });
        expect(invalidate).toHaveBeenLastCalledWith({ providerId: 'p', userId: 'b' });
        useOnlineProviderAccountStore.getState().updateAccount('q', { user: { id: 'c', nickname: 'C' }, status: 'authenticated' });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'q' });
        expect(invalidate).toHaveBeenLastCalledWith({ providerId: 'q', userId: 'c' });
        useSearchNavigationStore.setState({ homeViewTab: 'local' });
        expect(invalidate).toHaveBeenLastCalledWith(null);
    });
});
