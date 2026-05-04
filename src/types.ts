import type { LineRenderHints } from './utils/lyrics/renderHints';

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
  renderHints?: LineRenderHints;
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
  fontFamily?: string;
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  wordColors?: { word: string; color: string; }[];
  lyricsIcons?: string[];
  provider?: string;
}

export interface DualTheme {
  light: Theme;
  dark: Theme;
}

export type ThemeMode = 'default' | 'ai' | 'custom';

export type VisualizerMode = 'classic' | 'cadenza' | 'partita' | 'fume' | 'spatial';

export type HomeViewTab = 'playlist' | 'local' | 'albums' | 'navidrome' | 'radio';

export interface CadenzaTuning {
  fontScale: number;
  widthRatio: number;
  motionAmount: number;
  glowIntensity: number;
  beamIntensity: number;
}

export const DEFAULT_CADENZA_TUNING: CadenzaTuning = {
  fontScale: 1.12,
  widthRatio: 0.72,
  motionAmount: 1,
  glowIntensity: 1,
  beamIntensity: 0,
};

export interface PartitaTuning {
  showGuideLines: boolean;
  staggerMin: number;
  staggerMax: number;
}

export const DEFAULT_PARTITA_TUNING: PartitaTuning = {
  showGuideLines: true,
  staggerMin: 20,
  staggerMax: 100,
};

export interface FumeTuning {
  hidePrintSymbols: boolean;
  disableGeometricBackground: boolean;
  textHoldRatio: number;
  cameraTrackingMode: 'stepped' | 'smooth';
  cameraSpeed: number;
  glowIntensity: number;
  heroScale: number;
}

export const DEFAULT_FUME_TUNING: FumeTuning = {
  hidePrintSymbols: false,
  disableGeometricBackground: true,
  textHoldRatio: 1,
  cameraTrackingMode: 'smooth',
  cameraSpeed: 1,
  glowIntensity: 1,
  heroScale: 1,
};

export enum PlayerState {
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
}

export interface StatusMessage {
  type: 'error' | 'success' | 'info';
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
  persistent?: boolean;
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
  specialType?: 'cloud';
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

export interface SongPrivilege {
  id?: number;
  fee?: number;
  payed?: number;
  st?: number;
  pl?: number;
  dl?: number;
  flag?: number;
  cs?: boolean;
}

export interface NoCopyrightRecommendation {
  type?: number;
  typeDesc?: string;
  songId?: string | number;
  thirdPartySong?: unknown | null;
  expInfo?: unknown | null;
}

export interface SongResult {
  id: number;
  name: string;
  artists: Artist[];
  album: Album;
  duration: number; // milliseconds usually from API
  isPureMusic?: boolean;
  t?: 0 | 1 | 2;
  sourceType?: 'netease' | 'cloud';
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
  fee?: number;
  noCopyrightRcmd?: NoCopyrightRecommendation | null;
  resourceState?: boolean;
  privilege?: SongPrivilege;
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
  fileLastModified?: number; // milliseconds since epoch
  fileSignature?: string; // Lightweight file identity for incremental scans
  mimeType: string;
  bitrate?: number; // bps
  addedAt: number; // timestamp

  // Extracted metadata from file tags
  title?: string;
  artist?: string;
  album?: string;

  // Embedded metadata from file tags
  embeddedTitle?: string;
  embeddedArtist?: string;
  embeddedAlbum?: string;
  embeddedCover?: Blob; // Preferred local cover blob (folder cover or embedded art), stored in IndexedDB
  replayGain?: number; // ReplayGain track gain in dB
  replayGainTrackGain?: number; // ReplayGain track gain in dB
  replayGainTrackPeak?: number; // ReplayGain track peak ratio
  replayGainAlbumGain?: number; // ReplayGain album gain in dB
  replayGainAlbumPeak?: number; // ReplayGain album peak ratio

  // Lyrics matching result
  matchedSongId?: number; // Netease song ID
  matchedArtists?: string; // Matched artist names (joined string)
  matchedAlbumId?: number; // Netease album ID
  matchedAlbumName?: string; // Netease album name
  matchedLyrics?: LyricData;
  matchedIsPureMusic?: boolean;
  matchedCoverUrl?: string; // Cover image URL from matched song
  hasManualLyricSelection?: boolean;
  folderName?: string; // Name of the folder if imported via folder import
  noAutoMatch?: boolean; // If true, do not attempt to auto-match metadata

  // User preferences for online data override (set via LyricMatchModal)
  lyricsSource?: 'local' | 'embedded' | 'online';  // Explicit lyrics source selection; undefined = default priority (local > embedded > online)
  useOnlineCover?: boolean;     // Prefer online cover over embedded cover
  useOnlineMetadata?: boolean;  // Prefer online artist/album over embedded tags

  // Local Lyrics (.lrc / .vtt files)
  hasLocalLyrics?: boolean;
  localLyricsContent?: string;
  hasLocalTranslationLyrics?: boolean;
  localTranslationLyricsContent?: string;

  // Embedded Lyrics (from file tags: ID3 USLT, Vorbis LYRICS, etc.)
  hasEmbeddedLyrics?: boolean;
  embeddedLyricsContent?: string;
  hasEmbeddedTranslationLyrics?: boolean;
  embeddedTranslationLyricsContent?: string;
}

export interface LocalLibrarySnapshotFile {
  name: string;
  relativePath: string;
  kind: 'audio' | 'lyric' | 'translationLyric' | 'cover' | 'other';
  size: number;
  lastModified: number;
  signature: string;
}

export interface LocalLibrarySnapshotNode {
  name: string;
  relativePath: string;
  hash: string;
  files: LocalLibrarySnapshotFile[];
  children: LocalLibrarySnapshotNode[];
}

export interface LocalLibrarySnapshot {
  rootFolderName: string;
  scannedAt: number;
  tree: LocalLibrarySnapshotNode;
}

export interface LocalPlaylist {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
  updatedAt: number;
  isFavorite?: boolean;
}

export type LocalLibraryGroupType = 'folder' | 'album' | 'artist' | 'playlist';

export interface LocalLibraryGroup {
  type: LocalLibraryGroupType;
  name: string;
  songs: LocalSong[];
  coverUrl?: string;
  id: string;
  isVirtual?: boolean;
  trackCount?: number;
  description?: string;
  albumId?: number;
  playlistId?: string;
}

// Extend SongResult to support local files and Navidrome files
export interface UnifiedSong extends SongResult {
  isLocal?: boolean;
  localData?: LocalSong;
  isNavidrome?: boolean;
  navidromeData?: any;
}

export type ReplayGainMode = 'off' | 'track' | 'album';

// Audio Analysis Types
import { MotionValue } from 'framer-motion';

export interface AudioBands {
  bass: MotionValue<number>;    // 20-150Hz (Circles)
  lowMid: MotionValue<number>;  // 150-400Hz (Squares)
  mid: MotionValue<number>;     // 400-1200Hz (Triangles)
  vocal: MotionValue<number>;   // 1000-3500Hz (Icons)
  treble: MotionValue<number>;  // 3500Hz+ (Crosses)
}
