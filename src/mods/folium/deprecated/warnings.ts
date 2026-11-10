import { create } from 'zustand';
import { foliumOldNameAdvice, type FoliumOldName } from './oldNames';

// src/mods/folium/deprecated/warnings.ts
// Folium 1.6 only: the old names each mod's client used in this window, one
// line each ("ctx.subscribe: removed in Folium 2, use ctx.onChange"), for the
// mod's row in Settings (ModListItem.tsx shows them with the main side's
// `mod.warnings`). index.ts writes them, once per name, and so does
// sayFoliumOldNameOnce for omni providers (registries/omniProviders.ts); clientLoader.ts
// empties a mod's list when it starts the mod's client, also a start that then
// fails. Kept apart from index.ts so the row and the loader can read it without
// loading the layer.

interface FoliumOldNameState {
    /** Per mod, its lines in the order they came. */
    byMod: Readonly<Record<string, readonly string[]>>;
}

export const useFoliumOldNameStore = create<FoliumOldNameState>(() => ({ byMod: {} }));

/** Adds one line to the mod's list (index.ts says each name once). */
export const noteFoliumOldName = (modId: string, line: string) => {
    useFoliumOldNameStore.setState((state) => ({ byMod: { ...state.byMod, [modId]: [...(state.byMod[modId] ?? []), line] } }));
};

/**
 * Says one old name for a mod where no `folium` object is at hand (an omni provider's lyrics answer):
 * in the console and in the mod's list, once until its client starts again.
 */
export const sayFoliumOldNameOnce = (modId: string, row: FoliumOldName) => {
    const line = `${row.old}: ${foliumOldNameAdvice(row)}`;
    if (useFoliumOldNameStore.getState().byMod[modId]?.includes(line)) return;
    console.warn(`[Folium:${modId}] ${line}`);
    noteFoliumOldName(modId, line);
};

/** Empties the mod's list: its client starts again. */
export const clearFoliumOldNames = (modId: string) => {
    useFoliumOldNameStore.setState((state) => {
        if (!(modId in state.byMod)) return state;
        const byMod = { ...state.byMod };
        delete byMod[modId];
        return { byMod };
    });
};
