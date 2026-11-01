import { describe, expect, it } from 'vitest';
import { DRUM_HAT, DRUM_KICK, DRUM_SNARE, type DrumHits } from '@/services/analysis/drumHits';
import type { BeatFxEvent } from '@/services/beatFx/clock';
import {
    createMachiBeatFrame,
    MACHI_BEAT,
    machiDrumHitsAt,
    machiLightboxGroup,
    machiNeonGroup,
    machiRippleWetness,
    machiSwell,
    resolveMachiDrumRipples,
    resolveMachiNeonPulse,
    resolveMachiScreenFlash,
} from '@/components/visualizer/machi/engine/beatFx';

// test/unit/visualizer/machi/beatFx.test.ts
// 町景的智能动感效果：没有拍点 / 鼓点、强度为 0 时是常态值；霓虹随拍三组按拍在表里的序号轮流、慢慢亮起再暗下，
// 一组亮时别的组暗一点（平均不变），只有小节第一拍让店里的灯慢慢涨落，没有节奏的小节不亮，按拍的三段占比分给霓虹与暖色灯；
// 鼓点涟漪只认够响的底鼓、相隔够远（留早的那下）、最多四圈、最新的在前；大屏闪拍每下够响的军鼓慢慢亮起再暗下、
// 先后几下落在不同的位置，军鼓再密也是平滑起伏、不超过四处；分离到一半的歌只用已知的鼓点；路面越湿涟漪越多、光斑的一跳越少。

const hits = (list: [number, number, number][], until?: number): DrumHits => ({
    times: Float64Array.from(list.map(([time]) => time)),
    kinds: Uint8Array.from(list.map(([, kind]) => kind)),
    strengths: Float32Array.from(list.map(([, , strength]) => strength)),
    until,
});

const beats = (times: number[], downbeats: number[] = [], extra: Partial<BeatFxEvent> = {}): BeatFxEvent[] => [...times, ...downbeats]
    .sort((a, b) => a - b)
    .map(t => ({ t, kind: downbeats.includes(t) ? 'downbeat' : 'beat', ...extra }));

/** 按时间一帧帧走（1/120 秒）：alive 给出这一刻还在的那几下（鼓点的时刻）；上一帧在、还没到寿命的，这一帧也得在。 */
const expectNoneCutOff = (life: number, until: number, alive: (time: number) => number[]) => {
    let previous: number[] = [];
    for (let time = 0; time < until; time += 1 / 120) {
        const now = alive(time);
        for (const hit of previous) {
            if (time - hit < life - 1e-6) expect(now.some(other => Math.abs(other - hit) < 1e-6)).toBe(true);
        }
        previous = now;
    }
};

const neonAt = (events: BeatFxEvent[], time: number, strength = 1) => {
    const out = resolveMachiNeonPulse(events, time, strength, 1, createMachiBeatFrame());
    return { groups: Array.from(out.neonGroups), neon: out.neon, warm: out.warm, bloom: out.bloom, frame: out };
};

describe('machiSwell', () => {
    it('rises slowly, peaks at the end of the attack and falls back to nothing', () => {
        expect(machiSwell(-0.1, 0.3, 1)).toBe(0);
        expect(machiSwell(0, 0.3, 1)).toBe(0);
        expect(machiSwell(0.03, 0.3, 1)).toBeLessThan(0.05);
        expect(machiSwell(0.3, 0.3, 1)).toBeCloseTo(1);
        expect(machiSwell(0.8, 0.3, 1)).toBeCloseTo(0.5);
        expect(machiSwell(1.3, 0.3, 1)).toBeCloseTo(0);
    });
});

