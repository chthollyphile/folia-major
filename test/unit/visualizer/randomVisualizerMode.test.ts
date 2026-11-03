// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, String(value)); },
            removeItem: (key: string) => { values.delete(key); },
            clear: () => values.clear(),
            key: (index: number) => [...values.keys()][index] ?? null,
            get length() { return values.size; },
        },
    });
});
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as randomModes from '@/utils/randomVisualizerModes';
import { useRandomVisualizerMode } from '@/hooks/useRandomVisualizerMode';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { collectVisualizerTunings } from '@/components/visualizer/tuningRegistry';
import { BUILTIN_VISUALIZER_MODES } from '@/types/visualizerModes';
import { readStoredRandomVisualizerModes, RANDOM_VISUALIZER_MODES_STORAGE_KEY } from '@/stores/visualizerSettingsPersistence';
import type { SongResult } from '@/types';
import { buildCurrentConfig, applyImportedConfig, planConfigImport, type ConfigThemeControls } from '@/components/modal/settings/pages/storage/visualConfigTransfer';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { applySyncedVisualSettings, buildSyncedSettingsRecord, readSyncableSettingsState } from '@/services/sync/settingsSnapshot';
import { parseSyncedSettingsRecord } from '@/services/sync/syncSchema';

// Exercises the real hook and settings actions together, including StrictMode's effect replay.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = () => useVisualizerSettingsStore.getState();
const controls: ConfigThemeControls = {
    bgMode: 'default',
    isCustomThemePreferred: false,
    songThemeAutoSwitchEnabled: false,
    songThemeAutoGenerateEnabled: false,
    onSaveCustomTheme: () => {},
    onApplyCustomTheme: () => {},
    onToggleSongThemeAutoSwitch: () => {},
    onToggleSongThemeAutoGenerate: () => {},
    onChangeThemeGenerationSource: () => {},
};
const song = (id: number, providerId: 'netease' | 'qq' = 'netease') => ({
    id, sourceRef: { kind: 'online', providerId, mediaId: String(id) },
}) as SongResult;

const Harness = ({ currentSong }: { currentSong: SongResult | null }) => {
    const mode = useVisualizerSettingsStore(value => value.visualizerMode);
    const enabled = useVisualizerSettingsStore(value => value.randomVisualizerModePerSong);
    const modes = useVisualizerSettingsStore(value => value.randomVisualizerModes);
    useRandomVisualizerMode({ currentSong, enabled, modes, visualizerMode: mode, setVisualizerMode: state().handleSetVisualizerMode });
    return null;
};

