// src/components/visualizer/elegy/types.ts
// Shared normalized glyph geometry and worker protocol for Elegy.

export interface WritingPoint {
    x: number;
    y: number;
    radius?: number;
}

export interface WritingStroke {
    points: WritingPoint[];
    length: number;
    cumulativeLengths: Float32Array;
}

export interface WritingGlyph {
    char: string;
    width: number;
    height: number;
    strokes: WritingStroke[];
    totalLength: number;
}

export interface ElegyTraceRequest {
    type: 'trace';
    id: number;
    char: string;
    width: number;
    height: number;
    mask: Uint8Array;
}

export interface ElegyTraceSuccess {
    type: 'traced';
    id: number;
    glyph: WritingGlyph;
}

export interface ElegyTraceFailure {
    type: 'failed';
    id: number;
    message: string;
}

export type ElegyTraceResponse = ElegyTraceSuccess | ElegyTraceFailure;
