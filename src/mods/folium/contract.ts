// src/mods/folium/contract.ts
// The public Folium 1 contract: every type a mod can observe lives here and
// nowhere else. Host-internal types (Line, Theme, SongResult, store shapes)
// never appear in this file; the host projects them into these DTOs.
//
// Stability rule (mods/README.md): inside folium 1.x this file only grows.
// Removing a field or changing its meaning requires folium 2.

export const FOLIUM_VERSION = Object.freeze({ major: 1, minor: 0 });

/** `modid:name`, like a Forge ResourceLocation. The mod id part is added by the host. */
export type FoliumId = string;

export type FoliumLabel = Record<string, string | undefined>;

export type FoliumDisposer = () => void;

// ---------------------------------------------------------------- DTOs

export interface FoliumWord {
    text: string;
    startTime: number;
    endTime: number;
}

export interface FoliumLine {
    text: string;
    startTime: number;
    /** Render end time: when the host stops showing this line (includes hold/tail hints). */
    endTime: number;
    words: FoliumWord[];
    translation?: string;
    romanization?: string;
}

export interface FoliumTheme {
    backgroundColor: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    /** Fully resolved CSS font-family stack for lyric text. */
    fontFamily: string;
    fontWeight: number;
    isDaylight: boolean;
}

export interface FoliumSong {
    id: string | null;
    title: string;
    artist: string;
    album: string | null;
    /** Where the song comes from: an Omni provider id, 'local', 'navidrome', … */
    source: string | null;
    /**
     * Opaque handle the host can turn back into the real song (playSong,
     * enqueue, beforePlay.replaceWith). Valid for the session; null when the
     * DTO was not built from a host song.
     */
    ref: string | null;
}

export type FoliumPlaybackState = 'playing' | 'paused' | 'stopped';

export interface FoliumPlaybackSnapshot {
    song: FoliumSong | null;
    state: FoliumPlaybackState;
    /** Seconds. */
    position: number;
    duration: number;
    lines: FoliumLine[];
    theme: FoliumTheme | null;
    visualizerMode: string | null;
}

// ---------------------------------------------------------------- Parameters

export type FoliumParamType = 'number' | 'text' | 'boolean' | 'select';

export interface FoliumParamOption {
    value: string;
    label: FoliumLabel;
}

/**
 * One declarative field. The same schema drives settings sections, visualizer
 * settings, tunings of builtin modes and command parameters, and it is the only
 * source of keys, defaults and validation for the values it describes.
 */
export interface FoliumParam {
    key: string;
    type: FoliumParamType;
    label: FoliumLabel;
    description?: FoliumLabel;
    /** Fields sharing a group label render together under that heading. */
    group?: FoliumLabel;
    defaultValue?: string | number | boolean;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    options?: FoliumParamOption[];
}

export type FoliumParamValues = Readonly<Record<string, unknown>>;

/** Read/write access to one schema's persisted values (defaults already merged). */
export interface FoliumParamAccess {
    readonly schema: readonly FoliumParam[];
    get(): FoliumParamValues;
    /** Validated against the schema: unknown keys are dropped, numbers clamped, selects checked. */
    set(patch: Record<string, unknown>): void;
    reset(): void;
    subscribe(listener: () => void): FoliumDisposer;
}

// ---------------------------------------------------------------- Host containers

/**
 * Everything UI-shaped is mounted into a container the host owns. The host
 * creates it (inside a ShadowRoot for panels), passes theme colors as
 * `--folium-*` CSS custom properties, and calls the disposer when it removes the
 * container. Mods never query or mutate host DOM outside their container.
 */
export type FoliumMount<Ctx> = (container: HTMLElement, ctx: Ctx) => void | FoliumDisposer;

export interface FoliumPanelContext {
    readonly locale: string;
    getTheme(): FoliumTheme;
    subscribe(listener: () => void): FoliumDisposer;
}

export interface FoliumSettingsPanelContext extends FoliumPanelContext {
    readonly params: FoliumParamAccess;
}

export interface FoliumClock {
    get(): number;
    on(event: 'change', listener: (seconds: number) => void): FoliumDisposer;
}

export interface FoliumSurface {
    /** The host renders onto a transparent surface (OBS source, alpha export). */
    transparent: boolean;
    /** The host is painting its configured background under this content. */
    hostBackground: boolean;
}

/**
 * Context for lyric-synced content (visualizers, stage layers).
 * Snapshot fields are fixed for one mount; the host remounts only when the
 * lyric data, the song or `staticMode` changes (or the preview line in static
 * mode). Everything else is read through getters, and `subscribe` fires when
 * any getter's value changes, including while paused, when `currentTime` is idle.
 */
