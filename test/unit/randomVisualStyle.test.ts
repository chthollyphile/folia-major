import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomizeVisualStyle } from '@/components/visualizer/randomVisualStyle';
import { useDesktopSettingsStore } from '@/stores/useDesktopSettingsStore';
import { useMotionSettingsStore } from '@/stores/useMotionSettingsStore';
import { useThemeSettingsStore } from '@/stores/useThemeSettingsStore';
import { useTypographySettingsStore } from '@/stores/useTypographySettingsStore';
import { useVisualizerAssetStore } from '@/stores/useVisualizerAssetStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import * as persistence from '@/stores/visualizerSettingsPersistence';
import { BUILTIN_VISUALIZER_MODES } from '@/types/visualizerModes';
import { getRandomLyricsStyleCandidates } from '@/utils/randomLyricsStyle';
import { chooseVisualStyleValue } from '@/utils/randomVisualStyle';

// test/unit/randomVisualStyle.test.ts
// Verify persisted manual draws, scope isolation, safety preferences and retained user resources.

vi.mock('@/components/visualizer/registry', () => ({
    VISUALIZER_REGISTRY: ['classic', 'cadenza', 'partita', 'fume', 'cappella', 'tilt', 'claddagh', 'monet', 'diorama', 'pendolo', 'sonnet', 'tempera', 'lumiere', 'still'].map(mode => ({ mode })),
    getVisualizerModeLabel: (mode: string) => mode,
}));
vi.mock('@/components/visualizer/backgrounds/registry', () => ({
    VISUALIZER_BACKGROUND_REGISTRY: ['common', 'monet', 'nomand', 'latent', 'sora', 'url'].map(mode => ({ mode })),
}));
vi.mock('@/services/customLyricsFont', () => ({
    clearUploadedLyricsFont: vi.fn(), uploadAndRegisterLyricsFont: vi.fn(),
}));

const values = new Map<string, string>();
const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const backgroundSettings = () => Object.fromEntries(Object.entries(useVisualizerSettingsStore.getState())
    .filter(([key, value]) => typeof value !== 'function' && (key.endsWith('BackgroundTuning')
        || ['visualizerBackgroundMode', 'visualizerOpacity', 'backgroundOpacity', 'disableVisualizerVignette',
            'disableVisualizerGeometricBackground', 'urlBackgroundList', 'urlBackgroundSelectedId', 'visualizerFrameRate'].includes(key))));
const subtitleSettings = () => Object.fromEntries(Object.entries(useTypographySettingsStore.getState())
    .filter(([key, value]) => typeof value !== 'function' && !key.startsWith('lyrics')));

beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    useVisualizerSettingsStore.setState(useVisualizerSettingsStore.getInitialState(), true);
    useTypographySettingsStore.setState(useTypographySettingsStore.getInitialState(), true);
    useThemeSettingsStore.setState(useThemeSettingsStore.getInitialState(), true);
    useVisualizerAssetStore.setState(useVisualizerAssetStore.getInitialState(), true);
    useMotionSettingsStore.setState(useMotionSettingsStore.getInitialState(), true);
    useDesktopSettingsStore.setState(useDesktopSettingsStore.getInitialState(), true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('manual random style', () => {
    it('defaults to lyrics scope and freezes the persisted legacy per-song switch', () => {
        useVisualizerSettingsStore.setState({ randomVisualizerModePerSong: true });
        const typography = useTypographySettingsStore.getState();
        const background = copy(backgroundSettings());
        const theme = useThemeSettingsStore.getState();
        randomizeVisualStyle({ random: () => 0 });
        const state = useVisualizerSettingsStore.getState();
        expect(state.visualizerMode).not.toBe('classic');
        expect(state.classicTuning.breathingFloatMultiplier).toBe(0.3);
        expect(state.randomVisualizerModePerSong).toBe(false);
        expect(values.get('random_visualizer_mode_per_song')).toBe('false');
        expect(values.get('visualizer_mode')).toBe(state.visualizerMode);
        expect(backgroundSettings()).toEqual(background);
        expect(useTypographySettingsStore.getState()).toBe(typography);
        expect(useThemeSettingsStore.getState()).toBe(theme);
    });

    it('all scope varies common appearance while preserving independent subtitle settings', () => {
        useTypographySettingsStore.setState({ subtitleContentMode: 'both', subtitleFontInheritsLyrics: false,
            subtitleFontFamily: 'Subtitle Font', subtitleFontWeight: 530, subtitleOverlayOpacity: 0.35,
            showHarmonySubtitle: false, hidePlayerTranslationSubtitle: true });
        const subtitles = subtitleSettings();
        randomizeVisualStyle({ scope: 'all', random: () => 0.999 });
        const state = useVisualizerSettingsStore.getState();
        expect(state.visualizerBackgroundMode).not.toBe('url');
        expect(state.visualizerOpacity).toBe(1);
        expect(useTypographySettingsStore.getState().lyricsFontStyle).toBe('mono');
        expect(useTypographySettingsStore.getState().lyricsFontScale).toBe(1.2);
        expect(useTypographySettingsStore.getState().lyricsFontWeight).toBe(700);
        expect(values.get('lyrics_font_scale')).toBe('1.2');
        expect(subtitleSettings()).toEqual(subtitles);
    });

    it('keeps uploaded fonts, URL entries, image blobs and Tempera image identities', async () => {
        const font = { source: 'uploaded' as const, family: 'My Font', fontId: 'font-a' };
        const image = { id: 'image-a', name: 'My image', mimeType: 'image/png', blob: new Blob(['image']) };
        const urls = [{ id: 'url-a', url: 'https://example.com/wall', note: 'My wall' }];
        useTypographySettingsStore.setState({ lyricsCustomFont: font, lyricsFontFallbackFamilies: ['Fallback'] });
        values.set('lyrics_custom_font', JSON.stringify(font));
        useVisualizerAssetStore.setState({ storedMonetBackgroundImage: image, storedMonetPortraitImage: image,
            storedCappellaEmojiPack: [image], storedCappellaAvatarPack: [image] });
        const assets = useVisualizerAssetStore.getState();
        const state = useVisualizerSettingsStore.getState();
        state.handleSetUrlBackgroundList(urls);
        state.handleSetTemperaTuning({ layerImages: [{ id: 'layer-a', name: 'My layer', align: 'free',
            verticalAlign: 'free', scale: 0.5, opacity: 0.7 }] });
        randomizeVisualStyle({ scope: 'all', random: () => 0.999 });
        const after = useVisualizerSettingsStore.getState();
        expect(after.visualizerBackgroundMode).toBe('url');
        expect(after.urlBackgroundList).toEqual(urls);
        expect(after.urlBackgroundSelectedId).toBe('url-a');
        expect(after.temperaTuning.layerImages.map(({ id, name }) => ({ id, name })))
            .toEqual([{ id: 'layer-a', name: 'My layer' }]);
        expect(after.monetTuning.portraitSource).toBe('custom');
        expect(after.monetBackgroundTuning.backgroundSource).toBe('uploaded-global');
        expect(after.cappellaTuning.emojiPackSource).toBe('custom');
        expect(after.cappellaTuning.avatarSource).toBe('custom');
        expect(useVisualizerAssetStore.getState()).toBe(assets);
        expect(useTypographySettingsStore.getState().lyricsCustomFont).toBe(font);
        expect(useTypographySettingsStore.getState().lyricsFontFallbackFamilies).toEqual(['Fallback']);
        expect(values.get('lyrics_custom_font')).toBe(JSON.stringify(font));
        expect((await import('@/services/customLyricsFont')).clearUploadedLyricsFont).not.toHaveBeenCalled();
    });

    it('never selects an absent custom image, emoji pack, avatar or URL background', () => {
        randomizeVisualStyle({ scope: 'all', random: () => 0.999 });
        const state = useVisualizerSettingsStore.getState();
        expect(state.monetTuning.portraitSource).toBe('cover');
        expect(state.monetBackgroundTuning.backgroundSource).toBe('cover-derived');
        expect(state.nomandBackgroundTuning.imageSource).toBe('cover-derived');
        expect(state.cappellaTuning.emojiPackSource).toBe('builtin');
        expect(state.cappellaTuning.avatarSource).not.toBe('custom');
        expect(state.visualizerBackgroundMode).not.toBe('url');
    });

    it.each([0, 0.5, 1, -1, Number.NaN])('persists values accepted by existing tuning readers for draw %s', (draw) => {
        randomizeVisualStyle({ scope: 'all', random: () => draw });
        const state = useVisualizerSettingsStore.getState();
        for (const [name, read] of Object.entries(persistence)) {
            if (!/^readStored.+Tuning$/.test(name)) continue;
            const tuningName = name.slice('readStored'.length, -'Tuning'.length);
            const key = `${tuningName[0].toLowerCase()}${tuningName.slice(1)}Tuning`;
            expect((read as () => unknown)(), name).toEqual(state[key as keyof typeof state]);
        }
        expect(state.partitaTuning.staggerMin).toBeLessThanOrEqual(state.partitaTuning.staggerMax);
        expect(Number.isInteger(state.dioramaTuning.particleDensity)).toBe(true);
        expect(state.cadenzaTuning.beamIntensity).toBe(0);
    });

    it('accepts a live preferred renderer and rejects it when motion preferences disallow it', () => {
        randomizeVisualStyle({ preferredMode: 'sonnet', random: () => 0.5 });
        expect(useVisualizerSettingsStore.getState().visualizerMode).toBe('sonnet');
        useMotionSettingsStore.getState().handleToggleReducedMotionSurface('uiMicroMotion', true);
        randomizeVisualStyle({ preferredMode: 'sonnet', random: () => 0.5 });
        expect(['still', 'classic', 'monet']).toContain(useVisualizerSettingsStore.getState().visualizerMode);
        useMotionSettingsStore.getState().handleToggleReducedMotionSurface('uiMicroMotion', false);
        useDesktopSettingsStore.setState({ wallpaperMode: true });
        randomizeVisualStyle({ preferredMode: 'sonnet', random: () => 0.5 });
        expect(['still', 'classic', 'monet', 'fume', 'partita', 'cappella'])
            .toContain(useVisualizerSettingsStore.getState().visualizerMode);
    });
});

describe('renderer candidates', () => {
    it('deduplicates live modes, avoids the current mode and retains the only safe option', () => {
        expect(getRandomLyricsStyleCandidates({ availableModes: ['classic', 'classic', 'tilt'], currentMode: 'classic' })).toEqual(['tilt']);
        expect(getRandomLyricsStyleCandidates({ availableModes: ['classic', 'tilt'], currentMode: 'classic', reducedMotion: true })).toEqual(['classic']);
        expect(getRandomLyricsStyleCandidates({ availableModes: ['tilt'], reducedMotion: true })).toEqual([]);
    });
    it('respects combined motion and wallpaper constraints', () => {
        expect(getRandomLyricsStyleCandidates({ availableModes: BUILTIN_VISUALIZER_MODES, wallpaperMode: true, reducedMotion: true }).sort())
            .toEqual(['classic', 'monet', 'still']);
    });
    it.each([-5, 1, 5, Number.NaN])('never indexes outside available candidates for draw %s', (draw) => {
        expect(['classic', 'tilt']).toContain(chooseVisualStyleValue(['classic', 'tilt'], () => draw));
    });
});
