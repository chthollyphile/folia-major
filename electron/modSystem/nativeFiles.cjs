'use strict';

// electron/modSystem/nativeFiles.cjs
// The native files the app ships for a built-in source (Folium 2.0 plan §5.5, §6.2): what `api.native.path(name)` /
// `load(name)` resolve, by the names the trusted table's rows list (builtinSources.cjs `native`). The files are built
// and packaged by the app (build/beforePack.cjs, package.json extraResources), not by the source mod: a packaged
// app reads them from its resources only, a development run from the build output, or from an absolute path a
// developer names in the environment. A name this file does not know resolves to '' (the host's `native-unavailable`).

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

module.exports = { NATIVE_FILES, resolveNativeExecutable, resolveNativeFile };
