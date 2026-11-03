import type { SongResult } from '../../../src/types';
import type { CollectionResource } from '../../../src/library/core/shared/resource.contract';
import { createCollectionResourceState } from '../../../src/library/core/collection/resource/collectionResourceState.service';

// dev/probes/gridEntrancePerf/scriptedPagingResource.ts
// 按真实在线集合的节奏「分页到达」的资源：先给 150 首首页，之后每 100ms 一页 1000 首，全部作为
// 后台更新（与在线资源一致），用来量网格在分页过程中付出的主线程成本。不发任何请求。

export const createScriptedPagingResource = (key: string, tracks: SongResult[]): CollectionResource => {
    const state = createCollectionResourceState(key, 'online', { status: 'loading' });
    let loaded = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const step = () => {
        if (disposed) return;
        loaded = loaded === 0 ? Math.min(150, tracks.length) : Math.min(tracks.length, loaded + 1000);
        state.set({
            status: 'ready',
            tracks: tracks.slice(0, loaded),
            sync: loaded < tracks.length ? { status: 'syncing' } : { status: 'none' },
        }, 'background');
        if (loaded < tracks.length) {
            timer = setTimeout(step, 100);
        }
    };
    timer = setTimeout(step, 0);

    return {
        key,
        kind: 'online',
        getSnapshot: state.get,
        subscribe: state.subscribe,
        ensure: () => {},
        reload: () => {},
        resumeSync: () => {},
        canReuse: () => false,
        pause: () => {},
        dispose: () => {
            disposed = true;
            if (timer) clearTimeout(timer);
            state.clear();
        },
        removeTracks: async () => {},
        removeAt: () => false,
        replaceTrackAt: () => false,
        replaceAll: async () => false,
    };
};
