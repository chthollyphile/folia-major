import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import { hasProfile, LUMIERE_PROFILES, profileOf } from '@/components/visualizer/lumiere/catalog';
import type { ParagraphKind, StructureLine } from '@/components/visualizer/lumiere/lumiereKernel';
import {
    compileLumiereProgram,
    findLumiereParagraphIndexAtTime,
    REOPEN_GAP,
} from '@/components/visualizer/lumiere/lumiereProgram';
import { classifyParagraph, draftParagraphs, resolveParagraphGapThreshold, buildStructureLines } from '@/components/visualizer/paragraphStructure';
import {
    chooseLumiereTransition,
    LUMIERE_TRANSITIONS,
    resolveLumiereEnterDuration,
} from '@/components/visualizer/lumiere/lumiereTransitions';
import { buildLumiereSceneShots } from '@/components/visualizer/lumiere/lumiereUnit';
import { castShot, DEFAULT_LUMIERE_PARAMS, LUMIERE_TRANSITION_KINDS, planShots } from '@/components/visualizer/lumiere/program';
import { syntheticSong } from './lumiereFixtures';

// test/unit/visualizer/lumiere/lumiereProgram.test.ts
// 绘光的编译：切块、选光位（移植自 lumisynth test/unit/packs/lumiereProgram.test.ts），以及 folia 侧的整首编译
// compileLumiereProgram：确定性、段落按序覆盖所有行并首尾相接、间奏与纯音乐、转场与开场。
const fakeLine = (index: number, start: number, end: number): StructureLine => ({
    sourceIndex: index,
    line: { fullText: 'x', startTime: start, endTime: end, words: [] },
    renderEndTime: end,
});

describe('绘光的切块', () => {
    it('短行两两合一个镜头，长行单独；镜头首尾相接，覆盖整段', () => {
        const shots = planShots([
            fakeLine(0, 0, 2), fakeLine(1, 2, 4), fakeLine(2, 4, 9), fakeLine(3, 9, 11), fakeLine(4, 11, 13),
        ], 0, 14, DEFAULT_LUMIERE_PARAMS);
        expect(shots.map(shot => shot.lines.map(line => line.sourceIndex))).toEqual([[0, 1], [2], [3, 4]]);
        expect(shots[0]!.startTime).toBe(0);
        shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime));
        expect(shots.at(-1)!.endTime).toBe(14);
    });

    it('行后的空隙超过阈值时出间奏镜头', () => {
        const shots = planShots([fakeLine(0, 0, 3), fakeLine(1, 10, 13)], 0, 13, DEFAULT_LUMIERE_PARAMS);
        expect(shots.map(shot => shot.isBridge)).toEqual([false, true, false]);
        expect(shots[0]!.endTime).toBeCloseTo(3.6);
        expect(shots[1]).toMatchObject({ startTime: 3.6, endTime: 10, lines: [] });
    });
});

describe('绘光的选光位', () => {
    const pick = (kind: ParagraphKind = 'verse', shotIndex = 0, isBridge = false, energy: number | null = null) => castShot({
        seed: 's', paragraphIndex: 0, shotIndex, kind, isBridge, chain: { recent: [], family: null }, energy,
    });

    it('低能量不选喧哗的、副歌偏喧哗与中性、尾声只选安静的', () => {
        for (let i = 0; i < 40; i += 1) {
            expect(profileOf(pick('verse', i, false, 0.1)).mood).not.toBe('loud');
            expect(profileOf(pick('chorus', i)).mood).not.toBe('quiet');
            expect(profileOf(pick('outro', i)).mood).toBe('quiet');
        }
    });

    it('间奏只从萤尘、星象、天光里选安静或中性的；最近用过的不马上再用', () => {
        for (let i = 0; i < 20; i += 1) {
            const profile = profileOf(pick('verse', i, true));
            expect(profile.mood).not.toBe('loud');
            expect(['motes', 'astral', 'zenith']).toContain(profile.family);
        }
        const recent = LUMIERE_PROFILES.filter(profile => profile.mood !== 'loud').slice(0, 3).map(profile => profile.kind);
        const kind = castShot({
            seed: 's', paragraphIndex: 0, shotIndex: 1, kind: 'verse', isBridge: false, chain: { recent, family: null },
        });
        expect(recent).not.toContain(kind);
    });

    it('按种子确定', () => {
        expect(pick('lift', 3)).toBe(pick('lift', 3));
    });
});

