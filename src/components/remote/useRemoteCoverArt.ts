import { useEffect } from 'react';

// src/components/remote/useRemoteCoverArt.ts
// 遥控窗口的封面预读：提前把队列邻居的封面解码进浏览器缓存，
// 真正切歌时封面（以及用同一张图做的卡片底色）同帧到位，过渡不会先空一拍再补图。

type UseRemoteCoverArtParams = {
    prevTrackCoverUrl: string | null;
    nextTrackCoverUrl: string | null;
};

export const useRemoteCoverArt = ({ prevTrackCoverUrl, nextTrackCoverUrl }: UseRemoteCoverArtParams): void => {
    useEffect(() => {
        [nextTrackCoverUrl, prevTrackCoverUrl].forEach(url => {
            if (url) {
                const warmup = new Image();
                warmup.src = url;
            }
        });
    }, [nextTrackCoverUrl, prevTrackCoverUrl]);
};
