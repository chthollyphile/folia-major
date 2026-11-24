import { useEffect } from 'react';
import { create } from 'zustand';
import { readStoredString, setStoredString } from '../../stores/storagePrimitives';
import { countMusicNotesModSongs } from './musicNotesModDatabase';

// src/components/song-notes/songNotesModHint.ts
// 「时刻」页的一次性提示：这台设备上有「音乐笔记」模组的库时，告诉用户可以导入（入口在设置 · 存储与备份「备份与导入」）。
// 用户点了「去导入」或「不再提示」，或者从模组导入过一次，就不再提示（记在 localStorage）。一次启动只看一次库。

const HINT_KEY = 'song_notes_music_notes_hint';

type HintState = { done: boolean; count: number; checked: boolean };

const useHintStore = create<HintState>(() => ({ done: readStoredString(HINT_KEY) === 'done', count: 0, checked: false }));

export const markMusicNotesModHintDone = (): void => {
    try {
        setStoredString(HINT_KEY, 'done');
    } catch {
        // 存不上就只在这次启动里不再提示。
    }
    useHintStore.setState({ done: true });
};

/** 模组库里有几首歌、还该不该提示：该提示时是歌数，否则 0。`enabled` 为 false 时不去看库。 */
export const useMusicNotesModHint = (enabled: boolean): number => {
    const done = useHintStore(state => state.done);
    const count = useHintStore(state => state.count);
    useEffect(() => {
        if (!enabled || done || useHintStore.getState().checked) return;
        useHintStore.setState({ checked: true });
        void countMusicNotesModSongs().then(found => useHintStore.setState({ count: found }));
    }, [done, enabled]);
    return done ? 0 : count;
};
