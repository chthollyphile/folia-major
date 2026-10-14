import { create } from 'zustand';
import type { FoliumLabel, FoliumMount } from './contract';
import { createFoliumRegistry, type FoliumRegistryEntry } from './registry';

// src/mods/folium/homePages.ts
// Experimental owned pages. Native navigation is never registered here or exposed to mods.
export interface HomePageContext {
    readonly surface: 'grid' | 'bravais' | 'page';
    readonly locale: string;
    readonly isDaylight: boolean;
    /** False after this registration is removed, even if its id is registered again. */
    isCurrent(): boolean;
    /** Open this registration only; false if it has been removed. */
    open(): boolean;
    /** Close this registration only; false if stale or another page is active. */
    close(): boolean;
}
export interface HomePageDefinition {
    id: string;
    /** Accessible page name. All visible navigation and page content belong to the mod. */
    label: FoliumLabel;
    mountNavigation: FoliumMount<HomePageContext>;
    mountPage: FoliumMount<HomePageContext>;
}
export const useHomePageStore = create<{ activeId: string | null }>(() => ({ activeId: null }));
export const closeHomePage = () => useHomePageStore.setState({ activeId: null });
export const homePagesRegistry = createFoliumRegistry<HomePageDefinition>('home.pages', {
    validate: def => {
        if (typeof def.mountNavigation !== 'function' || typeof def.mountPage !== 'function') {
            throw new TypeError('home.pages: mountNavigation and mountPage must be functions');
        }
        if (!def.label || typeof def.label !== 'object' || Array.isArray(def.label)
            || !Object.values(def.label).some(value => typeof value === 'string' && value.trim())
            || Object.values(def.label).some(value => value !== undefined && typeof value !== 'string')) {
            throw new TypeError('home.pages: label must contain localized text');
        }
        return Object.freeze({ id: def.id, label: Object.freeze({ ...def.label }),
            mountNavigation: def.mountNavigation, mountPage: def.mountPage });
    },
    onRemove: entry => { if (useHomePageStore.getState().activeId === entry.id) closeHomePage(); },
});
export const openHomePage = (entry: FoliumRegistryEntry<HomePageDefinition>): boolean => {
    if (homePagesRegistry.get(entry.id) !== entry) return false;
    useHomePageStore.setState({ activeId: entry.id });
    return true;
};
export const closeOwnedHomePage = (entry: FoliumRegistryEntry<HomePageDefinition>): boolean => {
    if (homePagesRegistry.get(entry.id) !== entry || useHomePageStore.getState().activeId !== entry.id) return false;
    closeHomePage();
    return true;
};
