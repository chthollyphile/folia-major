import type { CollectionLoadStatus, CollectionResourceKind } from '../shared/resource.contract';
import type { LibraryCapability } from '../shared/capability.contract';

// src/library/core/collection/collectionCapabilities.ts
// 集合动作的可用性：按钮、命令面板和任何 renderer 都问这里，同一个来源下给出同一个答案。

const UNSUPPORTED: LibraryCapability = { supported: false, enabled: false, pending: false, reason: 'unsupported' };

const isLoadingStatus = (status: CollectionLoadStatus) => status === 'idle' || status === 'loading';

/**
 * 跳过缓存重新拉取：只有能分页的在线集合有这个动作。每日推荐自带刷新，私人 FM 不分页，
 * 本地与 Navidrome 的曲目不来自在线缓存。加载中时可见但不可用。
 */
export const resolveReloadCapability = (input: {
    kind: CollectionResourceKind;
    status: CollectionLoadStatus;
    collectionType?: string;
}): LibraryCapability => {
    if (input.kind !== 'online' || input.collectionType === 'daily_recommendations' || input.collectionType === 'radio') {
        return UNSUPPORTED;
    }
    const pending = isLoadingStatus(input.status);
    return pending
        ? { supported: true, enabled: false, pending: true, reason: 'loading' }
        : { supported: true, enabled: true, pending: false };
};

/** 播放 / 入队当前范围：范围里有歌才可用；空的时候说明是还在加载还是确实没有。 */
export const resolveScopeCapability = (input: {
    scopeCount: number;
    status: CollectionLoadStatus;
}): LibraryCapability => {
    if (input.scopeCount > 0) return { supported: true, enabled: true, pending: false };
    const pending = isLoadingStatus(input.status);
    return { supported: true, enabled: false, pending, reason: pending ? 'loading' : 'empty' };
};