export interface FoliumStageContext {
    readonly lines: readonly FoliumLine[];
    readonly song: FoliumSong | null;
    readonly staticMode: boolean;
    /** Only meaningful in static mode: the line the preview shows. */
    readonly staticLineIndex: number | null;
    readonly currentTime: FoliumClock;
    getLineIndex(): number;
    isPaused(): boolean;
    getTheme(): FoliumTheme;
    getSettings(): FoliumParamValues;
    getSurface(): FoliumSurface;
    subscribe(listener: () => void): FoliumDisposer;
}

// ---------------------------------------------------------------- Registry definitions

export interface FoliumVisualizerDef {
    id: string;
    label: FoliumLabel;
    order?: number;
    mount: FoliumMount<FoliumStageContext>;
    settings?: FoliumParam[];
    /** Replaces the host-rendered form; values still follow `settings`. */
    settingsPanel?: FoliumMount<FoliumSettingsPanelContext>;
    /** Host-rendered layers around the visualizer. Both default to true. */
    hostLayers?: { background?: boolean; subtitles?: boolean };
}

export interface FoliumTuningDef {
    id: string;
    /** A builtin visualizer mode that declares `foliumTunables`, e.g. "sonnet". */
    target: string;
    label: FoliumLabel;
    /** Number params only; keys and ranges are checked against the target's whitelist. */
    params: FoliumParam[];
}

export interface FoliumCommandContext {
    /** Validated parameter values (defaults merged). */
    readonly values: FoliumParamValues;
}

export interface FoliumCommandDef {
    id: string;
    label: FoliumLabel;
    description?: FoliumLabel;
    /** Extra search terms for the command palette (label texts are always included). */
    keywords?: string[];
    /** Shown in the mods panel and the command palette; a palette entry with params opens a form. */
    params?: FoliumParam[];
    run(ctx: FoliumCommandContext): unknown | Promise<unknown>;
}

/** Lyric-free context for background types: they paint behind every mode, previews included. */
export interface FoliumBackgroundContext {
    readonly staticMode: boolean;
    isPaused(): boolean;
    getTheme(): FoliumTheme;
    getSettings(): FoliumParamValues;
    getCoverUrl(): string | null;
    subscribe(listener: () => void): FoliumDisposer;
}

export interface FoliumBackgroundDef {
    id: string;
    label: FoliumLabel;
    order?: number;
    mount: FoliumMount<FoliumBackgroundContext>;
    settings?: FoliumParam[];
    settingsPanel?: FoliumMount<FoliumSettingsPanelContext>;
}

/**
 * Where a stage layer sits on the player page:
 *   - `player.stage.back`: above the background, under the lyrics;
 *   - `player.stage.front`: above the lyrics, under the player chrome;
 *   - `app.overlay`: above the whole app.
 */
export type FoliumStageSlot = 'player.stage.back' | 'player.stage.front' | 'app.overlay';

export interface FoliumStageLayerDef {
    id: string;
    slot: FoliumStageSlot;
    order?: number;
    /**
     * When false (default) the layer is click-through, so it cannot block the
     * player; elements that should still take clicks set `pointer-events: auto`.
     * When true the whole layer captures the pointer.
     */
    interactive?: boolean;
    mount: FoliumMount<FoliumStageContext>;
}

export interface FoliumSettingsSectionDef {
    id: string;
    label: FoliumLabel;
    description?: FoliumLabel;
    settings: FoliumParam[];
    settingsPanel?: FoliumMount<FoliumSettingsPanelContext>;
}

export interface FoliumPlayerPanelTabDef {
    id: string;
    label: FoliumLabel;
    order?: number;
    mount: FoliumMount<FoliumPanelContext>;
}

/** Progress-bar context shared by control buttons and progress layers. */
export interface FoliumProgressContext {
    readonly currentTime: FoliumClock;
    getDuration(): number;
    /** 0..1 position of a time on the track (0 when the duration is unknown). */
    timeToRatio(seconds: number): number;
    /** Seeks the host player; ignored while the host bar is disabled. */
    seek(seconds: number): void;
    /** The host bar's colors, so mod UI can match it. */
    getColors(): { fill: string; track: string; text: string };
    subscribe(listener: () => void): FoliumDisposer;
}

export type FoliumControlSlot = 'progress.leading' | 'progress.trailing';

export interface FoliumControlButtonDef {
    id: string;
    slot: FoliumControlSlot;
    order?: number;
    mount: FoliumMount<FoliumProgressContext>;
}

/**
 * A layer over the progress track. Its container is click-through so seeking
 * keeps working; elements that should take clicks set `pointer-events: auto`.
 */
export interface FoliumProgressLayerDef {
    id: string;
    order?: number;
    mount: FoliumMount<FoliumProgressContext>;
}