describe('resolveMachiNeonPulse', () => {
    const { attack, lift } = MACHI_BEAT.neon;

    it('rests without beats, before the first one, or at strength 0', () => {
        const rest = createMachiBeatFrame();
        expect(neonAt([], 3).frame).toEqual(rest);
        expect(neonAt(beats([1, 1.5]), 0.5).frame).toEqual(rest);
        expect(neonAt(beats([1, 1.5]), 1.6, 0).frame).toEqual(rest);
    });

    it('lights the groups in turn by the beat\'s place in the list, slowly', () => {
        const events = beats([0, 0.5, 1, 1.5, 2]);
        // 第 3 拍（序号 2）刚亮满：第 3 组最亮，第 2 组还在暗下去，第 1 组那拍已经快淡完。
        const peak = neonAt(events, 1 + attack).groups;
        expect(peak[2]).toBeGreaterThan(peak[1]!);
        expect(peak[1]).toBeGreaterThan(peak[0]!);
        // 拍子刚到时那组还没怎么亮。
        const onset = neonAt(events, 1.02).groups;
        expect(onset[2]! - 1).toBeLessThan(0.1 * lift);
        // 第 4 拍（序号 3）又轮回第 1 组。
        const next = neonAt(events, 1.5 + attack).groups;
        expect(next[0]).toBeGreaterThan(next[2]!);
        expect(next[0]).toBeGreaterThan(next[1]!);
    });

    it('trades brightness between the groups instead of brightening the whole street', () => {
        // 只有一拍：亮的那组往上，另两组暗下去；三组的平均与分不开组的那一路一样。
        const { groups, neon } = neonAt(beats([1]), 1 + attack);
        expect(groups[1]).toBeCloseTo(groups[2]!);
        expect(groups[1]).toBeLessThan(1);
        expect(groups[0]).toBeGreaterThan(1 + lift);
        expect((groups[0]! + groups[1]! + groups[2]!) / 3).toBeCloseTo(neon);
        expect(neon).toBeCloseTo(1 + lift / 3);
    });

    it('scales with the strength and goes brighter on a downbeat', () => {
        const plain = neonAt(beats([1]), 1 + attack).groups[0]!;
        expect(neonAt(beats([1]), 1 + attack, 2).groups[0]! - 1).toBeCloseTo(2 * (plain - 1));
        expect(neonAt(beats([], [1]), 1 + attack).groups[0]).toBeGreaterThan(plain);
    });

    it('swells the warm lights only on downbeats, and slowly', () => {
        expect(neonAt(beats([1, 1.5]), 1.6).warm).toBe(1);
        const warm = MACHI_BEAT.warm;
        expect(neonAt(beats([], [1]), 1 + warm.attack).warm).toBeCloseTo(1 + warm.lift);
        expect(neonAt(beats([], [1]), 1.05).warm - 1).toBeLessThan(0.05 * warm.lift);
    });

    it('stays dark in a bar with no rhythm', () => {
        expect(neonAt(beats([1], [], { rhythmic: false }), 1 + attack).frame).toEqual(createMachiBeatFrame());
    });

    it('gives bright beats to the neon and low-heavy downbeats to the warm lights', () => {
        const high = neonAt(beats([], [1], { tone: { low: 0.05, mid: 0.35, high: 0.6 } }), 1.6);
        const low = neonAt(beats([], [1], { tone: { low: 0.8, mid: 0.15, high: 0.05 } }), 1.6);
        expect(high.groups[0]).toBeGreaterThan(low.groups[0]!);
        expect(low.warm).toBeGreaterThan(high.warm);
    });

    it('reads a group for the signs, and a small share of it for the lightboxes', () => {
        const { frame } = neonAt(beats([0, 0.5]), 0.5 + attack);
        expect(machiNeonGroup(frame, 4)).toBe(frame.neonGroups[1]);
        expect(machiLightboxGroup(frame, 1) - 1).toBeCloseTo(MACHI_BEAT.lightbox * (frame.neonGroups[1]! - 1));
    });
});

