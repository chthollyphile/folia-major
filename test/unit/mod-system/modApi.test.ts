import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modApi.test.ts
// The permission gate is the whole point of the `permissions` manifest field:
// a capability a mod did not declare has to be unreachable, not merely
// undocumented. These cover both directions for every guarded API family, plus
// the deactivate hook the loader relies on to stop a disabled mod.

const require = createRequire(import.meta.url);
const { createModApi } = require('../../../electron/modSystem/modApi.cjs');

const temporaryDirectories: string[] = [];

const createApi = (permissions: string[], overrides: Record<string, unknown> = {}) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-api-'));
    temporaryDirectories.push(dataDir);
    return createModApi({
        modId: 'test-mod',
        manifest: { id: 'test-mod', permissions },
        dataDir,
        emitLog: () => {},
        getRuntimeSnapshot: () => ({ song: null }),
        registerDisposer: () => {},
        registerCommand: () => {},
        requestExport: () => Promise.resolve({ ok: true }),
        ...overrides,
    });
};

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('mod api permission gate', () => {
    it('refuses the playback snapshot without runtime.playback', () => {
        expect(() => createApi([]).runtime.getPlaybackSnapshot()).toThrow('permission-denied:runtime.playback');
    });

    it('returns the playback snapshot once runtime.playback is declared', () => {
        expect(createApi(['runtime.playback']).runtime.getPlaybackSnapshot()).toEqual({ song: null });
    });

    it('refuses every storage operation without filesystem.data', () => {
        const api = createApi([]);
        expect(() => api.storage.data.get('k')).toThrow('permission-denied:filesystem.data');
        expect(() => api.storage.data.set('k', 1)).toThrow('permission-denied:filesystem.data');
        expect(() => api.storage.data.has('k')).toThrow('permission-denied:filesystem.data');
        expect(() => api.storage.data.delete('k')).toThrow('permission-denied:filesystem.data');
    });

    it('round-trips storage once filesystem.data is declared', () => {
        const api = createApi(['filesystem.data']);
        api.storage.data.set('answer', 42);
        expect(api.storage.data.get('answer')).toBe(42);
        expect(api.storage.data.has('answer')).toBe(true);
        api.storage.data.delete('answer');
        expect(api.storage.data.has('answer')).toBe(false);
    });

    it('never lets a mod widen its own permissions through the frozen manifest', () => {
        const api = createApi([]);
        try {
            api.manifest.permissions.push('filesystem.data');
        } catch {
            // Frozen in strict mode; either way the gate below must still hold.
        }
        expect(() => api.storage.data.get('k')).toThrow('permission-denied:filesystem.data');
    });
});

describe('mod api lifecycle', () => {
    it('forwards deactivate handlers to the loader', () => {
        const registerDisposer = vi.fn();
        const api = createApi([], { registerDisposer });
        const handler = () => {};
        api.lifecycle.onDeactivate(handler);
        expect(registerDisposer).toHaveBeenCalledWith(handler);
    });
});
