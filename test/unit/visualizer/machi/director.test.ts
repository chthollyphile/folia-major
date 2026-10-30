import { describe, expect, it } from 'vitest';
import {
    MachiAudioFollower,
    resolveMachiBoardTarget,
    resolveMachiChorus,
    resolveMachiFlicker,
    sameBoardTarget,
} from '@/components/visualizer/machi/engine/director';
import { buildKonbiniDoorEvents, resolveKonbiniDoorOpenness } from '@/components/visualizer/machi/scenes/konbini/konbiniDoor';
import { resolveKonbiniVariation } from '@/components/visualizer/machi/scenes/konbini/konbiniSeed';
import type { Line } from '@/types';

// test/unit/visualizer/machi/director.test.ts
// 町景的编排（便利店的自动门在 konbiniDoor）：牌面在唱的行与曲名卡之间怎么切、段落开头开门、副歌、闪烁日程与音频包络都是确定的。

const line = (start: number, end: number, text = 'la la', extra: Partial<Line> = {}): Line => ({
    words: [{ text, startTime: start, endTime: end }],
    startTime: start,
    endTime: end,
    fullText: text,
    ...extra,
});

/** 两段：0–9 秒三行，空 12 秒，21–30 秒三行（第二段是副歌）。 */
const SONG: Line[] = [
    line(5, 7), line(7, 9), line(9, 11),
    line(23, 25, 'chorus', { isChorus: true }), line(25, 27, 'chorus', { isChorus: true }), line(27, 29, 'chorus', { isChorus: true }),
];

describe('resolveMachiBoardTarget', () => {
    it('shows the title card before the first line and in a long gap', () => {
        expect(resolveMachiBoardTarget(SONG, 1)).toEqual({ kind: 'card' });
        expect(resolveMachiBoardTarget(SONG, 17)).toEqual({ kind: 'card' });
    });

    it('shows the line being sung, slightly ahead of its start', () => {
        expect(resolveMachiBoardTarget(SONG, 7.5)).toEqual({ kind: 'line', index: 1 });
        expect(resolveMachiBoardTarget(SONG, 22.95)).toEqual({ kind: 'line', index: 3 });
    });

    it('holds the last line a moment after it ends', () => {
        expect(resolveMachiBoardTarget(SONG, 12)).toEqual({ kind: 'line', index: 2 });
    });

    it('treats an empty song as a card', () => {
        expect(resolveMachiBoardTarget([], 10)).toEqual({ kind: 'card' });
    });

    it('compares targets by kind and line', () => {
        expect(sameBoardTarget({ kind: 'line', index: 2 }, { kind: 'line', index: 2 })).toBe(true);
        expect(sameBoardTarget({ kind: 'line', index: 2 }, { kind: 'line', index: 3 })).toBe(false);
        expect(sameBoardTarget(null, { kind: 'card' })).toBe(false);
    });
});

describe('door and chorus', () => {
    const variation = resolveKonbiniVariation('door-test');

    it('opens the door just before a new paragraph and closes it again', () => {
        const events = buildKonbiniDoorEvents(SONG, variation);
        expect(events.some(time => time > 21 && time < 23)).toBe(true);
        const open = events.find(time => time > 21 && time < 23)!;
        expect(resolveKonbiniDoorOpenness(events, open + 1.5, variation, false)).toBe(1);
        expect(resolveKonbiniDoorOpenness(events, open + 10, variation, false)).toBe(0);
        expect(resolveKonbiniDoorOpenness(events, open - 0.01, variation, false)).toBeLessThan(1);
    });

    it('keeps the door schedule the same for the same song', () => {
        expect(buildKonbiniDoorEvents(SONG, variation)).toEqual(buildKonbiniDoorEvents(SONG, resolveKonbiniVariation('door-test')));
    });

    it('opens the door periodically for an instrumental', () => {
        const samples = Array.from({ length: 400 }, (_, index) => resolveKonbiniDoorOpenness([], index * 0.25, variation, true));
        expect(Math.max(...samples)).toBe(1);
        expect(Math.min(...samples)).toBe(0);
    });

    it('weights the chorus by the line on the board', () => {
        expect(resolveMachiChorus(SONG, { kind: 'line', index: 4 })).toBe(1);
        expect(resolveMachiChorus(SONG, { kind: 'line', index: 0 })).toBe(0);
        expect(resolveMachiChorus(SONG, { kind: 'card' })).toBe(0);
    });
});

describe('flicker and audio', () => {
    it('flickers deterministically and mostly stays lit', () => {
        const samples = Array.from({ length: 2000 }, (_, index) => resolveMachiFlicker(index * 0.05, 'seed'));
        expect(samples).toEqual(Array.from({ length: 2000 }, (_, index) => resolveMachiFlicker(index * 0.05, 'seed')));
        const lit = samples.filter(value => value === 1).length / samples.length;
        expect(lit).toBeGreaterThan(0.9);
        expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.5);
    });

    it('normalises byte-scaled audio and smooths it', () => {
        const follower = new MachiAudioFollower();
        for (let index = 0; index < 60; index += 1) follower.step(255, 1 / 60);
        expect(follower.value).toBeGreaterThan(0.95);
        follower.step(0, 1 / 60);
        expect(follower.value).toBeGreaterThan(0.8);
        const preview = new MachiAudioFollower();
        for (let index = 0; index < 60; index += 1) preview.step(0.4, 1 / 60);
        expect(preview.value).toBeCloseTo(0.4, 2);
    });
});

describe('resolveKonbiniVariation', () => {
    it('is the same for the same seed and varies between songs', () => {
        expect(resolveKonbiniVariation('a')).toEqual(resolveKonbiniVariation('a'));
        const variations = ['a', 'b', 'c', 'd', 'e', 'f'].map(seed => JSON.stringify(resolveKonbiniVariation(seed)));
        expect(new Set(variations).size).toBe(variations.length);
    });
});
