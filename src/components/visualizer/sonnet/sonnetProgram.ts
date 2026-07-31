import type { Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type {
    SonnetAnimationCue,
    SonnetCompiledLine,
    SonnetParagraph,
    SonnetParagraphBoundary,
    SonnetParagraphKind,
    SonnetProgram,
    SonnetShot,
    SonnetShotKind,
    SonnetTransitionKind,
} from './types';
import { hashSonnetSeed } from './sonnetRandom';
import { buildSonnetSemanticSegments } from './sonnetSemantic';

export { buildSonnetSemanticSegments } from './sonnetSemantic';

// src/components/visualizer/sonnet/sonnetProgram.ts
// Compiles unified lyrics into a seek-safe, deterministic PV timeline.
const SHOT_KINDS: SonnetShotKind[] = [
    'editorial-column',
    'type-impact',
    'fragment-collage',
    'tracking-ribbon',
    'mask-reveal',
    'quiet-tableau',
];
const TRANSITION_KINDS: SonnetTransitionKind[] = [
    'whip-pan',
    'match-cut',
    'strip-slice',
    'flash-frame',
    'aperture-wipe',
];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const median = (values: number[]) => {
    if (values.length === 0) return 0.5;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? sorted[middle]) + sorted[middle]) / 2
        : sorted[middle];
};

export const resolveSonnetParagraphGapThreshold = (lines: Line[]) => {
    const gaps = lines.slice(1).map((line, index) => (
        line.startTime - Math.min(getLineRenderEndTime(lines[index]), line.startTime)
    )).filter(gap => gap > 0);
    return clamp(median(gaps) * 2.5, 1.25, 3.5);
};

const metadataChanged = (previous: Line, next: Line) => (
    (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
    || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
);

interface ParagraphDraft {
    lines: SonnetCompiledLine[];
    boundary: SonnetParagraphBoundary;
}

const splitOversizedDraft = (draft: ParagraphDraft): ParagraphDraft[] => {
    const output: ParagraphDraft[] = [];
    let remaining = draft.lines;
    let boundary = draft.boundary;
    while (remaining.length > 6 || (remaining.length > 1 && (remaining.at(-1)!.renderEndTime - remaining[0].line.startTime) > 18)) {
        const candidates = remaining.slice(2, -1).map((line, offset) => ({
            splitIndex: offset + 2,
            gap: line.line.startTime - remaining[offset + 1].renderEndTime,
        }));
        const splitIndex = candidates.sort((a, b) => b.gap - a.gap)[0]?.splitIndex ?? Math.min(4, remaining.length - 1);
        output.push({ lines: remaining.slice(0, splitIndex), boundary });
        remaining = remaining.slice(splitIndex);
        boundary = output.at(-1)!.lines.length >= 6 ? 'line-cap' : 'duration-cap';
    }
    output.push({ lines: remaining, boundary });
    return output;
};

const classifyParagraph = (lines: SonnetCompiledLine[], index: number, total: number): SonnetParagraphKind => {
    if (lines.some(item => item.line.isChorus || /chorus|副歌/i.test(item.line.songPart ?? ''))) return 'chorus';
    if (lines.some(item => /bridge|break|間奏|ブリッジ/i.test(item.line.songPart ?? ''))) return 'break';
    if (index === total - 1) return 'outro';
    const duration = lines.at(-1)!.renderEndTime - lines[0].line.startTime;
    const segmentCount = lines.reduce((sum, line) => sum + line.segments.filter(segment => segment.isWordLike).length, 0);
    const punctuationCount = lines.reduce((sum, line) => sum + (line.line.fullText.match(/[!?！？…]/g)?.length ?? 0), 0);
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
};

const chooseWithoutRepeat = <T extends string>(choices: T[], seed: string, previous: T | null): T => {
    const start = hashSonnetSeed(seed) % choices.length;
    for (let offset = 0; offset < choices.length; offset += 1) {
        const candidate = choices[(start + offset) % choices.length];
        if (candidate !== previous) return candidate;
    }
    return choices[start];
};

const buildCues = (lines: SonnetCompiledLine[]): SonnetAnimationCue[] => {
    const segments = lines.flatMap(line => line.segments).filter(segment => segment.text.length > 0);
    return segments.map((segment, index) => ({
        at: segment.startTime,
        duration: Math.max(0.08, segment.endTime - segment.startTime),
        kind: index === segments.length - 1 ? 'accent' : 'enter',
        segmentStart: index,
        segmentEnd: index + 1,
    }));
};

const groupShotLines = (lines: SonnetCompiledLine[]) => {
    const groups: SonnetCompiledLine[][] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const current = lines[index];
        const next = lines[index + 1];
        const combinedDuration = next ? next.renderEndTime - current.line.startTime : Infinity;
        const bothShort = next
            && current.line.endTime - current.line.startTime < 1.8
            && next.line.endTime - next.line.startTime < 1.8
            && combinedDuration <= 3.5;
        groups.push(bothShort ? [current, next] : [current]);
        if (bothShort) index += 1;
    }
    return groups;
};

