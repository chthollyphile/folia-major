import type { CommandPaletteSurface, CommandSurfaceRenderArgs } from './types';

// src/components/command-palette/surfaces/modsSurface.ts
// Declares the mods command's panel takeover: the full mod manager UI. It only
// needs the theme for its accents — the runtime snapshot mods read is
// published by the always-on Folium host bridge (src/mods/folium/hostBridge.ts),
// not by this view. The view is lazily loaded to keep the palette registry a
// pure-TS module.

const buildViewProps = ({ theme }: CommandSurfaceRenderArgs) => ({ theme });

export const modsSurface: CommandPaletteSurface = {
    load: () => import('../../../mods/ModsPanelTab'),
    mapProps: buildViewProps,
};