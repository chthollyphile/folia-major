// @vitest-environment jsdom
import { act, createElement, type MutableRefObject, type PointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bounds } from '@/components/wall/layout';
import { BRAVAIS_CULL_EDGE_MARGIN, BRAVAIS_OVERSCAN, BRAVAIS_SEAM_FULL_WIDTH, BRAVAIS_SEAM_HOME_WIDTH } from '@/library/suites/bravais/bravaisConstants';
import { computeBravaisFrame, rotateAround } from '@/library/suites/bravais/bravaisFrame';
import { getVisibleWorldBounds, needsRecull, useBravaisCamera } from '@/library/suites/bravais/useBravaisCamera';
import type { BravaisFrameState } from '@/library/suites/bravais/useBravaisFrame';
import { useBravaisTilt } from '@/library/suites/bravais/useBravaisTilt';

// test/unit/library/bravais/bravaisTiltCull.test.ts
// 整层倾斜着时的裁剪（首页、集合页给了倾斜角时与海报同一条路）：屏幕上每一点对应的世界点都在可见范围里（墙没有空着的
// 角）；缝被拖到几屏之外、支点走远时范围整块跟着挪而不是越变越大；按「相机到了别处」问到的范围（补间的目的地、拖动的
// 下一步）同样按倾斜算——不然飞行途中墙是空的、拖动时每一帧都重新裁剪。
// 后半（「wiring」）挂真的 useBravaisCamera / useBravaisTilt：钉住相机补间、拖动与倾斜补间确实走了按倾斜算的那条路
// （framer 的 animate 换成记下参数的替身，补间不真的跑）。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AnimateOptions = { onUpdate?: (value: number) => void; onComplete?: () => void };
const animateCalls: Array<{ from: number; to: number; options: AnimateOptions }> = [];
vi.mock('framer-motion', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    animate: (from: number, to: number, options: AnimateOptions) => {
        animateCalls.push({ from, to, options });
        return { stop: () => undefined };
    },
}));

const view = { width: 1440, height: 900, scale: 0.76 };

const stateAt = (patch: Partial<BravaisFrameState> = {}): BravaisFrameState => ({
    view,
    center: { x: 0, y: 0 },
    anchorX: 0,
    anchorY: null,
    openWidth: BRAVAIS_SEAM_FULL_WIDTH,
    targetOpenWidth: BRAVAIS_SEAM_FULL_WIDTH,
    contentWidth: BRAVAIS_SEAM_FULL_WIDTH,
    hidden: false,
    poster: false,
    tiltDeg: -10,
    tiltTargetDeg: -10,
    tiltSettled: true,
    ...patch,
});

/** 屏幕上的一点此刻画的是哪个世界点（按帧反算：先把倾斜转回去，再减掉那半面墙的平移）；落在缝里时是 null。 */
const worldAt = (state: BravaisFrameState, screenX: number, screenY: number) => {
    const frame = computeBravaisFrame({
        center: state.center,
        view,
        anchorX: state.anchorX,
        openWidth: state.openWidth,
        contentWidth: state.contentWidth,
        hidden: state.hidden,
        poster: state.poster,
        tiltDeg: state.tiltDeg,
    });
    const flat = rotateAround(screenX, screenY, frame.tilt, -frame.tilt.deg);
    const seamLeft = frame.seam.x - frame.seam.width / 2;
    const seamRight = frame.seam.x + frame.seam.width / 2;
    if (flat.x > seamLeft && flat.x < seamRight) return null;
    const half = flat.x <= seamLeft ? frame.left : frame.right;
    return { x: (flat.x - half.x) / frame.scale, y: (flat.y - half.y) / frame.scale };
};

/** 视口上一圈加里面一张网的采样点。 */
const screenPoints = () => {
    const points: Array<[number, number]> = [];
    for (let x = 0; x <= view.width; x += view.width / 12) {
        for (let y = 0; y <= view.height; y += view.height / 9) points.push([x, y]);
    }
    return points;
};

const expectScreenCovered = (state: BravaisFrameState, bounds = getVisibleWorldBounds(state)) => {
    expect(bounds).not.toBeNull();
    for (const [x, y] of screenPoints()) {
        const world = worldAt(state, x, y);
        if (!world) continue;
        expect(world.x).toBeGreaterThanOrEqual(bounds!.left - 0.01);
        expect(world.x).toBeLessThanOrEqual(bounds!.right + 0.01);
        expect(world.y).toBeGreaterThanOrEqual(bounds!.top - 0.01);
        expect(world.y).toBeLessThanOrEqual(bounds!.bottom + 0.01);
    }
};

