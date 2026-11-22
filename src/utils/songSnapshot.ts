import type { SongResult, UnifiedSong } from '../types';
import { normalizePlaybackSongSource } from './appPlaybackGuards';

// src/utils/songSnapshot.ts
// 一首歌存下来的样子，速记簿与 Folia 聚合歌单共用：两边的条目互相搬不用转换。

/** 存下来的样子：补上 sourceRef；本地歌只留 songId 引用（blob、文件句柄都不跨启动）。 */
export const toStoredSongSnapshot = (song: SongResult): SongResult => {
    // foliaOriginalKey 是歌单详情里那一行的记号（这一条换过来源），不跟着歌存到别处。
    const { foliaOriginalKey: _rowMark, ...unified } = normalizePlaybackSongSource(song) as UnifiedSong & { localData?: { id?: string } };
    const localSongId = unified.localRef?.songId || unified.localData?.id;
    if (!localSongId) return unified;
    const { localData: _legacyLocalData, ...snapshot } = unified;
    return { ...snapshot, isLocal: true, localRef: { songId: localSongId } } as UnifiedSong;
};
