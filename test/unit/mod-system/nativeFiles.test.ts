import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
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
