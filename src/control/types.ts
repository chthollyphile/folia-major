import type { CommandPaletteContext } from '../components/command-palette/types';
import type { LocalSong, SongResult } from '../types';

// src/control/types.ts
// The contract of the in-app control bridge (control/PROTOCOL.md §2): envelope, error codes,
// state snapshot, events, and the dependency bag the handlers receive from ControlHost.
//
// Shapes here mirror PROTOCOL §2 exactly; the tool list itself stays in shared/controlCatalog.mjs.

/** JSON-schema subset the catalog uses for tool arguments. */
export type ControlToolPropertySchema = {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
    description?: string;
    enum?: readonly unknown[];
    minimum?: number;
    maximum?: number;
    items?: ControlToolPropertySchema;
    properties?: Record<string, ControlToolPropertySchema>;
    additionalProperties?: boolean;
};

export type ControlToolSchema = {
    type: 'object';
    properties: Record<string, ControlToolPropertySchema>;
    required?: string[];
    additionalProperties?: boolean;
};

/** One catalog tool, with the runtime availability the renderer can answer for. */
export type ControlToolMeta = {
    name: string;
    title: string;
    group: string;
    executor: 'bridge' | 'main';
    summary: string;
    description: string;
    readOnly?: boolean;
    destructive?: boolean;
    inputSchema: ControlToolSchema;
    /** True when this renderer can execute it (bridge tools); main-process tools live elsewhere. */
    available: boolean;
};

export const CONTROL_EVENT_TYPE_VALUES = [
    'playback.songChanged',
    'playback.stateChanged',
    'playback.queueChanged',
    'playback.volumeChanged',
    'playback.loopModeChanged',
    'visualizer.modeChanged',
    'visualizer.backgroundChanged',
    'theme.changed',
    'view.changed',
    'palette.executed',
] as const;

/** Mirrors CONTROL_EVENT_TYPES in shared/controlCatalog.mjs (a test keeps the two in sync). */
export type ControlEventType = (typeof CONTROL_EVENT_TYPE_VALUES)[number];

export type ControlEvent = {
    seq: number;
    ts: number;
    type: ControlEventType;
    data: Record<string, unknown>;
};

export type ControlEventsQuery = {
    since?: number;
    limit?: number;
    waitMs?: number;
};

export type ControlEventsResult = {
    cursor: number;
    events: ControlEvent[];
};

/** The read side of the event ring the handlers and the bridge see. */
export type ControlEventStore = {
    record: (type: ControlEventType, data: Record<string, unknown>) => void;
    currentSeq: () => number;
    read: (query?: ControlEventsQuery) => Promise<ControlEventsResult>;
};

export type ControlAppInfo = {
    name: 'Folia';
    version: string;
    platform: string;
    isElectron: boolean;
    installedAt: number;
};

export type ControlSongSummary = {
    id: string | null;
    title: string;
    artist: string;
    artists: string[];
    album: string | null;
    durationMs: number;
    providerId: string | null;
    mediaId: string | null;
    isLocal: boolean;
};

export type ControlProviderSummary = {
    id: string;
    displayName: string;
    status: string;
    requiresAccount: boolean;
};

export type ControlStateQuery = {
    includeQueue?: boolean;
    includeLyrics?: boolean;
    includeProviders?: boolean;
};

export type ControlPlaybackState = 'playing' | 'paused' | 'idle';

export type ControlStateSnapshot = {
    app: { version: string; platform: string; isElectron: boolean; controlVersion: 1 };
    view: {
        view: 'home' | 'player' | 'lattice';
        panelOpen: boolean;
        panelTab: string | null;
        settingsOpen: boolean;
        paletteOpen: boolean;
    };
    playback: {
        state: ControlPlaybackState;
        isLoadingToPlay: boolean;
        isFmMode: boolean;
        song: ControlSongSummary | null;
        positionSeconds: number;
        durationSeconds: number;
        queueLength: number;
        currentQueueIndex: number;
        replayGainMode: 'off' | 'track' | 'album' | 'auto';
        lyricOffsetMs: number;
        liked: boolean | null;
    };
    volume: { level: number; percent: number; muted: boolean; loopMode: 'off' | 'all' | 'one' };
    visualizer: {
        mode: string;
        background: string | null;
        randomPerSong: boolean;
        smartBeatEnabled: boolean;
        glowBlurQuantize: boolean;
        frameRate: string | number;
    };
    theme: {
        daylight: boolean;
        followSystemTheme: boolean;
        coverColorBg: boolean;
        staticMode: boolean;
        disableHomeDynamicBackground: boolean;
    };
    lyrics: {
        available: boolean;
        format: string | null;
        lineCount: number;
        currentLineIndex: number;
        offsetMs: number;
        globalOffsetMs: number;
        currentLine: { index: number; startTime: number; endTime: number; text: string } | null;
        lines?: Array<{ index: number; startTime: number; endTime: number; text: string }>;
    };
    providers: ControlProviderSummary[];
    queue?: { items: Array<{ index: number; song: ControlSongSummary }>; total: number };
};

export type ControlErrorCode =
    | 'bad_request'
    | 'unknown_tool'
    | 'unavailable'
    | 'not_ready'
    | 'no_song'
    | 'no_results'
    | 'search_failed'
    | 'playback_failed'
    | 'unsupported'
    | 'disabled'
    | 'timeout'
    | 'internal';

export type ControlErrorEnvelope = {
    code: ControlErrorCode;
    message: string;
    details?: Record<string, unknown>;
};

export type ControlResult =
    | {
        ok: true;
        tool: string;
        data: unknown;
        durationMs: number;
        ts: number;
    }
    | {
        ok: false;
        tool: string;
        error: ControlErrorEnvelope;
        durationMs: number;
        ts: number;
    };

export type ControlBridgeInfo = {
    installedAt: number;
    toolCount: number;
    versions: { app: string; catalog: 1 };
};

/** PROTOCOL §2: the exact shape installed as window.__FOLIA_CONTROL__. */
export type ControlBridge = {
    version: 1;
    app: ControlAppInfo;
    ready: true;
    list: () => ControlToolMeta[];
    state: (args?: ControlStateQuery) => ControlStateSnapshot;
    invoke: (name: string, args?: Record<string, unknown>) => Promise<ControlResult>;
    events: (args?: ControlEventsQuery) => Promise<ControlEventsResult>;
    info: () => ControlBridgeInfo;
};

/** PROTOCOL §2.4: what ControlHost gets from App.tsx. */
export type ControlHostDeps = {
    context: CommandPaletteContext;
    localSongs: LocalSong[];
    enqueue: (songs: SongResult[]) => void;
    playLocalSong: (song: LocalSong) => Promise<void>;
};

/** The full dependency bag a handler receives: App props plus bridge-owned services. */
export type ControlHandlerDeps = ControlHostDeps & {
    app: ControlAppInfo;
    events: ControlEventStore;
};

export type ControlHandler = (
    args: Record<string, unknown>,
    deps: ControlHandlerDeps,
) => unknown | Promise<unknown>;

declare global {
    interface Window {
        __FOLIA_CONTROL__?: ControlBridge;
    }
}
