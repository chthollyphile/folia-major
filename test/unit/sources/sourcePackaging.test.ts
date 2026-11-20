import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledSourcesConfig } from '../../../build/bundledSources.mjs';
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
        const { files } = bundledSourcesConfig({ root: ROOT });
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
