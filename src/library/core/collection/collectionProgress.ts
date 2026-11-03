// src/library/core/collection/collectionProgress.ts
// 大歌单要分几十页补齐，只写「加载中」用户会以为歌丢了；拿得到总数就把「已加载 / 总数」写出来。
// 返回已本地化的数字串，文案由各个 renderer 自己翻译。

export type CollectionSyncCounts = { loaded: string; total: string };

/** 拿得到有效总数时返回进度计数，否则返回 null（界面退回「加载中」）。 */
export const resolveCollectionSyncCounts = (
    loadedCount: number,
    totalCount: number | undefined,
): CollectionSyncCounts | null => (
    typeof totalCount === 'number' && totalCount > 0
        ? { loaded: loadedCount.toLocaleString(), total: totalCount.toLocaleString() }
        : null
);
