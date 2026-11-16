import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import {
    compileMetaphorProgram,
    findMetaphorCue,
    findMetaphorShot,
    METAPHOR_PREROLL,
    METAPHOR_TAIL,
    resolveMetaphorCueTime,
    type MetaphorProgramOptions,
} from '@/components/visualizer/metaphor/metaphorProgram';

// test/unit/visualizer/metaphor/metaphorProgram.test.ts
// 隐喻的分镜表：cue 首尾相接铺满整首、镜头首尾相接铺满 cue、切点落在词开唱上、同一首歌每次编出来一样，
// 以及间奏、纯音乐、关掉反相和转场、按时间找 cue 和镜头。

/** 逐词计时的一行：words 为 [文字, 秒数] 列表。 */
const timedLine = (start: number, words: Array<[string, number]>, isChorus = false): Line => {
    let cursor = start;
    const timed = words.map(([text, duration]) => {
        const word = { text, startTime: cursor, endTime: cursor + duration };
        cursor += duration;
        return word;
    });
    return { fullText: words.map(([text]) => text).join(''), startTime: start, endTime: cursor, words: timed, isChorus } as Line;
};

const OPTIONS: MetaphorProgramOptions = { seed: 'song', title: 'Title', cutPace: 1, negative: true, transitions: true, intensity: 'normal' };

const SONG: Line[] = [
    timedLine(4, [['Light ', 0.5], ['falls ', 0.5], ['on ', 0.4], ['the ', 0.4], ['empty ', 0.6], ['stage', 0.8]]),
    timedLine(8, [['落叶', 0.8], ['数着', 0.8], ['每一拍', 1.2]]),
    timedLine(11.5, [['Hold ', 0.6], ['this ', 0.6], ['note ', 0.8], ['longer', 1.6]], true),
    // 隔了很久才来的一句：前面插一段间奏
    timedLine(30, [['Then ', 0.5], ['let ', 0.5], ['it ', 0.4], ['fade ', 0.8], ['away', 1.2]]),
];

