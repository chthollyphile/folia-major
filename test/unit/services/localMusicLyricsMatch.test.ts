import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import { matchLyrics } from '@/services/localMusicService';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { applyMatchedMetadata } from '@/services/localLibraryCatalogService';
import { neteaseApi } from '@/services/netease';
import { getLocalLibraryCatalogSnapshot } from '@/services/localLibraryEntityRepository';

// test/unit/services/localMusicLyricsMatch.test.ts

vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: vi.fn() }));
vi.mock('@/services/localLibraryCatalogService', () => ({ applyMatchedMetadata: vi.fn() }));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: vi.fn().mockResolvedValue({ entities: [], assignments: [] }),
}));
vi.mock('@/services/netease', () => ({
    neteaseApi: {
        cloudSearch: vi.fn(),
        getLyric: vi.fn(),
        getSongDetail: vi.fn(),
    },
}));
vi.mock('@/stores/useSettingsUiStore', () => ({
    useSettingsUiStore: {
        getState: () => ({
            enableAlternativeLyricSources: true,
            autoUseBestLyric: true,
            preferredAlternativeLyricSource: 'amll',
        }),
    },
}));

const song = (): LocalSong => ({
    id: 'local-song',
    fileName: 'wrong-file.flac',
    filePath: 'Library/wrong-file.flac',
    title: 'Correct title',
    titleOrigin: 'manual-match',
    importedMetadata: { title: 'Wrong title', titleSource: 'filename', artistNames: ['Wrong artist'], albumName: 'Wrong album' },
    onlineMetadata: {
        source: 'netease', songId: 987, title: 'Correct title', artists: [{ name: 'Correct artist' }],
        album: { name: 'Correct album' }, matchMode: 'manual', matchedAt: 1,
    },
    duration: 200000,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
});

describe('localMusicService lyric matching', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(applyMatchedMetadata).mockResolvedValue(undefined);
        vi.mocked(getLocalLibraryCatalogSnapshot).mockResolvedValue({ entities: [], assignments: [] });
    });

    it('passes the selected metadata identity into playback matching without replacing it', async () => {
        const lyrics = { lines: [], isWordByWord: true };
        vi.mocked(autoMatchBestLyric).mockResolvedValue({
            lyrics,
            source: 'netease',
            id: 987,
        });
        const localSong = song();

        await expect(matchLyrics(localSong)).resolves.toBe(lyrics);

        expect(autoMatchBestLyric).toHaveBeenCalledWith('Correct title', 'Correct artist', 200000, {
            album: 'Correct album',
            preferredSource: 'amll',
            metadataCandidate: { source: 'netease', songId: 987 },
            exactMatchOnly: false,
        });
        expect(neteaseApi.cloudSearch).not.toHaveBeenCalled();
        expect(applyMatchedMetadata).toHaveBeenCalledWith('local-song', {}, expect.objectContaining({
            lyricsOnly: true,
            songPatch: expect.objectContaining({
                onlineMetadata: expect.objectContaining({ source: 'netease', songId: 987 }),
                matchedLyricsSongId: 987,
            }),
        }));
    });
});
