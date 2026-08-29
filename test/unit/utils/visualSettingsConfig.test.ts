import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/utils/visualSettingsConfig.test.ts
// A copied OBS URL doubles as a restore payload (the import box accepts one), so the song-theme
// automation flags have to survive the copy -> paste-back round trip. Auto-generate is also pinned
// to never outlive auto-switch, matching how useThemeController composes the pair at mount.

vi.mock('@/services/themePreferences', () => ({
    readStoredThemeAutoSwitchEnabled: vi.fn(),
    readStoredThemeAutoGenerateEnabled: vi.fn(),
    readStoredThemeGenerationSource: vi.fn(),
}));

import { buildVisualSettingsConfig } from '@/utils/visualSettingsConfig';
import { readStoredThemeAutoGenerateEnabled, readStoredThemeAutoSwitchEnabled, readStoredThemeGenerationSource } from '@/services/themePreferences';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { extractCfgFromInput } from '@/utils/obsUrl';
import { DEFAULT_SONNET_TUNING } from '@/types';
import { useSettingsUiStore } from '@/stores/useSettingsUiStore';

const switchMock = vi.mocked(readStoredThemeAutoSwitchEnabled);
const generateMock = vi.mocked(readStoredThemeAutoGenerateEnabled);
const generationSourceMock = vi.mocked(readStoredThemeGenerationSource);

// A copied OBS URL, shaped as buildObsSourceUrl emits it (cfg is the terminal segment).
const asObsUrl = (cfg: string) =>
    `https://folia.example/?obs=1&obsSource=now-playing&${new URLSearchParams({ cfg }).toString()}`;

