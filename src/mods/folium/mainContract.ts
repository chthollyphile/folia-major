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
