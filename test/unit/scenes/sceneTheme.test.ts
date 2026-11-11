import { describe, expect, it } from 'vitest';
import { checkSceneManifest } from '../../../src/components/scenes/definition';
import cinema from '../../../src/components/scenes/cinema/entry';
import { surfaceRendererTheme, withLyricFonts } from '../../../src/components/scenes/engine/sceneTheme';
import { resolveControllerTheme } from '../../../src/hooks/useThemeController';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../../src/services/baseThemes';
import type { DualTheme, Theme, ThemeMode } from '../../../src/types';

const theme = (name: string, accentColor: string, backgroundColor: string): Theme => ({
    name, backgroundColor, primaryColor: '#111111', accentColor, secondaryColor: '#222222', fontStyle: 'sans', animationIntensity: 'normal',
});
const AI: DualTheme = { light: theme('ai light', '#ff0000', '#ffffff'), dark: theme('ai dark', '#00ff00', '#000000') };
const CUSTOM: DualTheme = { light: theme('custom light', '#0000ff', '#eeeeee'), dark: theme('custom dark', '#ffff00', '#101010') };
const LEGACY = theme('legacy', '#ff00ff', '#202020');
const FONTS: Pick<Theme, 'fontStyle' | 'fontFamily' | 'fontWeight' | 'fontFamilyStack'> = { fontStyle: 'serif', fontFamily: 'Lyric Font', fontWeight: 600, fontFamilyStack: ['Lyric Font'] };

type Sources = { bgMode: ThemeMode; aiTheme: DualTheme | null; legacyTheme: Theme | null; customTheme: DualTheme | null };
const resolve = (sources: Sources, isDaylight: boolean) => resolveControllerTheme({
    ...sources, isDaylight, defaultTheme: DEFAULT_THEME, daylightTheme: DAYLIGHT_THEME, previousTheme: DEFAULT_THEME,
});
/** The pair as useThemeController builds it: the theme the app shows in each mode. */
const pairOf = (sources: Sources): DualTheme => ({ light: resolve(sources, true), dark: resolve(sources, false) });

const SOURCES: [string, Sources][] = [
    ['default', { bgMode: 'default', aiTheme: null, legacyTheme: null, customTheme: null }],
    ['default with an AI theme', { bgMode: 'default', aiTheme: AI, legacyTheme: null, customTheme: null }],
    ['ai', { bgMode: 'ai', aiTheme: AI, legacyTheme: null, customTheme: null }],
    ['ai with a legacy theme', { bgMode: 'ai', aiTheme: null, legacyTheme: LEGACY, customTheme: null }],
    ['custom', { bgMode: 'custom', aiTheme: AI, legacyTheme: null, customTheme: CUSTOM }],
];

describe("the scene's song colours", () => {
    it.each(SOURCES)("are the controller's theme for each mode, with the lyric fonts (%s)", (_, sources) => {
        const pair = withLyricFonts(pairOf(sources), { ...DEFAULT_THEME, ...FONTS });
        expect(pair.dark.accentColor).toBe(resolve(sources, false).accentColor);
        expect(pair.light.accentColor).toBe(resolve(sources, true).accentColor);
        expect(pair.dark.fontFamily).toBe('Lyric Font');
        expect(pair.light.fontWeight).toBe(600);
    });

    it('carry a legacy theme on both halves', () => {
        const pair = pairOf(SOURCES[3][1]);
        expect(pair.light.accentColor).toBe(LEGACY.accentColor);
        expect(pair.dark.accentColor).toBe(LEGACY.accentColor);
    });
});

describe("a borrowed renderer's theme", () => {
    const sources = SOURCES[2][1];
    const pageIn = (isDaylight: boolean) => ({ theme: resolve(sources, isDaylight), subtitleTheme: resolve(sources, isDaylight), isDaylight });
    const song = { theme: pairOf(sources), subtitleTheme: pairOf(sources) };

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
    it("the hall's manifest passes, and a tone other than dark or light is refused", () => {
        expect(checkSceneManifest(cinema.manifest)).toEqual([]);
        const bad = { ...cinema.manifest, surfaces: [{ id: 'screen', aspect: 2, tone: 'grey' }] };
        expect(checkSceneManifest(bad)).toEqual([`surface "screen" tone is not 'dark' or 'light'`]);
    });
});
