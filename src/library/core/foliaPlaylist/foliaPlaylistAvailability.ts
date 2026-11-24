import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import type { FoliaEntryAvailability, FoliaEntryAvailabilityDeps, FoliaPlaylistEntry } from './foliaPlaylist.contract';

// src/library/core/foliaPlaylist/foliaPlaylistAvailability.ts
// Folia 聚合歌单的一条条目，它的来源现在还在不在（纯规则）：歌单页据此把行画成不可用，整张播放时据此跳过。

export const resolveFoliaEntryAvailability = (
    entry: Pick<FoliaPlaylistEntry, 'song'>,
    deps: FoliaEntryAvailabilityDeps,
): FoliaEntryAvailability => {
    const source = getPlaybackSourceRef(entry.song);
    if (source.kind === 'local') {
        return deps.hasLocalSong(source.mediaId) ? { state: 'available' } : { state: 'local-missing' };
    }
    if (source.kind === 'navidrome') {
        return deps.isNavidromeConfigured() ? { state: 'available' } : { state: 'navidrome-unconfigured' };
    }
    if (source.kind === 'online') {
        const sourceId = source.providerId;
        // 先看开关：被关掉的音源模组不会加载，也就不会注册。
        if (!deps.isSourceSwitchedOn(sourceId)) return { state: 'source-off', sourceId };
        if (!deps.isSourceRegistered(sourceId)) return { state: 'source-missing', sourceId };
    }
    return { state: 'available' };
};

/** 能去播的那些条目，顺序不变（整张播放时用）。 */
export const filterPlayableFoliaEntries = <T extends Pick<FoliaPlaylistEntry, 'song'>>(
    entries: readonly T[],
    deps: FoliaEntryAvailabilityDeps,
): T[] => entries.filter(entry => resolveFoliaEntryAvailability(entry, deps).state === 'available');
