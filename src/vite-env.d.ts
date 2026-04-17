/// <reference types="vite/client" />

declare const __COMMIT_HASH__: string;
declare const __GIT_BRANCH__: string;
declare const __APP_VERSION__: string;

declare global {
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

  interface Window {
    electron?: {
      getSettings: () => Promise<any>;
      saveSettings: (key: string, value: any) => Promise<any>;
      getCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      chooseCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      resetCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
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
    };
  }
}
