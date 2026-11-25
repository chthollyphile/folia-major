import { VISUALIZER_REGISTRY } from '../../../visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY } from '../../../visualizer/backgrounds/registry';
import { VIS_PLAYGROUND_SECTION_LABEL_KEYS, VIS_PLAYGROUND_SECTIONS } from '../../../visualizer/window/visPlaygroundSections';
import type { SettingsSearchEntry } from './settingsNavSearch';

// src/components/modal/settings/navigation/lyricStyleWindowSearch.ts
// What the settings search finds in the lyric style window (外观 › 歌词样式与背景), which is a
// window over the settings, not a page in them: its five pages, and the names the pickers on two of
// them show — every lyric style on 歌词动画, every background on 背景. A hit opens the window on that
// page and changes nothing. A background's own effect settings are not listed: the page shows only
// those of the background in use, so a hit for another one's would land where it is not drawn.

type Translate = (key: string) => string;

/** The window's pages and picker names; `windowPath` is where the window is (外观 › 歌词样式与背景). */
export const buildLyricStyleWindowEntries = (t: Translate, windowPath: string): SettingsSearchEntry[] => {
    const pageLabel = (section: typeof VIS_PLAYGROUND_SECTIONS[number]) => t(VIS_PLAYGROUND_SECTION_LABEL_KEYS[section]);
    const pages = VIS_PLAYGROUND_SECTIONS.map((section): SettingsSearchEntry => ({
        sectionId: 'appearance',
        targetId: null,
        workWindowSection: section,
        label: pageLabel(section),
        path: windowPath,
    }));
    const styles = VISUALIZER_REGISTRY.map((entry): SettingsSearchEntry => ({
        sectionId: 'appearance',
        targetId: null,
        workWindowSection: 'visualizer',
        label: t(entry.labelKey) || entry.labelFallback,
        path: `${windowPath} › ${pageLabel('visualizer')}`,
    }));
    const backgrounds = VISUALIZER_BACKGROUND_REGISTRY.map((entry): SettingsSearchEntry => ({
        sectionId: 'appearance',
        targetId: null,
        workWindowSection: 'background',
        label: t(entry.labelKey) || entry.labelFallback,
        path: `${windowPath} › ${pageLabel('background')}`,
    }));
    return [...pages, ...styles, ...backgrounds];
};
