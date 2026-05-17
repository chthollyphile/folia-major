import { clearCacheByCategory } from '../../../services/db';
import { invalidatePrefetchedLyrics } from '../../../services/prefetchService';
import type { LyricData, StatusMessage } from '../../../types';

// src/components/app/home/createLyricFilterPatternSaver.ts

type CreateLyricFilterPatternSaverParams = {
    handleSetLyricFilterPattern: (pattern: string) => void;
    loadCurrentSongLyricPreview: () => Promise<LyricData | null>;
    setLyrics: (lyrics: LyricData | null) => void;
    setCurrentLineIndex: (index: number) => void;
    setStatusMsg: (message: StatusMessage | null) => void;
};

// Creates the Home-facing lyric filter save action without keeping the implementation in App.tsx.
export const createLyricFilterPatternSaver = ({
    handleSetLyricFilterPattern,
    loadCurrentSongLyricPreview,
    setLyrics,
    setCurrentLineIndex,
    setStatusMsg,
}: CreateLyricFilterPatternSaverParams) => {
    return async (pattern: string) => {
        handleSetLyricFilterPattern(pattern);
        await clearCacheByCategory('lyrics');
        invalidatePrefetchedLyrics();

        const previewLyrics = await loadCurrentSongLyricPreview();
        setLyrics(previewLyrics);
        setCurrentLineIndex(-1);
        setStatusMsg({ type: 'success', text: '歌词过滤规则已更新' });
    };
};
