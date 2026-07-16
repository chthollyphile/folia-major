import type { LocalSong } from '../types';

// src/utils/localLibraryNames.ts
// Normalizes local-library names and recognizes explicit semicolon/slash-separated artist credits.

export const normalizeLocalLibraryName = (value: string): string => (
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
);

export const cleanLocalLibraryName = (value?: string): string | undefined => {
  const cleaned = value?.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return cleaned || undefined;
};

export const splitLocalLibraryArtistNames = (value?: string): string[] => {
  const cleaned = cleanLocalLibraryName(value);
  if (!cleaned) return [];

  const seen = new Set<string>();
  return cleaned
    .split(/[;；/／]/u)
    .map(part => cleanLocalLibraryName(part))
    .filter((part): part is string => {
      if (!part) return false;
      const normalized = normalizeLocalLibraryName(part);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

export const getImportedArtistNames = (song: LocalSong): string[] => (
  song.importedMetadata.artistNames.flatMap(splitLocalLibraryArtistNames)
);

export const getImportedAlbumName = (song: LocalSong): string | undefined => (
  cleanLocalLibraryName(song.importedMetadata.albumName)
);

export const getMatchedArtistNames = (song: LocalSong): string[] => {
  return song.onlineMetadata?.artists.flatMap(artist => splitLocalLibraryArtistNames(artist.name)) || [];
};

export const getRelativeParentFolder = (song: LocalSong): string => {
  const normalizedPath = song.filePath.replace(/\\/gu, '/');
  const lastSlash = normalizedPath.lastIndexOf('/');
  const parent = lastSlash > 0 ? normalizedPath.slice(0, lastSlash) : '';
  const root = cleanLocalLibraryName(song.folderName) || '';
  if (!root) return parent;
  const rootIndex = parent.indexOf(root);
  return rootIndex >= 0 ? parent.slice(rootIndex + root.length).replace(/^\/+|\/+$/gu, '') : parent;
};

export const getAlbumImportContextKey = (song: LocalSong, albumName: string): string => (
  [
    normalizeLocalLibraryName(song.folderName || ''),
    normalizeLocalLibraryName(getRelativeParentFolder(song)),
    normalizeLocalLibraryName(albumName),
  ].join('\u0000')
);
