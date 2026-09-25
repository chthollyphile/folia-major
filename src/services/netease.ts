import { NeteaseUser, NeteasePlaylist, NoCopyrightRecommendation, SongPrivilege, SongResult } from "../types";
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from './onlineMusic/providerStorage';
import type { PersonalFmRequestOptions } from '../types/onlineMusic';

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

// Thrown when the Electron backend is not listening. The QR login modal keys its "restart backend"
// overlay off this, so it must stay distinguishable from an ordinary request failure.
export const NETEASE_API_UNAVAILABLE = 'NETEASE_API_UNAVAILABLE';

const NETEASE_PORT_POLL_INTERVAL_MS = 250;
// Backstop only. The main process bounds every startup network call, so `starting` always resolves
// well inside this; the deadline exists so a wedged backend cannot hang a request forever.
const NETEASE_PORT_WAIT_TIMEOUT_MS = 45000;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// The Electron backend no longer blocks window creation, so the renderer can outrun it. Wait while
// it is still starting, but return null the moment it reports a failure — the login modal turns
// that into a restart button rather than another opaque request error.
const waitForNeteasePort = async (bridge: any): Promise<number | null> => {
  const deadline = Date.now() + NETEASE_PORT_WAIT_TIMEOUT_MS;

  for (;;) {
    const port = await bridge.getNeteasePort();
    if (Number.isInteger(port) && port > 0) return port;

    const status = typeof bridge.getNeteaseApiStatus === 'function'
      ? await bridge.getNeteaseApiStatus()
      : null;
    if (status?.status !== 'starting' || Date.now() >= deadline) return null;

    await delay(NETEASE_PORT_POLL_INTERVAL_MS);
  }
};

const getApiBase = async () => {
  // Deliberately uncached under Electron: the local server starts asynchronously and can be
  // restarted from the login modal on a fresh port. Caching the first answer used to pin the
  // renderer to the dead default port for the rest of the session, so every online feature kept
  // failing with a bare network error long after the backend recovered.
  if (isElectronRuntime()) {
    const port = await waitForNeteasePort(getElectronBridge());
    if (port === null) {
      throw new Error(NETEASE_API_UNAVAILABLE);
    }
    // 必须是 127.0.0.1 而不是 localhost：本地 API 只监听 IPv4 回环，原因见 electron/main.cjs 的 startApi。
    return `http://127.0.0.1:${port}`;
  }

  if (API_BASE) return API_BASE;

  const configuredApiBase = getConfiguredApiBase();
  if (configuredApiBase) {
    API_BASE = configuredApiBase;
    return API_BASE;
  }

  throw new Error("Failed to access environment variables for API base. Please configure VITE_NETEASE_API_BASE.");
};

const fetchWithCreds = async (endpoint: string, options: RequestInit = {}) => {
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
          const anonRes = await fetch(`${base}/register/anonimous?timestamp=${Date.now()}`).then(r => r.json());
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

  const res = await fetch(finalUrl, { ...defaultOptions, credentials: 'include' });
  const data = await res.json();

  if (!storedCookie && cookieToUse && (data?.code === 301 || data?.code === 401 || data?.code === 403)) {
    removeProviderSessionValue('netease', 'anonymous_cookie', ['netease_anonymous_cookie']);
  }

  return data;
};

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

const getSongCopyrightRecommendation = async (songId: number) => {
  const result = await fetchWithCreds(`/song/copyright/rcmd?songid=${songId}`);
  return normalizeUnavailableSongReplacement(result);
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

  try {
    const replacement = await getSongCopyrightRecommendation(Number(song.id));
    if (replacement) {
      songCopyrightRecommendationApiSupported = true;
      return {
        ...replacement,
        typeDesc: replacement.typeDesc || fallbackTypeDesc,
      };
    }

    if (!isElectronRuntime()) {
      songCopyrightRecommendationApiSupported = false;
    }
  } catch {
    if (!isElectronRuntime()) {
      songCopyrightRecommendationApiSupported = false;
    }
  }

  if (detailError) {
    throw detailError;
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
  logout: async () => {
    return fetchWithCreds(`/logout`);
  },

  getQrKey: async () => {
    return fetchWithCreds(`/login/qr/key`);
  },

  createQr: async (key: string) => {
    return fetchWithCreds(`/login/qr/create?key=${key}&qrimg=true`);
  },

  checkQr: async (key: string) => {
    return fetchWithCreds(`/login/qr/check?key=${key}`);
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

  getLikedSongs: async (uid: number) => {
    return fetchWithCreds(`/likelist?uid=${uid}`);
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
    const res = await fetchWithCreds(`/playlist/track/all?id=${id}&limit=${limit}&offset=${offset}`);
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
    const res = await fetchWithCreds(`/album?id=${id}`);
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
    return fetchWithCreds(`/song/url/v1?id=${id}&level=${level}&randomCNIP=true&https=true`);
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
  cloudSearch: async (keywords: string, limit = 30, offset = 0) => {
    const res = await fetchWithCreds(`/cloudsearch?keywords=${encodeURIComponent(keywords)}&limit=${limit}&offset=${offset}`);
    if (res.result) {
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
      console.warn('[Netease] personal fm mode request failed, falling back', { mode, error });
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
