import type { SongResult, UnifiedSong } from '../../types';
import i18next from 'i18next';
import { canPlaySongInCurrentRoute } from '../../services/onlineMusic/songAvailability';
import type { LibraryPlaybackPort } from '../core/shared/ports.contract';
import { resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { collectToScratchpad } from '../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../stores/useAddToPlaylistStore';

// src/library/app/createLibraryPlaybackPort.ts
// 把首页 surface 上的播放回调装配成 Library Core 的播放端口。核心层只说「播这首、以这些为队列」，
// 队列怎么建、本地与 Navidrome 走哪条入队路径，仍由应用现有的播放控制器决定。

type PlaybackSurface = Pick<
    HomeSurfaceProps,
    | 'onPlaySong'
    | 'onPlayAll'
    | 'onAddAllToQueue'
    | 'onAddSongToQueue'
    | 'onAddLocalSongToQueue'
    | 'onAddNavidromeSongsToQueue'
    | 'onTogglePlayback'
    | 'localSongs'
    | 'onStatusMessage'
>;

export const createLibraryPlaybackPort = (surface: PlaybackSurface): LibraryPlaybackPort => ({
    playTrack: (track, queue) => {
        if (canPlaySongInCurrentRoute(track)) surface.onPlaySong(track, queue.filter(canPlaySongInCurrentRoute));
    },
    playAll: tracks => {
        const playable = tracks.filter(canPlaySongInCurrentRoute);
        if (playable.length > 0) surface.onPlayAll?.(playable);
        const skipped = tracks.length - playable.length;
        if (skipped > 0) surface.onStatusMessage?.({ type: 'info', text: i18next.t('librarySongs.skipped', { count: skipped }) });
    },
    // 单曲入队按来源分流：本地歌交给本地队列，Navidrome 歌交出它的播放载体，其余走在线入队。
    enqueueTrack: (track: SongResult) => {
        if (!canPlaySongInCurrentRoute(track)) return;
        const unifiedTrack = track as UnifiedSong;
        const localSongId = unifiedTrack.localRef?.songId;
        const localSong = localSongId ? surface.localSongs.find(song => song.id === localSongId) : undefined;
        if (unifiedTrack.isLocal && localSong) {
            surface.onAddLocalSongToQueue?.(localSong);
            return;
        }
        if (unifiedTrack.isNavidrome) {
            const naviSong = resolveNavidromePlaybackCarrier(unifiedTrack);
            if (naviSong) {
                surface.onAddNavidromeSongsToQueue?.([naviSong]);
                return;
            }
        }
        surface.onAddSongToQueue?.(track);
    },
    // 选项与返回的条数原样转交：歌手页的「加入热门歌曲」靠它们静默队列提示、报出队列实际收下的数量。
    enqueueAll: (tracks, options) => {
        const playable = tracks.filter(canPlaySongInCurrentRoute);
        const skipped = tracks.length - playable.length;
        const count = playable.length > 0
            ? surface.onAddAllToQueue?.(playable, skipped > 0 ? { ...options, suppressToast: true } : options)
            : undefined;
        if (skipped > 0) surface.onStatusMessage?.({ type: 'info', text: i18next.t('librarySongs.skipped', { count: skipped }) });
        return count;
    },
    statusMessage: surface.onStatusMessage,
    // fb3：宿主的播放开关原样转交（「留在原处」时网格卡片上正在播放的那首的播放键用它）。
    togglePlayback: surface.onTogglePlayback,
    // 速记簿：收进来不动队列（提示由速记簿自己报）。
    collectTracks: (tracks, origin) => {
        collectToScratchpad(tracks, origin);
    },
    // 卡片上的「收藏到歌单」：应用的歌单选择器（与播放页的星标同一个），按歌自己的来源列歌单，在线歌还有「我喜欢」。
    pickPlaylistFor: tracks => {
        if (tracks.length > 0) openAddSongsToPlaylist(tracks);
    },
    canPickPlaylistFor: canOpenPlaylistPickerFor,
});
