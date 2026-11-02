import { useEffect } from 'react';
import { create } from 'zustand';
import { deleteCustomBackgroundAsset, readCustomBackgroundAsset, customBackgroundAssetType, writeCustomBackgroundAsset, type CustomBackgroundAsset } from './customBackgroundAsset';

// src/components/visualizer/backgrounds/custom/useCustomBackgroundAsset.ts
// Loads and owns the selected custom media asset and its object URL.
interface CustomBackgroundAssetState {
    asset: CustomBackgroundAsset | null;
    url: string | null;
    loaded: boolean;
    load: () => Promise<void>;
    importFile: (file: File) => Promise<boolean>;
    clear: () => Promise<void>;
}

let assetRequestGeneration = 0;
let assetWriteQueue = Promise.resolve();

const enqueueAssetWrite = (write: () => Promise<void>) => {
    assetWriteQueue = assetWriteQueue.then(write, write);
    return assetWriteQueue;
};

export const useCustomBackgroundAssetStore = create<CustomBackgroundAssetState>((set, get) => ({
    asset: null,
    url: null,
    loaded: false,
    load: async () => {
        if (get().loaded) return;
        const generation = assetRequestGeneration;
        const asset = await readCustomBackgroundAsset();
        if (generation !== assetRequestGeneration || get().loaded) return;
        if (asset?.blob instanceof Blob) set({ asset, url: URL.createObjectURL(asset.blob), loaded: true });
        else set({ loaded: true });
    },
    importFile: async file => {
        const type = customBackgroundAssetType(file);
        if (!type) return false;
        const generation = ++assetRequestGeneration;
        const asset = { name: file.name, type, blob: file };
        await enqueueAssetWrite(() => generation === assetRequestGeneration ? writeCustomBackgroundAsset(asset) : Promise.resolve());
        if (generation !== assetRequestGeneration) return false;
        const oldUrl = get().url;
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        set({ asset, url: URL.createObjectURL(file), loaded: true });
        return true;
    },
    clear: async () => {
        const generation = ++assetRequestGeneration;
        await enqueueAssetWrite(deleteCustomBackgroundAsset);
        if (generation !== assetRequestGeneration) return;
        const oldUrl = get().url;
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        set({ asset: null, url: null, loaded: true });
    },
}));

export const useLoadCustomBackgroundAsset = () => {
    const load = useCustomBackgroundAssetStore(state => state.load);
    useEffect(() => { void load(); }, [load]);
};
