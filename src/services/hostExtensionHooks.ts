import type { LyricData, SongResult } from '../types';
import type { OnlineFailureCaseId, ProviderAudioSource, ProviderLyricsResult } from '../types/onlineMusic';
import { ensureLyricDataRenderHints } from '../utils/lyrics/renderHints';

// src/services/hostExtensionHooks.ts
// Interception points the host exposes to extension layers (Folium mods today).
// Host code calls these at its own boundaries — the incoming-lyrics pipeline,
// the start of playSong — without importing anything mod-specific; the extension layer
// installs the implementations. With nothing installed every call is a
// synchronous pass-through, so the host behaves exactly as before.
// Besides the hooks there is one notification, playback failures (notifyPlaybackFailed).

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

// The empty bases lyricsForNoLyrics handed to the transform, so a re-run starts from the same kind of base.
const emptyBases = new WeakSet<LyricData>();

/*
 * What to show for a song whose lyric load ended with nothing (no lyrics, an
 * instrumental, a failed fetch): the installed transform runs on an empty
 * base, and its answer counts only when it has lines. Otherwise the song stays
 * without lyrics (null), so with no transform, or with one that only rewrites
 * the lines it is given, nothing changes. Called where a load ends for the
 * song still current, never by the lyric setter: setting null is also how the
 * app clears lyrics (song start, platform switch, stage reset).
 */
export const lyricsForNoLyrics = (base?: LyricData): LyricData | null => {
    if (!lyricsTransformHook) return null;
    const empty = base ?? ensureLyricDataRenderHints<LyricData>({ lines: [] })!;
    emptyBases.add(empty);
    const next = applyLyricsTransform(empty);
    return next && next !== empty && next.lines.length > 0 ? next : null;
};

/*
 * Runs the transform again on what `current` was made from (an extension asked
 * for it): the untransformed lyrics; or, when the song had none (`current` is
 * null after a finished load, or lyrics the transform supplied on an empty
 * base), an empty base again, whose answer again counts only with lines.
 */
export const rerunLyricsTransform = (current: LyricData | null): LyricData | null => {
    const source = untransformedLyrics(current);
    if (source === null) return lyricsForNoLyrics();
    if (emptyBases.has(source)) return lyricsForNoLyrics(source);
    return applyLyricsTransform(source);
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

/*
 * Playback failures, after the fact: the host reports each failure the listener
 * can see ("this song cannot play") once, after its own retries, where the
 * message or countdown has already been written. Not a hook: the listener
 * cannot change what the host does. Installed by the extension layer in the
 * main window only, so the export window never reports.
 */
export interface PlaybackFailedNotice {
    /** The song that failed: the requested one when picked, the current one otherwise. */
    song: SongResult | null;
    /** The classified reason, or null when the path has none (local, Navidrome, a bare media error). */
    reason: OnlineFailureCaseId | null;
    /** No source for a pick ('play') or a restore ('restore'); any media error is 'mid-playback', even before the first sound. */
    phase: 'play' | 'restore' | 'mid-playback';
    /** The host is counting down to skip it. */
    willAutoSkip: boolean;
}

export type PlaybackFailedListener = (notice: PlaybackFailedNotice) => void;

let playbackFailedListener: PlaybackFailedListener | null = null;

export const installPlaybackFailedListener = (listener: PlaybackFailedListener | null) => {
    playbackFailedListener = listener;
};

/** Reports one visible playback failure; a throwing listener never reaches the playback path. */
export const notifyPlaybackFailed = (notice: PlaybackFailedNotice): void => {
    if (!playbackFailedListener) return;
    try {
        playbackFailedListener(notice);
    } catch (error) {
        console.warn('[HostHooks] playback failed listener threw', error);
    }
};
