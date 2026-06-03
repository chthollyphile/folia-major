import { getFromCache, removeFromCache, saveToCache } from './db';
import type { StoredCappellaAvatarImage } from '../types';

// src/services/cappellaAvatarPack.ts
// Persists user-provided Cappella custom avatars in IndexedDB.
const CAPPELLA_CUSTOM_AVATAR_KEY = 'cappella_custom_avatar';
const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

export const getCustomCappellaAvatar = async (): Promise<StoredCappellaAvatarImage[]> => {
    const stored = await getFromCache<StoredCappellaAvatarImage[]>(CAPPELLA_CUSTOM_AVATAR_KEY);
    if (!Array.isArray(stored)) {
        return [];
    }

    return stored.filter(entry => entry?.blob instanceof Blob && typeof entry.name === 'string');
};

export const saveCustomCappellaAvatar = async (images: StoredCappellaAvatarImage[]): Promise<void> => {
    await saveToCache(CAPPELLA_CUSTOM_AVATAR_KEY, images);
};

export const clearCustomCappellaAvatar = async (): Promise<void> => {
    await removeFromCache(CAPPELLA_CUSTOM_AVATAR_KEY);
};

export const isSupportedCappellaAvatarFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some(extension => lowerName.endsWith(extension));
    return file.type.startsWith('image/') || hasSupportedExtension;
};

export const buildStoredCappellaAvatar = (files: File[]): StoredCappellaAvatarImage[] =>
    files.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        blob: file,
    }));