describe('buildVisualSettingsConfig', () => {
    beforeEach(() => {
        switchMock.mockReset().mockReturnValue(true);
        generationSourceMock.mockReset().mockReturnValue('ai');
        generateMock.mockReset().mockReturnValue(false);
        useSettingsUiStore.setState({ followSystemTheme: false, isDaylight: false });
    });

    it('carries the system theme preference and keeps manual daylight changes authoritative', () => {
        useSettingsUiStore.setState({ followSystemTheme: true, isDaylight: false });
        expect(buildVisualSettingsConfig().followSystemTheme).toBe(true);

        const restored = decompressConfig(compressConfig(buildVisualSettingsConfig()));
        expect(restored.followSystemTheme).toBe(true);

        useSettingsUiStore.getState().setDaylightPreference(true);
        expect(useSettingsUiStore.getState()).toMatchObject({
            followSystemTheme: false,
            isDaylight: true,
        });
    });

    it('carries the song-theme automation flags', () => {
        generateMock.mockReturnValue(true);
        expect(buildVisualSettingsConfig()).toMatchObject({
            songThemeAutoSwitchEnabled: true,
            songThemeAutoGenerateEnabled: true,
        });
    });

    it('never reports auto-generate on while auto-switch is off', () => {
        switchMock.mockReturnValue(false);
        generateMock.mockReturnValue(true);
        expect(buildVisualSettingsConfig()).toMatchObject({
            songThemeAutoSwitchEnabled: false,
            songThemeAutoGenerateEnabled: false,
        });
    });

    it('round-trips both flags through a copied OBS URL', () => {
        generateMock.mockReturnValue(true);
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored.songThemeAutoSwitchEnabled).toBe(true);
        expect(restored.songThemeAutoGenerateEnabled).toBe(true);
    });

    it('round-trips the flags when both are off', () => {
        switchMock.mockReturnValue(false);
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored.songThemeAutoSwitchEnabled).toBe(false);
        expect(restored.songThemeAutoGenerateEnabled).toBe(false);
    });

    // The codec, the OBS overlay and the import path already handle the custom font weights; this
    // table was the one place they were missing, so a copied link and the OBS overlay used to fall
    // back to the mode's default weight regardless of the setting.
    it('carries the custom font weights and round-trips them through a copied OBS URL', () => {
        useSettingsUiStore.setState({ lyricsFontWeight: 700, subtitleFontWeight: 300 });
        const config = buildVisualSettingsConfig();
        expect(config).toMatchObject({ lyricsFontWeight: 700, subtitleFontWeight: 300 });
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));
        expect(restored.lyricsFontWeight).toBe(700);
        expect(restored.subtitleFontWeight).toBe(300);
    });

    // null means "use the mode default"; it has to survive the round trip so a config that overrides
    // no weight can reset one that does, rather than being read as "no weight was carried".
    it('round-trips a null weight as the mode default', () => {
        useSettingsUiStore.setState({ lyricsFontWeight: null, subtitleFontWeight: null });
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored.lyricsFontWeight).toBeNull();
        expect(restored.subtitleFontWeight).toBeNull();
    });

    // Structural guard, not a field list. The recurring bug is a setting reaching this table but not
    // the codec: the value then rides nowhere, and both the copied OBS link and the import box lose it
    // silently — which is exactly how subtitleOverlayOpacity, staticMode and the three background
    // toggles went missing. Asserting key survival rather than deep equality keeps it honest about the
    // tunings, whose own compressors are deliberately lossy.
    it('round-trips every field it emits through the codec', () => {
        const config = buildVisualSettingsConfig();
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));

        // The codec truthy-guards these to save URL bytes, so an empty value means "nothing set" and
        // is legitimately absent after the trip. Any other field must come back.
        const droppedWhenEmpty = (value: unknown) =>
            value === null || value === undefined || (Array.isArray(value) && value.length === 0);

        const lost = Object.keys(config).filter(key => (
            !droppedWhenEmpty(config[key]) && restored[key] === undefined
        ));
        expect(lost).toEqual([]);
    });

    // The five fields that were missing. Booleans and a number, so a regression here reads as a real
    // absence rather than as an empty value the codec is allowed to drop.
    it('carries the background toggles, static mode and the subtitle overlay opacity', () => {
        useSettingsUiStore.setState({
            useCoverColorBg: true,
            disableVisualizerGeometricBackground: true,
            disableVisualizerVignette: true,
            staticMode: true,
            subtitleOverlayOpacity: 0.45,
        });

        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored).toMatchObject({
            useCoverColorBg: true,
            disableVisualizerGeometricBackground: true,
            disableVisualizerVignette: true,
            staticMode: true,
            subtitleOverlayOpacity: 0.45,
        });
    });

    it('carries Sonnet visibility tuning and round-trips it through a copied OBS URL', () => {
        const sonnetTuning = {
            ...DEFAULT_SONNET_TUNING,
            showOnlyText: true,
            showGuide: false,
            showFixedGeo: false,
            showBackgroundDecor: false,
            textureResolution: 1.75,
            postProcessLensDistortion: 0.65,
            postProcessLensDispersion: 0.45,
        };
        useSettingsUiStore.setState({ sonnetTuning });

        expect(buildVisualSettingsConfig()).toMatchObject({ sonnetTuning });
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored.sonnetTuning).toEqual(sonnetTuning);
    });

    it('carries the theme generation source through compress and decompress', () => {
        generationSourceMock.mockReturnValue('cover');

        const config = buildVisualSettingsConfig();
        expect(config.themeGenerationSource).toBe('cover');

        const restored = decompressConfig(compressConfig(config));
        expect(restored.themeGenerationSource).toBe('cover');
    });

    // All three legs of the now playing card together. Changing any of them only wrote localStorage,
    // so a copied configuration omitted them and an import could not restore them. 'never' and false
    // are the interesting values: a truthy-only guard anywhere along the way drops them, and the
    // failure looks like "the card came back" rather than like a lost setting.
    it('carries the now playing card settings and round-trips them through a copied OBS URL', () => {
        useSettingsUiStore.setState({
            stageTrackPillMode: 'always',
            stageTrackPillTimeoutSec: 24,
            stageTrackPillOnHome: true,
        });

        const config = buildVisualSettingsConfig();
        expect(config).toMatchObject({
            stageTrackPillMode: 'always',
            stageTrackPillTimeoutSec: 24,
            stageTrackPillOnHome: true,
        });

        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));
        expect(restored).toMatchObject({
            stageTrackPillMode: 'always',
            stageTrackPillTimeoutSec: 24,
            stageTrackPillOnHome: true,
        });
    });

    it('round-trips a card that is turned off and kept off the home page', () => {
        useSettingsUiStore.setState({ stageTrackPillMode: 'never', stageTrackPillOnHome: false });

        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored.stageTrackPillMode).toBe('never');
        expect(restored.stageTrackPillOnHome).toBe(false);
    });

    // A hand-written JSON carrying only the card has to be recognised as the minified shape; the
    // long-name branch would reject all three as invalid keys.
    it('decodes a minified config that carries only the card', () => {
        expect(decompressConfig(JSON.stringify({ stp: 'always', stpt: 12, stph: true }))).toMatchObject({
            stageTrackPillMode: 'always',
            stageTrackPillTimeoutSec: 12,
            stageTrackPillOnHome: true,
        });
    });
});
