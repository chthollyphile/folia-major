import type { LineRenderHints } from './utils/lyrics/renderHints';

export interface LyricRuby {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
}

export interface LyricSyllable {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  endsWithSpace?: boolean;
  ruby?: LyricRuby[];
  obscene?: boolean;
  emptyBeat?: number;
}

export interface LyricAlternateText {
  role: 'translation' | 'romanization' | string;
  language?: string;
  text: string;
  syllables?: LyricSyllable[];
}

export interface Word {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  syllables?: LyricSyllable[];
}

export interface LyricBackgroundVocal {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  words: Word[];
  translation?: string;
  romanization?: string;
  alternateTexts?: LyricAlternateText[];
}

export interface LyricAgent {
  id: string;
  name?: string;
  type?: string;
}

export interface Line {
  words: Word[];
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
  id?: string;
  agentId?: string;
  songPart?: string;
  blockIndex?: number;
  romanization?: string;
  alternateTexts?: LyricAlternateText[];
  backgroundVocal?: LyricBackgroundVocal;
  renderHints?: LineRenderHints;
  isChorus?: boolean;
  chorusEffect?: 'bars' | 'circles' | 'beams';
}

export interface LyricData {
  lines: Line[];
  title?: string;
  artist?: string;
  isWordByWord?: boolean;
  ttml?: {
    timingMode?: 'Word' | 'Line';
    agents?: Record<string, LyricAgent>;
  };
}

export interface Theme {
  name: string;
  backgroundColor: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontStyle: 'sans' | 'serif' | 'mono';
  fontFamily?: string;
  fontFamilyStack?: string[];
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  wordColors?: { word: string; color: string; }[];
  lyricsIcons?: string[];
  provider?: string;
  description?: string;
}

export type CustomLyricsFontSource = 'system' | 'uploaded';

export interface StoredCustomLyricsFont {
  source: CustomLyricsFontSource;
  family: string;
  label?: string | null;
  fontId?: string;
}

export interface DualTheme {
  light: Theme;
  dark: Theme;
}

export type ThemeMode = 'default' | 'ai' | 'custom';

export type BuiltinVisualizerMode = 'classic' | 'cadenza' | 'partita' | 'fume' | 'monet';
export type VisualizerMode = BuiltinVisualizerMode | (string & {});
export type VisualizerFrameRate = 'off' | 120 | 90 | 60;

export type HomeViewTab = 'playlist' | 'local' | 'albums' | 'navidrome' | 'radio';

export type PlaybackContext = 'main' | 'stage';
export type StageSource = 'stage-api' | 'now-playing';
export type StageLoopMode = 'off' | 'all' | 'one';
export type QueueAddBehavior = 'append' | 'next';
export type StageActiveEntryKind = 'lyrics' | 'media';

export interface StageEmbeddedUsltTag {
  language?: string;
  descriptor?: string;
  text: string;
}

export interface StageEmbeddedLyricSource {
  type: 'embedded';
  usltTags?: StageEmbeddedUsltTag[];
  textContent?: string;
  translationContent?: string;
}

export interface StageLocalLyricSource {
  type: 'local';
  lrcContent: string;
  tLrcContent?: string;
  formatHint?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'ttml' | 'yrc' | 'qrc' | 'krc';
}

export interface StageNeteaseLyricBranch {
  lyric?: string;
  pureMusic?: boolean;
}

export interface StageNeteaseLyricSource {
  type: 'netease';
  lrc?: StageNeteaseLyricBranch & {
    yrc?: StageNeteaseLyricBranch;
    ytlrc?: StageNeteaseLyricBranch;
  };
  yrc?: StageNeteaseLyricBranch;
  ytlrc?: StageNeteaseLyricBranch;
  tlyric?: StageNeteaseLyricBranch;
  pureMusic?: boolean;
}

export interface StageNavidromeStructuredLyricLine {
  start?: number;
  value?: string;
}

export interface StageNavidromeLyricSource {
  type: 'navidrome';
  structuredLyrics?: StageNavidromeStructuredLyricLine[];
  plainLyrics?: string;
}

export interface StageQrcLyricSource {
  type: 'qrc';
  qrcContent: string;
  translationContent?: string;
}

