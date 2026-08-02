import type { Line } from '../../../types';
import type { GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';

// src/components/visualizer/sonnet/types.ts
// Public, renderer-independent contracts for the deterministic Sonnet PV program.
export type SonnetParagraphKind = 'breath' | 'verse' | 'lift' | 'chorus' | 'break' | 'outro';
export type SonnetParagraphBoundary = 'song-start' | 'time-gap' | 'metadata' | 'duration-cap' | 'line-cap';
export type SonnetShotKind =
    | 'editorial-column'
    | 'type-impact'
    | 'fragment-collage'
    | 'tracking-ribbon'
    | 'mask-reveal'
    | 'quiet-tableau';
export const SONNET_TRANSITION_KINDS = [
    'fast-blur',
    'mono-glitch',
    'camera-pull',
] as const;
export type SonnetTransitionKind = typeof SONNET_TRANSITION_KINDS[number];

export interface SonnetSemanticSegment {
    text: string;
    startOffset: number;
    endOffset: number;
    startTime: number;
    endTime: number;
    wordIndices: number[];
    graphemes: GraphemeTiming[];
    isWordLike: boolean;
}

export interface SonnetCompiledLine {
    sourceIndex: number;
    line: Line;
    renderEndTime: number;
    segments: SonnetSemanticSegment[];
}

export interface SonnetAnimationCue {
    at: number;
    duration: number;
    kind: 'enter' | 'hold' | 'exit' | 'accent';
    segmentStart: number;
    segmentEnd: number;
}

export interface SonnetShot {
    id: string;
    kind: SonnetShotKind;
    startTime: number;
    endTime: number;
    lineIndices: number[];
    cues: SonnetAnimationCue[];
    camera: {
        x: number;
        y: number;
        zoom: number;
        rotation: number;
    };
}

export interface SonnetTransition {
    kind: SonnetTransitionKind;
    startTime: number;
    endTime: number;
}

export interface SonnetParagraph {
    id: string;
    kind: SonnetParagraphKind;
    boundary: SonnetParagraphBoundary;
    startTime: number;
    endTime: number;
    lines: SonnetCompiledLine[];
    shots: SonnetShot[];
    transitionOut: SonnetTransition | null;
}

export interface SonnetProgram {
    version: 1;
    seed: string;
    paragraphGapThreshold: number;
    paragraphs: SonnetParagraph[];
}

export interface SonnetShotTemplate {
    kind: SonnetShotKind;
    supports: (lines: SonnetCompiledLine[], paragraphKind: SonnetParagraphKind) => boolean;
}

export interface SonnetTransitionTemplate {
    kind: SonnetTransitionKind;
}
