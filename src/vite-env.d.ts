/// <reference types="vite/client" />

declare const __COMMIT_HASH__: string;
declare const __GIT_BRANCH__: string;
declare const __APP_VERSION__: string;

interface Window {
  electron?: {
    getSettings: () => Promise<any>;
    saveSettings: (key: string, value: any) => Promise<any>;
    generateTheme: (lyricsText: string, options?: { isPureMusic?: boolean; songTitle?: string }) => Promise<any>;
    getNeteasePort: () => Promise<number>;
    openDesktopVisualizer: () => Promise<{ isOpen: boolean }>;
    closeDesktopVisualizer: () => Promise<{ isOpen: boolean }>;
    getDesktopVisualizerStatus: () => Promise<{ isOpen: boolean }>;
    getDesktopVisualizerState: () => Promise<import('./types').DesktopVisualizerSnapshot | null>;
    setDesktopVisualizerState: (snapshot: import('./types').DesktopVisualizerSnapshot) => Promise<{ ok: boolean }>;
    getDesktopVisualizerOptions: () => Promise<{ clickThrough: boolean; showBorder: boolean }>;
    setDesktopVisualizerOptions: (options: Partial<{ clickThrough: boolean; showBorder: boolean }>) => Promise<{ clickThrough: boolean; showBorder: boolean }>;
    onDesktopVisualizerState: (listener: (snapshot: import('./types').DesktopVisualizerSnapshot | null) => void) => () => void;
    onDesktopVisualizerOptions: (listener: (options: { clickThrough: boolean; showBorder: boolean }) => void) => () => void;
    onDesktopVisualizerClosed: (listener: () => void) => () => void;
  };
}
