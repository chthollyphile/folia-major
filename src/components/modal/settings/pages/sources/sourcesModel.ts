import type { ModRuntimeInfo, ModSourceState, ModSourceStateRow, ModSourceUsageResult, ModTier } from '../../../../../mods/types';

// src/components/modal/settings/pages/sources/sourcesModel.ts
// What "Settings → Sources" (Folium 2.0 plan §5.3) shows, worked out from the main process's source states and the
// mod list: one row per source, in the order every list of sources follows, and the notes the loader left about
// takeovers and overrides (plan §5.1), each with the action that settles it where there is one. No React here.

/** How a source runs now, in the words the row uses. */
export type SourceRunState =
    /** Still registered by the host (not a mod yet): switching it only changes where it shows. */
    | 'host'
    | 'running'
    | 'starting'
    | 'stopped'
    | 'failed'
    | 'off'
    /** Its whole mod is switched off on the Mods page: nothing of it runs whatever its state here. */
    | 'mod-off';

export interface SourceRowModel {
    sourceId: string;
    /** The mod that provides it; null for one the host registers itself. */
    modId: string | null;
    /** The name the mod's manifest gives it (the name shown in every state); null for the host's. */
    manifestName: string | Record<string, string> | null;
    tier: ModTier | 'host';
    state: ModSourceState;
    /** It may be used only for matching (the middle of its three states can be chosen; the palette offers that command). */
    threeStates: boolean;
    /** Whether it is known if it may be used only for matching (false for a source that never ran here). */
    matchOnlyKnown: boolean;
    takeover: boolean;
    run: SourceRunState;
    /** The loader's error for a source mod that did not start. */
    error: string | null;
    /** "Clear data" works: only a source mod's data is listed in the trusted table or its claims. */
    clearable: boolean;
    /** It accepts a self-signed certificate from a server the user enters (its manifest says so); the row tells. */
    selfSignedUserServers: boolean;
    /** What its manifest says where it is switched on (`sources[].enableNotice`); null for none. */
    enableNotice: string | Record<string, string> | null;
}

export interface SourceRowInputs {
    /** Whether a source may be used only for matching (sourceStates.canSourceMatchOnly). */
    canMatchOnly: (sourceId: string) => boolean;
    /** Whether `canMatchOnly` has an answer (sourceStates.knowsWhetherSourceMatchesOnly); always, when not given. */
    knowsMatchOnly?: (sourceId: string) => boolean;
    /** The ids in the registry's order (omni.sortSourceIds). */
    sort: (ids: readonly string[]) => string[];
}

const runOf = (row: ModSourceStateRow, mod: ModRuntimeInfo | undefined): SourceRunState => {
    if (row.tier === 'host') return 'host';
    if (row.state === 'disabled') return 'off';
    if (mod && !mod.enabled) return 'mod-off';
    if (mod?.status === 'error') return 'failed';
    if (row.mainState === 'activating') return 'starting';
    return row.loaded ? 'running' : 'stopped';
};

/** The rows of the page: every source the main process knows, in the registry's order. */
export const buildSourceRows = (
    sources: readonly ModSourceStateRow[],
    mods: readonly ModRuntimeInfo[],
    inputs: SourceRowInputs,
): SourceRowModel[] => {
    const modsById = new Map(mods.map(mod => [mod.id, mod]));
    const rowsById = new Map(sources.map(row => [row.sourceId, row]));
    return inputs.sort([...rowsById.keys()]).flatMap((sourceId) => {
        const row = rowsById.get(sourceId);
        if (!row) return [];
        const mod = row.modId ? modsById.get(row.modId) : undefined;
        const manifestEntry = mod?.sources?.find(source => source.id === sourceId);
        const run = runOf(row, mod);
        return [{
            sourceId,
            modId: row.modId,
            // The mod list's copy of the manifest, else the main process's (it lists a source whose mod is not loaded).
            manifestName: manifestEntry?.name ?? row.name ?? null,
            tier: row.tier,
            state: row.state,
            // A source already used only for matching keeps the three, so it can be switched back.
            threeStates: row.state === 'matching' || inputs.canMatchOnly(sourceId),
            matchOnlyKnown: row.state === 'matching' || (inputs.knowsMatchOnly?.(sourceId) ?? true),
            takeover: row.takeover,
            run,
            error: run === 'failed' ? mod?.error ?? null : null,
            clearable: row.tier !== 'host' && row.modId !== null,
            selfSignedUserServers: row.selfSignedUserServers === true,
            enableNotice: row.enableNotice ?? null,
        }];
    });
};

