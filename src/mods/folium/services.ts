import type { ModRuntimeInfo } from '../types';
import { homeTabsRegistry, selectFoliumHomeTab } from './registries/homeTabs';
import { invokeModNetFetch, invokeModPickFile, invokeModReleaseFile, invokeModRestoreFile } from '../ipc';
import type {
    FoliumContextKind,
    FoliumDisposer,
    FoliumFetchInit,
    FoliumFetchResponse,
    FoliumFileHandle,
    FoliumIconOptions,
    FoliumLine,
    FoliumLoopMode,
    FoliumLyricsService,
    FoliumNetService,
    FoliumPlaybackService,
    FoliumQueueReplaceResult,
    FoliumQueueSnapshot,
    FoliumSong,
    FoliumUiService,
} from './contract';
import { FOLIUM_SONG_REF_POOL_SIZE, FOLIUM_SONG_REF_PREFIX } from './dto';
import type { FoliumPermissionId } from './shared';
import { FOLIUM_LYRICS_HELPERS } from './sharedHelpers';

// src/mods/folium/services.ts
// `folium.playback`, `folium.ui`, `folium.net` and `folium.lyrics`. This module deliberately
// imports no app stores (nothing under src/stores): the export window loads it
// too. The one store it does bring in is mods-owned — the home-page selection in
// registries/homeTabs (pinned by foliumServicesBoundary.test.ts). The main window's App
// registers the real actions (registerFoliumHostActions, see hostActions.ts);
// until it has — and always in the export window — calls fail with a clear
// "unavailable" error instead of touching state that does not exist there.

export interface FoliumHostActions {
    getPlaybackState: () => ReturnType<FoliumPlaybackService['getState']>;
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (seconds: number) => void;
    /** The builtin lyric-line seek: lyric time in, converted to playback time by the host. */
    seekToLyricTime: (lyricSeconds: number) => void;
    next: () => void;
    previous: () => void;
    /** Resolves a song ref and plays it; false when the ref is unknown. */
    playSongRef: (ref: string) => Promise<boolean>;
    enqueueSongRef: (ref: string) => boolean;
    /** False when the queue cannot be shuffled right now. */
    shuffleQueue: () => boolean;
    /** False when the displayed song cannot be liked right now. */
    toggleLike: () => boolean;
    getVolume: () => { volume: number; muted: boolean };
    /** Already clamped to 0–1 by the service. */
    setVolume: (volume: number) => void;
    setMuted: (muted: boolean) => void;
    getLoopMode: () => FoliumLoopMode;
    setLoopMode: (mode: FoliumLoopMode) => void;
    /** `offset` is a whole number or undefined (centre on the displayed song); `limit` is 1–500. */
    getQueue: (offset: number | undefined, limit: number) => FoliumQueueSnapshot;
    /** False when the entry cannot be played: out of range, Stage playback, or no longer `expectedRef`. */
    playQueueItem: (index: number, expectedRef: string | undefined) => Promise<boolean>;
    /** Folium 1.7: `refs` are song refs (checked by the service); the host answers the state reasons itself. */
    replaceQueue: (modId: string, refs: readonly string[], expectedVersion: string) => FoliumQueueReplaceResult;
    toast: (message: string, type: 'info' | 'success' | 'error', durationMs?: number) => void;
    openPlayerPanel: (tab: string | null) => void;
    navigate: (view: 'home' | 'player') => void;
    openVolume: () => void;
    /** The lines on screen now, as DTOs; empty when there are none. */
    getLyricLines: () => readonly FoliumLine[];
    /** Runs `lyrics.transform` again on the displayed song's untransformed lyrics; nothing while they load. */
    refreshLyrics: () => void;
}

let hostActions: FoliumHostActions | null = null;

export const registerFoliumHostActions = (actions: FoliumHostActions | null) => {
    hostActions = actions;
};

const PLAYBACK_CONTROL: FoliumPermissionId = 'playback.control';
const PLAYBACK_QUEUE: FoliumPermissionId = 'playback.queue';
const NET_EMBED: FoliumPermissionId = 'net.embed';

