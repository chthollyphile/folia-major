import { useEffect, useMemo, useRef, useState } from 'react';
import { type Line } from '../../../types';
import {
    BRUT_LINES_AHEAD,
    BRUT_LINES_BEHIND,
    BRUT_RASTER_BUILD_BUDGET,
    BRUT_RASTER_FONT_PX,
} from './brutConstants';
import { buildBrutFontSpec, rasterBrutLine, type BrutLineRaster } from './brutLyricRaster';
import { buildBrutInstallUnits, type BrutInstallUnit } from './brutLyricUnits';

// src/components/visualizer/brut/useBrutLyricRasters.ts
// Line rasters cached per line index and built INCREMENTALLY off the render frame, following the
// pattern in diorama/DioramaScene.tsx:757-823. A song change wants several textures at once, and
// rasterising them all synchronously during render is the main source of a switch-frame hitch.
// Incoming lines are fog-hidden, so a few frames of delay is invisible - but the ACTIVE line is
// built synchronously, because an install animation must never start on an empty quad.
//
// Theme COLOUR must never invalidate this cache: rasters are pure white and get tinted by the
// material, so only the font spec and the lyrics themselves are part of the key.

export interface BrutRasterEntry {
    raster: BrutLineRaster;
    units: BrutInstallUnit[];
}

interface UseBrutLyricRastersOptions {
    lines: Line[];
    activeIndex: number;
    fontStack: string;
    fontWeight: number;
    enabled: boolean;
}

export interface BrutRasterCache {
    get: (index: number) => BrutRasterEntry | null;
    /** Bumps whenever entries land, so consumers can mount their quads. */
    version: number;
}

const buildEntry = (line: Line, fontStack: string, fontWeight: number): BrutRasterEntry => {
    const units = buildBrutInstallUnits(line);
    return { raster: rasterBrutLine(units, fontStack, fontWeight), units };
};

export const useBrutLyricRasters = ({
    lines,
    activeIndex,
    fontStack,
    fontWeight,
    enabled,
}: UseBrutLyricRastersOptions): BrutRasterCache => {
    const cacheRef = useRef<Map<number, BrutRasterEntry>>(new Map());
    const fontKeyRef = useRef('');
    const linesRef = useRef<Line[] | null>(null);
    const [version, bumpVersion] = useState(0);

    const fontSpec = buildBrutFontSpec(fontStack, fontWeight, BRUT_RASTER_FONT_PX);
    const wanted = useMemo(() => {
        if (!enabled || !lines.length) {
            return [] as number[];
        }
        const anchor = Math.max(0, activeIndex);
        const from = Math.max(0, anchor - BRUT_LINES_BEHIND);
        const to = Math.min(lines.length, anchor + BRUT_LINES_AHEAD + 1);
        const indices: number[] = [];
        for (let index = from; index < to; index += 1) {
            if (lines[index]?.fullText?.trim()) {
                indices.push(index);
            }
        }
        return indices;
    }, [activeIndex, enabled, lines]);

    useEffect(() => {
        const cache = cacheRef.current;
        if (fontKeyRef.current !== fontSpec || linesRef.current !== lines) {
            cache.forEach(entry => entry.raster.dispose());
            cache.clear();
            fontKeyRef.current = fontSpec;
            linesRef.current = lines;
        }

        const wantedSet = new Set(wanted);
        let changed = false;
        cache.forEach((entry, index) => {
            if (!wantedSet.has(index)) {
                entry.raster.dispose();
                cache.delete(index);
                changed = true;
            }
        });

        const missing = wanted.filter(index => !cache.has(index));
        if (!missing.length) {
            if (changed) bumpVersion(value => value + 1);
            return undefined;
        }

        let cancelled = false;
        let frameId = 0;
        let cursor = 0;
        const buildBatch = () => {
            if (cancelled) return;
            for (let built = 0; built < BRUT_RASTER_BUILD_BUDGET && cursor < missing.length; built += 1, cursor += 1) {
                const index = missing[cursor];
                const line = lines[index];
                if (line && !cache.has(index)) {
                    cache.set(index, buildEntry(line, fontStack, fontWeight));
                }
            }
            bumpVersion(value => value + 1);
            if (cursor < missing.length) frameId = requestAnimationFrame(buildBatch);
        };
        frameId = requestAnimationFrame(buildBatch);

        return () => {
            cancelled = true;
            if (frameId) cancelAnimationFrame(frameId);
        };
    }, [fontSpec, fontStack, fontWeight, lines, wanted]);

    // Frees the cache's WebGL textures on UNMOUNT only. The incremental effect above disposes what
    // it prunes; three never frees manually created textures on its own.
    useEffect(() => () => {
        cacheRef.current.forEach(entry => entry.raster.dispose());
        cacheRef.current.clear();
    }, []);

    const get = (index: number): BrutRasterEntry | null => {
        const cache = cacheRef.current;
        const existing = cache.get(index);
        if (existing) {
            return existing;
        }
        // Synchronous exception for the active line only.
        if (!enabled || index !== activeIndex) {
            return null;
        }
        const line = lines[index];
        if (!line?.fullText?.trim() || fontKeyRef.current !== fontSpec) {
            return null;
        }
        const entry = buildEntry(line, fontStack, fontWeight);
        cache.set(index, entry);
        return entry;
    };

    return { get, version };
};
