import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SONNET_TUNING } from '@/types';
import { useSettingsUiStore } from '@/stores/useSettingsUiStore';

// test/unit/visualizer/sonnetSettings.test.ts
// Verifies Sonnet visibility tuning and the first-entry performance warning at the store boundary.
const createLocalStorageMock = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length() {
            return values.size;
        },
        getItem: key => values.get(key) ?? null,
        key: index => Array.from(values.keys())[index] ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        clear: () => values.clear(),
    };
};

describe('Sonnet settings', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useSettingsUiStore.setState({
            visualizerMode: 'classic',
            sonnetTuning: { ...DEFAULT_SONNET_TUNING },
            sonnetPerformanceWarningOpen: false,
            sonnetPerformanceWarningDontShowAgain: false,
            sonnetPerformanceWarningDismissed: false,
            pendingVisualizerMode: null,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('updates and persists visibility tuning', () => {
        expect(DEFAULT_SONNET_TUNING.textureResolution).toBe(1.5);
        useSettingsUiStore.getState().handleSetSonnetTuning({
            showOnlyText: true,
            showGuide: false,
            showBackgroundMg: false,
            enableTransitions: true,
            outerFrameMode: 'frame',
            textureResolution: 1.75,
        });

        expect(useSettingsUiStore.getState().sonnetTuning).toMatchObject({
            showOnlyText: true,
            showGuide: false,
            showBackgroundMg: false,
            showFixedGeo: true,
            enableTransitions: true,
            outerFrameMode: 'frame',
            textureResolution: 1.75,
        });
        expect(JSON.parse(storage.getItem('sonnet_tuning') ?? '{}')).toMatchObject({
            showOnlyText: true,
            showGuide: false,
            showBackgroundMg: false,
            enableTransitions: true,
            outerFrameMode: 'frame',
            textureResolution: 1.75,
        });
    });

    it('requires confirmation before entering Sonnet and remembers the opt-out', () => {
        useSettingsUiStore.getState().handleSetVisualizerMode('sonnet');

        expect(useSettingsUiStore.getState().visualizerMode).toBe('classic');
        expect(useSettingsUiStore.getState().sonnetPerformanceWarningOpen).toBe(true);

        useSettingsUiStore.getState().handleSetSonnetPerformanceWarningDontShowAgain(true);
        useSettingsUiStore.getState().handleConfirmSonnetPerformanceWarning();

        expect(useSettingsUiStore.getState().visualizerMode).toBe('sonnet');
        expect(useSettingsUiStore.getState().sonnetPerformanceWarningOpen).toBe(false);
        expect(storage.getItem('sonnet_performance_warning_dismissed')).toBe('true');

        useSettingsUiStore.getState().handleSetVisualizerMode('classic');
        useSettingsUiStore.getState().handleSetVisualizerMode('sonnet');
        expect(useSettingsUiStore.getState().visualizerMode).toBe('sonnet');
        expect(useSettingsUiStore.getState().sonnetPerformanceWarningOpen).toBe(false);
    });
});
