// src/mods/folium/mainContract.ts
// The public Folium contract of a mod's main entry (`main` in mod.json), the
// half that runs in Folia's main process under Node. Like contract.ts it holds
// types only; the object itself is built in electron/modSystem/modApi.cjs.
// `npm run folium:types` adds this file to mods/folium.d.ts and
// `npm run folium:api` writes the main entry section of docs/folium/api.md
// from it.
//
// Its one import is of types from contract.ts, which the generated type file
// holds itself, so the generators drop that line; it may import nothing else.
//
// Stability rule (mods/README.md): inside folium 2.x this file only grows.

import type { FoliumDisposer, FoliumHostInfo, FoliumLogger, FoliumPlaybackSnapshot, FoliumSecretAccess, FoliumStorage } from './contract';

// ---------------------------------------------------------------- Main API

/**
 * The shape of a main entry. The file `main` names exports the function itself:
 * `module.exports = function activate(api) { ... }`. It may return a function, which runs when the mod
 * stops, like one given to `api.onDispose`. It may be `async`; a throw, or a promise that rejects, marks
 * the mod as failed.
 */
export type FoliumMainModule = (api: FoliumMainApi) => void | FoliumDisposer | Promise<void | FoliumDisposer>;

/**
 * The object a main entry's `activate(api)` receives.
 *
 * The main entry runs in Node with full access: it can `require` any Node module, and `require('electron')`
 * too. But only `api` is the contract; anything else may change between Folia releases.
 *
 * A member that needs a permission says so. Called without that permission in mod.json `permissions`, a
 * synchronous member throws `permission-denied:<permission>`, and an asynchronous one returns a promise that
 * rejects with that error.
 */
export interface FoliumMainApi {
    /** This mod's mod.json as the host read it (missing fields filled in), frozen. */
    readonly manifest: FoliumManifest;
    /** Host versions; the same as the client entry's `folium.host`. */
    readonly host: FoliumHostInfo;
    /** Logging; `error` entries show in the mods panel under the mod. */
    readonly log: FoliumLogger;
    /**
     * This mod's data file: the same file the client entry's `folium.storage` reads and writes, so both sides
     * see one state. Needs the `filesystem.data` permission.
     */
    readonly storage: FoliumMainStorage;
    /**
     * Folium 1.7: the values of this mod's `secret` settings fields, the same store the client entry's
     * `folium.secrets` reads and writes. A listener given to `subscribe` stops when the mod stops.
     */
    readonly secrets: FoliumSecretAccess;
    /** Folders to write into: this mod's own folder and the user's folders. */
    readonly paths: FoliumMainPaths;
    /**
     * Runs `disposer` when the mod stops: it is turned off, reloaded, or the app quits. Release here what
     * `activate` started: timers, watchers, listeners, child processes. Cleanups run last registered first
     * (the function `activate` returned counts as registered when `activate` returned), and one that throws
     * does not stop the others. After the mod has stopped, `disposer` runs at once. Returns nothing.
     */
    onDispose(disposer: FoliumDisposer): void;
    /** What the app is playing. */
    readonly runtime: FoliumMainRuntime;
    /** Answers calls from this mod's client entry, and (Folium 1.7) sends it messages. */
    readonly rpc: FoliumMainRpc;
    /** Video export. */
    readonly render: FoliumMainRender;
}

