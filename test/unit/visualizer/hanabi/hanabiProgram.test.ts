// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import type { ParagraphKind, StructureLine } from '@/components/visualizer/paragraphStructure';
import { HANABI_KINDS, profileOf } from '@/components/visualizer/hanabi/catalog';
import {
    advanceChain,
    castShot,
    DEFAULT_HANABI_PARAMS,
    planShots,
    segmentHanabiLine,
    shotLine,
    sliceLine,
    splitLine,
    type HanabiChain,
} from '@/components/visualizer/hanabi/program';
import { buildTimeline, type TimelineShot } from '@/components/visualizer/hanabi/timeline';
import {
    compileHanabiProgram,
    findHanabiParagraphIndexAtTime,
    type HanabiProgram,
} from '@/components/visualizer/hanabi/hanabiProgram';
import { syntheticSong } from '../lumiere/lumiereFixtures';

// test/unit/visualizer/hanabi/hanabiProgram.test.ts
// 花火的编译：分词与切片、切块、选预设、时间安排（取自 lumisynth 的 hanabiProgram 单测，去掉编辑器的锁定 / 候选过滤 / energy），
// 以及 folia 的整首编译 compileHanabiProgram：段落铺满 [0, duration]、前奏与段后的间奏、长间奏切段、纯音乐、段落转场。

/** 逐字计时的一行：words 为 [文字, 秒数] 列表。 */
const timedLine = (start: number, words: Array<[string, number]>): Line => {
    let cursor = start;
    const timed = words.map(([text, duration]) => {
        const word = { text, startTime: cursor, endTime: cursor + duration };
        cursor += duration;
        return word;
    });
    return { fullText: words.map(([text]) => text).join(''), startTime: start, endTime: cursor, words: timed };
};

const structureLine = (index: number, line: Line): StructureLine => ({ sourceIndex: index, line, renderEndTime: line.endTime });

/** 整首歌往后挪 offset 秒。 */
const shiftLines = (lines: readonly Line[], offset: number): Line[] => lines.map(line => ({
    ...line,
    startTime: line.startTime + offset,
    endTime: line.endTime + offset,
    words: line.words.map(word => ({ ...word, startTime: word.startTime + offset, endTime: word.endTime + offset })),
}));

const SEEDS = [1, 3, 7, 11, 23];

/** 最后一个歌词镜头（不是间奏）的序号；没有时 -1。 */
const lastLyricIndex = (shots: ReadonlyArray<{ isBridge: boolean }>) => {
    for (let index = shots.length - 1; index >= 0; index -= 1) if (!shots[index]!.isBridge) return index;
    return -1;
};

describe('花火的分词与切片', () => {
    const line = timedLine(10, [['夜空に', 0.6], ['光る', 0.5], ['星たち', 0.7]]);

    it('按逐字时间的词给出偏移与时间', () => {
        const segments = segmentHanabiLine(line);
        expect(segments.map(segment => [segment.startOffset, segment.endOffset])).toEqual([[0, 3], [3, 5], [5, 8]]);
        [10, 10.6, 11.1].forEach((time, index) => expect(segments[index]!.startTime).toBeCloseTo(time));
        expect(segments[2]!.endTime).toBeCloseTo(11.8);
    });

    it('没有逐字时间时用应用的分词：手动分词优先于 icu-folia，标点并进前一个词', () => {
        const plain: Line = { fullText: '夜空に光る星たち。', startTime: 0, endTime: 9, words: [] };
        const offsets = (target: Line) => segmentHanabiLine(target).map(segment => [segment.startOffset, segment.endOffset]);
        expect(offsets({ ...plain, autoWordSegments: ['夜空', 'に', '光る', '星たち', '。'] }))
            .toEqual([[0, 2], [2, 3], [3, 5], [5, 9]]);
        expect(offsets({ ...plain, wordSegments: ['夜空に光る', '星たち。'], autoWordSegments: ['夜空', 'に', '光る', '星たち', '。'] }))
            .toEqual([[0, 5], [5, 9]]);
        const segments = segmentHanabiLine({ ...plain, wordSegments: ['夜空に光る', '星たち。'] });
        expect(segments[1]!.startTime).toBeCloseTo(5);
    });

    it('切片按偏移裁词、时间按比例；整行原样返回', () => {
        expect(sliceLine(line, 0, line.fullText.length)).toBe(line);
        const tail = sliceLine(line, 4, 8);
        expect(tail.fullText).toBe('る星たち');
        expect(tail.words.map(word => word.text)).toEqual(['る', '星たち']);
        expect(tail.startTime).toBeCloseTo(10.85);
        expect(tail.endTime).toBeCloseTo(11.8);
    });

    it('跨行的切片拼成一行，中间加空格', () => {
        const other = timedLine(20, [['hold ', 0.3], ['on', 0.3]]);
        const merged = shotLine(new Map([[0, line], [1, other]]), [
            { lineIndex: 0, startOffset: 5, endOffset: 8 },
            { lineIndex: 1, startOffset: 0, endOffset: other.fullText.length },
        ])!;
        expect(merged.fullText).toBe('星たち hold on');
        expect(merged.startTime).toBeCloseTo(11.1);
        expect(merged.endTime).toBeCloseTo(20.6);
        expect(shotLine(new Map(), [])).toBeNull();
    });
});