const buildShots = (
    lines: SonnetCompiledLine[],
    kind: SonnetParagraphKind,
    paragraphIndex: number,
    seed: string,
    previousKind: SonnetShotKind | null,
): SonnetShot[] => {
    let lastKind = previousKind;
    return groupShotLines(lines).map((group, shotIndex) => {
        const signature = group.map(item => item.line.fullText).join('|');
        let shotKind = chooseWithoutRepeat(SHOT_KINDS, `${seed}:${paragraphIndex}:${shotIndex}:${signature}`, lastKind);
        if (kind === 'breath' && shotIndex === 0) shotKind = 'quiet-tableau';
        if (kind === 'chorus' && shotKind === 'quiet-tableau') shotKind = 'type-impact';
        if ((kind === 'verse' || kind === 'breath') && shotKind === 'type-impact') shotKind = 'editorial-column';
        lastKind = shotKind;
        const random = hashSonnetSeed(`${seed}:${paragraphIndex}:${shotIndex}:camera`);
        return {
            id: `p${paragraphIndex}-s${shotIndex}`,
            kind: shotKind,
            startTime: group[0].line.startTime,
            endTime: group.at(-1)!.renderEndTime,
            lineIndices: group.map(item => item.sourceIndex),
            cues: buildCues(group),
            camera: {
                x: ((random & 255) / 255 - 0.5) * 0.18,
                y: (((random >>> 8) & 255) / 255 - 0.5) * 0.14,
                zoom: 0.92 + ((random >>> 16) & 255) / 255 * 0.2,
                rotation: (((random >>> 24) & 255) / 255 - 0.5) * 0.08,
            },
        };
    });
};

export const compileSonnetProgram = (lines: Line[], seed: string | number = 'sonnet'): SonnetProgram => {
    const compiled = lines.map((line, sourceIndex) => ({
        sourceIndex,
        line,
        // The visual tail may extend beyond authored timing, but never into the next line.
        renderEndTime: Math.max(
            line.startTime,
            Math.min(getLineRenderEndTime(line), lines[sourceIndex + 1]?.startTime ?? Number.POSITIVE_INFINITY),
        ),
        segments: buildSonnetSemanticSegments(line),
    }));
    const paragraphGapThreshold = resolveSonnetParagraphGapThreshold(lines);
    const drafts: ParagraphDraft[] = [];
    let current: ParagraphDraft = { lines: [], boundary: 'song-start' };

    compiled.forEach((line, index) => {
        const previous = compiled[index - 1];
        const gap = previous ? line.line.startTime - previous.renderEndTime : 0;
        const boundary = previous && metadataChanged(previous.line, line.line)
            ? 'metadata'
            : previous && gap >= paragraphGapThreshold
                ? 'time-gap'
                : null;
        if (boundary && current.lines.length > 0) {
            drafts.push(...splitOversizedDraft(current));
            current = { lines: [], boundary };
        }
        current.lines.push(line);
    });
    if (current.lines.length > 0) drafts.push(...splitOversizedDraft(current));

    const resolvedSeed = String(seed);
    let previousShot: SonnetShotKind | null = null;
    let previousTransition: SonnetTransitionKind | null = null;
    const paragraphs: SonnetParagraph[] = drafts.map((draft, index) => {
        const kind = classifyParagraph(draft.lines, index, drafts.length);
        const shots = buildShots(draft.lines, kind, index, resolvedSeed, previousShot);
        previousShot = shots.at(-1)?.kind ?? previousShot;
        const next = drafts[index + 1];
        const endTime = draft.lines.at(-1)!.renderEndTime;
        const gap = next ? next.lines[0].line.startTime - endTime : 0;
        const transitionKind = next
            ? chooseWithoutRepeat(TRANSITION_KINDS, `${resolvedSeed}:${index}:transition`, previousTransition)
            : null;
        if (transitionKind) previousTransition = transitionKind;
        const transitionDuration = next ? (gap >= 1.2 ? Math.min(0.8, gap * 0.65) : Math.min(0.22, Math.max(0.12, gap + 0.12))) : 0;
        return {
            id: `sonnet-p${index}`,
            kind,
            boundary: draft.boundary,
            startTime: draft.lines[0].line.startTime,
            endTime,
            lines: draft.lines,
            shots,
            transitionOut: transitionKind ? {
                kind: transitionKind,
                startTime: Math.max(draft.lines[0].line.startTime, endTime - transitionDuration),
                endTime,
            } : null,
        };
    });

    return { version: 1, seed: resolvedSeed, paragraphGapThreshold, paragraphs };
};

export const findSonnetParagraphIndexAtTime = (program: SonnetProgram, time: number) => {
    for (let index = program.paragraphs.length - 1; index >= 0; index -= 1) {
        if (time >= program.paragraphs[index].startTime) return index;
    }
    return 0;
};