export type StageLyricSource =
  | StageEmbeddedLyricSource
  | StageLocalLyricSource
  | StageNeteaseLyricSource
  | StageNavidromeLyricSource
  | StageQrcLyricSource;

export interface StageLyricsSession {
  title?: string;
  artist?: string;
  album?: string;
  lyricSource: StageLyricSource;
  updatedAt: number;
}

export interface StageMediaSession {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number | null;
  coverUrl?: string | null;
  coverArtUrl?: string | null;
  audioUrl?: string | null;
  audioSrc: string;
  audioMimeType?: string;
  coverMimeType?: string;
  lyricsText?: string | null;
  lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'ttml' | 'yrc' | 'qrc' | null;
  updatedAt: number;
}

export type StageSession = StageMediaSession;

export interface StageSearchResult {
  songId: number;
  title: string;
  artists: string[];
  album: string;
  durationMs: number | null;
  coverUrl: string | null;
}

export interface StageExternalPlayRequest {
  requestId: string;
  songId: number;
  appendToQueue?: boolean;
}

export interface StageExternalPlayResult {
  requestId: string;
  ok: boolean;
  error?: string | null;
  baseSnapshot?: StagePlayerSnapshot;
  snapshot?: StagePlayerSnapshot;
  result?: unknown;
}

export interface StageStatus {
  domain?: 'stage-input';
  direction?: 'outside-in';
  enabled: boolean;
  modeEnabled?: boolean;
  source?: StageSource | null;
  port: number;
  token: string | null;
  activeEntryKind: StageActiveEntryKind | null;
  lyricsSession: StageLyricsSession | null;
  mediaSession: StageMediaSession | null;
}

export type StagePlayerPlaybackContext = 'normal-playback' | 'stage-session' | 'external-playback-source';

export interface StagePlayerCurrent {
  id: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
}

export interface StagePlayerControlCapabilities {
  play: boolean;
  pause: boolean;
  resume: boolean;
  seek: boolean;
  previous: boolean;
  next: boolean;
}

export interface StagePlayerQueueCapabilities {
  append: boolean;
  insertNext: boolean;
  remove: boolean;
  move: boolean;
  select: boolean;
  clear: boolean;
}

export interface StagePlayerQueueItem extends StagePlayerCurrent {
  queueItemId: string;
}

export interface StagePlayerQueueSummary {
  currentIndex: number;
  length: number;
  revision?: string;
}

export interface StagePlayerQueueSnapshot extends StagePlayerQueueSummary {
  items: StagePlayerQueueItem[];
}

export interface StagePlayerQueueWindow extends StagePlayerQueueSummary {
  items: StagePlayerQueueItem[];
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export type StagePlayerQueueDiffOp =
  | { op: 'insert'; index: number; item: StagePlayerQueueItem }
  | { op: 'remove'; index: number }
  | { op: 'move'; from: number; to: number }
  | { op: 'clear' }
  | { op: 'select'; index: number };

export interface StagePlayerQueueDiff {
  baseRevision: string;
  revision: string;
  ops: StagePlayerQueueDiffOp[];
  requiresReload?: true;
}

export interface StagePlayerSnapshot {
  playbackContext: StagePlayerPlaybackContext;
  current: StagePlayerCurrent | null;
  playerState: PlayerState;
  positionMs: number;
  durationMs: number;
  sampledAtMs: number;
  updatedAt: number;
  controlCapabilities: StagePlayerControlCapabilities;
  queueCapabilities: StagePlayerQueueCapabilities;
  queue: StagePlayerQueueSnapshot;
}

export interface StagePlayerControlRequest {
  requestId: string;
  action: 'next' | 'prev' | 'pause' | 'resume' | 'seek';
  positionMs?: number;
}

export interface StagePlayerQueueRequest {
  requestId: string;
  action: 'append' | 'insert-next' | 'remove' | 'move' | 'select' | 'clear';
  songId?: number;
  songIds?: number[];
  queueItemId?: string;
  fromQueueItemId?: string;
  fromIndex?: number;
  toIndex?: number;
  index?: number;
}

export interface StagePlayerRequestResult {
  requestId: string;
  ok: boolean;
  error?: string | null;
  snapshot?: StagePlayerSnapshot;
  result?: unknown;
}

export type NowPlayingConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'error';

export interface NowPlayingTrackSnapshot {
  id: string | null;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  durationMs: number | null;
  isVideo?: boolean;
  isAdvertisement?: boolean;
}

export interface NowPlayingLyricPayload {
  source: string | null;
  title: string;
  artist: string;
  durationMs: number | null;
  hasLyric: boolean;
  hasTranslatedLyric: boolean;
  hasKaraokeLyric: boolean;
  lrc: string | null;
  translatedLyric: string | null;
  karaokeLyric: string | null;
}

export interface ClassicTuning {
  enableWordRotation: boolean;
  breathingFloatMultiplier: number;
  useLegacyLayout?: boolean;
  wordSpacing?: number;
}

export const DEFAULT_CLASSIC_TUNING: ClassicTuning = {
  enableWordRotation: true,
  breathingFloatMultiplier: 1,
  useLegacyLayout: false,
  wordSpacing: 0.7,
};

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
  useSemanticLayout: boolean;
  staggerMin: number;
  staggerMax: number;
}

