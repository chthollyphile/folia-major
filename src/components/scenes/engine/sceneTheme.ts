import type { DualTheme, Theme } from '../../../types';
import type { VisualizerSharedProps } from '../../visualizer/definition';
import type { SceneSurfaceTone } from '../definition';

// src/components/scenes/engine/sceneTheme.ts
// 场景拿到的歌曲颜色：歌曲的一对亮、暗主题（useThemeController 的 songThemePair），app 的亮暗模式不参与挑选（场景的灯光属于场景自己）。
// 借到表面上的东西：贴着用户的背景时就是用户的播放页原样；只贴歌词时按表面画面的明暗给对应的那一个。

/** The song's pair with the user's lyric fonts from `shown` (the visualizer's theme carries them). */
export const withLyricFonts = (pair: DualTheme, shown: Theme): DualTheme => {
    const fonts = { fontStyle: shown.fontStyle, fontWeight: shown.fontWeight, fontFamily: shown.fontFamily, fontFamilyStack: shown.fontFamilyStack };
    return { light: { ...pair.light, ...fonts }, dark: { ...pair.dark, ...fonts } };
};

type RendererTheme = Pick<VisualizerSharedProps, 'theme' | 'subtitleTheme' | 'isDaylight'>;

/**
 * The theme a borrowed renderer on a surface draws with. With the user's background on it, the user's
 * page as it is; with only the lyrics over the scene's own picture, the song's variant for the picture's
 * tone, whatever the app's mode. A surface that declares no tone keeps the user's page.
 */
export const surfaceRendererTheme = (
    props: RendererTheme,
    song: { theme: DualTheme; subtitleTheme?: DualTheme },
    surface: { background: boolean; tone?: SceneSurfaceTone },
): RendererTheme => {
    if (surface.background || !surface.tone) return { theme: props.theme, subtitleTheme: props.subtitleTheme, isDaylight: props.isDaylight };
    return { theme: song.theme[surface.tone], subtitleTheme: song.subtitleTheme?.[surface.tone], isDaylight: surface.tone === 'light' };
};