describe('resolveMachiDrumRipples', () => {
    const rings = () => new Float32Array(MACHI_BEAT.ripple.max * 2);

    it('clears every ring without hits or strength', () => {
        const out = rings().fill(5);
        expect(resolveMachiDrumRipples(null, 3, 1, out)).toBe(0);
        expect(Array.from(out)).toEqual([-1, 0, -1, 0, -1, 0, -1, 0]);
        expect(resolveMachiDrumRipples(hits([[1, DRUM_KICK, 0.9]]), 1.2, 0, out)).toBe(0);
        expect(out[1]).toBe(0);
    });

    it('rings out the loud kicks still alive, newest first, apart and at most four', () => {
        const list = hits([
            [0.2, DRUM_KICK, 0.9],
            [1.0, DRUM_KICK, 0.8],
            [1.2, DRUM_SNARE, 0.9],
            [1.3, DRUM_KICK, 0.2],
            [1.5, DRUM_KICK, 0.7],
            [1.55, DRUM_KICK, 0.9],
            [1.8, DRUM_HAT, 0.9],
            [1.9, DRUM_KICK, 0.6],
            [2.0, DRUM_KICK, 0.5],
            [2.5, DRUM_KICK, 0.9],
        ]);
        const out = rings();
        resolveMachiDrumRipples(list, 2.1, 1, out);
        // 2.0 离 1.9 不到 gap，留早的 1.9；1.55 离 1.5 太近，留 1.5；1.3 太弱；0.2 已经过了寿命；2.5 还没到。
        const ages = Array.from(out.filter((_, index) => index % 2 === 0)).map(age => Math.round(age * 100) / 100);
        expect(ages).toEqual([0.2, 0.6, 1.1, -1]);
        expect(out[1]).toBeCloseTo(0.6);
        expect(out[3]).toBeCloseTo(0.7);
        expect(out[5]).toBeCloseTo(0.8);
    });

    it('keeps a ring once it is out, even as the window slides past the kick before it', () => {
        // 0.0 与 0.1 太近，0.1 不起环；0.0 过了寿命以后，0.1 也不该冒出来。
        const list = hits([[0, DRUM_KICK, 1], [0.1, DRUM_KICK, 1], [0.6, DRUM_KICK, 1]]);
        const out = rings();
        resolveMachiDrumRipples(list, 1.35, 1, out);
        expect(Array.from(out.filter((_, index) => index % 2 === 0)).map(age => Math.round(age * 100) / 100)).toEqual([0.75, -1, -1, -1]);
    });

    it('spaces the rings under dense kicks so that none is cut off before it runs out', () => {
        const list = hits(Array.from({ length: 50 }, (_, index) => [index * 0.1, DRUM_KICK, 1] as [number, number, number]));
        const out = rings();
        expectNoneCutOff(MACHI_BEAT.ripple.life, 5, time => {
            resolveMachiDrumRipples(list, time, 1, out);
            return Array.from(out.filter((_, index) => index % 2 === 0)).filter(age => age >= 0).map(age => time - age);
        });
    });

    it('thumps the light pools right on a kick and lets it fall away', () => {
        const list = hits([[1, DRUM_KICK, 1]]);
        const now = resolveMachiDrumRipples(list, 1, 1, rings());
        const later = resolveMachiDrumRipples(list, 1.3, 1, rings());
        expect(now).toBeCloseTo(MACHI_BEAT.ripple.thump);
        expect(later).toBeLessThan(now * 0.2);
        expect(resolveMachiDrumRipples(list, 1, 2, rings())).toBeCloseTo(2 * now);
    });
});

