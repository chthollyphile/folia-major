// src/services/onlineMusic/ytm/ytmAccount.ts
// What the desktop side last said of the signed-in account, beside what the app shows of it:
// whether it has Premium (`vipType`). The adapter's parts ask here. The fact is kept across runs
// (localStorage): a song may be asked for before the sign-in status was read in this run, and the
// quality level it is asked at depends on it. Until that read, what the last run knew stands.

const STORAGE_KEY = 'folia_ytm_account';

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

// What the last run kept, as far as it has the shape written here; anything else is nobody. A
// note written when the app had two sign-ins names its own beside the fact (`signIn`): the one
// of the device sign-in ('tv'), which is gone, is nobody's.
const readKept = (): boolean => {
    try {
        const kept: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null');
        const { signIn, premium } = (kept ?? {}) as { signIn?: unknown; premium?: unknown };
        return signIn !== 'tv' && premium === true;
    } catch { /* unreadable: nothing is known */ }
    return false;
};

let premium = readKept();
if (premium) console.log('[Ytm] The account as the last run knew it has Premium');

/** Notes the account as the desktop side names it (a `login_status` answer, or the one of a confirmed `web_login_check`); null for nobody signed in. */
export const noteYtmAccount = (account: unknown): void => {
    premium = Boolean(account) && Number((account as { vipType?: unknown }).vipType) > 0;
    try {
        if (account) storage()?.setItem(STORAGE_KEY, JSON.stringify({ premium }));
        else storage()?.removeItem(STORAGE_KEY);
    } catch { /* storage is full or switched off: the fact holds for this run */ }
};

/** Whether somebody is signed in whose account has Premium. */
export const ytmHasPremium = (): boolean => premium;
