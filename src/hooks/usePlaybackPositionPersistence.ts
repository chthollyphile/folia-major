import { useEffect, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import {
    clearPlaybackPositionSnapshot,
    persistPlaybackPosition,
} from '../components/app/playback/playbackPositionCache';
import type { SongResult } from '../types';

// src/hooks/usePlaybackPositionPersistence.ts
// 节流保存当前播放进度，供"启动时记住上一次播放进度"使用。

const PERSIST_INTERVAL_MS = 5000;

type UsePlaybackPositionPersistenceParams = {
    enabled: boolean;
    currentSong: SongResult | null;
    currentTime: MotionValue<number>;
    duration: number;
    isPlaying: boolean;
};

/**
 * 播放进度是逐帧变化的连续值，这里只读取 MotionValue 的瞬时值并节流写入 IndexedDB，
 * 不订阅高频变化事件，也不把播放时间放进 React state。
 */
export function usePlaybackPositionPersistence({
    enabled,
    currentSong,
    currentTime,
    duration,
    isPlaying,
}: UsePlaybackPositionPersistenceParams) {
    // 保存动作依赖的都是随时可能变化的值，用 ref 承接以免重建定时器。
    const snapshotSourceRef = useRef({ enabled, currentSong, currentTime, duration });
    snapshotSourceRef.current = { enabled, currentSong, currentTime, duration };

    const persistNow = useRef(() => {
        const { enabled: isEnabled, currentSong: song, currentTime: time, duration: total } = snapshotSourceRef.current;
        if (!isEnabled || !song) {
            return;
        }

        void persistPlaybackPosition(song, time.get(), Number.isFinite(total) && total > 0 ? total : null);
    });

    // 关闭设置后清掉历史记录，避免下次开启时恢复到很久以前的位置。
    useEffect(() => {
        if (enabled) {
            return;
        }

        void clearPlaybackPositionSnapshot();
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !isPlaying) {
            return;
        }

        const timer = window.setInterval(() => persistNow.current(), PERSIST_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [enabled, isPlaying]);

    // 暂停的瞬间落一次盘，用户暂停后直接关闭应用也不会丢进度。
    useEffect(() => {
        if (!enabled || isPlaying) {
            return;
        }

        persistNow.current();
    }, [enabled, isPlaying]);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const handlePageHide = () => persistNow.current();
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                persistNow.current();
            }
        };

        window.addEventListener('pagehide', handlePageHide);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [enabled]);
}
