// @vitest-environment jsdom
import { act, createElement, type MutableRefObject, type PointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bounds } from '@/components/wall/layout';
import {
    BRAVAIS_CULL_EDGE_MARGIN,
    BRAVAIS_OVERSCAN,
    BRAVAIS_SEAM_FULL_WIDTH,
    BRAVAIS_SEAM_HOME_WIDTH,
    BRAVAIS_SEAM_TWEEN_S,
    BRAVAIS_TILT_OUT_S,
} from '@/library/suites/bravais/bravaisConstants';
import { computeBravaisFrame, reanchorLift, rotateAround, tiltEdgeRoom } from '@/library/suites/bravais/bravaisFrame';
import { SEAM_EDGE_MARGIN } from '@/components/wall/seamPlan';
import { getViewLineX } from '@/components/wall/wallView';
import { filterOnScreenSlots, getFlipRanges, getVisibleWorldBounds, needsRecull, useBravaisCamera } from '@/library/suites/bravais/useBravaisCamera';
import { handoffCloseWaitMs } from '@/library/suites/bravais/useBravaisWallHandoff';
import type { BravaisFrameState } from '@/library/suites/bravais/useBravaisFrame';
import { useBravaisFrame } from '@/library/suites/bravais/useBravaisFrame';
import { columnAnchor } from '@/library/suites/bravais/bravaisAnchor';
import { BRAVAIS_BLOCK_SHAPE } from '@/library/suites/bravais/bravaisWallShape';
import { useBravaisSeam } from '@/library/suites/bravais/useBravaisSeam';
import { useBravaisTilt } from '@/library/suites/bravais/useBravaisTilt';

