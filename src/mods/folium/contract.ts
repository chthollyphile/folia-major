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
 * Context for lyric-synced content (visualizers, background types, stage layers).
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
    params?: FoliumParam[];
    run(ctx: FoliumCommandContext): unknown | Promise<unknown>;
}

export interface FoliumRegistryHandle {
    /** Full namespaced id (`modid:name`). */
    readonly id: FoliumId;
    unregister(): void;
}

export interface FoliumRegistry<Def> {
    register(def: Def): FoliumRegistryHandle;
}

export interface FoliumRegistries {
    visualizers: FoliumRegistry<FoliumVisualizerDef>;
    tunings: FoliumRegistry<FoliumTuningDef>;
    commands: FoliumRegistry<FoliumCommandDef>;
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
