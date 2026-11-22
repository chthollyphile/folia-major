import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/nativeFiles.test.ts — the native files api.native.path / load resolve by name
// (electron/modSystem/nativeFiles.cjs): a package the app keeps resolves as the app's own require does.

const require = createRequire(import.meta.url);
const { resolveNativeFile } = require('../../../electron/modSystem/nativeFiles.cjs') as {
    resolveNativeFile: (name: string, context: Record<string, unknown>) => string;
};

const context = { platform: process.platform, isPackaged: false, resourcesPath: '', projectRoot: path.resolve('.'), env: {} };

describe('nativeFiles', () => {
    it('resolves librespot to the playback package the app keeps, on any system', () => {
        const resolved = resolveNativeFile('librespot', context);
        expect(resolved).toBe(require.resolve('@lox-audioserver/node-librespot'));
        expect(resolveNativeFile('librespot', { ...context, platform: 'linux', isPackaged: true })).toBe(resolved);
    });

    it('takes no development override for a row without one, and knows no other name', () => {
        expect(resolveNativeFile('librespot', { ...context, env: { ELECTRON_DEV: 'true', undefined: 'C:/elsewhere.js' } }))
            .toBe(require.resolve('@lox-audioserver/node-librespot'));
        expect(resolveNativeFile('unknown', context)).toBe('');
    });
});

// A takeover's own copy (plan §5.1): native/<name>/<platform>-<arch>/<entry> in its folder, walked without following a link.
describe('a takeover\'s own native files', () => {
    const { resolveModNativeFile, modNativeRelativePath } = require('../../../electron/modSystem/nativeFiles.cjs') as {
        resolveModNativeFile: (name: string, modDir: string, context: Record<string, unknown>) => { path?: string; error?: string; system?: string };
        modNativeRelativePath: (name: string, system: string) => string | null;
    };
    const system = { platform: 'win32', arch: 'x64', fs };
    const makeMod = () => {
        const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-native-'));
        const entry = path.join(modDir, 'native', 'librespot', 'win32-x64', 'dist', 'index.js');
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, 'module.exports = {};');
        return { modDir, entry };
    };

    it('lays a name out by system, and knows only the names and systems it has an entry for', () => {
        expect(modNativeRelativePath('librespot', 'win32-x64')).toBe('native/librespot/win32-x64/dist/index.js');
        expect(modNativeRelativePath('apple-music-companion', 'win32-x64')).toBe('native/apple-music-companion/win32-x64/FoliaAppleMusicCompanion.exe');
        // No macOS companion, no darwin-x64 librespot, no other name.
        expect(modNativeRelativePath('apple-music-companion', 'darwin-arm64')).toBeNull();
        expect(modNativeRelativePath('librespot', 'darwin-x64')).toBeNull();
        expect(modNativeRelativePath('constructor', 'win32-x64')).toBeNull();
    });

    it('resolves the entry in the mod folder, and says when the mod does not carry this system', () => {
        const { modDir, entry } = makeMod();
        try {
            expect(resolveModNativeFile('librespot', modDir, system)).toEqual({ path: entry });
            expect(resolveModNativeFile('librespot', modDir, { ...system, platform: 'linux' })).toEqual({ error: 'native-not-in-mod', system: 'linux-x64' });
            expect(resolveModNativeFile('librespot', modDir, { ...system, arch: 'ia32' })).toEqual({ error: 'native-not-in-mod', system: 'win32-ia32' });
            expect(resolveModNativeFile('apple-music-companion', modDir, system)).toEqual({ error: 'native-not-in-mod', system: 'win32-x64' });
        } finally {
            fs.rmSync(modDir, { recursive: true, force: true });
        }
    });

    it('refuses a link on the way, and a folder where the file should be', () => {
        const { modDir } = makeMod();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-outside-'));
        try {
            fs.mkdirSync(path.join(outside, 'dist'));
            fs.writeFileSync(path.join(outside, 'dist', 'index.js'), 'module.exports = { outside: true };');
            fs.rmSync(path.join(modDir, 'native', 'librespot', 'win32-x64'), { recursive: true });
            // A junction (no privilege needed on Windows) or a symbolic link elsewhere.
            fs.symlinkSync(outside, path.join(modDir, 'native', 'librespot', 'win32-x64'), 'junction');
            expect(resolveModNativeFile('librespot', modDir, system)).toEqual({ error: 'native-unsafe-path', system: 'win32-x64' });
            fs.rmSync(path.join(modDir, 'native', 'librespot', 'win32-x64'), { recursive: true, force: true });
            fs.mkdirSync(path.join(modDir, 'native', 'librespot', 'win32-x64', 'dist', 'index.js'), { recursive: true });
            expect(resolveModNativeFile('librespot', modDir, system)).toEqual({ error: 'native-unsafe-path', system: 'win32-x64' });
            // A link beside the entry (librespot finds its binding in ../prebuilds/ by itself).
            fs.rmSync(path.join(modDir, 'native', 'librespot', 'win32-x64'), { recursive: true, force: true });
            const entry = path.join(modDir, 'native', 'librespot', 'win32-x64', 'dist', 'index.js');
            fs.mkdirSync(path.dirname(entry), { recursive: true });
            fs.writeFileSync(entry, 'module.exports = {};');
            fs.symlinkSync(outside, path.join(modDir, 'native', 'librespot', 'win32-x64', 'prebuilds'), 'junction');
            expect(resolveModNativeFile('librespot', modDir, system)).toEqual({ error: 'native-unsafe-path', system: 'win32-x64' });
            fs.rmSync(path.join(modDir, 'native', 'librespot', 'win32-x64', 'prebuilds'), { recursive: true, force: true });
            expect(resolveModNativeFile('librespot', modDir, system)).toEqual({ path: entry });
        } finally {
            fs.rmSync(modDir, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