export const DEFAULT_PARTITA_TUNING: PartitaTuning = {
  showGuideLines: true,
  useSemanticLayout: true,
  staggerMin: 20,
  staggerMax: 100,
};

export interface FumeTuning {
  hidePrintSymbols: boolean;
  disableGeometricBackground: boolean;
  backgroundObjectOpacity: number;
  textHoldRatio: number;
  cameraTrackingMode: 'stepped' | 'smooth';
  cameraSpeed: number;
  glowIntensity: number;
  heroScale: number;
}

export const DEFAULT_FUME_TUNING: FumeTuning = {
  hidePrintSymbols: false,
  disableGeometricBackground: true,
  backgroundObjectOpacity: 0.5,
  textHoldRatio: 1,
  cameraTrackingMode: 'smooth',
  cameraSpeed: 1,
  glowIntensity: 1,
  heroScale: 1,
};

export interface CladdaghTuning {
  focusScaleRatio: number;
  radiusScale: number;
  ellipseTiltDeg: number;
  showAxisLine: boolean;
  letterSpacingOffset: number;
}

export const DEFAULT_CLADDAGH_TUNING: CladdaghTuning = {
  focusScaleRatio: 0.65,
  radiusScale: 1.0,
  ellipseTiltDeg: 45,
  showAxisLine: true,
  letterSpacingOffset: 0,
};

export type CappellaEmojiPackSource = 'builtin' | 'custom';
export type CappellaAvatarSource = 'cover' | 'builtin' | 'color' | 'custom';

export interface CappellaTuning {
  showEmoMessages: boolean;
  emojiPackSource: CappellaEmojiPackSource;
  avatarSource: CappellaAvatarSource;
}

export const DEFAULT_CAPPELLA_TUNING: CappellaTuning = {
  showEmoMessages: true,
  emojiPackSource: 'builtin',
  avatarSource: 'cover',
};

export type TiltColorScheme = 'default' | 'swap' | 'accentAll' | 'primaryAll';

export interface TiltTuning {
  splitProbability: number;
  tiltStyleProbability: number;
  colorScheme?: TiltColorScheme;
}

export const DEFAULT_TILT_TUNING: TiltTuning = {
  splitProbability: 0.75,
  tiltStyleProbability: 0.35,
  colorScheme: 'default',
};

export type MonetBackgroundSource = 'cover-derived' | 'uploaded-global';
export type MonetBackgroundLayout = 'full-overlay' | 'half-pane-gradient';
export type MonetBackgroundWashColorMode = 'theme' | 'custom';
export type MonetAudioStyle = 'bar' | 'line';
export type MonetPortraitSource = 'cover' | 'custom';
export type VisualizerBackgroundMode = 'common' | 'monet' | 'url' | 'sora';

export interface UrlBackgroundItem {
  id: string;
  url: string;
  note: string;
}

