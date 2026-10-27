import { PlayerState } from '../types';
import type { LocalSong, SongResult } from '../types';
import { OnlineProviderError } from '../types/onlineMusic';
import type { OmniProviderId, OnlineProviderId } from '../types/onlineMusic';
import { omni } from '../services/onlineMusic/omni';
import { buildUnifiedLocalSong } from '../services/playbackAdapters';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlaybackStore, selectDisplayPlayerState } from '../stores/usePlaybackStore';
import { usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import { currentTime } from '../stores/motionSignals';
import {
    getPlaybackSourceRef,
    isLocalPlaybackSong,
    isOnlinePlaybackSong,
} from '../utils/appPlaybackGuards';
import { errorMessage } from '../utils/errorText';
import { queueIndexOf } from '../utils/playbackNeighbors';
import { ControlError, requireString } from './errors';
import type {
    ControlHandlerDeps,
    ControlPlaybackState,
    ControlProviderSummary,
    ControlSongSummary,
} from './types';

// src/control/helpers.ts
// Shared bridge helpers: song summaries and resolution, catalog-independent search, seek, window
// status. Every store is read through getState() so handlers stay callable outside React.

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** PROTOCOL §2.2 ControlSongSummary, from a playback song. */
export const summarizeSong = (song: SongResult): ControlSongSummary => {
    const sourceRef = getPlaybackSourceRef(song);
    const artists = Array.isArray(song.artists)
        ? song.artists.map(artist => artist?.name).filter((name): name is string => typeof name === 'string' && name.length > 0)
        : [];
    return {
        id: song.id === undefined || song.id === null ? null : String(song.id),
        title: typeof song.name === 'string' ? song.name : '',
        artist: artists[0] ?? '',
        artists,
        album: typeof song.album?.name === 'string' ? song.album.name : null,
        durationMs: Number.isFinite(song.durationMs) ? song.durationMs : 0,
        providerId: sourceRef.kind === 'online' ? sourceRef.providerId : null,
        mediaId: sourceRef.mediaId === undefined || sourceRef.mediaId === null ? null : String(sourceRef.mediaId),
        isLocal: sourceRef.kind === 'local' || isLocalPlaybackSong(song),
    };
};

export const summarizeLocalSong = (song: LocalSong): ControlSongSummary => {
    const artists = Array.isArray(song.importedMetadata?.artistNames)
        ? song.importedMetadata.artistNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
        : [];
    return {
        id: typeof song.id === 'string' ? song.id : null,
        title: typeof song.title === 'string' && song.title ? song.title : song.fileName,
        artist: artists[0] ?? '',
        artists,
        album: song.importedMetadata?.albumName ?? song.onlineMetadata?.album?.name ?? null,
        durationMs: Number.isFinite(song.duration) ? song.duration : 0,
        providerId: null,
        mediaId: typeof song.id === 'string' ? song.id : null,
        isLocal: true,
    };
};

const localSongToResult = (song: LocalSong): SongResult => buildUnifiedLocalSong({
    localSong: song,
    matchedSong: null,
    coverUrl: null,
    preferOnlineMetadata: false,
});

export const findLocalSong = (deps: ControlHandlerDeps, id: string): LocalSong | null => (
    deps.localSongs.find(song => song.id === id) ?? null
);

const looksLikePlaybackSong = (value: Record<string, unknown>): boolean => (
    typeof value.name === 'string'
    && Array.isArray(value.artists)
    && (value.album === undefined || (isPlainRecord(value.album) && typeof value.album.name === 'string'))
);

const normalizePlaybackSong = (value: Record<string, unknown>): SongResult => {
    const song = value as unknown as SongResult;
    return song.sourceRef ? song : { ...song, sourceRef: getPlaybackSourceRef(song) };
};

const songResultFromSummary = (value: Record<string, unknown>): SongResult | null => {
    const providerId = typeof value.providerId === 'string' ? value.providerId : null;
    const mediaId = typeof value.mediaId === 'string'
        ? value.mediaId
        : typeof value.id === 'string' || typeof value.id === 'number' ? String(value.id) : null;
    const title = typeof value.title === 'string' ? value.title : null;
    if (!providerId || !mediaId || !title) {
        return null;
    }
    const artists = Array.isArray(value.artists)
        ? value.artists.filter((name): name is string => typeof name === 'string')
        : [];
    return {
        id: mediaId,
        name: title,
        artists: artists.map((name, index) => ({ id: index, name })),
        album: { id: 0, name: typeof value.album === 'string' ? value.album : '' },
        durationMs: typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? value.durationMs : 0,
        sourceRef: { kind: 'online', providerId, mediaId },
    };
};

const resolveLocalIdFromSongArgument = (value: Record<string, unknown>): string | null => {
    if (typeof value.localId === 'string' && value.localId) {
        return value.localId;
    }
    const localRef = value.localRef;
    if (isPlainRecord(localRef) && typeof localRef.songId === 'string') {
        return localRef.songId;
    }
    const sourceRef = value.sourceRef;
    if (isPlainRecord(sourceRef) && sourceRef.kind === 'local' && typeof sourceRef.mediaId === 'string') {
        return sourceRef.mediaId;
    }
    if (value.isLocal === true) {
        if (typeof value.mediaId === 'string') return value.mediaId;
        if (typeof value.id === 'string') return value.id;
    }
    return null;
};

/**
 * Turns the `song` argument of folia_play / folia_queue* into a SongResult.
 * Accepts a raw SongResult, a ControlSongSummary from folia_search, or a wrapped `{ song }`.
 */
export const resolveSongArgument = async (
    deps: ControlHandlerDeps,
    value: unknown,
    label = 'song',
): Promise<SongResult> => {
    if (!isPlainRecord(value)) {
        throw new ControlError('bad_request', `"${label}" must be a JSON object`);
    }

    if (value.song !== undefined) {
        return resolveSongArgument(deps, value.song, `${label}.song`);
    }

    const localId = resolveLocalIdFromSongArgument(value);
    if (localId) {
        const local = findLocalSong(deps, localId);
        if (!local) {
            throw new ControlError('no_song', `Local song "${localId}" is not in the library`, { localId });
        }
        return localSongToResult(local);
    }

    if (looksLikePlaybackSong(value)) {
        return normalizePlaybackSong(value);
    }

    const fromSummary = songResultFromSummary(value);
    if (fromSummary) {
        return fromSummary;
    }

    const providerId = typeof value.provider === 'string' ? value.provider : null;
    const mediaId = typeof value.id === 'string' || typeof value.id === 'number' ? String(value.id) : null;
    if (providerId && mediaId) {
        const detail = await omni.getSongDetail(providerId as OmniProviderId, mediaId);
        if (!detail) {
            throw new ControlError('no_song', `Provider "${providerId}" has no song "${mediaId}"`, { providerId, mediaId });
        }
        return detail;
    }

    throw new ControlError('bad_request', `"${label}" does not identify a playable song`, {
        hint: 'Pass an object returned by folia_search, or provider + id, or localId.',
    });
};

export const resolveSongListArgument = async (
    deps: ControlHandlerDeps,
    value: unknown,
    label = 'songs',
): Promise<SongResult[]> => {
    if (!Array.isArray(value)) {
        throw new ControlError('bad_request', `"${label}" must be an array of song objects`);
    }
    const songs: SongResult[] = [];
    for (let index = 0; index < value.length; index += 1) {
        songs.push(await resolveSongArgument(deps, value[index], `${label}[${index}]`));
    }
    return songs;
};

export type ControlSearchItem = {
    index: number;
    summary: ControlSongSummary;
    song?: SongResult;
    localSong?: LocalSong;
};

export type ControlSearchOutcome = {
    items: ControlSearchItem[];
    total: number | null;
    hasMore: boolean;
    effectiveProviderId: string | null;
};

const registeredProviderIds = (): string[] => omni.getProviderSummaries().map(provider => provider.providerId);

const resolveProviderId = (candidate: string): string => {
    const known = registeredProviderIds();
    if (!known.includes(candidate)) {
        throw new ControlError('bad_request', `Unknown online provider "${candidate}"`, { providers: known });
    }
    return candidate;
};

export const filterLocalSongs = (localSongs: LocalSong[], query: string): LocalSong[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return localSongs;
    }
    return localSongs.filter((song) => {
        const artists = song.importedMetadata?.artistNames ?? [];
        const album = song.importedMetadata?.albumName ?? '';
        return [song.title, song.fileName, album, ...artists]
            .some(value => typeof value === 'string' && value.toLowerCase().includes(needle));
    });
};

