import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/obs/currentObsUrl.test.ts
// What the copy-OBS-URL builder bakes into cfg per theme mode. Headline invariant: "static" always
// carries a theme, falling back to the built-in preset — a theme-less cfg is exactly what the
// overlay reads as "resolve per song", so a static link without one would silently animate.

vi.mock('@/utils/appearanceCodec', () => ({
    compressConfig: vi.fn(() => 'folia-theme://x'),
    readSavedCustomTheme: vi.fn(),
}));
vi.mock('@/services/themePreferences', () => ({
    readStoredLastAppliedThemePointer: vi.fn(),
    // Stand in for the real helper so the base-preset fallback's intensity pass is observable.
    applyStoredAnimationIntensityToDualTheme: vi.fn((dual: any) => ({
        light: { ...dual.light, animationIntensity: 'calm' },
        dark: { ...dual.dark, animationIntensity: 'calm' },
    })),
}));
vi.mock('@/services/themeCache', () => ({ getLastDualTheme: vi.fn() }));
vi.mock('@/services/obs/visualSettingsConfig', () => ({ buildVisualSettingsConfig: () => ({ visualizerMode: 'monet' }) }));

import { buildCurrentObsUrl } from '@/services/obs/currentObsUrl';
import { compressConfig, readSavedCustomTheme } from '@/utils/appearanceCodec';
import { readStoredLastAppliedThemePointer } from '@/services/themePreferences';
import { getLastDualTheme } from '@/services/themeCache';
import { usePlayerChromeSettingsStore } from '@/stores/usePlayerChromeSettingsStore';
import { useThemeSettingsStore } from '@/stores/useThemeSettingsStore';
import { useStageSettingsStore } from '@/stores/useStageSettingsStore';

const compressMock = vi.mocked(compressConfig);
const pointerMock = vi.mocked(readStoredLastAppliedThemePointer);
const customMock = vi.mocked(readSavedCustomTheme);
const aiMock = vi.mocked(getLastDualTheme);

const CUSTOM = { light: { name: 'custom-l' }, dark: { name: 'custom-d' } } as never;

// The config handed to compressConfig is the cfg payload, so its theme is what the link burns in.
const bakedTheme = () => (compressMock.mock.calls.at(-1)?.[0] as any).theme;

describe('buildCurrentObsUrl', () => {
    beforeEach(() => {
        compressMock.mockClear();
        pointerMock.mockReset().mockReturnValue('default');
        customMock.mockReset().mockReturnValue(undefined);
        aiMock.mockReset().mockResolvedValue(null);
        useStageSettingsStore.setState({ webObsThemeMode: 'static' });
        useThemeSettingsStore.setState({ isDaylight: false });
        usePlayerChromeSettingsStore.setState({ transparentPlayerBackground: false });
    });

    it('bakes the applied custom theme in static mode', async () => {
        pointerMock.mockReturnValue('custom');
        customMock.mockReturnValue(CUSTOM);
        await buildCurrentObsUrl('now-playing');
        expect(bakedTheme()).toBe(CUSTOM);
    });

    // Names, not identity: if the base preset ever moves or is renamed, this fails loudly.
    it('falls back to the built-in preset when static has no applied theme', async () => {
        await buildCurrentObsUrl('now-playing');
        expect(bakedTheme().dark.name).toBe('Midnight Default');
        expect(bakedTheme().light.name).toBe('Daylight Default');
    });

    // The constant hardcodes 'normal'; the saved custom and cached AI themes already carry the
    // user's stored intensity, so the fallback has to pick it up too.
    it('applies the stored animation intensity to the base preset fallback', async () => {
        await buildCurrentObsUrl('now-playing');
        expect(bakedTheme().dark.animationIntensity).toBe('calm');
        expect(bakedTheme().light.animationIntensity).toBe('calm');
    });

    it('bakes no theme in the dynamic modes, even with one applied', async () => {
        pointerMock.mockReturnValue('custom');
        customMock.mockReturnValue(CUSTOM);
        for (const mode of ['builtin', 'ai'] as const) {
            useStageSettingsStore.setState({ webObsThemeMode: mode });
            await buildCurrentObsUrl('now-playing');
            expect(bakedTheme()).toBeNull();
        }
    });

    it('writes the theme mode marker and keeps cfg the terminal segment', async () => {
        useStageSettingsStore.setState({ webObsThemeMode: 'static' });
        useThemeSettingsStore.setState({ isDaylight: true });
        usePlayerChromeSettingsStore.setState({ transparentPlayerBackground: true });
        const url = await buildCurrentObsUrl('now-playing');
        expect(url).toContain('obsSource=now-playing');
        expect(url).toContain('daylight=1');
        expect(url).toContain('transparent=1');
        expect(url).toContain('obsTheme=static');
        expect(url.slice(url.indexOf('cfg=')).includes('&')).toBe(false);
    });

    it('marks the dynamic mode it was copied in', async () => {
        useStageSettingsStore.setState({ webObsThemeMode: 'ai' });
        expect(await buildCurrentObsUrl('now-playing')).toContain('obsTheme=ai');
    });

    // The two params are not symmetric: daylight is omitted when off, transparent is always stated
    // so an absent value can never be mistaken for the toggle being on.
    it('omits daylight when off but still states transparent=0', async () => {
        const url = await buildCurrentObsUrl('now-playing');
        expect(url).not.toContain('daylight=');
        expect(url).toContain('transparent=0');
    });
});
