import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtModsMismatch, bundledSourcesConfig } from '../../../build/bundledSources.mjs';
import { webSourceIds, webSourcesModuleCode } from '../../../dev/sources/webSourcePlugin.mjs';
import { hostRequiredPackages, packageExclusionPattern, sourceDeclaredPackages, upstreamPackageExclusions } from '../../../dev/sources/packaging.mjs';

// test/unit/sources/sourcePackaging.test.ts
// The built-in sources in the installer (Folium 2.0 plan §6.2, packaging): each source carries its upstream libraries,
// so app.asar leaves them out (build/bundledSources.mjs, the parent electron-builder config, from
// dev/sources/packaging.mjs), while the root package.json keeps them as dependencies, pinned to the same version as the
// source declares (sources:build takes them from the root node_modules; the QQ entries of Vercel and Cloudflare use one).

const ROOT = path.resolve(__dirname, '../../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    build: { extends?: string; files: string[] };
};

describe('the built-in sources in app.asar', () => {
    it('reads the packages the host\'s main-process code requires', () => {
        const required = hostRequiredPackages(ROOT);
        expect(required).toEqual(expect.arrayContaining(['electron-store', 'ws']));
        expect(required).not.toContain('electron');
        expect(required).not.toContain('fs');
    });

    it('leaves every upstream library a source carries out of app.asar, with what only they use', () => {
        const excluded = upstreamPackageExclusions({ root: ROOT });
        const carried = [...sourceDeclaredPackages(ROOT).entries()]
            .filter(([, owners]) => owners.every((owner: { mode: string }) => owner.mode !== 'native'))
            .map(([name]) => name)
            .filter(name => name !== 'ws');
        expect(carried.length).toBeGreaterThan(5);
        expect(excluded).toEqual(expect.arrayContaining(carried));
        // Only the upstream libraries use it (the NetEase and QQ backends' dependencies).
        expect(excluded).toContain('jsdom');
        // The host uses these: Spotify declares ws, and the host's stage API requires it too.
        for (const kept of ['ws', 'axios', 'electron-store', 'koffi', 'music-metadata']) expect(excluded).not.toContain(kept);
    });

    it('keeps a native part the app ships only while its source is carried', () => {
        const native = '@lox-audioserver/node-librespot';
        expect(upstreamPackageExclusions({ root: ROOT })).not.toContain(native);
        expect(upstreamPackageExclusions({ root: ROOT, keepNative: () => false })).toContain(native);
    });

    it('writes the exclusions as files patterns of the parent config package.json extends', () => {
        expect(rootPackage.build.extends).toBe('file:build/bundledSources.mjs');
        const { files } = bundledSourcesConfig({ root: ROOT, bundled: undefined });
        expect(files).toContain(packageExclusionPattern('kugoumusicapi'));
        expect(files.every(pattern => pattern.startsWith('!**/node_modules/'))).toBe(true);
        expect(packageExclusionPattern('@scope/name')).toBe('!**/node_modules/@scope/name{,/**/*}');
    });

    it('keeps each upstream library in the root dependencies, pinned as its source pins it', () => {
        // A package the host itself uses (ws) is the host's dependency, under the host's own range.
        const hostOwn = new Set(hostRequiredPackages(ROOT));
        for (const [name, owners] of sourceDeclaredPackages(ROOT)) {
            if (hostOwn.has(name)) continue;
            for (const { sourceId } of owners) {
                const pinned = (JSON.parse(fs.readFileSync(path.join(ROOT, 'sources', sourceId, 'package.json'), 'utf8')) as {
                    dependencies: Record<string, string>;
                }).dependencies[name];
                const atRoot = rootPackage.dependencies[name]
                    ?? (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { optionalDependencies: Record<string, string> }).optionalDependencies[name];
                expect(atRoot, `${name} (sources/${sourceId})`).toBe(pinned);
            }
        }
    });
});

// FOLIA_BUNDLED_SOURCES (plan §6.2, §8, §11 the compliance plan): what an installer and the web build carry.
describe('FOLIA_BUNDLED_SOURCES', () => {
    // The nine platforms and LX Music Source, the tenth (2026-11-21).
    const all = ['netease', 'kugou', 'qq', 'bodian', 'qishui', 'ytm', 'spotify', 'appleMusic', 'fnmusic', 'lxmusic'];

    it('carries every source without it: every dist-mods folder, the declaration, the Apple Music companion', () => {
        const config = bundledSourcesConfig({ root: ROOT, bundled: undefined });
        expect([...config.extraMetadata.foliaBundledSources].sort()).toEqual([...all].sort());
        expect(config.extraResources.map((entry: { to: string }) => entry.to).sort()).toEqual(all.map(id => `builtin-mods/${id}`).sort());
        expect(config.extraResources[0]?.filter).toEqual(['**/*', '!**/*.tmp']);
        expect(config.win.extraResources).toHaveLength(1);
        expect(config.mac.extraResources).toHaveLength(1);
    });

    it('carries none for an empty one: no folder, an empty declaration, no native part, no companion', () => {
        const config = bundledSourcesConfig({ root: ROOT, bundled: '' });
        expect(config.extraMetadata.foliaBundledSources).toEqual([]);
        expect(config.extraResources).toEqual([]);
        expect(config.files).toContain(packageExclusionPattern('@lox-audioserver/node-librespot'));
        expect(config.win.extraResources).toEqual([]);
        expect(config.mac.extraResources).toEqual([]);
    });

    it('carries a subset: its folders, its short ids (the trusted table rows), the native part of a source carried', () => {
        const config = bundledSourcesConfig({ root: ROOT, bundled: 'spotify,appleMusic' });
        expect(config.extraMetadata.foliaBundledSources).toEqual(['appleMusic', 'spotify']);
        expect(config.extraResources.map((entry: { from: string }) => entry.from)).toEqual(['dist-mods/appleMusic', 'dist-mods/spotify']);
        expect(config.files).not.toContain(packageExclusionPattern('@lox-audioserver/node-librespot'));
        // The upstream libraries stay out whatever the selection: each source carries its own.
        expect(config.files).toContain(packageExclusionPattern('kugoumusicapi'));
        expect(() => bundledSourcesConfig({ root: ROOT, bundled: 'nosuchsource' })).toThrow(/nosuchsource/);
    });

    it('refuses to package a dist-mods/ that does not match the selection', () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-bundled-'));
        try {
            fs.mkdirSync(path.join(out, 'netease'));
            fs.writeFileSync(path.join(out, 'netease', 'build.json'), '{}');
            fs.mkdirSync(path.join(out, 'not-built'));
            expect(builtModsMismatch(['netease'], out)).toBeNull();
            expect(builtModsMismatch(['netease', 'qq'], out)).toMatch(/没有构建好的 qq/);
            expect(builtModsMismatch([], out)).toMatch(/多出 netease/);
        } finally {
            fs.rmSync(out, { recursive: true, force: true });
        }
    });

    it('takes into the web build only the chosen platforms that have a web file', () => {
        expect(webSourceIds({ bundled: undefined })).toEqual(['netease', 'kugou', 'qq']);
        expect(webSourceIds({ bundled: 'qq,bodian' })).toEqual(['qq']);
        expect(webSourceIds({ bundled: '' })).toEqual([]);
        const code = webSourcesModuleCode(['netease', 'qq'], '/web');
        expect(code).toContain('import { registerWebSource as register0 } from "/web/netease.ts";');
        expect(code).toContain('{ id: "qq", register: () => { register1(); } },');
        expect(code).not.toContain('kugou');
        expect(webSourcesModuleCode([], '/web')).toBe('export default [\n];\n');
    });
});