const unavailable = (what: string, context: FoliumContextKind) => new Error(`${what}-unavailable-in-${context}-context`);

/** Throws `<what>-unavailable-in-<context>-context` outside the main window. */
const requireMain = (what: string, context: FoliumContextKind) => {
    if (context !== 'main') throw unavailable(what, context);
};

/** The App's actions; unavailable outside the main window and until the App registered them. */
const requireActions = (what: string, context: FoliumContextKind): FoliumHostActions => {
    requireMain(what, context);
    if (!hostActions) throw unavailable(what, context);
    return hostActions;
};

const requirePermission = (mod: ModRuntimeInfo, permission: FoliumPermissionId) => {
    if (!mod.permissions.includes(permission)) {
        throw new Error(`permission-denied:${permission}`);
    }
};

const requireRef = (song: FoliumSong): string => {
    if (!song || typeof song.ref !== 'string') {
        throw new Error('song-ref-required: pass a song DTO that came from the host');
    }
    return song.ref;
};

const LOOP_MODES: readonly FoliumLoopMode[] = ['off', 'all', 'one'];
// The most queue entries one getQueue call returns, and its default page size.
const MAX_QUEUE_PAGE = 500;

/*
 * getQueue's options, checked: a value that is given must be a finite number
 * (anything else throws rather than silently reading another page). Both are
 * floored; the limit is clamped to 1–500 here, the offset to the queue length
 * by the host, which is the side that knows the length.
 */
const resolveQueuePage = (options: { offset?: number; limit?: number } | undefined) => {
    const { offset, limit } = options ?? {};
    if (offset !== undefined && !Number.isFinite(offset)) {
        throw new Error('playback.getQueue: offset must be a finite number');
    }
    if (limit !== undefined && !Number.isFinite(limit)) {
        throw new Error('playback.getQueue: limit must be a finite number');
    }
    return {
        offset: offset === undefined ? undefined : Math.floor(offset),
        limit: limit === undefined ? MAX_QUEUE_PAGE : Math.min(MAX_QUEUE_PAGE, Math.max(1, Math.floor(limit))),
    };
};

const invalidArguments = (problem: string) => new TypeError(`invalid-arguments: ${problem}`);

/*
 * replaceQueue's arguments, checked: an array of at most one ref pool's worth of song DTOs from the host,
 * and a version string. A DTO of another kind (a folium.omni album, an object made up by the mod) is a
 * malformed argument, as folium.omni has it, not a stale ref: reading it again would never mend it.
 */
const queueReplaceRefsOf = (songs: unknown, options: unknown): { refs: string[]; expectedVersion: string } => {
    if (!Array.isArray(songs)) throw invalidArguments('songs must be an array');
    if (songs.length > FOLIUM_SONG_REF_POOL_SIZE) throw invalidArguments(`songs holds more than ${FOLIUM_SONG_REF_POOL_SIZE} songs`);
    const refs: string[] = [];
    for (let index = 0; index < songs.length; index += 1) {
        const song: unknown = songs[index];
        const ref = typeof song === 'object' && song !== null ? (song as { ref?: unknown }).ref : undefined;
        if (typeof ref !== 'string' || !ref.startsWith(FOLIUM_SONG_REF_PREFIX)) {
            throw invalidArguments(`songs[${index}] is not a song DTO that came from the host`);
        }
        refs.push(ref);
    }
    const expectedVersion = typeof options === 'object' && options !== null ? (options as { expectedVersion?: unknown }).expectedVersion : undefined;
    if (typeof expectedVersion !== 'string' || expectedVersion === '') throw invalidArguments('expectedVersion must be a string');
    return { refs, expectedVersion };
};

