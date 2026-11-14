// electron/modSystem/sourceOwnership.cjs
// Who runs, and under which source ids, when built-in mods and mods from the user's folders meet (Folium
// 2.0 plan §5.1). Pure: it reads only what it is given, so the loader (modSystem.cjs) decides from it and
// the rules are tested on their own (test/unit/mod-system/sourceOwnership.test.ts).
//
// The rules, in order:
//   - Override. A copy in a user folder with the same mod id as a built-in one replaces it only when it is
//     officially signed (`verified`; a preview signature is not enough), its version is higher, its `folia`
//     range holds, and the user confirmed that copy once. Otherwise the built-in copy runs and the other
//     copy's row says why. A mod that claims (`sources[].claims`) a source the installation carries is held
//     to the same rule against the built-in mod that provides that source.
//   - Installation broken. A source the installation declares it carries (`foliaBundledSources`) without a
//     built-in copy providing it: nothing may claim it.
//   - Takeover (the compliance plan). A source the installation does not carry may be claimed by a source mod
//     from the user's folders, with no signature and no version required. It is enabled the way any
//     third-party mod is. A signature that does not match (changed after signing) may not take over: that
//     source then runs under the mod's own id, `folium.<mod id>.<name>`. One short id goes to one mod: the
//     one the user confirmed first holds it (the loader keeps that record); the others' rows say who has it.
//   - Short ids. A built-in copy claims the short ids of its row in the trusted table (builtinSources.cjs),
//     and so does a signed override of it; a takeover claims what its manifest says. Every other source is
//     `folium.<mod id>.<name>`.

'use strict';

const { compareVersionStrings, satisfiesHostRange } = require('./manifest.cjs');

/** The id the host knows a mod's own (third-party) source by. */
const thirdPartySourceId = (modId, localId) => `folium.${modId}.${localId}`;

const NO_LEGACY = Object.freeze({ storeKeys: [], partitions: [], userDataDirs: [], native: [] });

const legacyOfRow = (row) => (row ? {
    storeKeys: [...row.storeKeys],
    partitions: [...row.partitions],
    userDataDirs: [...row.userDataDirs],
    native: [...row.native],
} : null);

const legacyOfClaims = (claims) => ({
    storeKeys: [...(claims.storeKeys ?? [])],
    partitions: [...(claims.partitions ?? [])],
    userDataDirs: [...(claims.userDataDirs ?? [])],
    native: [],
});

/*
 * Why `candidate` may not replace the built-in copy `builtin`, or null when it may. Checked in the order the
 * user can act on: the signature, the version, the host range, then the one confirmation.
 */
const overrideRefusal = (builtin, candidate, { hostVersion, isOverrideConfirmed }) => {
    if (candidate.signature?.status !== 'verified') return 'override-not-verified';
    if (compareVersionStrings(candidate.manifest.version, builtin.manifest.version) <= 0) return 'override-not-newer';
    if (candidate.manifest.folia && !satisfiesHostRange(hostVersion, candidate.manifest.folia)) return 'override-host-range';
    if (!isOverrideConfirmed(candidate.manifestId ?? candidate.manifest.id, candidate.digest)) return 'override-unconfirmed';
    return null;
};

/*
 * Why a takeover claim may not stand, or null when it may (plan §5.1, §12 item 9). The claimed id must be one the
 * trusted table knows (a source the host has carried as one of its own); the old data claimed must be that row's,
 * or part of it: the manifest's claims say again what the row says, so a claim can never reach another source's
 * sign-in or the host's own keys and folders. `sourceRow(shortId)` is the trusted row that claims the short id, or
 * null. An installation built without a row (plan §6.2, FOLIA_BUNDLED_SOURCES) has nothing to hold a claim to:
 * how such a claim is checked is S8's to settle; until then it is refused.
 */
const claimRefusal = (claims, sourceRow) => {
    const row = typeof claims?.id === 'string' ? sourceRow(claims.id) : null;
    if (!row) return 'claim-unknown-source';
    const within = (list, allowed) => (list ?? []).every((item) => allowed.includes(item));
    if (!within(claims.storeKeys, row.storeKeys) || !within(claims.partitions, row.partitions)
        || !within(claims.userDataDirs, row.userDataDirs)) {
        return 'claim-outside-row';
    }
    return null;
};

