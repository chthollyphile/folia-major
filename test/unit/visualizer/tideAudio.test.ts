import { describe, expect, it } from 'vitest';
import {
    TIDE_FOCUS_COUNT,
    TIDE_PULSE_COUNT,
    TideAudio,
    type TideAudioInput,
} from '@/components/visualizer/backgrounds/tide/tideAudio';

// test/unit/visualizer/tide/tideAudio.test.ts
// The sound layer must stay on the surface: it smooths the analyser, turns kicks into rings and
// packs the lyric pools. These are the slots the shader trusts, so the mapping is pinned here.

const DT = 1 / 30;

const bands = (patch: Partial<{ bass: number; lowMid: number; mid: number; vocal: number; treble: number }> = {}) => ({
    bass: 0,
    lowMid: 0,
    mid: 0,
    vocal: 0,
    treble: 0,
    ...patch,
});

const input = (patch: Partial<TideAudioInput> = {}): TideAudioInput => ({
    power: 0,
    bands: null,
    dt: DT,
    time: 0,
    originX: 0.5,
    originY: 0.6,
    focus: [],
    amount: 1,
    focusAmount: 1,
    ...patch,
});

/** 跑 n 帧、每帧喂同一个输入，time 自动推进（模拟 RAF）。 */
const run = (audio: TideAudio, base: TideAudioInput, frames: number) => {
    let frame = audio.update(base);
    for (let index = 1; index < frames; index += 1) {
        frame = audio.update({ ...base, time: base.time + index * base.dt });
    }
    return frame;
};

const liveRings = (pulses: number[][]): number => pulses.filter(slot => slot[3] > 0).length;

