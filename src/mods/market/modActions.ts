import type { ModViewItem } from './marketModel';

// src/mods/market/modActions.ts
// Which one action a mod's line and detail lead with, from its state. Pure; the sidebar and the detail
// pane draw it and modOperations.ts carries it out.

export type ModPrimaryAction =
    /** An awesome entry: open its repository. */
    | { kind: 'open'; url: string }
    /** Being installed or updated. */
    | { kind: 'busy' }
    | { kind: 'install' }
    | { kind: 'update' }
    /** Installed but held back: its `folia` range ran out above. */
    | { kind: 'tryLoad' }
    /** Listed only, and this Folia is older than it needs. */
    | { kind: 'needsFolia'; range: string | null }
    /** Listed only, and the community mods switch keeps it out. */
    | { kind: 'needsCommunity' }
    /** Installed: its switch. */
    | { kind: 'toggle' };

export const primaryActionOf = (item: ModViewItem, busy: boolean): ModPrimaryAction => {
    if (item.awesome) return { kind: 'open', url: item.awesome.url };
    if (busy) return { kind: 'busy' };
    const market = item.market;
    if (item.installed) {
        if (item.hasUpdate) return { kind: 'update' };
        if (item.rangeExpired) return { kind: 'tryLoad' };
        return { kind: 'toggle' };
    }
    if (market?.hostRange === 'too-old' || market?.hostRange === 'invalid') return { kind: 'needsFolia', range: market.folia };
    if (market?.communityBlocked) return { kind: 'needsCommunity' };
    return { kind: 'install' };
};

/** Only mods in the user mods folder (one from a zip or the market, or an override of a built-in one) can be uninstalled here: the main process says which. */
export const canUninstall = (item: ModViewItem): boolean => Boolean(item.installed?.uninstallable);
