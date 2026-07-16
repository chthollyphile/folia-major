import type { LyricData, LyricProviderSource } from '../types';
import type { AmllDbPlatform } from '../types';
import type { LocalLibraryAssignmentOrigin } from '../types/localLibrary';
import type { OnlineMetadataCandidate } from './onlineMetadataSearchService';
import { cacheLocalSongOnlineCover, removeCachedCover } from './coverCache';
import { applyMatchedMetadata, restoreImportedMetadata } from './localLibraryCatalogService';

// src/services/localSongMatchSelectionService.ts
// Applies GridView metadata matches and Player lyric matches through one selection contract.

export type LocalSongMetadataSelection = 'online' | 'imported' | 'keep';
export type LocalSongCoverSelection = 'online' | 'embedded' | 'keep';
export type LocalSongLyricsSelection = 'online' | 'local' | 'embedded' | 'automatic' | 'keep';

export interface LocalSongOnlineLyricsSelection {
  lyrics: LyricData;
  songId: number | string;
  source: LyricProviderSource;
  providerPlatform?: AmllDbPlatform;
  isPureMusic: boolean;
}

export interface ApplyLocalSongMatchSelectionInput {
  songId: string;
  candidate?: OnlineMetadataCandidate;
  metadata: LocalSongMetadataSelection;
  cover: LocalSongCoverSelection;
  lyrics: LocalSongLyricsSelection;
  onlineLyrics?: LocalSongOnlineLyricsSelection;
  setNoAutoMatch?: boolean;
  lyricsFailed?: boolean;
  matchMode?: 'automatic' | 'manual';
  protectOrigins?: LocalLibraryAssignmentOrigin[];
}

export interface ApplyLocalSongMatchSelectionResult {
  coverAttempted: boolean;
  coverCached: boolean;
  lyricsApplied: boolean;
  partialLyricsFailure: boolean;
}

const buildSongPatch = (input: ApplyLocalSongMatchSelectionInput) => {
  const patch: Record<string, unknown> = {};
  if (input.setNoAutoMatch !== undefined) patch.noAutoMatch = input.setNoAutoMatch;
  if (input.cover === 'online') patch.useOnlineCover = Boolean(input.candidate?.coverUrl);
  if (input.cover === 'embedded') patch.useOnlineCover = false;
  if (input.lyrics === 'online' && input.onlineLyrics) {
    patch.matchedLyrics = input.onlineLyrics.lyrics;
    patch.matchedIsPureMusic = input.onlineLyrics.isPureMusic;
    patch.matchedLyricsSongId = input.onlineLyrics.songId;
    patch.matchedLyricsSource = input.onlineLyrics.source;
    patch.matchedLyricsProviderPlatform = input.onlineLyrics.providerPlatform;
    patch.lyricsSource = 'online';
    patch.hasManualLyricSelection = true;
  } else if (input.lyrics === 'local' || input.lyrics === 'embedded') {
    patch.lyricsSource = input.lyrics;
    patch.hasManualLyricSelection = true;
  } else if (input.lyrics === 'automatic') {
    patch.lyricsSource = undefined;
    patch.hasManualLyricSelection = false;
  }
  return patch;
};

export const applyLocalSongMatchSelection = async (
  input: ApplyLocalSongMatchSelectionInput,
): Promise<ApplyLocalSongMatchSelectionResult> => {
  const candidateMetadata = input.candidate ? {
    source: input.candidate.source,
    songId: input.candidate.songId,
    title: input.candidate.title,
    artists: input.candidate.artists.length > 0 ? input.candidate.artists : undefined,
    album: input.candidate.album,
    coverUrl: input.candidate.coverUrl,
  } : {};
  const songPatch = buildSongPatch(input);

  if (input.metadata === 'online' && input.candidate) {
    await applyMatchedMetadata(input.songId, candidateMetadata, {
      songPatch,
      assignmentOrigin: input.matchMode === 'automatic' ? 'auto-match' : 'manual-match',
      protectOrigins: input.protectOrigins,
    });
  } else if (input.metadata === 'imported') {
    await restoreImportedMetadata(input.songId, songPatch);
  } else {
    await applyMatchedMetadata(input.songId, candidateMetadata, { lyricsOnly: true, songPatch });
  }

  const coverAttempted = input.cover === 'online' && Boolean(input.candidate?.coverUrl);
  const coverCached = coverAttempted && input.candidate?.coverUrl
    ? await cacheLocalSongOnlineCover(input.songId, input.candidate.coverUrl)
    : false;
  if (input.cover === 'embedded') await removeCachedCover(`cover_local_${input.songId}`);

  return {
    coverAttempted,
    coverCached,
    lyricsApplied: input.lyrics !== 'online' || Boolean(input.onlineLyrics),
    partialLyricsFailure: Boolean(input.lyricsFailed && !input.onlineLyrics),
  };
};