describe('compileMetaphorProgram', () => {
    it('cue 首尾相接，从 0 铺到没有尽头', () => {
        const { cues } = compileMetaphorProgram(SONG, OPTIONS);
        expect(cues[0].start).toBe(0);
        cues.slice(1).forEach((cue, index) => expect(cue.start).toBe(cues[index].end));
        expect(cues[cues.length - 1].end).toBe(Number.POSITIVE_INFINITY);
        // 每句歌词各有一个 cue，按顺序
        expect(cues.filter(cue => cue.lineIndex >= 0).map(cue => cue.lineIndex)).toEqual([0, 1, 2, 3]);
    });

    it('开头够长时是带曲名的间奏；歌词比开唱早一点出现', () => {
        const { cues } = compileMetaphorProgram(SONG, OPTIONS);
        expect(cues[0]).toMatchObject({ lineIndex: -1, text: 'Title', start: 0, transition: 'cut' });
        expect(cues[1].start).toBeCloseTo(SONG[0].startTime - METAPHOR_PREROLL);
        expect(cues[1].singStart).toBe(SONG[0].startTime);
    });

    it('下一句离得近就留到它来；离得远，化开后让给间奏', () => {
        const { cues } = compileMetaphorProgram(SONG, OPTIONS);
        const second = cues.find(cue => cue.lineIndex === 1)!;
        const third = cues.find(cue => cue.lineIndex === 2)!;
        expect(second.end).toBeCloseTo(SONG[2].startTime - METAPHOR_PREROLL);
        expect(third.end).toBeCloseTo(SONG[2].endTime + METAPHOR_TAIL);
        const gap = cues[cues.indexOf(third) + 1];
        expect(gap).toMatchObject({ lineIndex: -1, text: '' });
        expect(gap.end).toBeCloseTo(SONG[3].startTime - METAPHOR_PREROLL);
    });

    it('镜头首尾相接铺满 cue，每个都不短于 0.6 秒', () => {
        const { cues } = compileMetaphorProgram(SONG, OPTIONS);
        for (const cue of cues) {
            expect(cue.shots.length).toBeGreaterThan(0);
            expect(cue.shots[0].start).toBe(cue.start);
            cue.shots.slice(1).forEach((shot, index) => expect(shot.start).toBe(cue.shots[index].end));
            const last = cue.shots[cue.shots.length - 1];
            expect(last.end).toBe(cue.loop > 0 ? cue.start + cue.loop : cue.end);
            if (cue.lineIndex >= 0) cue.shots.forEach(shot => expect(shot.end - shot.start).toBeGreaterThanOrEqual(0.6 - 1e-9));
        }
    });

    it('一句里的切点落在词开唱的时刻上', () => {
        const { cues } = compileMetaphorProgram(SONG, OPTIONS);
        const onsets = new Set(SONG.flatMap(line => line.words.map(word => word.startTime)));
        const cuts = cues.filter(cue => cue.lineIndex >= 0).flatMap(cue => cue.shots.slice(1).map(shot => shot.start));
        expect(cuts.length).toBeGreaterThan(0);
        expect(cuts.filter(cut => onsets.has(cut)).length).toBeGreaterThan(cuts.length / 2);
    });

    it('同一首歌每次编出来一样；换一首不一样', () => {
        expect(compileMetaphorProgram(SONG, OPTIONS)).toEqual(compileMetaphorProgram(SONG, OPTIONS));
        expect(compileMetaphorProgram(SONG, { ...OPTIONS, seed: 'other' })).not.toEqual(compileMetaphorProgram(SONG, OPTIONS));
    });

    it('切得快镜头就多', () => {
        const count = (cutPace: number) => compileMetaphorProgram(SONG, { ...OPTIONS, cutPace }).cues.reduce((sum, cue) => sum + cue.shots.length, 0);
        expect(count(2)).toBeGreaterThan(count(0.4));
    });

    it('关掉反相就没有反相的镜头，关掉转场就全是硬切', () => {
        const plain = compileMetaphorProgram(SONG, { ...OPTIONS, negative: false, transitions: false });
        expect(plain.cues.every(cue => cue.transition === 'cut')).toBe(true);
        expect(plain.cues.every(cue => cue.shots.every(shot => !shot.invert))).toBe(true);
    });

    it('没有偏转、俯仰的机位，也没有甩镜', () => {
        const lines = Array.from({ length: 80 }, (_, index) => timedLine(index * 5, [['one ', 1], ['two ', 1], ['three', 1.5]], index % 3 === 1));
        const { cues } = compileMetaphorProgram(lines, OPTIONS);
        const kinds = new Set(cues.flatMap(cue => cue.shots.map(shot => shot.kind)));
        const transitions = new Set(cues.map(cue => cue.transition));
        expect([...kinds].sort()).toEqual(['close', 'dutch', 'follow', 'macro', 'pullback', 'pushin', 'void', 'wide']);
        expect([...transitions].sort()).toEqual(['cut', 'flood', 'smash']);
        for (const cue of cues) for (const shot of cue.shots) expect(Object.keys(shot)).not.toEqual(expect.arrayContaining(['yaw', 'pitch']));
    });

    it('冲镜转场的第一个镜头是冲镜', () => {
        const lines = Array.from({ length: 60 }, (_, index) => timedLine(index * 4, [['one ', 1], ['two ', 1], ['three', 1.5]], index % 2 === 1));
        const { cues } = compileMetaphorProgram(lines, OPTIONS);
        const smashed = cues.filter(cue => cue.transition === 'smash' && cue.lineIndex >= 0);
        expect(smashed.length).toBeGreaterThan(0);
        smashed.forEach(cue => expect(cue.shots[0].kind).toBe('pushin'));
    });

    const plainLine = (start: number, end: number, text: string): Line => (
        { fullText: text, startTime: start, endTime: end, words: [{ text, startTime: start, endTime: end }] } as Line
    );
    const allFinite = (program: ReturnType<typeof compileMetaphorProgram>) => program.cues.every((cue, index) => (
        Number.isFinite(cue.start) && cue.shots.length > 0
        && ((Number.isFinite(cue.end) && Number.isFinite(cue.singEnd)) || index === program.cues.length - 1)
        && cue.shots.every(shot => Number.isFinite(shot.start) && Number.isFinite(shot.end))
    ));

    it('结束时间不是数的句子照样排得出来，最后还是一个不结束的间奏', () => {
        const program = compileMetaphorProgram([plainLine(2, Number.NaN, 'one two'), plainLine(5, 7, 'three four'), plainLine(9, Number.NaN, 'five six')], OPTIONS);
        expect(allFinite(program)).toBe(true);
        expect(program.cues.filter(cue => cue.lineIndex >= 0).map(cue => cue.lineIndex)).toEqual([0, 1, 2]);
        expect(program.cues.at(-1)).toMatchObject({ lineIndex: -1, end: Number.POSITIVE_INFINITY });
    });

    it('同时开唱的两句（对唱）：排先来的那句，不会两句都丢', () => {
        const program = compileMetaphorProgram([plainLine(10, 14, 'lead line here'), plainLine(10, 13, 'backing'), plainLine(20, 22, 'after')], OPTIONS);
        expect(allFinite(program)).toBe(true);
        expect(program.cues.filter(cue => cue.lineIndex >= 0).map(cue => cue.lineIndex)).toEqual([0, 2]);
        const lead = program.cues.find(cue => cue.lineIndex === 0)!;
        expect(lead.end - lead.start).toBeGreaterThan(3);
    });

    it('没按时间排好的歌词先排序再编', () => {
        const program = compileMetaphorProgram([plainLine(10, 14, 'second'), plainLine(4, 6, 'first'), plainLine(20, 22, 'third')], OPTIONS);
        expect(allFinite(program)).toBe(true);
        expect(program.cues.filter(cue => cue.lineIndex >= 0).map(cue => cue.lineIndex)).toEqual([1, 0, 2]);
    });

    it('主题的动效强度不认识时按标准算', () => {
        const odd = compileMetaphorProgram(SONG, { ...OPTIONS, intensity: 'wild' as MetaphorProgramOptions['intensity'] });
        expect(odd).toEqual(compileMetaphorProgram(SONG, OPTIONS));
    });

    it('没有歌词（纯音乐）：整首是一段一段的间奏，曲名在第一段上，最后一个不结束、镜头循环', () => {
        const { cues } = compileMetaphorProgram([], OPTIONS);
        expect(cues.length).toBeGreaterThan(10);
        expect(cues.every(cue => cue.lineIndex === -1)).toBe(true);
        expect(cues[0]).toMatchObject({ start: 0, text: 'Title', loop: 0 });
        expect(cues.slice(1).every(cue => cue.text === '')).toBe(true);
        // 首尾相接，每段二十来秒
        cues.slice(1).forEach((cue, index) => expect(cue.start).toBe(cues[index].end));
        cues.slice(0, -1).forEach((cue) => {
            expect(cue.end - cue.start).toBeGreaterThan(15);
            expect(cue.end - cue.start).toBeLessThan(33);
            expect(cue.loop).toBe(0);
        });
        expect(cues.at(-1)!.end).toBe(Number.POSITIVE_INFINITY);
        expect(cues.at(-1)!.loop).toBeGreaterThan(0);
        // 空行不算歌词；只有标点的句子（间奏的占位）也不算
        expect(compileMetaphorProgram([timedLine(3, [['  ', 1]])], OPTIONS).cues.every(cue => cue.lineIndex === -1)).toBe(true);
        expect(compileMetaphorProgram([timedLine(3, [['......', 1]])], OPTIONS).cues.every(cue => cue.lineIndex === -1)).toBe(true);
    });

    it('歌里长的间奏也切开，短的不切', () => {
        const { cues } = compileMetaphorProgram([timedLine(4, [['one', 1]]), timedLine(70, [['two', 1]]), timedLine(80, [['three', 1]])], OPTIONS);
        const first = cues.findIndex(cue => cue.lineIndex === 0);
        const second = cues.findIndex(cue => cue.lineIndex === 1);
        const third = cues.findIndex(cue => cue.lineIndex === 2);
        expect(second - first - 1).toBeGreaterThanOrEqual(2);
        expect(third - second - 1).toBeLessThanOrEqual(1);
    });
});