// test/unit/library/bravais/bravaisTiltCull.test.ts
// 整层倾斜着时的裁剪（首页、集合页给了倾斜角时与海报同一条路）：屏幕上每一点对应的世界点都在可见范围里（墙没有空着的
// 角）；缝被拖到几屏之外、支点走远时范围整块跟着挪而不是越变越大；按「相机到了别处」问到的范围（补间的目的地、拖动的
// 下一步）同样按倾斜算——不然飞行途中墙是空的、拖动时每一帧都重新裁剪。
// 后半（「wiring」）挂真的 useBravaisCamera / useBravaisTilt：钉住相机补间、拖动与倾斜补间确实走了按倾斜算的那条路
// （framer 的 animate 换成记下参数的替身，补间不真的跑）。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type AnimateOptions = { duration?: number; onUpdate?: (value: number) => void; onComplete?: () => void };
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
    seamFollowsTilt: false,
    tiltSettled: true,
    tiltLiftY: 0,
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
        liftY: state.tiltLiftY,
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

    it('follows the wall while it is held back after a re-anchor', () => {
        // 倾斜着换锚点时两半墙垫了一截（tiltLiftY，屏幕 px）：看到的世界范围跟着挪，屏幕仍然盖得住。
        for (const tiltLiftY of [-180, 240]) {
            const state = stateAt({ center: { x: 400, y: 0 }, tiltLiftY });
            expectScreenCovered(state);
            const held = getVisibleWorldBounds(state)!;
            const settled = getVisibleWorldBounds(stateAt({ center: { x: 400, y: 0 } }))!;
            expect(held.top - settled.top).toBeCloseTo(-tiltLiftY / view.scale);
            expect(held.bottom - settled.bottom).toBeCloseTo(-tiltLiftY / view.scale);
        }
    });

    it('can leave the seam widening out and add an overscan (flip ranges, the first arrow key)', () => {
        const state = stateAt({ center: { x: 9000, y: 0 } });
        const full = getVisibleWorldBounds(state)!;
        const plain = getVisibleWorldBounds(state, undefined, { seam: false })!;
        const wide = getVisibleWorldBounds(state, undefined, { overscan: 300 })!;
        // 不按缝放宽：左右各少一个开口宽，上下不变；仍然是倾斜后的范围（与没倾斜的差着近千）。
        expect(plain.left - full.left).toBeCloseTo(BRAVAIS_SEAM_FULL_WIDTH / view.scale);
        expect(full.right - plain.right).toBeCloseTo(BRAVAIS_SEAM_FULL_WIDTH / view.scale);
        expect(plain.top).toBeCloseTo(full.top);
        expect(Math.abs(plain.top - getVisibleWorldBounds(stateAt({ center: { x: 9000, y: 0 }, tiltDeg: 0 }), undefined, { seam: false })!.top)).toBeGreaterThan(1000);
        for (const side of ['left', 'top'] as const) expect(full[side] - wide[side]).toBeCloseTo(300);
        for (const side of ['right', 'bottom'] as const) expect(wide[side] - full[side]).toBeCloseTo(300);
    });

    it('gives the flip, wave and entrance ranges on the tilted view', () => {
        // 缝在 9000 之外：倾斜的视口整块偏开近千，翻牌的范围得跟着走（按没倾斜的算，屏上的磁贴会被当成屏外的硬切）。
        const state = stateAt({ center: { x: 9000, y: 0 } });
        const ranges = getFlipRanges(state, 160)!;
        expectScreenCovered(state, ranges.visible);
        expect(ranges.viewport).toEqual(getVisibleWorldBounds(state, undefined, { seam: false }));
        expect(ranges.visible).toEqual(getVisibleWorldBounds(state, undefined, { overscan: 160 }));
        const flat = getFlipRanges({ ...state, tiltDeg: 0 }, 160)!;
        expect(Math.abs(ranges.viewport.top - flat.viewport.top)).toBeGreaterThan(1000);
        expect(getFlipRanges(stateAt({ view: null }), 160)).toBeNull();
    });

    it('finds the slots on the tilted screen for the first arrow key', () => {
        const state = stateAt({ center: { x: 9000, y: 0 } });
        // 屏幕正中画着的世界点周围放一个 slot（在屏上），再在「没倾斜时的屏幕正中」放一个（倾斜后早就不在屏上了）。
        const middle = worldAt(state, view.width / 2, view.height / 2)!;
        const onScreen = { key: 'on', x: middle.x - 50, y: middle.y - 50, width: 100, height: 100 };
        const flatMiddle = worldAt({ ...state, tiltDeg: 0 }, view.width / 2, view.height / 2)!;
        const offScreen = { key: 'off', x: flatMiddle.x - 50, y: flatMiddle.y - 50, width: 100, height: 100 };
        expect(Math.abs(flatMiddle.y - middle.y)).toBeGreaterThan(1000);
        expect(filterOnScreenSlots(state, [onScreen, offScreen]).map(slot => slot.key)).toEqual(['on']);
        expect(filterOnScreenSlots({ ...state, tiltDeg: 0 }, [onScreen, offScreen]).map(slot => slot.key)).toEqual(['off']);
        expect(filterOnScreenSlots(stateAt({ view: null }), [onScreen])).toEqual([]);
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
            useBravaisTilt({ frameRef, renderFrame, checkCull, deg, seamFollowsTilt: false, reducedMotion: false });
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
        const before = renderFrame.mock.calls.length;
        turn.options.onUpdate?.(-4);
        expect(frameRef.current.tiltDeg).toBe(-4);
        expect(renderFrame).toHaveBeenCalledTimes(before + 1);
        // 途中只问「快到边缘了吗」，不强制裁剪。
        expect(checkCull.mock.calls).toEqual([[]]);
        turn.options.onUpdate?.(-10);
        turn.options.onComplete?.();
        expect(frameRef.current.tiltSettled).toBe(true);
        expect(checkCull.mock.calls[checkCull.mock.calls.length - 1]).toEqual([true]);
    });
});