/** A mod's mod.json as the main entry sees it in `api.manifest`: every field there, missing ones filled in. */
export interface FoliumManifest {
    /** The Folium major version the mod is written for. */
    readonly folium: number;
    /** The mod id. */
    readonly id: string;
    /** The mod's name. */
    readonly name: string;
    /** The mod's version, `MAJOR.MINOR.PATCH`. */
    readonly version: string;
    /** The author, or null. */
    readonly author: string | null;
    /** The description, or null. */
    readonly description: string | null;
    /** The main entry's file name, or null. */
    readonly main: string | null;
    /** The client entry's path in the mod folder, or null. */
    readonly client: string | null;
    /** The mods this one depends on (`id` or `id@^1.2.3`). */
    readonly depends: readonly string[];
    /** The permissions the mod declares. */
    readonly permissions: readonly string[];
    /** The experimental surfaces the mod opts into. */
    readonly experimental: readonly string[];
    /** The https origins `folium.ui.embed` may load. */
    readonly embedOrigins: readonly string[];
    /** The Folia versions the mod needs (e.g. `>=0.7.0 <0.8.0`), or null. */
    readonly folia: string | null;
    /** The introduction image's path in the mod folder, or null. */
    readonly preview: string | null;
    /** Folium 2: the sources a source mod provides (`id`, `name`, `requires`, …), or null for an ordinary mod. */
    readonly sources?: readonly Readonly<Record<string, unknown>>[] | null;
    /** Folium 2: the folder of the mod's locale files, or null. */
    readonly locales?: string | null;
    /** Folium 2: the folder of the mod's pictures and other assets, or null. */
    readonly assets?: string | null;
    /** Folium 2: the secret slots a source mod keeps outside settings fields, or null. */
    readonly secrets?: readonly string[] | null;
    /** Folium 2: where the client runs (`main`, `export`), or null for everywhere. */
    readonly contexts?: readonly string[] | null;
    /** Folium 2: native files of the app a built-in source uses, or null. */
    readonly native?: readonly string[] | null;
}

/**
 * `api.storage`: the data file the client entry shares (FoliumStorage, capped at 1 MB), and the directories
 * for anything larger.
 */
export interface FoliumMainStorage extends FoliumStorage {
    /** The directories this mod writes its own files to. Always there, permission or not, so `'paths' in api.storage` finds it. */
    readonly paths: FoliumModPaths;
}

/**
 * `api.storage.paths`, the directories this mod writes its files to. Needs the `filesystem.data` permission; without
 * it, reading either path throws `permission-denied:filesystem.data`. Each read creates the directory when it is
 * missing, and throws the file system's error when it cannot (a file or a dead link standing where the
 * directory should be; for `cache`, clearing the cache in the mods panel removes that entry). Both getters
 * are non-enumerable, so serializing or spreading `api` never reads them. Clients get no paths: they have no
 * file system.
 */
export interface FoliumModPaths {
    /** Files to keep: `<userData>/mods-data/<id>/files`, beside (not holding) the data file. */
    readonly data: string;
    /**
     * Files the mod can rebuild: `<userData>/mods-cache/<id>`. The user can empty it from the mods panel at
     * any time, even while the mod runs, so expect files to vanish; the host sets no size limit, so cap it
     * yourself.
     */
    readonly cache: string;
}

/**
 * `api.paths`: where a main entry writes. Put what the user will look for (an export, a report) under one
 * of the user's folders; keep the mod's own files under `api.storage.paths`.
 */
export interface FoliumMainPaths {
    /** The user's Documents folder. Reading it throws when the system has no such folder; so do the other three. */
    readonly documents: string;
    /** The user's Downloads folder. */
    readonly downloads: string;
    /** The user's Music folder. */
    readonly music: string;
    /** The user's Videos folder. */
    readonly videos: string;
}

/** `api.runtime`. */
export interface FoliumMainRuntime {
    /**
     * The playback state the app last sent to the main process, or null before it sent one. While playing,
     * `position` is moved on by the time since. Needs the `playback.read` permission.
     */
    getPlaybackSnapshot(): FoliumPlaybackSnapshot | null;
}

