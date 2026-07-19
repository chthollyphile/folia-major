import type { LineRenderHints } from './utils/lyrics/renderHints';
import type { MediaId, PlaybackSourceRef, ProviderCatalogRef } from './types/onlineMusic';

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

// Diorama's camera STYLE (calm/standard/chaotic) is not part of its tuning: like every other
// visualizer it follows theme.animationIntensity (the player-panel intensity chip / AI themes), so
// the theme system stays the single source of truth. The tuning only carries diorama-specific knobs.
/** The two mutually-exclusive shapes the point-cloud layer can take. */
export type DioramaGeometryMode = 'clouds' | 'corridor';

export interface DioramaGeometryVisibility {
  /** Parent switch: hides the whole point-cloud layer without discarding child preferences. */
  enabled: boolean;
  /**
   * 'clouds' = per-lyric point-cloud formations (the family switches below apply).
   * 'corridor' = one always-on point tunnel threaded along the flight path (families ignored).
   * The two never render together - picking one replaces the other.
   */
  mode: DioramaGeometryMode;
  /** Point-cloud cubes used by architectural formations. */
  strands: boolean;
  /** Open cylindrical point-cloud shells. */
  blobs: boolean;
  /** Triangular tetrahedron point-cloud crystals. */
  ribbons: boolean;
  /** Circular point-cloud loops. */
  rings: boolean;
}

export const DEFAULT_DIORAMA_GEOMETRY_VISIBILITY: DioramaGeometryVisibility = {
  enabled: true,
  mode: 'clouds',
  strands: true,
  blobs: true,
  ribbons: true,
  rings: true,
};

export const DIORAMA_PARTICLE_DENSITY_MIN = 96;
export const DIORAMA_PARTICLE_DENSITY_MAX = 1536;
export const DIORAMA_PARTICLE_DENSITY_STEP = 24;
// Background dust motes PER LINE of the resident window (see dioramaMoteField.ts). The motes sit in a
// shell around the flight axis, and the two axes are INDEPENDENT: 圆周 = motes around each ring, 径向 =
// how many layers across the shell's thickness (inner→outer). Motes-per-line = 圆周 x 径向; the window
// holds 8 lines, so MAX x MAX bounds the layer at 8*48*4 = 1536 points for low-end GPUs / OBS sources
// however far the sliders are dragged. Default 28 x 2 = 56 matches the old single-slider default.
export const DIORAMA_MOTE_CIRCUMFERENCE_MIN = 4;
export const DIORAMA_MOTE_CIRCUMFERENCE_MAX = 48;
export const DIORAMA_MOTE_CIRCUMFERENCE_STEP = 2;
export const DIORAMA_MOTE_RADIAL_MIN = 1;
export const DIORAMA_MOTE_RADIAL_MAX = 4;
export const DIORAMA_MOTE_RADIAL_STEP = 1;
export const DIORAMA_PARTICLE_SCALE_MIN = 0.65;
export const DIORAMA_PARTICLE_SCALE_MAX = 1.6;
export const DIORAMA_PARTICLE_SCALE_STEP = 0.05;
// Compatibility aliases for the uncommitted tuning UI while it migrates from point size to cluster scale.
export const DIORAMA_PARTICLE_SIZE_MIN = DIORAMA_PARTICLE_SCALE_MIN;
export const DIORAMA_PARTICLE_SIZE_MAX = DIORAMA_PARTICLE_SCALE_MAX;
export const DIORAMA_PARTICLE_SIZE_STEP = DIORAMA_PARTICLE_SCALE_STEP;
export const DIORAMA_PARTICLE_GLOW_INTENSITY_MIN = 0.1;
export const DIORAMA_PARTICLE_GLOW_INTENSITY_MAX = 1.5;
export const DIORAMA_PARTICLE_GLOW_INTENSITY_STEP = 0.05;