/** The name a mod's manifest gives a source: the text of `language`, else English, else the first given. */
export const manifestSourceName = (name: string | Record<string, string> | null, language: string, fallback: string): string => {
    if (typeof name === 'string') return name || fallback;
    if (!name) return fallback;
    const base = language.split('-')[0];
    const texts: Partial<Record<string, string>> = name;
    return texts[language] ?? texts[base] ?? texts.en ?? Object.values(texts)[0] ?? fallback;
};

/** The answers the user chose themselves (a cancelled confirmation): not reported as failures. */
export const SILENT_SOURCE_ERRORS: ReadonlySet<string> = new Set(['clear-declined', 'enable-declined', 'override-declined']);

/**
 * The reason a switch, a clear or a notice action failed, in words: the text of the code (`<code>:<detail>`), or
 * "unknown reason" with the code after it for one without its own text, never the bare code.
 */
export const sourceErrorReason = (
    error: string | undefined,
    t: (key: string) => string,
    exists: (key: string) => boolean,
): string => {
    const code = (error ?? 'unknown').split(':')[0];
    return exists(`sourcesSettings.errors.${code}`)
        ? t(`sourcesSettings.errors.${code}`)
        : `${t('sourcesSettings.errors.unknown')} (${error ?? ''})`;
};

export type SourceNoticeKind =
    | 'claim-unconfirmed'
    | 'claim-taken'
    | 'claim-signature-invalid'
    | 'claim-unknown-source'
    | 'claim-outside-row'
    | 'override-unconfirmed'
    | 'override-not-verified'
    | 'override-not-newer'
    | 'override-host-range'
    | 'override-superseded'
    | 'bundled-source-missing'
    | 'shadowed'
    | 'override-running';

/** What a notice's button does; the main process asks the user before it changes anything. */
export type SourceNoticeAction =
    | { kind: 'assign-claim'; shortId: string; modId: string }
    | { kind: 'confirm-override'; modId: string };

export interface SourceNotice {
    kind: SourceNoticeKind;
    modId: string;
    modName: string;
    /** The short source id it is about, where there is one. */
    sourceId: string | null;
    /** The other mod it names (who holds the id, who replaces the built-in copy). */
    otherModId: string | null;
    /** That mod's name as the list has it (its id when it is not listed). */
    otherModName: string | null;
    /** The version of the other copy, for an override. */
    version: string | null;
    action: SourceNoticeAction | null;
}

const CLAIM_NOTE_KINDS: readonly SourceNoticeKind[] = ['claim-unconfirmed', 'claim-signature-invalid', 'claim-unknown-source', 'claim-outside-row'];
const BLOCKED_KINDS: readonly SourceNoticeKind[] = [
    'claim-taken', 'override-unconfirmed', 'override-not-verified', 'override-not-newer', 'override-host-range', 'override-superseded', 'bundled-source-missing',
];

// The short ids a mod's manifest claims (the first one stands for a refusal that does not name it).
const claimedIds = (mod: ModRuntimeInfo): string[] => [...new Set((mod.sources ?? []).map(source => source.claims).filter((id): id is string => Boolean(id)))];

