import { name as backendName, version as backendVersion } from '@neteasecloudmusicapienhanced/api/package.json';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { JsonValue, OnlineRawRequestProvider, ProviderRawEndpoint } from '../../../types/onlineMusic';
import { httpErrorStatusOf, requestNeteaseRoute } from './netease';
import { describeNeteaseFailure, neteaseAnswerError } from './neteaseFailure';

// src/services/onlineMusic/netease/neteaseRaw.ts
// NetEase's raw endpoints (OnlineRawRequestProvider, for the Folium experimental `platform.raw`): the
// table of which modules of the pinned backend (@neteasecloudmusicapienhanced/api, see UPSTREAMS.md)
// may be called, and the request itself. An endpoint is the backend's module name (`user_record`), the
// file name under the package's module/ folder; the table names only modules that are there
// (test/unit/onlineMusic/neteaseRaw.test.ts reads the folder). When the upstream adds a module someone
// needs, it gets a row here; anything not in the table is refused.
//
// read:   reads data, the signed-in account's or anyone's.
// write:  changes something in the account (likes, playlists, follows, reports); needs the write
//         permission on top of the read one.
// denied: never, whatever the permissions: sign-in, session and credential modules (they take or hand
//         back cookies and tokens), account bindings and devices, the profile, and the modules that pass
//         any request on (`api`, `batch`) or decrypt traffic.
// `omni` names the omni method that already does what the module does: a mod should call that.
// `selfParam` is the parameter that names the user, filled with the signed-in account's id when left out.
// `pathParams` are the parameters the module writes into the upstream path as they come (`/api/v1/album/${id}`):
// they take digits only. The upstream URL is resolved, so `id: '../../logout'` would otherwise send the
// signed-in session to any music.163.com endpoint, the denied ones included
// (test/unit/onlineMusic/neteaseRaw.test.ts reads the modules for such parameters).

type Row = ProviderRawEndpoint & { pathParams?: readonly string[] };

const read = (extra: Omit<Row, 'access'> = {}): Row => ({ access: 'read', ...extra });
const write = (extra: Omit<Row, 'access'> = {}): Row => ({ access: 'write', ...extra });
const DENIED: Row = { access: 'denied' };

export const NETEASE_RAW_ENDPOINTS: Readonly<Record<string, Row>> = Object.freeze({
    // Listening records, the reason this exists (#788). Their fields are not documented upstream.
    user_record: read({ selfParam: 'uid' }),
    listen_data_total: read(),
    listen_data_realtime_report: read(),
    listen_data_report: read(),
    listen_data_today_song: read(),
    listen_data_song_play_rank: read(),
    listen_data_year_report: read(),
    summary_annual: read({ pathParams: ['year'] }),
    record_recent_song: read(),
    recent_listen_list: read(),
    // The account and other users.
    user_detail: read({ selfParam: 'uid', pathParams: ['uid'] }),
    user_subcount: read(),
    user_level: read(),
    user_follows: read({ selfParam: 'uid', pathParams: ['uid'] }),
    user_followeds: read({ selfParam: 'uid', pathParams: ['uid'] }),
    user_playlist: read({ selfParam: 'uid', omni: 'getUserPlaylists' }),
    likelist: read({ selfParam: 'uid', omni: 'getLikedSongIds' }),
    song_like_check: read({ omni: 'isSongLiked' }),
    user_cloud: read({ omni: 'getCloudCollection' }),
    // Songs, lyrics, collections, search and recommendations.
    song_detail: read({ omni: 'getSongDetail' }),
    song_url_v1: read({ omni: 'getAudioSource' }),
    lyric: read({ omni: 'getLyrics' }),
    lyric_new: read({ omni: 'getLyrics' }),
    song_wiki_summary: read(),
    simi_song: read(),
    comment_music: read({ pathParams: ['id'] }),
    comment_hot: read({ pathParams: ['id'] }),
    playlist_detail: read({ omni: 'getCollectionDetail' }),
    playlist_track_all: read({ omni: 'getCollectionTracks' }),
    album: read({ omni: 'getAlbumDetail', pathParams: ['id'] }),
    artist_detail: read({ omni: 'getArtistDetail' }),
    artist_desc: read(),
    artist_songs: read({ omni: 'getArtistSongs' }),
    artist_album: read({ omni: 'getArtistAlbums', pathParams: ['id'] }),
    toplist: read(),
    toplist_detail: read(),
    search: read({ omni: 'searchSongs' }),
    cloudsearch: read({ omni: 'searchSongs' }),
    recommend_songs: read({ omni: 'getDailySongs' }),
    personal_fm: read({ omni: 'getPersonalFm' }),
    history_recommend_songs: read({ omni: 'getRecommendationHistoryDates' }),
    history_recommend_songs_detail: read({ omni: 'getRecommendationHistorySongs' }),
    recommend_category_configs: read({ omni: 'getDailyStyleGroups' }),
    recommend_category_songs: read({ omni: 'getDailyStyleSongs' }),
    // Changes to the account.
    like: write({ omni: 'toggleSongLike' }),
    playlist_tracks: write({ omni: 'updateCollectionTracks' }),
    playlist_create: write({ omni: 'createPlaylistWithSong' }),
    playlist_subscribe: write({ omni: 'subscribe' }),
    album_sub: write({ omni: 'subscribe' }),
    playlist_name_update: write(),
    playlist_desc_update: write(),
    playlist_tags_update: write(),
    artist_sub: write(),
    follow: write({ pathParams: ['id'] }),
    scrobble: write({ omni: 'reportPlayback' }),
    recommend_songs_dislike: write({ omni: 'dislikeSong' }),
    recommend_category_set: write({ omni: 'setDailyStyle' }),
    fm_trash: write(),
    daily_signin: write(),
    // Never.
    login: DENIED,
    login_cellphone: DENIED,
    login_qr_key: DENIED,
    login_qr_create: DENIED,
    login_qr_check: DENIED,
    login_refresh: DENIED,
    login_status: DENIED,
    logout: DENIED,
    register_anonimous: DENIED,
    register_cellphone: DENIED,
    register_checktoken_v2: DENIED,
    register_checktoken_v3: DENIED,
    register_neapikey: DENIED,
    register_xeapikey: DENIED,
    captcha_sent: DENIED,
    captcha_sent_v1: DENIED,
    captcha_safe_sent: DENIED,
    captcha_verify: DENIED,
    cellphone_existence_check: DENIED,
    nickname_check: DENIED,
    activate_init_profile: DENIED,
    rebind: DENIED,
    user_account: DENIED,
    user_binding: DENIED,
    user_bindingcellphone: DENIED,
    user_replacephone: DENIED,
    user_update: DENIED,
    device_list: DENIED,
    device_kickoff: DENIED,
    api: DENIED,
    batch: DENIED,
    decrypt: DENIED,
    eapi_decrypt: DENIED,
});

