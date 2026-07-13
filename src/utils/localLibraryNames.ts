import type { LocalSong } from '../types';

// src/utils/localLibraryNames.ts
// Normalizes local-library names and derives import context without guessing legacy artist separators.

export const normalizeLocalLibraryName = (value: string): string => (
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
);

export const cleanLocalLibraryName = (value?: string): string | undefined => {
  const cleaned = value?.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return cleaned || undefined;
};

export const getImportedArtistNames = (song: LocalSong): string[] => {
  const name = cleanLocalLibraryName(song.embeddedArtist || song.artist);
  return name ? [name] : [];
};

export const getImportedAlbumName = (song: LocalSong): string | undefined => (
  cleanLocalLibraryName(song.embeddedAlbum || song.album)
);

export const getMatchedArtistNames = (song: LocalSong): string[] => {
  if (song.matchedArtistEntities?.length) {
    return song.matchedArtistEntities
      .map(artist => cleanLocalLibraryName(artist.name))
      .filter((name): name is string => Boolean(name));
  }
  const legacyName = cleanLocalLibraryName(song.matchedArtists);
  return legacyName ? [legacyName] : [];
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

