import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import { matchLyrics } from '@/services/localMusicService';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { applyMatchedMetadata } from '@/services/localLibraryCatalogService';
import { neteaseApi } from '@/services/onlineMusic/netease/netease';
import { getLocalLibraryCatalogSnapshot } from '@/services/localLibraryEntityRepository';

// test/unit/services/localMusicLyricsMatch.test.ts

const lyricSettings = vi.hoisted(() => ({
    autoUseBestLyric: true,
    preferredAlternativeLyricSource: 'amll',
    localLyricsPriority: 'local' as 'local' | 'online',
}));

vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: vi.fn() }));
vi.mock('@/services/localLibraryCatalogService', () => ({ applyMatchedMetadata: vi.fn() }));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: vi.fn().mockResolvedValue({ entities: [], assignments: [] }),
}));
vi.mock('@/services/onlineMusic/netease/netease', () => ({
    neteaseApi: {
        cloudSearch: vi.fn(),
        getLyric: vi.fn(),
        getSongDetail: vi.fn(),
    },
}));
// Lyric sourcing moved to its own store; this suite drives it through the same fixture.
vi.mock('@/stores/useLyricSettingsStore', () => ({
    useLyricSettingsStore: {
        getState: () => lyricSettings,
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
        lyricSettings.localLyricsPriority = 'local';
        vi.mocked(applyMatchedMetadata).mockResolvedValue(undefined);
        vi.mocked(getLocalLibraryCatalogSnapshot).mockResolvedValue({ entities: [], assignments: [] });
    });

    it('never matches a song the user marked as instrumental', async () => {
        lyricSettings.localLyricsPriority = 'online';
        const marked = { ...song(), markedPureMusic: true, matchedIsPureMusic: true, hasManualLyricSelection: false };

        await expect(matchLyrics(marked)).resolves.toBeNull();

        expect(autoMatchBestLyric).not.toHaveBeenCalled();
        expect(neteaseApi.cloudSearch).not.toHaveBeenCalled();
        expect(applyMatchedMetadata).not.toHaveBeenCalled();
    });

    it('passes the selected metadata identity into playback matching without replacing it', async () => {
        const lyrics = { lines: [], isWordByWord: true };
        vi.mocked(autoMatchBestLyric).mockResolvedValue({
            lyrics,
            source: 'netease',
            id: 987,
            song: {
                id: 987,
                name: 'Correct title',
                artists: [{ id: 1, name: 'Correct artist' }],
                album: { id: 2, name: 'Correct album' },
                durationMs: 200000,
            },
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
            // 写回时在事务里按最新记录检查：匹配途中被标记为纯音乐就放弃。
            skipIfMarkedPureMusic: true,
            songPatch: expect.objectContaining({
                onlineMetadata: expect.objectContaining({ source: 'netease', songId: 987 }),
                matchedLyricsSongId: 987,
            }),
        }));
    });

    it('fetches and uses an online match when online lyrics are preferred over local lyrics', async () => {
        lyricSettings.localLyricsPriority = 'online';
        const lyrics = { lines: [], isWordByWord: true };
        vi.mocked(autoMatchBestLyric).mockResolvedValue({
            lyrics,
            source: 'netease',
            id: 987,
            song: {
                id: 987,
                name: 'Correct title',
                artists: [{ id: 1, name: 'Correct artist' }],
                album: { id: 2, name: 'Correct album' },
                durationMs: 200000,
            },
        });
        const localSong = {
            ...song(),
            hasLocalLyrics: true,
            localLyricsContent: '[00:00.00]Local lyrics',
        };

        await expect(matchLyrics(localSong)).resolves.toBe(lyrics);

        expect(autoMatchBestLyric).toHaveBeenCalledWith('Correct title', 'Correct artist', 200000, expect.objectContaining({
            preferredSource: 'amll',
        }));
        expect(localSong.matchedLyrics).toBe(lyrics);
    });
});
