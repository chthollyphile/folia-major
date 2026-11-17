import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { fmLookaheadWanted, topUpPersonalFm } from './personalFmLookahead';

// src/components/app/playback/start/usePersonalFmLookahead.ts
// 私人 FM 里正在播放的歌一落到队列最后两首就提前续一批（personalFmLookahead.ts）。每首歌最多试一次：
// 电台给回来的全是队列里已有的歌时，不对同一首反复请求，留给「下一首」自己再续。舞台接管播放时不续。

export function usePersonalFmLookahead(isNowPlayingStageActive: boolean) {
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const triedKeyRef = useRef<string | null>(null);
    const inFlightRef = useRef(false);

    useEffect(() => {
        if (isNowPlayingStageActive || inFlightRef.current || !currentSong) return;
        if (!fmLookaheadWanted(isFmMode, playQueue, currentSong)) return;
        const songKey = getPlaybackSongKey(currentSong);
        if (triedKeyRef.current === songKey) return;
        triedKeyRef.current = songKey;
        inFlightRef.current = true;
        void topUpPersonalFm(currentSong).finally(() => { inFlightRef.current = false; });
    }, [currentSong, isFmMode, isNowPlayingStageActive, playQueue]);
}
