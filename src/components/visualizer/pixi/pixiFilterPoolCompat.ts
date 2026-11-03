import type { BindGroup, Texture } from 'pixi.js';

// src/components/visualizer/pixi/pixiFilterPoolCompat.ts
// Pixi 8.21.0 prunes screen-sized textures while FilterSystem still references the last pass:
// its bind group keeps the texture bound, and a reused filter stack entry keeps it as input.
// Remove this version-gated shim once the dependency includes both upstream fixes:
// https://github.com/pixijs/pixijs/pull/12259 (bind group, after 8.22.0)
// https://github.com/pixijs/pixijs/pull/12257 (stack entry, in 8.22.0)
type PixiModule = typeof import('pixi.js');
const PATCHED = Symbol.for('folia.pixi821FilterPoolCompat');

interface FilterSystemCompat {
    _globalFilterBindGroup: BindGroup;
    _filterStack: { inputTexture: Texture | null }[];
    _filterStackIndex: number;
    init?: () => void;
    push: (instruction: unknown) => void;
    destroy: () => void;
    [PATCHED]?: boolean;
}

interface TexturePoolCompat {
    _poolKey: Record<number, number | undefined>;
    _buckets: Map<number, Texture[]>;
    _dropTextures: (textures: Texture[], destroy: boolean) => void;
    returnTexture: (texture: Texture, resetStyle?: boolean) => void;
}

/** Unbind all live renderers before the shared pool destroys textures; keep normal draws unchanged. */
export const installPixiFilterPoolCompat = (pixi: PixiModule) => {
    if ((pixi.VERSION as string) !== '8.21.0') return;
    const prototype = pixi.FilterSystem.prototype as unknown as FilterSystemCompat;
    if (prototype[PATCHED]) return;
    prototype[PATCHED] = true;

    const groups = new Set<BindGroup>();
    const pool = pixi.TexturePool as unknown as TexturePoolCompat;
    const unbindPassTextures = () => {
        const source = pixi.Texture.EMPTY.source;
        groups.forEach(group => {
            group.setResource(source, 1);
            group.setResource(source.style, 2);
            group.setResource(source, 3);
        });
    };

    // init is picked up by Pixi's renderer runner before any filter is rendered.
    const init = prototype.init;
    prototype.init = function () {
        init?.call(this);
        groups.add(this._globalFilterBindGroup);
    };
    const destroy = prototype.destroy;
    prototype.destroy = function () {
        groups.delete(this._globalFilterBindGroup);
        this._globalFilterBindGroup.destroy();
        destroy.call(this);
    };
    // push() claims its stack entry before looking up the enclosing filter's resolution, so for a
    // nested filter the lookup reads that entry's input from an earlier frame - already returned,
    // and destroyed if a resize pruned its bucket since. The value only feeds a global frame
    // nothing reads; clearing the stale input makes the lookup fall back to the root resolution.
    const push = prototype.push;
    prototype.push = function (instruction) {
        const entry = this._filterStack[this._filterStackIndex];
        if (entry) entry.inputTexture = null;
        push.call(this, instruction);
    };

    // Resize, renderer destruction and clear() all discard idle textures through this method.
    const dropTextures = pool._dropTextures;
    pool._dropTextures = function (textures, shouldDestroy) {
        if (shouldDestroy && textures.length > 0) unbindPassTextures();
        dropTextures.call(this, textures, shouldDestroy);
    };
    // A checked-out texture can outlive its bucket and be destroyed directly on return.
    const returnTexture = pool.returnTexture;
    pool.returnTexture = function (texture, resetStyle) {
        const key = this._poolKey[texture.uid];
        if (key !== undefined && !this._buckets.has(key)) unbindPassTextures();
        returnTexture.call(this, texture, resetStyle);
    };
};