describe('tide sound layer', () => {
    it('smooths the bands instead of snapping to the analyser', () => {
        const audio = new TideAudio();
        const frame = audio.update(input({ bands: bands({ bass: 1, mid: 1, treble: 1 }) }));

        expect(frame.bass).toBeGreaterThan(0);
        expect(frame.bass).toBeLessThan(0.5);
    });

    it('normalizes the 0..255 analyser scale instead of clamping it to 1', () => {
        // 主播放链路写的是 0..255：128 要读成 ~0.5，而不是被 clamp 成 1（那会让整层声音冻在最大值）。
        const audio = new TideAudio();
        const first = audio.update(input({ power: 128, bands: bands({ bass: 128 }) }));
        expect(first.level).toBeGreaterThan(0);
        expect(first.level).toBeLessThan(0.6);

        const settled = run(audio, input({ power: 128, bands: bands({ bass: 128 }) }), 240);
        expect(settled.bass).toBeCloseTo(128 / 255, 2);
        expect(settled.level).toBeCloseTo(128 / 255, 2);
        // 0..1 的预览刻度照旧原样透传。
        expect(run(new TideAudio(), input({ power: 0.5 }), 240).level).toBeCloseTo(0.5, 2);
    });

    it('breathes on the drum: it fills on a kick and exhales slowly', () => {
        const audio = new TideAudio();
        run(audio, input({ bands: bands() }), 10);
        const kicked = audio.update(input({ bands: bands({ bass: 0.85 }), time: 1 }));
        expect(kicked.breath).toBeGreaterThan(0.8);

        const later = run(audio, input({ bands: bands(), time: 1 }), 24);
        expect(later.breath).toBeLessThan(kicked.breath * 0.6);
        expect(later.breath).toBeGreaterThan(0);
    });

    it('keeps only a small floor of breathing under a sustained low end', () => {
        const audio = new TideAudio();
        const frame = run(audio, input({ bands: bands({ bass: 0.8 }) }), 240);

        // 以前这里要求明显垫底（>0.2），而那正是「安静时水面也不停、音乐进来没有对比度」的原因。
        // 现在只留一层很低的底：不熄灭，但听着是静的。
        expect(frame.breath).toBeGreaterThan(0.02);
        expect(frame.breath).toBeLessThan(0.12);
    });

    it('tracks how hard the music is working over seconds, not how loud it is right now', () => {
        const one = new TideAudio().update(input({ power: 1 }));
        const settled = run(new TideAudio(), input({ power: 1 }), 600);

        // 情绪是秒级的：一帧之内几乎不动，而响度已经先动了 —— 这正是「状态」与「响度」的分界。
        expect(settled.mood).toBeGreaterThan(0.8);
        expect(one.mood).toBeLessThan(settled.mood * 0.2);
    });

    it('enters the chorus and holds it through a dip between the two thresholds', () => {
        const audio = new TideAudio();
        expect(run(audio, input({ power: 1 }), 300).chorus).toBeGreaterThan(0.6);

        // 落到两个门槛（0.36 / 0.52）之间：没有迟滞就该退出副歌，有迟滞则留着。
        const held = run(audio, input({ power: 0.45 }), 600);
        expect(held.chorus).toBeGreaterThan(0.6);

        // 真降到主歌水平才退出。
        expect(run(audio, input({ power: 0.2 }), 900).chorus).toBeLessThan(0.3);
    });

    it('reports a smoothed loudness for the momentum', () => {
        const audio = new TideAudio();
        const first = audio.update(input({ power: 1 }));

        expect(first.level).toBeGreaterThan(0);
        expect(first.level).toBeLessThan(1);
        expect(run(audio, input({ power: 1 }), 240).level).toBeCloseTo(1, 3);
        // 关掉声音层也照样报响度：动量倍率由 tideMomentumGain 自己决定。
        expect(run(audio, input({ power: 1, amount: 0 }), 240).level).toBeCloseTo(1, 3);
    });

    it('falls back to the overall power when there are no bands', () => {
        const audio = new TideAudio();
        const frame = run(audio, input({ power: 1 }), 240);

        expect(frame.bass).toBeCloseTo(1, 3);
        expect(frame.mid).toBeCloseTo(0.6, 3);
        expect(frame.treble).toBeCloseTo(0.5, 3);
    });

    it('spawns one ring per bass onset, at the given origin', () => {
        const audio = new TideAudio();
        run(audio, input({ bands: bands() }), 10);
        const frame = audio.update(input({ bands: bands({ bass: 0.85 }), time: 1 }));

        expect(frame.pulses).toHaveLength(TIDE_PULSE_COUNT);
        expect(frame.pulses[0][3]).toBeGreaterThan(0);
        expect(frame.pulses[0][0]).toBeCloseTo(0.5, 3);
        expect(frame.pulses[0][1]).toBeCloseTo(0.6, 3);
    });

    it('keeps firing on kicks that ride on a loud, steady low end', () => {
        const audio = new TideAudio();
        let onsetsAfterWarmup = 0;

        // 现代流行乐的鼓组：低频底子压得很平（0.72），每 0.5 秒再叠一记鼓点。
        for (let frame = 0; frame < 420; frame += 1) {
            const time = frame * DT;
            const punch = Math.exp(-((time % 0.5)) / 0.05);
            const frameOut = audio.update(input({
                bands: bands({ bass: Math.min(1, 0.72 + 0.22 * punch) }),
                time,
            }));
            const freshest = Math.min(...frameOut.pulses.map(slot => slot[2]));
            if (frame > 90 && freshest < DT * 1.5 && frameOut.pulses.some(slot => slot[3] > 0)) {
                onsetsAfterWarmup += 1;
            }
        }

        // 比值阈值（快 > 慢 × 1.22）在基线收敛后基本再也够不到，这条会挂 —— 那正是
        // "只有开头几秒有效果"的成因。
        expect(onsetsAfterWarmup).toBeGreaterThan(5);
    });

    it('stops ringing once a sustained low end has settled', () => {
        const audio = new TideAudio();
        const frame = run(audio, input({ bands: bands({ bass: 0.5 }) }), 240);

        expect(frame.pulses.every(slot => slot[3] === 0)).toBe(true);
    });

    it('keeps at most TIDE_PULSE_COUNT rings alive', () => {
        const audio = new TideAudio();
        let frame = audio.update(input({ bands: bands() }));
        // 每 0.2 秒一次鼓点：2.4 秒的寿命本该堆下十几圈，这里只能留 3 个。
        for (let index = 1; index <= 120; index += 1) {
            const punch = index % 6 === 0;
            frame = audio.update(input({ bands: bands({ bass: punch ? 0.9 : 0 }), time: index * DT }));
        }

        expect(frame.pulses).toHaveLength(TIDE_PULSE_COUNT);
        expect(liveRings(frame.pulses)).toBe(TIDE_PULSE_COUNT);
    });

    it('recycles a ring once it outlives its life', () => {
        const audio = new TideAudio();
        run(audio, input({ bands: bands() }), 10);
        expect(audio.update(input({ bands: bands({ bass: 0.85 }), time: 1 })).pulses[0][3]).toBeGreaterThan(0);

        const later = run(audio, input({ bands: bands(), time: 1 }), 120);

        expect(later.pulses.every(slot => slot[3] === 0)).toBe(true);
    });

    it('drops the whole sound layer at amount 0', () => {
        const audio = new TideAudio();
        const frame = run(audio, input({ bands: bands({ bass: 1, mid: 1, treble: 1 }), amount: 0 }), 120);

        expect(frame.bass).toBe(0);
        expect(frame.mid).toBe(0);
        expect(frame.treble).toBe(0);
        expect(frame.pulses.every(slot => slot[3] === 0)).toBe(true);
    });

    it('packs the lyric pools left to right', () => {
        const audio = new TideAudio();
        const frame = audio.update(input({
            focus: [
                { x: 0.7, y: 0.2, strength: 0.8 },
                { x: 0.2, y: 0.6, strength: 0.5 },
            ],
        }));

        expect(frame.focus).toHaveLength(TIDE_FOCUS_COUNT);
        expect(frame.focus[0]).toEqual([0.2, 0.6, 0.5, 0]);
        expect(frame.focus[1]).toEqual([0.7, 0.2, 0.8, 0]);
        expect(frame.focus[2]).toEqual([0, 0, 0, 0]);
    });

    it('scales the pools with lyricLift', () => {
        const audio = new TideAudio();
        const frame = audio.update(input({
            focus: [{ x: 0.5, y: 0.5, strength: 0.5 }],
            focusAmount: 0,
        }));

        expect(frame.focus[0][2]).toBe(0);
    });
});
