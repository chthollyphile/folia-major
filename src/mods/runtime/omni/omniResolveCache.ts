import type { UnifiedSong } from '@/types';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { getFoliumAccountState } from '../hostAccount';

// src/mods/runtime/omni/omniResolveCache.ts
// What `folium.omni.resolveSongs` read lately (Folium 1.7), by source and song id: the song, or that the
// source has no such song. Shared by all mods, since it holds only what a source tells anyone of its
// songs. An answer from here goes through no request gate and counts against no allowance. Failures are
// not kept. A source's entries go when the account signed in to it changes (not on every change of the
// account store: a refresh or a like changes that too), and when the source itself goes.

/** How long an answer is kept. */
const KEEP_MS = 10 * 60_000;
/** Answers kept at most, the oldest dropped first. */
const MAX_ENTRIES = 1000;

interface Entry {
    readonly providerId: string;
    readonly song: UnifiedSong | null;
    readonly at: number;
}

const entries = new Map<string, Entry>();

const keyOf = (providerId: string, id: string) => `${providerId}\n${id}`;

/** What was read of one song lately: the song, or null for none; undefined when nothing is kept. */
export const readFoliumResolvedSong = (providerId: string, id: string): { readonly song: UnifiedSong | null } | undefined => {
    const key = keyOf(providerId, id);
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at >= KEEP_MS) {
        entries.delete(key);
        return undefined;
    }
    return entry;
};

/** Keeps what a source answered for one song: the song, or null when it has no such song. */
export const keepFoliumResolvedSong = (providerId: string, id: string, song: UnifiedSong | null) => {
    const key = keyOf(providerId, id);
    entries.delete(key);
    entries.set(key, { providerId, song, at: Date.now() });
    if (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
    }
};

/* Forgets the entries of the sources `drop` names. */
const forgetWhere = (drop: (providerId: string) => boolean) => {
    for (const [key, entry] of entries) {
        if (drop(entry.providerId)) entries.delete(key);
    }
};

/** For tests only: forgets everything, as a fresh page would. */
export const clearFoliumResolvedSongsForTest = () => {
    entries.clear();
};

// The account key each source had when last looked at.
const accountKeys = new Map<string, string | null>();
let checkPending = false;

/* Forgets the entries of each source whose signed-in account is another than when last looked at. */
const checkAccounts = () => {
    checkPending = false;
    const changed = new Set<string>();
    for (const summary of omni.getProviderSummaries()) {
        const key = getFoliumAccountState(summary.providerId)?.accountKey ?? null;
        if (accountKeys.has(summary.providerId) && accountKeys.get(summary.providerId) !== key) changed.add(summary.providerId);
        accountKeys.set(summary.providerId, key);
    }
    if (changed.size > 0) forgetWhere((providerId) => changed.has(providerId));
};

/* Forgets the entries of sources that are no longer there (a mod's source unregistered). */
const checkProviders = () => {
    const present = new Set(omni.getProviderSummaries().map((summary) => summary.providerId));
    forgetWhere((providerId) => !present.has(providerId));
    for (const providerId of [...accountKeys.keys()]) {
        if (!present.has(providerId)) accountKeys.delete(providerId);
    }
};

let installed = false;

/** Starts forgetting entries when their account or their source goes (main window only; idempotent). */
export const installFoliumResolveCacheUpkeep = () => {
    if (installed) return;
    installed = true;
    checkAccounts();
    // All the changes of a task are looked at once, a microtask after the first, as the account settled.
    useOnlineProviderAccountStore.subscribe((state, previous) => {
        if (state.accounts === previous.accounts || checkPending) return;
        checkPending = true;
        queueMicrotask(checkAccounts);
    });
    omni.subscribeProviders(checkProviders);
};