/**
 * The notes the loader left about who takes over or replaces which source (electron/modSystem/sourceOwnership.cjs):
 * a mod's `notes`, the refusal a mod was blocked with (`error`, `<reason>:<detail>`), a built-in copy's other copy
 * that is not the one running (`alternate`), and a built-in copy another mod replaces (`shadowedBy`).
 */
export const buildSourceNotices = (mods: readonly ModRuntimeInfo[]): SourceNotice[] => {
    const notices: SourceNotice[] = [];
    const nameOf = (modId: string) => mods.find(mod => mod.id === modId)?.name ?? modId;
    const add = (mod: ModRuntimeInfo, kind: SourceNoticeKind, extra: Partial<SourceNotice> = {}) => {
        const otherModId = extra.otherModId ?? null;
        notices.push({
            kind, modId: mod.id, modName: mod.name, sourceId: null, version: null, action: null, ...extra,
            otherModId, otherModName: otherModId ? nameOf(otherModId) : null,
        });
    };

    mods.forEach((mod) => {
        const claims = claimedIds(mod);
        // One note per short id it could not take over; each kind is said once here.
        [...new Set(mod.notes ?? [])].forEach((note) => {
            const kind = CLAIM_NOTE_KINDS.find(candidate => candidate === note);
            if (!kind) return;
            if (kind === 'claim-unconfirmed') {
                claims.forEach(shortId => add(mod, kind, { sourceId: shortId, action: { kind: 'assign-claim', shortId, modId: mod.id } }));
                if (claims.length === 0) add(mod, kind);
                return;
            }
            add(mod, kind, { sourceId: claims[0] ?? null });
        });

        if (mod.status === 'error' && mod.error) {
            const split = mod.error.indexOf(':');
            const reason = split >= 0 ? mod.error.slice(0, split) : mod.error;
            const detail = split >= 0 ? mod.error.slice(split + 1) : null;
            const kind = BLOCKED_KINDS.find(candidate => candidate === reason);
            if (kind === 'claim-taken') {
                const shortId = claims[0] ?? null;
                add(mod, kind, {
                    sourceId: shortId,
                    otherModId: detail,
                    action: shortId ? { kind: 'assign-claim', shortId, modId: mod.id } : null,
                });
            } else if (kind === 'bundled-source-missing') {
                add(mod, kind, { sourceId: detail });
            } else if (kind) {
                // A claim that would replace a carried built-in copy: `detail` is that built-in mod.
                add(mod, kind, {
                    sourceId: claims[0] ?? null,
                    otherModId: detail,
                    version: mod.version,
                    action: kind === 'override-unconfirmed' ? { kind: 'confirm-override', modId: mod.id } : null,
                });
            }
        }

        // A built-in copy with a same-id copy in the user's folder that does not run, and why.
        const alternate = mod.alternate;
        if (mod.tier === 'builtin' && alternate?.reason) {
            const kind = BLOCKED_KINDS.find(candidate => candidate === alternate.reason);
            if (kind) {
                add(mod, kind, {
                    version: alternate.version,
                    action: kind === 'override-unconfirmed' ? { kind: 'confirm-override', modId: mod.id } : null,
                });
            }
        }
        if (mod.tier === 'override' && alternate?.tier === 'builtin') add(mod, 'override-running', { version: mod.version });
        if (mod.shadowedBy) add(mod, 'shadowed', { otherModId: mod.shadowedBy });
    });

    return notices;
};

/*
 * The disk use a row shows, or null for none: not measured yet, not measurable (the main process could not read a
 * folder, or the page has no bridge), or nothing kept at all. An answer that is not a measure is never shown as 0.
 */
export const shownSourceUsage = (usage: ModSourceUsageResult | undefined): { data: number; cache: number } | null => {
    if (!usage?.ok) return null;
    const data = usage.data;
    const cache = usage.cache;
    if (typeof data !== 'number' || typeof cache !== 'number' || !Number.isFinite(data) || !Number.isFinite(cache)) return null;
    if (data < 0 || cache < 0 || data + cache === 0) return null;
    return { data, cache };
};