/**
 * builtins:   Map modId -> { manifest, dirPath } (valid built-in copies)
 * candidates: Map modId -> { manifest, dirPath, digest, signature, enabled } (valid copies from the other
 *             folders, in the order the loader read them)
 * bundled:    the short source ids the installation carries
 * options:    hostVersion; tableRow(modId) (builtinSources.cjs); sourceRow(shortId), the row that claims a short
 *             id; isOverrideConfirmed(modId, digest); claimRecord(shortId) -> the mod id that holds it, or null
 *
 * Returns:
 *   overrides       Map built-in modId -> the candidate modId that replaces it
 *   refused         Map candidate modId -> { reason, detail } (not run)
 *   pendingOverride Map candidate modId -> built-in modId, for a copy that only lacks the confirmation
 *   sources         Map modId -> [{ localId, sourceId, legacy, takeover, keepForMatching }] for every source mod
 *   notes           Map modId -> reasons that do not stop the mod (claim-signature-invalid, claim-unknown-source,
 *                   claim-outside-row, claim-unconfirmed)
 *   brokenInstall   the carried short ids no built-in copy provides
 *   claimHolders    Map short id -> modId that holds it now (for the loader to keep)
 */
const resolveSourceOwnership = (builtins, candidates, bundled, options) => {
    const { tableRow } = options;
    const bundledIds = new Set(bundled);
    const overrides = new Map();
    const refused = new Map();
    const pendingOverride = new Map();
    const notes = new Map();
    const claimHolders = new Map();

    // The short ids the built-in copies claim through their table rows.
    const builtinOfShortId = new Map();
    builtins.forEach((builtin, modId) => {
        const row = tableRow(modId);
        (builtin.manifest.sources ?? []).forEach((entry) => {
            if (row?.sources.includes(entry.id) && !builtinOfShortId.has(entry.id)) builtinOfShortId.set(entry.id, modId);
        });
    });
    const brokenInstall = [...bundledIds].filter((id) => !builtinOfShortId.has(id));

    const refuse = (modId, reason, detail = null) => {
        if (!refused.has(modId)) refused.set(modId, { reason, detail });
    };
    const note = (modId, reason) => notes.set(modId, [...(notes.get(modId) ?? []), reason]);

    // A candidate set against the built-in copy `builtinId`: replaces it, waits for its confirmation, or is refused.
    const tryOverride = (builtinId, candidateId, candidate) => {
        const refusal = overrideRefusal(builtins.get(builtinId), { ...candidate, manifestId: candidateId }, options);
        if (refusal === null && !overrides.has(builtinId)) {
            overrides.set(builtinId, candidateId);
            return;
        }
        if (refusal === null) {
            refuse(candidateId, 'override-superseded', overrides.get(builtinId));
            return;
        }
        if (refusal === 'override-unconfirmed') pendingOverride.set(candidateId, builtinId);
        refuse(candidateId, refusal, builtinId);
    };

    // Same id first: the copy meant to replace that very mod wins over a mod claiming its source.
    candidates.forEach((candidate, modId) => {
        if (builtins.has(modId)) tryOverride(modId, modId, candidate);
    });

    // Claims: against a carried source, the override rule; else a takeover candidate, one holder per id.
    const takeoverCandidates = new Map(); // short id -> [modId]
    const claimedOverride = new Map(); // candidate modId -> built-in modId it replaces by claim
    candidates.forEach((candidate, modId) => {
        if (builtins.has(modId) || !candidate.manifest.sources) return;
        candidate.manifest.sources.forEach((entry) => {
            if (!entry.claims) return;
            const shortId = entry.claims.id;
            if (bundledIds.has(shortId)) {
                const builtinId = builtinOfShortId.get(shortId);
                if (!builtinId) {
                    refuse(modId, 'bundled-source-missing', shortId);
                    return;
                }
                tryOverride(builtinId, modId, candidate);
                if (overrides.get(builtinId) === modId) claimedOverride.set(modId, builtinId);
                return;
            }
            if (candidate.signature?.status === 'invalid') {
                note(modId, 'claim-signature-invalid');
                return;
            }
            const refusal = claimRefusal(entry.claims, options.sourceRow);
            if (refusal) {
                note(modId, refusal);
                return;
            }
            takeoverCandidates.set(shortId, [...(takeoverCandidates.get(shortId) ?? []), modId]);
        });
    });

    /*
     * Only the holder on record holds a short id: the one whose enable (or "Settings → Sources") confirmation
     * named the takeover. A short id nobody holds goes to nobody by itself, not even to a claimant that is
     * enabled: its confirmation never named the takeover (it was enabled while another held the id, or while the
     * installation carried the source). Each claimant not yet enabled is described as taking it over, so the
     * confirmation that would make it the holder says what it takes over; an enabled one runs under its own id
     * until the user confirms it again.
     */
    const unheld = new Map();
    takeoverCandidates.forEach((modIds, shortId) => {
        const live = modIds.filter((modId) => !refused.has(modId));
        const recorded = options.claimRecord(shortId);
        const holder = live.includes(recorded) ? recorded : null;
        if (holder === null) {
            const waiting = live.filter((modId) => !candidates.get(modId).enabled);
            live.filter((modId) => candidates.get(modId).enabled).forEach((modId) => note(modId, 'claim-unconfirmed'));
            unheld.set(shortId, waiting);
            return;
        }
        claimHolders.set(shortId, holder);
        live.filter((modId) => modId !== holder).forEach((modId) => refuse(modId, 'claim-taken', holder));
    });

    // What each source mod's sources are called, and what old data each may reach.
    const sources = new Map();
    const describe = (modId, manifest, { row = null, keepForMatching = false, claimsAsLegacy = false, claimOverrideRow = null }) => (
        manifest.sources.map((entry) => {
            if (row?.sources.includes(entry.id)) {
                return { localId: entry.id, sourceId: entry.id, legacy: legacyOfRow(row), takeover: false, keepForMatching: keepForMatching && entry.keepForMatching === true };
            }
            if (entry.claims && claimOverrideRow?.sources.includes(entry.claims.id)) {
                return { localId: entry.id, sourceId: entry.claims.id, legacy: legacyOfRow(claimOverrideRow), takeover: false, keepForMatching: keepForMatching && entry.keepForMatching === true };
            }
            const claimsIt = entry.claims && (claimHolders.get(entry.claims.id) === modId || unheld.get(entry.claims.id)?.includes(modId));
            if (claimsAsLegacy && claimsIt) {
                return { localId: entry.id, sourceId: entry.claims.id, legacy: legacyOfClaims(entry.claims), takeover: true, keepForMatching: false };
            }
            return { localId: entry.id, sourceId: thirdPartySourceId(modId, entry.id), legacy: null, takeover: false, keepForMatching: false };
        })
    );
    builtins.forEach((builtin, modId) => {
        if (builtin.manifest.sources) sources.set(modId, describe(modId, builtin.manifest, { row: tableRow(modId), keepForMatching: true }));
    });
    candidates.forEach((candidate, modId) => {
        if (!candidate.manifest.sources) return;
        const replaced = overrides.has(modId) && overrides.get(modId) === modId;
        // A copy of a built-in mod that did not replace it does not run: the built-in copy's row stands.
        if (builtins.has(modId) && !replaced) return;
        sources.set(modId, describe(modId, candidate.manifest, {
            row: replaced ? tableRow(modId) : null,
            keepForMatching: replaced || claimedOverride.has(modId),
            claimsAsLegacy: true,
            claimOverrideRow: claimedOverride.has(modId) ? tableRow(claimedOverride.get(modId)) : null,
        }));
    });

    return { overrides, refused, pendingOverride, sources, notes, brokenInstall, claimHolders };
};

module.exports = { resolveSourceOwnership, thirdPartySourceId, overrideRefusal, claimRefusal, NO_LEGACY };
