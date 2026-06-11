import type { StoredMonetPortraitImage } from '../types';
import {
    buildStoredVisualizerImageAsset,
    clearStoredVisualizerImageAsset,
    getStoredVisualizerImageAsset,
    isSupportedVisualizerImageFile,
    saveStoredVisualizerImageAsset,
} from './visualizerImageAsset';

// src/services/monetPortraitImage.ts
// Persists a single custom portrait image for the Monet poster card.
const MONET_PORTRAIT_IMAGE_KEY = 'monet_portrait_image';

export const getMonetPortraitImage = async (): Promise<StoredMonetPortraitImage | null> => {
    return getStoredVisualizerImageAsset<StoredMonetPortraitImage>(MONET_PORTRAIT_IMAGE_KEY);
};

export const saveMonetPortraitImage = async (image: StoredMonetPortraitImage): Promise<void> => {
    await saveStoredVisualizerImageAsset(MONET_PORTRAIT_IMAGE_KEY, image);
};

export const clearMonetPortraitImage = async (): Promise<void> => {
    await clearStoredVisualizerImageAsset(MONET_PORTRAIT_IMAGE_KEY);
};

export const isSupportedMonetPortraitFile = isSupportedVisualizerImageFile;

export const buildStoredMonetPortraitImage = (file: File): StoredMonetPortraitImage => ({
    ...buildStoredVisualizerImageAsset<StoredMonetPortraitImage>(file),
});
