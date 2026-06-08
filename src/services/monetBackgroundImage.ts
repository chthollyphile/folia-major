import { getFromCache, removeFromCache, saveToCache } from './db';
import type { StoredMonetBackgroundImage } from '../types';

// src/services/monetBackgroundImage.ts
// Persists a single global Monet background override image in IndexedDB.
const MONET_BACKGROUND_IMAGE_KEY = 'monet_background_image';
const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

export const getMonetBackgroundImage = async (): Promise<StoredMonetBackgroundImage | null> => {
    const stored = await getFromCache<StoredMonetBackgroundImage>(MONET_BACKGROUND_IMAGE_KEY);
    if (!stored?.blob || !(stored.blob instanceof Blob) || typeof stored.name !== 'string') {
        return null;
    }

    return stored;
};

export const saveMonetBackgroundImage = async (image: StoredMonetBackgroundImage): Promise<void> => {
    await saveToCache(MONET_BACKGROUND_IMAGE_KEY, image);
};

export const clearMonetBackgroundImage = async (): Promise<void> => {
    await removeFromCache(MONET_BACKGROUND_IMAGE_KEY);
};

export const isSupportedMonetBackgroundFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some(extension => lowerName.endsWith(extension));
    return file.type.startsWith('image/') || hasSupportedExtension;
};

export const buildStoredMonetBackgroundImage = (file: File): StoredMonetBackgroundImage => ({
    id: `${Date.now()}-${file.name}`,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
});
