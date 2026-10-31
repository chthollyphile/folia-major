import { NoCopyrightRecommendation, SongPrivilege, SongResult } from "../../../types";
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { PersonalFmRequestOptions, ProviderSongAvailability } from '../../../types/onlineMusic';
import { withLoginRequestLimit } from '../login/loginRequestLimit';
import { withOnlineRequestLimit } from '../failure/onlineRequestLimit';
import { errorFields } from '../../../utils/errorText';

type UnavailableSongReplacement = {
  replacementSong: SongResult;
  replacementSongId: number;
  typeDesc?: string;
};

// Robustly check for environment variable, falling back if undefined
let API_BASE: string | null = null;
let songCopyrightRecommendationApiSupported: boolean | null = null;

const getElectronBridge = () => {
  if (typeof window === 'undefined' || !window) {
    return null;
  }

  return (window as any).electron ?? null;
};

const isElectronRuntime = () =>
  Boolean(getElectronBridge() && typeof getElectronBridge()?.getNeteasePort === 'function');

const getConfiguredApiBase = () => {
  const viteEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  if (viteEnv && typeof viteEnv.VITE_NETEASE_API_BASE === 'string' && viteEnv.VITE_NETEASE_API_BASE) {
    return viteEnv.VITE_NETEASE_API_BASE;
  }

  if (typeof process !== 'undefined' && typeof process.env.VITE_NETEASE_API_BASE === 'string' && process.env.VITE_NETEASE_API_BASE) {
    return process.env.VITE_NETEASE_API_BASE;
  }

  return null;
};

/** 网页版配置的远端 API 地址（自检与诊断报告用）；桌面版走内嵌后端，返回 null。 */
export const getNeteaseRemoteApiBase = (): string | null => (isElectronRuntime() ? null : getConfiguredApiBase());

// Thrown (as the error's `code`, and at the start of its message) when the Electron backend is not
// listening, so it stays distinguishable from an ordinary request failure. The message carries the
// backend's own status and error, which is what the QR login timeline needs to say why.
export const NETEASE_API_UNAVAILABLE = 'NETEASE_API_UNAVAILABLE';

// Marks the error when the web build has no API base configured (VITE_NETEASE_API_BASE): NetEase cannot
// be used there at all, which no retry changes.
export const NETEASE_API_BASE_MISSING = 'NETEASE_API_BASE_MISSING';

/** The Electron backend is not listening (`getApiBase`). */
export const isNeteaseApiUnavailable = (error: unknown): boolean => (
  (error as { code?: unknown } | null)?.code === NETEASE_API_UNAVAILABLE
);

/** The request never reached the API: `fetchWithCreds` marks such an error; a bare fetch throws a TypeError. */
export const isNeteaseNetworkFailure = (error: unknown): boolean => (
  (error as { networkFailure?: unknown } | null)?.networkFailure === true
  || (error instanceof TypeError && /fetch/i.test(error.message))
);

// Thrown when the Electron backend could not start because the network is down (it had no stored key
// to start without). Read as "cannot reach NetEase", not as a stopped service: the backend starts
// again when a request next needs it, so restarting Folia is not the way out.
export const NETEASE_API_OFFLINE = 'NETEASE_API_OFFLINE';

// Thrown for a sign-in request the local backend answered with an HTTP error, so the sign-in stops at
// that step. The backend answers 502 when it cannot reach NetEase; `answer` holds NetEase's code and words.
export class NeteaseLoginHttpError extends Error {
  constructor(readonly httpStatus: number, readonly answer: unknown) {
    super(`The NetEase API answered the sign-in request with HTTP ${httpStatus}`);
    this.name = 'NeteaseLoginHttpError';
  }
}

// The HTTP status of each answer that came with an error status. The local backend answers 502 when it
// could not reach NetEase (util/request.js); NetEase's own code 502 comes with 200, so only the status
// tells the two apart. The answer itself is still what the caller reads.
const errorStatuses = new WeakMap<object, number>();
export const httpErrorStatusOf = (answer: unknown): number | undefined => (
  typeof answer === 'object' && answer !== null ? errorStatuses.get(answer) : undefined
);

// The limit of the requests for a song's address and a collection's tracks. The local backend gives its
// own calls to NetEase no time limit (util/request.js sets one only when a request asks for it), and a
// playlist page is two of them in a row (module/playlist_track_all.js: playlist/detail, then song/detail).
// There is no worst case of its own to stay above, so each of the two gets half a minute.
export const NETEASE_ONLINE_REQUEST_LIMIT_MS = 60_000;

const NETEASE_PORT_POLL_INTERVAL_MS = 250;
// Backstop only. The main process bounds every startup network call, so `starting` always resolves
// well inside this; the deadline exists so a wedged backend cannot hang a request forever.
const NETEASE_PORT_WAIT_TIMEOUT_MS = 45000;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// The Electron backend no longer blocks window creation, so the renderer can outrun it. Wait while
// it is still starting, but return null the moment it reports a failure — the login modal turns
// that into a restart button rather than another opaque request error. A failure the main process
// marks as the network's (`offline`) is asked to start again, once per request: the network may be
// back by now. Whether a start is due is the main process's to decide (startsAgainWhenNeeded in
// electron/netease/neteaseApiStartup.cjs); still down, the port is 'offline'. `status` is the
// backend's own state where it gave no port, for the error to say why.
const waitForNeteasePort = async (bridge: any): Promise<{ port: number | 'offline' | null; status: ElectronNeteaseApiStatus | null }> => {
  const deadline = Date.now() + NETEASE_PORT_WAIT_TIMEOUT_MS;
  let askedAgain = false;

  for (;;) {
    const port = await bridge.getNeteasePort();
    if (Number.isInteger(port) && port > 0) return { port, status: null };

    let status = typeof bridge.getNeteaseApiStatus === 'function'
      ? await bridge.getNeteaseApiStatus()
      : null;
    if (status?.status === 'error' && status.offline === true) {
      if (askedAgain || typeof bridge.restartNeteaseApi !== 'function') return { port: 'offline', status };
      askedAgain = true;
      status = await bridge.restartNeteaseApi('needed');
      if (status?.status === 'error') return { port: status.offline === true ? 'offline' : null, status };
      // Running: the port is read again above. Starting (another start is under way): waited for.
      continue;
    }
    if (status?.status !== 'starting' || Date.now() >= deadline) return { port: null, status };

    await delay(NETEASE_PORT_POLL_INTERVAL_MS);
  }
};

