import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { canPlaySongInCurrentRoute } from '../../../../services/onlineMusic/songAvailability';
import type { SongResult } from '../../../../types';
import type { CollectionResource, CollectionResourceSnapshot } from '../../shared/resource.contract';
import type { LibraryCapability } from '../../shared/capability.contract';
import type { LibraryPlaybackPort } from '../../shared/ports.contract';
import { resolveReloadCapability, resolveScopeCapability } from '../collectionCapabilities';
import type { CollectionView } from '../useCollectionView';

// src/library/core/collection/mutations/useCollectionActions.ts
// 集合的语义动作：播放 / 入队 / 收进速记簿某首或当前范围、重新拉取、续传。回调保持稳定，执行时读最新的视图——
// 点击那一刻界面上的范围就是播放的范围，不会引用过期的列表。

export type CollectionActions = {
    capabilities: {
        scope: LibraryCapability;
        reload: LibraryCapability;
        /** 宿主的播放端口能收进速记簿（collectTracks 给了）。 */
        collect: boolean;
    };
    /** 这首是否可经当前播放链路播放 / 入队（不等于是否下架）。 */
    canPlayTrack: (track: SongResult) => boolean;
    /** 以当前范围（筛选后）为队列播放这首。 */
    playTrack: (track: SongResult) => void;
    /** 以整个集合的可播放曲目为队列播放这首（曲目侧栏的语义，忽略筛选）。 */
    playTrackInFullList: (track: SongResult) => void;
    enqueueTrack: (track: SongResult) => void;
    playScope: () => void;
    enqueueScope: () => void;
    /** 收进速记簿（不动队列），记下集合名。 */
    collectTrack: (track: SongResult) => void;
    collectScope: () => void;
    /** 这首能不能「收藏到歌单」（宿主给了选择器、来源也允许）。 */
    canSaveTrackToPlaylist: (track: SongResult) => boolean;
    /** 打开应用的歌单选择器放这一首（含「我喜欢」）。 */
    saveTrackToPlaylist: (track: SongResult) => void;
    reload: () => void;
    resumeSync: () => void;
};

export const useCollectionActions = ({
    resource,
    snapshot,
    view,
    port,
    collectionType,
    collectionName,
}: {
    resource: CollectionResource | null;
    snapshot: CollectionResourceSnapshot | null;
    view: CollectionView;
    port: LibraryPlaybackPort;
    collectionType?: string;
    /** 收进速记簿时记下的出处。 */
    collectionName?: string;
}): CollectionActions => {
    const { t } = useTranslation();
    const complete = collectionType !== 'library_songs' || snapshot?.librarySongs?.complete === true;
    const latest = useRef({ resource, view, port, collectionName, collectionType, complete, t });
    latest.current = { resource, view, port, collectionName, collectionType, complete, t };

    const status = snapshot?.status ?? 'idle';
    const scope = useMemo(
        () => resolveScopeCapability({ scopeCount: view.contextTracks.length, status, complete }),
        [complete, status, view.contextTracks.length],
    );
    const syncStatus = snapshot?.sync.status;
    const reload = useMemo(
        () => resolveReloadCapability({ kind: resource?.kind ?? 'static', status, collectionType, syncStatus }),
        [collectionType, resource?.kind, status, syncStatus],
    );

    const callbacks = useMemo(() => {
        const scopeIsComplete = () => {
            const current = latest.current;
            if (!current.complete) return false;
            // 刷新或注销可能先于 React 提交；不能让上一帧的命令绕过完整性限制。
            return current.collectionType !== 'library_songs'
                || current.resource?.getSnapshot().librarySongs?.complete === true;
        };
        const reportSkipped = () => {
            const { view: current, port: currentPort, t: translate } = latest.current;
            const skipped = (current.matchIndexes?.length ?? current.displayTracks.length) - current.contextTracks.length;
            if (skipped > 0) currentPort.statusMessage?.({ type: 'info', text: translate('librarySongs.skipped', { count: skipped }) });
        };
        return {
            canPlayTrack: canPlaySongInCurrentRoute,
            playTrack: (track: SongResult) => {
                if (canPlaySongInCurrentRoute(track)) latest.current.port.playTrack(track, latest.current.view.contextTracks);
            },
            playTrackInFullList: (track: SongResult) => {
                if (canPlaySongInCurrentRoute(track)) latest.current.port.playTrack(track, latest.current.view.playableTracks);
            },
            enqueueTrack: (track: SongResult) => {
                if (canPlaySongInCurrentRoute(track)) latest.current.port.enqueueTrack(track);
            },
            playScope: () => {
                if (!scopeIsComplete()) return;
                const tracks = latest.current.view.contextTracks;
                if (tracks.length > 0) latest.current.port.playAll(tracks);
                reportSkipped();
            },
            enqueueScope: () => {
                if (!scopeIsComplete()) return;
                const tracks = latest.current.view.contextTracks;
                if (tracks.length > 0) latest.current.port.enqueueAll(tracks);
                reportSkipped();
            },
            collectTrack: (track: SongResult) => {
                const { port: current, collectionName: name } = latest.current;
                current.collectTracks?.([track], name ? { label: name } : undefined);
            },
            collectScope: () => {
                const { port: current, view: currentView, collectionName: name } = latest.current;
                const tracks = currentView.contextTracks;
                if (tracks.length > 0) current.collectTracks?.(tracks, name ? { label: name } : undefined);
            },
            canSaveTrackToPlaylist: (track: SongResult) => {
                const current = latest.current.port;
                return Boolean(current.pickPlaylistFor && current.canPickPlaylistFor?.(track));
            },
            saveTrackToPlaylist: (track: SongResult) => {
                const current = latest.current.port;
                if (current.canPickPlaylistFor?.(track)) current.pickPlaylistFor?.([track]);
            },
            reload: () => latest.current.resource?.reload(),
            resumeSync: () => latest.current.resource?.resumeSync(),
        };
    }, []);

    const collect = Boolean(port.collectTracks);
    return useMemo(() => ({ ...callbacks, capabilities: { scope, reload, collect } }), [callbacks, collect, reload, scope]);
};