describe('花火的切块', () => {
    it('长行（超过 18 个字）在最接近等分处的词边界切开，切片首尾相接', () => {
        const words: Array<[string, number]> = ['春の風が', '吹いて', '君の声を', '思い出す', '夜空に', '光る星たち', '遠い街で'].map(text => [text, 0.5]);
        const line = timedLine(0, words);
        expect(Array.from(line.fullText).length).toBeGreaterThan(18);
        const pieces = splitLine(structureLine(3, line), DEFAULT_HANABI_PARAMS);
        expect(pieces.length).toBe(2);
        expect(pieces[0]!.slice.startOffset).toBe(0);
        expect(pieces[0]!.slice.endOffset).toBe(pieces[1]!.slice.startOffset);
        expect(pieces[1]!.slice.endOffset).toBe(line.fullText.length);
        // 切口落在词边界上。
        const boundaries = segmentHanabiLine(line).map(segment => segment.startOffset);
        expect(boundaries).toContain(pieces[1]!.slice.startOffset);
        expect(pieces[1]!.startTime).toBeGreaterThan(pieces[0]!.startTime);
        expect(pieces.every(piece => piece.slice.lineIndex === 3)).toBe(true);
    });

    it('长于 6 秒的行也切开；短行不切', () => {
        const slow = timedLine(0, [['ゆっくり', 2.5], ['歌う', 2.5], ['夜', 2.5]]);
        expect(splitLine(structureLine(0, slow), DEFAULT_HANABI_PARAMS).length).toBe(2);
        const short = timedLine(0, [['短い', 1], ['歌', 1]]);
        expect(splitLine(structureLine(0, short), DEFAULT_HANABI_PARAMS)).toHaveLength(1);
    });

    it('一行一个镜头，首尾相接；行后空隙 ≥ 3 秒出间奏镜头', () => {
        const lines = [
            structureLine(0, timedLine(0, [['一', 1], ['二', 1]])),
            structureLine(1, timedLine(2.2, [['三', 1], ['四', 1]])),
            structureLine(2, timedLine(8, [['五', 1], ['六', 1]])),
        ];
        const shots = planShots(lines, 0, 10, DEFAULT_HANABI_PARAMS);
        expect(shots.map(shot => shot.isBridge)).toEqual([false, false, true, false]);
        expect(shots.map(shot => shot.slot)).toEqual(['s0', 's0', null, 's0']);
        expect(shots[1]!.endTime).toBeCloseTo(4.8);
        expect(shots[2]).toMatchObject({ startTime: shots[1]!.endTime, endTime: 8, slices: [] });
        shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime));
        expect(shots.at(-1)!.endTime).toBe(10);
    });
});

describe('花火的选预设', () => {
    const pick = (kind: ParagraphKind = 'verse', shotIndex = 0, chain: HanabiChain = { recent: [], family: null }, isBridge = false) => castShot({
        seed: 's', paragraphIndex: 0, shotIndex, kind, isBridge, chain,
    });

    it('选出的都是目录里的预设，同样的输入选出同样的预设', () => {
        for (let i = 0; i < 20; i += 1) {
            expect(HANABI_KINDS).toContain(pick('chorus', i));
            expect(pick('chorus', i)).toBe(pick('chorus', i));
        }
    });

    it('副歌不选安静的、主歌不选喧哗的', () => {
        for (let i = 0; i < 40; i += 1) {
            expect(profileOf(pick('chorus', i)).mood).not.toBe('quiet');
            expect(profileOf(pick('verse', i)).mood).not.toBe('loud');
        }
    });

    it('族不连续重复，最近用过的不马上再用，间奏偏向烟花多的族', () => {
        const chain: HanabiChain = { recent: [], family: null };
        let previous: string | null = null;
        for (let i = 0; i < 60; i += 1) {
            const kind = pick('chorus', i, chain);
            if (previous) expect(profileOf(kind).family).not.toBe(profileOf(previous).family);
            expect(chain.recent).not.toContain(kind);
            advanceChain(chain, kind);
            previous = kind;
        }
        for (let i = 0; i < 20; i += 1) {
            expect(['senrin', 'uchiage', 'kiku', 'shakudama']).toContain(profileOf(pick('break', i, { recent: [], family: null }, true)).family);
        }
    });
});