/**
 * Mod CSS, injected inside `@layer folium-mods` and removed with the mod. The
 * stable targets are the host's public parts: `[data-folium-part="progress.track"]` etc.
 * (see mods/README.md for the list). Anything else in the host DOM is not API.
 */
export interface FoliumStyleDef {
    id: string;
    css: string;
}

export interface FoliumRegistryHandle {
    /** Full namespaced id (`modid:name`). */
    readonly id: FoliumId;
    unregister(): void;
}

export interface FoliumSettingsSectionHandle extends FoliumRegistryHandle {
    /** The section's values (defaults merged) and write access. */
    readonly params: FoliumParamAccess;
}

export interface FoliumRegistry<Def, Handle extends FoliumRegistryHandle = FoliumRegistryHandle> {
    register(def: Def): Handle;
}

export interface FoliumRegistries {
    visualizers: FoliumRegistry<FoliumVisualizerDef>;
    tunings: FoliumRegistry<FoliumTuningDef>;
    commands: FoliumRegistry<FoliumCommandDef>;
    backgrounds: FoliumRegistry<FoliumBackgroundDef>;
    stageLayers: FoliumRegistry<FoliumStageLayerDef>;
    settingsSections: FoliumRegistry<FoliumSettingsSectionDef, FoliumSettingsSectionHandle>;
    playerPanelTabs: FoliumRegistry<FoliumPlayerPanelTabDef>;
    controlButtons: FoliumRegistry<FoliumControlButtonDef>;
    progressLayers: FoliumRegistry<FoliumProgressLayerDef>;
    styles: FoliumRegistry<FoliumStyleDef>;
}

// ---------------------------------------------------------------- Events

export type FoliumEventPriority = 'highest' | 'high' | 'normal' | 'low' | 'lowest';

/** Read-only notifications, emitted after the fact. */
export interface FoliumNotificationEvents {
    'playback.songChanged': { readonly song: FoliumSong | null };
    'playback.stateChanged': { readonly state: FoliumPlaybackState };
    'playback.seeked': { readonly position: number };
    'lyrics.loaded': { readonly song: FoliumSong | null; readonly lines: readonly FoliumLine[] };
    'app.viewChanged': { readonly view: string };
    'visualizer.modeChanged': { readonly mode: string };
    'theme.changed': { readonly theme: FoliumTheme };
}

/**
 * Synchronous hook: runs when new lyrics reach the player, before they are
 * shown. Assign `lines` to rewrite them; lines left untouched (same object)
 * keep all their host-side data, new or changed ones are built from the DTO.
 *
 * Always runs on untransformed lyrics, never on its own output: when the host
 * rebuilds lyrics already on screen (e.g. a word-segmentation update) it
 * starts again from the untransformed version, so handlers need not be
 * idempotent.
 */
export interface FoliumLyricsTransformEvent {
    readonly song: FoliumSong | null;
    lines: readonly FoliumLine[];
}

/**
 * Async hook: runs before a song starts. Handlers may cancel it or play
 * another song instead. Not run for the track an automix blend advances to:
 * the blend starts that track seconds early on a fixed schedule and cannot
 * wait for handlers.
 */
export interface FoliumBeforePlayEvent {
    readonly song: FoliumSong;
    readonly cancelled: boolean;
    cancel(): void;
    /** Plays this song instead; it must carry a `ref` from the host. */
    replaceWith(song: FoliumSong): void;
}

/**
 * EXPERIMENTAL (manifest `experimental: ["omni.hooks"]`): Omni answered with
 * lyrics for an online song. Same line rules as `lyrics.transform`.
 */
export interface FoliumOmniLyricsEvent {
    readonly song: FoliumSong;
    lines: readonly FoliumLine[];
    readonly isPureMusic: boolean;
}

/** EXPERIMENTAL (`omni.hooks`): Omni resolved an audio URL; assign `url` to use another one. */
export interface FoliumOmniAudioEvent {
    readonly song: FoliumSong;
    url: string | null;
}

export interface FoliumHookEvents {
    'lyrics.transform': FoliumLyricsTransformEvent;
    'playback.beforePlay': FoliumBeforePlayEvent;
    'omni.lyricsResolved': FoliumOmniLyricsEvent;
    'omni.audioSourceResolved': FoliumOmniAudioEvent;
}

export type FoliumEventMap = FoliumNotificationEvents & FoliumHookEvents;

export interface FoliumEvents {
    on<K extends keyof FoliumEventMap>(
        type: K,
        handler: (event: FoliumEventMap[K]) => void | Promise<void>,
        options?: { priority?: FoliumEventPriority },
    ): FoliumDisposer;
}

// ---------------------------------------------------------------- Services

