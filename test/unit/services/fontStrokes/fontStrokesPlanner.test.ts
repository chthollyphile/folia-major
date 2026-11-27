import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FontStrokesDemand } from '../../../../src/services/fontStrokes/fontStrokesDemand';
import { FontStrokesMemory } from '../../../../src/services/fontStrokes/fontStrokesMemory';
import type { FontStrokesGlyph } from '../../../../src/services/fontStrokes/fontStrokesOutline';
import { FontStrokesPlanner, PLANNER_BACKOFF_MS, type PlannerDeps } from '../../../../src/services/fontStrokes/fontStrokesPlanner';

// test/unit/services/fontStrokes/fontStrokesPlanner.test.ts
// 预备服务：没有使用方不做任何事、先查盘再推理、需求顺序和紧迫度、临时失败的退避、永久不可用就停、抛异常后字能再选、取消登记后不再响应需求变化。

const glyph = (n: number): FontStrokesGlyph => ({ pens: [new Int16Array([n, n])], outlines: [[]], brush: new Uint8Array([n])});

interface Harness {
    planner: FontStrokesPlanner<string, string>;
    memory: FontStrokesMemory;
    deps: PlannerDeps<string, string>;
    inferCalls: { chars: string[]; urgency: string }[];
    storeReads: string[][];
    storePuts: string[][];
    setDemand(d: Partial<FontStrokesDemand>): void;
    fireDemand(): void;
    infer: Mock<PlannerDeps<string, string>['infer']>;
    stored: Map<string, FontStrokesGlyph>;
    unavailable: { value: boolean };
}

