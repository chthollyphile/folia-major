import { describe, expect, it } from 'vitest';
import { buildTimeline, planSpin, type TimelineShot } from '@/components/visualizer/hanabi/timeline';
import { createVisualizerRng } from '@/components/visualizer/visualizerSeedHash';

// test/unit/visualizer/hanabi/hanabiSpin.test.ts
// 花火的世界旋转：贯穿整个单元一直在转——镜头内慢转、镜头边界加速转过大角度，位置与角速度都连续；
// 同一方向时没有停住的阶段，换向时只在一瞬间过零；镜头中点时正好转到这个镜头自己的角度（字是正的）。

const shots: TimelineShot[] = Array.from({ length: 6 }, (_, index) => ({
    startTime: index * 3,
    endTime: (index + 1) * 3,
    firstSung: index * 3 + 0.2,
    lastSungEnd: index * 3 + 2.6,
    isBridge: false,
    camera: { rise: 0.4, push: 0.05, roll: 0, punch: 0 },
}));

const build = (directions: number[]) => {
    const angles: number[] = [];
    const drift: number[] = [];
    directions.forEach((direction, index) => {
        angles.push(index === 0 ? 0 : angles[index - 1]! + direction * 1.1);
        drift.push(direction * 0.12);
    });
    const timeline = buildTimeline(shots, { unitStart: 0, unitEnd: 18, height: 720, riseSpeed: 1, motion: 1, spinAngles: angles, spinDrift: drift });
    return { timeline, angles };
};

const FRAME = 1 / 120;

/** 逐帧的角速度（弧度 / 秒）。 */
const velocities = (spin: (time: number) => number) => {
    const out: number[] = [];
    for (let time = 0.05; time < 17.95; time += FRAME) out.push((spin(time + FRAME) - spin(time)) / FRAME);
    return out;
};

/**
 * 加速度连续：取样足够密时，相邻两个取样的加速度差也足够小（跳变不管取样多密都还在）。
 * 1/2000 秒取样时，连续的曲线相邻差 = 加加速度 × 步长，远小于 0.1；原来的跳变是 2–4。
 */
const expectContinuousAcceleration = (value: (time: number) => number) => {
    const step = 1 / 2000;
    const accel = (time: number) => (value(time + step) - 2 * value(time) + value(time - step)) / step ** 2;
    let previous = accel(0.05);
    let worst = 0;
    let worstAt = 0;
    for (let time = 0.05 + step; time < 17.95; time += step) {
        const current = accel(time);
        if (Math.abs(current - previous) > worst) {
            worst = Math.abs(current - previous);
            worstAt = time;
        }
        previous = current;
    }
    expect(worst, `t = ${worstAt.toFixed(4)}`).toBeLessThan(0.1);
};

