import { describe, expect, it } from 'vitest';
import type { LocalSong } from '@/types';
import { buildLocalSongLyricMatchContext, shouldRefreshLocalSongLyricsFromMetadata, shouldRunLocalSongAutomaticMatch } from '@/utils/lyrics/localSongMatchContext';

// test/unit/lyrics/localSongMatchContext.test.ts

const song = (patch: Partial<LocalSong> = {}): LocalSong => ({
    id: 'local-song',
    fileName: 'wrong-file-name.flac',
    filePath: 'Library/wrong-file-name.flac',
    title: 'Wrong title',
    titleOrigin: 'import',
    importedMetadata: { title: 'Wrong title', titleSource: 'filename', artistNames: ['Wrong artist'], albumName: 'Wrong album' },
    duration: 200000,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
    ...patch,
});

describe('localSongMatchContext', () => {
    it('uses the selected online identity and metadata for lyric matching', () => {
        const context = buildLocalSongLyricMatchContext(song({
            title: 'Correct title',
            titleOrigin: 'manual-match',
            onlineMetadata: {
                source: 'qq',
                songId: 'selected-mid',
                title: 'Correct title',
                artists: [{ name: 'Correct artist' }],
                album: { name: 'Correct album' },
                matchMode: 'manual',
                matchedAt: 1,
            },
        }));

        expect(context).toEqual({
            title: 'Correct title',
            artist: 'Correct artist',
            album: 'Correct album',
            durationMs: 200000,
            metadataCandidate: { source: 'qq', songId: 'selected-mid' },
        });
    });

    it('keeps a stored candidate as an accelerator after restoring the imported title', () => {
        const context = buildLocalSongLyricMatchContext(song({
            onlineMetadata: {
                source: 'netease', songId: 321, title: 'Ignored online title', artists: [], matchMode: 'manual', matchedAt: 1,
            },
        }));

        expect(context.title).toBe('Wrong title');
        expect(context.metadataCandidate).toEqual({ source: 'netease', songId: 321 });
    });

    it('uses resolved entity names as the canonical lyric search start', () => {
        const context = buildLocalSongLyricMatchContext(song(), {
            artistNames: ['Renamed Artist'],
            albumName: 'Merged Album',
        });

        expect(context).toMatchObject({
            title: 'Wrong title',
            artist: 'Renamed Artist',
            album: 'Merged Album',
        });
    });

    it('lets an explicit metadata selection bypass a stale no-auto-match flag', () => {
        expect(shouldRunLocalSongAutomaticMatch(song({ noAutoMatch: true }))).toBe(false);
        expect(shouldRunLocalSongAutomaticMatch(song({
            noAutoMatch: true,
            onlineMetadata: { source: 'netease', songId: 321, artists: [], matchMode: 'manual', matchedAt: 1 },
        }))).toBe(true);
    });

    it('refreshes a legacy automatic lyric result once but preserves manual lyrics', () => {
        const selectedMetadata = {
            onlineMetadata: { source: 'netease' as const, songId: 321, artists: [], matchMode: 'manual' as const, matchedAt: 1 },
            matchedLyrics: { lines: [], isWordByWord: true },
        };
        expect(shouldRefreshLocalSongLyricsFromMetadata(song(selectedMetadata))).toBe(true);
        expect(shouldRefreshLocalSongLyricsFromMetadata(song({
            ...selectedMetadata,
            matchedLyricsSongId: 321,
        }))).toBe(false);
        expect(shouldRefreshLocalSongLyricsFromMetadata(song({
            ...selectedMetadata,
            hasManualLyricSelection: true,
        }))).toBe(false);
    });
});
