import { isBlob } from '../utils/blobGuards';

// src/services/binaryAssetStore.ts
// Stores rebuildable binary assets outside IndexedDB and validates every payload at the storage boundary.

type BinaryAssetBackend = 'opfs' | 'electron';

export interface BinaryAssetWriteResult {
  backend: BinaryAssetBackend;
  mimeType: string;
  size: number;
  updatedAt: number;
}

interface ElectronBinaryCacheEntry {
  found: boolean;
  data?: Uint8Array | ArrayBuffer | null;
  mimeType?: string | null;
}

const OPFS_ROOT_DIRECTORY = 'folia-cache';
const OPFS_COVER_DIRECTORY = 'covers';

const hasElectronCoverBridge = (): boolean => (
  typeof window !== 'undefined'
  && typeof window.electron?.getCoverCache === 'function'
  && typeof window.electron?.saveCoverCache === 'function'
  && typeof window.electron?.removeCoverCache === 'function'
);

const hasOpfs = (): boolean => (
  typeof navigator !== 'undefined'
  && typeof navigator.storage?.getDirectory === 'function'
);

const toHex = (bytes: Uint8Array): string => Array.from(bytes)
  .map(value => value.toString(16).padStart(2, '0'))
  .join('');

// Produces a deterministic filename while avoiding logical cache keys in the filesystem.
const hashAssetKey = async (key: string): Promise<string> => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return toHex(new Uint8Array(digest));
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const getOpfsCoverDirectory = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  if (!hasOpfs()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const cacheRoot = await root.getDirectoryHandle(OPFS_ROOT_DIRECTORY, { create });
    return await cacheRoot.getDirectoryHandle(OPFS_COVER_DIRECTORY, { create });
  } catch {
    return null;
  }
};

const getAssetFileName = async (key: string): Promise<string> => `${await hashAssetKey(key)}.bin`;

const electronEntryToBlob = (entry: ElectronBinaryCacheEntry): Blob | null => {
  if (!entry?.found || !entry.data || !entry.mimeType?.startsWith('image/')) return null;
  try {
    const bytes = entry.data instanceof ArrayBuffer
      ? new Uint8Array(entry.data)
      : new Uint8Array(entry.data);
    if (bytes.byteLength === 0) return null;
    const blob = new Blob([bytes], { type: entry.mimeType || 'application/octet-stream' });
    return isBlob(blob) && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
};

export const readCoverAsset = async (key: string, mimeType?: string): Promise<Blob | null> => {
  if (hasElectronCoverBridge()) {
    const entry = await window.electron!.getCoverCache(key);
    const blob = electronEntryToBlob(entry);
    if (blob) return blob;
    if (entry?.found) await window.electron!.removeCoverCache(key);
    return null;
  }

  const directory = await getOpfsCoverDirectory(false);
  if (!directory) return null;
  const fileName = await getAssetFileName(key);
  try {
    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();
    const resolvedMimeType = file.type || mimeType;
    if (!isBlob(file) || file.size === 0 || !resolvedMimeType?.startsWith('image/')) {
      await directory.removeEntry(fileName).catch(() => undefined);
      return null;
    }
    return file.type ? file : file.slice(0, file.size, resolvedMimeType);
  } catch {
    return null;
  }
};

export const writeCoverAsset = async (key: string, value: unknown): Promise<BinaryAssetWriteResult | null> => {
  if (!isBlob(value) || value.size === 0 || !value.type.startsWith('image/')) return null;
  const mimeType = value.type;
  const updatedAt = Date.now();

  if (hasElectronCoverBridge()) {
    await window.electron!.saveCoverCache(key, await value.arrayBuffer(), mimeType);
    return { backend: 'electron', mimeType, size: value.size, updatedAt };
  }

  const directory = await getOpfsCoverDirectory(true);
  if (!directory) return null;
  const handle = await directory.getFileHandle(await getAssetFileName(key), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(value);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  return { backend: 'opfs', mimeType, size: value.size, updatedAt };
};

export const removeCoverAsset = async (key: string): Promise<void> => {
  if (hasElectronCoverBridge()) {
    await window.electron!.removeCoverCache(key);
    return;
  }
  const directory = await getOpfsCoverDirectory(false);
  if (!directory) return;
  await directory.removeEntry(await getAssetFileName(key)).catch(() => undefined);
};

export const getCoverAssetUsage = async (): Promise<number> => {
  if (hasElectronCoverBridge() && typeof window.electron?.getCoverCacheUsage === 'function') {
    return window.electron.getCoverCacheUsage();
  }
  const directory = await getOpfsCoverDirectory(false);
  if (!directory) return 0;
  let total = 0;
  for await (const entry of directory.values()) {
    if (entry.kind !== 'file') continue;
    try {
      total += (await entry.getFile()).size;
    } catch {
      // A concurrently removed cache entry is equivalent to a cache miss.
    }
  }
  return total;
};

export const clearCoverAssets = async (): Promise<void> => {
  if (hasElectronCoverBridge() && typeof window.electron?.clearCoverCache === 'function') {
    await window.electron.clearCoverCache();
    return;
  }
  if (!hasOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const cacheRoot = await root.getDirectoryHandle(OPFS_ROOT_DIRECTORY);
    await cacheRoot.removeEntry(OPFS_COVER_DIRECTORY, { recursive: true });
  } catch {
    // Missing OPFS cache is already clear.
  }
};
