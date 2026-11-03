import type { SongResult } from '../../../../types';
import type { NavidromeGridViewCollectionDescriptor } from '../collection.contract';
import type { CollectionResource } from '../../shared/resource.contract';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { collectionRevision } from '../collectionIdentity';
import { createCollectionResourceState } from './collectionResourceState.service';
import { resolveNavidromeGridViewTracks } from './navidromeCollectionTracks.service';

// src/library/core/collection/resource/navidromeCollectionResource.service.ts
// Navidrome 集合资源：一次取完，不分页、不缓存。不复用：随机歌曲每次打开都应该重新抽。
// 读失败（抛错，或者服务没给回答、没配服务器）时是错误态（status 'error'），带着读到的那些歌（歌手可能读到了
// 一部分专辑）：页面据此知道列表不完整，空着时说「加载失败」而不是「这里没有歌」。

export type NavidromeTracksLoader = (descriptor: NavidromeGridViewCollectionDescriptor) => Promise<{ tracks: SongResult[]; failed: boolean }>;

const NAVIDROME_READ_FAILED = { kind: 'generic', message: '' } as const;

export const createNavidromeCollectionResource = (
    key: string,
    loadTracks: NavidromeTracksLoader = resolveNavidromeGridViewTracks,
): CollectionResource => {
    const state = createCollectionResourceState(key, 'navidrome');
    let generation = 0;
    let disposed = false;

    // 从头取一遍；更晚的一次加载或销毁会让这一次的结果作废。
    const load = async (descriptor: NavidromeGridViewCollectionDescriptor) => {
        const current = ++generation;
        state.set({ status: 'loading', tracks: [], generation: current, revision: collectionRevision(descriptor) }, 'urgent');
        let tracks: SongResult[] = [];
        let failed = false;
        try {
            ({ tracks, failed } = await loadTracks(descriptor));
        } catch (error) {
            console.error('[LibraryUi] Failed to load Navidrome collection tracks:', error);
            failed = true;
        }
        if (disposed || current !== generation) return;
        state.set(failed ? { status: 'error', tracks, error: NAVIDROME_READ_FAILED } : { status: 'ready', tracks, error: null }, 'urgent');
    };

    let started = false;

    return {
        key,
        kind: 'navidrome',
        getSnapshot: state.get,
        subscribe: state.subscribe,
        ensure: (descriptor) => {
            if (disposed || descriptor.source !== 'navidrome') return;
            if (started && state.get().revision === collectionRevision(descriptor)) return;
            started = true;
            void load(descriptor);
        },
        reload: () => {},
        resumeSync: () => {},
        canReuse: () => false,
        pause: () => {
            generation += 1;
        },
        dispose: () => {
            disposed = true;
            generation += 1;
            state.clear();
        },
        removeTracks: async (match) => {
            state.set({ tracks: state.get().tracks.filter(track => !match(track)) }, 'urgent');
        },
        removeAt: (index, expectedKey) => {
            const current = state.get().tracks;
            if (!current[index] || getPlaybackSongKey(current[index]) !== expectedKey) return false;
            state.set({ tracks: current.filter((_, position) => position !== index) }, 'urgent');
            return true;
        },
        replaceTrackAt: (index, expectedKey, next) => {
            const current = state.get().tracks;
            if (!current[index] || getPlaybackSongKey(current[index]) !== expectedKey) return false;
            state.set({ tracks: current.map((track, position) => (position === index ? next : track)) }, 'urgent');
            return true;
        },
        replaceAll: async (loadAll) => {
            state.set({ tracks: await loadAll() }, 'urgent');
            return true;
        },
    };
};