describe('straightening and re-anchoring a tilted wall: wiring', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        animateCalls.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('straightens in step with the seam closing for a handoff, at its own pace otherwise', () => {
        const durations = (quickOut: boolean) => {
            animateCalls.length = 0;
            const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ tiltDeg: -4, tiltTargetDeg: -4 }) };
            const Probe = ({ deg }: { deg: number }) => {
                useBravaisTilt({ frameRef, renderFrame: () => undefined, checkCull: () => undefined, deg, seamFollowsTilt: false, quickOut: deg === 0 && quickOut, reducedMotion: false });
                return null;
            };
            act(() => root.render(createElement(Probe, { deg: -4 })));
            act(() => root.render(createElement(Probe, { deg: 0 })));
            return animateCalls.map(call => call.options.duration);
        };
        expect(durations(false)).toEqual([BRAVAIS_TILT_OUT_S]);
        expect(durations(true)).toEqual([BRAVAIS_SEAM_TWEEN_S]);
        expect(BRAVAIS_SEAM_TWEEN_S).toBeLessThan(BRAVAIS_TILT_OUT_S);
    });

    /** 挂真的缝（没有层：只用它换锚点、排开口）。 */
    const mountSeam = (frameRef: MutableRefObject<BravaisFrameState>, checkCull: (force?: boolean) => void = () => undefined) => {
        const handle: { seam: ReturnType<typeof useBravaisSeam> | null } = { seam: null };
        const contentRef = { current: document.createElement('div') };
        const Probe = () => {
            handle.seam = useBravaisSeam({
                frameRef,
                renderFrame: () => undefined,
                layer: null,
                target: { width: 0, variant: 'none', axis: null },
                viewportWidth: view.width,
                contentRef,
                reducedMotion: false,
                reducedTransitions: false,
                tweenCamera: () => undefined,
                checkCull,
                getShape: () => BRAVAIS_BLOCK_SHAPE,
                tiltFor: () => 0,
            });
            return null;
        };
        act(() => root.render(createElement(Probe)));
        return () => handle.seam!;
    };
    /** 换锚点（连同同一轮同步代码里紧跟着做的事），再让微任务跑完——垫多少是那时量的。 */
    const reanchor = (run: () => void) => act(async () => { run(); });

    it('holds the wall in place when the anchor jumps under a tilt, then lets it slide', async () => {
        // 缝在 3000 世界单位外（收起了），整层 −4°；换到视口里的一条块边界上。
        const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ anchorX: null, center: { x: 0, y: 0 }, openWidth: 0, tiltDeg: -4, tiltTargetDeg: -4 }) };
        const checkCull = vi.fn();
        const seam = mountSeam(frameRef, checkCull);
        // 第一次给锚点：之前没有缝，不用垫。
        await reanchor(() => seam().setAnchor(columnAnchor(3000)));
        expect(frameRef.current.tiltLiftY).toBe(0);
        expect(animateCalls).toHaveLength(0);
        const expected = reanchorLift({ ...frameRef.current, view }, 0);
        expect(Math.abs(expected)).toBeGreaterThan(100);
        await reanchor(() => seam().setAnchor(columnAnchor(0)));
        expect(frameRef.current.anchorX).toBe(0);
        expect(frameRef.current.tiltLiftY).toBeCloseTo(expected);
        // 垫上的那一截补间回 0，途中补裁剪，落定时再裁剪一次。
        expect(animateCalls).toHaveLength(1);
        const slide = animateCalls[0]!;
        expect(slide.from).toBeCloseTo(expected);
        expect(slide.to).toBe(0);
        slide.options.onUpdate?.(expected / 2);
        expect(frameRef.current.tiltLiftY).toBeCloseTo(expected / 2);
        expect(checkCull).toHaveBeenLastCalledWith();
        slide.options.onUpdate?.(0);
        slide.options.onComplete?.();
        expect(frameRef.current.tiltLiftY).toBe(0);
        expect(checkCull).toHaveBeenLastCalledWith(true);
    });

    it('holds nothing when the camera jumps along with the anchor (the seam stays put on screen)', async () => {
        // 换形状时锚点吸到新形状的块边界、相机瞬移同样的距离：缝在屏幕上没动，支点没动，墙不用垫。
        const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ anchorX: 600, center: { x: 400, y: 0 }, openWidth: 0, tiltDeg: -4, tiltTargetDeg: -4 }) };
        const seam = mountSeam(frameRef);
        await reanchor(() => {
            seam().setAnchor(columnAnchor(1220));
            frameRef.current.center = { x: 400 + 620, y: 0 };
        });
        expect(frameRef.current.anchorX).toBe(1220);
        expect(frameRef.current.tiltLiftY).toBe(0);
        expect(animateCalls).toHaveLength(0);
    });

    it('does not hold anything when the wall is not tilted', async () => {
        const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ anchorX: 3000, center: { x: 0, y: 0 }, openWidth: 0, tiltDeg: 0, tiltTargetDeg: 0 }) };
        const seam = mountSeam(frameRef);
        await reanchor(() => seam().setAnchor(columnAnchor(0)));
        expect(frameRef.current.anchorX).toBe(0);
        expect(frameRef.current.tiltLiftY).toBe(0);
        expect(animateCalls).toHaveLength(0);
    });

    it('plans a tilted strip further from the viewport edge, unless the viewport is too narrow for that', () => {
        const frameRef: MutableRefObject<BravaisFrameState> = { current: stateAt({ anchorX: null, center: { x: 0, y: 0 }, openWidth: 0, tiltDeg: 0, tiltTargetDeg: 0 }) };
        const seam = mountSeam(frameRef);
        const width = BRAVAIS_SEAM_FULL_WIDTH;
        // 想沿用的锚点画在屏幕 x = 60：离左边太近，相机得让位。
        const prefer = columnAnchor((60 - getViewLineX(view)) / view.scale);
        const leftEdgeOf = (tiltDeg: number, state = frameRef.current) => {
            const plan = seam().planOpening({ x: 0, y: 0 }, width, prefer, false, BRAVAIS_BLOCK_SHAPE, 'x', tiltDeg);
            return getViewLineX(state.view!) + (plan.anchor.x! - plan.center.x) * state.view!.scale - width / 2;
        };
        expect(leftEdgeOf(0)).toBeCloseTo(SEAM_EDGE_MARGIN);
        expect(leftEdgeOf(-4)).toBeCloseTo(SEAM_EDGE_MARGIN + tiltEdgeRoom(view.height, -4));
        // 视口窄到放不下「开口 + 两边都多留」：不多留，与不倾斜时一样排。
        const narrow = { width: width + 2 * SEAM_EDGE_MARGIN + 20, height: view.height, scale: view.scale };
        frameRef.current.view = narrow;
        const flatLeft = leftEdgeOf(0);
        expect(leftEdgeOf(-4)).toBeCloseTo(flatLeft);
    });

    it('waits for the wall to straighten before a handoff measures the tiles', () => {
        const seamMs = BRAVAIS_SEAM_TWEEN_S * 1000;
        // 没倾斜：只等缝合上（与改动前一样）；倾斜着：回正与缝合上同一个时长，再多等不到三帧。
        expect(handoffCloseWaitMs({ openWidth: 300, tiltDeg: 0, seeThrough: false, reducedMotion: false })).toBe(seamMs);
        const tilted = handoffCloseWaitMs({ openWidth: 300, tiltDeg: -4, seeThrough: false, reducedMotion: false });
        expect(tilted).toBeGreaterThan(seamMs);
        expect(tilted).toBeLessThanOrEqual(seamMs + 50);
        expect(handoffCloseWaitMs({ openWidth: 300, tiltDeg: -10, seeThrough: false, reducedMotion: false })).toBe(tilted);
        // 缝已经合上、也没倾斜：不等；降低动态效果：都不等。
        expect(handoffCloseWaitMs({ openWidth: 0, tiltDeg: 0, seeThrough: false, reducedMotion: false })).toBe(0);
        expect(handoffCloseWaitMs({ openWidth: 300, tiltDeg: -4, seeThrough: true, reducedMotion: true })).toBe(0);
    });
});

