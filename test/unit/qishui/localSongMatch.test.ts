import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { normalizeLyricMatchMetadataCandidate } from '@/services/onlineMetadataSearchService';
import { buildLocalSongLyricMatchContext } from '@/utils/lyrics/localSongMatchContext';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { getLyricSourceAccess } from '@/utils/lyrics/lyricMatchSources';
import type { LocalSong, UnifiedSong } from '@/types';

// A stored manual selection must win over a different version ranked first during later lyric matching.
afterEach(() => vi.restoreAllMocks());

const selected: UnifiedSong = {
    id: '7123456789012345678', name: 'Selected song', artists: [{ id: 'artist', name: 'Artist' }],
    album: { id: 'album', name: 'Album' }, durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'qishui', mediaId: '7123456789012345678' },
};
const lyric = { lyrics: { lines: [{ fullText: 'Lyric', startTime: 0, endTime: 1, words: [] }], isWordByWord: true }, isPureMusic: false };
const matchLocal = async (results: UnifiedSong[]) => {
    const candidate = normalizeLyricMatchMetadataCandidate('qishui', selected, {
        title: selected.name, artist: 'Artist', album: 'Album', durationMs: 200000,
    });
    const local: LocalSong = {
        id: 'local-1', filePath: 'Library/song.flac', fileSize: 1, mimeType: 'audio/flac', addedAt: 1,
        titleOrigin: 'manual-match',
        title: candidate.title, fileName: 'song.flac', duration: candidate.durationMs, noAutoMatch: true,
        importedMetadata: { artistNames: [], title: 'song', titleSource: 'filename' },
        onlineMetadata: { ...candidate, matchMode: 'manual', matchedAt: 1 },
    };
    const context = buildLocalSongLyricMatchContext(local);
    const provider = getOnlineMusicProvider('qishui')!;
    vi.spyOn(provider, 'getAvailability').mockReturnValue({ configured: true });
    const search = vi.spyOn(provider.search!, 'searchSongs').mockResolvedValue({ items: results, hasMore: false, nextOffset: results.length });
    const fetch = vi.spyOn(provider.lyrics!, 'getLyrics').mockResolvedValue(lyric);
    const result = await autoMatchBestLyric(context.title, context.artist, context.durationMs, {
        album: context.album, preferredSource: 'qishui', metadataCandidate: context.metadataCandidate,
        exactMatchOnly: Boolean(context.metadataCandidate),
    });
    return { result, search, fetch };
};

describe('local-song Qishui metadata rematching', () => {
    it('keeps the selected track when a different version heads the search results', async () => {
        const other = { ...selected, id: 'other-version', sourceRef: { kind: 'online' as const, providerId: 'qishui', mediaId: 'other-version' } };
        const { result, fetch } = await matchLocal([other, selected]);
        expect(result).toMatchObject({ source: 'qishui', id: selected.id });
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toMatchObject({ id: selected.id, sourceRef: { providerId: 'qishui', mediaId: selected.id } });
    });
    it('fetches the selected track by its id, also when no search would list it', async () => {
        const { result, search, fetch } = await matchLocal([]);
        expect(search).not.toHaveBeenCalled();
        expect(result).toMatchObject({ source: 'qishui', id: '7123456789012345678' });
        // The 19-digit id stays exact text: as a number it would come out as 7123456789012345000.
        expect(fetch.mock.calls[0][0]).toMatchObject({ id: '7123456789012345678', sourceRef: { mediaId: '7123456789012345678' } });
    });
    it('knows a track id only as 1-30 digits', () => {
        const { knownById } = getLyricSourceAccess('qishui');
        expect(knownById?.('7123456789012345678')).toBe('7123456789012345678');
        expect(knownById?.('1'.repeat(30))).toBe('1'.repeat(30));
        expect(knownById?.(42)).toBe('42');
        for (const id of ['', '1'.repeat(31), 'abc', '12a', '-1', 7123456789012345678]) expect(knownById?.(id)).toBeNull();
    });
});
