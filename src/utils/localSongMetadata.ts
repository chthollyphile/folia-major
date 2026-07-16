import type { LocalSong } from '../types';
import type { LocalSongImportedMetadata, LocalSongOnlineMetadata } from '../types/localLibrary';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from './localLibraryNames';

// src/utils/localSongMetadata.ts
// Resolves canonical local-song metadata while keeping imported and online snapshots internal.

export const stripLocalAudioExtension = (fileName: string): string => (
  fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/iu, '').trim()
);

export const buildImportedMetadataSnapshot = ({
  fileName,
  embeddedTitle,
  fallbackTitle,
  embeddedArtist,
  fallbackArtist,
  embeddedAlbum,
  fallbackAlbum,
}: {
  fileName: string;
  embeddedTitle?: string;
  fallbackTitle?: string;
  embeddedArtist?: string;
  fallbackArtist?: string;
  embeddedAlbum?: string;
  fallbackAlbum?: string;
}): LocalSongImportedMetadata => {
  const normalizedEmbeddedTitle = cleanLocalLibraryName(embeddedTitle);
  const title = normalizedEmbeddedTitle
    || cleanLocalLibraryName(fallbackTitle)
    || stripLocalAudioExtension(fileName)
    || fileName;
  return {
    title,
    titleSource: normalizedEmbeddedTitle ? 'embedded' : 'filename',
    artistNames: splitLocalLibraryArtistNames(embeddedArtist || fallbackArtist),
    albumName: cleanLocalLibraryName(embeddedAlbum || fallbackAlbum),
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