/** `api.rpc`: the main half of `folium.rpc`. */
export interface FoliumMainRpc {
    /**
     * Answers the client entry's `folium.rpc.call(name, ...args)`: `handler` gets the call's arguments, and
     * what it returns (or what its promise resolves to) is the call's result; a throw rejects the call.
     * Arguments and results cross between processes, so both must be JSON-serializable. `name` must match
     * `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, and a second handler for the same name throws.
     */
    handle(name: string, handler: (...args: any[]) => unknown): void;
    /**
     * Folium 1.7: sends `payload` to this mod's client entry in the main window, where
     * `folium.rpc.on(name, ...)` receives it; no other mod's client hears it, and the export window never
     * does. Fire-and-forget: nothing is queued, so a message sent while the client is not running (the
     * window rebuilt, the client not activated yet) or while there is no main window is dropped without an
     * error. `payload` must be JSON-serializable, at most 64 KB as JSON text; left out, the client gets
     * `null`. `name` follows the same rule as `handle`. A bad name or payload throws at the call
     * (`rpc-payload-too-large:65536` for one over the limit). Older 1.x hosts lack it: check
     * `api.host.folium.minor >= 7`.
     */
    send(name: string, payload?: unknown): void;
}

/** `api.render`. */
export interface FoliumMainRender {
    /**
     * Exports the current song as a video, drawn the way the app shows it now: the lyric animation mode, its
     * settings and tuning, the lyrics and the theme. `spec` holds only output choices. Needs the
     * `render.export` permission, and an ffmpeg Folia can find (the mods panel says whether it found one).
     * Folia shows the progress. The promise resolves when the export ends, whether or not the video was
     * written: read `ok`.
     */
    exportVideo(spec: FoliumExportSpec): Promise<FoliumExportResult>;
}

/** Output choices for `api.render.exportVideo`. Every field is optional; numbers are clamped to their range. */
export interface FoliumExportSpec {
    /** `vp9` (default): WebM, about a tenth of the size. `prores`: ProRes 4444 in a MOV, large, opens almost anywhere. */
    codec?: 'vp9' | 'prores';
    /** Width in pixels, 320 to 3840; default 1920. */
    width?: number;
    /** Height in pixels, 180 to 2160; default 1080. */
    height?: number;
    /** Frames per second, 10 to 60; default 30. */
    fps?: number;
    /** Start, seconds into the song; default 0. */
    startSec?: number;
    /**
     * End, seconds into the song. 0, or a time not after `startSec`, means 2 seconds after the lyrics end
     * (and at least 1 second after `startSec`). The video is at most 15 minutes long.
     */
    endSec?: number;
    /**
     * `transparent` (default): the lyrics on a transparent background; the alpha channel is kept on Windows,
     * and may come out black elsewhere. `theme`: on the song theme's background colour, on every system.
     */
    background?: 'transparent' | 'theme';
}

/** What `api.render.exportVideo` resolves to. */
export interface FoliumExportResult {
    /** True when the video was written. */
    ok: boolean;
    /**
     * Why not, when `ok` is false: `export-no-lyrics`, `export-invalid-duration`, `export-unsupported-platform`,
     * `export-already-running`, `export-ffmpeg-not-found`, `export-cancelled`, or another `export-…` code.
     */
    error?: string;
    /** The user cancelled the export. */
    cancelled?: boolean;
    /** The video file, in `Folia Exports` under the user's Videos folder. */
    outputPath?: string;
    /** Frames written. */
    frameCount?: number;
    /** The file's size, bytes. */
    sizeBytes?: number;
    /** The video's length, seconds. */
    durationSec?: number;
    /** `none` (a transparent background) or `theme`. */
    backgroundMode?: 'none' | 'theme';
    /** The video has a transparent background. */
    transparent?: boolean;
    /**
     * What may be off in a written video: `export-alpha-unavailable` (this machine captured no alpha channel),
     * `export-alpha-not-guaranteed` (not Windows: the alpha channel may be black).
     */
    warnings?: string[];
}

// ---------------------------------------------------------------- Source main API

/**
 * Folium 2: the main entry's `api` of a source mod (one with `sources` in mod.json, plan §5.5): FoliumMainApi and
 * the members below, which an ordinary mod's `api` does not have. A source mod also needs no `filesystem.data` for
 * `api.storage` (16 MB instead of 1 MB) and keeps the secret slots its manifest's `secrets` names (64 KB each).
 * Everything it registers here goes when the mod stops.
 */
