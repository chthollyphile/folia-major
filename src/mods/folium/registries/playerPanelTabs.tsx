import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import type { FoliumPanelContext, FoliumPlayerPanelTabDef } from '../contract';
import { toFoliumTheme } from '../dto';
import { resolveFoliumLabel } from '../params';
import { createFoliumRegistry, useFoliumRegistryEntries, type FoliumRegistryEntry } from '../registry';
import { FoliumMountHost } from '../FoliumMountHost';

// src/mods/folium/registries/playerPanelTabs.tsx
// `folium.registries.playerPanelTabs`: extra tabs in the player panel. The host
// adds a tab button (label from the mod, a puzzle icon) and mounts the mod's
// content in an isolated container when that tab is open.

export const FOLIUM_PANEL_TAB_PREFIX = 'folium:';

export const playerPanelTabsRegistry = createFoliumRegistry<FoliumPlayerPanelTabDef>('playerPanelTabs', {
    validate: (def) => {
        if (typeof def.mount !== 'function') {
            throw new Error('playerPanelTabs.register: mount must be a function');
        }
        return def;
    },
});

export const foliumPanelTabId = (id: string) => `${FOLIUM_PANEL_TAB_PREFIX}${id}` as const;

/** The mod tabs to append to the panel's tab row, sorted by order. */
export const useFoliumPanelTabs = () => {
    const { i18n } = useTranslation();
    const entries = useFoliumRegistryEntries(playerPanelTabsRegistry);
    return useMemo(() => [...entries]
        .sort((left, right) => (left.def.order ?? 500) - (right.def.order ?? 500) || left.id.localeCompare(right.id))
        .map((entry) => ({
            id: foliumPanelTabId(entry.id),
            label: resolveFoliumLabel(entry.def.label, i18n.language, entry.name),
        })), [entries, i18n.language]);
};

const usePanelContext = (theme: Theme, isDaylight: boolean, locale: string): FoliumPanelContext => {
    const themeRef = useRef({ theme, isDaylight });
    themeRef.current = { theme, isDaylight };
    const listenersRef = useRef(new Set<() => void>());
    const ctx = useMemo<FoliumPanelContext>(() => Object.freeze({
        locale,
        getTheme: () => toFoliumTheme(themeRef.current.theme, themeRef.current.isDaylight),
        subscribe: (listener: () => void) => {
            listenersRef.current.add(listener);
            return () => listenersRef.current.delete(listener);
        },
    }), [locale]);
    const primedRef = useRef(false);
    useEffect(() => {
        if (!primedRef.current) {
            primedRef.current = true;
            return;
        }
        listenersRef.current.forEach((listener) => listener());
    }, [theme, isDaylight]);
    return ctx;
};

const FoliumPanelTabContent: React.FC<{
    entry: FoliumRegistryEntry<FoliumPlayerPanelTabDef>;
    theme: Theme;
    isDaylight: boolean;
}> = ({ entry, theme, isDaylight }) => {
    const { i18n } = useTranslation();
    const ctx = usePanelContext(theme, isDaylight, i18n.language);
    const foliumTheme = useMemo(() => toFoliumTheme(theme, isDaylight), [theme, isDaylight]);
    return (
        <FoliumMountHost
            modId={entry.modId}
            where={`panel tab ${entry.id}`}
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