export type ControlSearchInput = {
    query: string;
    source?: string;
    provider?: string;
    limit?: number;
    offset?: number;
};

/**
 * Search for folia_search / folia_play_search / folia_queue_add's query form.
 * Online results go through omni; local results are filtered out of deps.localSongs.
 */
export const searchSongs = async (
    deps: ControlHandlerDeps,
    { query, source, provider, limit = 10, offset = 0 }: ControlSearchInput,
): Promise<ControlSearchOutcome> => {
    const trimmedQuery = requireString(query, 'query').trim();
    const pageSize = clamp(Math.trunc(limit), 1, 50);
    const start = Math.max(0, Math.trunc(offset));

    const explicitProvider = provider ? resolveProviderId(provider) : null;
    const sourceIsProvider = source !== undefined && source !== 'active' && source !== 'local' && source !== 'all';
    const effectiveProviderId = explicitProvider ?? (sourceIsProvider ? resolveProviderId(source) : null);
    const wantsLocal = source === 'local';
    const wantsAll = source === 'all';

    if (wantsLocal) {
        const matches = filterLocalSongs(deps.localSongs, trimmedQuery);
        const page = matches.slice(start, start + pageSize);
        return {
            items: page.map((localSong, index) => ({
                index: start + index,
                summary: summarizeLocalSong(localSong),
                localSong,
            })),
            total: matches.length,
            hasMore: start + page.length < matches.length,
            effectiveProviderId: null,
        };
    }

    const onlineLimit = wantsAll ? clamp(start + pageSize, 1, 50) : pageSize;
    const onlineOffset = wantsAll ? 0 : start;
    let onlineItems: ControlSearchItem[] = [];
    let onlineTotal: number | null = null;
    let onlineHasMore = false;
    try {
        const page = effectiveProviderId
            ? await omni.searchProviderSongs(effectiveProviderId as OmniProviderId, trimmedQuery, {
                limit: onlineLimit,
                offset: onlineOffset,
            })
            : await omni.searchSongs(trimmedQuery, { limit: onlineLimit, offset: onlineOffset });
        onlineItems = page.items.map((song, index) => ({
            index: onlineOffset + index,
            summary: summarizeSong(song),
            song,
        }));
        onlineTotal = typeof page.total === 'number' ? page.total : null;
        onlineHasMore = page.hasMore === true;
    } catch (error) {
        throw mapOnlineError(error, 'search_failed', 'Search failed');
    }

    if (!wantsAll) {
        return {
            items: onlineItems,
            total: onlineTotal,
            hasMore: onlineHasMore,
            effectiveProviderId,
        };
    }

    const localMatches = filterLocalSongs(deps.localSongs, trimmedQuery);
    const localItems: ControlSearchItem[] = localMatches.map((localSong) => ({
        index: 0,
        summary: summarizeLocalSong(localSong),
        localSong,
    }));
    const combined: ControlSearchItem[] = [
        ...onlineItems.map(onlineItem => ({ ...onlineItem, index: 0 })),
        ...localItems,
    ];
    const page = combined.slice(start, start + pageSize).map((item, index) => ({ ...item, index: start + index }));
    const total = (onlineTotal ?? onlineItems.length) + localMatches.length;
    return {
        items: page,
        total,
        hasMore: start + page.length < total,
        effectiveProviderId,
    };
};

