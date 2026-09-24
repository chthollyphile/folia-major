import type { LyricData, SongResult } from '../types';
import type { ProviderAudioSource, ProviderLyricsResult } from '../types/onlineMusic';

// src/services/hostExtensionHooks.ts
// Interception points the host exposes to extension layers (Folium mods today).
// Host code calls these at its own boundaries — the incoming-lyrics pipeline,
// the start of playSong — without importing anything mod-specific; the extension layer
// installs the implementations. With nothing installed every call is a
// synchronous pass-through, so the host behaves exactly as before.

export type LyricsTransformHook = (lyrics: LyricData) => LyricData;

export interface BeforePlayDecision {
    cancel: boolean;
    song: SongResult;
}

export type BeforePlayHook = (song: SongResult) => Promise<BeforePlayDecision> | BeforePlayDecision | null;

let lyricsTransformHook: LyricsTransformHook | null = null;
let beforePlayHook: BeforePlayHook | null = null;
// Lets the extension layer say "installed, but nobody is listening right now",
// so playSong keeps its synchronous start for users without such mods.
let beforePlayActive: () => boolean = () => true;

// Transformed output → the lyrics it was made from. Lets the host re-run its
// pipeline on lyrics already on screen (an automix cancel re-applies them)
// from the untransformed source, so the transform never stacks.
const transformSources = new WeakMap<LyricData, LyricData>();

export const installLyricsTransformHook = (hook: LyricsTransformHook | null) => {
    lyricsTransformHook = hook;
};

export const installBeforePlayHook = (hook: BeforePlayHook | null, isActive: () => boolean = () => true) => {
    beforePlayHook = hook;
    beforePlayActive = isActive;
};

/** The lyrics a transformed output was made from; anything else is returned as is. */
export const untransformedLyrics = (lyrics: LyricData | null): LyricData | null => (
    lyrics ? transformSources.get(lyrics) ?? lyrics : lyrics
);

/*
 * Runs the installed lyrics transform. Called where the host produces lyrics
 * (end of createLyricsSetter, the word-segmentation update), not in the store
 * setter. A transformed input is transformed from its source instead, so the
 * transform never stacks. A throwing transform is contained here: lyrics must
 * always reach the screen.
 */
export const applyLyricsTransform = (lyrics: LyricData | null): LyricData | null => {
    const source = untransformedLyrics(lyrics);
    if (!source || !lyricsTransformHook) return source;
    try {
        const next = lyricsTransformHook(source);
        if (next !== source) transformSources.set(next, source);
        return next;
    } catch (error) {
        console.warn('[HostHooks] lyrics transform failed; using the original lyrics', error);
        return source;
    }
};

/*
 * Asks the installed hook whether `song` may start. Returns the song to play
 * (possibly replaced) or null when playback was cancelled. Without a hook this
 * resolves synchronously-fast to the same song.
 */
export const runBeforePlayHook = async (song: SongResult): Promise<SongResult | null> => {
    if (!beforePlayHook) return song;
    try {
        const decision = await beforePlayHook(song);
        if (!decision) return song;
        return decision.cancel ? null : decision.song;
    } catch (error) {
        console.warn('[HostHooks] before-play hook failed; playing the original song', error);
        return song;
    }
};

export const hasBeforePlayHook = () => beforePlayHook !== null && beforePlayActive();

/*
 * Omni result hooks: run inside the Omni facade after a provider answered, so
 * an extension can rewrite the lyrics or swap the audio URL of any online
 * song without touching a provider. Pass-through when not installed or idle.
 */
export interface OmniResultHooks {
    lyrics?: (song: SongResult, result: ProviderLyricsResult) => Promise<ProviderLyricsResult>;
    audio?: (song: SongResult, source: ProviderAudioSource | null) => Promise<ProviderAudioSource | null>;
    isActive?: (kind: 'lyrics' | 'audio') => boolean;
}

let omniHooks: OmniResultHooks | null = null;

export const installOmniResultHooks = (hooks: OmniResultHooks | null) => {
    omniHooks = hooks;
};

export const applyOmniLyricsHook = async (song: SongResult, result: ProviderLyricsResult): Promise<ProviderLyricsResult> => {
    if (!omniHooks?.lyrics || omniHooks.isActive?.('lyrics') === false) return result;
    try {
        return await omniHooks.lyrics(song, result);
    } catch (error) {
        console.warn('[HostHooks] omni lyrics hook failed; using the provider result', error);
        return result;
    }
};

export const applyOmniAudioHook = async (song: SongResult, source: ProviderAudioSource | null): Promise<ProviderAudioSource | null> => {
    if (!omniHooks?.audio || omniHooks.isActive?.('audio') === false) return source;
    try {
        return await omniHooks.audio(song, source);
    } catch (error) {
        console.warn('[HostHooks] omni audio hook failed; using the provider source', error);
        return source;
    }
};
