import type { FoliumSourcePageStore } from '@folia/folium';

// sources/ytm/client/ytmAccount.ts
// What the desktop side last said of the signed-in account, beside what the app shows of it: whether it has
// Premium (`vipType`). The source's parts ask here. The fact is kept across runs in the source's page store
// (`account`): a song may be asked for before the sign-in status was read in this run, and the quality level it
// is asked at depends on it. Until that read, what the last run knew stands.
// The built-in provider kept it under `folia_ytm_account`; the host moves that over to this key once
// (sourcePageStore.ts), in the shape it had. A note of the device sign-in (`signIn: 'tv'`), which is gone, is nobody's.

const STORAGE_KEY = 'account';

let store: FoliumSourcePageStore | null = null;
let premium = false;
// Told when the fact changes (index.ts: the handle's `changed()`, as the quality levels follow it).
let onChange: () => void = () => {};

/** Connects the note to the source's page store and reads what the last run kept. */
export const connectYtmAccount = (next: FoliumSourcePageStore, changed: () => void): void => {
    store = next;
    onChange = changed;
    premium = false;
    try {
        const { premium: kept, signIn } = (JSON.parse(store.get(STORAGE_KEY) ?? 'null') ?? {}) as { premium?: unknown; signIn?: unknown };
        premium = signIn !== 'tv' && kept === true;
    } catch { /* unreadable: nothing is known */ }
    if (premium) console.log('[Ytm] The account as the last run knew it has Premium');
};

/** Notes the account as the desktop side names it (a `login_status` answer, or the one of a confirmed `web_login_check`); null for nobody signed in. */
export const noteYtmAccount = (account: unknown): void => {
    const before = premium;
    premium = Boolean(account) && Number((account as { vipType?: unknown }).vipType) > 0;
    // (The page store logs a write it could not make; the fact holds for this run.)
    store?.set(STORAGE_KEY, account ? JSON.stringify({ premium }) : null);
    if (premium !== before) onChange();
};

/** Whether somebody is signed in whose account has Premium. */
export const ytmHasPremium = (): boolean => premium;
