// Folia renderer API 2. All times are absolute song seconds; viewport dimensions are bitmap pixels.
/** Optional pack manifest metadata; legacy omission displays as personality without rewriting the pack. */
interface FoliaStyleClassification {
    kind?: 'personality' | 'lyric-template';
    /** Reference provenance, not an executable dependency or automatic composition. */
    lyricTemplate?: 'classic' | 'cadenza' | 'partita' | 'fume' | 'tilt' | 'claddagh' | 'monet' | 'pendolo' | 'cappella' | 'diorama' | 'still';
}
interface FoliaGlyph { text: string; start: number; end: number }
interface FoliaLine {
    text: string; translation: string; start: number; end: number; chorus: boolean;
    words: FoliaGlyph[]; glyphs: FoliaGlyph[];
}
interface FoliaScene { title: string; artist: string; album: string; duration: number; lines: FoliaLine[] }
interface FoliaFrame {
    time: number; duration: number; index: number; paused: boolean;
    width: number; height: number; dpr: number;
    title: string; artist: string; album: string; current: string; previous: string; next: string; translation: string;
    audio: number; spectrum: readonly number[];
    theme: { background: string; primary: string; secondary: string; accent: string };
    fontFamily: string; fontWeight: number; fontScale: number;
    subtitleFontFamily: string; subtitleFontWeight: number; subtitleFontScale: number;
    reducedMotion: boolean; showText: boolean;
}
interface FoliaContext {
    canvas: OffscreenCanvas;
    /** Live reference. Do not destructure this: cover can change after initialization. Do not close it. */
    cover: ImageBitmap | null;
    settings: Record<string, string | number | boolean>;
    palette: { background: string; primary: string; secondary: string; accent: string };
    /** id → data URL. Decode locally with atob/Blob; network fetch is disabled. */
    assets: Record<string, string>;
}
interface FoliaRenderer {
    update?(scene: FoliaScene): void | Promise<void>;
    render(frame: FoliaFrame): void | Promise<void>;
    dispose?(): void;
}
declare const FoliaStyle: { define(factory: (context: FoliaContext) => FoliaRenderer | Promise<FoliaRenderer>): void };
