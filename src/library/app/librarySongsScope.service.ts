import { useMemo } from 'react';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { OnlineProviderAccountState } from '../../stores/useOnlineProviderAccountStore';
import { useSearchNavigationStore } from '../../stores/useSearchNavigationStore';
import type { LibrarySongsAccessScope } from '../core/shared/resource.contract';
import { isOnlineHomeTab } from '../core/home/homeSources';
import type { LibraryHomeTabKey } from '../core/home/homeModel.contract';
import { invalidateLibrarySongsResources } from '../core/collection/resource/collectionResourceRegistry.service';

// 会话内全库结果跟随来源和账号，不跟随集合窗口；同步订阅防止退出后晚到的页重新填回内存。
const resolveAccessScope = (
    providerId: string,
    account: OnlineProviderAccountState | undefined,
    homeViewTab: LibraryHomeTabKey,
): LibrarySongsAccessScope | null => {
    const userId = account?.user?.id;
    return isOnlineHomeTab(homeViewTab)
        && userId !== undefined && account?.status !== 'anonymous' && account?.error !== 'auth-required'
        ? { providerId, userId }
        : null;
};

/** 宿主在拿资源前校验实时来源，防止过期账号或历史记录重新创建已清除的全库。 */
export const useLibrarySongsAccessScope = (): LibrarySongsAccessScope | null => {
    const providerId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const account = useOnlineProviderAccountStore(state => state.accounts[state.activeProviderId]);
    const homeViewTab = useSearchNavigationStore(state => state.homeViewTab);
    return useMemo(() => resolveAccessScope(providerId, account, homeViewTab), [account, homeViewTab, providerId]);
};

export const watchLibrarySongsScope = (invalidate = invalidateLibrarySongsResources): (() => void) => {
    let lastScope: string | undefined;
    const check = () => {
        const { activeProviderId: providerId, accounts } = useOnlineProviderAccountStore.getState();
        const scope = resolveAccessScope(providerId, accounts[providerId], useSearchNavigationStore.getState().homeViewTab);
        const key = scope ? JSON.stringify([scope.providerId, String(scope.userId)]) : '';
        if (key === lastScope) return;
        lastScope = key;
        invalidate(scope);
    };
    const stopAccount = useOnlineProviderAccountStore.subscribe(check);
    const stopNavigation = useSearchNavigationStore.subscribe(check);
    check();
    return () => {
        stopAccount();
        stopNavigation();
    };
};
