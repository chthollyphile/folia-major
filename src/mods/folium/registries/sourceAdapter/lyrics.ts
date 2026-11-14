import type { ChorusRange, OnlineLyricsProvider } from '@/types/onlineMusic';
import type { FoliumSourceLyrics } from '../../sources/contract';
import { resolveFoliumSourceLyricsResult } from '../../lyricsSource';
import { toSourceSong } from '../sourceDtos';
import { finite, list, record, type SourceAdapterKit } from './kit';

// src/mods/folium/registries/sourceAdapter/lyrics.ts
// lyrics@1 as the host's internal `lyrics` (plan §4.5): the tracks the source hands are parsed by the host
// (lyricsSource.ts resolveFoliumSourceLyricsResult), `context.userId` goes on as the account's id, and the chorus
// ranges, the search alias, the other artist name and `prefersOwnWordByWord` are kept.

const toChorusRanges = (value: unknown): ChorusRange[] => list(value).flatMap((item) => {
    const range = record(item);
    const startTime = finite(range?.startTime);
    const endTime = finite(range?.endTime);
    return startTime !== undefined && endTime !== undefined && startTime >= 0 && startTime < endTime ? [{ startTime, endTime }] : [];
});

export const buildLyrics = (kit: SourceAdapterKit, lyrics: FoliumSourceLyrics): OnlineLyricsProvider => {
    const getChorusRanges = lyrics.getChorusRanges?.bind(lyrics);
    const getSearchAlias = lyrics.getSearchAlias?.bind(lyrics);
    const getAlternateArtistName = lyrics.getAlternateArtistName?.bind(lyrics);
    const built: OnlineLyricsProvider = {
        getLyrics: async (song, context) => resolveFoliumSourceLyricsResult(
            await kit.run('getLyrics', () => lyrics.getLyrics(toSourceSong(song), { userId: context?.userId == null ? null : String(context.userId) })),
            kit.label,
        ),
        ...(getChorusRanges ? {
            getChorusRanges: async (songId) => toChorusRanges(await kit.run('getChorusRanges', () => getChorusRanges(String(songId)))),
        } : {}),
        ...(getSearchAlias ? {
            getSearchAlias: async (song) => {
                const answer = record(await kit.run('getSearchAlias', () => getSearchAlias(toSourceSong(song))));
                if (!answer || typeof answer.title !== 'string' || typeof answer.artist !== 'string') return null;
                return { song, title: answer.title, artist: answer.artist, ...(typeof answer.album === 'string' ? { album: answer.album } : {}) };
            },
        } : {}),
        ...(getAlternateArtistName ? {
            getAlternateArtistName: async (song) => {
                const answer = await kit.run('getAlternateArtistName', () => getAlternateArtistName(toSourceSong(song)));
                return typeof answer === 'string' && answer ? answer : null;
            },
        } : {}),
    };
    Object.defineProperty(built, 'prefersOwnWordByWord', { enumerable: true, get: () => lyrics.prefersOwnWordByWord === true });
    return built;
};
