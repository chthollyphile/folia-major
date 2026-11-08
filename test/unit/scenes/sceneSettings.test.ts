import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressConfig, decompressConfig } from '../../../src/utils/appearanceCodec';

// test/unit/scenes/sceneSettings.test.ts
// The scene settings: what is kept of stored or imported values, what is stored and read back after a
// restart, and the scene fields' trip through a config code.

const memoryStorage = () => {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => { items.set(key, String(value)); },
        removeItem: (key: string) => { items.delete(key); },
        clear: () => items.clear(),
    };
};

const loadStore = async () => {
    vi.resetModules();
    return import('../../../src/components/scenes/settings/useSceneSettingsStore');
};

describe('scene settings', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        if (typeof window === 'undefined') vi.stubGlobal('window', globalThis);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps only what it understands of stored or imported options', async () => {
        const { sanitizeSceneOptions } = await loadStore();
        expect(sanitizeSceneOptions({
            cinema: { lyrics: 'style', screen: 'nope', quality: 'ultra', viewpoint: 'R7-12', values: { rain: true, colour: '#fff', bad: {} } },
            'not a scene': { lyrics: 'style' },
            'mod:demo:room': 'junk',
        })).toEqual({ cinema: { viewpoint: 'R7-12', values: { rain: true, colour: '#fff' } } });
        expect(sanitizeSceneOptions(null)).toEqual({});
    });

    it('stores the scene and its options, and reads them back after a restart', async () => {
        const first = await loadStore();
        expect(first.useSceneSettingsStore.getState().sceneId).toBeNull();
        first.useSceneSettingsStore.getState().setSceneId('cinema');
        first.useSceneSettingsStore.getState().setSceneOptions('cinema', { viewpoint: 'R2-3', quality: 'high' });
        first.useSceneSettingsStore.getState().setSceneId('kit');
        expect(first.useSceneSettingsStore.getState().sceneId).toBeNull();
        first.useSceneSettingsStore.getState().setSceneId('cinema');

        const second = await loadStore();
        expect(second.readSceneConfig()).toEqual({ sceneId: 'cinema', sceneOptions: { cinema: { viewpoint: 'R2-3', quality: 'high' } } });

        second.useSceneSettingsStore.getState().setSceneId(null);
        expect(localStorage.getItem(second.SCENE_ID_KEY)).toBeNull();
    });

    it('takes an imported config, sanitized, and leaves out what it does not carry', async () => {
        const { useSceneSettingsStore, readSceneConfig } = await loadStore();
        useSceneSettingsStore.getState().importSceneConfig({ sceneOptions: { cinema: { viewpoint: 'R1-1', junk: 1 } as never } });
        expect(readSceneConfig()).toEqual({ sceneId: null, sceneOptions: { cinema: { viewpoint: 'R1-1' } } });
        useSceneSettingsStore.getState().importSceneConfig({ sceneId: 'pkg:rooftop' });
        expect(readSceneConfig().sceneId).toBe('pkg:rooftop');
    });

    it('merges imported options by scene id, keeping the scenes the import does not carry', async () => {
        const { useSceneSettingsStore, readSceneConfig, mergeImportedSceneOptions } = await loadStore();
        useSceneSettingsStore.getState().setSceneOptions('cinema', { quality: 'high' });
        useSceneSettingsStore.getState().setSceneOptions('pkg:rooftop', { viewpoint: 'S1' });
        useSceneSettingsStore.getState().importSceneConfig({ sceneOptions: { cinema: { viewpoint: 'R3-4' } } });
        expect(readSceneConfig().sceneOptions).toEqual({ cinema: { viewpoint: 'R3-4' }, 'pkg:rooftop': { viewpoint: 'S1' } });
        // What the plan diffs is what the apply leaves: junk gone, other scenes kept.
        expect(mergeImportedSceneOptions(readSceneConfig().sceneOptions, { cinema: { viewpoint: 'R3-4', junk: 1 }, 'bad id': {} } as never))
            .toEqual(readSceneConfig().sceneOptions);
    });

    it('carries the scene fields through a config code', () => {
        const config = { sceneId: 'cinema', sceneOptions: { cinema: { viewpoint: 'R3-4', quality: 'medium' } } };
        expect(decompressConfig(compressConfig(config))).toMatchObject(config);
        expect(decompressConfig(JSON.stringify(config))).toMatchObject(config);
    });
});
