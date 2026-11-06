import type { PackFrame, StylePack } from '../types';

// Renderer API 2: a portable, worker-rendered program with a host-owned clock and bounded inputs.
export interface CodeStylePack extends Omit<StylePack, 'schemaVersion' | 'layers' | 'portraitLayers'> {
    schemaVersion: 2;
    renderer: { apiVersion: 2; code: string };
    settings?: Record<string, string | number | boolean>;
    assets?: { id: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'font/woff2'; data: string }[];
}
export type AnyStylePack = StylePack | CodeStylePack;
export interface CodeLine {
    text: string;
    translation: string;
    start: number;
    end: number;
    chorus: boolean;
    words: { text: string; start: number; end: number }[];
    glyphs: { text: string; start: number; end: number }[];
}
export interface CodeScene { title: string; artist: string; album: string; duration: number; lines: CodeLine[] }
export interface CodeFrame extends Omit<PackFrame, 'cover'> {
    index: number;
    paused: boolean;
    width: number;
    height: number;
    dpr: number;
}
export interface CodeRenderer {
    update?: (scene: CodeScene) => void | Promise<void>;
    render: (frame: CodeFrame) => void | Promise<void>;
    dispose?: () => void;
}
export interface CodeContext {
    canvas: OffscreenCanvas;
    cover: ImageBitmap | null;
    settings: NonNullable<CodeStylePack['settings']>;
    palette: StylePack['palette'];
    assets: Record<string, string>;
}
export interface CodeMetrics { frames: number; lastMs: number; p95Ms: number }