const make = (batch = 2): Harness => {
    let demand: FontStrokesDemand = { near: [], rest: [], background: [] };
    const memory = new FontStrokesMemory();
    const listeners = new Set<() => void>();
    const inferCalls: Harness['inferCalls'] = [];
    const storeReads: string[][] = [];
    const storePuts: string[][] = [];
    const stored = new Map<string, FontStrokesGlyph>();
    const unavailable = { value: false };
    const infer = vi.fn(async (features: Float32Array<ArrayBuffer>[], urgency: 'onScreen' | 'background') => {
        inferCalls.push({ chars: features.map(f => String.fromCharCode(f[0])), urgency });
        return features.map(f => String.fromCharCode(f[0]));
    });
    const deps: PlannerDeps<string, string> = {
        store: {
            getGlyphs: async (_font, chars) => { storeReads.push(chars); return new Map(chars.filter(c => stored.has(c)).map(c => [c, stored.get(c)!])); },
            putGlyphs: async (_font, _label, glyphs) => { storePuts.push([...glyphs.keys()]); },
        },
        memory,
        readDemand: () => demand,
        subscribeDemand: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        fontStackOf: key => (key === 'bad' ? null : 'F'),
        labelOf: key => key,
        prepareFont: async () => true,
        rasterize: ch => (ch === '空' ? null : { canon: ch, features: new Float32Array([ch.charCodeAt(0)]) as Float32Array<ArrayBuffer> }),
        infer,
        build: (_canon, result) => glyph(result.charCodeAt(0) % 100),
        permanentlyUnavailable: () => unavailable.value,
        isModelChar: ch => ch.length === 1 && ch >= '一' && ch <= '鿿',
        batch,
    };
    return {
        planner: new FontStrokesPlanner(deps), memory, deps, inferCalls, storeReads, storePuts, infer, stored, unavailable,
        setDemand: d => { demand = { near: [], rest: [], background: [], ...d }; },
        fireDemand: () => listeners.forEach(cb => cb()),
    };
};
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('FontStrokesPlanner', () => {
    it('没有使用方时什么都不做：不读需求、不查盘、不推理', async () => {
        const h = make();
        const readDemand = vi.spyOn(h.deps, 'readDemand');
        h.setDemand({ near: ['永'] });
        h.fireDemand();
        await settle();
        expect(readDemand).not.toHaveBeenCalled();
        expect(h.storeReads).toHaveLength(0);
        expect(h.infer).not.toHaveBeenCalled();
    });

    it('先查盘，盘里有的不推理；剩下的 near 在前、onScreen，其余 background，8（这里 2）个一批', async () => {
        const h = make(2);
        h.stored.set('永', glyph(1));
        h.setDemand({ near: ['永', '十', '口'], rest: ['人', '山'], background: ['日'] });
        h.planner.register('k1');
        await settle();
        await settle();
        expect(h.storeReads[0]).toEqual(['永', '十', '口', '人', '山', '日']);
        expect(h.inferCalls.map(c => c.chars.join(''))).toEqual(['十口', '人山', '日']);
        expect(h.inferCalls.map(c => c.urgency)).toEqual(['onScreen', 'background', 'background']);
        expect(h.memory.get('k1', '永')).toEqual(glyph(1));
        expect(h.memory.get('k1', '山')).not.toBeNull();
        // 每个字只查一次盘；算出来的都存了
        expect(h.storeReads).toHaveLength(1);
        expect(h.storePuts.flat().sort()).toEqual(['人', '十', '口', '山', '日'].sort());
    });

    it('一批里有 near 的字就按 onScreen', async () => {
        const h = make(2);
        h.setDemand({ near: ['永'], rest: ['十'] });
        h.planner.register('k1');
        await settle();
        expect(h.inferCalls[0]).toEqual({ chars: ['永', '十'], urgency: 'onScreen' });
    });

    it('画不出墨的字记成空结果，不推理；订阅者收到新结果通知', async () => {
        const h = make(4);
        const seen: string[] = [];
        h.memory.subscribe(k => seen.push(k));
        h.setDemand({ near: ['永', '空'] });
        h.planner.register('k1');
        await settle();
        expect(h.memory.has('k1', '空')).toBe(true);
        expect(h.memory.get('k1', '空')).toBeNull();
        expect(h.inferCalls[0].chars).toEqual(['永']);
        expect(seen.length).toBeGreaterThan(0);
    });

    it('临时失败按 5 s / 30 s / 2 min 退避重试，成功后清零', async () => {
        const h = make(2);
        h.infer.mockImplementation(async () => null);
        h.setDemand({ near: ['永', '十'] });
        h.planner.register('k1');
        await settle();
        expect(h.infer).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(PLANNER_BACKOFF_MS[0] - 1);
        expect(h.infer).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.infer).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(PLANNER_BACKOFF_MS[1] - 1);
        expect(h.infer).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.infer).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(PLANNER_BACKOFF_MS[2]);
        expect(h.infer).toHaveBeenCalledTimes(4);
        // 之后还是最长那一档
        await vi.advanceTimersByTimeAsync(PLANNER_BACKOFF_MS[2]);
        expect(h.infer).toHaveBeenCalledTimes(5);
        // 恢复：成功后字进内存
        h.infer.mockImplementation(async (features: Float32Array<ArrayBuffer>[]) => features.map(f => String.fromCharCode(f[0])));
        await vi.advanceTimersByTimeAsync(PLANNER_BACKOFF_MS[2]);
        expect(h.memory.get('k1', '永')).not.toBeNull();
    });

    it('永久不可用就停，不再重试', async () => {
        const h = make(2);
        h.infer.mockImplementation(async () => null);
        h.unavailable.value = true;
        h.setDemand({ near: ['永'] });
        h.planner.register('k1');
        await settle();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(h.infer).toHaveBeenCalledTimes(1);
        h.fireDemand();
        h.planner.register('k2');
        await settle();
        expect(h.infer).toHaveBeenCalledTimes(1);
    });

    it('推理抛异常后「在算」的字被放掉，退避后能再选到', async () => {
        const h = make(2);
        let first = true;
        h.infer.mockImplementation(async (features: Float32Array<ArrayBuffer>[]) => {
            if (first) { first = false; throw new Error('device lost'); }
            return features.map(f => String.fromCharCode(f[0]));
        });
        h.setDemand({ near: ['永', '十'] });
        h.planner.register('k1');
        await settle();
        expect(h.memory.has('k1', '永')).toBe(false);
        await vi.advanceTimersByTimeAsync(PLANNER_BACKOFF_MS[0]);
        expect(h.memory.has('k1', '永')).toBe(true);
        expect(h.memory.has('k1', '十')).toBe(true);
    });

    it('需求变化（换句）后按新顺序继续；已在内存的字不再算', async () => {
        const h = make(2);
        h.setDemand({ near: ['永', '十'] });
        const dispose = h.planner.register('k1');
        await settle();
        expect(h.inferCalls).toHaveLength(1);
        h.setDemand({ near: ['口', '永'], rest: ['人'] });
        h.fireDemand();
        await settle();
        expect(h.inferCalls.map(c => c.chars.join(''))).toEqual(['永十', '口人']);
        dispose();
    });

    it('取消登记后需求变化不再触发；再登记时从头看', async () => {
        const h = make(2);
        h.setDemand({ near: ['永'] });
        const dispose = h.planner.register('k1');
        await settle();
        dispose();
        h.setDemand({ near: ['口'] });
        h.fireDemand();
        await settle();
        expect(h.inferCalls).toHaveLength(1);
        h.planner.register('k1');
        await settle();
        expect(h.inferCalls).toHaveLength(2);
    });

    it('认不出的字体键：该字体的字都记成空结果，不推理', async () => {
        const h = make(2);
        h.setDemand({ near: ['永'] });
        h.planner.register('bad');
        await settle();
        expect(h.infer).not.toHaveBeenCalled();
        expect(h.memory.has('bad', '永')).toBe(true);
    });

    it('reset 后重新查盘', async () => {
        const h = make(2);
        h.setDemand({ near: ['永'] });
        h.planner.register('k1');
        await settle();
        expect(h.storeReads).toHaveLength(1);
        h.memory.clearAll();
        h.planner.reset();
        await settle();
        expect(h.storeReads).toHaveLength(2);
    });
});