// The query fields the backend reads as options of the request itself rather than of the module
// (util/option.js of the package): the session, the encryption, the user agent, a proxy, the source IP,
// the domain, headers and the timeout. Only the host sets them: a proxy or a domain of the caller's
// would send the session somewhere else.
const RESERVED_PARAMS = Object.freeze([
    'cookie', 'crypto', 'ua', 'proxy', 'realIP', 'randomCNIP', 'e_r', 'domain', 'checkToken', 'headers', 'timeout',
]);

// NetEase's own cookie names, which answers can carry as plain fields.
const CREDENTIAL_FIELDS = Object.freeze(['MUSIC_U', 'MUSIC_A', 'MUSIC_R_T', 'MUSIC_A_T', 'NMTID', '__remember_me']);

// Modules the backend serves at a route of their own (server.js `special`); the others at their name
// with `_` turned into `/`.
const SPECIAL_ROUTES: Readonly<Record<string, string>> = { daily_signin: '/daily_signin', fm_trash: '/fm_trash', personal_fm: '/personal_fm' };

export const neteaseRouteOf = (endpoint: string): string => SPECIAL_ROUTES[endpoint] ?? `/${endpoint.replace(/_/g, '/')}`;

/* The parameters as the backend reads them: strings as they are, numbers and booleans written out, arrays and objects as JSON. */
export const neteaseRawQuery = (params: Record<string, JsonValue>): string => Object.entries(params)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : String(value))}`)
    .join('&');

// A value for a path parameter: a non-negative integer, as a number or as digits.
const DIGITS = /^\d{1,20}$/;
const isPathValue = (value: JsonValue): boolean => (
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && DIGITS.test(value))
);

/* What is wrong with the values of `params` for `endpoint`, or null. Only the path parameters are looked at. */
const checkParams = (endpoint: string, params: Record<string, JsonValue>): string | null => {
    const row = Object.hasOwn(NETEASE_RAW_ENDPOINTS, endpoint) ? NETEASE_RAW_ENDPOINTS[endpoint] : null;
    const bad = row?.pathParams?.find((name) => params[name] !== undefined && params[name] !== null && !isPathValue(params[name]));
    return bad === undefined ? null : `"${bad}" must be a non-negative integer (digits only)`;
};

// NetEase's code for "too many requests".
const RATE_LIMITED_CODE = 405;

const request = async (endpoint: string, params: Record<string, JsonValue>, signal: AbortSignal): Promise<unknown> => {
    let answer: any;
    try {
        answer = await requestNeteaseRoute(neteaseRouteOf(endpoint), neteaseRawQuery(params), signal);
    } catch (error) {
        if (error instanceof OnlineProviderError || (error as { name?: unknown } | null)?.name === 'AbortError') throw error;
        // The backend could not be reached or did not answer with JSON: the network's, unless this build
        // has no backend configured at all.
        const unconfigured = describeNeteaseFailure('collection', error)?.case === 'not-configured';
        throw new OnlineProviderError(unconfigured ? 'unsupported' : 'network', `NetEase raw request ${endpoint} failed`, 'netease', error);
    }
    const code = Number(answer?.code);
    if ([301, 401, 403].includes(code)) throw neteaseAnswerError(answer, endpoint);
    if (code === RATE_LIMITED_CODE || httpErrorStatusOf(answer) === 429) {
        throw new OnlineProviderError('unavailable', `NetEase refused ${endpoint}: too many requests`, 'netease', { code }, 429);
    }
    // Any other answer, a refusal with another code included, is the platform's raw answer.
    return answer;
};

export const neteaseRaw: OnlineRawRequestProvider = {
    backend: { name: backendName, version: backendVersion },
    reservedParams: RESERVED_PARAMS,
    credentialFields: CREDENTIAL_FIELDS,
    describeEndpoint: (endpoint) => (Object.hasOwn(NETEASE_RAW_ENDPOINTS, endpoint) ? NETEASE_RAW_ENDPOINTS[endpoint] : null),
    checkParams,
    request,
};