export const createFoliumPlaybackService = (mod: ModRuntimeInfo, context: FoliumContextKind): FoliumPlaybackService => {
    const control = () => {
        requirePermission(mod, PLAYBACK_CONTROL);
        return requireActions('playback', context);
    };
    return Object.freeze({
        getState: () => requireActions('playback', context).getPlaybackState(),
        play: () => control().play(),
        pause: () => control().pause(),
        toggle: () => control().toggle(),
        seek: (seconds: number) => {
            if (!Number.isFinite(seconds)) throw new Error('playback.seek requires a finite number of seconds');
            control().seek(Math.max(0, seconds));
        },
        seekToLyricTime: (lyricSeconds: number) => {
            if (!Number.isFinite(lyricSeconds)) throw new Error('playback.seekToLyricTime requires a finite number of seconds');
            control().seekToLyricTime(lyricSeconds);
        },
        next: () => control().next(),
        previous: () => control().previous(),
        playSong: async (song: FoliumSong) => control().playSongRef(requireRef(song)),
        enqueue: (song: FoliumSong) => control().enqueueSongRef(requireRef(song)),
        shuffleQueue: () => control().shuffleQueue(),
        toggleLike: () => control().toggleLike(),
        getVolume: () => requireActions('playback', context).getVolume(),
        setVolume: (volume: number) => {
            if (!Number.isFinite(volume)) throw new Error('playback.setVolume requires a finite number');
            control().setVolume(Math.min(1, Math.max(0, volume)));
        },
        setMuted: (muted: boolean) => {
            if (typeof muted !== 'boolean') throw new Error('playback.setMuted requires a boolean');
            control().setMuted(muted);
        },
        getLoopMode: () => requireActions('playback', context).getLoopMode(),
        setLoopMode: (mode: FoliumLoopMode) => {
            if (!LOOP_MODES.includes(mode)) throw new Error(`playback.setLoopMode: unknown mode "${String(mode)}"`);
            control().setLoopMode(mode);
        },
        getQueue: (options?: { offset?: number; limit?: number }) => {
            const page = resolveQueuePage(options);
            return requireActions('playback', context).getQueue(page.offset, page.limit);
        },
        playQueueItem: async (index: number, expectedRef?: string) => {
            if (!Number.isInteger(index)) throw new Error('playback.playQueueItem requires an integer index');
            return control().playQueueItem(index, expectedRef);
        },
        // Checked in this order: the permission, the window, the arguments; the host answers the rest.
        replaceQueue: async (songs: readonly FoliumSong[], options: { expectedVersion: string }) => {
            requirePermission(mod, PLAYBACK_QUEUE);
            const actions = requireActions('playback', context);
            const { refs, expectedVersion } = queueReplaceRefsOf(songs, options);
            return actions.replaceQueue(mod.id, refs, expectedVersion);
        },
    });
};

/*
 * The embed iframe. Sandbox keeps the page away from the host document (no
 * same-origin with Folia, no top navigation, no popups escaping); the origin
 * check against the manifest runs here, at the only place mods can create one
 * through the API.
 */
const DEFAULT_EMBED_ALLOW = ['autoplay', 'encrypted-media', 'picture-in-picture', 'fullscreen'];

const createEmbed = (
    mod: ModRuntimeInfo,
    container: HTMLElement,
    url: string,
    options: { title?: string; allow?: string[] } = {},
): FoliumDisposer => {
    requirePermission(mod, NET_EMBED);
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`embed-invalid-url:${url}`);
    }
    if (parsed.protocol !== 'https:' || !(mod.embedOrigins ?? []).includes(parsed.origin)) {
        throw new Error(`embed-origin-not-declared:${parsed.origin} (add it to "embedOrigins" in mod.json)`);
    }
    if (!(container instanceof HTMLElement)) {
        throw new Error('embed requires a container element');
    }
    const frame = document.createElement('iframe');
    frame.src = parsed.toString();
    frame.title = options.title ?? parsed.hostname;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
    frame.setAttribute('allow', (options.allow ?? DEFAULT_EMBED_ALLOW).join('; '));
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.style.cssText = 'border:0;width:100%;height:100%;display:block;';
    container.appendChild(frame);
    return () => frame.remove();
};

