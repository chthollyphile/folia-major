import { NeteaseUser, NeteasePlaylist, SongResult } from "../types";

// Robustly check for environment variable, falling back if undefined
const getApiBase = () => {
  try {
    const env = (import.meta as any).env;
    if (env && env.VITE_NETEASE_API_BASE) {
      return env.VITE_NETEASE_API_BASE;
    } else {
      throw new Error("VITE_NETEASE_API_BASE is not defined. Please set it in your environment variables.");
    }
  } catch (e) {
    throw new Error("Failed to access environment variables for API base. Please configure VITE_NETEASE_API_BASE.");
  }
};

const API_BASE = getApiBase();

const fetchWithCreds = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE}${endpoint}`;
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

  const storedCookie = localStorage.getItem('netease_cookie');

  if (storedCookie) {
    // Append cookie to URL
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl = `${finalUrl}${sep}cookie=${encodeURIComponent(storedCookie)}`;
  }

  const res = await fetch(finalUrl, { ...defaultOptions, credentials: 'include' });
  return res.json();
};

const toHttps = (url?: string) => {
  if (!url) return '';
  return url.replace(/^http:/, 'https:');
};

export const neteaseApi = {
  // --- Login ---
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
    if (res.songs) {
      res.songs.forEach((s: any) => {
        if (s.al) s.al.picUrl = toHttps(s.al.picUrl);
      });
    }
    return res;
  },

  getPlaylistDetail: async (id: number) => {
    const res = await fetchWithCreds(`/playlist/detail?id=${id}`);
    if (res.playlist) {
      res.playlist.coverImgUrl = toHttps(res.playlist.coverImgUrl);
      if (res.playlist.creator) res.playlist.creator.avatarUrl = toHttps(res.playlist.creator.avatarUrl);
      if (res.playlist.tracks) {
        res.playlist.tracks.forEach((t: any) => {
          if (t.al) t.al.picUrl = toHttps(t.al.picUrl);
        });
      }
    }
    return res;
  },

  getAlbum: async (id: number) => {
    const res = await fetchWithCreds(`/album?id=${id}`);
    if (res.album) {
      res.album.picUrl = toHttps(res.album.picUrl);
    }
    if (res.songs) {
      res.songs.forEach((s: any) => {
        if (s.al) s.al.picUrl = toHttps(s.al.picUrl);
      });
    }
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

  // --- Search ---
  cloudSearch: async (keywords: string, limit = 30, offset = 0) => {
    const res = await fetchWithCreds(`/cloudsearch?keywords=${encodeURIComponent(keywords)}&limit=${limit}&offset=${offset}`);
    if (res.result && res.result.songs) {
      res.result.songs.forEach((s: any) => {
        if (s.al) s.al.picUrl = toHttps(s.al.picUrl);
      });
    }
    return res;
  },
};