export interface DioramaTuning {
  cameraSpeed: number;
  motionAmount: number;
  audioReactivity: number;
  geometryVisibility: DioramaGeometryVisibility;
  /** Number of points requested for each formation anchor; the renderer also enforces a global cap. */
  particleDensity: number;
  /** Spatial scale multiplier for each complete point-cloud formation. */
  particleScale: number;
  /** One soft gradient aura per point-cloud cluster, separate from lyric sung-glow. */
  particleGlowEnabled: boolean;
  particleGlowIntensity: number;
  showParticles: boolean;
  /** Background dust shell, two INDEPENDENT axes (motes-per-line = the product; field clamps to its cap):
   *  背景粒子·圆周密度 = motes around each ring, 背景粒子·径向密度 = layers across the shell thickness. */
  backgroundParticleCircumference: number;
  backgroundParticleRadial: number;
  /** 普通辉光跟唱: soft glow on the unit being sung. Independent toggle + strength. */
  glowEnabled: boolean;
  glowIntensity: number;
  /** 灵魂出窍跟唱: a ghost copy of the sung glyph drifts out of the text. Independent toggle + strength. */
  soulEnabled: boolean;
  soulIntensity: number;
  /** 当前字漂移: a plain ON/OFF sub-switch of 灵魂出窍. ON lets the glyph CURRENTLY being sung drift at the
   *  same 灵魂出窍强度 as every other glyph; OFF holds it perfectly registered (no doubling / reading
   *  obstruction) until it finishes, after which it detaches and flies like the rest. No strength of its
   *  own - it borrows soulIntensity. Only has a visible effect when soulEnabled. */
  soulActiveEnabled: boolean;
  /** 渐变跟唱: the line's fill progressively deepens with the sung progress. Independent toggle + strength. */
  gradientEnabled: boolean;
  gradientIntensity: number;
  /** 关键字着色: the theme's `wordColors` keywords (written by the AI theme from the song's lyrics) become
   *  the follow-sing TARGET colour of the units they cover - hidden until the singing reaches them, never
   *  a resting colour. Same source and matcher as every other visualizer. */
  keywordColoringEnabled: boolean;
}

export const DEFAULT_DIORAMA_TUNING: DioramaTuning = {
  cameraSpeed: 1,
  motionAmount: 1,
  audioReactivity: 1,
  geometryVisibility: DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
  particleDensity: 576,
  particleScale: 1,
  particleGlowEnabled: true,
  particleGlowIntensity: 0.65,
  showParticles: true,
  backgroundParticleCircumference: 28,
  backgroundParticleRadial: 2,
  glowEnabled: true,
  glowIntensity: 1,
  soulEnabled: true,
  soulIntensity: 1,
  soulActiveEnabled: false,
  gradientEnabled: false,
  gradientIntensity: 1,
  keywordColoringEnabled: true,
};

export type MonetBackgroundSource = 'cover-derived' | 'uploaded-global';
export type MonetBackgroundLayout = 'full-overlay' | 'half-pane-gradient';
export type MonetBackgroundWashColorMode = 'theme' | 'custom';
export type NomandBackgroundSource = 'cover-derived' | 'uploaded-global';
export type NomandBackgroundDitheringType = '2x2' | '4x4' | '8x8';
export type LatentBackgroundDisplayMode = 'dithering' | 'mesh' | 'both';
export type LatentBackgroundColorSource = 'cover-theme' | 'cover-only';
export type MonetAudioStyle = 'bar' | 'line';
export type MonetPortraitSource = 'cover' | 'custom';
export type BuiltinVisualizerBackgroundMode = 'common' | 'monet' | 'nomand' | 'latent' | 'url' | 'sora';
export type VisualizerBackgroundMode = BuiltinVisualizerBackgroundMode | (string & {});

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

export interface NomandBackgroundTuning {
  imageSource: NomandBackgroundSource;
  ditheringType: NomandBackgroundDitheringType;
  size: number;
  colorSteps: number;
  originalColors: boolean;
  inverted: boolean;
  overlayEnabled: boolean;
  overlayOpacity: number;
}

