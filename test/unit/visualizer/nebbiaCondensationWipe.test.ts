import { describe, expect, it } from 'vitest';
import { NebbiaCondensation } from '@/components/visualizer/nebbia/nebbiaCondensation';

// test/unit/visualizer/nebbiaCondensationWipe.test.ts
// 凝露和歌词的水联动：线段扫过的小水珠被擦掉（实例宽高写成 0），够不着的照样挂着；擦掉的过几秒在原地重新凝出来。

type Internals = { list: { x: number; y: number; r: number; born: number }[] };

const settled = () => {
    const dew = new NebbiaCondensation();
    dew.build(400, 300);
    // 让所有水珠长足：凝出最多 FIRST_FILL + GROW 秒
    for (let t = 0; t < 20; t += 0.05) dew.instances(0.05);
    return dew;
};
const width = (inst: Float32Array, i: number) => inst[i * 6 + 2];
const visibleNear = (dew: NebbiaCondensation, inst: Float32Array, y: number, within: number) =>
    (dew as unknown as Internals).list.slice(0, inst.length / 6).filter((d, i) => Math.abs(d.y - y) < within && width(inst, i) > 0).length;

describe('nebbia dew condensation and lyric water', () => {
    it('wipes the droplets a lyric stroke passes over and leaves the rest', () => {
        const dew = settled();
        const before = dew.instances(0.05);
        expect(visibleNear(dew, before, 150, 4)).toBeGreaterThan(0);
        const farBefore = visibleNear(dew, before, 60, 4);
        dew.wipe([0, 150, 400, 150, 12], 2);
        const after = dew.instances(0.05);
        expect(dew.changed).toBe(true);
        expect(visibleNear(dew, after, 150, 4)).toBe(0);
        expect(visibleNear(dew, after, 60, 4)).toBe(farBefore);
    });

    it('grows wiped droplets back in place a few seconds later', () => {
        const dew = settled();
        dew.wipe([0, 150, 400, 150, 12], 2);
        let inst = dew.instances(0.05);
        for (let t = 0; t < 15; t += 0.05) inst = dew.instances(0.05);
        expect(visibleNear(dew, inst, 150, 4)).toBeGreaterThan(0);
    });

    it('keeps soaking up droplets beside written strokes after the glass is rebuilt for a new size', () => {
        const dew = settled();
        dew.touchInk([], [0, 150, 400, 150, 12], 1);
        dew.build(400, 300);
        let inst = dew.instances(0.05);
        for (let t = 0; t < 20; t += 0.05) inst = dew.instances(0.05);
        expect(visibleNear(dew, inst, 150, 4)).toBeGreaterThan(0);
        dew.touchInk([], [0, 150, 400, 150, 12], 1);
        inst = dew.instances(0.05);
        expect(visibleNear(dew, inst, 150, 4)).toBe(0);
    });
});