const size = (bounds: { left: number; right: number; top: number; bottom: number }) => ({
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
});

describe('culling a tilted wall', () => {
    const tilts = [-10, -6, 6];
    // 相机离缝多远（世界单位）：缝在屏上、贴边、被拖到好几屏之外（两边）。
    const cameras = [0, 700, -700, 3000, -3000, 9000, -9000];
    const seams = [BRAVAIS_SEAM_FULL_WIDTH, BRAVAIS_SEAM_HOME_WIDTH];

    it('keeps every point on screen inside the visible bounds, wherever the seam has been dragged', () => {
        for (const tiltDeg of tilts) {
            for (const x of cameras) {
                for (const openWidth of seams) {
                    for (const y of [0, 2400]) {
                        expectScreenCovered(stateAt({ tiltDeg, center: { x, y }, openWidth, contentWidth: openWidth }));
                    }
                }
            }
        }
    });

    it('covers the screen without the tilt and with a folded seam too', () => {
        expectScreenCovered(stateAt({ tiltDeg: 0 }));
        expectScreenCovered(stateAt({ openWidth: 0, hidden: true }));
    });

    it('shifts with a far pivot instead of growing: the culled area does not depend on how far the seam is', () => {
        const near = size(getVisibleWorldBounds(stateAt({ center: { x: 300, y: 0 } }))!);
        const flat = size(getVisibleWorldBounds(stateAt({ center: { x: 300, y: 0 }, tiltDeg: 0 }))!);
        for (const x of [3000, -3000, 9000, -9000]) {
            const far = size(getVisibleWorldBounds(stateAt({ center: { x, y: 0 } }))!);
            expect(far.width).toBeCloseTo(near.width, 3);
            expect(far.height).toBeCloseTo(near.height, 3);
        }
        // 倾斜 10° 时只多出转出来的那一圈：宽、高各不到没倾斜时的 1.3 倍。
        expect(near.width).toBeLessThan(flat.width * 1.3);
        expect(near.height).toBeLessThan(flat.height * 1.3);
        // 支点在 9000 之外时范围整块偏开（约 9000 × sin10°），没倾斜的范围根本盖不住屏幕。
        const far = getVisibleWorldBounds(stateAt({ center: { x: 9000, y: 0 } }))!;
        const untilted = getVisibleWorldBounds(stateAt({ center: { x: 9000, y: 0 }, tiltDeg: 0 }))!;
        expect(Math.abs(far.top - untilted.top)).toBeGreaterThan(1000);
    });

    it('answers for another camera position the same as being there (flight destinations, the next drag step)', () => {
        for (const from of [{ x: 0, y: 0 }, { x: 9000, y: -400 }]) {
            const state = stateAt({ center: from });
            for (const target of [{ x: from.x + 60, y: from.y }, { x: from.x - 2500, y: from.y + 1800 }]) {
                const asked = getVisibleWorldBounds(state, target);
                expect(asked).toEqual(getVisibleWorldBounds({ ...state, center: target }));
                // 相机到了那里时，屏幕上每一点都在预留的范围里。
                expectScreenCovered({ ...state, center: target }, asked);
            }
        }
    });

    it('does not ask for a re-cull on every small drag step while the seam is far away', () => {
        // 已裁剪的范围是出发时的可见范围；墙渲染它外扩 overscan。一小步一小步拖，只有攒够一截才重新裁剪。
        const state = stateAt({ center: { x: 9000, y: 0 } });
        let culled = getVisibleWorldBounds(state)!;
        let reculls = 0;
        const step = 20;
        const steps = 60;
        for (let index = 1; index <= steps; index += 1) {
            const center = { x: 9000 - index * step, y: index * step / 2 };
            const visible = getVisibleWorldBounds(state, center)!;
            if (needsRecull(visible, culled)) {
                culled = visible;
                reculls += 1;
            }
            // 每一步屏幕都在「已裁剪范围 + overscan」里（渲染出来的那一片）。
            const rendered = { left: culled.left - BRAVAIS_OVERSCAN, right: culled.right + BRAVAIS_OVERSCAN, top: culled.top - BRAVAIS_OVERSCAN, bottom: culled.bottom + BRAVAIS_OVERSCAN };
            expectScreenCovered({ ...state, center }, rendered);
        }
        const travelled = step * steps;
        expect(reculls).toBeLessThanOrEqual(Math.ceil(travelled / (BRAVAIS_OVERSCAN - BRAVAIS_CULL_EDGE_MARGIN)));
        expect(reculls).toBeGreaterThan(0);
    });
});

