import type { LocalSong, SongResult } from '../../../src/types';
import type { NavidromeSong } from '../../../src/types/navidrome';
import type { HomeSurfaceProps } from '../../../src/components/app/home/homeSurfaceTypes';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import { setStatusMessage } from '../../../src/stores/useStatusMessageStore';
import { recordProbeCall } from './probeLog';

// dev/probes/libraryBehavior/probeSurfaceCallbacks.ts
// 两个行为探针（集合详情 libraryBehavior、首页 homeBehavior）共用的「假 App」回调：播放、入队、状态消息
// 全部只记账不执行。宿主与首页拿到的是同一组回调，所以两边的断言读的是同一本账。

export const probeSongKeys = (songs: SongResult[] | undefined): string[] => (songs ?? []).map(getPlaybackSongKey);

export type ProbeSurfaceCallbacks = Pick<
    HomeSurfaceProps,
    | 'onPlaySong'
    | 'onPlayAll'
    | 'onAddAllToQueue'
    | 'onAddSongToQueue'
    | 'onAddLocalSongToQueue'
    | 'onAddNavidromeSongsToQueue'
    | 'onStatusMessage'
    | 'onBackToPlayer'
    | 'onTogglePlayback'
    | 'onEnterPlaybackView'
>;

/**
 * 整批入队的「假队列」：照应用的播放控制器（usePlaybackQueueController.addOnlineSongsToQueue）的契约——
 * 已经在队列里的歌不再加，返回真正加进去的条数；没要求静默时自己在全局 toast 通道上弹一条提示
 * （控制器弹的是 status.added_to_play_queue；这里用固定的探针文案，用例一眼能分出是谁弹的）。用例用 seedProbeQueue 预置队列，制造「加进去的比交来的少」。
 */
const probeQueue = new Set<string>();
export const PROBE_QUEUE_TOAST_TEXT = 'probe: added to play queue';

export const resetProbeQueue = (): void => probeQueue.clear();
export const seedProbeQueue = (keys: string[]): void => {
    keys.forEach(key => probeQueue.add(key));
};

/** 一组只记账的播放 / 入队 / 状态消息回调（模块级常量即可，身份稳定）。 */
export const PROBE_SURFACE_CALLBACKS: ProbeSurfaceCallbacks = {
    onPlaySong: (song, queue, isFmCall) => recordProbeCall({
        kind: 'playSong',
        ids: probeSongKeys([song]),
        queueIds: probeSongKeys(queue),
        ...(isFmCall ? { isFm: true } : {}),
    }),
    onPlayAll: (songs, _from, options) => recordProbeCall({
        kind: 'playAll',
        ids: probeSongKeys(songs),
        ...(options?.shuffle ? { shuffle: true } : {}),
    }),
    onAddAllToQueue: (songs, options) => {
        const keys = probeSongKeys(songs);
        const added = keys.filter(key => !probeQueue.has(key));
        added.forEach(key => probeQueue.add(key));
        recordProbeCall({
            kind: 'addAllToQueue',
            ids: keys,
            accepted: added.length,
            ...(options?.suppressToast ? { suppressToast: true } : {}),
        });
        if (added.length > 0 && !options?.suppressToast) {
            setStatusMessage({ type: 'success', text: PROBE_QUEUE_TOAST_TEXT, nonce: Date.now(), durationMs: 1200 });
        }
        return added.length;
    },
    onAddSongToQueue: song => recordProbeCall({ kind: 'addSongToQueue', ids: probeSongKeys([song]) }),
    onAddLocalSongToQueue: (song: LocalSong) => recordProbeCall({ kind: 'addLocalSongToQueue', ids: [song.id] }),
    onAddNavidromeSongsToQueue: (songs: NavidromeSong[]) => recordProbeCall({
        kind: 'addNavidromeSongsToQueue',
        ids: songs.map(song => song.navidromeData?.id ?? String(song.id)),
    }),
    onStatusMessage: message => recordProbeCall({ kind: 'statusMessage', ids: [], text: message.text, status: message.type }),
    onBackToPlayer: () => recordProbeCall({ kind: 'backToPlayer', ids: [] }),
    // fb3：只记账（播放状态由用例经 __homeProbe.setNowPlaying 摆）。
    onTogglePlayback: () => recordProbeCall({ kind: 'togglePlayback', ids: [] }),
    onEnterPlaybackView: () => recordProbeCall({ kind: 'enterPlaybackView', ids: [] }),
};
