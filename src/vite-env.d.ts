/// <reference types="vite/client" />

declare global {
  const __COMMIT_HASH__: string;
  const __GIT_BRANCH__: string;
  const __APP_VERSION__: string;
  const __APP_VERSION_LABEL__: string;

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
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: string;
    canGoPrevious: boolean;
    canGoNext: boolean;
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
    updatedAt: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
  }

  interface ElectronPlaybackSyncBridgeStatus {
    remoteControlOpen: boolean;
    discordPresenceEnabled: boolean;
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

  interface Window {
    electron?: {
      getSettings: () => Promise<any>;
      saveSettings: (key: string, value: any) => Promise<any>;
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
      saveAudioCache: (cacheKey: string, data: ArrayBuffer, mimeType?: string) => Promise<boolean>;
      getAudioCacheUsage: () => Promise<number>;
      getAudioCacheStats: () => Promise<ElectronAudioCacheStats>;
      clearAudioCache: () => Promise<boolean>;
      getCoverCache: (cacheKey: string) => Promise<ElectronAudioCacheEntry>;
      saveCoverCache: (cacheKey: string, data: ArrayBuffer, mimeType?: string) => Promise<boolean>;
      removeCoverCache: (cacheKey: string) => Promise<boolean>;
      getCoverCacheUsage: () => Promise<number>;
      clearCoverCache: () => Promise<boolean>;
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
      minimizeWindow: () => Promise<boolean>;
      toggleMaximizeWindow: () => Promise<boolean>;
      toggleFullscreenWindow: () => Promise<boolean>;
      closeWindow: () => Promise<boolean>;
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
      getDiscordPresenceStatus: () => Promise<ElectronDiscordPresenceStatus>;
      publishDiscordPresenceSnapshot: (snapshot: ElectronDiscordPresenceSnapshot) => Promise<ElectronDiscordPresenceStatus>;
      getPlaybackSyncBridgeStatus: () => Promise<ElectronPlaybackSyncBridgeStatus>;
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
      getMainWindowCaptureSource: () => Promise<ElectronWindowCaptureSource | null>;
      prepareVideoExportWindow: (size: { width: number; height: number }) => Promise<boolean>;
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
    };
  }
}

export {};
