import type { StoredMonetBackgroundImage } from '../types';
import {
    buildStoredVisualizerImageAsset,
    clearStoredVisualizerImageAsset,
    getStoredVisualizerImageAsset,
    isSupportedVisualizerImageFile,
    saveStoredVisualizerImageAsset,
} from './visualizerImageAsset';

// src/services/monetBackgroundImage.ts
// Persists a single global Monet background override image in IndexedDB.
const MONET_BACKGROUND_IMAGE_KEY = 'monet_background_image';

export const getMonetBackgroundImage = async (): Promise<StoredMonetBackgroundImage | null> => {
    return getStoredVisualizerImageAsset<StoredMonetBackgroundImage>(MONET_BACKGROUND_IMAGE_KEY);
};

export const saveMonetBackgroundImage = async (image: StoredMonetBackgroundImage): Promise<void> => {
    await saveStoredVisualizerImageAsset(MONET_BACKGROUND_IMAGE_KEY, image);
};

export const clearMonetBackgroundImage = async (): Promise<void> => {
    await clearStoredVisualizerImageAsset(MONET_BACKGROUND_IMAGE_KEY);
};

export const isSupportedMonetBackgroundFile = isSupportedVisualizerImageFile;

export const buildStoredMonetBackgroundImage = (file: File): StoredMonetBackgroundImage => ({
    ...buildStoredVisualizerImageAsset<StoredMonetBackgroundImage>(file),
});
