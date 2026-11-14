import type { ProviderCapabilities } from '@/types/onlineMusic';
import type { SourceDeclaration } from '@/services/onlineMusic/sourceDeclarations';
import type {
    FoliumSourceAudioPlayback,
    FoliumSourceAuth,
    FoliumSourceCapabilities,
    FoliumSourceCatalog,
    FoliumSourceCovers,
    FoliumSourceDef,
    FoliumSourceExplore,
    FoliumSourceExternalPlayback,
    FoliumSourceLibrary,
    FoliumSourceLyrics,
    FoliumSourceMutations,
    FoliumSourceRaw,
    FoliumSourceRecommendations,
    FoliumSourceReports,
    FoliumSourceSearch,
    FoliumSourceSongs,
} from '../../sources/contract';
import {
    FOLIUM_CUSTOM_CAPABILITY_PATTERN,
    FOLIUM_SOURCE_REQUIRED_MEMBERS,
    isFoliumStandardCapability,
    parseFoliumCapabilityKey,
    supportsFoliumCapability,
    type FoliumStandardCapability,
} from '../../sources/capabilities';

// src/mods/folium/registries/sourceAdapter/parts.ts
// Reading a source's `capabilities` (plan §4.1): which standard capabilities the host takes (the ones it
// implements, each with the members it must have), the custom ones of the mod's own, and what is said in the
// mod's row about the rest. From what is taken: the host's capability flags (matrix §3) and the declarations the
// cross-source features read (plan §4.7).

/** The standard capabilities a source's definition has, as the host takes them, and its custom ones. */
export interface FoliumSourceParts {
    search?: FoliumSourceSearch;
    songs?: FoliumSourceSongs;
    audio?: FoliumSourceAudioPlayback;
    external?: FoliumSourceExternalPlayback;
    reports?: FoliumSourceReports;
    lyrics?: FoliumSourceLyrics;
    auth?: FoliumSourceAuth;
    library?: FoliumSourceLibrary;
    catalog?: FoliumSourceCatalog;
    recommendations?: FoliumSourceRecommendations;
    explore?: FoliumSourceExplore;
    mutations?: FoliumSourceMutations;
    covers?: FoliumSourceCovers;
    raw?: FoliumSourceRaw;
    custom: Map<string, unknown>;
}

type PartName = Exclude<keyof FoliumSourceParts, 'custom'>;

const PART_OF: Partial<Record<FoliumStandardCapability, PartName>> = {
    search: 'search',
    songs: 'songs',
    'playback.audio': 'audio',
    'playback.external': 'external',
    reports: 'reports',
    lyrics: 'lyrics',
    auth: 'auth',
    library: 'library',
    catalog: 'catalog',
    recommendations: 'recommendations',
    explore: 'explore',
    mutations: 'mutations',
    covers: 'covers',
    raw: 'raw',
};

// The members a capability must have that are values, not functions.
const VALUE_MEMBERS = new Set(['backend', 'reservedParams', 'hosts']);

const has = (object: object | undefined, member: string): boolean => (
    object !== undefined && typeof (object as Record<string, unknown>)[member] === 'function'
);

/**
 * Reads a definition's `capabilities` (getters included, read now). What the host cannot take is told through
 * `warn`: a key that is no capability id, a standard one this host does not implement at that version
 * (`playback.surface@1` among them), a custom one not named after `modId`, one that is not an object, or one
 * without a member it must have.
 */
