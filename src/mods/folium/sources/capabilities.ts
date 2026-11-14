// src/mods/folium/sources/capabilities.ts
// The table of Folium 2.0 source capabilities (plan §4.1): the standard ids, the versions this host
// implements, and the members each version has. Pure data and string work, with no import at all: no
// React, store, DOM or Electron, and `npm run folium:check` reads it as it is. The main process reads the
// same versions from foliumShared.json `sourceCapabilities` (to refuse a manifest whose `sources[].requires`
// it cannot meet); test/unit/mod-system/foliumShared.test.ts holds the two to each other. The adapter
// (registries/sources.ts) reads the members to tell a capability's flags; `folium.sources.supports`
// answers from the versions.

/** The versions of each standard capability this host implements; `playback.surface` is known and not implemented yet. */
export const FOLIUM_SOURCE_CAPABILITY_VERSIONS = Object.freeze({
    search: [1],
    songs: [1],
    'playback.audio': [1],
    'playback.external': [1],
    'playback.surface': [],
    reports: [1],
    lyrics: [1],
    auth: [1],
    library: [1],
    catalog: [1],
    recommendations: [1],
    explore: [1],
    mutations: [1],
    covers: [1],
    raw: [1],
} satisfies Record<string, readonly number[]>);

/** The standard capability ids, without their version. */
export type FoliumStandardCapability = keyof typeof FOLIUM_SOURCE_CAPABILITY_VERSIONS;

/** The members of each standard capability at version 1, in the order the contract lists them. */
export const FOLIUM_SOURCE_CAPABILITY_MEMBERS: Readonly<Record<FoliumStandardCapability, readonly string[]>> = Object.freeze({
    search: ['access', 'searchSongs', 'searchAlbums', 'searchPlaylists'],
    songs: ['access', 'metadataMatch', 'getSong', 'getSongs', 'songsPerRequest', 'getAvailability', 'getReplacement', 'getPlayedSong', 'getPageUrl'],
    'playback.audio': ['getAudioSource', 'audioQualityLevels', 'previewNotice', 'keepAudio', 'hasKeptAudio'],
    'playback.external': [
        'canPlay', 'prepareNext', 'isPrepared', 'play', 'adopt', 'pause', 'resume', 'seek', 'setVolume', 'setRepeatOne',
        'getStatus', 'isStatusForSong',
    ],
    'playback.surface': [
        'canPlay', 'prepareNext', 'isPrepared', 'play', 'adopt', 'pause', 'resume', 'seek', 'setVolume', 'setRepeatOne',
        'getStatus', 'isStatusForSong', 'mount',
    ],
    reports: ['canReport', 'report'],
    lyrics: ['access', 'crossSource', 'getLyrics', 'prefersOwnWordByWord', 'getChorusRanges', 'getSearchAlias', 'getAlternateArtistName'],
    auth: [
        'getLoginStatus', 'logout', 'signInRanOut', 'showsKeptAccountAtStart', 'oldKeptAccount', 'forgetOldKeptAccount',
        'getLoginTexts', 'localService', 'getLoginMethods', 'resolveLoginMethods', 'startLogin', 'getLoginForm',
        'submitLoginForm', 'describeLoginFailure', 'createQr', 'openLoginPage', 'opensLoginPageItself', 'checkLogin',
        'cancelLogin', 'getLoginTtlMs', 'getLoginDiagnostics', 'canRunLoginSelfCheck', 'runLoginSelfCheck',
        'checkAfterLogin', 'getSetup', 'runSetupAction',
    ],
    library: [
        'getSongLikeId', 'getUserPlaylists', 'getLikedSongIds', 'getLikedSongCount', 'areSongsLiked', 'getUserAlbums',
        'getCloudCollection', 'getListeningRankCollections',
    ],
    catalog: [
        'canResolveSongCatalogRefs', 'resolveSongCatalogRefs', 'getPlaylistTracks', 'getPlaylistDetail', 'getCloudTracks',
        'getListeningRankTracks', 'getAlbumTracks', 'getAlbumDetail', 'getArtistSongs', 'getArtistAlbums',
        'getArtistDetail', 'getSubscriptionStatus',
    ],
    recommendations: [
        'personalFmModes', 'getPersonalFmCatalog', 'getDailySongs', 'getPersonalFm', 'getRecommendedCollections',
        'getHistoryEntries', 'getHistoryDates', 'getHistorySongs', 'dislikeSong', 'getDailyStyleGroups',
        'getDailyStyleSongs', 'setDailyStyle', 'preferenceEntries', 'getRecommendationPreferences',
        'saveRecommendationPreferences',
    ],
    explore: ['getFeed', 'getSectionItems', 'songsShownAs'],
    mutations: [
        'canAddToPlaylist', 'canEditPlaylistTracks', 'likeSong', 'updatePlaylistTracks', 'createPlaylist', 'canSubscribe',
        'subscribePlaylist', 'subscribeAlbum',
    ],
    covers: ['hosts', 'sized', 'identity', 'original', 'requestedSize'],
    raw: ['backend', 'reservedParams', 'credentialFields', 'describeEndpoint', 'checkParams', 'request'],
});

/** The members a capability must have; the rest are optional. */
export const FOLIUM_SOURCE_REQUIRED_MEMBERS: Readonly<Record<FoliumStandardCapability, readonly string[]>> = Object.freeze({
    search: ['searchSongs'],
    songs: ['getSong'],
    'playback.audio': ['getAudioSource'],
    'playback.external': ['play', 'pause', 'resume', 'seek', 'getStatus', 'isStatusForSong'],
    'playback.surface': ['play', 'pause', 'resume', 'seek', 'getStatus', 'isStatusForSong', 'mount'],
    reports: ['report'],
    lyrics: ['getLyrics'],
    auth: ['getLoginStatus', 'logout'],
    library: ['getUserPlaylists'],
    catalog: [],
    recommendations: [],
    explore: ['getFeed'],
    mutations: [],
    covers: ['hosts', 'sized', 'identity'],
    raw: ['backend', 'reservedParams', 'describeEndpoint', 'request'],
});

const VERSIONS: Readonly<Record<string, readonly number[]>> = FOLIUM_SOURCE_CAPABILITY_VERSIONS;

/** `x.<mod id>.<name>@<version>`: a custom capability, which the host does not read. */
export const FOLIUM_CUSTOM_CAPABILITY_PATTERN = /^x\.[a-z0-9][a-z0-9-]*\.[a-zA-Z0-9][a-zA-Z0-9._-]*@[1-9]\d*$/;

/** A capability key as a source's `capabilities` writes it: `<id>@<version>`. */
export interface FoliumCapabilityKey {
    id: string;
    version: number;
}

/** Reads `<id>@<version>`; null for a key that is not written that way. */
export const parseFoliumCapabilityKey = (key: string): FoliumCapabilityKey | null => {
    const match = /^([a-z][a-zA-Z0-9.-]*)@([1-9]\d*)$/.exec(key);
    return match ? { id: match[1], version: Number(match[2]) } : null;
};

/** Whether `id` is a standard capability id (whatever its version). */
export const isFoliumStandardCapability = (id: string): id is FoliumStandardCapability => Object.hasOwn(VERSIONS, id);

/** Whether this host implements capability `id` at `version`. */
export const supportsFoliumCapability = (id: string, version: number): boolean => (
    typeof id === 'string' && isFoliumStandardCapability(id) && VERSIONS[id].includes(version)
);
