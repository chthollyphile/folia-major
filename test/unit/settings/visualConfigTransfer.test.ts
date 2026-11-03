// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { applyImportedConfig, buildCurrentConfig, type ConfigThemeControls } from '@/components/modal/settings/pages/storage/visualConfigTransfer';
import { useStageSettingsStore } from '@/stores/useStageSettingsStore';
import { useLatticeSettingsStore } from '@/stores/useLatticeSettingsStore';
import { useThemeSettingsStore } from '@/stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import type { DualTheme } from '@/types';
import { ACTIVATE_CUSTOM_THEME_KEY, THEME_DARK_KEY } from '@/utils/appearanceImportPlan';

// test/unit/settings/visualConfigTransfer.test.ts
// Applying an imported config: which picked field ends up in which store, and what is left alone.
// Nobody sees this by looking: a field applied to the wrong place, or one applied without being
// picked, only shows up later as a setting that changed by itself. The cases are the ones that
// differ in where a value goes: a settings store, the now playing card's store, the app shell.

const dual = (name: string) => ({ light: { name: `${name} light` }, dark: { name: `${name} dark` } }) as unknown as DualTheme;

const controls = (over: Partial<ConfigThemeControls> = {}): ConfigThemeControls => ({
    bgMode: 'default',
    aiTheme: null,
    customTheme: null,
    isCustomThemePreferred: false,
    songThemeAutoSwitchEnabled: true,
    songThemeAutoGenerateEnabled: false,
    onSaveCustomTheme: vi.fn(),
    onApplyCustomTheme: vi.fn(),
    onToggleSongThemeAutoSwitch: vi.fn(),
    onToggleSongThemeAutoGenerate: vi.fn(),
    onChangeThemeGenerationSource: vi.fn(),
    ...over,
});

describe('applyImportedConfig', () => {
    it('applies the picked fields and leaves the others as they are', () => {
        const before = useVisualizerSettingsStore.getState().backgroundOpacity;

        applyImportedConfig({ visualizerOpacity: 0.5, backgroundOpacity: before === 0.3 ? 0.4 : 0.3 }, ['visualizerOpacity'], controls());

        expect(useVisualizerSettingsStore.getState().visualizerOpacity).toBe(0.5);
        expect(useVisualizerSettingsStore.getState().backgroundOpacity).toBe(before);
    });

    it('writes the now playing card to its store', () => {
        applyImportedConfig(
            { stageTrackPillMode: 'always', stageTrackPillTimeoutSec: 20, stageTrackPillOnHome: true },
            ['stageTrackPillMode', 'stageTrackPillTimeoutSec', 'stageTrackPillOnHome'],
            controls(),
        );

        const card = useStageSettingsStore.getState();
        expect([card.stageTrackPillMode, card.stageTrackPillTimeoutSec, card.stageTrackPillOnHome]).toEqual(['always', 20, true]);
    });

    it('skips a card mode it does not know and a timeout that is not a number', () => {
        useStageSettingsStore.getState().handleSetStageTrackPillMode('never');
        useStageSettingsStore.getState().handleSetStageTrackPillTimeoutSec(12);

        applyImportedConfig(
            { stageTrackPillMode: 'sometimes', stageTrackPillTimeoutSec: 'soon' },
            ['stageTrackPillMode', 'stageTrackPillTimeoutSec'],
            controls(),
        );

        const card = useStageSettingsStore.getState();
        expect([card.stageTrackPillMode, card.stageTrackPillTimeoutSec]).toEqual(['never', 12]);
    });

    it('turns following the system theme on and off', () => {
        applyImportedConfig({ followSystemTheme: true }, ['followSystemTheme'], controls());
        expect(useThemeSettingsStore.getState().followSystemTheme).toBe(true);

        applyImportedConfig({ followSystemTheme: false }, ['followSystemTheme'], controls());
        expect(useThemeSettingsStore.getState().followSystemTheme).toBe(false);
    });

    it('writes numbering only the playing song to the tile wall store, and only when picked', () => {
        onTestFinished(() => useLatticeSettingsStore.getState().handleToggleLatticeBadgeCurrentOnly(false));
        applyImportedConfig({ latticeBadgeCurrentOnly: true }, ['latticeBadgeCurrentOnly'], controls());
        expect(useLatticeSettingsStore.getState().latticeBadgeCurrentOnly).toBe(true);

        applyImportedConfig({ latticeBadgeCurrentOnly: false }, [], controls());
        expect(useLatticeSettingsStore.getState().latticeBadgeCurrentOnly).toBe(true);

        applyImportedConfig({ latticeBadgeCurrentOnly: false }, ['latticeBadgeCurrentOnly'], controls());
        expect(useLatticeSettingsStore.getState().latticeBadgeCurrentOnly).toBe(false);
    });

    it('takes the picked side of an incoming theme and keeps the saved other side', () => {
        const saved = dual('saved');
        const incoming = dual('incoming');
        const theme = controls({ customTheme: saved });

        applyImportedConfig({ theme: incoming }, [THEME_DARK_KEY], theme);

        expect(theme.onSaveCustomTheme).toHaveBeenCalledWith({ light: saved.light, dark: incoming.dark });
        expect(theme.onApplyCustomTheme).not.toHaveBeenCalled();
    });

    it('only switches to the custom theme when no side is to be saved', () => {
        const theme = controls({ customTheme: dual('saved') });

        applyImportedConfig({ theme: dual('saved') }, [ACTIVATE_CUSTOM_THEME_KEY], theme);

        expect(theme.onApplyCustomTheme).toHaveBeenCalledTimes(1);
        expect(theme.onSaveCustomTheme).not.toHaveBeenCalled();
    });

    it('hands the song theme switches to the app shell, and no source it does not know', () => {
        const theme = controls();

        applyImportedConfig(
            { songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: true, themeGenerationSource: 'somewhere' },
            ['songThemeAutoSwitchEnabled', 'songThemeAutoGenerateEnabled', 'themeGenerationSource'],
            theme,
        );

        expect(theme.onToggleSongThemeAutoSwitch).toHaveBeenCalledWith(false);
        expect(theme.onToggleSongThemeAutoGenerate).toHaveBeenCalledWith(true);
        expect(theme.onChangeThemeGenerationSource).not.toHaveBeenCalled();

        applyImportedConfig({ themeGenerationSource: 'cover' }, ['themeGenerationSource'], theme);
        expect(theme.onChangeThemeGenerationSource).toHaveBeenCalledWith('cover');
    });
});

describe('buildCurrentConfig', () => {
    it('carries the chosen theme, or none, and the two song theme switches', () => {
        const theme = controls({ aiTheme: dual('ai'), customTheme: dual('custom'), songThemeAutoGenerateEnabled: true });

        expect(buildCurrentConfig(theme, 'ai').theme).toBe(theme.aiTheme);
        expect(buildCurrentConfig(theme, 'custom').theme).toBe(theme.customTheme);
        const bare = buildCurrentConfig(theme, 'none');
        expect(bare.theme).toBeNull();
        expect([bare.songThemeAutoSwitchEnabled, bare.songThemeAutoGenerateEnabled]).toEqual([true, true]);
    });
});