describe('花火的世界旋转', () => {
    it('镜头中点时转到这个镜头自己的角度', () => {
        const { timeline, angles } = build([1, 1, 1, 1, 1, 1]);
        shots.forEach((shot, index) => {
            expect(timeline.spin((shot.startTime + shot.endTime) / 2)).toBeCloseTo(angles[index]!, 6);
        });
    });

    it('同一方向时一直在转：角速度处处同号、不低于镜头内的慢转', () => {
        const { timeline } = build([1, 1, 1, 1, 1, 1]);
        const speeds = velocities(timeline.spin);
        expect(Math.min(...speeds)).toBeGreaterThan(0.12 * 0.9);
        // 边界的快转比镜头内的慢转快得多。
        expect(Math.max(...speeds)).toBeGreaterThan(0.12 * 5);
    });

    it('慢转与快转之间角加速度也连续：没有一脚油门、一脚刹车', () => {
        // 回归：边界窗口原来用三次 Hermite 接慢转，速度接上了，但窗口两端角加速度从 0 一下跳到约 5 弧度 / 秒²。
        for (const directions of [[1, 1, 1, 1, 1, 1], [1, -1, -1, 1, 1, -1]]) {
            expectContinuousAcceleration(build(directions).timeline.spin);
        }
    });

    it('上升与推近在窗口里也是加速度连续的', () => {
        // 回归：上升窗口原来用 easeInOutCubic，窗口正中加速度从 +12 一下翻到 −12（速度曲线是个尖顶）。
        const { timeline } = build([1, 1, 1, 1, 1, 1]);
        expectContinuousAcceleration(time => timeline.rise(time) / 720);
        expectContinuousAcceleration(time => timeline.camera(time).scale);
    });

    it('角度连续、没有跳变', () => {
        const { timeline } = build([1, -1, -1, 1, 1, -1]);
        for (let time = 0.05; time < 17.95; time += FRAME) {
            expect(Math.abs(timeline.spin(time + FRAME) - timeline.spin(time))).toBeLessThan(0.05);
        }
    });

    it('换向时只在一瞬间过零，没有停住的一段', () => {
        const { timeline } = build([1, -1, -1, 1, 1, -1]);
        const speeds = velocities(timeline.spin);
        let run = 0;
        let longest = 0;
        speeds.forEach(speed => {
            run = Math.abs(speed) < 0.05 ? run + 1 : 0;
            longest = Math.max(longest, run);
        });
        // 慢于 0.05 弧度 / 秒（约 3°/秒）的连续时间不超过 0.12 秒（几帧）：换向是平滑地减速再反过来，不是一下翻过去。
        expect(longest * FRAME).toBeLessThan(0.12);
    });

    it('不给角度时不转', () => {
        const timeline = buildTimeline(shots, { unitStart: 0, unitEnd: 18, height: 720, riseSpeed: 1, motion: 1 });
        [0, 2.9, 3.1, 9, 17].forEach(time => expect(timeline.spin(time)).toBe(0));
    });
});

describe('花火一个单元的旋转安排', () => {
    const DURATIONS = [3.2, 4.1, 2.4, 5.5, 3, 1.8, 4.4, 6, 2.6];

    it('镜头内转得看得出来，边界在慢转之外再甩一个大角度', () => {
        const { angles, drift } = planSpin(DURATIONS, { amount: 1, direction: 1, random: createVisualizerRng('plan') });
        DURATIONS.forEach((duration, index) => {
            // 约 11°/秒，长镜头慢一些，但一个镜头里慢转也至少转二十度上下。
            expect(Math.abs(drift[index]!)).toBeLessThanOrEqual(0.2 + 1e-9);
            expect(Math.abs(drift[index]!) * duration).toBeGreaterThan(0.33);
            if (index === 0) return;
            const cruise = (drift[index - 1]! * DURATIONS[index - 1]! + drift[index]! * duration) / 2;
            const swing = (angles[index]! - angles[index - 1]! - cruise) * Math.sign(drift[index]!);
            expect(swing).toBeGreaterThanOrEqual(0.6 - 1e-9);
            expect(swing).toBeLessThanOrEqual(1.4 + 1e-9);
        });
    });

    it('偶尔换向，但单元最后一个镜头总是转回起转的方向（段落之间接得上）', () => {
        let flipped = 0;
        for (let seed = 0; seed < 200; seed += 1) {
            for (const direction of [1, -1]) {
                const count = 2 + (seed % 7);
                const { drift } = planSpin(DURATIONS.slice(0, count), { amount: 1, direction, random: createVisualizerRng(`flip:${seed}`) });
                expect(Math.sign(drift[0]!)).toBe(direction);
                expect(Math.sign(drift.at(-1)!)).toBe(direction);
                if (drift.some(value => Math.sign(value) !== direction)) flipped += 1;
            }
        }
        expect(flipped).toBeGreaterThan(20);
        expect(flipped).toBeLessThan(250);
    });

    it('tuning.spin 为 0 时不转', () => {
        const { angles, drift } = planSpin(DURATIONS, { amount: 0, direction: 1, random: createVisualizerRng('zero') });
        expect(angles.every(value => value === 0) && drift.every(value => value === 0)).toBe(true);
    });
});
