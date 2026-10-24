import type { StoredCacheEntry } from '../appDatabase';
import type { CacheCategory } from './cacheRepository';
// Pure: the analysis key prefixes, with nothing but a type import behind them.
import { isBeatGridKey, isDrumHitsKey } from '../analysis/beatGridKeys';

// src/services/repositories/cacheUsage.ts
// How much of the cache each category holds, counted one row at a time. No imports at run time but
// the pure key prefixes of analysis/beatGridKeys.ts: the cache-usage worker
// (src/workers/cacheUsage.worker.ts) counts with it too, and the page's copy of the database must not
// be opened there.

export type CacheUsage = {
  playlist: number;
  lyrics: number;
  cover: number;
  media: number;
  analysis: number;
  volumeBalance: number;
  mediaCount: number;
};

export const USER_CACHE_KEYS = new Set([
  'user_profile',
  'user_playlists',
  'user_liked_songs',
  'user_cloud_playlist',
]);

export const getEntrySize = (entry: StoredCacheEntry): number => {
  if (typeof Blob !== 'undefined' && entry.data instanceof Blob) return entry.data.size;
  try {
    return JSON.stringify(entry.data)?.length ?? 0;
  } catch {
    return 0;
  }
};

export const matchesCategory = (key: string, category: CacheCategory): boolean => {
  if (category === 'playlist') return key === 'user_playlists' || key.startsWith('playlist_') || (key.startsWith('online_provider_') && key.includes('_playlist'));
  if (category === 'lyrics') return key.startsWith('lyric_');
  if (category === 'cover') return key.startsWith('cover_');
  // Automix's measurement of a track: tempo, bar line, silence edges, loudness. Its own category
  // rather than riding with the audio, because the two are not thrown away for the same reasons.
  // ReplayGain below is cleared with the audio since it ARRIVES with the audio and comes back free
  // with it; a profile costs a full decode and a model pass to rebuild, and stays true whether or
  // not the bytes it was measured from are still on this machine. Someone reclaiming five gigabytes
  // of audio has no reason to pay for that again.
  //
  // A track's Beat This! beats (services/analysis/beatGrid.ts) are the same kind of thing - a model
  // pass to rebuild, read by automix and by the beat FX - and are cleared with the profiles. So are
  // its drum hits off htdemucs (services/analysis/drumHits.ts).
  if (category === 'analysis') return key.startsWith('automix_profile_') || isBeatGridKey(key) || isDrumHitsKey(key);
  // 智能平衡's own readings of each song (services/volumeBalance/balanceRecords.ts): a feature of its own,
  // so cleared on its own, without throwing away automix's analyses or being thrown away with them.
  if (category === 'volumeBalance') return key.startsWith('volume_balance_');
  // A track's ReplayGain describes the audio and arrives with it, so it is cleared with it. It is
  // counted here but NOT in mediaCount below, which means "songs cached" and would otherwise
  // double for every track that has both. The level the audio was fetched at (`audioLevel_`)
  // describes that one copy, so it is cleared and counted with it in the same way.
  return key.startsWith('audio_') || key.startsWith('replayGain_') || key.startsWith('audioLevel_');
};

export const emptyCacheUsage = (): CacheUsage => ({ playlist: 0, lyrics: 0, cover: 0, media: 0, analysis: 0, volumeBalance: 0, mediaCount: 0 });

export const countCacheEntry = (usage: CacheUsage, entry: StoredCacheEntry): void => {
  const size = getEntrySize(entry);
  if (matchesCategory(entry.key, 'playlist') || USER_CACHE_KEYS.has(entry.key)) usage.playlist += size;
  else if (matchesCategory(entry.key, 'lyrics')) usage.lyrics += size;
  else if (matchesCategory(entry.key, 'cover')) usage.cover += size;
  else if (matchesCategory(entry.key, 'analysis')) usage.analysis += size;
  else if (matchesCategory(entry.key, 'volumeBalance')) usage.volumeBalance += size;
  else if (matchesCategory(entry.key, 'media')) {
    usage.media += size;
    if (entry.key.startsWith('audio_')) usage.mediaCount += 1;
  }
};
