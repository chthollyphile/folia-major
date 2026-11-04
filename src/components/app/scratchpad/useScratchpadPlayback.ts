import { useMemo, useRef } from 'react';
import type { SongResult } from '../../../types';
import type { PlaybackNavigationOptions } from '../../../types/appPlayback';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { createLibraryPlaybackPort } from '../../../library/app/createLibraryPlaybackPort';
import type { HomeSurfaceProps } from '../home/homeSurfaceTypes';
import type { ScratchpadPlayback, ScratchpadQueuePort } from './ScratchpadHost';

// src/components/app/scratchpad/useScratchpadPlayback.ts
// 速记簿的播放动作：入队、整本入队、替换队列走资料库的同一个播放端口（按来源分流的入队规则只有一份），
// 单条播放走队列控制器的「插进队列并播放」。另有「播放队列」页的动作（useScratchpadQueuePort）。

export const useScratchpadPlayback = (
    surfaceProps: HomeSurfaceProps,
    playNow: (song: SongResult) => void,
): ScratchpadPlayback => useMemo(() => {
    const port = createLibraryPlaybackPort(surfaceProps);
    return {
        playNow,
        enqueue: port.enqueueTrack,
        enqueueAll: songs => {
            port.enqueueAll(songs);
        },
        replaceQueue: port.playAll,
    };
}, [playNow, surfaceProps]);

/**
 * 速记簿「播放队列」页的动作。身份稳定（setQueueOrder 随队列每变一次换一个身份，这里经 ref 读最新的）；
 * 点歌播放时交给 playSong 的队列从 store 现读：刚提交的拖动草稿还没等到 App 重渲染。
 */
export const useScratchpadQueuePort = (
    playSong: (song: SongResult, queue: SongResult[], isFmCall: boolean, options: PlaybackNavigationOptions) => unknown,
    setQueueOrder: (order: SongResult[]) => void,
): ScratchpadQueuePort => {
    const latest = useRef({ playSong, setQueueOrder });
    latest.current = { playSong, setQueueOrder };
    return useMemo(() => ({
        playSong: song => {
            // 私人 FM 时按 FM 播：传 false 会把 FM 关掉，FM 那一批歌变成普通队列、不再续歌。
            const { playQueue, isFmMode } = usePlaybackStore.getState();
            void latest.current.playSong(song, playQueue, isFmMode, { shouldNavigateToPlayer: false });
        },
        setOrder: order => latest.current.setQueueOrder(order),
    }), []);
};