describe('绘光的分段', () => {
    it('空隙超过阈值与歌词元数据变化处切段，副歌标记优先分类', () => {
        const line = (start: number, part: string): Line => ({ fullText: '光落在晨雾里', startTime: start, endTime: start + 2, words: [], songPart: part });
        const lines = [line(0, 'Verse'), line(2.2, 'Verse'), line(12, 'Verse'), line(14.2, 'Chorus'), line(16.4, 'Chorus')];
        const structure = buildStructureLines(lines);
        const drafts = draftParagraphs(structure, resolveParagraphGapThreshold(lines));
        expect(drafts.map(draft => draft.lines.map(item => item.sourceIndex))).toEqual([[0, 1], [2], [3, 4]]);
        expect(drafts.map(draft => draft.boundary)).toEqual(['song-start', 'time-gap', 'metadata']);
        expect(classifyParagraph(drafts[2]!.lines, 2, 3)).toBe('chorus');
    });
});

describe('compileLumiereProgram', () => {
    const lines = syntheticSong(7);
    const program = compileLumiereProgram(lines, 'lumiere');

    it('同样的歌词与种子得到逐字段相同的程序；换种子光位不同', () => {
        expect(compileLumiereProgram(lines, 'lumiere')).toEqual(program);
        expect(compileLumiereProgram(syntheticSong(7), 'lumiere')).toEqual(program);
        const other = compileLumiereProgram(lines, 'other');
        const kinds = (value: typeof program) => value.paragraphs.flatMap(paragraph => paragraph.shots.map(shot => shot.kind));
        expect(kinds(other)).not.toEqual(kinds(program));
        // 数字种子与它的字符串形式相同。
        expect(compileLumiereProgram(lines, 42)).toEqual(compileLumiereProgram(lines, '42'));
    });

    it('段落按顺序覆盖每一行恰好一次，段落与镜头都首尾相接、从 0 铺到最后', () => {
        const covered = program.paragraphs.flatMap(paragraph => paragraph.lineIndices);
        expect(covered).toEqual(lines.map((_, index) => index));
        expect(program.paragraphs[0]!.startTime).toBe(0);
        program.paragraphs.forEach((paragraph, index) => {
            expect(paragraph.index).toBe(index);
            expect(paragraph.id).toBe(`lumiere-p${index}`);
            expect(paragraph.lines).toEqual(paragraph.lineIndices.map(lineIndex => lines[lineIndex]));
            const next = program.paragraphs[index + 1];
            if (next) expect(next.startTime).toBeCloseTo(paragraph.endTime, 9);
            const { shots } = paragraph;
            expect(shots.length).toBeGreaterThan(0);
            expect(shots[0]!.startTime).toBeCloseTo(paragraph.startTime, 9);
            expect(shots.at(-1)!.endTime).toBeGreaterThanOrEqual(paragraph.endTime - 1e-9);
            shots.slice(1).forEach((shot, shotIndex) => expect(shot.startTime).toBeCloseTo(shots[shotIndex]!.endTime, 6));
            shots.forEach(shot => expect(shot.lineIndices.length).toBeLessThanOrEqual(DEFAULT_LUMIERE_PARAMS.maxLinesPerShot));
            // 每一行都落在某个镜头里。
            const inShots = new Set(shots.flatMap(shot => shot.lineIndices));
            paragraph.lineIndices.forEach(lineIndex => expect(inShots.has(lineIndex)).toBe(true));
        });
        expect(program.duration).toBeCloseTo(program.paragraphs.at(-1)!.endTime, 9);
        // 最后一行的视觉结束时间（可能带尾迹，长于 endTime）。
        expect(program.lyricEndTime).toBeCloseTo(getLineRenderEndTime(lines.at(-1)!), 6);
        expect(program.instrumental).toBe(false);
    });

    it('每个镜头的光位都是合法的 profile，间奏镜头不选喧哗的', () => {
        const shots = program.paragraphs.flatMap(paragraph => paragraph.shots);
        shots.forEach(shot => expect(hasProfile(shot.kind), shot.kind).toBe(true));
        shots.filter(shot => shot.isBridge).forEach(shot => expect(profileOf(shot.kind).mood).not.toBe('loud'));
        // 相邻镜头不重复同一个光位。
        shots.slice(1).forEach((shot, index) => expect(shot.kind).not.toBe(shots[index]!.kind));
    });

    it('转场：除最后一段外都有，结束在下一段开始、不相邻重复；开场只在第一段或与上一段隔开时', () => {
        program.paragraphs.forEach((paragraph, index) => {
            const next = program.paragraphs[index + 1];
            if (!next) {
                expect(paragraph.transitionOut).toBeNull();
                return;
            }
            const transition = paragraph.transitionOut!;
            expect(LUMIERE_TRANSITION_KINDS).toContain(transition.kind);
            expect(transition.endTime).toBeCloseTo(next.startTime, 9);
            expect(transition.startTime).toBeGreaterThanOrEqual(paragraph.startTime);
            expect(transition.endTime - transition.startTime).toBeLessThanOrEqual(1.1 + 1e-9);
            const previous = program.paragraphs[index - 1]?.transitionOut;
            if (previous) expect(transition.kind).not.toBe(previous.kind);
        });
        program.paragraphs.forEach((paragraph, index) => {
            const previous = program.paragraphs[index - 1];
            expect(paragraph.opening).toBe(!previous || paragraph.startTime - previous.lyricEndTime >= REOPEN_GAP);
        });
        expect(program.paragraphs[0]!.opening).toBe(true);
    });

    it('前奏够长时单独出一个间奏段，第一句所在的段不再重播开场', () => {
        const shifted = lines.map(line => ({
            ...line,
            startTime: line.startTime + 20,
            endTime: line.endTime + 20,
            words: line.words.map(word => ({ ...word, startTime: word.startTime + 20, endTime: word.endTime + 20 })),
        }));
        const withIntro = compileLumiereProgram(shifted, 'lumiere');
        const intro = withIntro.paragraphs[0]!;
        expect(intro).toMatchObject({ boundary: 'intro', kind: 'break', startTime: 0, lineIndices: [], opening: true });
        expect(intro.endTime).toBeCloseTo(shifted[0]!.startTime, 9);
        expect(intro.shots.every(shot => shot.isBridge)).toBe(true);
        expect(withIntro.paragraphs[1]!.opening).toBe(false);
    });

    it('歌曲比歌词长时最后一段延伸到歌曲结束，尾奏出间奏镜头；长间奏切成几个镜头', () => {
        const end = program.lyricEndTime! + 60;
        const extended = compileLumiereProgram(lines, 'lumiere', {}, { duration: end });
        const last = extended.paragraphs.at(-1)!;
        expect(extended.duration).toBe(end);
        expect(last.endTime).toBe(end);
        const tail = last.shots.filter(shot => shot.isBridge && shot.startTime >= program.lyricEndTime!);
        expect(tail.length).toBeGreaterThan(1);
        tail.forEach(shot => expect(shot.endTime - shot.startTime).toBeLessThanOrEqual(16));
        expect(tail.at(-1)!.endTime).toBe(end);
    });

    it('纯音乐：没有歌词时在给定时长上铺只有间奏镜头的段落', () => {
        const instrumental = compileLumiereProgram([], 'song-1', {}, { duration: 200 });
        expect(instrumental.instrumental).toBe(true);
        expect(instrumental.lyricEndTime).toBeNull();
        expect(instrumental.duration).toBe(200);
        expect(instrumental.paragraphs.length).toBeGreaterThan(1);
        expect(instrumental.paragraphs[0]!.startTime).toBe(0);
        expect(instrumental.paragraphs.at(-1)!.endTime).toBe(200);
        instrumental.paragraphs.forEach((paragraph, index) => {
            expect(paragraph.lines).toEqual([]);
            expect(paragraph.opening).toBe(index === 0);
            paragraph.shots.forEach(shot => {
                expect(shot.isBridge).toBe(true);
                expect(['motes', 'astral', 'zenith']).toContain(profileOf(shot.kind).family);
            });
        });
        expect(compileLumiereProgram([], 'song-1', {}, { duration: 200 })).toEqual(instrumental);
        // 不给时长时用缺省的 480 秒。
        expect(compileLumiereProgram([], undefined).duration).toBe(480);
    });

    it('按时间找段落：第一段之前算第一段', () => {
        expect(findLumiereParagraphIndexAtTime(program, -5)).toBe(0);
        program.paragraphs.forEach((paragraph, index) => {
            expect(findLumiereParagraphIndexAtTime(program, paragraph.startTime + 0.01)).toBe(index);
        });
        expect(findLumiereParagraphIndexAtTime(program, 1e6)).toBe(program.paragraphs.length - 1);
    });

    it('场景镜头：行号换成段内下标', () => {
        const paragraph = program.paragraphs.find(item => item.lineIndices.length > 2)!;
        const shots = buildLumiereSceneShots(paragraph);
        expect(shots).toHaveLength(paragraph.shots.length);
        shots.forEach((shot, index) => {
            expect(shot.profile.kind).toBe(paragraph.shots[index]!.kind);
            expect(shot.lines.map(local => paragraph.lineIndices[local])).toEqual(paragraph.shots[index]!.lineIndices);
        });
    });
});

