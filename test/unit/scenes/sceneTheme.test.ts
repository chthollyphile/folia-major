import { describe, expect, it } from 'vitest';
import { checkSceneManifest } from '../../../src/components/scenes/definition';
import cinema from '../../../src/components/scenes/cinema/entry';
import { songThemePair, surfaceRendererTheme, type SongThemeSource } from '../../../src/components/scenes/engine/sceneTheme';
import { resolveBgModeTheme } from '../../../src/hooks/themeControllerState';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../../src/services/baseThemes';
import type { DualTheme, Theme } from '../../../src/types';

const theme = (name: string, accentColor: string, backgroundColor: string): Theme => ({
    name, backgroundColor, primaryColor: '#111111', accentColor, secondaryColor: '#222222', fontStyle: 'sans', animationIntensity: 'normal',
});
const AI: DualTheme = { light: theme('ai light', '#ff0000', '#ffffff'), dark: theme('ai dark', '#00ff00', '#000000') };
const CUSTOM: DualTheme = { light: theme('custom light', '#0000ff', '#eeeeee'), dark: theme('custom dark', '#ffff00', '#101010') };
const FONTS: Pick<Theme, 'fontStyle' | 'fontFamily' | 'fontWeight' | 'fontFamilyStack'> = { fontStyle: 'serif', fontFamily: 'Lyric Font', fontWeight: 600, fontFamilyStack: ['Lyric Font'] };

/** The theme the app shows in a mode, as the theme controller resolves it, with the user's lyric fonts on it. */
const appTheme = (source: SongThemeSource, isDaylight: boolean): Theme => ({
    ...(source.bgMode === 'custom' && source.customTheme
        ? (isDaylight ? source.customTheme.light : source.customTheme.dark)
        : resolveBgModeTheme({ mode: source.bgMode === 'ai' ? 'ai' : 'default', aiTheme: source.aiTheme, isDaylight, defaultTheme: DEFAULT_THEME, daylightTheme: DAYLIGHT_THEME, previousTheme: DEFAULT_THEME })),
    ...FONTS,
});

const SOURCES: [string, SongThemeSource][] = [
    ['default', { bgMode: 'default', aiTheme: null, customTheme: null }],
    ['default with an AI theme', { bgMode: 'default', aiTheme: AI, customTheme: null }],
    ['ai', { bgMode: 'ai', aiTheme: AI, customTheme: null }],
    ['custom', { bgMode: 'custom', aiTheme: AI, customTheme: CUSTOM }],
];

describe("the scene's song colours", () => {
    it.each(SOURCES)('are the same pair in light and dark mode (%s)', (_, source) => {
        const inLight = songThemePair(source, appTheme(source, true));
        const inDark = songThemePair(source, appTheme(source, false));
        expect(inLight).toEqual(inDark);
        expect(inDark.dark.accentColor).toBe(appTheme(source, false).accentColor);
        expect(inDark.light.accentColor).toBe(appTheme(source, true).accentColor);
        expect(inDark.dark.fontFamily).toBe('Lyric Font');
    });
});

describe("a borrowed renderer's theme", () => {
    const source = SOURCES[2][1];
    const pageIn = (isDaylight: boolean) => ({ theme: appTheme(source, isDaylight), subtitleTheme: appTheme(source, isDaylight), isDaylight });
    const song = { theme: songThemePair(source, appTheme(source, true)), subtitleTheme: songThemePair(source, appTheme(source, true)) };

    it('on a dark surface with only the lyrics, does not change with the app mode', () => {
        const inLight = surfaceRendererTheme(pageIn(true), song, { background: false, tone: 'dark' });
        const inDark = surfaceRendererTheme(pageIn(false), song, { background: false, tone: 'dark' });
        expect(inLight).toEqual(inDark);
        expect(inLight).toEqual({ theme: song.theme.dark, subtitleTheme: song.subtitleTheme.dark, isDaylight: false });
        expect(surfaceRendererTheme(pageIn(false), song, { background: false, tone: 'light' }).isDaylight).toBe(true);
    });

    it("on a surface with the user's background, is the user's page as it is", () => {
        expect(surfaceRendererTheme(pageIn(true), song, { background: true, tone: 'dark' })).toEqual(pageIn(true));
        expect(surfaceRendererTheme(pageIn(false), song, { background: true, tone: 'dark' })).toEqual(pageIn(false));
    });
});

describe('surface tone in the manifest', () => {
    it("the hall's screen is dark, and a tone other than dark or light is refused", () => {
        expect(cinema.manifest.surfaces?.[0].tone).toBe('dark');
        expect(checkSceneManifest(cinema.manifest)).toEqual([]);
        const bad = { ...cinema.manifest, surfaces: [{ id: 'screen', aspect: 2, tone: 'grey' }] };
        expect(checkSceneManifest(bad)).toEqual([`surface "screen" tone is not 'dark' or 'light'`]);
    });
});