const getApiBase = async () => {
  // Deliberately uncached under Electron: the local server starts asynchronously and can be
  // restarted from the login modal on a fresh port. Caching the first answer used to pin the
  // renderer to the dead default port for the rest of the session, so every online feature kept
  // failing with a bare network error long after the backend recovered.
  if (isElectronRuntime()) {
    const { port, status } = await waitForNeteasePort(getElectronBridge());
    if (port === 'offline') {
      throw new Error(NETEASE_API_OFFLINE);
    }
    if (port === null) {
      const state = status?.status ?? 'unknown';
      throw Object.assign(
        new Error(`${NETEASE_API_UNAVAILABLE}: local NetEase API is ${state}${status?.error ? ` (${status.error})` : ''}`),
        { code: NETEASE_API_UNAVAILABLE },
      );
    }
    // 必须是 127.0.0.1 而不是 localhost：本地 API 只监听 IPv4 回环（见 electron/main.cjs 的 startApi），
    // 有公网 IPv6 的机器上 localhost 会先解析到 ::1。
    return `http://127.0.0.1:${port}`;
  }

  if (API_BASE) return API_BASE;

  const configuredApiBase = getConfiguredApiBase();
  if (configuredApiBase) {
    API_BASE = configuredApiBase;
    return API_BASE;
  }

  // code 标签让 provider 认出“未配置”（持久，不是暂时失败）；message 原文不变，诊断依赖它。
  throw Object.assign(
    new Error("Failed to access environment variables for API base. Please configure VITE_NETEASE_API_BASE."),
    { code: NETEASE_API_BASE_MISSING },
  );
};

// A signal that aborts when either does: the caller's own (`options.signal`) and the time limit's.
const eitherSignal = (caller: AbortSignal | null | undefined, limit: AbortSignal): AbortSignal => {
  if (!caller) return limit;
  if (caller.aborted) return caller;
  const controller = new AbortController();
  const abort = (from: AbortSignal) => () => controller.abort(from.reason);
  caller.addEventListener('abort', abort(caller), { once: true });
  limit.addEventListener('abort', abort(limit), { once: true });
  return controller.signal;
};

