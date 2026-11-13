import type { ProviderAvailability } from '../../types/onlineMusic';
import { getOnlineMusicProvider, listOnlineMusicProviders } from './providerRegistry';
import { isSourceEnabled, isSourceMatchingOnly } from './sourceReadiness';
import { useOnlineProviderAccountStore, type OnlineProviderAccountState } from '../../stores/useOnlineProviderAccountStore';
import { LYRIC_SOURCES } from '../../utils/lyrics/lyricSources';
import { getSourceDeclaration, listSourceDeclarations } from './sourceDeclarations';

// src/services/onlineMusic/crossSource.ts
// The one rule for the features that ask a platform that is not the song's own (Folium 2.0 plan §7.1):
// the federated search (the search page's other sources), the metadata match (online details for a local or
// Navidrome song) and the lyric match across sources (the automatic pick, the match windows, the preferred
// source). `participants(feature)` says which sources take part now (`ready`, in order) and which are left
// out and why (`skipped`). A source is judged in this order:
//
// | the source now                                              | then                                  |
// | ----------------------------------------------------------- | ------------------------------------- |
// | not enabled: not registered, turned off, failed to start    | skipped, `not-enabled`                |
// | used only for matching (§5.3), the lyric or metadata match, | takes part, anonymously: its account  |
// |   and the feature needs no account there                    |   is never read                       |
// | used only for matching, anything else (the federated search, | skipped, `matching-only`             |
// |   or a feature that needs an account there)                 |                                       |
// | its getAvailability says not configured / runtime-unavailable | skipped, for that reason            |
// | the feature needs an account there and none is signed in    | skipped, `needs-account`              |
// | otherwise (anonymous use, or signed in)                     | ready                                 |
//
// A skipped source is hidden (not drawn as a disabled row). A stored choice that names it is kept as it is:
// the next ready source stands in, and the stored one is in force again once it is ready. A flow that runs
// asks with `{ report: true }`: each skipped source is logged once for that run.
//
// What each source declares for a feature (`declaredParticipants`): a Folium 2 source mod declares it through its
// capabilities (sourceDeclarations.ts: `access` of search@1 / songs@1 / lyrics@1, `lyrics@1.crossSource` as an
// entry of the lyric source registry, `songs@1.metadataMatch`); the built-in platforms, still registered by
// the host, are read from the tables they always were (the lyric source registry's needsAccount /
// needsConfiguredProvider / metadataMatch, `capabilities.auth` for the federated search). "Enabled" and "used
// only for matching" are S2's per-source switch (sourceReadiness.isSourceEnabled / isSourceMatchingOnly, from
// the main process's state table). Callers do not change.

export type CrossSourceFeature = 'search' | 'metadata' | 'lyrics';
/** Whether a source does the feature with no one signed in ('anonymous') or only with an account ('account'). */
export type CrossSourceAccess = 'anonymous' | 'account';
export type CrossSourceSkipReason = 'not-enabled' | 'not-configured' | 'runtime-unavailable' | 'needs-account' | 'matching-only';

export interface CrossSourceDeclaration {
    sourceId: string;
    access: CrossSourceAccess;
    /** The platform's getAvailability is asked first (a source that needs its bridge or configuration). */
    checksAvailability: boolean;
    /** The host's own source, not a platform (AMLL DB): always enabled, needs nobody. */
    hostOwned?: boolean;
}

/** What is known of one source at the moment of asking. */
export interface CrossSourceState {
    enabled: boolean;
    /** Registered and used only for matching (plan §5.3); `enabled` is then false. */
    matchingOnly?: boolean;
    availability: ProviderAvailability;
    signedIn: boolean;
}

export interface CrossSourceSkip {
    sourceId: string;
    reason: CrossSourceSkipReason;
}

export interface CrossSourceParticipants {
    /** The sources that take part, in the declared order. */
    ready: string[];
    /** The ones left out, in the declared order, each with why. */
    skipped: CrossSourceSkip[];
}

const READY_STATE: CrossSourceState = { enabled: true, availability: { configured: true }, signedIn: true };

/** Applies the table at the top of this file to `declarations`, asking `stateOf` about each. Pure. */
export const resolveParticipants = (
    declarations: readonly CrossSourceDeclaration[],
    stateOf: (declaration: CrossSourceDeclaration) => CrossSourceState,
    feature: CrossSourceFeature = 'lyrics',
): CrossSourceParticipants => {
    const ready: string[] = [];
    const skipped: CrossSourceSkip[] = [];
    const seen = new Set<string>();
    for (const declaration of declarations) {
        if (seen.has(declaration.sourceId)) continue;
        seen.add(declaration.sourceId);
        const state = declaration.hostOwned ? READY_STATE : stateOf(declaration);
        // Used only for matching: the lyric and metadata match with no account, and nothing else.
        const matchingOnly = !state.enabled && Boolean(state.matchingOnly);
        let reason: CrossSourceSkipReason | null = null;
        if (!state.enabled && !matchingOnly) reason = 'not-enabled';
        else if (matchingOnly && (feature === 'search' || declaration.access === 'account')) reason = 'matching-only';
        else if (declaration.checksAvailability && !state.availability.configured) reason = state.availability.reason ?? 'not-configured';
        else if (declaration.access === 'account' && !state.signedIn) reason = 'needs-account';
        if (reason) skipped.push({ sourceId: declaration.sourceId, reason });
        else ready.push(declaration.sourceId);
    }
    return { ready, skipped };
};