export const searchItemToSong = async (deps: ControlHandlerDeps, item: ControlSearchItem): Promise<SongResult> => {
    if (item.localSong) {
        return localSongToResult(item.localSong);
    }
    if (item.song) {
        return normalizePlaybackSong(item.song as unknown as Record<string, unknown>);
    }
    return resolveSongArgument(deps, item.summary);
};

/** Plays a resolved song through the App's own playback path; local songs use onPlayLocalSong. */
/**
 * 放歌前先决定落在哪个界面。
 *
 * `playSong` 内部会读用户的「按下播放后打开哪个界面」偏好，选成 `stay` 时什么也不跳——从命令行
 * 让 AI 放歌却看不到歌词动画，就是这个偏好挡住了。控制面默认显式落到播放页（那里才有动画），
 * 调用方传 `view` 才按调用方的意思来。
 */
export type ControlPlayView = 'player' | 'lattice' | 'stay';

export const resolvePlayView = (value: unknown): ControlPlayView | null => (
    value === 'player' || value === 'lattice' || value === 'stay' ? value : null
);

/** 把控制面的落点写成一次性的偏好覆盖，避免改动用户的长期设置。 */
export const withControlPlayView = async <T>(view: ControlPlayView, run: () => T | Promise<T>): Promise<T> => {
    const store = usePlaybackEntryViewStore.getState();
    const previous = store.playbackEntryView;
    if (previous === view) {
        return run();
    }
    store.setPlaybackEntryView(view);
    try {
        return await run();
    } finally {
        store.setPlaybackEntryView(previous);
    }
};