export const readFoliumSourceParts = (
    modId: string,
    capabilities: FoliumSourceCapabilities,
    warn: (message: string) => void,
): FoliumSourceParts => {
    const parts: FoliumSourceParts = { custom: new Map() };
    const taken = parts as unknown as Record<PartName, unknown>;
    for (const key of Object.keys(capabilities)) {
        const value: unknown = (capabilities as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (key.startsWith('x.')) {
            if (!FOLIUM_CUSTOM_CAPABILITY_PATTERN.test(key) || !key.startsWith(`x.${modId}.`)) {
                warn(`capability "${key}" is left out: a custom capability is named x.${modId}.<name>@<version>`);
            } else {
                parts.custom.set(key, value);
            }
            continue;
        }
        const parsed = parseFoliumCapabilityKey(key);
        if (!parsed || !isFoliumStandardCapability(parsed.id)) {
            warn(`capability "${key}" is left out: this host knows no such capability`);
            continue;
        }
        const part = PART_OF[parsed.id];
        if (!supportsFoliumCapability(parsed.id, parsed.version) || !part) {
            warn(`capability "${key}" is left out: this host does not implement it`);
            continue;
        }
        if (typeof value !== 'object' || value === null) {
            warn(`capability "${key}" is left out: it must be an object`);
            continue;
        }
        const missing = FOLIUM_SOURCE_REQUIRED_MEMBERS[parsed.id].find((member) => (
            VALUE_MEMBERS.has(member) ? (value as Record<string, unknown>)[member] === undefined : !has(value, member)
        ));
        if (missing) {
            warn(`capability "${key}" is left out: it has no ${missing}`);
            continue;
        }
        taken[part] = value;
    }
    return parts;
};

/** The host's capability flags of a source with `parts` (plan §4.1, the member matrix §3). */
export const deriveFoliumSourceCapabilities = (parts: FoliumSourceParts): ProviderCapabilities => ({
    search: Boolean(parts.search),
    playback: Boolean(parts.audio),
    lyrics: Boolean(parts.lyrics),
    auth: Boolean(parts.auth),
    userLibrary: Boolean(parts.library),
    playlists: has(parts.catalog, 'getPlaylistTracks'),
    albums: has(parts.catalog, 'getAlbumTracks'),
    artists: has(parts.catalog, 'getArtistDetail'),
    recommendations: Boolean(parts.recommendations),
    mutations: Boolean(parts.mutations),
    personalFmModes: parts.recommendations?.personalFmModes === true,
    // Nothing in the host reads it; a source's lyrics may be word-timed, as Folium 1's adapter says too.
    wordByWordLyrics: Boolean(parts.lyrics),
    historyRecommendations: has(parts.recommendations, 'getHistoryDates'),
    dailyStyleRecommendations: has(parts.recommendations, 'getDailyStyleGroups'),
    recommendationPreferences: has(parts.recommendations, 'getRecommendationPreferences')
        && has(parts.recommendations, 'saveRecommendationPreferences'),
    playlistSubscription: has(parts.mutations, 'subscribePlaylist'),
    playlistTrackMutations: has(parts.mutations, 'updatePlaylistTracks'),
    likes: has(parts.mutations, 'likeSong'),
    userAlbums: has(parts.library, 'getUserAlbums'),
    playbackReports: Boolean(parts.reports),
    explore: Boolean(parts.explore),
    externalPlayback: Boolean(parts.external),
    songDetail: Boolean(parts.songs),
});

const accessOf = (value: unknown): 'anonymous' | 'account' => (value === 'account' ? 'account' : 'anonymous');

/** What the source declares for the cross-source features (sourceDeclarations.ts), from `parts`. */
export const deriveFoliumSourceDeclaration = (def: Pick<FoliumSourceDef, 'getAvailability'>, parts: FoliumSourceParts): SourceDeclaration => ({
    ...(parts.search ? { search: { access: accessOf(parts.search.access) } } : {}),
    ...(parts.songs ? { songs: { access: accessOf(parts.songs.access), metadataMatch: parts.songs.metadataMatch === true && Boolean(parts.search) } } : {}),
    ...(parts.lyrics ? {
        lyrics: {
            access: accessOf(parts.lyrics.access),
            // Its lyrics reach other songs through its search: without one, it has no songs to match against.
            crossSource: parts.lyrics.crossSource && parts.search ? { linesOnly: parts.lyrics.crossSource.linesOnly === true } : null,
        },
    } : {}),
    checksAvailability: typeof def.getAvailability === 'function',
});