export interface FoliumSourceMainApi extends FoliumMainApi {
    /** Electron `net`: binary, streamed, no answer cap and no time limit of the host's. */
    readonly net: FoliumSourceNet;
    /**
     * A built-in source's old data, by the names its row of the host's trusted table (or its manifest `claims`,
     * when it takes over a source the installation does not carry) lists. Any other key throws
     * `legacy-key-not-claimed:<key>`.
     */
    readonly legacy: { readonly store: FoliumSourceLegacyStore };
    /** The paths of FoliumMainApi, and the userData folder a source's row or claims name. */
    readonly paths: FoliumSourceMainPaths;
    /** Sealing with the system's credential store (Electron safeStorage). */
    readonly seal: FoliumSourceSeal;
    /** The source's cache folder, counted in the host's cache budget. */
    readonly cache: FoliumSourceCache;
    /** Cross-origin rules and streams for the source's media. */
    readonly media: FoliumSourceMedia;
    /** Hidden windows, and whether the main window is there. */
    readonly windows: FoliumSourceWindows;
    /** Opens an http(s) address in the system's browser. */
    readonly shell: { openExternal(url: string): Promise<void> };
    /** A file the user picks, or null. */
    readonly dialog: { pickFile(options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }): Promise<string | null> };
    /** The host's versions, and its UI language now (`zh-CN`, `en`, …). */
    readonly host: FoliumSourceHostInfo;
    /** Waited for (3 seconds at most) before the source is unloaded; its songs' playback has stopped by then. */
    onBeforeUnload(handler: () => void | Promise<void>): FoliumDisposer;
    /** Waited for (3 seconds at most) when the app quits. */
    onBeforeQuit(handler: () => void | Promise<void>): FoliumDisposer;
    /** The main window went and no window takes its playback over: pause what plays outside the app. */
    onPlayersOrphaned(handler: () => void): FoliumDisposer;
    /** The sign-in diagnostics and self-check of one of the mod's own sources. */
    readonly diagnostics: FoliumSourceDiagnostics;
    /** Native files the app ships for a built-in source, by the names its manifest `native` and its row both list. */
    readonly native: FoliumSourceNative;
    /** An error the source could not handle: into the host's crash report, without telling the user. */
    reportError(error: unknown, where?: string): void;
}

/** Folium 2: `api.host` of a source mod. */
export interface FoliumSourceHostInfo extends FoliumHostInfo {
    /** The host's UI language now. */
    readonly locale: string;
}

/** Folium 2: `api.paths` of a source mod. */
export interface FoliumSourceMainPaths extends FoliumMainPaths {
    /** `<userData>/<name>`, for a folder the source's row or claims name; any other throws `legacy-folder-not-claimed:<name>`. */
    legacy(name: string): string;
}

/** Folium 2: `api.diagnostics` of a source mod. */
export interface FoliumSourceDiagnostics {
    /**
     * `backend` has `getDiagnostics()`, and may have `getStatus()` and `selfCheckHosts`; `sourceId` is one of the
     * mod's sources, as the host knows it. Returns what takes it out.
     */
    register(sourceId: string, backend: { getDiagnostics(): unknown; getStatus?(): unknown; selfCheckHosts?: readonly string[] }): FoliumDisposer;
}

/** Folium 2: `api.native` of a source mod. */
export interface FoliumSourceNative {
    /** The file's path; throws `native-not-granted:<name>` or `native-unavailable:<name>`. */
    path(name: string): string;
    /** `require` of that path. */
    load(name: string): unknown;
}

/** Folium 2: `api.net` of a source mod. */
export interface FoliumSourceNet {
    /** A web `fetch` through Electron `net`; `init.session` names a partition (see `session`). Answers a web Response. */
    fetch(url: string, init?: Record<string, unknown>): Promise<Response>;
    /**
     * Electron's `net.request` (a ClientRequest), for a request a web `fetch` cannot make: a GET with a body.
     * `options` is Electron's (`url`, `method`, `redirect`, …); `options.session` names a partition (see `session`).
     */
    request(options: FoliumSourceRequestOptions): FoliumSourceClientRequest;
    /**
     * A partition of the source's own (`persist:folium.<mod id>.<name>`), or one its row or claims name: lower case
     * letters, digits and `-`.
     */
    session(name: string): FoliumSourceNetSession;
    /** The system proxy for `url`, as Chromium resolves it. */
    resolveProxy(url: string): Promise<string>;
}

