import type { FoliaPlaylist, FoliaPlaylistSummary } from '@/types/foliaPlaylist';

// test/unit/helpers/foliaPlaylistSummary.ts
// 单测里手写的一张完整歌单 → 界面常驻的那种摘要（存储里是写的时候算好的，见 foliaPlaylistStorage.ts）。

export const summaryOfFoliaPlaylist = (playlist: FoliaPlaylist): FoliaPlaylistSummary => {
    const { entries, ...info } = playlist;
    const coverLocalSongIds = entries.flatMap(entry => (entry.key.startsWith('local:') ? [entry.key.slice('local:'.length)] : []));
    const coverUrl = entries
        .filter(entry => !entry.key.startsWith('local:'))
        .map(entry => (entry.song as { album?: { coverUrl?: string } }).album?.coverUrl)
        .find(Boolean);
    return {
        ...info,
        entryCount: entries.length,
        ...(coverUrl ? { coverUrl } : {}),
        ...(coverLocalSongIds.length > 0 ? { coverLocalSongIds } : {}),
    };
};