describe('绘光的转场', () => {
    it('熄灯在边界处全黑，进场后恢复；拉焦只模糊不透明', () => {
        const lightsOut = LUMIERE_TRANSITIONS['lights-out'];
        expect(lightsOut.resolveFrame('exit', 0).alpha).toBe(1);
        expect(lightsOut.resolveFrame('exit', 1).alpha).toBe(0);
        expect(lightsOut.resolveFrame('enter', 1).alpha).toBe(1);
        const focus = LUMIERE_TRANSITIONS['focus-pull'];
        expect(focus.resolveFrame('exit', 1)).toMatchObject({ alpha: 1, blur: 12 });
        expect(focus.resolveFrame('enter', 1)).toMatchObject({ alpha: 1, blur: 0, scale: 1 });
        expect(LUMIERE_TRANSITIONS['flare-cut'].resolveFrame('exit', 1).scale).toBeCloseTo(1.03);
    });

    it('时长随空隙变化并有上下限；进场时长钳在 enterClamp', () => {
        expect(LUMIERE_TRANSITIONS['lights-out'].duration(0)).toBe(0.8);
        expect(LUMIERE_TRANSITIONS['lights-out'].duration(10)).toBe(1.1);
        expect(LUMIERE_TRANSITIONS['focus-pull'].duration(0.1)).toBe(0.35);
        expect(resolveLumiereEnterDuration('focus-pull', 0, 10)).toBe(0.6);
        expect(resolveLumiereEnterDuration('lights-out', 0, 0.1)).toBe(0.4);
    });

    it('选转场不与上一次相同，按种子确定', () => {
        for (let i = 0; i < 20; i += 1) {
            const previous = LUMIERE_TRANSITION_KINDS[i % 3]!;
            const kind = chooseLumiereTransition('s', i, previous);
            expect(kind).not.toBe(previous);
            expect(chooseLumiereTransition('s', i, previous)).toBe(kind);
        }
    });
});
