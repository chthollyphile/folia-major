import type { LocalSong } from '../../types';
import { getPlatformLyricSource, type PlatformLyricSource } from './lyricSources';

// src/utils/lyrics/localSongMatchContext.ts

export interface LocalSongMetadataLyricCandidate {
    source: PlatformLyricSource;
    songId: number | string;
}

export interface LocalSongLyricMatchContext {
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    metadataCandidate?: LocalSongMetadataLyricCandidate;
}

export interface ResolvedLocalSongLyricMetadata {
    artistNames: string[];
    albumName?: string;
}

const stripAudioExtension = (fileName: string): string => (
    fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '')
);

// Uses the canonical title for scoring and the latest provider identity only as a lookup accelerator.
export const buildLocalSongLyricMatchContext = (
    song: LocalSong,
    resolvedMetadata?: ResolvedLocalSongLyricMetadata,
): LocalSongLyricMatchContext => {
    const title = song.title || stripAudioExtension(song.fileName);
    const artist = resolvedMetadata?.artistNames.join(', ')
        || song.onlineMetadata?.artists.map(item => item.name).join(', ')
        || song.importedMetadata.artistNames.join(', ');
    const album = resolvedMetadata?.albumName
        || song.onlineMetadata?.album?.name
        || song.importedMetadata.albumName
        || '';
    const source = getPlatformLyricSource(song.onlineMetadata?.source);
    const songId = song.onlineMetadata?.songId;
    const hasSelectedIdentity = source?.localMetadataIdentity === true
        && songId !== undefined
        && songId !== null
        && String(songId).trim() !== '';

    return {
        title,
        artist,
        album,
        durationMs: song.duration || 0,
        ...(hasSelectedIdentity ? {
            metadataCandidate: {
                source: source.id,
                songId,
            },
        } : {}),
    };
};

// Explicit metadata identity may accelerate lookup without bypassing the normal lyric scoring pipeline.
export const shouldRunLocalSongAutomaticMatch = (song: LocalSong): boolean => (
    !song.noAutoMatch || Boolean(buildLocalSongLyricMatchContext(song).metadataCandidate)
);

// Legacy automatic lyric records have no provider-scoped lyric ID and are refreshed once against the selected metadata.
// A song the user marked as instrumental is never refreshed.
export const shouldRefreshLocalSongLyricsFromMetadata = (song: LocalSong): boolean => (
    !song.markedPureMusic
    && !song.hasManualLyricSelection
    && Boolean(buildLocalSongLyricMatchContext(song).metadataCandidate)
    && Boolean(song.matchedLyrics || song.matchedIsPureMusic)
    && song.matchedLyricsSongId === undefined
);
