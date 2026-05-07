/// <reference types="vite/client" />

declare global {
  const __COMMIT_HASH__: string;
  const __GIT_BRANCH__: string;
  const __APP_VERSION__: string;

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

  interface StageSession {
    id: string;
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string | null;
    coverArtUrl?: string | null;
    audioUrl?: string | null;
    audioSrc: string;
    audioMimeType?: string;
    coverMimeType?: string;
    lyricsText?: string | null;
    lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc' | null;
    updatedAt: number;
  }

  interface StageStatus {
    enabled: boolean;
    port: number;
    token: string | null;
    hasSession: boolean;
    session: StageSession | null;
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
      getStageStatus: () => Promise<StageStatus>;
      setStageEnabled: (enabled: boolean) => Promise<StageStatus>;
      regenerateStageToken: () => Promise<StageStatus>;
      clearStageSession: () => Promise<StageStatus>;
      onStageSessionUpdated: (callback: (status: StageStatus) => void) => () => void;
      onStageSessionCleared: (callback: (status: StageStatus) => void) => () => void;
    };
  }
}

export {};
