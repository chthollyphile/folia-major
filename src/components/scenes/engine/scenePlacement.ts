import type { SceneManifest } from '../definition';

// src/components/scenes/engine/scenePlacement.ts
// 按清单和用户的两个开关，决定借来的歌词样式和背景放在哪；以及选了场景时选择器里哪些样式、背景还出现。

/** The scene's own lyrics or the user's lyric style; the scene's own screen picture or the user's background. */
export interface SceneSourceChoice {
    lyrics?: 'scene' | 'style';
    screen?: 'scene' | 'background';
}

export interface SceneLayerPlan {
    /** One box per surface that borrows something: the user's lyric style, the user's background, or both. */
    surfaces: { id: string; lyrics: boolean; background: boolean }[];
    /** The user's lyric style over the whole scene (background transparent). */
    overlayLyrics: boolean;
    /** The user's background under the whole scene (no lyrics). */
    behindBackground: boolean;
}

/** Whether the user's lyric style is used, given what the scene allows and the user's choice. */
export const usesLyricStyle = (manifest: SceneManifest, choice: SceneSourceChoice): boolean =>
    manifest.lyrics.style !== 'none' && (!manifest.lyrics.own || choice.lyrics === 'style');

export const usesBackground = (manifest: SceneManifest, choice: SceneSourceChoice): boolean =>
    manifest.background.host !== 'none' && (!manifest.background.own || choice.screen === 'background');

/** Where the host puts the borrowed lyric style and background for this scene. */
export const planSceneLayers = (manifest: SceneManifest, choice: SceneSourceChoice): SceneLayerPlan => {
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
    if (usesLyricStyle(manifest, choice)) {
        if (style === 'overlay') plan.overlayLyrics = true;
        else if (typeof style === 'object') onSurface(style.surface).lyrics = true;
    }
    const { host } = manifest.background;
    if (usesBackground(manifest, choice)) {
        if (host === 'behind') plan.behindBackground = true;
        else if (typeof host === 'object') onSurface(host.surface).background = true;
    }
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
