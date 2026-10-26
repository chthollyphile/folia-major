import type { SceneManifest } from '../definition';

// src/components/scenes/engine/scenePlacement.ts
// 按清单决定借来的歌词样式和背景放在哪；以及选了场景时选择器里哪些样式、背景还出现。

export interface SceneLayerPlan {
    /** One box per surface that borrows something: the user's lyric style, the user's background, or both. */
    surfaces: { id: string; lyrics: boolean; background: boolean }[];
    /** The user's lyric style over the whole scene (background transparent). */
    overlayLyrics: boolean;
    /** The user's background under the whole scene (no lyrics). */
    behindBackground: boolean;
}

/** Where the host puts the user's lyric style and background for this scene. */
export const planSceneLayers = (manifest: SceneManifest): SceneLayerPlan => {
    const plan: SceneLayerPlan = { surfaces: [], overlayLyrics: false, behindBackground: false };
    const onSurface = (id: string) => {
        let surface = plan.surfaces.find(entry => entry.id === id);
        if (!surface) {
            surface = { id, lyrics: false, background: false };
            plan.surfaces.push(surface);
        }
        return surface;
    };
    const { style } = manifest.lyrics;
    if (style === 'overlay') plan.overlayLyrics = true;
    else if (typeof style === 'object') onSurface(style.surface).lyrics = true;
    const { host } = manifest.background;
    if (host === 'behind') plan.behindBackground = true;
    else if (typeof host === 'object') onSurface(host.surface).background = true;
    return plan;
};

/** Whether a lyric style is offered while this scene is chosen (null: no scene, everything is). */
export const sceneOffersLyricStyle = (manifest: SceneManifest | null, mode: string): boolean =>
    !manifest || (manifest.lyrics.style !== 'none' && !(manifest.lyrics.exclude ?? []).includes(mode));

export const sceneOffersBackground = (manifest: SceneManifest | null, mode: string): boolean =>
    !manifest || (manifest.background.host !== 'none' && !(manifest.background.exclude ?? []).includes(mode));

/**
 * The lyric style the scene shows: the user's when the scene offers it, else the first one it offers
 * (a style chosen before the scene was). What is saved is left as it is.
 */
export const resolveSceneOffered = <T extends string>(offered: (mode: string) => boolean, mode: T, inOrder: readonly T[]): T =>
    offered(mode) ? mode : inOrder.find(candidate => offered(candidate)) ?? mode;
