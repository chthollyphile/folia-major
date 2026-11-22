import type { SongResult } from '../../../../types';
import type { LocalSongMetadataSource } from '../../../../types/localLibrary';
import { participants } from '../../../../services/onlineMusic/crossSource';
import { omni } from '../../../../services/onlineMusic/omni';

// src/components/app/playback/start/navidromeLyricFallback.ts
// A Navidrome song's last try for lyrics, when no best match was found: the first hit of a plain search on the
// first source that can match a song from elsewhere now (plan §7.1, crossSource.ts), in the metadata order. With
// the nine there that is the source this always asked; with none ready, nothing is searched, and that is no failure.

export interface NavidromeLyricFallback {
    source: LocalSongMetadataSource;
    song: SongResult;
    lyrics: Awaited<ReturnType<typeof omni.getLyrics>>;
}

/** Searches `query` on the first ready metadata source and fetches the first hit's lyrics; null when none is ready or found. */
export const findNavidromeLyricFallback = async (query: string): Promise<NavidromeLyricFallback | null> => {
    const source = participants('metadata', { report: true }).ready[0] as LocalSongMetadataSource | undefined;
    if (!source) {
        console.info('[NaviPlay] No online source can match this song now; lyric match skipped');
        return null;
    }
    const page = await omni.searchProviderSongs(source, query, { limit: 1, offset: 0 });
    if (page.items.length === 0) return null;
    const song = page.items[0];
    return { source, song, lyrics: await omni.getLyrics(song) };
};