export interface MonetBackgroundTuning {
  backgroundSource: MonetBackgroundSource;
  backgroundLayout: MonetBackgroundLayout;
  backgroundBlurPx: number;
  backgroundOverlayOpacity: number;
  backgroundGrayscale: number;
  backgroundSaturation: number;
  backgroundWash: number;
  backgroundHalfPaneOffsetX: number;
  backgroundWashColorMode: MonetBackgroundWashColorMode;
  backgroundWashCustomColor: string;
}

export interface MonetTuning {
  keywordColoringEnabled: boolean;
  showDescription: boolean;
  audioStyle: MonetAudioStyle;
  fontScale: number;
  portraitSource: MonetPortraitSource;
  portraitOffsetX?: number;
  portraitStyle?: 'square' | 'rectangular';
  showPortraitDragHanger?: boolean;
}

export const DEFAULT_MONET_BACKGROUND_TUNING: MonetBackgroundTuning = {
  backgroundSource: 'cover-derived',
  backgroundLayout: 'full-overlay',
  backgroundBlurPx: 6,
  backgroundOverlayOpacity: 0.74,
  backgroundGrayscale: 0,
  backgroundSaturation: 1.05,
  backgroundWash: 0.34,
  backgroundHalfPaneOffsetX: 0,
  backgroundWashColorMode: 'theme',
  backgroundWashCustomColor: '#8fb7ff',
};

export const DEFAULT_MONET_TUNING: MonetTuning = {
  keywordColoringEnabled: true,
  showDescription: true,
  audioStyle: 'bar',
  fontScale: 1.2,
  portraitSource: 'cover',
  portraitOffsetX: 0,
  portraitStyle: 'square',
  showPortraitDragHanger: true,
};

export interface StoredCappellaEmojiImage {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface CappellaEmojiImage {
  id: string;
  name: string;
  url: string;
}

export interface StoredCappellaAvatarImage {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface CappellaAvatarImage {
  id: string;
  name: string;
  url: string;
}

export interface StoredMonetBackgroundImage {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface MonetBackgroundImage {
  id: string;
  name: string;
  url: string;
}

export interface StoredMonetPortraitImage {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface MonetPortraitImage {
  id: string;
  name: string;
  url: string;
}

export enum PlayerState {
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
}

export interface StatusMessage {
  type: 'error' | 'success' | 'info';
  text: string;
  nonce?: number;
  durationMs?: number;
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

export type LyricProviderSource = 'netease' | 'qq' | 'kugou' | 'amll';
export type AmllDbPlatform = 'ncm' | 'qq';

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
  onlineLyricsState?: OnlineLyricsState;
  matchedLyricsSource?: LyricProviderSource;
  matchedLyricsProviderPlatform?: AmllDbPlatform;
  qqMid?: string;
  kgHash?: string;
  amllDbPlatform?: AmllDbPlatform;
}

export interface OnlineLyricsState {
  lyricsSource: 'online' | 'imported';
  importedLyrics?: LyricData | null;
  importedLyricsName?: string | null;
  hasOnlineOverride?: boolean;
  onlineOverrideLyrics?: LyricData | null;
  matchedSongId?: number;
  matchedIsPureMusic?: boolean;
  matchedLyricsSource?: LyricProviderSource;
  matchedLyricsProviderPlatform?: AmllDbPlatform;
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
  matchedLyricsSource?: LyricProviderSource;
  matchedLyricsProviderPlatform?: AmllDbPlatform;

  // User preferences for online data override (set via LyricMatchModal)
  lyricsSource?: 'local' | 'embedded' | 'online';  // Explicit lyrics source selection; undefined = default priority (local > embedded > online)
  useOnlineCover?: boolean;     // Prefer online cover over embedded cover
  useOnlineMetadata?: boolean;  // Prefer online artist/album over embedded tags

  // Local Lyrics (.lrc / .vtt / .ttml / .qrc / .yrc / .krc files)
  hasLocalLyrics?: boolean;
  localLyricsContent?: string;
  localLyricsFormat?: 'vtt' | 'ttml' | 'yrc' | 'qrc' | 'krc';
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
  coverUrl?: string | Blob;
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
    spectrum?: MotionValue<Uint8Array>; // Raw analyser FFT magnitude bins for full-spectrum visualizers
  }
