import { Boxes, Contrast, Database, Gauge, Keyboard, LayoutGrid, Link2, Monitor, MonitorPlay, PlayCircle, SlidersHorizontal, Terminal, TextAlignStart, type LucideIcon } from 'lucide-react';
// src/components/modal/settings/navigation/settingsNavModel.ts
// Single source of truth for the settings categories: their order in the side list, their grouping,
// icons and names. A category is cut by what the listener is looking at or doing, so each page holds
// one subject; which page an option is on is settingsAnchorModel's and the page files' to say.

export type SettingsSectionId =
    | 'appearance'
    | 'player'
    | 'home'
    | 'playback'
    | 'lyrics'
    | 'general'
    | 'interaction'
    | 'integration'
    | 'storage'
    | 'desktop'
    | 'graphics'
    | 'mods'
    | 'developer';

export interface SettingsNavItem {
    id: SettingsSectionId;
    icon: LucideIcon;
    label: string;
}

export interface SettingsNavGroup {
    id: string;
    label: string;
    items: SettingsNavItem[];
}

type Translate = (key: string) => string;

interface SectionSpec {
    id: SettingsSectionId;
    icon: LucideIcon;
    labelKey: string;
    /** Sections that only exist on the desktop build. */
    electronOnly?: boolean;
}

interface GroupSpec {
    id: string;
    labelKey: string;
    sections: SectionSpec[];
}

export const SETTINGS_NAV_GROUP_SPECS: GroupSpec[] = [
    {
        id: 'interface',
        labelKey: 'options.settingsGroupInterface',
        sections: [
            { id: 'appearance', icon: Contrast, labelKey: 'options.settingsPageAppearance' },
            { id: 'player', icon: MonitorPlay, labelKey: 'options.settingsPagePlayer' },
            { id: 'home', icon: LayoutGrid, labelKey: 'options.settingsPageHome' },
        ],
    },
    {
        id: 'music',
        labelKey: 'options.settingsGroupMusic',
        sections: [
            { id: 'playback', icon: PlayCircle, labelKey: 'options.settingsPagePlayback' },
            { id: 'lyrics', icon: TextAlignStart, labelKey: 'options.settingsPageLyrics' },
        ],
    },
    {
        id: 'app',
        labelKey: 'options.settingsGroupApp',
        sections: [
            { id: 'general', icon: SlidersHorizontal, labelKey: 'options.settingsPageGeneral' },
            { id: 'interaction', icon: Keyboard, labelKey: 'options.settingsPageInteraction' },
            { id: 'integration', icon: Link2, labelKey: 'options.settingsPageIntegration' },
            { id: 'storage', icon: Database, labelKey: 'options.settingsPageStorage' },
            { id: 'desktop', icon: Monitor, labelKey: 'options.settingsPageDesktop', electronOnly: true },
            { id: 'graphics', icon: Gauge, labelKey: 'options.settingsPageGraphics' },
        ],
    },
    {
        id: 'advanced',
        labelKey: 'options.settingsGroupAdvanced',
        sections: [
            // The loader only exists in the desktop main process; on web there is nothing to switch on.
            { id: 'mods', icon: Boxes, labelKey: 'options.settingsPageMods', electronOnly: true },
            { id: 'developer', icon: Terminal, labelKey: 'options.settingsPageDeveloper' },
        ],
    },
];

/** Resolves the grouping into translated nav items, dropping desktop-only sections (and groups left empty) on web. */
export const buildSettingsNavGroups = (t: Translate, options: { isElectron: boolean }): SettingsNavGroup[] => (
    SETTINGS_NAV_GROUP_SPECS
        .map(group => ({
            id: group.id,
            label: t(group.labelKey),
            items: group.sections
                .filter(section => !section.electronOnly || options.isElectron)
                .map(section => ({
                    id: section.id,
                    icon: section.icon,
                    label: t(section.labelKey),
                })),
        }))
        .filter(group => group.items.length > 0)
);

export const flattenSettingsNavItems = (groups: SettingsNavGroup[]): SettingsNavItem[] => (
    groups.flatMap(group => group.items)
);

export const findSettingsNavItem = (groups: SettingsNavGroup[], id: SettingsSectionId): SettingsNavItem | undefined => (
    flattenSettingsNavItems(groups).find(item => item.id === id)
);
