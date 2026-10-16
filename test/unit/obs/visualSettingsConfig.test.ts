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

import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { readStoredThemeAutoGenerateEnabled, readStoredThemeAutoSwitchEnabled, readStoredThemeGenerationSource } from '@/services/themePreferences';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { extractCfgFromInput } from '@/utils/obsUrl';
import { DEFAULT_SONNET_TUNING } from '@/types';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { useTypographySettingsStore } from '@/stores/useTypographySettingsStore';
import { useThemeSettingsStore } from '@/stores/useThemeSettingsStore';
import { useStageSettingsStore } from '@/stores/useStageSettingsStore';
import { useLibraryWallLookStore } from '@/stores/useLibraryWallLookStore';

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
        useThemeSettingsStore.setState({ followSystemTheme: false, isDaylight: false });
    });

    it('carries the system theme preference and keeps manual daylight changes authoritative', () => {
        useThemeSettingsStore.setState({ followSystemTheme: true, isDaylight: false });
        expect(buildVisualSettingsConfig().followSystemTheme).toBe(true);

        const restored = decompressConfig(compressConfig(buildVisualSettingsConfig()));
        expect(restored.followSystemTheme).toBe(true);

        useThemeSettingsStore.getState().setDaylightPreference(true);
        expect(useThemeSettingsStore.getState()).toMatchObject({
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

    it.each([true, false])('carries randomization scope %s through a copied OBS URL', randomizeAllEnabled => {
        useVisualizerSettingsStore.setState({ randomizeAllEnabled });
        const config = buildVisualSettingsConfig();
        expect(config.randomizeAllEnabled).toBe(randomizeAllEnabled);
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));
        expect(restored.randomizeAllEnabled).toBe(randomizeAllEnabled);
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
        useTypographySettingsStore.setState({ lyricsFontWeight: 700, subtitleFontWeight: 300 });
        const config = buildVisualSettingsConfig();
        expect(config).toMatchObject({ lyricsFontWeight: 700, subtitleFontWeight: 300 });
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));
        expect(restored.lyricsFontWeight).toBe(700);
        expect(restored.subtitleFontWeight).toBe(300);
    });

    // null means "use the mode default"; it has to survive the round trip so a config that overrides
    // no weight can reset one that does, rather than being read as "no weight was carried".
    it('round-trips a null weight as the mode default', () => {
        useTypographySettingsStore.setState({ lyricsFontWeight: null, subtitleFontWeight: null });
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

    // These scalar fields are booleans and a number, so a regression here reads as a real
    // absence rather than as an empty value the codec is allowed to drop.
    it('carries background toggles, static mode and subtitle overlay treatment', () => {
        useVisualizerSettingsStore.setState({
            disableVisualizerGeometricBackground: true,
            disableVisualizerVignette: true,
        });
        useThemeSettingsStore.setState({ useCoverColorBg: true, staticMode: true });
        useTypographySettingsStore.setState({ subtitleOverlayOpacity: 0.45, subtitleUpcomingLyricsBlur: false });

        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored).toMatchObject({
            useCoverColorBg: true,
            disableVisualizerGeometricBackground: true,
            disableVisualizerVignette: true,
            staticMode: true,
            subtitleOverlayOpacity: 0.45,
            subtitleUpcomingLyricsBlur: false,
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
        useVisualizerSettingsStore.setState({ sonnetTuning });

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
        useStageSettingsStore.setState({ stageTrackPillMode: 'always', stageTrackPillTimeoutSec: 24, stageTrackPillOnHome: true });

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
        useStageSettingsStore.setState({ stageTrackPillMode: 'never', stageTrackPillOnHome: false });

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

    // The bravais wall's collection stack edges travel with a shared look (a tile look with no user
    // exception); the wall's transparency and windows per block deliberately do not.
    it('carries the collection stack edges but not the wall transparency', () => {
        useLibraryWallLookStore.setState({ collectionStackEdges: false, look: 'clear', windowsPerBlock: 5 });

        const config = buildVisualSettingsConfig();
        expect(config.libraryWallStackEdges).toBe(false);
        expect(config).not.toHaveProperty('look');
        expect(config).not.toHaveProperty('windowsPerBlock');
        expect(config).not.toHaveProperty('libraryWallLook');

        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));
        expect(restored.libraryWallStackEdges).toBe(false);
        expect(decompressConfig(JSON.stringify({ lwse: true }))).toMatchObject({ libraryWallStackEdges: true });
        expect(decompressConfig(JSON.stringify({ libraryWallStackEdges: false }))).toMatchObject({ libraryWallStackEdges: false });
        useLibraryWallLookStore.setState({ collectionStackEdges: true, look: 'solid', windowsPerBlock: 3 });
    });

    // 2026-10-09: the info strip's material and the picture behind the wall are visual settings with no
    // user exception, so they travel too (short codes lwsc / lwss / lwbl / lwbb).
    it('carries the info strip material and the backdrop lyrics / blur', () => {
        useLibraryWallLookStore.setState({ seamClear: true, seamStyle: 'contour', backdropLyrics: true, backdropBlur: true });

        const config = buildVisualSettingsConfig();
        expect(config).toMatchObject({
            libraryWallSeamClear: true,
            libraryWallSeamStyle: 'contour',
            libraryWallBackdropLyrics: true,
            libraryWallBackdropBlur: true,
        });

        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(config))));
        expect(restored).toMatchObject({
            libraryWallSeamClear: true,
            libraryWallSeamStyle: 'contour',
            libraryWallBackdropLyrics: true,
            libraryWallBackdropBlur: true,
        });
        // A hand-written minified config carrying only these is recognised as the minified shape.
        expect(decompressConfig(JSON.stringify({ lwss: 'white' }))).toMatchObject({ libraryWallSeamStyle: 'white' });
        expect(decompressConfig(JSON.stringify({ lwsc: false, lwbl: false, lwbb: true }))).toMatchObject({
            libraryWallSeamClear: false,
            libraryWallBackdropLyrics: false,
            libraryWallBackdropBlur: true,
        });
        expect(decompressConfig(JSON.stringify({ libraryWallSeamStyle: 'hatch' }))).toMatchObject({ libraryWallSeamStyle: 'hatch' });
        useLibraryWallLookStore.setState({ seamClear: false, seamStyle: 'paper', backdropLyrics: false, backdropBlur: false });
    });
});
