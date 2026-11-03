import type { FoliumAccountService, FoliumAccountState, FoliumContextKind } from './contract';

// src/mods/folium/account.ts
// `folium.account` (Folium 1.7) and the seam it reads through. Like services.ts this module is loaded in
// the export window too, so it imports no app store: the main window installs the source of the
// state (runtime/hostAccount.ts, which reads the account store through Omni) with
// registerFoliumAccountSource. Without a source, and always in the export window, getState throws a
// clear "unavailable" error instead of reading state that is not there.

/** Where the main window's account state comes from (runtime/hostAccount.ts). */
export interface FoliumAccountSource {
    /** One provider's state (the selected one without an id); null for a provider the host does not know. */
    getState(providerId?: string): FoliumAccountState | null;
}

let accountSource: FoliumAccountSource | null = null;

/** Installs (or with null removes) the main window's account source. */
export const registerFoliumAccountSource = (source: FoliumAccountSource | null) => {
    accountSource = source;
};

/** The state of one provider as the installed source reads it; null without a source (the export window). */
export const readFoliumAccountState = (providerId?: string): FoliumAccountState | null => (
    accountSource ? accountSource.getState(providerId) : null
);

/** `folium.account` for a client in `context`. */
export const createFoliumAccountService = (context: FoliumContextKind): FoliumAccountService => Object.freeze({
    getState: (providerId?: string) => {
        if (context !== 'main' || !accountSource) {
            throw new Error(`account-unavailable-in-${context}-context`);
        }
        if (providerId !== undefined && typeof providerId !== 'string') return null;
        return accountSource.getState(providerId);
    },
});
