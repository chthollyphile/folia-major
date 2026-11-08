import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { commandPinyinPlugin } from '../pinyin/commandPinyinPlugin.mjs';
import { traditionalLocalePlugin } from '../i18n/traditionalLocalePlugin.mjs';
import { icuFoliaDataPlugin } from '../icuFolia/icuFoliaDataPlugin.mjs';

// dev/perf/vite.config.ts
// Builds the measuring page (dev/perf/page.html) as a production bundle of its own.
//
// It does not load the app's vite.config.ts: that file asks a web service for the commit's name
// while it builds, and the rig makes no request beyond this machine. What the page needs of it is
// repeated here: the React plugin, the command-palette pinyin module (the stores reach it), the
// zh-TW virtual locale (src/i18n/config.ts imports it) and the ICU 字典 virtual module the lyric
// engines import, the `@` alias, the build constants and the separate three.js chunk. The PWA
// plugin is left out on purpose: a service worker would cache the page between two builds of
// changed code.
//
// The bundle is production React but NOT minified by default, so the function names in the
// long-frame reports can be read. PERF_MINIFY=1 builds it minified like the shipped app.
//
// Its own cacheDir and outDir (dev/perf/.build) keep it apart from `npm run dev` and `npm run build`.
//
// PERF_ONE_FILE=1 (set by dev/perf/shots.mjs, never by the measuring runner) builds the same page
// into dev/perf/.build/dist-shots with every dynamic import folded into the one script. A style's
// code is then there when the page starts, instead of arriving, downloaded and compiled, at a
// moment that depends on how busy the PC is. The pictures need that; the measurements must not
// have it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ONE_FILE = process.env.PERF_ONE_FILE === '1';

export default defineConfig({
    root: ROOT,
    base: '/',
    cacheDir: path.join(HERE, '.build', 'vite-cache'),
    worker: {
        format: 'es',
    },
    build: {
        outDir: path.join(HERE, '.build', ONE_FILE ? 'dist-shots' : 'dist'),
        emptyOutDir: true,
        minify: process.env.PERF_MINIFY === '1',
        reportCompressedSize: false,
        rollupOptions: {
            input: {
                perf: path.join(HERE, 'page.html'),
            },
            output: ONE_FILE ? { inlineDynamicImports: true } : {
                manualChunks(id) {
                    return id.includes('/node_modules/three/') ? 'three' : undefined;
                },
            },
        },
    },
    plugins: [
        commandPinyinPlugin(),
        traditionalLocalePlugin(),
        icuFoliaDataPlugin(),
        react(),
    ],
    define: {
        '__COMMIT_HASH__': JSON.stringify('perf-rig'),
        '__GIT_BRANCH__': JSON.stringify('perf-rig'),
        '__APP_VERSION__': JSON.stringify('0.0.0-perf'),
        '__APP_VERSION_LABEL__': JSON.stringify('Perf rig'),
        '__APP_RELEASE_CHANNEL__': JSON.stringify('realeco'),
        '__DOCKER_STACK_VERSION__': JSON.stringify(''),
    },
    resolve: {
        alias: {
            '@': path.resolve(ROOT, './src'),
        },
    },
});