describe('per-song random lyric styles', () => {
    let root: Root;
    let host: HTMLDivElement;
    const show = async (currentSong: SongResult | null) => {
        await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness, { currentSong }))));
    };

    beforeEach(() => {
        localStorage.clear();
        useVisualizerSettingsStore.setState(useVisualizerSettingsStore.getInitialState(), true);
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(randomModes, 'pickRandomVisualizerMode');
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });

    it('draws once per changed song, including equal ids from different providers', async () => {
        state().handleSetRandomVisualizerModes(['classic', 'sonnet', 'tilt']);
        state().handleToggleRandomVisualizerModePerSong(true);
        await show(song(1));
        expect(state().visualizerMode).toBe('classic');
        await show(song(2));
        expect(state().visualizerMode).toBe('sonnet');
        expect(state().randomVisualizerModePerSong).toBe(true);
        await show({ ...song(2), name: 'Updated metadata' });
        expect(state().visualizerMode).toBe('sonnet');
        expect(randomModes.pickRandomVisualizerMode).toHaveBeenCalledTimes(1);
        await show(song(2, 'qq'));
        expect(state().visualizerMode).toBe('classic');
        expect(randomModes.pickRandomVisualizerMode).toHaveBeenCalledTimes(2);
    });

    it('selects an eligible style once when enabled outside the pool under StrictMode', async () => {
        state().handleSetRandomVisualizerModes(['sonnet', 'tilt']);
        state().handleToggleRandomVisualizerModePerSong(true);
        await show(song(1));
        expect(state().visualizerMode).toBe('sonnet');
        expect(randomModes.pickRandomVisualizerMode).toHaveBeenCalledTimes(1);
    });

    it('keeps the preview within the selection even before a song is loaded', async () => {
        state().handleSetRandomVisualizerModes(['sonnet', 'tilt']);
        state().handleToggleRandomVisualizerModePerSong(true);
        await show(null);
        expect(state().visualizerMode).toBe('sonnet');
        expect(randomModes.pickRandomVisualizerMode).toHaveBeenCalledTimes(1);
        await show(song(1));
        expect(state().visualizerMode).toBe('sonnet');
        expect(randomModes.pickRandomVisualizerMode).toHaveBeenCalledTimes(1);
    });

    it('retains the last song across a temporary empty track', async () => {
        state().handleSetRandomVisualizerModes(['classic', 'sonnet']);
        state().handleToggleRandomVisualizerModePerSong(true);
        await show(song(1));
        await show(null);
        await show(song(2));
        expect(state().visualizerMode).toBe('sonnet');
    });

    it('respects edits to the pool and a single selected style', async () => {
        await show(song(1));
        await act(async () => {
            state().handleSetRandomVisualizerModes(['sonnet']);
            state().handleToggleRandomVisualizerModePerSong(true);
        });
        expect(state().visualizerMode).toBe('sonnet');
        await show(song(2));
        expect(state().visualizerMode).toBe('sonnet');
        await act(async () => state().handleSetRandomVisualizerModes(['tilt']));
        expect(state().visualizerMode).toBe('tilt');
    });

    it('manual selection exits random and leaves the pool and every style tuning intact', async () => {
        state().handleSetClassicTuning({ wordSpacing: 1.3, enableWordRotation: false });
        state().handleSetSonnetTuning({ cameraIntensity: 0.4 });
        const tunings = collectVisualizerTunings(state() as unknown as Record<string, unknown>);
        state().handleSetRandomVisualizerModes(['classic', 'sonnet']);
        state().handleToggleRandomVisualizerModePerSong(true);
        await show(song(1));
        await show(song(2));
        await act(async () => state().handleSetVisualizerMode('classic', { notify: false }));
        await show(song(3));
        expect(state().randomVisualizerModePerSong).toBe(false);
        expect(state().visualizerMode).toBe('classic');
        expect(state().randomVisualizerModes).toEqual(['classic', 'sonnet']);
        expect(collectVisualizerTunings(state() as unknown as Record<string, unknown>)).toEqual(tunings);
        for (const [key, value] of Object.entries(tunings)) {
            expect(collectVisualizerTunings(state() as unknown as Record<string, unknown>)[key as keyof typeof tunings]).toBe(value);
        }
    });

    it.each(['shortcode', 'JSON'])('round-trips the selected pool through %s and applies only picked changes', format => {
        state().handleSetRandomVisualizerModes(['sonnet', 'tilt']);
        state().handleToggleRandomVisualizerModePerSong(true);
        const exported = buildCurrentConfig(controls, 'none');
        const text = format === 'JSON' ? JSON.stringify(exported) : compressConfig(exported);
        state().handleSetRandomVisualizerModes(BUILTIN_VISUALIZER_MODES);
        state().handleToggleRandomVisualizerModePerSong(false);
        const { config, plan } = planConfigImport(text, controls);
        expect(config.randomVisualizerModes).toEqual(['sonnet', 'tilt']);
        expect(plan.changes.some(change => change.key === 'randomVisualizerModes')).toBe(true);
        applyImportedConfig(config, ['randomVisualizerModes'], controls);
        expect(state().randomVisualizerModes).toEqual(['sonnet', 'tilt']);
        expect(state().randomVisualizerModePerSong).toBe(false);
        applyImportedConfig(config, ['randomVisualizerModePerSong'], controls);
        expect(state().randomVisualizerModePerSong).toBe(true);
    });

    it('keeps the random flag and selection across a complete sync round-trip', () => {
        state().handleSetRandomVisualizerModes(['sonnet', 'tilt']);
        state().handleToggleRandomVisualizerModePerSong(true);
        const record = buildSyncedSettingsRecord(readSyncableSettingsState());
        const parsed = parseSyncedSettingsRecord(JSON.parse(JSON.stringify(record)))!;
        state().handleSetVisualizerMode('classic', { notify: false });
        state().handleSetRandomVisualizerModes(BUILTIN_VISUALIZER_MODES);
        applySyncedVisualSettings(readSyncableSettingsState(), parsed.data);
        expect(state().randomVisualizerModes).toEqual(['sonnet', 'tilt']);
        expect(state().randomVisualizerModePerSong).toBe(true);
    });

    it.each([
        { pool: ['sonnet'], expected: ['sonnet'] },
        { pool: ['unknown', 'sonnet', 'sonnet'], expected: ['sonnet'] },
        { pool: [], expected: BUILTIN_VISUALIZER_MODES },
    ])('decodes a standalone minified random-style pool: $pool', ({ pool, expected }) => {
        expect(decompressConfig(JSON.stringify({ rvm: pool }))).toEqual({ randomVisualizerModes: expected });
    });

    it('selectively imports a standalone minified pool without changing the active style or its tuning', () => {
        state().handleSetClassicTuning({ wordSpacing: 1.3 });
        const tunings = collectVisualizerTunings(state() as unknown as Record<string, unknown>);
        const mode = state().visualizerMode;
        const { config, plan } = planConfigImport('{"rvm":["sonnet"]}', controls);
        expect(plan.changes.map(change => change.key)).toEqual(['randomVisualizerModes']);

        applyImportedConfig(config, ['randomVisualizerModes'], controls);
        expect(state().randomVisualizerModes).toEqual(['sonnet']);
        expect(state().randomVisualizerModePerSong).toBe(false);
        expect(state().visualizerMode).toBe(mode);
        expect(collectVisualizerTunings(state() as unknown as Record<string, unknown>)).toEqual(tunings);
    });

    it('filters invalid imported ids and leaves the pool alone when an old config omits it', () => {
        expect(decompressConfig(JSON.stringify({ randomVisualizerModes: ['sonnet', 'mod:test:style', 'sonnet', false] })).randomVisualizerModes)
            .toEqual(['sonnet']);
        state().handleSetRandomVisualizerModes(['tilt']);
        state().handleToggleRandomVisualizerModePerSong(true);
        applyImportedConfig({ visualizerMode: 'classic' }, ['visualizerMode'], controls);
        expect(state().randomVisualizerModes).toEqual(['tilt']);
        expect(state().randomVisualizerModePerSong).toBe(true);
        const record = parseSyncedSettingsRecord({
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            data: { randomVisualizerModePerSong: true, randomVisualizerModes: ['sonnet', 1, 'mod:test:style'] },
        })!;
        expect(record.data.randomVisualizerModes).toEqual(['sonnet']);
    });

    it('persists the pool and restores safe defaults for old or corrupt storage', () => {
        expect(readStoredRandomVisualizerModes()).toEqual(BUILTIN_VISUALIZER_MODES);
        localStorage.setItem(RANDOM_VISUALIZER_MODES_STORAGE_KEY, '{broken');
        expect(readStoredRandomVisualizerModes()).toEqual(BUILTIN_VISUALIZER_MODES);
        state().handleSetRandomVisualizerModes(['tilt', 'sonnet', 'tilt']);
        expect(readStoredRandomVisualizerModes()).toEqual(['sonnet', 'tilt']);
        state().handleSetRandomVisualizerModes([]);
        expect(readStoredRandomVisualizerModes()).toEqual(BUILTIN_VISUALIZER_MODES);
    });
});
