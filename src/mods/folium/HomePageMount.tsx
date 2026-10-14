import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { isHomePaletteShortcut } from './homePageKeyboard';
import { FoliumMountHost } from './FoliumMountHost';
import { useFoliumRegistryEntries, type FoliumRegistryEntry } from './registry';
import { closeOwnedHomePage, homePagesRegistry, openHomePage, type HomePageContext, type HomePageDefinition } from './homePages';

// src/mods/folium/HomePageMount.tsx
// Only placement, theme variables and event isolation belong to the host; each mod owns its DOM.
const themeVars = {
    '--folium-bg': 'var(--bg-color)', '--folium-primary': 'var(--text-primary)',
    '--folium-secondary': 'var(--text-secondary)', '--folium-accent': 'var(--text-accent)',
} as CSSProperties;
export function HomePageMount({ entry, surface, onOpen }: {
    entry: FoliumRegistryEntry<HomePageDefinition>; surface: HomePageContext['surface']; onOpen?: () => void;
}) {
    const { i18n } = useTranslation();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const ctx = useMemo<HomePageContext>(() => Object.freeze({
        surface, locale: i18n.language, isDaylight,
        isCurrent: () => homePagesRegistry.get(entry.id) === entry,
        open: () => {
            if (homePagesRegistry.get(entry.id) !== entry) return false;
            onOpen?.();
            return openHomePage(entry);
        }, close: () => closeOwnedHomePage(entry),
    }), [entry, surface, i18n.language, isDaylight, onOpen]);
    return <FoliumMountHost modId={entry.modId} where={`home.pages ${entry.id} ${surface}`}
        entryKind={surface === 'page' ? 'home-page' : 'home-navigation'} entryId={entry.id}
        mount={surface === 'page' ? entry.def.mountPage : entry.def.mountNavigation}
        ctx={ctx} shadow fill={surface === 'page'} style={themeVars}
        className={surface === 'page' ? 'h-full min-h-0 w-full' : surface === 'bravais' ? 'min-w-0 w-full shrink-0' : 'min-w-0 shrink-0'} />;
}
/** Empty contributions render no wrapper and reserve no space. Native entries remain untouched. */
export function FoliumHomeNavigation({ surface, onOpen }: { surface: 'grid' | 'bravais'; onOpen?: () => void }) {
    const entries = useFoliumRegistryEntries(homePagesRegistry);
    if (!entries.length) return null;
    return <div data-folium-slot="home.navigation" className={`flex items-center ${surface === 'bravais' ? 'w-full flex-col gap-0.5' : ''}`}
        onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => { if (!isHomePaletteShortcut(event.nativeEvent)) event.stopPropagation(); }}>
        {entries.map(entry => <HomePageMount key={entry.id} entry={entry} surface={surface} onOpen={onOpen} />)}
    </div>;
}
