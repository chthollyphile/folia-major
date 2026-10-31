import { useMemo } from 'react';
import type { SongResult } from '../../../types';
import { createLibraryPlaybackPort } from '../../../library/app/createLibraryPlaybackPort';
import type { HomeSurfaceProps } from '../home/homeSurfaceTypes';
import type { ScratchpadPlayback } from './ScratchpadHost';

// src/components/app/scratchpad/useScratchpadPlayback.ts
// 速记簿的播放动作：入队、整本入队、替换队列走资料库的同一个播放端口（按来源分流的入队规则只有一份），
// 单条播放走队列控制器的「插进队列并播放」。App 只调这一个 hook。

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
