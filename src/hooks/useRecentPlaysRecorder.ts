import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useRecentPlaysStore } from '../stores/useRecentPlaysStore';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// src/hooks/useRecentPlaysRecorder.ts
//
// 把「当前在播的歌」记进统一最近播放。挂在 App 顶层订阅一次即可，不改任何一处 setCurrentSong
// 调用点（那有十来个，逐个埋点既吵又容易漏）。
//
// 只在「换了一首不同的歌」时记：用 key 去重，seek / 重设同一首不会重复堆条目。
// 会话恢复（useSessionRestoreController）在启动时会把上次那首设回 currentSong —— 那本来就是
// 最近播过的，记一条无害且语义正确（它确实刚刚在播）。

export const useRecentPlaysRecorder = (): void => {
    const lastKeyRef = useRef<string | null>(null);

    useEffect(() => {
        const write = (song: ReturnType<typeof usePlaybackStore.getState>['currentSong']) => {
            if (!song) return;
            const key = getPlaybackSongKey(song);
            if (!key || key === lastKeyRef.current) return;
            lastKeyRef.current = key;
            useRecentPlaysStore.getState().record(song);
        };

        // 订阅时先对齐一次当前值：否则刚挂载时若在播一首歌，切到别的再切回来会因 lastKey 为 null
        // 把「本就在播」误记成一次新的播放。
        write(usePlaybackStore.getState().currentSong);

        return usePlaybackStore.subscribe((state, previous) => {
            if (state.currentSong === previous.currentSong) return;
            write(state.currentSong);
        });
    }, []);
};