describe('花火的时间安排', () => {
    const cam = { rise: 0.5, push: 0.05, roll: 0.01, punch: 0.5 };
    const shots: TimelineShot[] = [
        { startTime: 0, endTime: 3, firstSung: 0.2, lastSungEnd: 2.8, isBridge: false, camera: cam },
        { startTime: 3, endTime: 6, firstSung: 3, lastSungEnd: 5.9, isBridge: false, camera: cam },
        { startTime: 6, endTime: 9, firstSung: null, lastSungEnd: null, isBridge: true, camera: cam },
    ];
    const timeline = buildTimeline(shots, { unitStart: 0, unitEnd: 9, height: 1000, riseSpeed: 1, motion: 1 });

    it('每个镜头放在上一个的上方；文字在第一个字被唱到之前入场，退场在下一个边界的上升里', () => {
        const [a, b] = timeline.shots;
        expect(timeline.shots.map(shot => shot.worldY)).toEqual([0, -500, -1000]);
        expect(b!.enterAt).toBeLessThan(3);
        expect(b!.launchAt).toBeCloseTo(b!.enterAt - 0.45);
        expect(a!.exitAt).toBeGreaterThanOrEqual(b!.riseIn!.from);
        expect(a!.exitAt).toBeLessThanOrEqual(3);
        expect(a!.exitAt + a!.exitDuration).toBeLessThanOrEqual(b!.riseIn!.to + 1e-9);
    });

    it('rise(t) 连续、只由 t 决定，边界处上升一个镜头的距离', () => {
        let last = timeline.rise(0);
        for (let t = 0; t <= 9; t += 0.01) {
            const value = timeline.rise(t);
            expect(Math.abs(value - last)).toBeLessThan(20);
            expect(value).toBeGreaterThanOrEqual(last - 1e-6);
            last = value;
        }
        expect(timeline.rise(4.5)).toBeCloseTo(500, 0);
        expect(timeline.rise(1.234)).toBe(timeline.rise(1.234));
        expect(timeline.shotAt(3.5)).toBe(1);
    });

    it('上升速度为 0 时镜头原地切换', () => {
        const flat = buildTimeline(shots, { unitStart: 0, unitEnd: 9, height: 1000, riseSpeed: 0, motion: 1 });
        expect(flat.shots.every(shot => shot.worldY === 0)).toBe(true);
        expect(flat.rise(5)).toBe(0);
    });
});

// ─── folia 的整首编译 ──────────────────────────────────────────────────────

const compileSong = (seed: number, tail = 20) => {
    const lines = syntheticSong(seed);
    return { lines, program: compileHanabiProgram(lines, `hanabi-${seed}`, {}, { duration: lines.at(-1)!.endTime + tail }) };
};

const expectTiled = (program: HanabiProgram) => {
    const { paragraphs } = program;
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs[0]!.startTime).toBe(0);
    paragraphs.slice(1).forEach((paragraph, index) => expect(paragraph.startTime).toBe(paragraphs[index]!.endTime));
    expect(paragraphs.at(-1)!.endTime).toBe(program.duration);
    for (const paragraph of paragraphs) {
        const { shots } = paragraph;
        expect(shots.length).toBeGreaterThan(0);
        expect(shots[0]!.startTime).toBeCloseTo(paragraph.startTime, 6);
        shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime, 6));
        expect(shots.at(-1)!.endTime).toBeCloseTo(paragraph.endTime, 6);
    }
};

