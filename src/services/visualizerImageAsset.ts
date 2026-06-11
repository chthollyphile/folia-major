import { getFromCache, removeFromCache, saveToCache } from './db';

// src/services/visualizerImageAsset.ts
// Shared helpers for single-image visualizer assets persisted in IndexedDB.
interface StoredVisualizerImageAsset {
    id: string;
    name: string;
    mimeType: string;
    blob: Blob;
}

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

export const getStoredVisualizerImageAsset = async <T extends StoredVisualizerImageAsset>(key: string): Promise<T | null> => {
    const stored = await getFromCache<T>(key);
    if (!stored?.blob || !(stored.blob instanceof Blob) || typeof stored.name !== 'string') {
        return null;
    }

    return stored;
};

export const saveStoredVisualizerImageAsset = async <T extends StoredVisualizerImageAsset>(
    key: string,
    image: T,
): Promise<void> => {
    await saveToCache(key, image);
};

export const clearStoredVisualizerImageAsset = async (key: string): Promise<void> => {
    await removeFromCache(key);
};

export const isSupportedVisualizerImageFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some(extension => lowerName.endsWith(extension));
    return file.type.startsWith('image/') || hasSupportedExtension;
};

export const buildStoredVisualizerImageAsset = <T extends StoredVisualizerImageAsset>(file: File): T => ({
    id: `${Date.now()}-${file.name}`,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
} as T);
