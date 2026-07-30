// src/components/visualizer/sonnet/sonnetTexturePool.ts
// Reference-counts globally cached Pixi assets across overlapping runtime rebuilds.
interface SonnetTextureEntry<T> {
    refs: number;
    promise: Promise<T>;
    unloadTimer: ReturnType<typeof setTimeout> | null;
}

export class SonnetTexturePool<T> {
    private readonly entries = new Map<string, SonnetTextureEntry<T>>();

    constructor(
        private readonly load: (url: string) => Promise<T>,
        private readonly unload: (url: string) => Promise<unknown>,
        private readonly unloadDelayMs = 750,
    ) {}

    async acquire(url: string) {
        let entry = this.entries.get(url);
        if (!entry) {
            entry = {
                refs: 0,
                promise: this.load(url),
                unloadTimer: null,
            };
            this.entries.set(url, entry);
        }
        entry.refs += 1;
        if (entry.unloadTimer) {
            clearTimeout(entry.unloadTimer);
            entry.unloadTimer = null;
        }
        try {
            return await entry.promise;
        } catch (error) {
            if (this.entries.get(url) === entry) this.entries.delete(url);
            throw error;
        }
    }

    release(url: string) {
        const entry = this.entries.get(url);
        if (!entry) return;
        entry.refs = Math.max(0, entry.refs - 1);
        if (entry.refs > 0 || entry.unloadTimer) return;
        entry.unloadTimer = setTimeout(() => {
            if (entry.refs > 0 || this.entries.get(url) !== entry) return;
            this.entries.delete(url);
            void this.unload(url).catch(() => undefined);
        }, this.unloadDelayMs);
    }
}

type PixiModule = typeof import('pixi.js');
const pixiPools = new WeakMap<object, SonnetTexturePool<import('pixi.js').Texture>>();

export const getSonnetTexturePool = (pixi: PixiModule) => {
    const assets = pixi.Assets as object;
    const cached = pixiPools.get(assets);
    if (cached) return cached;
    const pool = new SonnetTexturePool<import('pixi.js').Texture>(
        url => pixi.Assets.load<import('pixi.js').Texture>(url),
        url => pixi.Assets.unload(url),
    );
    pixiPools.set(assets, pool);
    return pool;
};
