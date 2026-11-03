// src/utils/lyrics/lyricSources.ts
// The table of lyric sources: one entry for each place a song's lyric can be taken from. Every
// list of sources, their order, their names and every check about a source is read from here.
// This file imports nothing, so that a store and the types can read it; how a source is searched
// and fetched is in lyricMatchSources.ts.
//
// To add a source: add its entry here, and its name to each locale file under its `labelKey`.
// A source that is an online platform is searched and fetched through that platform's registered
// provider; lyricMatchSources.ts needs an entry only for a source that is reached another way.
// A source that is not a platform (as AMLL DB) needs two more things: that entry in
// lyricMatchSources.ts, and a step of its own in autoMatchBestLyric.ts, where the automatic pick
// passes it over until it has one.

interface LyricSourceEntry {
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
const ENTRIES = [
    { id: 'netease', labelKey: 'lyricProvider.netease', platform: true, localMetadataIdentity: true },
    { id: 'amll', labelKey: 'lyricProvider.amll', platform: false },
    { id: 'qq', labelKey: 'lyricProvider.qq', platform: true, localMetadataIdentity: true },
    { id: 'kugou', labelKey: 'lyricProvider.kugou', platform: true, localMetadataIdentity: true },
    { id: 'qishui', labelKey: 'lyricProvider.qishui', platform: true, localMetadataIdentity: true, needsConfiguredProvider: true },
    { id: 'spotify', labelKey: 'lyricProvider.spotify', platform: true, needsAccount: true, linesOnly: true },
] as const satisfies readonly LyricSourceEntry[];

export type LyricProviderSource = (typeof ENTRIES)[number]['id'];
export type PlatformLyricSource = Extract<(typeof ENTRIES)[number], { platform: true }>['id'];

export interface LyricSource extends LyricSourceEntry {
    id: LyricProviderSource;
}

export const LYRIC_SOURCES: readonly LyricSource[] = ENTRIES;

export const LYRIC_SOURCE_IDS: readonly LyricProviderSource[] = LYRIC_SOURCES.map(source => source.id);

const sourcesById = new Map<unknown, LyricSource>(LYRIC_SOURCES.map(source => [source.id, source]));

export const isLyricProviderSource = (value: unknown): value is LyricProviderSource => sourcesById.has(value);

export const getLyricSource = (id: LyricProviderSource): LyricSource => sourcesById.get(id) as LyricSource;

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
