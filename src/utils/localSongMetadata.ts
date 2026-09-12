import type { LocalSong } from '../types';
import type { LocalSongImportedMetadata, LocalSongOnlineMetadata } from '../types/localLibrary';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from './localLibraryNames';

// src/utils/localSongMetadata.ts
// Resolves canonical local-song metadata while keeping imported and online snapshots internal.

export const stripLocalAudioExtension = (fileName: string): string => (
  fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/iu, '').trim()
);

// ISRC is 12 alphanumerics; anything else is a malformed tag and is dropped rather than persisted.
const normalizeIsrc = (value?: string): string | undefined => {
  const code = (value || '').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{12}$/.test(code) ? code : undefined;
};

export const buildImportedMetadataSnapshot = ({
  fileName,
  embeddedTitle,
  fallbackTitle,
  embeddedArtist,
  embeddedArtists,
  fallbackArtist,
  embeddedAlbum,
  fallbackAlbum,
  embeddedIsrc,
}: {
  fileName: string;
  embeddedTitle?: string;
  fallbackTitle?: string;
  embeddedArtist?: string;
  embeddedArtists?: string[];
  fallbackArtist?: string;
  embeddedAlbum?: string;
  fallbackAlbum?: string;
  embeddedIsrc?: string;
}): LocalSongImportedMetadata => {
  const isrc = normalizeIsrc(embeddedIsrc);
  const normalizedEmbeddedTitle = cleanLocalLibraryName(embeddedTitle);
  const title = normalizedEmbeddedTitle
    || cleanLocalLibraryName(fallbackTitle)
    || stripLocalAudioExtension(fileName)
    || fileName;
  const embeddedArtistNames = (embeddedArtists || []).flatMap(splitLocalLibraryArtistNames);
  return {
    title,
    titleSource: normalizedEmbeddedTitle ? 'embedded' : 'filename',
    artistNames: embeddedArtistNames.length > 0
      ? embeddedArtistNames
      : splitLocalLibraryArtistNames(embeddedArtist || fallbackArtist),
    albumName: cleanLocalLibraryName(embeddedAlbum || fallbackAlbum),
    ...(isrc ? { isrc } : {}),
  };
};

export const getLocalSongImportedArtistNames = (song: LocalSong): string[] => (
  song.importedMetadata.artistNames
);

export const getLocalSongImportedAlbumName = (song: LocalSong): string | undefined => (
  song.importedMetadata.albumName
);

export const getLocalSongOnlineCoverUrl = (song: LocalSong): string | undefined => (
  song.onlineMetadata?.coverUrl
);

export const getLocalSongOnlineArtistNames = (online?: LocalSongOnlineMetadata): string[] => (
  online?.artists.map(artist => cleanLocalLibraryName(artist.name)).filter((name): name is string => Boolean(name)) || []
);