export interface LatentBackgroundTuning {
  displayMode: LatentBackgroundDisplayMode;
  colorSource: LatentBackgroundColorSource;
  dynamicOnlyInPlayer: boolean;
  enhancedBeatResponse: boolean;
  ditheringSpeed: number;
  ditheringAudioSpeed: number;
  ditheringSize: number;
  ditheringOpacity: number;
  meshSpeed: number;
  meshAudioSpeed: number;
  meshDistortion: number;
  meshSwirl: number;
  overlayEnabled: boolean;
  overlayOpacity: number;
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

export const DEFAULT_NOMAND_BACKGROUND_TUNING: NomandBackgroundTuning = {
  imageSource: 'cover-derived',
  ditheringType: '8x8',
  size: 2,
  colorSteps: 2,
  originalColors: false,
  inverted: false,
  overlayEnabled: true,
  overlayOpacity: 0.35,
};

export const DEFAULT_LATENT_BACKGROUND_TUNING: LatentBackgroundTuning = {
  displayMode: 'both',
  colorSource: 'cover-theme',
  dynamicOnlyInPlayer: true,
  enhancedBeatResponse: true,
  ditheringSpeed: 0.1,
  ditheringAudioSpeed: 1.2,
  ditheringSize: 2.5,
  ditheringOpacity: 0.55,
  meshSpeed: 0.3,
  meshAudioSpeed: 2,
  meshDistortion: 0.8,
  meshSwirl: 0.1,
  overlayEnabled: true,
  overlayOpacity: 0.35,
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
  id: MediaId;
  name: string;
  entityId?: string;
  catalogRef?: ProviderCatalogRef;
}

export interface Album {
  id: MediaId;
  name: string;
  coverUrl?: string;
  entityId?: string;
  catalogRef?: ProviderCatalogRef;
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
  id: MediaId;
  name: string;
  artists: Artist[];
  album: Album;
  durationMs: number;
  isPureMusic?: boolean;
  aliases?: string[];
  translatedNames?: string[];
  t?: 0 | 1 | 2;
  sourceType?: 'netease' | 'cloud';
  sourceRef?: PlaybackSourceRef;
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
  matchedSongId?: MediaId;
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

  // Canonical metadata and retained source snapshots
  title: string;
  titleOrigin: import('./types/localLibrary').LocalSongTitleOrigin;
  importedMetadata: import('./types/localLibrary').LocalSongImportedMetadata;
  onlineMetadata?: import('./types/localLibrary').LocalSongOnlineMetadata;
  trackNumber?: number;
  discNumber?: number;
  embeddedMetadataVersion?: number;

  embeddedCover?: Blob; // Preferred local cover blob (folder cover or embedded art), stored in IndexedDB
  replayGain?: number; // ReplayGain track gain in dB
  replayGainTrackGain?: number; // ReplayGain track gain in dB
  replayGainTrackPeak?: number; // ReplayGain track peak ratio
  replayGainAlbumGain?: number; // ReplayGain album gain in dB
  replayGainAlbumPeak?: number; // ReplayGain album peak ratio

  // Lyrics matching result
  matchedLyrics?: LyricData;
  matchedIsPureMusic?: boolean;
  matchedLyricsSongId?: number | string; // Provider-scoped ID used for the saved lyric result
  hasManualLyricSelection?: boolean;
  folderName?: string; // Name of the folder if imported via folder import
  noAutoMatch?: boolean; // If true, do not attempt to auto-match metadata
  matchedLyricsSource?: LyricProviderSource;
  matchedLyricsProviderPlatform?: AmllDbPlatform;

  // User preferences for online data override (set via LyricMatchModal)
  lyricsSource?: 'local' | 'embedded' | 'online';  // Explicit lyrics source selection; undefined = default priority (local > embedded > online)
  useOnlineCover?: boolean;     // Prefer online cover over embedded cover

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
  entityId?: string;
  playlistId?: string;
}

export type {
  LocalLibraryAssignment,
  LocalLibraryAssignmentOrigin,
  LocalLibraryEntity,
  LocalLibraryEntityKind,
  LocalSongImportedMetadata,
  LocalSongMetadataSource,
  LocalSongOnlineMetadata,
  LocalSongReference,
  LocalSongTitleOrigin,
} from './types/localLibrary';

// Extend SongResult to support local files and Navidrome files
export interface UnifiedSong extends SongResult {
  sourceRef: PlaybackSourceRef;
  isLocal?: boolean;
  localRef?: import('./types/localLibrary').LocalSongReference;
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
    spectrum?: MotionValue<Uint8Array<ArrayBuffer>>; // Raw analyser FFT magnitude bins for full-spectrum visualizers
  }
