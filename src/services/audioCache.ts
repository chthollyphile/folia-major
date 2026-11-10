import { getFromCache, removeFromCache, saveToCache } from './db';
import { isBlob } from '../utils/blobGuards';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';

/**
 * The ceiling the desktop cache is pruned back to after each write, in bytes.
 *
 * Read here rather than passed in, because every caller would otherwise have to know about a
 * setting that has nothing to do with the song it is saving. Zero means the listener asked for
 * no ceiling and reaches the main process unchanged.
 */
export const cacheLimitBytes = () =>
  useAudioSettingsStore.getState().mediaCacheLimitGb * 1024 * 1024 * 1024;

interface ElectronAudioCacheEntry {
  found: boolean;
  data?: Uint8Array | ArrayBuffer | null;
  mimeType?: string | null;
}

const isElectronAudioCacheAvailable = () =>
  Boolean(
    window.electron &&
    typeof window.electron.getAudioCache === 'function' &&
    typeof window.electron.hasAudioCache === 'function' &&
    typeof window.electron.saveAudioCache === 'function'
  );

const toBlob = (entry: ElectronAudioCacheEntry): Blob | null => {
  if (!entry.found || !entry.data) {
    return null;
  }

  const mimeType = entry.mimeType || 'audio/mpeg';
  const blobData = entry.data instanceof ArrayBuffer ? entry.data : new Uint8Array(entry.data);
  return new Blob([blobData], { type: mimeType });
};

export async function getCachedAudioBlob(cacheKey: string): Promise<Blob | null> {
  if (isElectronAudioCacheAvailable()) {
    const electronEntry = await window.electron!.getAudioCache(cacheKey);
    const electronBlob = toBlob(electronEntry);
    if (electronBlob) {
      return electronBlob;
    }
  }

  const indexedDbValue = await getFromCache<unknown>(cacheKey);
  if (!isBlob(indexedDbValue)) {
    if (indexedDbValue != null) {
      await removeFromCache(cacheKey);
    }
    return null;
  }
  const indexedDbBlob = indexedDbValue;

  if (isElectronAudioCacheAvailable()) {
    try {
      await saveAudioBlob(cacheKey, indexedDbBlob);
      await removeFromCache(cacheKey);
    } catch (error) {
      console.warn('[AudioCache] Failed to migrate IndexedDB audio cache to Electron file cache', error);
    }
  }

  return indexedDbBlob;
}

export async function hasCachedAudio(cacheKey: string): Promise<boolean> {
  if (isElectronAudioCacheAvailable()) {
    const existsInElectronCache = await window.electron!.hasAudioCache(cacheKey);
    if (existsInElectronCache) {
      return true;
    }
  }

  const indexedDbValue = await getFromCache<unknown>(cacheKey);
  if (isBlob(indexedDbValue)) return true;
  if (indexedDbValue != null) await removeFromCache(cacheKey);
  return false;
}

/**
 * Notified after bytes land in the media cache, with the key they landed under.
 *
 * Separation is what this exists for. It is allowed to read cached bytes and never to download any,
 * and for an online track the cache is EMPTY at the moment it is asked: separation is requested when
 * a track starts, and the file only arrives when analysis downloads it seconds later. Left to guess,
 * it read the empty cache, gave up for good, and the blend fell back to the master crossfade while
 * the bytes sat on disk from four seconds later onwards. See `parked` in stems.ts.
 */
const cacheWriteListeners = new Set<(cacheKey: string, keptUrl?: string) => void>();

/** Subscribe to media-cache writes. Returns the unsubscribe. */
export function onAudioCached(listener: (cacheKey: string, keptUrl?: string) => void): () => void {
  cacheWriteListeners.add(listener);
  return () => { cacheWriteListeners.delete(listener); };
}

/**
 * Tells the subscribers that a song's bytes are now on this machine, under `cacheKey`.
 *
 * Called by the write below, and by whoever had a provider keep a song in a cache of its own
 * (`keepProviderSongAudio`): to a waiting separation the two are the same news. A song kept by
 * its provider is not in the media cache: it is read by the URL it plays from, so that URL is
 * handed over as `keptUrl`.
 */
export function notifyAudioCached(cacheKey: string, keptUrl?: string): void {
  // Over a copy: a listener that throws must not fail a write that has already happened, and one
  // that unsubscribes itself must not disturb the iteration it is inside.
  for (const listener of [...cacheWriteListeners]) {
    try {
      listener(cacheKey, keptUrl);
    } catch (error) {
      console.warn('[AudioCache] a cache-write listener threw', error);
    }
  }
}

export async function saveAudioBlob(cacheKey: string, blob: Blob): Promise<void> {
  if (!isBlob(blob)) {
    throw new TypeError('Audio cache only accepts Blob values');
  }
  if (isElectronAudioCacheAvailable()) {
    const buffer = await blob.arrayBuffer();
    await window.electron!.saveAudioCache(cacheKey, buffer, blob.type || 'audio/mpeg', cacheLimitBytes());
  } else {
    await saveToCache(cacheKey, blob);
  }

  // After the write.
  notifyAudioCached(cacheKey);
}

/**
 * Deletes the audio stored under `cacheKey`, from the desktop cache and from IndexedDB, but only
 * while it is the file that was read: `size` bytes. A file written there since (by the end-of-song
 * writer, while the caller measured the old one) is left. Resolves to whether anything was deleted.
 */
export async function removeAudioBlob(cacheKey: string, size: number): Promise<boolean> {
  let removed = false;
  if (isElectronAudioCacheAvailable()) {
    removed = await window.electron!.removeAudioCache(cacheKey, size);
  }
  const stored = await getFromCache<unknown>(cacheKey);
  if (isBlob(stored) && stored.size === size) {
    await removeFromCache(cacheKey);
    removed = true;
  }
  return removed;
}
