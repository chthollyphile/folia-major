import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type PointerEvent } from 'react';
import { renderToString } from 'react-dom/server';
import { animate } from 'framer-motion';
import { useBravaisCamera } from '@/library/suites/bravais/useBravaisCamera';
import type { BravaisFrameState } from '@/library/suites/bravais/useBravaisFrame';
import type { useWallPointerPan } from '@/components/wall/useWallPointerPan';

// 在真实相机 hook 上核对输入目标与显示中心的分工；只替换输入事件注册和 Framer 补间执行器。

const input = vi.hoisted(() => ({ options: null as unknown }));
vi.mock('framer-motion', () => ({ animate: vi.fn(() => ({ stop: vi.fn() })) }));
vi.mock('@/components/wall/useWallPointerPan', () => ({
    useWallPointerPan: (options: Parameters<typeof useWallPointerPan>[0]) => {
        input.options = options;
        return {
            didDragRef: { current: false },
            onPointerDown: () => options.stopPan(),
            onPointerMove: vi.fn(),
            onPointerUp: vi.fn(),
            onPointerCancel: () => options.stopPan(),
            onClickCapture: vi.fn(),
        };
    },
}));

let now = 0;
let handle = 0;
let frames: Map<number, FrameRequestCallback>;
const frame = (dt = 8) => {
    now += dt;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
};

const mount = (reducedMotion = false) => {
    const frameRef = { current: {
        view: { width: 1000, height: 800, scale: 0.5 },
        center: { x: 0, y: 0 }, anchorX: null, anchorY: null,
        openWidth: 0, targetOpenWidth: 0, contentWidth: 0, hidden: false, poster: false, tiltDeg: 0,
    } as BravaisFrameState };
    const renderFrame = vi.fn();
    let camera!: ReturnType<typeof useBravaisCamera>;
    const Probe = () => {
        camera = useBravaisCamera({ frameRef, renderFrame, fieldRef: { current: null }, reducedMotion });
        return null;
    };
    renderToString(createElement(Probe));
    camera.moveTo({ x: 0, y: 0 });
    frame(0);
    renderFrame.mockClear();
    return { camera, frameRef, renderFrame, input: input.options as Parameters<typeof useWallPointerPan>[0] };
};

beforeEach(() => {
    now = 0;
    handle = 0;
    frames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++handle, callback); return handle; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.mocked(animate).mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Bravais camera drag integration', () => {
    it('keeps the input target ahead of the displayed centre while frames interpolate', () => {
        const h = mount();
        h.input.applyCamera({ x: 600, y: 400, scale: 0.5 }, false, 'pointer');
        expect(h.renderFrame).not.toHaveBeenCalled();
        expect(h.frameRef.current.center.x).toBe(0);
        expect(h.input.cameraRef.current.x).toBe(600);
        frame();
        expect(h.frameRef.current.center.x).toBeLessThan(0);
        expect(h.frameRef.current.center.x).toBeGreaterThan(-200);
        expect(h.input.cameraRef.current.x).toBe(600);
        expect(h.renderFrame).toHaveBeenCalledTimes(1);
    });

    it('stops at the displayed position, so a new gesture starts from what is visible', () => {
        const h = mount();
        h.input.applyCamera({ x: 600, y: 400, scale: 0.5 }, false, 'pointer');
        frame();
        const shown = h.frameRef.current.center.x;
        h.input.stopPan();
        expect(h.input.cameraRef.current.x).toBeCloseTo(500 - shown * 0.5);
        frame();
        expect(h.frameRef.current.center.x).toBe(shown);
    });

    it('applies trackpad input immediately after stopping a drag, without a stale tail', () => {
        const h = mount();
        h.input.applyCamera({ x: 600, y: 400, scale: 0.5 }, false, 'pointer');
        frame();
        h.input.stopPan();
        const next = { ...h.input.cameraRef.current, x: h.input.cameraRef.current.x - 12 };
        h.input.applyCamera(next);
        const shown = h.frameRef.current.center.x;
        expect(shown).toBeCloseTo((500 - next.x) / 0.5);
        frame(100);
        expect(h.frameRef.current.center.x).toBe(shown);
    });

    it('lets a programmatic jump supersede pending drag frames', () => {
        const h = mount();
        h.input.applyCamera({ x: 600, y: 400, scale: 0.5 }, false, 'pointer');
        h.camera.moveTo({ x: 20, y: 30 }, true);
        frame();
        expect(h.frameRef.current.center).toEqual({ x: 20, y: 30 });
    });

    it('keeps reduced-motion dragging immediate', () => {
        const h = mount(true);
        h.input.applyCamera({ x: 600, y: 400, scale: 0.5 }, false, 'pointer');
        expect(h.frameRef.current.center).toEqual({ x: -200, y: 0 });
        expect(h.renderFrame).toHaveBeenCalledTimes(1);
    });

    it('settles an out-of-range target even when release happens before its first frame', () => {
        const h = mount();
        h.camera.setRange({ minX: -10, maxX: 10, minY: -10, maxY: 10, lockedX: false, lockedY: false });
        h.camera.pointer.onPointerDown({} as PointerEvent<HTMLDivElement>);
        h.input.applyCamera({ x: 700, y: 400, scale: 0.5 }, false, 'pointer');
        expect(h.frameRef.current.center.x).toBe(0);
        h.camera.pointer.onPointerUp({} as PointerEvent<HTMLDivElement>);
        expect(animate).toHaveBeenCalledTimes(1);
        const options = vi.mocked(animate).mock.calls[0]![2] as { onUpdate: (progress: number) => void };
        options.onUpdate(1);
        frame();
        expect(h.frameRef.current.center.x).toBe(-10);
    });
});
