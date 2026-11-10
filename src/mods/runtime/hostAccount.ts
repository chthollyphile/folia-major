import type { OmniProviderSummary } from '@/types/onlineMusic';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { getStoredString, setStoredString } from '@/stores/storagePrimitives';
import { sha256Hex } from '@/utils/sha256';
import type { FoliumAccountState } from '../folium/contract';
import { registerFoliumAccountSource } from '../folium/account';
import { emitFoliumEvent, hasFoliumEventHandlers } from '../folium/events';

// src/mods/runtime/hostAccount.ts
// Main-window source of `folium.account` and the `account.changed` event (Folium 1.7). The state is
// Omni's provider summaries (the account store, read through Omni: no platform adapter is touched),
// projected so that a mod sees no user id, cookie or token: a status, the nickname and avatar, and an
// opaque account key.
//
// The account key is a SHA-256 of a random salt kept for this installation, the provider id and the
// user id, cut to 128 bits: the same account keeps its key across restarts, another account gets
// another one, and without the salt the key cannot be traced back to the user id.

/** Where the installation's salt is kept. Written once, never renamed. */
const ACCOUNT_SALT_KEY = 'folia_folium_account_salt_v1';
/** Hex digits of the digest that make the key (128 bits). */
const ACCOUNT_KEY_LENGTH = 32;

let salt: string | null = null;

/* The installation's salt: read once, made (16 random bytes) and kept the first time it is wanted. */
const accountSalt = (): string => {
    if (salt !== null) return salt;
    let stored = '';
    try {
        stored = getStoredString(ACCOUNT_SALT_KEY, '');
    } catch (error) {
        console.warn('[FoliumAccount] the account key salt could not be read; a new one is made', error);
    }
    if (/^[0-9a-f]{32}$/.test(stored)) {
        salt = stored;
        return salt;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    salt = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    try {
        setStoredString(ACCOUNT_SALT_KEY, salt);
        console.info('[FoliumAccount] made the salt of mod account keys for this installation');
    } catch (error) {
        // Kept for this run only: the keys stay the same until the app restarts.
        console.warn('[FoliumAccount] the account key salt could not be kept; account keys change at the next start', error);
    }
    return salt;
};

// Keys already worked out, by provider and user id: getState is asked often, the digest is plain JS.
const accountKeys = new Map<string, string>();

/** The opaque key of one provider's account (see the header). */
export const foliumAccountKeyOf = (providerId: string, userId: string | number): string => {
    const id = `${providerId}\n${String(userId)}`;
    let key = accountKeys.get(id);
    if (key === undefined) {
        key = sha256Hex(`${accountSalt()}\n${id}`).slice(0, ACCOUNT_KEY_LENGTH);
        accountKeys.set(id, key);
    }
    return key;
};

type FoliumAccountStatus = FoliumAccountState['status'];

/*
 * The status a summary reads as, which is what the host shows. Someone shown is signed in, also while a
 * read of the account failed (the account stays as shown then). With nobody shown: a source without
 * accounts, and an account the host holds as nobody's, are signed out; nobody while the host has not
 * found out yet (no read so far, a source that shows nothing until the platform answers, or a platform
 * that could not be asked) is unknown.
 */
const statusOf = (summary: OmniProviderSummary): FoliumAccountStatus => {
    if (summary.requiresAccount === false) return 'signed-out';
    if (summary.user) return 'signed-in';
    return summary.status === 'anonymous' ? 'signed-out' : 'unknown';
};

/* What a mod may see of one summary. */
const projectAccount = (summary: OmniProviderSummary): FoliumAccountState => {
    const status = statusOf(summary);
    const user = status === 'signed-in' ? summary.user : null;
    return Object.freeze({
        providerId: summary.providerId,
        status,
        user: user
            ? Object.freeze({
                nickname: String(user.nickname ?? ''),
                ...(typeof user.avatarUrl === 'string' && user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
            })
            : null,
        accountKey: user ? foliumAccountKeyOf(summary.providerId, user.id) : null,
    });
};

const summaryOf = (providerId?: string): OmniProviderSummary | undefined => (
    providerId === undefined
        ? omni.getActiveProviderSummary()
        : omni.getProviderSummaries().find((summary) => summary.providerId === providerId)
);

/** One provider's state for `folium.account.getState`; the selected provider without an id. */
export const getFoliumAccountState = (providerId?: string): FoliumAccountState | null => {
    const summary = summaryOf(providerId);
    return summary ? projectAccount(summary) : null;
};

/*
 * What `account.changed` compares: the status and who is signed in, without the digest. Cheap enough
 * to keep up to date while no mod listens, so a mod that starts listening later is not told of
 * changes that came before it.
 */
const signatureOf = (summary: OmniProviderSummary): string => {
    const status = statusOf(summary);
    return status === 'signed-in' ? `${status}\n${String(summary.user?.id)}` : status;
};

const lastSignatures = new Map<string, string>();
let changePending = false;

const takeSignatures = (): Map<string, OmniProviderSummary> => {
    const changed = new Map<string, OmniProviderSummary>();
    for (const summary of omni.getProviderSummaries()) {
        const signature = signatureOf(summary);
        const before = lastSignatures.get(summary.providerId);
        lastSignatures.set(summary.providerId, signature);
        if (before !== undefined && before !== signature) changed.set(summary.providerId, summary);
    }
    return changed;
};

/*
 * account.changed: one event per provider for all the changes of a task, a microtask after the first,
 * read from the state as it settled (a sign-in clears the account, then fills it in). A provider whose
 * status and user end where they began is not announced.
 */
const emitAccountChanges = () => {
    changePending = false;
    const changed = takeSignatures();
    if (changed.size === 0 || !hasFoliumEventHandlers('account.changed')) return;
    changed.forEach((summary) => {
        const state = projectAccount(summary);
        console.info(`[FoliumAccount] ${summary.providerId}: ${state.status}, announced to mods`);
        emitFoliumEvent('account.changed', state);
    });
};

let installed = false;

/** Installs the account source and the `account.changed` notifications (main window only; idempotent). */
export const installFoliumHostAccount = () => {
    if (installed) return;
    installed = true;
    registerFoliumAccountSource({ getState: getFoliumAccountState });
    // The starting point: what is there before any mod could listen is no change.
    takeSignatures();
    useOnlineProviderAccountStore.subscribe((state, previous) => {
        if (state.accounts === previous.accounts || changePending) return;
        changePending = true;
        queueMicrotask(emitAccountChanges);
    });
};
