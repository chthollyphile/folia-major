import type { AmllDbPlatform, SongResult } from '../../types';
import type { ChorusRange, ProviderLyricsResult } from '../../types/onlineMusic';

// src/utils/lyrics/lyricSources.ts
// The registry of lyric sources: one entry for each place a song's lyric can be taken from. Every
// list of sources, their order, their names and every check about a source is read from here.
// This file imports nothing at run time, so that a store and the types can read it; how a source is
// searched and fetched is in lyricMatchSources.ts.
//
// Folium 2.0 seam (S1): the registry is open (`registerLyricSource`), and a source's id is an open
// string, stored as it is. Today it is fed from the table below, in this order; a platform adds how it is
// reached where that differs from its provider (`registerLyricSourceAccess`, from the platform's own
// folder). In S3 a source mod registers its entry and access itself, through its lyrics capability, and
// the platform rows of the table go. A source that is not registered, or whose platform is not there, is a
// missing entry: a stored choice of it is kept and is in force again once it is back; meanwhile the next
// source is used (crossSource.ts).
//
// To add a source: register its entry, and its name to each locale file under its `labelKey`.
// A source that is an online platform is searched and fetched through that platform's registered
// provider; it registers access of its own only where it is reached another way.
// A source that is not a platform (as AMLL DB) needs two more things: its access in
// lyricMatchSources.ts, and a step of its own in autoMatchBestLyric.ts, where the automatic pick
// passes it over until it has one.

export interface LyricSourceEntry {
    /** Stored as text with the preferred-source setting and with a song's lyric choice: never rename one. */
    id: string;
    /** Locale key of the name shown for the source. */
    labelKey: string;
    /**
     * True when the source is an online platform's own catalogue, under that platform's provider
     * id: a song of the platform has these lyrics as its own, and the match windows search the
     * source by the words typed. False for AMLL DB, which keeps lyrics under NetEase and QQ song
     * ids and is reached through those two.
     */
    platform: boolean;
    /** Selected local-song metadata from this source may resume automatic matching and refresh legacy lyrics. */
    localMetadataIdentity?: boolean;
    /**
     * True when the source's search matches a local song's online details (the metadata match: the automatic
     * one, in this order, and the tabs of the match dialog). Folium 2.0 S3: the source's `songs@1.metadataMatch`.
     */
    metadataMatch?: boolean;
    /** True when the source answers only with the listener's own account: it is on offer only while one is signed in. */
    needsAccount?: boolean;
    /** True when this source requires its provider's runtime bridge or configuration. */
    needsConfiguredProvider?: boolean;
    /**
     * True when its lyrics are timed by line only and come with no chorus data. The automatic pick
     * asks such a source only while no other source has given lines, keeps what it gives as the
     * fallback and nothing more, and takes no chorus data from a song of that platform.
     */
    linesOnly?: boolean;
}

// In the order the automatic pick asks them after the preferred one, which is also the order of
// the tabs in the match windows and of the choices in settings.
const BUILT_IN_ENTRIES = [
    { id: 'netease', labelKey: 'lyricProvider.netease', platform: true, localMetadataIdentity: true, metadataMatch: true },
    { id: 'amll', labelKey: 'lyricProvider.amll', platform: false },
    { id: 'qq', labelKey: 'lyricProvider.qq', platform: true, localMetadataIdentity: true, metadataMatch: true },
    { id: 'kugou', labelKey: 'lyricProvider.kugou', platform: true, localMetadataIdentity: true, metadataMatch: true },
    { id: 'qishui', labelKey: 'lyricProvider.qishui', platform: true, localMetadataIdentity: true, needsConfiguredProvider: true },
    { id: 'spotify', labelKey: 'lyricProvider.spotify', platform: true, needsAccount: true, linesOnly: true },
    // Apple's timed lyrics are TTML: word-level where Apple supplies it, line-level otherwise, and
    // the parsed lyric says which. The companion must be there to ask.
    { id: 'appleMusic', labelKey: 'lyricProvider.appleMusic', platform: true, needsAccount: true, needsConfiguredProvider: true },
] as const satisfies readonly LyricSourceEntry[];

/** The ids of the sources the host knows by name. Any other id is a source all the same. */
export type KnownLyricProviderSource = (typeof BUILT_IN_ENTRIES)[number]['id'];
/** A lyric source's id: stored as text, open to sources registered later. */
export type LyricProviderSource = KnownLyricProviderSource | (string & {});
export type PlatformLyricSource = Extract<(typeof BUILT_IN_ENTRIES)[number], { platform: true }>['id'];

export interface LyricSource extends LyricSourceEntry {
    id: LyricProviderSource;
}

