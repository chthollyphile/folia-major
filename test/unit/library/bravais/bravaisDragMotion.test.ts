import { describe, expect, it } from 'vitest';
import { createBravaisDragMotion } from '@/library/suites/bravais/bravaisDragMotion';
import type { WallViewCenter } from '@/components/wall/wallView';

// 用可控的帧时钟验证输入合流、逐帧收敛、打断与裁剪请求；不依赖机器的刷新率或真实计时。

const harness = (scale = 1) => {
    let clock = 0;
    let nextHandle = 0;
    let center: WallViewCenter = { x: 0, y: 0 };
    const frames = new Map<number, FrameRequestCallback>();
    const writes: Array<{ center: WallViewCenter; recull: boolean }> = [];
    const motion = createBravaisDragMotion({
        read: () => center,
        write: (next, recull) => {
            center = next;
            writes.push({ center: next, recull });
        },
        scale: () => scale,
        now: () => clock,
        request: callback => { const handle = ++nextHandle; frames.set(handle, callback); return handle; },
        cancel: handle => { frames.delete(handle); },
    });
    return {
        motion, frames, writes,
        read: () => center,
        frame: (elapsed = 8) => {
            clock += elapsed;
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach(callback => callback(clock));
        },
    };
};

describe('Bravais drag motion', () => {
    it('does no idle work, then coalesces an input burst into one frame aimed at the latest target', () => {
        const h = harness();
        expect(h.frames.size).toBe(0);
        h.motion.setTarget({ x: 20, y: 10 });
        h.motion.setTarget({ x: 60, y: 30 });
        h.motion.setTarget({ x: 100, y: 50 });
        expect(h.frames.size).toBe(1);
        expect(h.writes).toHaveLength(0);
        h.frame();
        expect(h.writes).toHaveLength(1);
        expect(h.read().x).toBeGreaterThan(60);
        expect(h.read().x).toBeLessThan(100);
        expect(h.read().y).toBeCloseTo(h.read().x / 2);
    });

    it('keeps drawing between pointer events, lands exactly and stops requesting frames', () => {
        const h = harness();
        const target = { x: 120, y: -80 };
        h.motion.setTarget(target);
        let previous = h.read();
        for (let frame = 0; h.frames.size; frame++) {
            expect(frame).toBeLessThan(20);
            h.frame();
            expect(h.read().x).toBeGreaterThanOrEqual(previous.x);
            expect(h.read().x).toBeLessThanOrEqual(target.x);
            expect(h.read().y).toBeLessThanOrEqual(previous.y);
            expect(h.read().y).toBeGreaterThanOrEqual(target.y);
            previous = h.read();
        }
        expect(h.writes.length).toBeGreaterThan(2);
        expect(h.read()).toEqual(target);
        expect(h.motion.target()).toBeNull();
        const count = h.writes.length;
        h.frame();
        expect(h.writes).toHaveLength(count);
    });

    it('follows elapsed time rather than frame count at 60, 120 and 180 Hz', () => {
        const at = (hz: number) => {
            const h = harness();
            h.motion.setTarget({ x: 1000, y: -500 });
            for (let frame = 0; frame < hz / 30; frame++) h.frame(1000 / hz);
            return h.read();
        };
        for (const hz of [120, 180]) {
            expect(at(hz).x).toBeCloseTo(at(60).x, 8);
            expect(at(hz).y).toBeCloseTo(at(60).y, 8);
        }
    });

    it('accepts inertia and reversals from the displayed position without a synchronous jump', () => {
        const h = harness();
        h.motion.setTarget({ x: 100, y: 0 });
        h.frame();
        const released = h.read();
        h.motion.setTarget({ x: 150, y: 0 });
        expect(h.read()).toEqual(released);
        h.frame();
        expect(h.read().x).toBeGreaterThan(released.x);
        expect(h.read().x).toBeLessThan(150);
        const beforeReverse = h.read();
        h.motion.setTarget({ x: -100, y: 0 });
        expect(h.read()).toEqual(beforeReverse);
        h.frame();
        expect(h.read().x).toBeLessThan(beforeReverse.x);
        expect(h.read().x).toBeGreaterThan(-100);
    });

    it('cancels pending work at the displayed position and starts a later gesture from there', () => {
        const h = harness();
        h.motion.setTarget({ x: 100, y: 50 }, true);
        h.frame();
        const stopped = h.read();
        h.motion.stop();
        h.motion.stop();
        expect(h.frames.size).toBe(0);
        expect(h.motion.target()).toBeNull();
        h.frame(100);
        expect(h.read()).toEqual(stopped);
        h.motion.setTarget({ x: -50, y: 0 });
        h.frame();
        expect(h.read().x).toBeLessThan(stopped.x);
        expect(h.read().x).toBeGreaterThan(-50);
        expect(h.writes.at(-1)?.recull).toBe(false);
    });

    it('keeps a cull request across coalesced inputs and consumes it only once', () => {
        const h = harness();
        h.motion.setTarget({ x: 100, y: 0 }, true);
        h.motion.setTarget({ x: 120, y: 0 });
        h.frame();
        expect(h.writes[0]?.recull).toBe(true);
        h.frame();
        expect(h.writes[1]?.recull).toBe(false);
    });

    it('stops on a subpixel remainder in screen space, independent of world scale', () => {
        const small = harness(0.25);
        const large = harness(2);
        for (const h of [small, large]) {
            h.motion.setTarget({ x: 0.2, y: 0 });
            h.frame(0);
        }
        expect(small.read().x).toBe(0.2);
        expect(small.frames.size).toBe(0);
        expect(large.read().x).toBe(0);
        expect(large.frames.size).toBe(1);
    });
});
