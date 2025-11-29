
export interface Word {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
}

export interface Line {
  words: Word[];
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
}

export interface LyricData {
  lines: Line[];
  title?: string;
  artist?: string;
}

export interface Theme {
  name: string;
  backgroundColor: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontStyle: 'sans' | 'serif' | 'mono';
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  wordColors?: { word: string; color: string }[];
  lyricsIcons?: string[];
}

export enum PlayerState {
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
}

// Netease / Search API Types

export interface NeteaseUser {
  userId: number;
  nickname: string;
  avatarUrl: string;
  backgroundUrl?: string;
  vipType?: number;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  playCount: number;
  creator: NeteaseUser;
  description?: string;
}

export interface Artist {
  id: number;
  name: string;
}

export interface Album {
  id: number;
  name: string;
  picUrl?: string;
}

export interface SongResult {
  id: number;
  name: string;
  artists: Artist[];
  album: Album;
  duration: number; // milliseconds usually from API
  // Netease API raw fields
  al?: {
    id: number;
    name: string;
    picUrl?: string;
  };
  ar?: Artist[];
  dt?: number; // duration in ms
}

export interface SearchResponse {
  result?: {
    songs?: SongResult[];
    songCount?: number;
  };
  code: number;
}