describe('resolveMachiScreenFlash', () => {
    const { attack, fall, max } = MACHI_BEAT.screen;
    const at = (list: DrumHits | null, time: number, strength = 1) => {
        const out = resolveMachiScreenFlash(list, time, strength, createMachiBeatFrame());
        return { at: Array.from(out.swellAt), amp: Array.from(out.swellAmp) };
    };

    it('rests without hits or strength', () => {
        expect(at(null, 1).amp).toEqual([0, 0, 0, 0]);
        expect(at(hits([[1, DRUM_SNARE, 1]]), 1.2, 0).amp).toEqual([0, 0, 0, 0]);
    });

    it('slowly lights a patch on a loud snare and lets it fade', () => {
        const list = hits([[1, DRUM_SNARE, 0.8], [1.05, DRUM_KICK, 1]]);
        expect(at(list, 0.9).amp[0]).toBe(0);
        expect(at(list, 1.01).amp[0]).toBeLessThan(0.05);
        expect(at(list, 1 + attack).amp[0]).toBeCloseTo(0.8);
        const fading = at(list, 1 + attack + fall / 2).amp[0]!;
        expect(fading).toBeCloseTo(0.4);
        expect(at(list, 1 + attack + fall).amp[0]).toBeCloseTo(0);
    });

    it('puts one snare after another in different places on the screen', () => {
        const list = hits([[1, DRUM_SNARE, 1], [1.4, DRUM_SNARE, 1], [1.8, DRUM_SNARE, 1]]);
        const { at: places, amp } = at(list, 1.9);
        expect(amp.filter(value => value > 0)).toHaveLength(3);
        places.slice(0, 3).forEach(place => {
            expect(place).toBeGreaterThanOrEqual(0.15);
            expect(place).toBeLessThanOrEqual(0.85);
        });
        expect(Math.abs(places[0]! - places[1]!)).toBeGreaterThan(0.2);
        expect(Math.abs(places[1]! - places[2]!)).toBeGreaterThan(0.2);
        // 同一下鼓点，拖进度回来还在同一处。
        expect(at(list, 1.5).at[0]).toBeCloseTo(places[1]!);
    });

    it('rises and falls smoothly under dense snares, never more than four patches', () => {
        const list = hits(Array.from({ length: 40 }, (_, index) => [index * 0.125, DRUM_SNARE, 1] as [number, number, number]));
        let previous = 0;
        let steepest = 0;
        for (let time = 0; time < 5; time += 1 / 120) {
            const { amp } = at(list, time);
            expect(amp.filter(value => value > 0).length).toBeLessThanOrEqual(max);
            const total = amp.reduce((sum, value) => sum + value, 0);
            steepest = Math.max(steepest, Math.abs(total - previous));
            previous = total;
        }
        // 一处亮起最快也要 attack 秒（每帧最多涨 1.5 / attack / 120），也没有哪处亮着时被挤掉（那会一下掉很多）。
        expect(steepest).toBeLessThan(1.6 / attack / 120);
    });

    it('skips quiet snares and other drums', () => {
        const list = hits([[1, DRUM_SNARE, 0.2], [1.02, DRUM_HAT, 1], [1.04, DRUM_KICK, 1]]);
        expect(at(list, 1.2).amp).toEqual([0, 0, 0, 0]);
    });
});

describe('machiDrumHitsAt', () => {
    it('uses a track still separating only before the time its hits reach', () => {
        const partial = hits([[1, DRUM_KICK, 1]], 10);
        expect(machiDrumHitsAt(partial, 5)).toBe(partial);
        expect(machiDrumHitsAt(partial, 12)).toBeNull();
        expect(machiDrumHitsAt(hits([[1, DRUM_KICK, 1]]), 99)).not.toBeNull();
        expect(machiDrumHitsAt(null, 1)).toBeNull();
    });
});

describe('machiRippleWetness', () => {
    it('brings the ripples in as the ground gets wet', () => {
        const [from, to] = MACHI_BEAT.ripple.wet;
        expect(machiRippleWetness(0)).toBe(0);
        expect(machiRippleWetness(from)).toBe(0);
        expect(machiRippleWetness((from + to) / 2)).toBeCloseTo(0.5);
        expect(machiRippleWetness(to)).toBe(1);
        expect(machiRippleWetness(1)).toBe(1);
    });
});
