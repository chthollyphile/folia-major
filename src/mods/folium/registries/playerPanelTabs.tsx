import React, { useMemo } from 'react';
import { Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLucideIcons } from '@/hooks/useLucideIcons';
import { lucideExportName, resolveLucideIcon } from '@/services/lucideIconResolver';
import type { Theme } from '@/types';
import type { FoliumPlayerPanelTabDef } from '../contract';
import { toFoliumTheme } from '../dto';
import { resolveFoliumLabel } from '../../params/params';
import { createFoliumRegistry, useFoliumRegistryEntries, type FoliumRegistryEntry } from '../../runtime/registry';
import { FoliumMountHost } from '../../runtime/FoliumMountHost';
import { foliumMountName } from '../kinds';
import { useFoliumPanelContext } from './useFoliumPanelContext';

// src/mods/folium/registries/playerPanelTabs.tsx
// `folium.registries.playerPanelTabs`: extra tabs in the player panel. The host
// adds a tab button (label from the mod, and the lucide icon it names or a
// puzzle) and mounts the mod's content in an isolated container when that tab
// is open.

export const FOLIUM_PANEL_TAB_PREFIX = 'folium:';

const PANEL_TAB = foliumMountName('playerPanelTabs', 'panelTab');

export const playerPanelTabsRegistry = createFoliumRegistry<FoliumPlayerPanelTabDef>('playerPanelTabs', {
    validate: (def) => {
        if (typeof def.mount !== 'function') {
            throw new Error('playerPanelTabs.register: mount must be a function');
        }
        return def;
    },
});

export const foliumPanelTabId = (id: string) => `${FOLIUM_PANEL_TAB_PREFIX}${id}` as const;

type PanelTabIcon = React.ComponentType<{ size?: number }>;

// One component for each icon name, so a tab's icon keeps its identity from render to render.
const namedTabIcons = new Map<string, PanelTabIcon>();

// A lucide icon name as `folium.ui.icon` takes it: lower-case words joined by hyphens.
const LUCIDE_ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The icon of a mod's tab (Folium 1.9): the lucide icon its definition names, loaded on first use like every
 * icon a mod names; the puzzle while it loads, for a name lucide does not have, and for a tab that names none.
 */
export const foliumPanelTabIcon = (name: unknown): PanelTabIcon => {
    if (typeof name !== 'string' || !LUCIDE_ICON_NAME.test(name)) return Puzzle;
    let icon = namedTabIcons.get(name);
    if (!icon) {
        const names = [lucideExportName(name)];
        const NamedTabIcon: PanelTabIcon = ({ size }) => {
            useLucideIcons(names);
            const Icon = resolveLucideIcon(names[0]) ?? Puzzle;
            return <Icon size={size} />;
        };
        icon = NamedTabIcon;
        namedTabIcons.set(name, icon);
    }
    return icon;
};

/** The mod tabs to append to the panel's tab row, sorted by order. */
export const useFoliumPanelTabs = () => {
    const { i18n } = useTranslation();
    const entries = useFoliumRegistryEntries(playerPanelTabsRegistry);
    return useMemo(() => [...entries]
        .sort((left, right) => (left.def.order ?? 500) - (right.def.order ?? 500) || left.id.localeCompare(right.id))
        .map((entry) => ({
            id: foliumPanelTabId(entry.id),
            label: resolveFoliumLabel(entry.def.label, i18n.language, entry.name),
            icon: foliumPanelTabIcon(entry.def.icon),
        })), [entries, i18n.language]);
};

const FoliumPanelTabContent: React.FC<{
    entry: FoliumRegistryEntry<FoliumPlayerPanelTabDef>;
    theme: Theme;
    isDaylight: boolean;
}> = ({ entry, theme, isDaylight }) => {
    const { i18n } = useTranslation();
    const ctx = useFoliumPanelContext(theme, isDaylight, i18n.language);
    const foliumTheme = useMemo(() => toFoliumTheme(theme, isDaylight), [theme, isDaylight]);
    return (
        <FoliumMountHost
            modId={entry.modId}
            where={`panel tab ${entry.id}`}
            entryKind={PANEL_TAB}
            entryId={entry.id}
            mount={entry.def.mount}
            ctx={ctx}
            shadow
            fill={false}
            theme={foliumTheme}
            className="w-full"
        />
    );
};

/** Body of the open panel tab when it belongs to a mod; renders nothing otherwise. */
export const FoliumPanelTabBody: React.FC<{ tab: string; theme: Theme; isDaylight: boolean }> = ({ tab, theme, isDaylight }) => {
    const entries = useFoliumRegistryEntries(playerPanelTabsRegistry);
    if (!tab.startsWith(FOLIUM_PANEL_TAB_PREFIX)) return null;
    const entry = entries.find((candidate) => foliumPanelTabId(candidate.id) === tab);
    return entry ? <FoliumPanelTabContent key={entry.id} entry={entry} theme={theme} isDaylight={isDaylight} /> : null;
};
