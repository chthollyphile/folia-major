import type { VisPlaygroundEditSection } from './VisPlaygroundPreviewHotspots';

// src/components/visualizer/window/visPlaygroundSections.ts
// The pages of the lyric style window, in tab order, and their names. Shared by the window's tabs
// and the settings search, which lists each page as a place to land.

export const VIS_PLAYGROUND_SECTIONS: VisPlaygroundEditSection[] = ['visualizer', 'background', 'common', 'subtitle', 'global'];

export const VIS_PLAYGROUND_SECTION_LABEL_KEYS: Record<VisPlaygroundEditSection, string> = {
    visualizer: 'options.previewVisualizerSettings',
    background: 'options.previewBackgroundSettings',
    common: 'options.previewCommonSettings',
    subtitle: 'options.previewSubtitleSettings',
    global: 'options.previewGlobalSettings',
};
