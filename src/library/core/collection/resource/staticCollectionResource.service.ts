import type { SongResult } from '../../../../types';
import type { CollectionResource } from '../../shared/resource.contract';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { createCollectionResourceState } from './collectionResourceState.service';

// src/library/core/collection/resource/staticCollectionResource.service.ts
// 曲目已经在手里的集合（本地曲库算好的列表、探针里的固定数据）：没有请求，也没有分页。
// 曲目变了就换一个新资源，所以它不需要「重新加载」。

export const createStaticCollectionResource = (key: string, tracks: SongResult[]): CollectionResource => {
    const state = createCollectionResourceState(key, 'static', { status: 'ready', tracks });
    const commitTracks = (next: SongResult[]) => state.set({ tracks: next }, 'urgent');

    return {
        key,
        kind: 'static',
        getSnapshot: state.get,
        subscribe: state.subscribe,
        ensure: () => {},
        reload: () => {},
        resumeSync: () => {},
        canReuse: () => false,
        pause: () => {},
        dispose: state.clear,
        removeTracks: async (match) => {
            commitTracks(state.get().tracks.filter(track => !match(track)));
        },
        removeAt: (index, expectedKey) => {
            const current = state.get().tracks;
            if (!current[index] || getPlaybackSongKey(current[index]) !== expectedKey) return false;
            commitTracks(current.filter((_, position) => position !== index));
            return true;
        },
        replaceTrackAt: (index, expectedKey, next) => {
            const current = state.get().tracks;
            if (!current[index] || getPlaybackSongKey(current[index]) !== expectedKey) return false;
            commitTracks(current.map((track, position) => (position === index ? next : track)));
            return true;
        },
        replaceAll: async (load) => {
            commitTracks(await load());
            return true;
        },
    };
};