describe('dressing a tilted seam', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        animateCalls.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    /** 挂真的帧与倾斜：缝与内容层是两个真节点，读写它们身上的属性与变量。 */
    const mount = () => {
        const seam = document.createElement('div');
        const content = document.createElement('div');
        const node = <T extends HTMLElement>(current: T | null = null) => ({ current });
        const refs = {
            left: node<HTMLDivElement>(), right: node<HTMLDivElement>(), seam: node(seam), seamTrack: node<HTMLDivElement>(),
            seamContent: node(content), tab: node<HTMLButtonElement>(), hint: node<HTMLDivElement>(),
        };
        const handle: { frame: ReturnType<typeof useBravaisFrame> | null } = { frame: null };
        const Probe = ({ deg, follows }: { deg: number; follows: boolean }) => {
            const frame = useBravaisFrame(refs);
            handle.frame = frame;
            // 第一次渲染就把视口与缝放进帧状态（stage 在量到视口后写）。
            if (!frame.stateRef.current.view) Object.assign(frame.stateRef.current, stateAt({ tiltDeg: 0, tiltTargetDeg: 0 }));
            useBravaisTilt({ frameRef: frame.stateRef, renderFrame: frame.renderFrame, checkCull: () => undefined, deg, seamFollowsTilt: follows, reducedMotion: false });
            return null;
        };
        const render = (deg: number, follows: boolean) => act(() => root.render(createElement(Probe, { deg, follows })));
        const dressed = () => ({
            tilted: seam.dataset.bravaisSeamTilted !== undefined,
            bottom: parseFloat(content.style.getPropertyValue('--bravais-seam-tilt-bottom')),
        });
        /** 最近一次起的倾斜补间走到 value（落定时连 onComplete 一起）。 */
        const turnTo = (value: number, land = false) => {
            const turn = animateCalls[animateCalls.length - 1]!;
            turn.options.onUpdate?.(value);
            if (land) turn.options.onComplete?.();
        };
        return { render, dressed, turnTo };
    };

    it('lets the strip content follow the turn, in whole pixels, and keeps the bleed until the wall is upright again', () => {
        // 歌单页的信息条（跟着倾斜的内容）：转过去时内容顺着缩进，落定后不再变。
        const { render, dressed, turnTo } = mount();
        render(0, true);
        expect(dressed()).toEqual({ tilted: false, bottom: 0 });
        render(-4, true);
        // 还没开始转（延迟、缓入起点）：没有出血、不缩进——内容不在转之前先跳一下。
        expect(dressed()).toEqual({ tilted: false, bottom: 0 });
        turnTo(-2);
        const half = dressed();
        expect(half.tilted).toBe(true);
        expect(half.bottom).toBeGreaterThan(5);
        turnTo(-4, true);
        const landed = dressed();
        expect(landed.tilted).toBe(true);
        expect(landed.bottom).toBeGreaterThan(half.bottom);
        expect(Number.isInteger(landed.bottom)).toBe(true);
        // 过滤生效、进 Lattice（目标回到 0，画着的还是这条信息条）：回正途中出血还在、内容顺着放回去，到 0 才撤掉。
        render(0, true);
        expect(dressed()).toEqual(landed);
        turnTo(-2);
        expect(dressed()).toEqual(half);
        turnTo(0, true);
        expect(dressed()).toEqual({ tilted: false, bottom: 0 });
    });

    it('leaves panels, forms and the content flipping away to a poster without the inset, but still bleeds while tilted', () => {
        const { render, dressed, turnTo } = mount();
        // 首页（不倾斜）翻到海报：目标 −10°，缝里画着的还是首页的内容。翻出的那 160ms 里角度几乎还是 0，内容不动。
        render(0, true);
        render(-10, true);
        turnTo(-0.2);
        expect(dressed().bottom).toBeLessThanOrEqual(1);
        // 换成不跟着倾斜的内容（面板、表单、搜索框；海报的样式不读这个变量）：不缩进；整层还倾斜着，出血照旧。
        render(-10, false);
        turnTo(-10, true);
        expect(dressed()).toEqual({ tilted: true, bottom: 0 });
        // 面板开着回正：途中出血还在（纸条两头不露楔形），内容始终不缩进。
        render(0, false);
        turnTo(-5);
        expect(dressed()).toEqual({ tilted: true, bottom: 0 });
        turnTo(0, true);
        expect(dressed()).toEqual({ tilted: false, bottom: 0 });
    });
});
