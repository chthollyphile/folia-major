import { create } from 'zustand';
import type { FoliumHomeTabDef } from '../contract';
import { createFoliumRegistry } from '../../runtime/registry';

// src/mods/folium/registries/homeTabs.ts
// Owned full-page home entries. Selection is separate from native music-source tabs.

export const useFoliumHomeTabStore = create<{ activeId: string | null }>(() => ({ activeId: null }));

export const homeTabsRegistry = createFoliumRegistry<FoliumHomeTabDef>('homeTabs', {
    validate: def => {
        if (typeof def.mount !== 'function') throw new Error('homeTabs.register: mount must be a function');
        if (!def.label || typeof def.label !== 'object' || Array.isArray(def.label)
            || Object.values(def.label).some(value => value !== undefined && typeof value !== 'string')) {
            throw new Error('homeTabs.register: label must contain localized text');
        }
        if (def.order !== undefined && !Number.isFinite(def.order)) throw new Error('homeTabs.register: order must be finite');
        return { ...def, label: { ...def.label } };
    },
    onRemove: entry => {
        if (useFoliumHomeTabStore.getState().activeId === entry.id) closeFoliumHomeTab();
    },
});

export const closeFoliumHomeTab = () => useFoliumHomeTabStore.setState({ activeId: null });

/** Only registered entries can be selected, including before the home surface mounts. */
export const selectFoliumHomeTab = (id: string): boolean => {
    if (!homeTabsRegistry.get(id)) return false;
    useFoliumHomeTabStore.setState({ activeId: id });
    return true;
};
