/// <reference types="vite/client" />

import type { ModExportProgress, ModFfmpegStatus, ModLogEntry, ModRuntimeInfo, ModRuntimeSnapshot } from './mods/types';

declare global {
  const __COMMIT_HASH__: string;
  const __GIT_BRANCH__: string;
  const __APP_VERSION__: string;
  const __APP_VERSION_LABEL__: string;
  const __APP_RELEASE_CHANNEL__: string;
  const __DOCKER_STACK_VERSION__: string;

  interface Window {
    __FOLIA_RUNTIME_CONFIG__?: {
      aiProvider?: 'gemini' | 'openai';
    };
  }

  interface ElectronCacheDirectoryResult {
    path: string;
    isDefault: boolean;
    canceled?: boolean;
  }

  interface ElectronAudioCacheEntry {
    found: boolean;
    data?: Uint8Array | ArrayBuffer | null;
    mimeType?: string | null;
  }

  type ElectronKugouOperation = import('./services/onlineMusic/kugouTransport').KugouOperation;

  interface ElectronAudioCacheStats {
    size: number;
    count: number;
  }

  interface ElectronLyricProxyResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyText: string;
  }

  interface ElectronNeteaseApiStatus {
    status: 'starting' | 'running' | 'error';
    port: number | null;
    error: string | null;
    updatedAt: number;
  }

  // `unavailable` means the packaged build shipped without the bundled qq-music-api.
  interface ElectronQqApiStatus {
    status: 'starting' | 'running' | 'error' | 'unavailable';
    port: number | null;
    error: string | null;
    updatedAt: number;
  }

  interface ElectronKugouApiStatus {
    available: boolean;
    authenticated: boolean;
    error: string | null;
  }

  interface ElectronTaskbarControlState {
    hasActiveTrack: boolean;
    canGoPrevious: boolean;
    canGoNext: boolean;
    isPlaying: boolean;
  }

  type ElectronTaskbarControlAction = 'previous' | 'play-pause' | 'next';

  type ElectronRemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'cycle-loop-mode' }
    | { type: 'resize-main-window'; width: number; height: number }
    | { type: 'set-main-window-border-visible'; visible: boolean }
    | { type: 'set-main-window-click-through'; enabled: boolean }
    | { type: 'set-main-window-always-on-top'; enabled: boolean }
    | { type: 'set-transparent-mode-enabled'; enabled: boolean }
    | { type: 'disable-transparent-mode' }
    | { type: 'cycle-player-chrome-visibility-mode' }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: ElectronVideoExportPreset; startMode: ElectronVideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' }
    | { type: 'toggle-like' };

  type ElectronVideoExportStatus =
    | 'idle'
    | 'preparing'
    | 'countdown'
    | 'recording'
    | 'finalizing'
    | 'done'
    | 'error';

  type ElectronVideoExportStartMode = 'from-start' | 'current';

  interface ElectronVideoExportPreset {
    id: string;
    label: string;
    width: number;
    height: number;
    orientation: 'landscape' | 'portrait';
  }

  interface ElectronVideoExportState {
    status: ElectronVideoExportStatus;
    presetId: string | null;
    progress: number;
    elapsed: number;
    duration: number;
    countdown: number | null;
    filePath: string | null;
    error: string | null;
  }

  interface ElectronWindowCaptureSource {
    id: string;
    name: string;
  }

  interface ElectronSaveDialogResult {
    canceled: boolean;
    filePath: string | null;
  }

  interface ElectronRemoteControlSnapshot {
    hasTrack: boolean;
    trackKey: string | null;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: string;
    loopMode: 'off' | 'all' | 'one';
    canGoPrevious: boolean;
    canGoNext: boolean;
    prevTrackKey: string | null;
    prevTrackTitle: string | null;
    prevTrackArtist: string | null;
    prevTrackCoverUrl: string | null;
    nextTrackKey: string | null;
    nextTrackTitle: string | null;
    nextTrackArtist: string | null;
    nextTrackCoverUrl: string | null;
    controlsDisabled: boolean;
    isStageActive: boolean;
    transparentModeEnabled: boolean;
    mainWindowClickThroughEnabled: boolean;
    mainWindowAlwaysOnTop: boolean;
    mainWindowBorderVisible: boolean;
    playerChromeHidden: boolean;
    playerChromeVisibilityMode: import('./types/remoteControl').PlayerChromeVisibilityMode;
    exportState: ElectronVideoExportState;
    isDaylight?: boolean;
    lyrics?: import('./types').LyricData | null;
    isLiked?: boolean;
    canLike?: boolean;
    likeUnavailableProvider?: string;
    updatedAt: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
  }

  interface ElectronPlaybackSyncBridgeStatus {
    remoteControlOpen: boolean;
    discordPresenceEnabled: boolean;
  }

  interface ElectronVoiceInputPauseStatus {
    active: boolean;
    enabled: boolean;
    supported: boolean;
  }

  interface ElectronDiscordPresenceSnapshot {
    hasTrack: boolean;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: string;
    updatedAt: number;
  }

  interface ElectronMainWindowClickThroughState {
    enabled: boolean;
    unlockHoverActive?: boolean;
  }

  type ElectronObsBrowserSourceStatus = import('./types/obsBrowserSource').ObsBrowserSourceStatus;
  type ElectronObsBrowserSourceConfig = import('./types/obsBrowserSource').ObsBrowserSourceConfig;
  type ElectronObsBrowserSourceClock = import('./types/obsBrowserSource').ObsBrowserSourceClock;
  type ElectronObsBrowserSourceAudio = import('./types/obsBrowserSource').ObsBrowserSourceAudio;

  interface ElectronDiscordPresenceStatus {
    enabled: boolean;
    configured: boolean;
    connected: boolean;
    error: string | null;
    applicationId: string | null;
    updatedAt: number;
  }

  type ElectronUpdateStatusValue =
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'latest'
    | 'error'
    | 'downloading'
    | 'downloaded'
    | 'unsupported';

  interface ElectronUpdateStatus {
    status: ElectronUpdateStatusValue;
    supported: boolean;
    updateCheckSupported: boolean;
    updateCheckSupportReason?: 'system' | 'channel' | null;
    platform?: string;
    updateCheckEnabled: boolean;
    autoUpdateEnabled: boolean;
    currentVersion: string;
    availableVersion: string | null;
    updateUrl: string | null;
    error: string | null;
    lastCheckedAt: number | null;
    lastSeenVersion: string | null;
    updateSeen: boolean;
    downloadProgress?: {
      percent: number;
      transferred?: number;
      total?: number;
    } | null;
  }

  type StageActiveEntryKind = 'lyrics' | 'media';
  type StageSource = 'stage-api' | 'now-playing';

  interface StageEmbeddedUsltTag {
    language?: string;
    descriptor?: string;
    text: string;
  }

  interface StageEmbeddedLyricSource {
    type: 'embedded';
    usltTags?: StageEmbeddedUsltTag[];
    textContent?: string;
    translationContent?: string;
  }

  interface StageLocalLyricSource {
    type: 'local';
    lrcContent: string;
    tLrcContent?: string;
    formatHint?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'ttml' | 'yrc' | 'qrc' | 'krc';
  }

  interface StageNeteaseLyricBranch {
    lyric?: string;
    pureMusic?: boolean;
  }

  interface StageNeteaseLyricSource {
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

  interface StageNavidromeStructuredLyricLine {
    start?: number;
    value?: string;
  }

  interface StageNavidromeLyricSource {
    type: 'navidrome';
    structuredLyrics?: StageNavidromeStructuredLyricLine[];
    plainLyrics?: string;
  }

  interface StageQrcLyricSource {
    type: 'qrc';
    qrcContent: string;
    translationContent?: string;
  }

  type StageLyricSource =
    | StageEmbeddedLyricSource
    | StageLocalLyricSource
    | StageNeteaseLyricSource
    | StageNavidromeLyricSource
    | StageQrcLyricSource;

  interface StageLyricsSession {
    title?: string;
    artist?: string;
    album?: string;
    lyricSource: StageLyricSource;
    updatedAt: number;
  }

  interface StageMediaSession {
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

  type StageSession = StageMediaSession;

  interface StageSearchResult {
    songId: number;
    title: string;
    artists: string[];
    album: string;
    durationMs: number | null;
    coverUrl: string | null;
  }

  interface StageExternalPlayRequest {
    requestId: string;
    songId: number;
    appendToQueue?: boolean;
  }

  interface StageExternalPlayResult {
    requestId: string;
    ok: boolean;
    error?: string | null;
    baseSnapshot?: StagePlayerSnapshot;
    snapshot?: StagePlayerSnapshot;
    result?: unknown;
  }

  interface StageStatus {
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

  type StagePlayerPlaybackContext = 'normal-playback' | 'stage-session' | 'external-playback-source';

  interface StagePlayerCurrent {
    id: string;
    source: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    coverUrl: string | null;
  }

  interface StagePlayerControlCapabilities {
    play: boolean;
    pause: boolean;
    resume: boolean;
    seek: boolean;
    previous: boolean;
    next: boolean;
  }

  interface StagePlayerQueueCapabilities {
    append: boolean;
    insertNext: boolean;
    remove: boolean;
    move: boolean;
    select: boolean;
    clear: boolean;
  }

  interface StagePlayerQueueItem extends StagePlayerCurrent {
    queueItemId: string;
  }

  interface StagePlayerQueueSummary {
    currentIndex: number;
    length: number;
    revision?: string;
  }

  interface StagePlayerQueueSnapshot extends StagePlayerQueueSummary {
    items: StagePlayerQueueItem[];
  }

  interface StagePlayerQueueWindow extends StagePlayerQueueSummary {
    items: StagePlayerQueueItem[];
    offset: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  }

  type StagePlayerQueueDiffOp =
    | { op: 'insert'; index: number; item: StagePlayerQueueItem }
    | { op: 'remove'; index: number }
    | { op: 'move'; from: number; to: number }
    | { op: 'clear' }
    | { op: 'select'; index: number };

  interface StagePlayerQueueDiff {
    baseRevision: string;
    revision: string;
    ops: StagePlayerQueueDiffOp[];
    requiresReload?: true;
  }

  interface StagePlayerSnapshot {
    playbackContext: StagePlayerPlaybackContext;
    current: StagePlayerCurrent | null;
    playerState: string;
    positionMs: number;
    durationMs: number;
    sampledAtMs: number;
    updatedAt: number;
    controlCapabilities: StagePlayerControlCapabilities;
    queueCapabilities: StagePlayerQueueCapabilities;
    queue: StagePlayerQueueSnapshot;
  }

  interface StagePlayerControlRequest {
    requestId: string;
    action: 'next' | 'prev' | 'pause' | 'resume' | 'seek';
    positionMs?: number;
  }

  interface StagePlayerQueueRequest {
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

  interface StagePlayerRequestResult {
    requestId: string;
    ok: boolean;
    error?: string | null;
    snapshot?: StagePlayerSnapshot;
    result?: unknown;
  }

  /**
   * One downloadable as the settings page sees it. `path` is null when it is not installed.
   *
   * Not all of them are models: `runtime` is the Python separation runs in, which is a different
   * archive per platform and unpacks to a directory rather than landing as a file. It is in the
   * same list because everything the page does with it - size, progress, install, remove - is the
   * same, and the two differences it does have are the two fields below.
   */
  interface ElectronAutomixModelEntry {
    name: string;
    /** null on a platform with no build, where there is no archive to name. */
    file: string | null;
    bytes: number;
    /** Which capability this buys: the beat grid, or the stems. */
    enables: 'beatGrid' | 'stems';
    license: string;
    /**
     * False only for `runtime`, and only where no build exists for this OS and architecture -
     * today that is Intel Macs. The row is still drawn; it offers no download.
     */
    supported: boolean;
    path: string | null;
    downloading: boolean;
  }

  interface ElectronAutomixModelStatus {
    /**
     * The netdisk routes, offered only once every mirror has failed. An empty list = not offered.
     * The extraction code belongs to the link rather than to the block: the two disks have
     * different ones, and a code shown beside the wrong link is worse than no code.
     */
    manual: { links: Array<{ label: string; url: string; code?: string }>; note: string };
    downloadDir: string;
    models: ElectronAutomixModelEntry[];
  }

  /** A verified copy of a model found somewhere on this machine. Matched by hash, not by name. */
  interface ElectronAutomixModelFound {
    name: string;
    file: string;
    path: string;
    bytes: number;
  }

  interface ElectronAutomixModelProgress {
    name: string;
    status: 'downloading' | 'ready' | 'failed';
    received: number;
    total: number;
    /** Which mirror is answering, or null before one has been reached. */
    host: string | null;
  }

  /** One process's share of a memory sample. Sizes are whole megabytes; see electron/debug/memoryMonitor.cjs. */
  interface DebugMemoryProcess {
    pid: number;
    /** `Browser`, `Tab`, `GPU`, `Utility/folia-analysis` and so on - the type plus its service name. */
    type: string;
    workingSetMB: number;
    /** This process's OWN high-water mark, reached whenever. Never summed across processes. */
    peakWorkingSetMB: number;
    /**
     * Windows via the metrics table, any platform for a process that answered for itself; null
     * where neither applies (GPU, utility), never 0 as a stand-in.
     */
    privateMB: number | null;
    /** Memory shared with other processes. Self-reported, so renderer and main only. */
    sharedMB: number | null;
    /** This process's V8 heap. Self-reported; null for the ones that cannot be asked. */
    heapMB: number | null;
    /** Blink's own allocations - DOM, CSS, decoded images. Renderer processes only. */
    blinkMB: number | null;
    cpuPercent: number;
  }

  /** One tick of the memory monitor: the whole app at one instant, plus the session's figures so far. */
  interface DebugMemorySample {
    at: string;
    uptimeSec: number;
    totalWorkingSetMB: number;
    totalPrivateMB: number | null;
    cpuPercent: number;
    processCount: number;
    /** Peak / floor / mean of the SIMULTANEOUS total, over this monitoring run. */
    peakMB: number;
    floorMB: number;
    avgMB: number;
    samples: number;
    mainHeapUsedMB: number | null;
    mainHeapTotalMB: number | null;
    /** The renderer's heap - the one that separates leaked JS objects from native growth. */
    rendererHeapUsedMB: number | null;
    /**
     * The renderer's own private memory. Needs no summing, so unlike `totalPrivateMB` it exists on
     * every platform - and the renderer is the largest process in this app anyway.
     */
    rendererPrivateMB: number | null;
    systemFreeMB: number | null;
    systemTotalMB: number | null;
    processes: DebugMemoryProcess[];
  }

  /** Whether each log is recording, how it opens its file, and where the files are. */
  interface DebugModuleState {
    runtimeLogEnabled: boolean;
    runtimeLogMode: 'append' | 'overwrite';
    memoryMonitorEnabled: boolean;
    memoryLogMode: 'append' | 'overwrite';
    memoryIntervalMs: number;
    logsRoot: string;
    runtimeFile: string | null;
    memoryFile: string | null;
  }

  interface Window {
    electron?: {
      webUtils?: {
        /** Resolves the OS path of a dropped File (File.path was removed in modern Electron). */
        getPathForFile: (file: File) => string;
      };
      /** Beat This! inference in the main process. Null when the weights or runtime are absent. */
      runBeatThis?: (
        chunks: Array<{ data: Float32Array; frames: number }>,
      ) => Promise<{ beat: Float32Array[]; downbeat: Float32Array[] } | null>;
      /**
       * htdemucs separation in the main process, for one window of one track at 44.1kHz.
       * `other` is not returned - it is derived by subtraction so the stems sum to the mix exactly.
       */
      separateStems?: (
        request: { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> },
      ) => Promise<Record<
        'drums' | 'bass' | 'vocals',
        // Never shared memory: this crosses the IPC boundary by structured clone, which always
        // reconstitutes a plain ArrayBuffer on this side.
        { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
      > | null>;
      /**
       * Which model files are on disk, answered without loading them.
       *
       * Absent in the browser build, which is why every reader treats a missing function as "no
       * weights" rather than as "unknown".
       */
      getAutomixModelsPresent?: () => Promise<{ beat_this: boolean; htdemucs: boolean }>;
      chooseModelsDirectory?: () => Promise<{ canceled: boolean }>;
      resetModelsDirectory?: () => Promise<void>;
      getAutomixModelStatus?: () => Promise<ElectronAutomixModelStatus>;
      downloadAutomixModel?: (name: string) => Promise<{ ok: boolean; skipped?: string[]; path?: string }>;
      cancelAutomixModelDownload?: (name: string) => Promise<boolean>;
      scanForAutomixModels?: () => Promise<{ found: ElectronAutomixModelFound[]; scanned: number }>;
      installAutomixModel?: (name: string, source: string) => Promise<{ ok: boolean; reason?: string }>;
      /**
       * Deletes every copy of every model the app can reach, plus any `.part` leftovers.
       * `failed` is non-empty when a copy could not be removed - typically one inside the
       * installer's own read-only directory, which stays installed and is reported as such.
       */
      removeAllAutomixModels?: () => Promise<{
        ok: boolean;
        removed: string[];
        freed: number;
        failed: Array<{ name: string; reason: string }>;
      }>;
      onAutomixModelProgress?: (
        callback: (progress: ElectronAutomixModelProgress) => void,
      ) => () => void;
      /** Developer debug module. Absent in the browser build, where every caller no-ops. */
      debugGetState?: () => Promise<DebugModuleState>;
      debugSetState?: (patch: Partial<Pick<DebugModuleState, 'runtimeLogEnabled' | 'runtimeLogMode' | 'memoryMonitorEnabled' | 'memoryLogMode' | 'memoryIntervalMs'>>) => Promise<DebugModuleState>;
      debugOpenLogs?: (which?: 'runtime' | 'memory') => Promise<boolean>;
      debugWriteRuntimeLines?: (lines: Array<{ at: number; level: string; tag: string | null; text: string }>) => void;
      /** What this process can say about itself that the metrics table cannot see from outside. */
      debugRendererMemory?: () => Promise<{ pid: number; privateKB: number; sharedKB: number; blinkAllocatedKB: number } | null>;
      debugReportRendererMemory?: (report: { pid: number; privateKB?: number; sharedKB?: number; blinkAllocatedKB?: number; heapUsedKB?: number }) => void;
      onDebugMemorySample?: (callback: (sample: DebugMemorySample) => void) => () => void;
      /** One-way stage marks from the automix session into the runtime log. */
      diagMark?: (text: string) => void;
      platform: string;
      isLinuxX11: boolean;
      getSettings: () => Promise<any>;
      saveSettings: (key: string, value: any) => Promise<any>;
      onWallpaperModeChanged?: (callback: (settings: Record<string, unknown>) => void) => () => void;
      setPlaybackDisplaySleepBlockingActive: (active: boolean) => Promise<boolean>;
      setAppLocale: (localeKey: 'en' | 'zh-CN' | 'in') => Promise<string>;
      getCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      chooseCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      resetCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      getUpdateStatus: () => Promise<ElectronUpdateStatus>;
      checkForUpdates: () => Promise<ElectronUpdateStatus>;
      markUpdateSeen: (version?: string | null) => Promise<ElectronUpdateStatus>;
      openUpdateReleasePage: (version?: string | null) => Promise<boolean>;
      openExternalUrl: (url: string) => Promise<boolean>;
      downloadUpdate: () => Promise<ElectronUpdateStatus>;
      quitAndInstallUpdate: () => Promise<boolean>;
      onUpdateStatusChanged: (callback: (status: ElectronUpdateStatus) => void) => () => void;
      getAudioCache: (cacheKey: string) => Promise<ElectronAudioCacheEntry>;
      hasAudioCache: (cacheKey: string) => Promise<boolean>;
      /** `limitBytes` is the cache ceiling to prune down to afterwards; 0 means no ceiling. */
      saveAudioCache: (cacheKey: string, data: ArrayBuffer, mimeType?: string, limitBytes?: number) => Promise<boolean>;
      getAudioCacheUsage: () => Promise<number>;
      getAudioCacheStats: () => Promise<ElectronAudioCacheStats>;
      clearAudioCache: () => Promise<boolean>;
      getCoverCache: (cacheKey: string) => Promise<ElectronAudioCacheEntry>;
      saveCoverCache: (cacheKey: string, data: ArrayBuffer, mimeType?: string) => Promise<boolean>;
      removeCoverCache: (cacheKey: string) => Promise<boolean>;
      getCoverCacheUsage: () => Promise<number>;
      clearCoverCache: () => Promise<boolean>;
      hasLocalCoverAsset: (assetId: string) => Promise<boolean>;
      saveLocalCoverAsset: (assetId: string, data: ArrayBuffer, mimeType: string) => Promise<boolean>;
      removeLocalCoverAsset: (assetId: string) => Promise<boolean>;
      clearLocalCoverAssets: () => Promise<boolean>;
      generateTheme: (lyricsText: string, options?: { isPureMusic?: boolean; songTitle?: string }) => Promise<any>;
      fetchLyricProxy: (
        url: string,
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        },
      ) => Promise<ElectronLyricProxyResponse>;
      getNeteasePort: () => Promise<number>;
      getNeteaseApiStatus: () => Promise<ElectronNeteaseApiStatus>;
      onNeteaseApiStatusChanged: (callback: (status: ElectronNeteaseApiStatus) => void) => () => void;
      getKugouApiStatus: () => Promise<ElectronKugouApiStatus>;
      kugouRequest: (
        operation: ElectronKugouOperation,
        params?: Record<string, string | number | boolean | undefined>,
      ) => Promise<unknown>;
      getQqPort: () => Promise<number | null>;
      getQqApiStatus: () => Promise<ElectronQqApiStatus>;
      onQqApiStatusChanged: (callback: (status: ElectronQqApiStatus) => void) => () => void;
      minimizeWindow: () => Promise<boolean>;
      toggleMaximizeWindow: () => Promise<boolean>;
      toggleFullscreenWindow: () => Promise<boolean>;
      closeWindow: () => Promise<boolean>;
      quitApp: () => Promise<boolean>;
      isWindowMaximized: () => Promise<boolean>;
      getWindowTransparentMode: () => Promise<boolean>;
      setWindowTransparentMode: (
        enabled: boolean,
        handoff?: import('./types/appPlayback').WindowPlaybackHandoff | null,
      ) => Promise<boolean>;
      consumeWindowPlaybackHandoff: () => Promise<import('./types/appPlayback').WindowPlaybackHandoff | null>;
      submitWindowPlaybackHandoff: (
        requestId: string,
        handoff: import('./types/appPlayback').WindowPlaybackHandoff | null,
      ) => Promise<boolean>;
      onWindowPlaybackHandoffRequested: (
        callback: (payload: { requestId: string }) => void,
      ) => () => void;
      setNativeTheme: (themeSource: 'system' | 'light' | 'dark') => Promise<void>;
      getMainWindowClickThroughEnabled: () => Promise<boolean>;
      setMainWindowClickThroughEnabled: (enabled: boolean) => Promise<boolean>;
      setMainWindowClickThroughUnlockHover: (active: boolean) => Promise<boolean>;
      getMainWindowAlwaysOnTop: () => Promise<boolean>;
      setMainWindowAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      onMainWindowClickThroughChanged: (callback: (state: ElectronMainWindowClickThroughState) => void) => () => void;
      getObsBrowserSourceStatus: () => Promise<ElectronObsBrowserSourceStatus>;
      setObsBrowserSourceEnabled: (enabled: boolean) => Promise<ElectronObsBrowserSourceStatus>;
      regenerateObsBrowserSourceToken: () => Promise<ElectronObsBrowserSourceStatus>;
      publishObsBrowserSourceConfig: (config: ElectronObsBrowserSourceConfig) => Promise<boolean>;
      publishObsBrowserSourceClock: (clock: ElectronObsBrowserSourceClock) => Promise<boolean>;
      publishObsBrowserSourceAudio: (audio: ElectronObsBrowserSourceAudio) => Promise<boolean>;
      getLyricApiStatus: () => Promise<import('./types/lyricApi').LyricApiStatus>;
      setLyricApiEnabled: (enabled: boolean) => Promise<import('./types/lyricApi').LyricApiStatus>;
      publishLyricApiData: (lyrics: import('./types').LyricData | null, offset: number) => Promise<boolean>;
      onLyricApiStatusChanged: (callback: (status: import('./types/lyricApi').LyricApiStatus) => void) => () => void;
      getDiscordPresenceStatus: () => Promise<ElectronDiscordPresenceStatus>;
      publishDiscordPresenceSnapshot: (snapshot: ElectronDiscordPresenceSnapshot) => Promise<ElectronDiscordPresenceStatus>;
      getPlaybackSyncBridgeStatus: () => Promise<ElectronPlaybackSyncBridgeStatus>;
      getVoiceInputPauseStatus: () => Promise<ElectronVoiceInputPauseStatus>;
      onVoiceInputStateChanged: (callback: (state: ElectronVoiceInputPauseStatus) => void) => () => void;
      onPlaybackSyncBridgeStatusChanged: (callback: (status: ElectronPlaybackSyncBridgeStatus) => void) => () => void;
      onDiscordPresenceStatusChanged: (callback: (status: ElectronDiscordPresenceStatus) => void) => () => void;
      onObsBrowserSourceStatusChanged: (callback: (status: ElectronObsBrowserSourceStatus) => void) => () => void;
      updateTaskbarControls: (state: ElectronTaskbarControlState) => Promise<boolean>;
      onTaskbarControl: (callback: (action: ElectronTaskbarControlAction) => void) => () => void;
      openRemoteControl: () => Promise<boolean>;
      toggleRemoteControl: () => Promise<boolean>;
      closeRemoteControl: () => Promise<boolean>;
      getRemoteControlAlwaysOnTop: () => Promise<boolean>;
      setRemoteControlAlwaysOnTop: (alwaysOnTop: boolean) => Promise<boolean>;
      publishRemoteControlSnapshot: (snapshot: ElectronRemoteControlSnapshot) => Promise<boolean>;
      getRemoteControlSnapshot: () => Promise<ElectronRemoteControlSnapshot | null>;
      sendRemoteControlCommand: (command: ElectronRemoteControlCommand) => Promise<boolean>;
      onRemoteControlCommand: (callback: (command: ElectronRemoteControlCommand) => void) => () => void;
      onRemoteControlSnapshot: (callback: (snapshot: ElectronRemoteControlSnapshot) => void) => () => void;
      chooseVideoExportPath: (
        defaultName?: string,
        extension?: 'mp4' | 'webm',
        displayName?: string,
      ) => Promise<ElectronSaveDialogResult>;
      reportDevicePixelRatio: (ratio: number) => Promise<void>;
      getMainWindowCaptureSource: () => Promise<ElectronWindowCaptureSource | null>;
      // Returns `false` when the resize could not be prepared, otherwise the resolved DPR.
      prepareVideoExportWindow: (size: { width: number; height: number }) => Promise<false | { success: boolean; dpr: number }>;
      restoreVideoExportWindow: () => Promise<boolean>;
      writeVideoExportFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;
      getStageStatus: () => Promise<StageStatus>;
      setStageEnabled: (enabled: boolean) => Promise<StageStatus>;
      regenerateStageToken: () => Promise<StageStatus>;
      clearStageState: () => Promise<StageStatus>;
      completeStageExternalPlayRequest: (result: StageExternalPlayResult) => Promise<boolean>;
      publishStagePlayerSnapshot: (snapshot: StagePlayerSnapshot, options?: { forcePlaybackEvent?: boolean }) => Promise<StagePlayerSnapshot>;
      completeStagePlayerControlRequest: (result: StagePlayerRequestResult) => Promise<boolean>;
      completeStagePlayerQueueRequest: (result: StagePlayerRequestResult) => Promise<boolean>;
      onStageSessionUpdated: (callback: (status: StageStatus) => void) => () => void;
      onStageSessionCleared: (callback: (status: StageStatus) => void) => () => void;
      onStageExternalPlayRequest: (callback: (request: StageExternalPlayRequest) => void) => () => void;
      onStagePlayerControlRequest: (callback: (request: StagePlayerControlRequest) => void) => () => void;
      onStagePlayerQueueRequest: (callback: (request: StagePlayerQueueRequest) => void) => () => void;
      mods?: {
        listMods: () => Promise<{ mods: ModRuntimeInfo[]; ffmpeg: ModFfmpegStatus; directories: string[] }>;
        setModEnabled: (modId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string; mods: ModRuntimeInfo[] }>;
        reloadMods: () => Promise<{ mods: ModRuntimeInfo[] }>;
        cancelExport: () => Promise<{ ok: boolean }>;
        invokeModCommand: (modId: string, commandId: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        pushRuntimeSnapshot: (snapshot: ModRuntimeSnapshot) => Promise<{ ok: boolean }>;
        getFfmpegStatus: () => Promise<{ ffmpeg: ModFfmpegStatus }>;
        openModsDirectory: () => Promise<{ ok: boolean; directory?: string; error?: string }>;
        installModFromZip: (zipPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
        onModsStateChanged: (callback: (mods: ModRuntimeInfo[]) => void) => () => void;
        onExportProgress: (callback: (progress: ModExportProgress) => void) => () => void;
        onModLog: (callback: (entry: ModLogEntry) => void) => () => void;
      };
    };
  }
}

export {};
