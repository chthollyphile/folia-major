import { describe, expect, it } from 'vitest';
import { compilePonderScene } from '@/utils/ponder/compilePonderTimeline';
import { PONDER_DEFAULT_DWELL_MS, type PonderSceneScript, type PonderStep } from '@/types/ponder';

// test/unit/ponder/compilePonderTimeline.test.ts
// 编译的全部价值在两件事上：withPrevious 不推进游标（字幕才能配着动作跑），
// 以及 pausePoint 既占时长又自动成为关键帧。其余都是加法。

const scene = (steps: PonderStep[]): PonderSceneScript => ({
    id: 'test-scene',
    titleKey: 'ponder.scenes.test',
    anchors: {},
    steps,
});

const at = (plan: ReturnType<typeof compilePonderScene>, id: string) =>
    plan.entries.find(entry => entry.step.id === id)?.atMs;

describe('compilePonderScene', () => {
    it('顺序步骤首尾相接', () => {
        const plan = compilePonderScene(scene([
            { kind: 'cursor', id: 'a', to: { anchor: 'x' }, durationMs: 200 },
            { kind: 'cursor', id: 'b', to: { anchor: 'x' }, durationMs: 300 },
        ]));

        expect(at(plan, 'a')).toBe(0);
        expect(at(plan, 'b')).toBe(200);
        expect(plan.totalMs).toBe(500);
    });

    it('withPrevious 与上一个顺序步同时开始，且不把后续步骤往后挤', () => {
        const plan = compilePonderScene(scene([
            { kind: 'cursor', id: 'a', to: { anchor: 'x' }, durationMs: 200 },
            { kind: 'caption', id: 'cap', textKey: 'k', durationMs: 900, withPrevious: true },
            { kind: 'cursor', id: 'b', to: { anchor: 'x' }, durationMs: 100 },
        ]));

        expect(at(plan, 'cap')).toBe(0);
        expect(at(plan, 'b')).toBe(200);
    });

    it('并行步骤比动作长时仍计入总时长，不被截断', () => {
        const plan = compilePonderScene(scene([
            { kind: 'cursor', id: 'a', to: { anchor: 'x' }, durationMs: 200 },
            { kind: 'caption', id: 'cap', textKey: 'k', durationMs: 900, withPrevious: true },
        ]));

        expect(plan.totalMs).toBe(900);
    });

    it('withPrevious 出现在第一步时退化为从 0 开始', () => {
        const plan = compilePonderScene(scene([
            { kind: 'caption', id: 'cap', textKey: 'k', durationMs: 400, withPrevious: true },
        ]));

        expect(at(plan, 'cap')).toBe(0);
        expect(plan.totalMs).toBe(400);
    });

    it('pause 占用默认停留时长并计入总时长', () => {
        const plan = compilePonderScene(scene([
            { kind: 'cursor', id: 'a', to: { anchor: 'x' }, durationMs: 200 },
            { kind: 'pause', id: 'hold' },
        ]));

        expect(plan.totalMs).toBe(200 + PONDER_DEFAULT_DWELL_MS);
    });

    it('pause 自动成为关键帧，显式 keyframe 也是，其余都不是', () => {
        const plan = compilePonderScene(scene([
            { kind: 'cursor', id: 'a', to: { anchor: 'x' }, durationMs: 200 },
            { kind: 'pause', id: 'hold', dwellMs: 100 },
            { kind: 'cursor', id: 'b', to: { anchor: 'x' }, durationMs: 200, keyframe: true },
            { kind: 'cursor', id: 'c', to: { anchor: 'x' }, durationMs: 200 },
        ]));

        expect(plan.keyframes.map(k => k.stepId)).toEqual(['hold', 'b']);
    });

    it('同一时刻的多个关键帧只留一根刻度', () => {
        const plan = compilePonderScene(scene([
            { kind: 'cursor', id: 'a', to: { anchor: 'x' }, durationMs: 200, keyframe: true },
            { kind: 'caption', id: 'cap', textKey: 'k', durationMs: 200, withPrevious: true, keyframe: true },
        ]));

        expect(plan.keyframes).toHaveLength(1);
    });

    it('空场景不炸', () => {
        const plan = compilePonderScene(scene([]));
        expect(plan).toEqual({ totalMs: 0, entries: [], keyframes: [] });
    });

    it('surfaceState 像其他动画步骤一样占用时间线', () => {
        const plan = compilePonderScene(scene([
            { kind: 'surfaceState', id: 'open', anchor: 'page', state: 'open', durationMs: 360 },
            { kind: 'pause', id: 'result', dwellMs: 140 },
        ]));

        expect(at(plan, 'open')).toBe(0);
        expect(at(plan, 'result')).toBe(360);
        expect(plan.totalMs).toBe(500);
    });
});
