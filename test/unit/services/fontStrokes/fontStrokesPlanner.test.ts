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
    /** 每次光栅化的 (字, 字重)。 */
    rasterCalls: [string, number][];
    /** 每次推理前等的字体（族, 字重）。 */
    fontCalls: [string, number][];
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
    const rasterCalls: Harness['rasterCalls'] = [];
    const fontCalls: Harness['fontCalls'] = [];
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
            // 盘按字存（k1 之外的键加前缀，免得两个键互相命中）
            getGlyphs: async (font, chars) => {
                storeReads.push(chars);
                const id = (c: string) => (font === 'k1' ? c : `${font}:${c}`);
                return new Map(chars.filter(c => stored.has(id(c))).map(c => [c, stored.get(id(c))!]));
            },
            putGlyphs: async (font, _label, glyphs) => { storePuts.push([...glyphs.keys()]); glyphs.forEach((g, ch) => stored.set(font === 'k1' ? ch : `${font}:${ch}`, g)); },
        },
        memory,
        readDemand: () => demand,
        subscribeDemand: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        fontStackOf: key => (key === 'bad' ? null : 'F'),
        // 键名里带 @ 的按后面的数当字重（'k2@780'），其余 400
        fontWeightOf: key => (key === 'noweight' ? null : key.includes('@') ? Number(key.split('@')[1]) : 400),
        labelOf: key => key,
        prepareFont: async (family, weight) => { fontCalls.push([family, weight]); return true; },
        rasterize: (ch, _family, weight) => {
            rasterCalls.push([ch, weight]);
            return ch === '空' ? null : { canon: ch, features: new Float32Array([ch.charCodeAt(0)]) as Float32Array<ArrayBuffer> };
        },
        infer,
        build: (_canon, result) => glyph(result.charCodeAt(0) % 100),
        permanentlyUnavailable: () => unavailable.value,
        isModelChar: ch => ch.length === 1 && ch >= '一' && ch <= '鿿',
        batch,
    };
    return {
        planner: new FontStrokesPlanner(deps), memory, deps, inferCalls, rasterCalls, fontCalls, storeReads, storePuts, infer, stored, unavailable,
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

    it('按字体键里的字重等字体、光栅化；认不出字重的键全部当没有', async () => {
        const h = make(8);
        h.setDemand({ near: ['永'] });
        h.planner.register('k2@780');
        h.planner.register('noweight');
        await settle();
        await settle();
        expect(h.fontCalls).toEqual([['F', 780]]);
        expect(h.rasterCalls).toEqual([['永', 780]]);
        expect(h.memory.get('k2@780', '永')).not.toBeNull();
        expect(h.memory.has('noweight', '永')).toBe(true);
        expect(h.memory.get('noweight', '永')).toBeNull();
    });

    it('几个键一起缺字时先推最急的一档：后一个键马上要画的字不被前一个键的后台字压住', async () => {
        const h = make(2);
        // 浮名的两个字重：k1 先登记，它自己显示的字（extras）和下一首（background）一大堆；k2 也缺马上要画的字
        h.setDemand({ near: ['永'], background: ['甲', '乙', '丙', '丁'] });
        h.planner.register('k1', '山');
        h.planner.register('k2@780');
        await settle();
        await settle();
        await settle();
        const order = h.inferCalls.map(c => c.chars.join(''));
        // 第一批：k1 的 near（永山）；第二批：k2 的 near（永 + 下一首的甲），之后才轮到 k1 的后台字
        expect(order[0]).toBe('永山');
        expect(order[1]).toBe('永甲');
        expect(h.inferCalls[1].urgency).toBe('onScreen');
        expect(order.slice(2).join('')).toContain('甲乙丙丁');
    });

    it('使用方自己的文本排在播放的 near 后面、rest 前面，只给它那个字体键', async () => {
        const h = make(8);
        h.setDemand({ near: ['永'], rest: ['十'] });
        h.planner.register('k1', '山永日');
        await settle();
        await settle();
        expect(h.storeReads[0]).toEqual(['永', '山', '日', '十']);
        expect(h.inferCalls[0].chars.join('')).toBe('永山日十');
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

    it('永久不可用或退避期间，盘上已有的字照常读进内存', async () => {
        const h = make(2);
        h.infer.mockImplementation(async () => null);
        h.unavailable.value = true;
        h.setDemand({ near: ['永'] });
        h.planner.register('k1');
        await settle();
        h.stored.set('口', glyph(7));
        h.setDemand({ near: ['口'] });
        h.fireDemand();
        await settle();
        expect(h.memory.get('k1', '口')).toEqual(glyph(7));
        expect(h.infer).toHaveBeenCalledTimes(1);
    });

    it('算出来存了盘的字被内存挤掉后从盘上读回来，不再推理', async () => {
        const h = make(2);
        h.setDemand({ near: ['永', '十'] });
        h.planner.register('k1');
        await settle();
        expect(h.infer).toHaveBeenCalledTimes(1);
        h.memory.clearFont('k1');
        h.fireDemand();
        await settle();
        expect(h.infer).toHaveBeenCalledTimes(1);
        expect(h.memory.has('k1', '永')).toBe(true);
        expect(h.storeReads).toHaveLength(2);
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
