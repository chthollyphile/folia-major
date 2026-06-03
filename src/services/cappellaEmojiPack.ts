import { getFromCache, removeFromCache, saveToCache } from './db';
import type { StoredCappellaEmojiImage } from '../types';

// src/services/cappellaEmojiPack.ts
// Persists user-provided Cappella emoji packs in IndexedDB as an appendable local asset set.
const CAPPELLA_CUSTOM_EMOJI_PACK_KEY = 'cappella_custom_emoji_pack';
const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

export const getCustomCappellaEmojiPack = async (): Promise<StoredCappellaEmojiImage[]> => {
    const stored = await getFromCache<StoredCappellaEmojiImage[]>(CAPPELLA_CUSTOM_EMOJI_PACK_KEY);
    if (!Array.isArray(stored)) {
        return [];
    }

    return stored.filter(entry => entry?.blob instanceof Blob && typeof entry.name === 'string');
};

export const saveCustomCappellaEmojiPack = async (images: StoredCappellaEmojiImage[]): Promise<void> => {
    await saveToCache(CAPPELLA_CUSTOM_EMOJI_PACK_KEY, images);
};

export const clearCustomCappellaEmojiPack = async (): Promise<void> => {
    await removeFromCache(CAPPELLA_CUSTOM_EMOJI_PACK_KEY);
};

export const isSupportedCappellaEmojiFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_IMAGE_EXTENSIONS.some(extension => lowerName.endsWith(extension));
    return file.type.startsWith('image/') || hasSupportedExtension;
};

export const buildStoredCappellaEmojiPack = (files: File[]): StoredCappellaEmojiImage[] =>
    files.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        blob: file,
    }));
