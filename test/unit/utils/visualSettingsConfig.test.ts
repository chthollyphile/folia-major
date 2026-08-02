import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/utils/visualSettingsConfig.test.ts
// A copied OBS URL doubles as a restore payload (the import box accepts one), so the song-theme
// automation flags have to survive the copy -> paste-back round trip. Auto-generate is also pinned
// to never outlive auto-switch, matching how useThemeController composes the pair at mount.

vi.mock('@/services/themePreferences', () => ({
    readStoredThemeAutoSwitchEnabled: vi.fn(),
    readStoredThemeAutoGenerateEnabled: vi.fn(),
}));

import { buildVisualSettingsConfig } from '@/utils/visualSettingsConfig';
import { readStoredThemeAutoGenerateEnabled, readStoredThemeAutoSwitchEnabled } from '@/services/themePreferences';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { extractCfgFromInput } from '@/utils/obsUrl';
import { DEFAULT_SONNET_TUNING } from '@/types';
import { useSettingsUiStore } from '@/stores/useSettingsUiStore';

const switchMock = vi.mocked(readStoredThemeAutoSwitchEnabled);
const generateMock = vi.mocked(readStoredThemeAutoGenerateEnabled);

// A copied OBS URL, shaped as buildObsSourceUrl emits it (cfg is the terminal segment).
const asObsUrl = (cfg: string) =>
    `https://folia.example/?obs=1&obsSource=now-playing&${new URLSearchParams({ cfg }).toString()}`;

describe('buildVisualSettingsConfig', () => {
    beforeEach(() => {
        switchMock.mockReset().mockReturnValue(true);
        generateMock.mockReset().mockReturnValue(false);
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

    it('carries Sonnet visibility tuning and round-trips it through a copied OBS URL', () => {
        const sonnetTuning = {
            ...DEFAULT_SONNET_TUNING,
            showOnlyText: true,
            showGuide: false,
            showFixedGeo: false,
            showBackgroundDecor: false,
            textureResolution: 1.75,
        };
        useSettingsUiStore.setState({ sonnetTuning });

        expect(buildVisualSettingsConfig()).toMatchObject({ sonnetTuning });
        const restored = decompressConfig(extractCfgFromInput(asObsUrl(compressConfig(buildVisualSettingsConfig()))));
        expect(restored.sonnetTuning).toEqual(sonnetTuning);
    });
});
