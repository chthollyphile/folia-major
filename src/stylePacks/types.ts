import type { StyleKind, LyricTemplateId } from './catalog';

// Public, data-only style pack v1 contract, shared by the player, Studio and CLI.
export type PackColor = string;
export interface PackMotion {
    kind: 'float' | 'pulse' | 'rotate';
    amount: number;
    period: number;
    signal: 'time' | 'audio';
}
export interface PackLayer {
    id: string;
    kind: 'rect' | 'ellipse' | 'cover' | 'text' | 'lyrics' | 'progress' | 'spectrum';
    x: number;
    y: number;
    width: number;
    height: number;
    color: PackColor;
    opacity?: number;
    radius?: number;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    source?: 'title' | 'artist' | 'album' | 'literal' | 'current' | 'previous' | 'next' | 'translation';
    text?: string;
    motion?: PackMotion;
}
export interface StylePack {
    format: 'folia-style';
    schemaVersion: 1;
    id: string;
    name: string;
    version: string;
    author: string;
    description?: string;
    /** Omitted by older packs; treated as personality without rewriting saved data. */
    kind?: StyleKind;
    /** Source inspiration only. No runtime dependency or implicit composition with a built-in. */
    lyricTemplate?: LyricTemplateId;
    palette: { background: PackColor; primary: PackColor; secondary: PackColor; accent: PackColor };
    layers: PackLayer[];
    portraitLayers?: PackLayer[];
}
export interface PackFrame {
    time: number;
    duration: number;
    title: string;
    artist: string;
    album: string;
    current: string;
    previous: string;
    next: string;
    translation: string;
    audio: number;
    spectrum: readonly number[];
    cover: CanvasImageSource | null;
    theme: { background: string; primary: string; secondary: string; accent: string };
    fontFamily: string;
    fontWeight: number;
    fontScale: number;
    subtitleFontFamily: string;
    subtitleFontWeight: number;
    subtitleFontScale: number;
    reducedMotion: boolean;
    showText: boolean;
}
