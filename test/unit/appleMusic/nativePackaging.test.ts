import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Verify release path isolation and per-target native compilation without running a full package build.
const require = createRequire(import.meta.url);
const { resolveNativeExecutable } = require('../../../electron/appleMusic/nativePaths.cjs');
const { prepareMacCompanion, verifyMacCompanion } = require('../../../electron/appleMusic/macos/prepareBundle.cjs');
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
    it('never resolves a Linux or production Windows host', () => {
        expect(resolveNativeExecutable({ ...base, platform: 'linux', override: path.resolve('/custom/native') })).toBe('');
        expect(resolveNativeExecutable({ ...base, platform: 'win32' })).toBe('');
        expect(resolveNativeExecutable({ ...base, platform: 'win32', windowsExperimental: true })).toBe(path.join(root, 'build/apple-music-native/windows/FoliaAppleMusicCompanion.exe'));
        expect(resolveNativeExecutable({ ...base, platform: 'win32', windowsExperimental: true, isPackaged: true })).toBe('');
    });
    it.each([['x64', 'x86_64'], ['arm64', 'arm64']])('compiles %s for the requested target rather than host architecture', (arch, target) => {
        const run = vi.fn();
        const bundle = prepareMacCompanion({ arch, projectRoot: root, run });
        expect(bundle).toBe(path.join(root, `build/apple-music-native/darwin-${arch}/FoliaAppleMusicCompanion.app`));
        expect(run).toHaveBeenCalledWith('sh', [path.join(root, 'electron/appleMusic/macos/buildCompanion.sh'), bundle, 'org.folia.AppleMusicCompanion', target], { stdio: 'inherit' });
    });
    it('fails unsupported architectures and missing packaged resources', async () => {
        const run = vi.fn();
        expect(() => prepareMacCompanion({ arch: 'ia32', projectRoot: root, run })).toThrow('Unsupported');
        expect(run).not.toHaveBeenCalled();
        await expect(verifyMacCompanion(path.join(root, 'missing-resources'))).rejects.toThrow();
    });
    it('keeps the build hook, packaged resource and launch path aligned', () => {
        const config = require('../../../package.json').build;
        expect(config.mac.extraResources).toContainEqual({
            from: 'build/apple-music-native/darwin-${arch}/FoliaAppleMusicCompanion.app',
            to: 'apple-music/FoliaAppleMusicCompanion.app',
        });
    });
});
