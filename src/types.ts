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
  isChorus?: boolean;
  chorusEffect?: 'bars' | 'circles' | 'beams';
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
  wordColors?: { word: string; color: string; }[];
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
  updateTime: number;
  trackUpdateTime: number;
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
  alia?: string[]; // 别名
  tns?: string[]; // 翻译名
}

export interface SearchResponse {
  result?: {
    songs?: SongResult[];
    songCount?: number;
  };
  code: number;
}

// Local Music Types

export interface LocalSong {
  id: string; // UUID for local file
  fileName: string;
  filePath: string; // File path for reference
  fileHandle?: FileSystemFileHandle; // For re-accessing the file (not persisted, stored in memory)
  duration: number; // milliseconds
  fileSize: number; // bytes
  mimeType: string;
  addedAt: number; // timestamp

  // Extracted metadata from file tags
  title?: string;
  artist?: string;
  album?: string;

  // Lyrics matching result
  matchedSongId?: number; // Netease song ID
  matchedArtists?: string; // Matched artist names (joined string)
  matchedAlbumId?: number; // Netease album ID
  matchedAlbumName?: string; // Netease album name
  matchedLyrics?: LyricData;
  matchedCoverUrl?: string; // Cover image URL from matched song
  hasManualLyricSelection?: boolean;
  folderName?: string; // Name of the folder if imported via folder import
  noAutoMatch?: boolean; // If true, do not attempt to auto-match metadata
}

// Extend SongResult to support local files
export interface UnifiedSong extends SongResult {
  isLocal?: boolean;
  localData?: LocalSong;
}

// Audio Analysis Types
import { MotionValue } from 'framer-motion';

export interface AudioBands {
  bass: MotionValue<number>;    // 20-150Hz (Circles)
  lowMid: MotionValue<number>;  // 150-400Hz (Squares)
  mid: MotionValue<number>;     // 400-1200Hz (Triangles)
  vocal: MotionValue<number>;   // 1000-3500Hz (Icons)
  treble: MotionValue<number>;  // 3500Hz+ (Crosses)
}
