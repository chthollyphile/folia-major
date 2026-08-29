import type { CommandPaletteSurface, CommandSurfaceRenderArgs } from './types';

// src/components/command-palette/surfaces/modsSurface.ts
// Declares the mods command's panel takeover: the full mod manager UI, handed the
// current song / theme / visualizer state so it can publish the runtime snapshot
// the export mods read. The view is lazily loaded to keep the palette registry a
// pure-TS module.

const buildViewProps = ({ context, theme }: CommandSurfaceRenderArgs) => ({
    currentSong: context.shared.currentSong,
    theme,
    visualizerMode: context.visualizer.visualizerMode,
    lyricData: context.shared.lyrics,
});

export const modsSurface: CommandPaletteSurface = {
    load: () => import('../../../mods/ModsPanelTab'),
    mapProps: buildViewProps,
};