import type { ModRuntimeInfo } from '../types';
import { invokeModNetFetch, invokeModPickFile } from '../ipc';
import type {
    FoliumContextKind,
    FoliumDisposer,
    FoliumFetchInit,
    FoliumFetchResponse,
    FoliumNetService,
    FoliumPlaybackService,
    FoliumSong,
    FoliumUiService,
} from './contract';

// src/mods/folium/services.ts
// `folium.playback`, `folium.ui` and `folium.net`. This module deliberately
// imports no app stores: the export window loads it too. The main window's App
// registers the real actions (registerFoliumHostActions, see hostActions.ts);
// until it has — and always in the export window — calls fail with a clear
// "unavailable" error instead of touching state that does not exist there.

export interface FoliumHostActions {
    getPlaybackState: () => ReturnType<FoliumPlaybackService['getState']>;
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (seconds: number) => void;
    next: () => void;
    previous: () => void;
    /** Resolves a song ref and plays it; false when the ref is unknown. */
    playSongRef: (ref: string) => Promise<boolean>;
    enqueueSongRef: (ref: string) => boolean;
    toast: (message: string, type: 'info' | 'success' | 'error', durationMs?: number) => void;
    openPlayerPanel: (tab: string | null) => void;
    navigate: (view: 'home' | 'player') => void;
}

let hostActions: FoliumHostActions | null = null;

export const registerFoliumHostActions = (actions: FoliumHostActions | null) => {
    hostActions = actions;
};

const PLAYBACK_CONTROL = 'playback.control';
const NET_EMBED = 'net.embed';

const requireActions = (what: string, context: FoliumContextKind): FoliumHostActions => {
    if (context !== 'main' || !hostActions) {
        throw new Error(`${what}-unavailable-in-${context}-context`);
    }
    return hostActions;
};

const requirePermission = (mod: ModRuntimeInfo, permission: string) => {
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
        next: () => control().next(),
        previous: () => control().previous(),
        playSong: async (song: FoliumSong) => control().playSongRef(requireRef(song)),
        enqueue: (song: FoliumSong) => control().enqueueSongRef(requireRef(song)),
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
    navigate: (view: 'home' | 'player') => {
        if (view !== 'home' && view !== 'player') throw new Error(`ui.navigate: unknown view "${String(view)}"`);
        requireActions('ui', context).navigate(view);
    },
    pickFile: async (options: { accept?: 'video' | 'audio' | 'image' | 'any' } = {}) => {
        if (context !== 'main') throw new Error(`ui-unavailable-in-${context}-context`);
        const response = await invokeModPickFile(mod.id, options.accept ?? 'any');
        if (!response.ok) throw new Error(response.error ?? 'pick-file-failed');
        return (response.result as { url: string; name: string; size: number } | null) ?? null;
    },
    embed: (container: HTMLElement, url: string, options?: { title?: string; allow?: string[] }) => {
        if (context !== 'main') throw new Error(`ui-unavailable-in-${context}-context`);
        return createEmbed(mod, container, url, options);
    },
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
        if (context !== 'main') throw new Error(`net-unavailable-in-${context}-context`);
        const response = await invokeModNetFetch(mod.id, String(url), init);
        if (!response.ok) throw new Error(response.error ?? 'net-fetch-failed');
        return buildResponse(response.result as { status: number; statusText: string; headers: Record<string, string>; body: string });
    },
});