export const playResolvedSong = async (
    deps: ControlHandlerDeps,
    song: SongResult,
    view: ControlPlayView = 'player',
): Promise<void> => {
    await withControlPlayView(view, async () => {
        if (isLocalPlaybackSong(song)) {
            const local = findLocalSong(deps, song.localRef.songId);
            if (local) {
                await deps.playLocalSong(local);
                return;
            }
        }
        await deps.context.playback.playSong(song);
    });
};

export const playbackStateName = (state: PlayerState): ControlPlaybackState => {
    switch (state) {
        case PlayerState.PLAYING:
            return 'playing';
        case PlayerState.PAUSED:
            return 'paused';
        default:
            return 'idle';
    }
};

export const currentPlaybackStateName = (): ControlPlaybackState => (
    playbackStateName(selectDisplayPlayerState(usePlaybackStore.getState()))
);

export const currentQueueIndex = (): number => {
    const state = usePlaybackStore.getState();
    return queueIndexOf(state.playQueue, state.currentSong);
};

export const providerSummaries = (): ControlProviderSummary[] => omni.getProviderSummaries().map(provider => ({
    id: provider.providerId,
    displayName: provider.displayName,
    status: provider.status,
    requiresAccount: provider.requiresAccount ?? false,
}));

/** Maps provider/app errors onto catalog error codes instead of leaking raw provider errors. */
export const mapOnlineError = (
    thrown: unknown,
    fallback: 'search_failed' | 'playback_failed' | 'unsupported' | 'unavailable',
    contextMessage: string,
): ControlError => {
    if (thrown instanceof ControlError) {
        return thrown;
    }
    const message = errorMessage(thrown) || contextMessage;
    if (thrown instanceof OnlineProviderError) {
        if (thrown.code === 'unsupported') {
            return new ControlError('unsupported', message, { providerId: thrown.providerId });
        }
        if (thrown.code === 'auth-required' || thrown.code === 'subscription-required' || thrown.code === 'unavailable') {
            return new ControlError('unavailable', message, { providerId: thrown.providerId });
        }
        return new ControlError(fallback, message, { providerId: thrown.providerId });
    }
    return new ControlError(fallback, message);
};

// ---- seek ----

const findActiveAudioElement = (): HTMLAudioElement | null => {
    if (typeof document === 'undefined') {
        return null;
    }
    const elements = Array.from(document.querySelectorAll('audio'));
    if (elements.length === 0) {
        return null;
    }
    const audioSrc = usePlaybackStore.getState().audioSrc;
    if (audioSrc) {
        const matching = elements.find(element => (
            element.currentSrc === audioSrc
            || element.src === audioSrc
            || element.getAttribute('src') === audioSrc
        ));
        if (matching) {
            return matching;
        }
    }
    return elements.find(element => !element.paused && !element.ended) ?? elements[0] ?? null;
};

