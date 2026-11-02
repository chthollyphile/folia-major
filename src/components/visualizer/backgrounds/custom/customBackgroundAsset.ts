import { getFromCache, removeFromCache, saveToCache } from '../../../../services/db';

// src/components/visualizer/backgrounds/custom/customBackgroundAsset.ts
// Stores imported custom background image and video assets in IndexedDB.
const KEY = 'custom-visualizer-background';

export interface CustomBackgroundAsset {
    name: string;
    type: 'image' | 'video';
    blob: Blob;
}

export const readCustomBackgroundAsset = () => getFromCache<CustomBackgroundAsset>(KEY);
export const writeCustomBackgroundAsset = (asset: CustomBackgroundAsset) => saveToCache(KEY, asset);
export const deleteCustomBackgroundAsset = () => removeFromCache(KEY);

export const customBackgroundAssetType = (file: File): CustomBackgroundAsset['type'] | null => {
    if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) return 'image';
    if (file.type.startsWith('video/') || /\.(mp4|webm|ogv|ogg|m4v|mov)$/i.test(file.name)) return 'video';
    return null;
};