// `limit`: the time limit the request gets, which starts when the request is sent: the wait for the
// local backend's port above is not counted. 'sign-in': one of the requests a sign-in waits for, with
// the sign-in's limit; an HTTP error answer to it throws NeteaseLoginHttpError instead of being read as
// an answer. 'online': a song's address or a collection's tracks, with the limit of online requests.
const fetchWithCreds = async (endpoint: string, options: RequestInit = {}, limit?: 'sign-in' | 'online') => {
  const base = await getApiBase();
  const url = `${base}${endpoint}`;
  // Ensure we send credentials to persist session (cookies)
  const defaultOptions: RequestInit = {
    ...options,
    mode: 'cors',
  };

  // Selective Timestamp: Only for login, user, and playlist detail endpoints
  // as per request to avoid caching issues on dynamic user data, but keep content cacheable.
  const needsTimestamp =
    endpoint.includes('/login') ||
    endpoint.includes('/user') ||
    endpoint.includes('/playlist/detail');

  let finalUrl = url;
  if (needsTimestamp) {
    const separator = finalUrl.includes('?') ? '&' : '?';
    finalUrl = `${finalUrl}${separator}timestamp=${Date.now()}`;
  }

  // Note: For Vercel hosted APIs, we rely on the `cookie` query param if cross-site cookies are blocked,
  // or `credentials: 'include'` if the server allows it. 

  const storedCookie = readProviderSessionValue('netease', 'cookie', ['netease_cookie']);

  let cookieToUse = storedCookie;

  if (!cookieToUse) {
    const isLoginOrStatusEndpoint =
      endpoint.startsWith('/login') ||
      endpoint.startsWith('/user/account') ||
      endpoint.startsWith('/logout');

    if (!isLoginOrStatusEndpoint) {
      let anonCookie = readProviderSessionValue('netease', 'anonymous_cookie', ['netease_anonymous_cookie']);
      if (!anonCookie && !endpoint.startsWith('/register/anonimous')) {
        try {
          // The registration is part of the request it is made for: it gets the same limit.
          const register = (signal?: AbortSignal) => fetch(`${base}/register/anonimous?timestamp=${Date.now()}`, signal ? { signal } : undefined).then(r => r.json());
          const anonRes = await (limit === 'online' ? withOnlineRequestLimit(register, NETEASE_ONLINE_REQUEST_LIMIT_MS) : register());
          if (anonRes && typeof anonRes.cookie === 'string' && anonRes.cookie) {
            anonCookie = anonRes.cookie;
            writeProviderSessionValue('netease', 'anonymous_cookie', anonRes.cookie);
          }
        } catch (e) {
          console.warn('Failed to fetch anonymous cookie', e);
        }
      }
      cookieToUse = anonCookie;
    }
  }

  if (cookieToUse) {
    // Append cookie to URL
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl = `${finalUrl}${sep}cookie=${encodeURIComponent(cookieToUse)}`;
  }

  const target = endpoint.split('?')[0];
  const send = async (signal?: AbortSignal) => {
    let res: Response;
    try {
      res = await fetch(finalUrl, { ...defaultOptions, credentials: 'include', ...(signal ? { signal: eitherSignal(options.signal, signal) } : {}) });
    } catch (error) {
      // The API itself could not be reached (the local backend has exited, a remote API is down): not a
      // failure of NetEase's. The error names the route, keeps the fetch's own error as its cause, and
      // is marked as the network's (`isNeteaseNetworkFailure`).
      throw Object.assign(
        new Error(`NetEase API request ${target} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error }),
        { networkFailure: true },
      );
    }
    // An error comes as JSON with a code like any answer; a body that is not JSON is told of with its
    // HTTP status and how it starts, not as a SyntaxError that says nothing of where it came from.
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw Object.assign(
        new Error(`NetEase API ${target} returned HTTP ${res.status} without a JSON body: ${text.slice(0, 200) || '(empty)'}`),
        { httpStatus: res.status },
      );
    }
    if (limit === 'sign-in' && !res.ok) throw new NeteaseLoginHttpError(res.status, body);
    if (!res.ok && typeof body === 'object' && body !== null) errorStatuses.set(body, res.status);
    return body;
  };
  const data = await (limit === 'sign-in' ? withLoginRequestLimit(send) : limit === 'online' ? withOnlineRequestLimit(send, NETEASE_ONLINE_REQUEST_LIMIT_MS) : send());

  if (!storedCookie && cookieToUse && (data?.code === 301 || data?.code === 401 || data?.code === 403)) {
    removeProviderSessionValue('netease', 'anonymous_cookie', ['netease_anonymous_cookie']);
  }

  return data;
};

/**
 * One request of the platform's raw endpoints (neteaseRaw.ts): `route` is the local backend's route
 * (`/user/record`), `query` the parameters already written as a query string. The session is added like
 * for every other request; it gets the limit of online requests, and `signal` aborts it as well.
 */
export const requestNeteaseRoute = (route: string, query: string, signal: AbortSignal) => (
  fetchWithCreds(query ? `${route}?${query}` : route, { signal }, 'online')
);

const toHttps = (url?: unknown) => {
  if (typeof url !== 'string' || !url) return '';
  return url.replace(/^http:/, 'https:');
};

const normalizeArtistName = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value.name === 'string') return value.name;
  return '';
};

const normalizeArtists = (source: any): { id: number; name: string }[] => {
  if (!source) return [];
  if (Array.isArray(source)) {
    return source
      .map((artist: any, index: number) => ({
        id: Number(artist?.id ?? index),
        name: normalizeArtistName(artist),
      }))
      .filter((artist) => artist.name);
  }

  if (typeof source === 'string') {
    return source
      .split(/[\/,]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => ({ id: index, name }));
  }

  return [];
};

const getCloudCoverFallback = (raw: any) =>
  raw?.simpleSong?.al?.picUrl ||
  raw?.simpleSong?.album?.coverUrl ||
  raw?.simpleSong?.album?.picUrl ||
  raw?.al?.picUrl ||
  raw?.album?.coverUrl ||
  raw?.album?.picUrl ||
  raw?.cover;

const normalizeSongPrivilege = (raw: any): SongPrivilege | undefined => {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  return {
    id: typeof raw.id === 'number' ? raw.id : undefined,
    fee: typeof raw.fee === 'number' ? raw.fee : undefined,
    payed: typeof raw.payed === 'number' ? raw.payed : undefined,
    st: typeof raw.st === 'number' ? raw.st : undefined,
    pl: typeof raw.pl === 'number' ? raw.pl : undefined,
    dl: typeof raw.dl === 'number' ? raw.dl : undefined,
    flag: typeof raw.flag === 'number' ? raw.flag : undefined,
    cs: typeof raw.cs === 'boolean' ? raw.cs : undefined,
  };
};

const normalizeNoCopyrightRecommendation = (raw: any): NoCopyrightRecommendation | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return {
    type: typeof raw.type === 'number' ? raw.type : undefined,
    typeDesc: typeof raw.typeDesc === 'string' ? raw.typeDesc : undefined,
    songId: typeof raw.songId === 'string' || typeof raw.songId === 'number' ? raw.songId : undefined,
    thirdPartySong: raw.thirdPartySong ?? null,
    expInfo: raw.expInfo ?? null,
  };
};

const applyPrivilegeToSong = (song: SongResult, privilege?: SongPrivilege): SongResult => {
  if (!privilege) {
    return song;
  }

  return {
    ...song,
    privilege,
  };
};

const mergeSongsWithPrivileges = (songs: any, privileges: any): SongResult[] => {
  const normalizedSongs = Array.isArray(songs)
    ? songs.map((song: any) => normalizeSongResult(song))
    : [];

  if (!Array.isArray(privileges) || privileges.length === 0 || normalizedSongs.length === 0) {
    return normalizedSongs;
  }

  const normalizedPrivileges = privileges.map((privilege: any) => normalizeSongPrivilege(privilege));
  const privilegeById = new Map<number, SongPrivilege>();

  normalizedPrivileges.forEach((privilege) => {
    if (typeof privilege?.id === 'number') {
      privilegeById.set(privilege.id, privilege);
    }
  });

  return normalizedSongs.map((song, index) => {
    const alignedPrivilege = normalizedPrivileges[index];
    const privilege = alignedPrivilege?.id === song.id
      ? alignedPrivilege
      : privilegeById.get(Number(song.id)) ?? alignedPrivilege;

    if (!privilege) {
      return song;
    }

    return {
      ...song,
      privilege,
    };
  });
};

const normalizeSongResult = (raw: any): SongResult => {
  const base = raw?.simpleSong || raw;
  const tValue = Number(base?.t ?? raw?.t ?? 0) as 0 | 1 | 2;
  const sourceType: SongResult['sourceType'] = tValue === 1 || tValue === 2 ? 'cloud' : 'netease';

  const artists = normalizeArtists(
    base?.ar ||
    base?.artists
  );

  const albumName =
    base?.al?.name ||
    base?.album?.name ||
    'Unknown Album';

  const albumId = Number(
    base?.al?.id ??
    base?.album?.id ??
    raw?.al?.id ??
    raw?.album?.id ??
    0
  );

  const picUrl = toHttps(getCloudCoverFallback(raw));
  const duration = Number(
    base?.durationMs ??
    base?.dt ??
    base?.duration ??
    raw?.duration ??
    raw?.songLength ??
    0
  );

  return {
    id: Number(base?.id ?? raw?.id ?? 0),
    name: base?.name || raw?.songName || raw?.fileName || 'Unknown Song',
    artists,
    album: {
      id: albumId,
      name: albumName,
      coverUrl: picUrl || undefined,
    },
    durationMs: duration,
    aliases: Array.isArray(base?.alia) ? base.alia : [],
    translatedNames: Array.isArray(base?.tns) ? base.tns : [],
    t: tValue,
    sourceType,
    sourceRef: {
      kind: 'online',
      providerId: 'netease',
      mediaId: String(Number(base?.id ?? raw?.id ?? 0)),
      ...(sourceType === 'cloud' ? { variant: 'cloud' } : {}),
    },
    fee: typeof (base?.fee ?? raw?.fee) === 'number' ? Number(base?.fee ?? raw?.fee) : undefined,
    noCopyrightRcmd: normalizeNoCopyrightRecommendation(base?.noCopyrightRcmd ?? raw?.noCopyrightRcmd),
    resourceState: typeof (base?.resourceState ?? raw?.resourceState) === 'boolean'
      ? Boolean(base?.resourceState ?? raw?.resourceState)
      : undefined,
    privilege: normalizeSongPrivilege(base?.privilege ?? raw?.privilege),
  };
};

export const isSongMarkedUnavailable = (
  song?: Pick<SongResult, 'privilege'> | null
): boolean => {
  if (!song) {
    return false;
  }

  return typeof song.privilege?.st === 'number' && song.privilege.st < 0;
};

// privilege.st -200 is NetEase's mark of a song taken down (community issue #899, and the replacement
// it offers); another negative st says only that the song is greyed out, for a reason not given.
const NETEASE_TAKEN_DOWN_ST = -200;

/**
 * Whether a NetEase song can be played, from its privilege alone: taken down only where st is -200,
 * no level plays (pl is 0 or less) and it is not in the cloud disk. Any other negative st is a
 * restriction the request for its address tells about. What a request answers never changes this.
 */
export const resolveNeteaseSongAvailability = (
  song: Pick<SongResult, 'privilege' | 'noCopyrightRcmd'> | null | undefined,
): ProviderSongAvailability => {
  const privilege = song?.privilege;
  const st = privilege?.st;
  if (typeof st !== 'number' || st >= 0) return { state: 'playable' };

  const hasPlayableLevel = typeof privilege?.pl === 'number' && privilege.pl > 0;
  if (st === NETEASE_TAKEN_DOWN_ST && !hasPlayableLevel && privilege?.cs !== true) {
    const typeDesc = song?.noCopyrightRcmd?.typeDesc;
    return {
      state: 'unavailable',
      reason: 'taken-down',
      ...(typeof typeDesc === 'string' ? { label: typeDesc } : {}),
    };
  }

  return { state: 'unknown', reason: 'restricted' };
};

export const getSongUnavailableTagText = (
  song: Pick<SongResult, 'privilege' | 'noCopyrightRcmd'> | null | undefined,
  fallbackLabel: string
): string => {
  if (!isSongMarkedUnavailable(song)) {
    return fallbackLabel;
  }

  const typeDesc = song?.noCopyrightRcmd?.typeDesc;
  return typeof typeDesc === 'string' && typeDesc.trim()
    ? typeDesc.trim()
    : fallbackLabel;
};

export const getSongAlternativeVersionId = (
  song?: Pick<SongResult, 'privilege' | 'noCopyrightRcmd'> | null
): number | null => {
  if (!song || !isSongMarkedUnavailable(song)) {
    return null;
  }

  const candidate = song.noCopyrightRcmd?.songId;
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }

  if (typeof candidate === 'string' && candidate.trim()) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const getReplacementSongFromDetailResponse = (
  response: any,
  replacementSongId: number
): SongResult | null => {
  const replacementSong = response?.songs?.find((candidate: SongResult) => candidate.id === replacementSongId)
    || response?.songs?.[0];

  if (!replacementSong || isSongMarkedUnavailable(replacementSong)) {
    return null;
  }

  return replacementSong;
};

const normalizeUnavailableSongReplacement = (response: any): UnavailableSongReplacement | null => {
  if (response?.code !== 200) {
    return null;
  }

  const rawReplacementSong = response?.data?.rcmd;
  if (!rawReplacementSong || typeof rawReplacementSong !== 'object') {
    return null;
  }

  const replacementSong = applyPrivilegeToSong(
    normalizeSongResult(rawReplacementSong),
    normalizeSongPrivilege(response?.data?.sp)
  );

  if (!replacementSong.id || isSongMarkedUnavailable(replacementSong)) {
    return null;
  }

  const typeDesc = typeof response?.data?.originSong?.noCopyrightRcmd?.typeDesc === 'string'
    ? response.data.originSong.noCopyrightRcmd.typeDesc
    : undefined;

  return {
    replacementSong,
    replacementSongId: Number(replacementSong.id),
    typeDesc,
  };
};

const getSongDetail = async (ids: number[] | number) => {
  const idParam = Array.isArray(ids) ? ids.join(',') : String(ids);
  const res = await fetchWithCreds(`/song/detail?ids=${idParam}`);
  res.songs = mergeSongsWithPrivileges(res.songs, res.privileges);
  return res;
};

// The local backend's answer where one of its modules threw without a body (server.js): `{ code: 404,
// msg: 'Not Found', data: null }`. Not NetEase's word.
export const isNeteaseRouteMissingResponse = (raw: unknown): boolean => {
  const answer = raw as { code?: unknown; msg?: unknown; data?: unknown } | null;
  return Number(answer?.code) === 404 && answer?.msg === 'Not Found' && answer?.data === null;
};

// Only a missing route means this API build has no such lookup (`routeMissing`). It is missing in two
// ways: a deployment without the route answers Express's own HTML 404, which `fetchWithCreds` throws
// with the status on it, and the local backend answers its Not Found JSON. The local backend answering
// 502 could not reach NetEase: the lookup failed, it did not find that there is no other version.
const getSongCopyrightRecommendation = async (
  songId: number
): Promise<{ replacement: UnavailableSongReplacement | null; routeMissing: boolean }> => {
  let result: any;
  try {
    result = await fetchWithCreds(`/song/copyright/rcmd?songid=${songId}`);
  } catch (error) {
    if ((error as { httpStatus?: unknown } | null)?.httpStatus === 404) {
      return { replacement: null, routeMissing: true };
    }
    throw error;
  }
  if (isNeteaseRouteMissingResponse(result)) {
    return { replacement: null, routeMissing: true };
  }
  if (httpErrorStatusOf(result) === 502) {
    const said = result?.msg || result?.message;
    throw new OnlineProviderError('network', 'The NetEase API could not reach NetEase for the replacement', 'netease', {
      code: Number(result?.code), ...(said ? { message: String(said) } : {}), httpStatus: 502,
    });
  }

  return { replacement: normalizeUnavailableSongReplacement(result), routeMissing: false };
};

// Resolves an alternate playable song while keeping legacy APIs as the primary path.
const getUnavailableSongReplacement = async (
  song?: Pick<SongResult, 'id' | 'privilege' | 'noCopyrightRcmd'> | null
): Promise<UnavailableSongReplacement | null> => {
  if (!song || !isSongMarkedUnavailable(song)) {
    return null;
  }

  const fallbackTypeDesc = typeof song.noCopyrightRcmd?.typeDesc === 'string'
    ? song.noCopyrightRcmd.typeDesc
    : undefined;
  const replacementSongId = getSongAlternativeVersionId(song);
  let detailError: unknown = null;

  if (replacementSongId) {
    try {
      const detailResponse = await getSongDetail(replacementSongId);
      const replacementSong = getReplacementSongFromDetailResponse(detailResponse, replacementSongId);
      if (replacementSong) {
        return {
          replacementSong,
          replacementSongId,
          typeDesc: fallbackTypeDesc,
        };
      }
    } catch (error) {
      detailError = error;
    }
  }

  if (songCopyrightRecommendationApiSupported === false) {
    if (detailError) {
      throw detailError;
    }
    return null;
  }

  let recommendationError: unknown = null;
  try {
    const { replacement, routeMissing } = await getSongCopyrightRecommendation(Number(song.id));
    if (replacement) {
      songCopyrightRecommendationApiSupported = true;
      return {
        ...replacement,
        typeDesc: replacement.typeDesc || fallbackTypeDesc,
      };
    }

    // 只有路由缺失才在本会话内关掉这个查询；一次网络失败或没有替代版本都不算接口不支持。
    if (routeMissing && !isElectronRuntime()) {
      songCopyrightRecommendationApiSupported = false;
    }
  } catch (error) {
    recommendationError = error;
  }

  if (detailError) {
    throw detailError;
  }

  if (recommendationError) {
    throw recommendationError;
  }

  return null;
};

export const isCloudSong = (song?: Pick<SongResult, 't'> | null): boolean =>
  Boolean(song && (song.t === 1 || song.t === 2));

export const getOnlineSongCacheKey = (
  kind: 'audio' | 'lyric' | 'cover',
  song: Pick<SongResult, 'id' | 't'>
) => {
  if (isCloudSong(song)) {
    return `${kind}_cloud_${song.id}`;
  }
  return `${kind}_${song.id}`;
};

const getProcessedLyricPayload = (response: any) => {
  if (!response) return { type: 'netease' as const };
  if (response.lrc || response.yrc || response.tlyric || response.ytlrc || response.romalrc || response.yromalrc) {
    return { type: 'netease' as const, ...response };
  }
  if (response.data && (response.data.lrc || response.data.yrc || response.data.tlyric || response.data.ytlrc || response.data.romalrc || response.data.yromalrc)) {
    return { type: 'netease' as const, ...response.data };
  }

  const lyricText = response.lyric || response.data?.lyric || response.data?.lrc || response.data?.lyrics;
  if (typeof lyricText === 'string') {
    return {
      type: 'netease' as const,
      lrc: { lyric: lyricText },
    };
  }

  return { type: 'netease' as const, ...response };
};

export const neteaseApi = {
  // --- Login ---
  // The cookie is read here, before the first wait: the caller drops it as soon as this is called.
  logout: async () => {
    const cookie = readProviderSessionValue('netease', 'cookie', ['netease_cookie']);
    return fetchWithCreds(cookie ? `/logout?cookie=${encodeURIComponent(cookie)}` : `/logout`);
  },

  getQrKey: async () => {
    return fetchWithCreds(`/login/qr/key`, {}, 'sign-in');
  },

  createQr: async (key: string) => {
    return fetchWithCreds(`/login/qr/create?key=${key}&qrimg=true`, {}, 'sign-in');
  },

  checkQr: async (key: string) => {
    return fetchWithCreds(`/login/qr/check?key=${key}`, {}, 'sign-in');
  },

  getLoginStatus: async () => {
    const res = await fetchWithCreds(`/login/status`);
    if (res.data?.profile) {
      res.data.profile.avatarUrl = toHttps(res.data.profile.avatarUrl);
      res.data.profile.backgroundUrl = toHttps(res.data.profile.backgroundUrl);
    }
    return res;
  },

  getUserAccount: async () => {
    const res = await fetchWithCreds(`/user/account`);
    if (res.profile) {
      res.profile.avatarUrl = toHttps(res.profile.avatarUrl);
      res.profile.backgroundUrl = toHttps(res.profile.backgroundUrl);
    }
    return res;
  },

  // --- User Data ---
  likeSong: async (id: number, like = true) => {
    return fetchWithCreds(`/like?id=${id}&like=${like}`);
  },

  /**
   * 听歌打卡 (NCBL 加密日志版)。写用户账号，只应在真实播放之后调用一次。
   *
   * `sourceid` 是可选的，这里刻意不发：应用里没有"这条队列来自哪个歌单"的记录，凑一个来源等于
   * 上报假数据。`source` 同样留给服务端默认值。
   */
  scrobbleV1: async (params: {
    id: number;
    time: number;
    name?: string;
    artist?: string;
    level?: string;
    bitrate?: number;
    total?: number;
  }) => {
    const query = new URLSearchParams({ id: String(params.id), time: String(params.time) });
    if (params.name) query.set('name', params.name);
    if (params.artist) query.set('artist', params.artist);
    if (params.level) query.set('level', params.level);
    if (params.bitrate) query.set('bitrate', String(params.bitrate));
    if (params.total) query.set('total', String(params.total));
    return fetchWithCreds(`/scrobble/v1?${query.toString()}`);
  },

  // The timestamp is there because the API server answers a repeated address from its cache for
  // two minutes: without it a like made in NetEase's own app would not be in the answer for that long.
  getLikedSongs: async (uid: number) => {
    return fetchWithCreds(`/likelist?uid=${uid}&timestamp=${Date.now()}`);
  },

  getUserPlaylists: async (uid: number, limit = 50, offset = 0) => {
    const res = await fetchWithCreds(`/user/playlist?uid=${uid}&limit=${limit}&offset=${offset}`);
    if (res.playlist) {
      res.playlist.forEach((p: any) => {
        p.coverImgUrl = toHttps(p.coverImgUrl);
        if (p.creator) p.creator.avatarUrl = toHttps(p.creator.avatarUrl);
      });
    }
    return res;
  },

  // --- Playlist Data ---
  getPlaylistTracks: async (id: number, limit = 50, offset = 0) => {
    const res = await fetchWithCreds(`/playlist/track/all?id=${id}&limit=${limit}&offset=${offset}`, {}, 'online');
    res.songs = mergeSongsWithPrivileges(res.songs, res.privileges);
    return res;
  },

  getPlaylistDetail: async (id: number) => {
    const res = await fetchWithCreds(`/playlist/detail?id=${id}`);
    if (res.playlist) {
      res.playlist.coverImgUrl = toHttps(res.playlist.coverImgUrl);
      if (res.playlist.creator) res.playlist.creator.avatarUrl = toHttps(res.playlist.creator.avatarUrl);
      if (res.playlist.tracks) {
        res.playlist.tracks = mergeSongsWithPrivileges(res.playlist.tracks, res.privileges);
      }
    }
    return res;
  },

  updatePlaylistTracks: async (op: 'add' | 'del', pid: number, tracks: number[] | number) => {
    const trackParam = Array.isArray(tracks) ? tracks.join(',') : String(tracks);
    return fetchWithCreds(`/playlist/tracks?op=${op}&pid=${pid}&tracks=${trackParam}&timestamp=${Date.now()}`);
  },

  getAlbum: async (id: number) => {
    const res = await fetchWithCreds(`/album?id=${id}`, {}, 'online');
    if (res.album) {
      res.album.picUrl = toHttps(res.album.picUrl);
    }
    if (res.songs) {
      res.songs = mergeSongsWithPrivileges(res.songs, res.privileges);
    }
    return res;
  },

  getSongDetail: async (ids: number[] | number) => {
    return getSongDetail(ids);
  },

  getFavoriteAlbums: async (limit = 25, offset = 0) => {
    const res = await fetchWithCreds(`/album/sublist?limit=${limit}&offset=${offset}`);
    if (res.data) {
      res.data.forEach((a: any) => {
        a.picUrl = toHttps(a.picUrl);
        // Map artist info if needed, ensuring picUrl is https
      });
    }
    return res;
  },

  // --- Artist Data ---
  getArtistDetail: async (id: number) => {
    const res = await fetchWithCreds(`/artist/detail?id=${id}`);
    if (res.data && res.data.artist) {
      res.data.artist.cover = toHttps(res.data.artist.cover);
      res.data.artist.avatar = toHttps(res.data.artist.avatar);
    }
    return res;
  },

  getArtistAlbums: async (id: number, limit = 30, offset = 0) => {
    const res = await fetchWithCreds(`/artist/album?id=${id}&limit=${limit}&offset=${offset}`);
    if (res.hotAlbums) {
      res.hotAlbums.forEach((a: any) => {
        a.picUrl = toHttps(a.picUrl);
      });
    }
    return res;
  },

  getAllArtistAlbums: async (id: number) => {
    const limit = 50;
    const albums: any[] = [];
    const seenIds = new Set<string>();

    // Follow the API's `more` flag while guarding against malformed repeated pages.
    for (let page = 0; page < 200; page++) {
      const res = await neteaseApi.getArtistAlbums(id, limit, page * limit);
      const pageAlbums = Array.isArray(res?.hotAlbums) ? res.hotAlbums : [];
      let added = 0;
      for (const album of pageAlbums) {
        const key = String(album?.id ?? `${page}:${added}`);
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        albums.push(album);
        added++;
      }
      if (!res?.more || pageAlbums.length === 0 || added === 0) break;
    }

    return albums;
  },

  getArtistTopSongs: async (id: number) => {
    const res = await fetchWithCreds(`/artist/top/song?id=${id}`);
    res.songs = mergeSongsWithPrivileges(res.songs, res.privileges);
    return res;
  },

  getArtistSongs: async (id: number, limit = 50, offset = 0, order = 'hot') => {
    const res = await fetchWithCreds(`/artist/songs?id=${id}&limit=${limit}&offset=${offset}&order=${order}`);
    res.songs = mergeSongsWithPrivileges(res.songs, res.privileges);
    return res;
  },

  // --- Song Data ---
  getSongUrl: async (id: number, level: string = 'exhigh') => {
    // Use exhigh (320k) by default to ensure VIP songs have a valid signed URL.
    // 'standard' often returns null or invalid links for VIP content even if logged in.
    // randomCNIP=true added to improve success rate for some restricted tracks
    // https=true ensures URLs are returned with HTTPS protocol to avoid mixed content issues
    return fetchWithCreds(`/song/url/v1?id=${id}&level=${level}&randomCNIP=true&https=true`, {}, 'online');
  },

  getLyric: async (id: number) => {
    return fetchWithCreds(`/lyric/new?id=${id}`);
  },

  getChorus: async (id: number) => {
    return fetchWithCreds(`/song/chorus?id=${id}`);
  },

  getCloudLyric: async (uid: number, sid: number) => {
    return fetchWithCreds(`/cloud/lyric/get?uid=${uid}&sid=${sid}`);
  },

  getUserCloud: async (limit = 200, offset = 0) => {
    const res = await fetchWithCreds(`/user/cloud?limit=${limit}&offset=${offset}`);
    const normalizedSongs = (res.data || []).map((item: any) => normalizeSongResult({
      ...item,
      t: item?.t ?? 1,
      simpleSong: item?.simpleSong
        ? { ...item.simpleSong, t: item.simpleSong.t ?? item?.t ?? 1 }
        : item.simpleSong,
    }));
    return {
      ...res,
      songs: normalizedSongs,
    };
  },

  getUserCloudDetail: async (ids: number[] | number) => {
    const idParam = Array.isArray(ids) ? ids.join(',') : String(ids);
    const res = await fetchWithCreds(`/user/cloud/detail?id=${idParam}`);
    return {
      ...res,
      songs: (res.data || []).map((item: any) => normalizeSongResult({
        ...item,
        t: item?.t ?? 1,
        simpleSong: item?.simpleSong
          ? { ...item.simpleSong, t: item.simpleSong.t ?? item?.t ?? 1 }
          : item.simpleSong,
      })),
    };
  },

  normalizeSongResult,
  getProcessedLyricPayload,
  getUnavailableSongReplacement,

  // --- Search ---
  // `type`: 1 songs (the default, left out of the URL), 10 albums, 1000 playlists.
  cloudSearch: async (keywords: string, limit = 30, offset = 0, type: 1 | 10 | 1000 = 1) => {
    const typeParam = type === 1 ? '' : `&type=${type}`;
    const res = await fetchWithCreds(`/cloudsearch?keywords=${encodeURIComponent(keywords)}&limit=${limit}&offset=${offset}${typeParam}`);
    if (res.result && type === 1) {
      res.result.songs = mergeSongsWithPrivileges(res.result.songs, res.result.privileges ?? res.privileges);
    }
    return res;
  },

  // --- Radio ---
  // `/personal/fm/mode` only exists on newer NeteaseCloudMusicApi builds, and this app talks to
  // whatever instance the user configured. The default mode keeps using the long-standing
  // `/personal_fm`, and an instance that cannot serve a mode falls back to it instead of leaving
  // the radio empty.
  //
  // Do not add `limit`: the module accepts one and forwards it, but the upstream radio ignores it
  // and returns 3 tracks either way (measured). The queue controller's near-end refill is what
  // keeps the stream going, exactly as it does for the plain FM endpoint.
  getPersonalFm: async (options?: PersonalFmRequestOptions) => {
    const fetchDefaultFm = () => fetchWithCreds(`/personal_fm?timestamp=${Date.now()}`);
    const mode = options?.mode;
    if (!mode || mode === 'DEFAULT') {
      return fetchDefaultFm();
    }

    const params = new URLSearchParams({ mode });
    if (mode === 'SCENE_RCMD' && options?.submode) {
      params.set('submode', options.submode);
    }

    try {
      const res = await fetchWithCreds(`/personal/fm/mode?${params.toString()}&timestamp=${Date.now()}`);
      if (Array.isArray(res?.data) && res.data.length > 0) {
        return res;
      }
      console.warn('[Netease] personal fm mode unsupported, falling back', { mode, code: res?.code });
    } catch (error) {
      console.warn('[Netease] personal fm mode request failed, falling back', { mode, ...errorFields(error) });
    }
    return fetchDefaultFm();
  },

  getDailyRecommendedSongs: async (afresh = false) => {
    const res = await fetchWithCreds(`/recommend/songs?afresh=${afresh}&timestamp=${Date.now()}`);
    const rawSongs = res.data?.dailySongs || res.data?.songs || res.recommendData?.dailySongs || res.songs || [];
    return {
      ...res,
      songs: mergeSongsWithPrivileges(rawSongs, res.data?.privileges || res.privileges),
    };
  },

  dislikeDailyRecommendedSong: async (songId: number) => {
    const res = await fetchWithCreds(`/recommend/songs/dislike?id=${songId}&timestamp=${Date.now()}`);
    return {
      ...res,
      song: res.data ? normalizeSongResult(res.data) : null,
    };
  },

  getDailyRecommendationHistoryDates: async () => {
    const res = await fetchWithCreds(`/history/recommend/songs?timestamp=${Date.now()}`);
    const rawDates = res.data?.dates || res.dates || res.data || [];
    return {
      ...res,
      dates: Array.isArray(rawDates)
        ? rawDates
          .map((item: unknown) => typeof item === 'string' ? item : (item as { date?: string })?.date)
          .filter((date: unknown): date is string => typeof date === 'string' && date.length > 0)
        : [],
    };
  },

  getDailyRecommendationHistoryDetail: async (date: string) => {
    const res = await fetchWithCreds(`/history/recommend/songs/detail?date=${encodeURIComponent(date)}&timestamp=${Date.now()}`);
    const rawSongs = res.data?.dailySongs || res.data?.songs || res.recommendData?.dailySongs || res.songs || [];
    return {
      ...res,
      songs: mergeSongsWithPrivileges(rawSongs, res.data?.privileges || res.privileges),
    };
  },

  getPersonalizedPlaylists: async (limit = 35) => {
    return fetchWithCreds(`/personalized?limit=${limit}`);
  },

  // --- Explore ---
  // Whether requests carry an account's session rather than the guest one. The recommendation
  // endpoints answer a guest as well, with lists that are the same for everyone (measured
  // 2026-10-08: `/recommend/songs` 3 songs, `/recommend/resource` 6 playlists, both code 200).
  hasAccountSession: () => Boolean(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])),

  // The home page of NetEase's mobile client: blocks of playlists, songs and albums (a guest gets
  // three). The first page is asked with `refresh`, NetEase's own flag for another pick; the
  // timestamp is there because the API server answers a repeated address from its cache for two
  // minutes. `cursor` is the one a previous answer gave, for the blocks after its own.
  // (Measured 2026-10-09 as a guest, six answers in 12 seconds: no effect of `refresh` was seen.
  // As true, the string or the boolean, and as false alike, one block had other songs in every
  // answer, one the same entries in every answer, and one changed once, between two asks with true.)
  getHomeBlocks: async (cursor?: string) => {
    const params = new URLSearchParams({ refresh: String(!cursor), timestamp: String(Date.now()) });
    if (cursor) params.set('cursor', cursor);
    const res = await fetchWithCreds(`/homepage/block/page?${params.toString()}`);
    (Array.isArray(res.data?.blocks) ? res.data.blocks : []).forEach((block: any) => {
      (block?.creatives || []).forEach((creative: any) => {
        (creative?.resources || []).forEach((resource: any) => {
          if (resource?.uiElement?.image) {
            resource.uiElement.image.imageUrl = toHttps(resource.uiElement.image.imageUrl);
          }
        });
      });
    });
    return res;
  },

  getDailyRecommendedPlaylists: async () => {
    const res = await fetchWithCreds(`/recommend/resource?timestamp=${Date.now()}`);
    if (Array.isArray(res.recommend)) {
      res.recommend.forEach((p: any) => {
        p.picUrl = toHttps(p.picUrl);
        if (p.creator) p.creator.avatarUrl = toHttps(p.creator.avatarUrl);
      });
    }
    return res;
  },

  getToplists: async () => {
    const res = await fetchWithCreds(`/toplist`);
    if (Array.isArray(res.list)) {
      res.list.forEach((p: any) => {
        p.coverImgUrl = toHttps(p.coverImgUrl);
      });
    }
    return res;
  },

  // 新歌速递: 100 songs in one answer, each in the old song format with its privilege inside it.
  getNewSongs: async (areaId = 0) => {
    const res = await fetchWithCreds(`/top/song?type=${areaId}`);
    return {
      ...res,
      songs: (Array.isArray(res.data) ? res.data : []).map((song: any) => normalizeSongResult(song)),
    };
  },

  getNewAlbums: async (limit = 30, offset = 0) => {
    const res = await fetchWithCreds(`/album/new?limit=${limit}&offset=${offset}`);
    if (Array.isArray(res.albums)) {
      res.albums.forEach((a: any) => {
        a.picUrl = toHttps(a.picUrl);
      });
    }
    return res;
  },

  getHotPlaylists: async (limit = 30, offset = 0) => {
    const res = await fetchWithCreds(`/top/playlist?order=hot&limit=${limit}&offset=${offset}`);
    if (Array.isArray(res.playlists)) {
      res.playlists.forEach((p: any) => {
        p.coverImgUrl = toHttps(p.coverImgUrl);
        if (p.creator) p.creator.avatarUrl = toHttps(p.creator.avatarUrl);
      });
    }
    return res;
  },

  // No `limit` and no `offset`: the answer is the same 5 songs whatever is asked for (measured as
  // a guest, 2026-10-08 with limit=50 and 2026-10-09 with offset=5).
  getSimilarSongs: async (id: number) => {
    const res = await fetchWithCreds(`/simi/song?id=${id}`);
    return {
      ...res,
      songs: (Array.isArray(res.songs) ? res.songs : []).map((song: any) => normalizeSongResult(song)),
    };
  },

  fmTrash: async (songId: number) => {
    return fetchWithCreds(`/fm_trash?id=${songId}&timestamp=${Date.now()}`);
  },

  subscribePlaylist: async (id: number, subscribe = true) => {
    const t = subscribe ? 1 : 2;
    return fetchWithCreds(`/playlist/subscribe?t=${t}&id=${id}&timestamp=${Date.now()}`);
  },

  subscribeAlbum: async (id: number, subscribe = true) => {
    const t = subscribe ? 1 : 2;
    return fetchWithCreds(`/album/sub?t=${t}&id=${id}&timestamp=${Date.now()}`);
  },

  getPlaylistDetailDynamic: async (id: number) => {
    return fetchWithCreds(`/playlist/detail/dynamic?id=${id}`);
  },

  getAlbumDetailDynamic: async (id: number) => {
    return fetchWithCreds(`/album/detail/dynamic?id=${id}`);
  },
};