// What a source gives for one song. A lyric from AMLL DB names the platform it was kept under.
export type LyricSourceLyrics = ProviderLyricsResult & { matchedLyricsProviderPlatform?: AmllDbPlatform };

export type LyricMatchSearchTarget = {
    title: string;
    artist: string;
    durationMs: number;
    album?: string;
};

export interface LyricSourceAccess {
    /**
     * The source's songs for `query`, `limit` of them at most. `target` is the song being matched,
     * for a source that has to choose its candidates itself.
     */
    search(query: string, limit: number, target: LyricMatchSearchTarget): Promise<SongResult[]>;
    /**
     * The lyrics of one of the source's songs, or null when the source cannot be asked.
     * `lent.chorusRanges` are chorus ranges found elsewhere, for a fetch that marks the chorus itself.
     */
    fetch(song: SongResult, lent: { chorusRanges: ChorusRange[] }): Promise<LyricSourceLyrics | null>;
    /** What the source knows a song by, as text: two songs with one key are the same song there. */
    songKey(song: Pick<SongResult, 'id' | 'qqMid' | 'kgHash'>): string;
    /**
     * Set when a song's id alone is enough to fetch its lyrics: gives the id to fetch with, or
     * null when `songId` cannot be one of the source's. Without it, a song picked for the source
     * is looked for among the source's search results.
     */
    knownById?(songId: number | string): number | string | null;
    /** True when the chorus ranges it gives are kept, to be lent to a fetch that marks the chorus itself. */
    sharesChorusRanges?: boolean;
    /** True when its fetch has marked the chorus already, from the ranges lent to it or from its own text. */
    marksChorusOnFetch?: boolean;
}

const sources: LyricSource[] = [];
const sourcesById = new Map<unknown, LyricSource>();
const ownAccessById = new Map<string, Partial<LyricSourceAccess>>();
let registryVersion = 0;

/**
 * Adds a lyric source at the end of the order, or replaces the entry of the same id where it stands.
 * Returns the function that takes it out again.
 */
export const registerLyricSource = (entry: LyricSourceEntry): (() => void) => {
    const source: LyricSource = Object.freeze({ ...entry });
    const at = sources.findIndex(known => known.id === source.id);
    if (at >= 0) sources[at] = source;
    else sources.push(source);
    sourcesById.set(source.id, source);
    registryVersion += 1;
    return () => {
        if (sourcesById.get(source.id) !== source) return;
        sources.splice(sources.indexOf(source), 1);
        sourcesById.delete(source.id);
        registryVersion += 1;
    };
};

/**
 * How a source is reached where it differs from searching and fetching through its platform's provider
 * (its own lyric service, ids it knows songs by). Registered from that platform's own folder; replaces an earlier one.
 */
export const registerLyricSourceAccess = (id: string, access: Partial<LyricSourceAccess>): void => {
    ownAccessById.set(id, access);
    registryVersion += 1;
};

/** The source's own access (registerLyricSourceAccess), if it registered one. */
export const getLyricSourceOwnAccess = (id: string): Partial<LyricSourceAccess> | undefined => ownAccessById.get(id);

/** Bumped by every registration and removal (entries and access). */
export const getLyricSourceRegistryVersion = (): number => registryVersion;

BUILT_IN_ENTRIES.forEach(entry => registerLyricSource(entry));

/** The registered sources, in order. A live view: read it when needed. */
export const LYRIC_SOURCES: readonly LyricSource[] = sources;

/** The registered sources' ids, in order. */
export const getLyricSourceIds = (): LyricProviderSource[] => sources.map(source => source.id);

/** Whether `value` names a registered source. A stored id that is not registered is a missing entry, not an error. */
export const isLyricProviderSource = (value: unknown): value is LyricProviderSource => sourcesById.has(value);

/** Whether `value` can be a source's id at all: a stored choice of one is kept, registered now or not. */
export const isLyricSourceId = (value: unknown): value is LyricProviderSource => (
    typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value)
);

/** The registered entry of `id`; undefined for a missing one (its platform not there, a mod not loaded yet). */
export const getLyricSource = (id: LyricProviderSource): LyricSource | undefined => sourcesById.get(id);

/**
 * The source that is the online platform `providerId`: the one whose lyrics a song of that
 * platform has as its own. None for a platform that is not a lyric source (Bodian, YouTube Music).
 */
export const getPlatformLyricSource = (
    providerId: string | null | undefined,
): (LyricSource & { id: PlatformLyricSource }) | undefined => {
    const source = sourcesById.get(providerId);
    return source?.platform ? source as LyricSource & { id: PlatformLyricSource } : undefined;
};