/**
 * What the sources declare for `feature`, in order (the seam S3 replaces, see the top of this file). A source
 * that is not registered is still declared where a table names it, so that it is reported as `not-enabled`.
 */
export const declaredParticipants = (feature: CrossSourceFeature): CrossSourceDeclaration[] => {
    if (feature === 'lyrics') {
        return LYRIC_SOURCES.map(source => ({
            sourceId: source.id,
            access: source.needsAccount ? 'account' : 'anonymous',
            checksAvailability: Boolean(source.needsConfiguredProvider),
            ...(source.platform ? {} : { hostOwned: true }),
        }));
    }
    if (feature === 'metadata') {
        // The sources the lyric registry marks `metadataMatch`, in its order (their search needs no account), then
        // the sources that declare `songs@1.metadataMatch`, in the order they registered.
        const listed: CrossSourceDeclaration[] = LYRIC_SOURCES
            .filter(source => source.metadataMatch)
            .map(source => ({ sourceId: source.id, access: 'anonymous', checksAvailability: false }));
        for (const [sourceId, declaration] of listSourceDeclarations()) {
            if (!declaration.songs?.metadataMatch || listed.some(known => known.sourceId === sourceId)) continue;
            listed.push({ sourceId, access: declaration.songs.access, checksAvailability: declaration.checksAvailability });
        }
        return listed;
    }
    // The federated search lists a platform the listener can play from without signing in first: one with no
    // account at all, one whose search needs none (its `search@1.access`), or one signed in. A platform
    // declares it only while it is registered.
    return listOnlineMusicProviders().map(provider => {
        const declared = getSourceDeclaration(provider.id)?.search?.access;
        return {
            sourceId: provider.id,
            access: declared ?? (provider.capabilities.auth ? 'account' : 'anonymous'),
            checksAvailability: true,
        };
    });
};

/** The state of `sourceId` now. Signed in means a confirmed sign-in for the search, an account shown for the rest. */
const liveState = (feature: CrossSourceFeature, sourceId: string): CrossSourceState => {
    const provider = getOnlineMusicProvider(sourceId);
    // A platform nobody has signed in to has no entry.
    const account = useOnlineProviderAccountStore.getState().accounts[sourceId] as OnlineProviderAccountState | undefined;
    const matchingOnly = isSourceMatchingOnly(sourceId);
    return {
        enabled: isSourceEnabled(sourceId),
        matchingOnly,
        availability: provider?.getAvailability?.() ?? { configured: true },
        // A source used only for matching counts as signed out: its account is not read (plan §5.3).
        signedIn: !matchingOnly && (feature === 'search' ? account?.status === 'authenticated' : Boolean(account?.user)),
    };
};

/**
 * The sources taking part in `feature` now. `report` logs each skipped one, once: pass it from a run of the
 * feature (a match, a search), not from a render.
 */
export const participants = (
    feature: CrossSourceFeature,
    options: { report?: boolean } = {},
): CrossSourceParticipants => {
    const result = resolveParticipants(declaredParticipants(feature), declaration => liveState(feature, declaration.sourceId), feature);
    if (options.report) {
        result.skipped.forEach(({ sourceId, reason }) => console.info(`[crossSource] ${feature}: ${sourceId} skipped (${reason})`));
    }
    return result;
};

/** Whether `sourceId` takes part in `feature` now. One that is not declared for it does not. */
export const isParticipantReady = (feature: CrossSourceFeature, sourceId: string): boolean => {
    const declaration = declaredParticipants(feature).find(candidate => candidate.sourceId === sourceId);
    if (!declaration) return false;
    return resolveParticipants([declaration], () => liveState(feature, sourceId), feature).ready.length === 1;
};

/** Why `sourceId` is left out of `feature` now; null while it takes part, or where it is not declared for it. */
export const participantSkipReason = (feature: CrossSourceFeature, sourceId: string): CrossSourceSkipReason | null => {
    const declaration = declaredParticipants(feature).find(candidate => candidate.sourceId === sourceId);
    if (!declaration) return null;
    return resolveParticipants([declaration], () => liveState(feature, sourceId), feature).skipped[0]?.reason ?? null;
};
