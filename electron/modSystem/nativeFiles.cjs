'use strict';

// electron/modSystem/nativeFiles.cjs
// The native files the app ships for a built-in source (Folium 2.0 plan §5.5, §6.2): what `api.native.path(name)` /
// `load(name)` resolve, by the names the trusted table's rows list (builtinSources.cjs `native`). The files are built
// and packaged by the app (build/beforePack.cjs, the extraResources of build/bundledSources.mjs), not by the source mod: a packaged
// app reads them from its resources only, a development run from the build output, or from an absolute path a
// developer names in the environment. A name this file does not know resolves to '' (the host's `native-unavailable`).
// A takeover never gets these: it resolves its own copy in its folder (resolveModNativeFile, below).

const path = require('node:path');

// Keep release resource paths separate from development outputs and explicit developer overrides.
function resolveNativeExecutable({ platform, isPackaged, resourcesPath, projectRoot, override = '' }) {
    if (platform !== 'darwin' && platform !== 'win32') return '';
    if (!isPackaged && override) return path.isAbsolute(override) ? override : '';
    const root = isPackaged ? path.join(resourcesPath, 'apple-music') : path.join(projectRoot, 'build/apple-music-native');
    return platform === 'darwin'
        ? path.join(root, 'FoliaAppleMusicCompanion.app/Contents/MacOS/FoliaAppleMusicCompanion')
        : path.join(root, 'windows/FoliaAppleMusicCompanion.exe');
}

/*
 * The playback component of a built-in source that plays through librespot: the npm package stays in the app (its
 * native builds are unpacked from app.asar by package.json's asarUnpack, and build/afterPack.cjs keeps the one of
 * the package's system), so it resolves as the app's own require does. '' where the package is not installed.
 */
function resolveAppPackage(name) {
    try {
        return require.resolve(name);
    } catch {
        return '';
    }
}

/*
 * name -> how it resolves. `env` (where a row has it) names the environment variable a development run may point it elsewhere with (read
 * only when `ELECTRON_DEV` is 'true', as main.cjs read it before). Rows come with the source that uses them.
 */
const NATIVE_FILES = Object.freeze({
    // The system-WebView companion (WKWebView on macOS 14+, WebView2 on Windows x64); Linux has none.
    'apple-music-companion': Object.freeze({ resolve: resolveNativeExecutable, env: 'FOLIA_APPLE_MUSIC_NATIVE' }),
    // librespot's Node binding (`api.native.load`): builds for darwin-arm64, linux-x64/arm64 (glibc) and win32-x64 only;
    // where there is none, loading it throws and the source says it cannot play on this system.
    librespot: Object.freeze({ resolve: () => resolveAppPackage('@lox-audioserver/node-librespot') }),
});

/**
 * The path of the native file `name` in this app, or '' where it has none (an unknown name, a system it is not
 * built for). `context`: { platform, isPackaged, resourcesPath, projectRoot, env } (env: process.env).
 */
function resolveNativeFile(name, { platform, isPackaged, resourcesPath, projectRoot, env = {} }) {
    const row = Object.hasOwn(NATIVE_FILES, name) ? NATIVE_FILES[name] : null;
    if (!row) return '';
    const override = env.ELECTRON_DEV === 'true' && row.env ? env[row.env] ?? '' : '';
    return row.resolve({ platform, isPackaged, resourcesPath, projectRoot, override });
}

/*
 * A takeover's own copy (Folium 2.0 plan §5.1). An installation that does not carry a source does not carry its native
 * files either, so a mod that takes that source over brings them in its own folder:
 *
 *     <mod folder>/native/<name>/<platform>-<arch>/<entry>
 *
 * `<platform>-<arch>` is Node's `process.platform` and `process.arch` (win32-x64, darwin-arm64, linux-x64, …); `<entry>` is
 * this table's, by name and system: the file `api.native.path` answers and `load` requires. The files it needs beside it
 * (the companion's DLLs, librespot's prebuilt binding) sit in the same system folder. A name or system the table has no
 * entry for has no takeover copy: the source says it cannot run there. The names a takeover may resolve this way are
 * those its manifest `native` and the trusted row of the source it claims both list (sourceOwnership.cjs ownNative).
 */
const MOD_NATIVE_ENTRIES = Object.freeze({
    // The Windows companion only: a macOS .app unpacked from a zip into the user's folders keeps neither its signature
    // nor its executable bits for certain, which nobody has checked.
    'apple-music-companion': Object.freeze({ 'win32-x64': 'FoliaAppleMusicCompanion.exe' }),
    // The package's own loader, which finds the binding of this system in ../prebuilds/<platform>-<arch>[-<abi>]/.
    librespot: Object.freeze({
        'win32-x64': 'dist/index.js',
        'darwin-arm64': 'dist/index.js',
        'linux-x64': 'dist/index.js',
        'linux-arm64': 'dist/index.js',
    }),
});

/** `<platform>-<arch>`, the system folder of a takeover's native files. */
const modNativeSystem = (platform, arch) => `${platform}-${arch}`;

/** The entry's path in a mod folder, `/`-separated, or null where the table has none for that name and system. */
function modNativeRelativePath(name, system) {
    const row = Object.hasOwn(MOD_NATIVE_ENTRIES, name) ? MOD_NATIVE_ENTRIES[name] : null;
    const entry = row && Object.hasOwn(row, system) ? row[system] : null;
    return entry ? `native/${name}/${system}/${entry}` : null;
}

const isInside = (parent, child) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/**
 * A takeover's own copy of the native file `name`, in its folder `modDir`. Answers { path } or { error, system }:
 *   native-not-in-mod   the table has no entry for this system, or the mod does not carry it;
 *   native-unsafe-path  a folder or file on the way is a symbolic link (or junction), or is not what it should be, or the
 *                       real path leaves the mod folder.
 * Walked one name at a time with lstat, so no link is followed; the real path is checked again at the end.
 * `fs` is node's (original-fs in the app, so an .asar on the way is a file, as zipInstall.cjs wrote it).
 */
function resolveModNativeFile(name, modDir, { platform, arch, fs }) {
    const system = modNativeSystem(platform, arch);
    const relative = modNativeRelativePath(name, system);
    if (!relative || typeof modDir !== 'string' || !modDir) return { error: 'native-not-in-mod', system };
    const segments = relative.split('/');
    let current = path.resolve(modDir);
    for (let index = 0; index < segments.length; index += 1) {
        current = path.join(current, segments[index]);
        let stat;
        try {
            stat = fs.lstatSync(current);
        } catch {
            return { error: 'native-not-in-mod', system };
        }
        const last = index === segments.length - 1;
        if (stat.isSymbolicLink()) return { error: 'native-unsafe-path', system };
        if (last ? !stat.isFile() : !stat.isDirectory()) return { error: 'native-unsafe-path', system };
    }
    try {
        if (!isInside(fs.realpathSync(path.resolve(modDir)), fs.realpathSync(current))) return { error: 'native-unsafe-path', system };
    } catch {
        return { error: 'native-unsafe-path', system };
    }
    return { path: current };
}

module.exports = {
    NATIVE_FILES, MOD_NATIVE_ENTRIES, resolveNativeExecutable, resolveNativeFile, modNativeSystem, modNativeRelativePath, resolveModNativeFile,
};