export const createFoliumUiService = (mod: ModRuntimeInfo, context: FoliumContextKind): FoliumUiService => Object.freeze({
    toast: (message: string, options: { type?: 'info' | 'success' | 'error'; durationMs?: number } = {}) => {
        requireActions('ui', context).toast(String(message), options.type ?? 'info', options.durationMs);
    },
    openPlayerPanel: (tabId?: string) => {
        requireActions('ui', context).openPlayerPanel(tabId ? `folium:${mod.id}:${tabId}` : null);
    },
    openHomeTab: (tabId: string) => {
        const actions = requireActions('ui', context);
        const id = `${mod.id}:${tabId}` as const;
        if (!homeTabsRegistry.get(id)) throw new Error(`home-tab-not-registered:${tabId}`);
        actions.navigate('home');
        selectFoliumHomeTab(id);
    },
    navigate: (view: 'home' | 'player') => {
        if (view !== 'home' && view !== 'player') throw new Error(`ui.navigate: unknown view "${String(view)}"`);
        requireActions('ui', context).navigate(view);
    },
    openVolume: () => requireActions('ui', context).openVolume(),
    pickFile: async (options: { accept?: 'video' | 'audio' | 'image' | 'any'; persist?: boolean } = {}) => {
        requireMain('ui', context);
        const response = await invokeModPickFile(mod.id, options.accept ?? 'any', options.persist === true);
        if (!response.ok) throw new Error(response.error ?? 'pick-file-failed');
        return (response.result as FoliumFileHandle | null) ?? null;
    },
    restoreFile: async (grantId: string) => {
        requireMain('ui', context);
        if (typeof grantId !== 'string' || !grantId) return null;
        const response = await invokeModRestoreFile(mod.id, grantId);
        if (!response.ok) throw new Error(response.error ?? 'restore-file-failed');
        return (response.result as FoliumFileHandle | null) ?? null;
    },
    releaseFile: async (grantId: string) => {
        requireMain('ui', context);
        if (typeof grantId !== 'string' || !grantId) return;
        const response = await invokeModReleaseFile(mod.id, grantId);
        if (!response.ok) throw new Error(response.error ?? 'release-file-failed');
    },
    embed: (container: HTMLElement, url: string, options?: { title?: string; allow?: string[] }) => {
        requireMain('ui', context);
        return createEmbed(mod, container, url, options);
    },
    // Loaded on first use: the icon table alone lists every lucide icon.
    icon: async (name: string, options?: FoliumIconOptions) => (await import('./icons')).createFoliumIcon(name, options),
});

/** `folium.lyrics`: the shared helpers, plus the displayed song's lyrics from the App. */
export const createFoliumLyricsService = (context: FoliumContextKind): FoliumLyricsService => Object.freeze({
    ...FOLIUM_LYRICS_HELPERS,
    getLines: () => requireActions('lyrics', context).getLyricLines(),
    refresh: () => requireActions('lyrics', context).refreshLyrics(),
});

const buildResponse = (raw: { status: number; statusText: string; headers: Record<string, string>; body: string }): FoliumFetchResponse => {
    const headers = Object.freeze({ ...raw.headers });
    return Object.freeze({
        ok: raw.status >= 200 && raw.status < 300,
        status: raw.status,
        statusText: raw.statusText,
        headers,
        text: () => raw.body,
        json: <T>() => JSON.parse(raw.body) as T,
    });
};

export const createFoliumNetService = (mod: ModRuntimeInfo, context: FoliumContextKind): FoliumNetService => Object.freeze({
    fetch: async (url: string, init: FoliumFetchInit = {}) => {
        requireMain('net', context);
        const response = await invokeModNetFetch(mod.id, String(url), init);
        if (!response.ok) throw new Error(response.error ?? 'net-fetch-failed');
        return buildResponse(response.result as { status: number; statusText: string; headers: Record<string, string>; body: string });
    },
});
