import type { LocalSong } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity, LocalSongMetadataSource, LocalSongOnlineMetadata } from '../types/localLibrary';
import { isBlob } from '../utils/blobGuards';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from '../utils/localLibraryNames';
import { buildImportedMetadataSnapshot } from '../utils/localSongMetadata';
import { createLocalLibraryAssignment, resolveEntityNames } from './localLibraryCatalogInternals';

// src/services/localLibraryV8Migration.ts
// Converts the released v6 flat local-song records into canonical songs and stable entity assignments.

type LegacyLocalSong = LocalSong & Record<string, unknown>;

const isMetadataSource = (value: unknown): value is LocalSongMetadataSource => (
  value === 'netease' || value === 'qq' || value === 'kugou'
);

const readString = (value: unknown): string | undefined => (
  typeof value === 'string' ? cleanLocalLibraryName(value) : undefined
);

const readProviderId = (value: unknown): number | string | undefined => (
  (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim())
    ? value as number | string
    : undefined
);

const readLegacyArtists = (record: Record<string, unknown>) => {
  if (Array.isArray(record.matchedArtistEntities)) {
    const artists = record.matchedArtistEntities.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      const name = readString(item.name);
      return name ? [{ id: readProviderId(item.id), name }] : [];
    });
    if (artists.length > 0) return artists;
  }
  return splitLocalLibraryArtistNames(readString(record.matchedArtists)).map(name => ({ name }));
};

const buildLegacyOnlineMetadata = (record: Record<string, unknown>, now: number): LocalSongOnlineMetadata | undefined => {
  const source = isMetadataSource(record.matchedMetadataSource)
    ? record.matchedMetadataSource
    : (record.matchedSongId !== undefined || record.matchedAlbumId !== undefined ? 'netease' : undefined);
  const songId = readProviderId(record.matchedMetadataSongId) ?? readProviderId(record.matchedSongId);
  const albumId = readProviderId(record.matchedMetadataAlbumId) ?? readProviderId(record.matchedAlbumId);
  const title = readString(record.matchedTitle);
  const artists = readLegacyArtists(record);
  const albumName = readString(record.matchedAlbumName);
  const coverUrl = readString(record.matchedCoverUrl);
  if (!source && songId === undefined && !title && artists.length === 0 && !albumName && !coverUrl) return undefined;
  return {
    source: source || 'netease',
    songId,
    albumId,
    title,
    artists,
    album: albumName ? { id: albumId, name: albumName } : undefined,
    coverUrl,
    matchMode: 'legacy',
    matchedAt: now,
  };
};

const removeLegacyMetadataFields = (record: Record<string, unknown>) => {
  [
    'artist', 'album', 'embeddedTitle', 'embeddedArtist', 'embeddedAlbum',
    'matchedSongId', 'matchedMetadataSource', 'matchedMetadataSongId', 'matchedMetadataAlbumId',
    'matchedTitle', 'matchedArtists', 'matchedArtistEntities', 'manualArtistNames', 'manualAlbumName',
    'matchedAlbumId', 'matchedAlbumName', 'matchedCoverUrl', 'useOnlineMetadata',
  ].forEach(key => delete record[key]);
};

export const migrateLegacyLocalSongRecords = (
  records: LegacyLocalSong[],
  now = Date.now(),
): { songs: LocalSong[]; entities: LocalLibraryEntity[]; assignments: LocalLibraryAssignment[] } => {
  const entities: LocalLibraryEntity[] = [];
  const assignments: LocalLibraryAssignment[] = [];
  const songs = records.map(legacySong => {
    const record = { ...legacySong } as Record<string, unknown>;
    const existingImported = legacySong.importedMetadata;
    const importedMetadata = existingImported?.title
      ? existingImported
      : buildImportedMetadataSnapshot({
          fileName: legacySong.fileName,
          embeddedTitle: readString(record.embeddedTitle),
          fallbackTitle: readString(record.title),
          embeddedArtist: readString(record.embeddedArtist),
          fallbackArtist: readString(record.artist),
          embeddedAlbum: readString(record.embeddedAlbum),
          fallbackAlbum: readString(record.album),
        });
    const onlineMetadata = legacySong.onlineMetadata || buildLegacyOnlineMetadata(record, now);
    const usesOnlineMetadata = record.useOnlineMetadata === true;
    const hasManualArtists = Array.isArray(record.manualArtistNames);
    const manualAlbumName = readString(record.manualAlbumName);
    const manualArtistNames = Array.isArray(record.manualArtistNames)
      ? record.manualArtistNames.flatMap(value => typeof value === 'string' ? splitLocalLibraryArtistNames(value) : [])
      : [];
    const artistNames = hasManualArtists
      ? manualArtistNames
      : usesOnlineMetadata && onlineMetadata?.artists.length
        ? onlineMetadata.artists.map(artist => artist.name)
        : importedMetadata.artistNames;
    const albumName = manualAlbumName
      ? manualAlbumName
      : usesOnlineMetadata
        ? onlineMetadata?.album?.name || importedMetadata.albumName
        : importedMetadata.albumName;
    const artistOrigin = hasManualArtists
      ? 'manual'
      : usesOnlineMetadata && onlineMetadata?.artists.length ? 'manual-match' : 'import';
    const albumOrigin = manualAlbumName
      ? 'manual'
      : usesOnlineMetadata && onlineMetadata?.album?.name ? 'manual-match' : 'import';
    const artistEntityIds = resolveEntityNames(entities, 'artist', artistNames);
    const albumEntityId = albumName ? resolveEntityNames(entities, 'album', [albumName])[0] : undefined;
    assignments.push({
      ...createLocalLibraryAssignment(legacySong.id, artistEntityIds, albumEntityId, 'import'),
      artistOrigin,
      albumOrigin,
    });

    const legacyMatchedTitle = readString(record.matchedTitle);
    const existingTitleOrigin = legacySong.titleOrigin;
    const titleOrigin = existingTitleOrigin === 'auto-match' || existingTitleOrigin === 'manual-match'
      ? existingTitleOrigin
      : usesOnlineMetadata && legacyMatchedTitle ? 'manual-match' : 'import';
    const title = titleOrigin !== 'import'
      ? onlineMetadata?.title || importedMetadata.title
      : importedMetadata.title;
    const embeddedCover = isBlob(record.embeddedCover) ? record.embeddedCover : undefined;
    removeLegacyMetadataFields(record);
    delete record.fileHandle;
    if (embeddedCover) record.embeddedCover = embeddedCover;
    else delete record.embeddedCover;
    return {
      ...record,
      title,
      titleOrigin,
      importedMetadata,
      onlineMetadata,
    } as unknown as LocalSong;
  });
  return { songs, entities, assignments };
};
