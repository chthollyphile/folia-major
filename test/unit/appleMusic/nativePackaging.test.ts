import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Verify release path isolation and per-target native compilation without running a full package build.
const require = createRequire(import.meta.url);
const { resolveNativeExecutable, resolveNativeFile } = require('../../../electron/modSystem/nativeFiles.cjs');
const { prepareMacCompanion, verifyMacCompanion } = require('../../../sources/appleMusic/native/macos/prepareBundle.cjs');
const { WINDOWS_COMPANION_FILES, prepareWindowsCompanion, verifyWindowsCompanion } = require('../../../sources/appleMusic/native/windows/prepareBundle.cjs');
const root = path.resolve('/project');
const resources = path.resolve('/installed/Resources');
const base = { platform: 'darwin', isPackaged: false, projectRoot: root, resourcesPath: resources };

describe('Apple Music native delivery', () => {
    it('resolves development output and only absolute developer overrides', () => {
        expect(resolveNativeExecutable(base)).toBe(path.join(root, 'build/apple-music-native/FoliaAppleMusicCompanion.app/Contents/MacOS/FoliaAppleMusicCompanion'));
        expect(resolveNativeExecutable({ ...base, override: path.resolve('/custom/native') })).toBe(path.resolve('/custom/native'));
        expect(resolveNativeExecutable({ ...base, override: 'relative' })).toBe('');
    });
    it('uses bundled resources and ignores overrides in production', () => {
        expect(resolveNativeExecutable({ ...base, isPackaged: true, override: path.resolve('/custom/native') })).toBe(path.join(resources, 'apple-music/FoliaAppleMusicCompanion.app/Contents/MacOS/FoliaAppleMusicCompanion'));
    });
    it('resolves the companion by its native name for api.native.path, the override only in a development run', () => {
        const context = { ...base, platform: 'win32', env: {} };
        expect(resolveNativeFile('apple-music-companion', context)).toBe(path.join(root, 'build/apple-music-native/windows/FoliaAppleMusicCompanion.exe'));
        const custom = path.resolve('/custom/native');
        expect(resolveNativeFile('apple-music-companion', { ...context, env: { ELECTRON_DEV: 'true', FOLIA_APPLE_MUSIC_NATIVE: custom } })).toBe(custom);
        expect(resolveNativeFile('apple-music-companion', { ...context, env: { FOLIA_APPLE_MUSIC_NATIVE: custom } })).toBe(path.join(root, 'build/apple-music-native/windows/FoliaAppleMusicCompanion.exe'));
        expect(resolveNativeFile('apple-music-companion', { ...context, platform: 'linux' })).toBe('');
        expect(resolveNativeFile('unknown-native', context)).toBe('');
    });
    it('never resolves a Linux host', () => {
        expect(resolveNativeExecutable({ ...base, platform: 'linux', override: path.resolve('/custom/native') })).toBe('');
    });
    it('resolves the Windows host in development and from packaged resources', () => {
        expect(resolveNativeExecutable({ ...base, platform: 'win32' })).toBe(path.join(root, 'build/apple-music-native/windows/FoliaAppleMusicCompanion.exe'));
        expect(resolveNativeExecutable({ ...base, platform: 'win32', isPackaged: true, override: path.resolve('/custom/native') })).toBe(path.join(resources, 'apple-music/windows/FoliaAppleMusicCompanion.exe'));
    });
    it('compiles the Windows host for x64 only and fails when packaged files are missing', async () => {
        const run = vi.fn();
        expect(prepareWindowsCompanion({ arch: 'x64', projectRoot: root, run })).toBe(path.join(root, 'build/apple-music-native/windows'));
        expect(run).toHaveBeenCalledWith('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'sources/appleMusic/native/windows/buildCompanion.ps1')], { stdio: 'inherit' });
        run.mockClear();
        expect(() => prepareWindowsCompanion({ arch: 'arm64', projectRoot: root, run })).toThrow('Unsupported');
        expect(run).not.toHaveBeenCalled();
        await expect(verifyWindowsCompanion(path.join(root, 'missing-resources'))).rejects.toThrow();
    });
    it.each([['x64', 'x86_64'], ['arm64', 'arm64']])('compiles %s for the requested target rather than host architecture', (arch, target) => {
        const run = vi.fn();
        const bundle = prepareMacCompanion({ arch, projectRoot: root, run });
        expect(bundle).toBe(path.join(root, `build/apple-music-native/darwin-${arch}/FoliaAppleMusicCompanion.app`));
        expect(run).toHaveBeenCalledWith('sh', [path.join(root, 'sources/appleMusic/native/macos/buildCompanion.sh'), bundle, 'org.folia.AppleMusicCompanion', target], { stdio: 'inherit' });
    });
    it('fails unsupported architectures and missing packaged resources', async () => {
        const run = vi.fn();
        expect(() => prepareMacCompanion({ arch: 'ia32', projectRoot: root, run })).toThrow('Unsupported');
        expect(run).not.toHaveBeenCalled();
        await expect(verifyMacCompanion(path.join(root, 'missing-resources'))).rejects.toThrow();
    });
    it('keeps the build hook, packaged resource and launch path aligned', async () => {
        // The companion goes in only with the Apple Music source (build/bundledSources.mjs, FOLIA_BUNDLED_SOURCES).
        const { bundledSourcesConfig } = await import('../../../build/bundledSources.mjs');
        const config = bundledSourcesConfig({ bundled: undefined });
        expect(config.mac.extraResources).toContainEqual({
            from: 'build/apple-music-native/darwin-${arch}/FoliaAppleMusicCompanion.app',
            to: 'apple-music/FoliaAppleMusicCompanion.app',
        });
        expect(config.win.extraResources).toContainEqual({
            from: 'build/apple-music-native/windows',
            to: 'apple-music/windows',
            filter: WINDOWS_COMPANION_FILES,
        });
    });
    it('leaves the companion out of a package without the Apple Music source', async () => {
        const { bundledSourcesConfig } = await import('../../../build/bundledSources.mjs');
        const config = bundledSourcesConfig({ bundled: 'netease' });
        expect(config.win.extraResources).toEqual([]);
        expect(config.mac.extraResources).toEqual([]);
    });
});