/** Folium 2: one partition of a source mod (`api.net.session`). */
export interface FoliumSourceNetSession {
    /** The partition's name. */
    readonly partition: string;
    /** `fetch` in this partition. */
    fetch(url: string, init?: Record<string, unknown>): Promise<Response>;
    /** `request` in this partition. */
    request(options: FoliumSourceRequestOptions): FoliumSourceClientRequest;
    /** The proxy for `url` in this partition. */
    resolveProxy(url: string): Promise<string>;
    /** Electron's `session.setProxy`. */
    setProxy(config: Record<string, unknown>): Promise<void>;
    /** Electron's `session.clearStorageData`. */
    clearStorageData(options?: Record<string, unknown>): Promise<void>;
}

/** Folium 2: what `api.net.request` takes: Electron's `net.request` options. */
export interface FoliumSourceRequestOptions {
    /** An http(s) address. */
    url: string;
    /** `GET` when left out. */
    method?: string;
    /** `follow` (the default), `error` or `manual`. */
    redirect?: 'follow' | 'error' | 'manual';
    /** A partition, named as for `api.net.session`; the default session when left out. */
    session?: string;
    /** Electron's other options. */
    [option: string]: unknown;
}

/** Folium 2: the answer of `api.net.request`, Electron's IncomingMessage (the members a source reads). */
export interface FoliumSourceIncomingMessage {
    /** The HTTP status. */
    readonly statusCode: number;
    /** The headers, by lower-case name. */
    readonly headers: Record<string, string | string[]>;
    /** `data` gives the body piece by piece. */
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    /** `end` comes after the last piece. */
    on(event: 'end', listener: () => void): this;
    /** `error` or `aborted` when the body broke off. */
    on(event: 'error' | 'aborted', listener: (error?: Error) => void): this;
}

/** Folium 2: `api.net.request`'s request, Electron's ClientRequest (the members a source uses). */
export interface FoliumSourceClientRequest {
    /** Sets a header before the body is written. */
    setHeader(name: string, value: string): void;
    /** Writes part of the body. */
    write(chunk: string | Uint8Array): void;
    /** Sends the request, with the last part of the body. */
    end(chunk?: string | Uint8Array): void;
    /** Stops it. */
    abort(): void;
    /** `response` with the answer. */
    on(event: 'response', listener: (response: FoliumSourceIncomingMessage) => void): this;
    /** `error` when the request failed. */
    on(event: 'error', listener: (error: Error) => void): this;
    /** Electron's other events: `redirect`, `login`, `finish`, `abort`, `close`. */
    on(event: string, listener: (...args: unknown[]) => void): this;
}

/** Folium 2: what a media rule's `test` is asked: one read of a resource, with the answer's headers. Frozen. */
export interface FoliumSourceMediaRequest {
    /** The address. */
    readonly url: string;
    /** `GET`, `HEAD` or `OPTIONS` (other methods never get the headers). */
    readonly method: string;
    /** Electron's resource type (`media`, `xhr`, `image`, …). */
    readonly resourceType: string;
    /** The answer's headers, a frozen copy of what Electron hands. */
    readonly responseHeaders: Readonly<Record<string, readonly string[]>>;
}

/** Folium 2: `api.legacy.store`, the main process's store keys a built-in source keeps its sign-in under. */
export interface FoliumSourceLegacyStore {
    /** The value, or undefined. */
    get(key: string): unknown;
    /** Stores `value`. */
    set(key: string, value: unknown): void;
    /** Whether the key has a value. */
    has(key: string): boolean;
    /** Removes the key. */
    delete(key: string): void;
}