describe('culling a tilted wall: wiring', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance'] });
        animateCalls.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    /** 走一帧（裁剪的 setState 合并在下一帧）。 */
    const frame = () => act(() => { vi.advanceTimersByTime(17); });

    /** 挂相机：缝在 9000 世界单位之外（支点走远）、整层 −10°，先裁剪一次。 */
    const mountCamera = () => {
        const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ center: { x: 9000, y: 0 } }) };
        const fieldRef = { current: document.createElement('div') };
        const seen: Bounds[] = [];
        const handle: { camera: ReturnType<typeof useBravaisCamera> | null } = { camera: null };
        const Probe = () => {
            const camera = useBravaisCamera({ frameRef, renderFrame: () => undefined, fieldRef, reducedMotion: false });
            handle.camera = camera;
            if (camera.bounds && seen[seen.length - 1] !== camera.bounds) seen.push(camera.bounds);
            return null;
        };
        act(() => root.render(createElement(Probe)));
        act(() => handle.camera!.moveTo(frameRef.current.center, true));
        frame();
        expect(seen).toHaveLength(1);
        return { frameRef, fieldRef, seen, camera: () => handle.camera! };
    };

    it('reserves the tilted view at the destination when the camera flies', () => {
        const { frameRef, camera } = mountCamera();
        for (const target of [{ x: 9000 - 700, y: 0 }, { x: 9000 + 6000, y: 2500 }]) {
            act(() => camera().tweenTo(target));
            // 补间还没走（animate 是替身）：此刻已裁剪的范围里已经有相机到了那里时屏幕上的每一点。
            expectScreenCovered({ ...frameRef.current, center: target }, camera().bounds);
        }
    });

    it('does not re-cull on every pointer move while dragging with the seam far away', () => {
        const { fieldRef, seen, camera } = mountCamera();
        const event = (x: number, time: number) => ({
            button: 0,
            isPrimary: true,
            pointerId: 1,
            clientX: x,
            clientY: 400,
            timeStamp: time,
            target: fieldRef.current,
            currentTarget: { setPointerCapture: () => undefined, hasPointerCapture: () => false, releasePointerCapture: () => undefined },
        }) as unknown as PointerEvent<HTMLDivElement>;
        act(() => camera().pointer.onPointerDown(event(800, 0)));
        // 30 步、每步 4px：一共 120px（约 158 世界单位），不到「快到边缘」的那一截（overscan − 边距 = 260）。
        for (let step = 1; step <= 30; step += 1) {
            act(() => camera().pointer.onPointerMove(event(800 - step * 4, step * 16)));
            frame();
        }
        expect(seen).toHaveLength(1);
        // 再拖远（一共 800px）才重新裁剪，次数按走过的距离算，不是按帧算。
        for (let step = 31; step <= 200; step += 1) {
            act(() => camera().pointer.onPointerMove(event(800 - step * 4, step * 16)));
            frame();
        }
        expect(seen.length).toBeGreaterThan(1);
        expect(seen.length).toBeLessThanOrEqual(1 + Math.ceil((800 / view.scale) / (BRAVAIS_OVERSCAN - BRAVAIS_CULL_EDGE_MARGIN)));
    });

    it('checks the cull while the tilt turns, and culls once more when it lands', () => {
        const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ tiltDeg: 0, tiltTargetDeg: 0 }) };
        const renderFrame = vi.fn();
        const checkCull = vi.fn();
        const Probe = ({ deg }: { deg: number }) => {
            useBravaisTilt({ frameRef, renderFrame, checkCull, deg, reducedMotion: false });
            return null;
        };
        act(() => root.render(createElement(Probe, { deg: 0 })));
        expect(animateCalls).toHaveLength(0);
        act(() => root.render(createElement(Probe, { deg: -10 })));
        expect(animateCalls).toHaveLength(1);
        const turn = animateCalls[0]!;
        expect([turn.from, turn.to]).toEqual([0, -10]);
        // 一开始转就记下要转到的角度（让位、缝的出血与内容缩进按它给），补间中缝交给合成器转。
        expect(frameRef.current.tiltTargetDeg).toBe(-10);
        expect(frameRef.current.tiltSettled).toBe(false);
        turn.options.onUpdate?.(-4);
        expect(frameRef.current.tiltDeg).toBe(-4);
        expect(renderFrame).toHaveBeenCalledTimes(1);
        // 途中只问「快到边缘了吗」，不强制裁剪。
        expect(checkCull.mock.calls).toEqual([[]]);
        turn.options.onUpdate?.(-10);
        turn.options.onComplete?.();
        expect(frameRef.current.tiltSettled).toBe(true);
        expect(checkCull.mock.calls[checkCull.mock.calls.length - 1]).toEqual([true]);
    });
});