describe('按时间找 cue 和镜头', () => {
    const program = compileMetaphorProgram(SONG, OPTIONS);

    it('findMetaphorCue：落在哪个 cue 上；边界算后一个', () => {
        program.cues.forEach((cue, index) => {
            expect(findMetaphorCue(program, cue.start)).toBe(index);
            expect(findMetaphorCue(program, cue.start + 0.01)).toBe(index);
        });
        expect(findMetaphorCue(program, -5)).toBe(0);
        expect(findMetaphorCue(program, 1e6)).toBe(program.cues.length - 1);
    });

    it('findMetaphorShot：落在哪个镜头上', () => {
        for (const cue of program.cues) {
            for (const shot of cue.shots) {
                expect(findMetaphorShot(cue, shot.start)).toBe(shot);
                expect(findMetaphorShot(cue, (shot.start + shot.end) / 2)).toBe(shot);
            }
            expect(findMetaphorShot(cue, cue.start - 1)).toBe(cue.shots[0]);
        }
    });

    it('resolveMetaphorCueTime：循环的 cue 折回循环长度里', () => {
        const last = program.cues[program.cues.length - 1];
        expect(resolveMetaphorCueTime(last, last.start + 5)).toBeCloseTo(last.start + 5);
        expect(resolveMetaphorCueTime(last, last.start + last.loop * 3 + 5)).toBeCloseTo(last.start + 5);
        const first = program.cues[1];
        expect(resolveMetaphorCueTime(first, 123)).toBe(123);
    });
});