/** Folium 2: `api.seal`. `available()` is false where the system keeps no encrypted store (Linux's basic_text). */
export interface FoliumSourceSeal {
    /** Whether sealing works here. */
    available(): boolean;
    /** `text` sealed, as base64; throws where sealing does not work. */
    seal(text: string): string;
    /** The text of a sealed base64 string. */
    open(sealed: string): string;
}

/** Folium 2: `api.cache` of a source mod. */
export interface FoliumSourceCache {
    /** `<userData>/mods-cache/<id>`, made when missing. */
    dir(): string;
    /** Asks the host to trim the media cache to its budget (or to `limitBytes`). */
    requestPrune(limitBytes?: number): void;
    /** Hands the host the source's cache entries, so its cache view lists, removes and clears them. */
    provideEntries(provider: FoliumSourceCacheEntries): FoliumDisposer;
}

/** Folium 2: what `api.cache.provideEntries` takes. */
export interface FoliumSourceCacheEntries {
    /** The entries. */
    list(): unknown[] | Promise<unknown[]>;
    /** Removes one. */
    remove?(id: string): void | Promise<void>;
    /** Removes all. */
    clear?(): void | Promise<void>;
}

/** Folium 2: a rule of `api.media.allow`: which addresses get cross-origin headers, for how long. */
export interface FoliumSourceMediaRule {
    /** Host names; a request to one of them is the source's. */
    hosts?: string[];
    /** Whole addresses. */
    urls?: string[];
    /** How long an address added stays the rule's, milliseconds. */
    ttlMs?: number;
    /**
     * What `hosts` cannot say (a path that ends in an audio extension, an answer's content type). It narrows the
     * rule's `hosts`, which it needs: it is asked only for reads on them (never for another source's), and there the
     * host alone lets nothing through. Synchronous; true lets the read through, one that throws counts as false. It
     * runs for every answer from those hosts: keep it quick. `urls` of the same rule pass without it.
     */
    test?(request: FoliumSourceMediaRequest): boolean;
    /**
     * An address a redirect leads to becomes the rule's too: from one of its `urls`, until that address's own
     * expiry; from one its `test` let through, for `ttlMs` from the redirect. A read let through by `hosts` alone
     * is not followed.
     */
    followRedirects?: boolean;
    /** Electron's resource types the rule applies to (`media`, `xhr` and `image` by default). */
    resourceTypes?: string[];
}

/** Folium 2: what `api.media.allow` returns: it removes the rule, and its `add(url)` makes an address issued later the rule's. */
export type FoliumSourceMediaAllowed = FoliumDisposer & { add(url: string): void };

/** Folium 2: `api.media` of a source mod. */
export interface FoliumSourceMedia {
    /** Registers `rule`. */
    allow(rule: FoliumSourceMediaRule): FoliumSourceMediaAllowed;
    /** One Range header against a size: `{ start, end }`, `'unsatisfiable'`, or null. */
    parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null;
    /**
     * Answers `folia-mod://<mod id>/_media/<name>/…`: `handler` gets the request and answers a web Response, or
     * `{ file }` for the host to serve with Range. `name` is lower case letters, digits and `-`. Returns what stops it.
     */
    serve(name: string, handler: (request: Request, rest: string) => unknown): FoliumDisposer;
    /** `folia-mod://<mod id>/_media/<name>/<rest>`. */
    url(name: string, rest?: string): string;
}

/** Folium 2: `api.windows` of a source mod. */
export interface FoliumSourceWindows {
    /**
     * A hidden, sandboxed window without the app's preload (a sign-in, a signature sandbox), destroyed when the mod
     * stops; `options.session` names its partition as `api.net.session` does. An Electron BrowserWindow.
     */
    hidden(options?: Record<string, unknown>): unknown;
    /** Whether the main window is there. */
    mainWindowPresent(): boolean;
    /** Calls `listener` when the main window comes or goes. */
    onMainWindowChanged(listener: (present: boolean) => void): FoliumDisposer;
}