/**
 * Seeks the deck the listener hears. The bridge has no audioRef (its props are fixed by
 * controlHostDeps), so it reaches the rendered <audio> deck and picks the active one by source.
 * A seek resumes playback, exactly like dragging the progress bar does.
 */
export const seekPlaybackTo = (targetSeconds: number): number => {
    const state = usePlaybackStore.getState();
    const element = findActiveAudioElement();
    if (!element) {
        throw new ControlError('unavailable', 'No audio deck is mounted, so there is nothing to seek');
    }
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : state.duration;
    const next = duration > 0 ? clamp(targetSeconds, 0, duration) : Math.max(0, targetSeconds);
    try {
        element.currentTime = next;
    } catch (error) {
        throw new ControlError('playback_failed', `Could not seek the audio deck: ${errorMessage(error)}`);
    }
    currentTime.set(next);
    if (element.paused) {
        void element.play().catch((error: unknown) => {
            console.warn('[Control] Seek could not resume playback:', error);
        });
    }
    return next;
};

// ---- window / settings helpers ----

export type ControlWindowStatus = {
    supported: boolean;
    maximized: boolean | null;
    fullscreen: boolean | null;
    alwaysOnTop: boolean | null;
    clickThrough: boolean | null;
};

const settleBoolean = async (promise: Promise<boolean> | undefined): Promise<boolean | null> => {
    if (!promise) {
        return null;
    }
    try {
        const value = await promise;
        return typeof value === 'boolean' ? value : null;
    } catch {
        return null;
    }
};

export const readWindowStatus = async (): Promise<ControlWindowStatus> => {
    const electron = typeof window !== 'undefined' ? window.electron : undefined;
    if (!electron) {
        return { supported: false, maximized: null, fullscreen: null, alwaysOnTop: null, clickThrough: null };
    }
    const [maximized, fullscreen, alwaysOnTop, clickThrough] = await Promise.all([
        settleBoolean(electron.isWindowMaximized?.()),
        settleBoolean(electron.isWindowFullscreen?.()),
        settleBoolean(electron.getMainWindowAlwaysOnTop?.()),
        settleBoolean(electron.getMainWindowClickThroughEnabled?.()),
    ]);
    return { supported: true, maximized, fullscreen, alwaysOnTop, clickThrough };
};

const SENSITIVE_SETTINGS_KEY = /(api[-_]?key|token|secret|password|cookie|credential|authorization)/i;

const redactSettings = (value: unknown, depth = 0): unknown => {
    if (depth > 4 || value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(entry => redactSettings(entry, depth + 1));
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
        SENSITIVE_SETTINGS_KEY.test(key)
            ? [key, entry === undefined || entry === null ? entry : '<redacted>']
            : [key, redactSettings(entry, depth + 1)]
    )));
};

/** The main process's own settings snapshot, with credential-shaped fields redacted. */
export const readMainProcessSettings = async (): Promise<Record<string, unknown>> => {
    const electron = typeof window !== 'undefined' ? window.electron : undefined;
    if (!electron?.getSettings) {
        return {};
    }
    try {
        const settings = await electron.getSettings();
        return isPlainRecord(settings) ? redactSettings(settings) as Record<string, unknown> : {};
    } catch (error) {
        console.warn('[Control] Could not read main-process settings:', error);
        return {};
    }
};

// ---- command palette UI state ----

/** The palette keeps its open flag in React state; the rendered panel is the only visible truth. */
export const isCommandPaletteOpen = (): boolean => (
    typeof document !== 'undefined' && Boolean(document.querySelector('[data-testid="command-palette-panel"]'))
);

/** The active online provider id, for the status summary. */
export const activeProviderId = (): OnlineProviderId | null => {
    const active = omni.getActiveProviderSummary();
    return active ? active.providerId : null;
};

export const isOnlineSong = (song: SongResult | null): song is SongResult => Boolean(song && isOnlinePlaybackSong(song));

/** Re-reads the audio store to report volume the way folia_volume does. */
export const readVolume = () => {
    const state = useAudioSettingsStore.getState();
    return {
        level: state.volume,
        percent: Math.round(state.volume * 100),
        muted: state.isMuted,
    };
};
