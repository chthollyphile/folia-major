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

  interface ElectronTaskbarControlState {
    hasActiveTrack: boolean;
    canGoPrevious: boolean;
    canGoNext: boolean;
    isPlaying: boolean;
  }

  type ElectronTaskbarControlAction = 'previous' | 'play-pause' | 'next';

  type ElectronRemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: ElectronVideoExportPreset; startMode: ElectronVideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' };

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
    exportState: ElectronVideoExportState;
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
    formatHint?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | 'qrc';
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
    lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | 'qrc' | null;
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
  }

  interface StageStatus {
    enabled: boolean;
    modeEnabled?: boolean;
    source?: StageSource | null;
    port: number;
    token: string | null;
    activeEntryKind: StageActiveEntryKind | null;
    lyricsSession: StageLyricsSession | null;
    mediaSession: StageMediaSession | null;
  }

  interface Window {
    electron?: {
      getSettings: () => Promise<any>;
      saveSettings: (key: string, value: any) => Promise<any>;
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
      generateTheme: (lyricsText: string, options?: { isPureMusic?: boolean; songTitle?: string }) => Promise<any>;
      getNeteasePort: () => Promise<number>;
      minimizeWindow: () => Promise<boolean>;
      toggleMaximizeWindow: () => Promise<boolean>;
      closeWindow: () => Promise<boolean>;
      isWindowMaximized: () => Promise<boolean>;
      updateTaskbarControls: (state: ElectronTaskbarControlState) => Promise<boolean>;
      onTaskbarControl: (callback: (action: ElectronTaskbarControlAction) => void) => () => void;
      openRemoteControl: () => Promise<boolean>;
      closeRemoteControl: () => Promise<boolean>;
      publishRemoteControlSnapshot: (snapshot: ElectronRemoteControlSnapshot) => Promise<boolean>;
      getRemoteControlSnapshot: () => Promise<ElectronRemoteControlSnapshot | null>;
      sendRemoteControlCommand: (command: ElectronRemoteControlCommand) => Promise<boolean>;
      onRemoteControlCommand: (callback: (command: ElectronRemoteControlCommand) => void) => () => void;
      onRemoteControlSnapshot: (callback: (snapshot: ElectronRemoteControlSnapshot) => void) => () => void;
      chooseVideoExportPath: (defaultName?: string) => Promise<ElectronSaveDialogResult>;
      getMainWindowCaptureSource: () => Promise<ElectronWindowCaptureSource | null>;
      prepareVideoExportWindow: (size: { width: number; height: number }) => Promise<boolean>;
      restoreVideoExportWindow: () => Promise<boolean>;
      writeVideoExportFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;
      getStageStatus: () => Promise<StageStatus>;
      setStageEnabled: (enabled: boolean) => Promise<StageStatus>;
      regenerateStageToken: () => Promise<StageStatus>;
      clearStageState: () => Promise<StageStatus>;
      completeStageExternalPlayRequest: (result: StageExternalPlayResult) => Promise<boolean>;
      onStageSessionUpdated: (callback: (status: StageStatus) => void) => () => void;
      onStageSessionCleared: (callback: (status: StageStatus) => void) => () => void;
      onStageExternalPlayRequest: (callback: (request: StageExternalPlayRequest) => void) => () => void;
    };
  }
}

export {};
