import { type DioramaGeometryVisibility, type Line } from '../../../types';
import { type GraphemeTiming, splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import { resolveLyricTextDirection } from '../../../utils/lyrics/textDirection';
import { buildFormation, type DioramaMotionParams, getDioramaShot, getDioramaTextPlacement } from './cameraPath';
import { resolveGlobal, type SequencerState } from './dioramaSequencer';
import { DIORAMA_CLUSTER_COLLISION_LINE_SPAN, selectVisibleDioramaClusters, type DioramaParticleClusterAnchor } from './dioramaGeometry';
import { DIORAMA_RASTER_FONT_PX, measureDioramaText, rasterDioramaUnit } from './dioramaTextRaster';
import { buildDioramaParticleCorridorWindow } from './dioramaParticleCorridor';
import {
    CORRIDOR_LINES_AHEAD,
    CORRIDOR_LINES_BEHIND,
    LINES_AHEAD,
    LINES_BEHIND,
    LINE_FONT_SIZE,
    OUTGOING_LINES_AHEAD,
    OUTGOING_LINES_BEHIND,
} from './dioramaSceneConstants';
import { frameQuaternion } from './dioramaSceneUnits';
import { CJK_GRAPHEME_RE, type LyricUnit, type PlacedUnitRaster, type VisibleLineEntry } from './dioramaSceneTypes';

// src/components/visualizer/diorama/dioramaSceneLayout.ts
// 镜台场景的结构推导（纯函数，由 DioramaScene 的 useMemo 调用）：挂载哪些行、每行在路径上的位置，
// 粒子隧道 / 点云的锚点，当前行拆成逐字 / 逐词单元并按整行测量排好位置。

/** Which GLOBAL indices to mount: a forward-weighted window around the current line, plus one around the outgoing line during a transition. */
export const resolveDioramaMountedIndices = (
    globalIndex: number,
    transitionOutgoingIndex: number | null,
    total: number,
): number[] => {
    const indices = new Set<number>();
    const addWindow = (center: number, behind: number, ahead: number) => {
        const start = Math.max(center - behind, 0);
        const end = Math.min(center + ahead, total - 1);
        for (let i = start; i <= end; i += 1) indices.add(i);
    };
    addWindow(globalIndex, LINES_BEHIND, LINES_AHEAD);
    if (transitionOutgoingIndex != null) addWindow(transitionOutgoingIndex, OUTGOING_LINES_BEHIND, OUTGOING_LINES_AHEAD);
    return Array.from(indices).sort((a, b) => a - b);
};

/** Each mounted line staged on its path frame (offset, roll, yaw), tagged with which cluster it belongs to. */
export const buildDioramaVisibleLines = (
    sequencer: SequencerState,
    mountedIndices: readonly number[],
    globalIndex: number,
    transitionOutgoingIndex: number | null,
    weaveScale: number,
): VisibleLineEntry[] => {
    const result: VisibleLineEntry[] = [];
    for (const i of mountedIndices) {
        const resolved = resolveGlobal(sequencer, i);
        if (!resolved || !resolved.line) continue;
        const { frame } = resolved;
        const placement = getDioramaTextPlacement(resolved.localIndex, resolved.segment.seed, weaveScale);
        const position = {
            x: frame.position.x + frame.right.x * placement.offsetR + frame.up.x * placement.offsetU,
            y: frame.position.y + frame.right.y * placement.offsetR + frame.up.y * placement.offsetU,
            z: frame.position.z + frame.right.z * placement.offsetR + frame.up.z * placement.offsetU,
        };
        result.push({
            index: i,
            line: resolved.line,
            placement,
            position: [position.x, position.y, position.z],
            quaternion: frameQuaternion(frame, placement.roll, placement.yaw),
            // A line belongs to the departing cluster if it sits nearer the outgoing centre than the
            // current one (works whether that cluster is a different segment or this corridor's own end).
            isOutgoing: transitionOutgoingIndex != null
                && Math.abs(i - transitionOutgoingIndex) <= Math.abs(i - globalIndex),
        });
    }
    return result;
};

/** Corridor mode only: the tunnel spans for the live window, plus the outgoing one during a song change. */
export const buildDioramaCorridorSpans = (
    sequencer: SequencerState,
    globalIndex: number,
    transitionOutgoingIndex: number | null,
    geometryVisibility: DioramaGeometryVisibility,
    geometryMode: DioramaGeometryVisibility['mode'],
) => {
    // Same master-toggle gate the clouds path gets inside selectVisibleDioramaClusters: with the
    // point-cloud geometry switched off the tunnel must vanish too, not just the clouds.
    if (!geometryVisibility.enabled || geometryMode !== 'corridor') return [];
    // Each window extends its OWN segment past that segment's ends (see the builder). During a song
    // change the two tunnels genuinely coexist - the departing one receding, the incoming one born in
    // the fog - so both windows are built whole and simply concatenated. They can hold the same global
    // index (one as a real line, the other as its own extension) and that is correct: they are
    // TRANSITION_DISTANCE apart in the world.
    const live = buildDioramaParticleCorridorWindow(
        sequencer, globalIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD,
    );
    if (transitionOutgoingIndex == null) return live;
    return [
        ...buildDioramaParticleCorridorWindow(
            sequencer, transitionOutgoingIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD,
        ),
        ...live,
    ];
};

/** Clouds mode only: per-line formation anchors over the mounted window (plus a collision margin), filtered to visible mounted ones. */
export const buildDioramaParticleClusters = (
    sequencer: SequencerState,
    mountedIndices: readonly number[],
    geometryMode: DioramaGeometryVisibility['mode'],
    motion: DioramaMotionParams,
    geometryVisibility: DioramaGeometryVisibility,
    particleScale: number,
) => {
    if (geometryMode !== 'clouds') return [];
    const result: DioramaParticleClusterAnchor[] = [];
    const mounted = new Set(mountedIndices);
    const clusterIndices = new Set<number>();
    for (const i of mountedIndices) {
        for (let back = 0; back <= DIORAMA_CLUSTER_COLLISION_LINE_SPAN; back += 1) {
            if (i - back >= 0) clusterIndices.add(i - back);
        }
    }
    for (const i of Array.from(clusterIndices).sort((a, b) => a - b)) {
        const resolved = resolveGlobal(sequencer, i);
        if (!resolved) continue;
        const { frame, localIndex, segment } = resolved;
        const placement = getDioramaTextPlacement(localIndex, segment.seed, motion.weaveScale);
        const shot = getDioramaShot(localIndex, segment.lines, segment.seed, motion.subMode);
        buildFormation(localIndex, segment.seed, shot, frame, placement, particleScale).forEach((piece, slot) => {
            result.push({
                ...piece,
                key: `${i}-${slot}`,
                sourceLine: i,
                particleSeed: `${segment.seed ?? 'seed'}:${localIndex}:${slot}:${piece.kind}`,
                role: 'formation',
            });
        });
        // Foreground gate clouds are intentionally omitted: their negative depth placed them on the
        // camera side of the lyric rail and was the main source of path crossings and one-sided piles.
    }
    return selectVisibleDioramaClusters(result, geometryVisibility)
        .filter((cluster) => mounted.has(cluster.sourceLine));
};

/** Splits the active line into units: every CJK grapheme alone, consecutive non-CJK graphemes of one word together; whitespace is never a unit. */
export const splitDioramaLyricUnits = (
    activeLine: Line | null,
    activeLineTimeline: readonly GraphemeTiming[],
): LyricUnit[] => {
    if (!activeLine || activeLineTimeline.length === 0) return [];
    const graphemes = splitLyricGraphemes(activeLine.fullText);
    // Prefix code-unit offset of each grapheme, mapping grapheme index -> string index.
    const charOffsets: number[] = [];
    let acc = 0;
    for (const g of graphemes) { charOffsets.push(acc); acc += g.length; }
    const units: LyricUnit[] = [];
    const pushUnit = (from: number, to: number) => {
        const text = graphemes.slice(from, to).join('');
        if (text.trim().length === 0) return;
        units.push({
            text,
            charStart: charOffsets[from] ?? 0,
            charEnd: (charOffsets[to - 1] ?? 0) + (graphemes[to - 1]?.length ?? 1),
            startTime: activeLineTimeline[from].startTime,
            endTime: activeLineTimeline[to - 1].endTime,
        });
    };
    let i = 0;
    while (i < activeLineTimeline.length) {
        const g = graphemes[i] ?? '';
        if (g.trim().length === 0) { i += 1; continue; }
        if (CJK_GRAPHEME_RE.test(g)) {
            pushUnit(i, i + 1);
            i += 1;
            continue;
        }
        // Non-CJK: extend across the same word (same wordIndex), stopping at whitespace or CJK.
        const wordIndex = activeLineTimeline[i].wordIndex;
        let j = i + 1;
        while (
            j < activeLineTimeline.length
            && activeLineTimeline[j].wordIndex === wordIndex
            && (graphemes[j] ?? '').trim().length > 0
            && !CJK_GRAPHEME_RE.test(graphemes[j] ?? '')
        ) {
            j += 1;
        }
        pushUnit(i, j);
        i = j;
    }
    return units;
};

/**
 * Rasterises the active line's units and places each at its kerned slot by measuring prefixes of the full line.
 * An RTL line (Uyghur, Arabic, Hebrew...) runs its prefixes from the right edge, so its first word sits rightmost.
 */
export const layoutDioramaActiveUnits = (
    activeLine: Line | null,
    activeLineUnits: readonly LyricUnit[],
    fontSpec: string,
) => {
    if (!activeLine?.fullText || activeLineUnits.length === 0) return null;
    const worldPerPx = LINE_FONT_SIZE / DIORAMA_RASTER_FONT_PX;
    const full = activeLine.fullText;
    const totalPx = measureDioramaText(full, fontSpec);
    const rtl = resolveLyricTextDirection(full) === 'rtl';
    const units: PlacedUnitRaster[] = activeLineUnits.map((unit) => {
        const prefixPx = measureDioramaText(full.slice(0, unit.charStart), fontSpec);
        const raster = rasterDioramaUnit(full.slice(unit.charStart, unit.charEnd), fontSpec);
        const startPx = prefixPx + raster.advancePx / 2;
        return {
            raster,
            centerX: (rtl ? totalPx / 2 - startPx : -totalPx / 2 + startPx) * worldPerPx,
            width: raster.canvasWidthPx * worldPerPx,
            height: raster.canvasHeightPx * worldPerPx,
        };
    });
    return { units, lineWidth: totalPx * worldPerPx };
};
