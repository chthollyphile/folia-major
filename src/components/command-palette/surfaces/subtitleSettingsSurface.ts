import type { CommandPaletteSurface } from './types';

// src/components/command-palette/surfaces/subtitleSettingsSurface.ts
// Declares the subtitle command's panel: the bottom subtitle's rows and what each one shows, plus the
// 副字幕 of the lyric styles that lay it out themselves.

export const subtitleSettingsSurface: CommandPaletteSurface = {
    // Every switch here changes subtitles drawn behind the palette; a blurred backdrop would hide them.
    backdrop: 'clear',
    // The bottom subtitle sits just above the player bar; grown out of the bar the panel would cover it.
    keepsClearOfPlayerBar: true,
    load: () => import('./SubtitleSettingsSurfaceView'),
    mapProps: ({ isDaylight, theme }) => ({ isDaylight, theme }),
};