describe('花火编译整首歌', () => {
    it('结果确定：同样的歌词与种子得到逐字段相同的程序，种子不同预设也不同', () => {
        const lines = syntheticSong(7);
        const a = compileHanabiProgram(lines, 'seed', {}, { duration: 200 });
        expect(compileHanabiProgram(lines, 'seed', {}, { duration: 200 })).toEqual(a);
        const b = compileHanabiProgram(lines, 'other', {}, { duration: 200 });
        const kinds = (program: HanabiProgram) => program.paragraphs.flatMap(paragraph => paragraph.shots.map(shot => shot.kind));
        expect(kinds(b)).not.toEqual(kinds(a));
        expect(compileHanabiProgram(lines, undefined).seed).toBe('hanabi');
    });

    it.each(SEEDS)('段落首尾相接铺满 [0, duration]，镜头首尾相接（歌 %i）', (seed) => {
        const { lines, program } = compileSong(seed);
        expect(program.instrumental).toBe(false);
        expect(program.duration).toBeCloseTo(lines.at(-1)!.endTime + 20, 6);
        expectTiled(program);
        // 没给 duration 时铺到最后一行唱完。
        const bare = compileHanabiProgram(lines, 'bare');
        expectTiled(bare);
        expect(bare.duration).toBe(bare.lyricEndTime);
    });

    it.each(SEEDS)('镜头覆盖每一行，切片是行内真实偏移，族不连续（歌 %i）', (seed) => {
        const { lines, program } = compileSong(seed);
        const covered = new Set(program.paragraphs.flatMap(paragraph => paragraph.shots.flatMap(shot => shot.slices.map(slice => slice.lineIndex))));
        lines.forEach((_, index) => expect(covered.has(index)).toBe(true));
        let previousFamily: string | null = null;
        for (const paragraph of program.paragraphs) {
            expect(paragraph.lines.length).toBe(paragraph.lineIndices.length);
            paragraph.lineIndices.forEach((lineIndex, index) => expect(paragraph.lines[index]).toBe(lines[lineIndex]));
            for (const shot of paragraph.shots) {
                expect(shot.isBridge).toBe(shot.slices.length === 0);
                shot.slices.forEach(slice => {
                    expect(paragraph.lineIndices).toContain(slice.lineIndex);
                    expect(slice.endOffset).toBeGreaterThan(slice.startOffset);
                    expect(slice.endOffset).toBeLessThanOrEqual(lines[slice.lineIndex]!.fullText.length);
                });
                const family = profileOf(shot.kind).family;
                if (previousFamily) expect(family).not.toBe(previousFamily);
                previousFamily = family;
            }
        }
    });

    it('第一句在 3 秒之后才开始时，前面单独有一个间奏段', () => {
        let withIntro = 0;
        let withoutIntro = 0;
        for (const seed of SEEDS) {
            const { lines, program } = compileSong(seed);
            const first = program.paragraphs[0]!;
            const firstStart = lines[0]!.startTime;
            if (firstStart >= 3) {
                withIntro += 1;
                expect(first).toMatchObject({ kind: 'break', startTime: 0, endTime: firstStart, lineIndices: [] });
                expect(first.shots.every(shot => shot.isBridge)).toBe(true);
                expect(program.paragraphs[1]!.lineIndices[0]).toBe(0);
            } else {
                withoutIntro += 1;
                expect(first.lineIndices[0]).toBe(0);
                expect(first.shots[0]!.isBridge).toBe(false);
            }
        }
        expect(withIntro).toBeGreaterThan(0);
        expect(withoutIntro).toBeGreaterThan(0);

        // 25 秒的前奏：一个间奏段，切成约 7 秒的四个间奏镜头。
        const late = compileHanabiProgram(shiftLines(syntheticSong(7), 25 - syntheticSong(7)[0]!.startTime), 'late');
        const intro = late.paragraphs[0]!;
        expect(intro).toMatchObject({ kind: 'break', startTime: 0, lineIndices: [] });
        expect(intro.endTime).toBeCloseTo(25, 6);
        expect(intro.shots).toHaveLength(4);
        intro.shots.forEach(shot => expect(shot.endTime - shot.startTime).toBeCloseTo(25 / 4, 6));
    });

    it('段后空隙 ≥ 3 秒：最后一句唱完 0.6 秒收住，剩下的是间奏镜头', () => {
        let checked = 0;
        for (const seed of SEEDS) {
            const { program } = compileSong(seed);
            for (const paragraph of program.paragraphs) {
                if (paragraph.lineIndices.length === 0) continue;
                const lastLyric = lastLyricIndex(paragraph.shots);
                const lyricShot = paragraph.shots[lastLyric]!;
                if (paragraph.endTime - paragraph.lyricEndTime >= 3) {
                    checked += 1;
                    expect(lyricShot.endTime).toBeCloseTo(Math.max(lyricShot.startTime + 0.05, paragraph.lyricEndTime + 0.6), 6);
                    const rest = paragraph.shots.slice(lastLyric + 1);
                    expect(rest.length).toBeGreaterThan(0);
                    expect(rest.every(shot => shot.isBridge)).toBe(true);
                    expect(rest.at(-1)!.endTime).toBeCloseTo(paragraph.endTime, 6);
                } else {
                    // 空隙短：最后一句留到段落结束。
                    expect(lastLyric).toBe(paragraph.shots.length - 1);
                }
            }
        }
        expect(checked).toBeGreaterThan(3);
    });

    it('长于 10 秒的间奏镜头切成约 7 秒的几段', () => {
        for (const seed of SEEDS) {
            const { program } = compileSong(seed, 40);
            const bridges = program.paragraphs.flatMap(paragraph => paragraph.shots.filter(shot => shot.isBridge));
            bridges.forEach(shot => expect(shot.endTime - shot.startTime).toBeLessThanOrEqual(10 + 1e-9));
            // 最后一句之后 40 秒的尾奏（减去 0.6 秒余韵）：几段等长、每段 5–10 秒。
            const last = program.paragraphs.at(-1)!;
            const tail = last.shots.slice(lastLyricIndex(last.shots) + 1);
            expect(tail.length).toBeGreaterThanOrEqual(4);
            const lengths = tail.map(shot => shot.endTime - shot.startTime);
            lengths.forEach(length => {
                expect(length).toBeGreaterThanOrEqual(5);
                expect(length).toBeLessThanOrEqual(10);
                expect(length).toBeCloseTo(lengths[0]!, 6);
            });
        }
    });

    it('纯音乐：没有歌词时缺省 480 秒，全是间奏镜头', () => {
        const program = compileHanabiProgram([], 'instrumental');
        expect(program).toMatchObject({ instrumental: true, duration: 480, lyricEndTime: null });
        expectTiled(program);
        expect(program.paragraphs.length).toBeGreaterThan(1);
        program.paragraphs.forEach(paragraph => {
            expect(paragraph.kind).toBe('break');
            expect(paragraph.lineIndices).toEqual([]);
            expect(paragraph.shots.every(shot => shot.isBridge && shot.slices.length === 0)).toBe(true);
            paragraph.shots.forEach(shot => expect(shot.endTime - shot.startTime).toBeLessThanOrEqual(10 + 1e-9));
        });
        const short = compileHanabiProgram([], 'instrumental', {}, { duration: 200 });
        expect(short.duration).toBe(200);
        expectTiled(short);
    });

    it('每个非末段都有结束在段落边界的转场，相邻两次不重复，约一半是上升', () => {
        let ascend = 0;
        let total = 0;
        const programs = [
            ...SEEDS.map(seed => compileSong(seed).program),
            ...Array.from({ length: 30 }, (_, index) => compileHanabiProgram([], `instrumental-${index}`)),
        ];
        for (const program of programs) {
            const { paragraphs } = program;
            expect(paragraphs.at(-1)!.transitionOut).toBeNull();
            paragraphs.slice(0, -1).forEach((paragraph, index) => {
                const out = paragraph.transitionOut!;
                expect(out).not.toBeNull();
                expect(out.endTime).toBe(paragraph.endTime);
                expect(out.startTime).toBeGreaterThanOrEqual(paragraph.startTime);
                expect(out.startTime).toBeLessThan(out.endTime);
                const previous = paragraphs[index - 1]?.transitionOut;
                if (previous) expect(out.kind).not.toBe(previous.kind);
                total += 1;
                if (out.kind === 'ascend') ascend += 1;
            });
        }
        expect(total).toBeGreaterThan(300);
        expect(ascend / total).toBeGreaterThan(0.4);
        expect(ascend / total).toBeLessThan(0.6);
    });

    it('按时间找段落：第一段之前算第一段，最后一段之后算最后一段', () => {
        const { program } = compileSong(11);
        const { paragraphs } = program;
        expect(findHanabiParagraphIndexAtTime(program, -5)).toBe(0);
        expect(findHanabiParagraphIndexAtTime(program, program.duration + 100)).toBe(paragraphs.length - 1);
        paragraphs.forEach((paragraph, index) => {
            expect(findHanabiParagraphIndexAtTime(program, paragraph.startTime)).toBe(index);
            expect(findHanabiParagraphIndexAtTime(program, (paragraph.startTime + paragraph.endTime) / 2)).toBe(index);
        });
    });
});
