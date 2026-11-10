import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressConfig, decompressConfig } from '../../../src/utils/appearanceCodec';

// test/unit/scenes/sceneSettings.test.ts
// The scene settings: what is kept of stored or imported values, what is stored and read back after a
// restart. The scene settings stay out of the config code (OBS shows no scene).

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
        const { sceneId, sceneOptions } = second.useSceneSettingsStore.getState();
        expect({ sceneId, sceneOptions }).toEqual({ sceneId: 'cinema', sceneOptions: { cinema: { viewpoint: 'R2-3', quality: 'high' } } });

        second.useSceneSettingsStore.getState().setSceneId(null);
        expect(localStorage.getItem(second.SCENE_ID_KEY)).toBeNull();
    });

    it('leaves the scene fields out of a config code', () => {
        const config = { sceneId: 'cinema', sceneOptions: { cinema: { viewpoint: 'R3-4', quality: 'medium' } } };
        const decoded = decompressConfig(compressConfig(config)) as Record<string, unknown>;
        expect(decoded.sceneId).toBeUndefined();
        expect(decoded.sceneOptions).toBeUndefined();
    });
});
