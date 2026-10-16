import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySyncedVisualSettings, buildSyncedVisualSettings, readSyncableSettingsState } from '@/services/sync/settingsSnapshot';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';

// test/unit/stores/configSurfaceContract.test.ts
// Locks the two documents that carry a listener's settings off this machine.
//
// A field dropped from either one is silent: sync keeps working, the shortcode still decodes, and
// the setting simply stops travelling. Nothing else in the suite would notice — which is why the
// store split was verified by diffing these key sets by hand at every step. This does it instead.
//
// These assert the *shape* of the produced document, not the source text, so they stay honest
// through a refactor that moves where each field is read from.

describe('config surface contract', () => {
    afterEach(() => {
        useVisualizerSettingsStore.setState({ randomizeAllEnabled: false });
        vi.unstubAllGlobals();
    });

    it('keeps every field of the synced visual settings document', () => {
        const document = buildSyncedVisualSettings(readSyncableSettingsState());

        expect(Object.keys(document).sort()).toMatchSnapshot();
    });

    it('keeps every field of the exportable visual config', () => {
        const config = buildVisualSettingsConfig();

        expect(Object.keys(config).sort()).toMatchSnapshot();
    });

    it('defaults to lyric-only randomization and persists the selected scope across restart', async () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        vi.resetModules();
        const freshStore = (await import('@/stores/useVisualizerSettingsStore')).useVisualizerSettingsStore;
        expect(freshStore.getState().randomizeAllEnabled).toBe(false);
        freshStore.getState().handleToggleRandomizeAll(true);
        expect(values.get('random_visual_style_all')).toBe('true');
        vi.resetModules();
        const restoredStore = (await import('@/stores/useVisualizerSettingsStore')).useVisualizerSettingsStore;
        expect(restoredStore.getState().randomizeAllEnabled).toBe(true);
        restoredStore.getState().handleToggleRandomizeAll(false);
        expect(values.get('random_visual_style_all')).toBe('false');
    });

    it('exports and restores the randomization scope through the sync setter', () => {
        const state = readSyncableSettingsState();
        const setter = vi.fn();
        const target = { ...state, handleToggleRandomizeAll: setter };
        expect(buildSyncedVisualSettings({ ...state, randomizeAllEnabled: true }).randomizeAllEnabled).toBe(true);
        for (const randomizeAllEnabled of [true, false]) {
            applySyncedVisualSettings(target, { randomizeAllEnabled });
            expect(setter).toHaveBeenLastCalledWith(randomizeAllEnabled);
        }
        setter.mockClear();
        applySyncedVisualSettings(target, {});
        expect(setter).not.toHaveBeenCalled();
    });
});
