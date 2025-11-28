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
    return fetchWithCreds(`/login/status`);
  },

  getUserAccount: async () => {
     return fetchWithCreds(`/user/account`);
  },

  // --- User Data ---
  getUserPlaylists: async (uid: number, limit = 50, offset = 0) => {
    return fetchWithCreds(`/user/playlist?uid=${uid}&limit=${limit}&offset=${offset}`);
  },

  // --- Playlist Data ---
  getPlaylistTracks: async (id: number, limit = 50, offset = 0) => {
    return fetchWithCreds(`/playlist/track/all?id=${id}&limit=${limit}&offset=${offset}`);
  },
  
  getPlaylistDetail: async (id: number) => {
      return fetchWithCreds(`/playlist/detail?id=${id}`);
  },

  // --- Song Data ---
  getSongUrl: async (id: number) => {
     // Use exhigh (320k) to ensure VIP songs have a valid signed URL.
     // 'standard' often returns null or invalid links for VIP content even if logged in.
     // randomCNIP=true added to improve success rate for some restricted tracks
     return fetchWithCreds(`/song/url/v1?id=${id}&level=exhigh&randomCNIP=true`);
  },
  
  getLyric: async (id: number) => {
      return fetchWithCreds(`/lyric/new?id=${id}`);
  },

  // --- Search ---
  cloudSearch: async (keywords: string, limit = 30, offset = 0) => {
      return fetchWithCreds(`/cloudsearch?keywords=${encodeURIComponent(keywords)}&limit=${limit}&offset=${offset}`);
  }
};