export interface FoliumPlaybackService {
    getState(): { song: FoliumSong | null; state: FoliumPlaybackState; position: number; duration: number };
    // Everything below needs the `playback.control` permission.
    play(): void;
    pause(): void;
    toggle(): void;
    seek(seconds: number): void;
    next(): void;
    previous(): void;
    /** Plays a song by its host `ref`. Resolves false when the ref is unknown. */
    playSong(song: FoliumSong): Promise<boolean>;
    /** Appends a song (by `ref`) to the queue. */
    enqueue(song: FoliumSong): boolean;
}

export interface FoliumFileHandle {
    /** folia-mod:// URL usable as a media/img src for this session. */
    url: string;
    name: string;
    size: number;
}

export interface FoliumUiService {
    toast(message: string, options?: { type?: 'info' | 'success' | 'error'; durationMs?: number }): void;
    /** Opens the player panel, optionally on one of this mod's panel tabs (local id). */
    openPlayerPanel(tabId?: string): void;
    navigate(view: 'home' | 'player'): void;
    /** Lets the user pick a local file; null when cancelled. */
    pickFile(options?: { accept?: 'video' | 'audio' | 'image' | 'any' }): Promise<FoliumFileHandle | null>;
    /**
     * Embeds an external page in `container` as a sandboxed iframe. The URL's
     * origin must be listed in the manifest `embedOrigins` (needs `net.embed`).
     */
    embed(container: HTMLElement, url: string, options?: { title?: string; allow?: string[] }): FoliumDisposer;
}

export interface FoliumFetchInit {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}

export interface FoliumFetchResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Readonly<Record<string, string>>;
    text(): string;
    json<T = unknown>(): T;
}

export interface FoliumNetService {
    /** Fetch through the host (no CORS limits); needs the `net.fetch` permission. */
    fetch(url: string, init?: FoliumFetchInit): Promise<FoliumFetchResponse>;
}

// ---------------------------------------------------------------- Experimental

/** EXPERIMENTAL (`omni.providers`): a song as a mod provider describes it. */
export interface FoliumProviderSong {
    id: string;
    title: string;
    artists: string[];
    album?: string;
    coverUrl?: string;
    durationMs?: number;
}

export type FoliumAudioQuality = 'standard' | 'high' | 'lossless' | 'hires';

/**
 * EXPERIMENTAL (`omni.providers`): an online music source. The host adapts it
 * to its provider contract; songs from it play, queue and show lyrics like any
 * online song. Use folium.net.fetch for network access.
 */
export interface FoliumOmniProviderDef {
    id: string;
    displayName: string;
    shortName?: string;
    search?(query: string, page: { limit: number; offset: number }): Promise<{ items: FoliumProviderSong[]; hasMore: boolean; total?: number }>;
    getSong?(id: string): Promise<FoliumProviderSong | null>;
    getAudioUrl?(song: FoliumProviderSong, quality: FoliumAudioQuality): Promise<{ url: string; expiresAt?: number } | null>;
    /** LRC text (plus optional translation LRC); the host parses it. */
    getLyrics?(song: FoliumProviderSong): Promise<{ lrc: string; translationLrc?: string } | null>;
}

// ---------------------------------------------------------------- Client API

export type FoliumContextKind = 'main' | 'export';

export interface FoliumHostInfo {
    folium: { major: number; minor: number };
    /** Folia app version, or null when the host cannot tell. */
    folia: string | null;
}

export interface FoliumStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
}

export interface FoliumRpc {
    call<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
}

export interface FoliumLogger {
    info(message: string, details?: unknown): void;
    warn(message: string, details?: unknown): void;
    error(message: string, details?: unknown): void;
}

/** The object a client entry's `activate(folium)` receives. */
export interface FoliumClientApi {
    readonly modId: string;
    readonly host: FoliumHostInfo;
    readonly env: { readonly context: FoliumContextKind };
    readonly log: FoliumLogger;
    readonly registries: FoliumRegistries;
    readonly events: FoliumEvents;
    readonly playback: FoliumPlaybackService;
    readonly ui: FoliumUiService;
    readonly net: FoliumNetService;
    readonly storage: FoliumStorage;
    readonly rpc: FoliumRpc;
    /** Unfrozen surfaces; each requires the matching manifest `experimental` opt-in. */
    readonly experimental: Readonly<Record<string, unknown>>;
    /**
     * Host internals with no compatibility promise. Only available when the
     * manifest pins host versions with `"folia"`; otherwise accessing it throws.
     */
    readonly internals: Readonly<Record<string, unknown>>;
}

export interface FoliumClientModule {
    default: (folium: FoliumClientApi) => void | FoliumDisposer | Promise<void | FoliumDisposer>;
}
