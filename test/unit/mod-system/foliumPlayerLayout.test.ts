// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayerOverlayLayout } from '@/services/playerOverlayLayout';
import { freezePlayerLayout, samePlayerLayout } from '@/utils/playerOverlayGeometry';

// test/unit/mod-system/foliumPlayerLayout.test.ts
// Verify the shared measurement channel without observing or querying arbitrary native DOM.

const bounds = { left: 0, top: 0, width: 1000, height: 600 };
const resizeCallbacks: (() => void)[] = [];
const disconnect = vi.fn();
beforeEach(() => {
    vi.useFakeTimers();
    resizeCallbacks.length = 0;
    disconnect.mockClear();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { resizeCallbacks.push(callback); }
        observe() {}
        disconnect = disconnect;
    });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const elementAt = (rect = bounds) => {
    const element = document.createElement('div');
    document.body.append(element);
    const read = vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(rect.left, rect.top, rect.width, rect.height));
    return { element, read };
};

describe('player layout snapshots', () => {
    it('merges duplicate native keys without exposing their internal identities', () => {
        const value = freezePlayerLayout(bounds, [10, 50].map(left => ({
            key: 'status-toast', role: 'notification', kind: 'control', rect: { left, top: 30, width: 100, height: 40 },
        })));
        expect(value.obstacles).toHaveLength(1);
        expect(value.obstacles[0]).toEqual({ role: 'notification', kind: 'control', rect: { left: 10, top: 30, width: 140, height: 40 } });
    });
    it('keeps distinct native regions with the same role separate', () => {
        const value = freezePlayerLayout(bounds, [
            { key: 'panel', role: 'panel', kind: 'control', rect: { left: 700, top: 200, width: 280, height: 300 } },
            { key: 'toggle', role: 'panel', kind: 'control', rect: { left: 940, top: 530, width: 40, height: 40 } },
            { key: 'reveal', role: 'panel', kind: 'reveal-area', rect: { left: 880, top: 480, width: 120, height: 120 } },
        ]);
        expect(value.obstacles).toHaveLength(3);
        expect(value.obstacles.map(item => item.rect)).toEqual(expect.arrayContaining([
            { left: 700, top: 200, width: 280, height: 300 },
            { left: 940, top: 530, width: 40, height: 40 },
            { left: 880, top: 480, width: 120, height: 120 },
        ]));
        value.obstacles.forEach(item => expect(Object.keys(item).sort()).toEqual(['kind', 'rect', 'role']));
    });
    it('publishes frozen safe insets separately from partial edge obstacles', () => {
        const obstacles = [{ key: 'back', role: 'navigation', kind: 'reveal-area' as const,
            rect: { left: 0, top: 0, width: 120, height: 120 } }];
        const native = freezePlayerLayout(bounds, obstacles);
        const customChrome = freezePlayerLayout(bounds, obstacles, { top: 56, right: 0, bottom: 0, left: 0 });
        expect(native.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(customChrome.insets).toEqual({ top: 56, right: 0, bottom: 0, left: 0 });
        expect(Object.isFrozen(customChrome.insets)).toBe(true);
        expect(samePlayerLayout(native, customChrome)).toBe(false);
        expect(samePlayerLayout(customChrome, freezePlayerLayout(bounds, obstacles, customChrome.insets))).toBe(true);
    });
    it('normalizes invalid safe insets and clips them to the viewport dimensions', () => {
        expect(freezePlayerLayout(bounds, [], { top: -10, right: Infinity, bottom: 1000, left: 2000 }).insets)
            .toEqual({ top: 0, right: 0, bottom: 600, left: 1000 });
        expect(freezePlayerLayout(bounds, [], { top: 500, right: 900, bottom: 500, left: 900 }).insets)
            .toEqual({ top: 500, right: 100, bottom: 100, left: 900 });
    });
    it('projects DOMRect properties explicitly and deeply freezes the result', () => {
        const value = freezePlayerLayout(new DOMRect(20, 30, 400, 250), [{
            key: 'control', role: 'playback', kind: 'control', rect: { left: 0, top: 0, width: 70, height: 90 },
        }]);
        expect(value.bounds).toEqual({ left: 20, top: 30, width: 400, height: 250 });
        expect(value.obstacles[0].rect).toEqual({ left: 20, top: 30, width: 50, height: 60 });
        expect([value, value.bounds, value.insets, value.obstacles, value.obstacles[0], value.obstacles[0].rect].every(Object.isFrozen)).toBe(true);
    });
    it('drops invalid, outside and zero-area obstacles', () => {
        const value = freezePlayerLayout(bounds, [NaN, 1100, 0].map((left, index) => ({
            key: String(index), role: 'panel', kind: 'control', rect: { left, top: 20, width: index === 2 ? 0 : 20, height: 20 },
        })));
        expect(value.obstacles).toEqual([]);
    });
    it('returns null without a live player root and immediately after it is removed', () => {
        const layout = createPlayerOverlayLayout();
        expect(layout.source.get()).toBeNull();
        const root = elementAt();
        const offRoot = layout.registerRoot(root.element);
        expect(layout.source.get()).toBeNull();
        expect(root.read).not.toHaveBeenCalled();
        const off = layout.source.subscribe(() => {});
        vi.advanceTimersByTime(80);
        expect(layout.source.get()?.bounds).toEqual(bounds);
        offRoot();
        expect(layout.source.get()).toBeNull();
        off();
    });
    it('does not reuse a prior player root snapshot while a new root is awaiting measurement', () => {
        const layout = createPlayerOverlayLayout();
        const offRoot = layout.registerRoot(elementAt().element);
        const listener = vi.fn();
        const off = layout.source.subscribe(listener);
        vi.advanceTimersByTime(80);
        const initial = layout.source.get();
        listener.mockClear();
        offRoot();
        layout.registerRoot(elementAt().element);
        expect(layout.source.get()).toBeNull();
        vi.advanceTimersByTime(80);
        expect(layout.source.get()).toEqual(initial);
        expect(layout.source.get()).not.toBe(initial);
        expect(listener).toHaveBeenCalledTimes(1);
        off();
    });
    it('keeps the same snapshot when measurements are unchanged', () => {
        const layout = createPlayerOverlayLayout();
        layout.registerRoot(elementAt().element);
        const listener = vi.fn();
        const off = layout.source.subscribe(listener);
        vi.advanceTimersByTime(80);
        const value = layout.source.get();
        listener.mockClear();
        for (let i = 0; i < 10; i++) layout.invalidate();
        vi.advanceTimersByTime(80);
        expect(layout.source.get()).toBe(value);
        expect(listener).not.toHaveBeenCalled();
        off();
    });
    it('coalesces animation updates for all subscribers and stays idle afterward', () => {
        const layout = createPlayerOverlayLayout();
        const root = elementAt();
        layout.registerRoot(root.element);
        const listeners = [vi.fn(), vi.fn()];
        const offs = listeners.map(layout.source.subscribe);
        vi.advanceTimersByTime(80);
        listeners.forEach(listener => listener.mockClear());
        expect(resizeCallbacks).toHaveLength(1);
        root.read.mockClear();
        let top = 500;
        layout.register(null, () => ({ key: 'bar', role: 'playback', kind: 'control', rect: { left: 50, top, width: 100, height: 50 } }));
        for (let i = 0; i < 120; i++) { top--; layout.invalidate(); }
        expect(root.read).not.toHaveBeenCalled();
        vi.advanceTimersByTime(80);
        expect(root.read).toHaveBeenCalledTimes(1);
        listeners.forEach(listener => expect(listener).toHaveBeenCalledTimes(1));
        vi.advanceTimersByTime(60_000);
        expect(root.read).toHaveBeenCalledTimes(1);
        offs.forEach(off => off());
    });
    it('a getter while an update is queued does not consume another subscriber notification', () => {
        const layout = createPlayerOverlayLayout();
        layout.registerRoot(elementAt().element);
        const listener = vi.fn();
        const off = layout.source.subscribe(listener);
        vi.advanceTimersByTime(80);
        const before = layout.source.get();
        listener.mockClear();
        layout.register(null, () => ({ key: 'back-reveal', role: 'navigation', kind: 'reveal-area', rect: { ...bounds, width: 120, height: 120 } }));
        expect(layout.source.get()).toBe(before);
        vi.advanceTimersByTime(80);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(layout.source.get()?.obstacles[0].kind).toBe('reveal-area');
        off();
    });
    it('cleans timers and observers when the last subscription ends, and reconnects later', () => {
        const layout = createPlayerOverlayLayout();
        layout.registerRoot(elementAt().element);
        const off = layout.source.subscribe(() => {});
        const before = disconnect.mock.calls.length;
        off(); off();
        expect(disconnect.mock.calls.length).toBe(before + 1);
        expect(vi.getTimerCount()).toBe(0);
        expect(layout.source.get()).toBeNull();
        const offAgain = layout.source.subscribe(() => {});
        expect(resizeCallbacks).toHaveLength(2);
        offAgain();
    });
    it('unregisters native obstacles without removing independent reveal regions', () => {
        const layout = createPlayerOverlayLayout();
        layout.registerRoot(elementAt().element);
        layout.register(null, () => ({ key: 'back-reveal', role: 'navigation', kind: 'reveal-area', rect: { ...bounds, width: 120, height: 120 } }));
        const offControl = layout.register(null, () => ({ key: 'back', role: 'navigation', kind: 'control', rect: { left: 24, top: 24, width: 40, height: 40 } }));
        const off = layout.source.subscribe(() => {});
        vi.advanceTimersByTime(80);
        expect(layout.source.get()?.obstacles).toHaveLength(2);
        offControl();
        vi.advanceTimersByTime(80);
        expect(layout.source.get()?.obstacles).toEqual([{
            role: 'navigation', kind: 'reveal-area', rect: { ...bounds, width: 120, height: 120 },
        }]);
        off();
    });
});


describe('experimental layout ownership and active measurement', () => {
    it('creates no observer or scheduled measurements without a player or without subscribers', () => {
        const layout = createPlayerOverlayLayout();
        const off = layout.source.subscribe(() => {});
        for (let i = 0; i < 20; i++) layout.invalidate();
        expect(resizeCallbacks).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        const root = elementAt();
        const offRoot = layout.registerRoot(root.element);
        expect(resizeCallbacks).toHaveLength(1);
        vi.advanceTimersByTime(80);
        offRoot();
        vi.advanceTimersByTime(80);
        root.read.mockClear();
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));
        for (let i = 0; i < 20; i++) layout.invalidate();
        expect(vi.getTimerCount()).toBe(0);
        expect(root.read).not.toHaveBeenCalled();
        off();
        layout.registerRoot(root.element);
        expect(vi.getTimerCount()).toBe(0);
        expect(resizeCallbacks).toHaveLength(1);
    });
    it('does not measure on repeated reads before subscription or after the last unsubscribe', () => {
        const layout = createPlayerOverlayLayout();
        const root = elementAt();
        const readObstacle = vi.fn(() => ({ key: 'toast', role: 'notification', kind: 'control' as const,
            rect: { left: 20, top: 20, width: 200, height: 40 } }));
        layout.registerRoot(root.element, { top: 56, right: 0, bottom: 0, left: 0 });
        layout.register(null, readObstacle);
        for (let index = 0; index < 10; index++) expect(layout.source.get()).toBeNull();
        expect(root.read).not.toHaveBeenCalled();
        expect(readObstacle).not.toHaveBeenCalled();
        expect(resizeCallbacks).toHaveLength(0);
        const off = layout.source.subscribe(() => {});
        expect(layout.source.get()).toBeNull();
        vi.advanceTimersByTime(79);
        expect(root.read).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(layout.source.get()?.insets.top).toBe(56);
        expect(root.read).toHaveBeenCalledTimes(1);
        off();
        root.read.mockClear();
        readObstacle.mockClear();
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));
        layout.invalidate();
        for (let index = 0; index < 10; index++) expect(layout.source.get()).toBeNull();
        vi.advanceTimersByTime(60_000);
        expect(root.read).not.toHaveBeenCalled();
        expect(readObstacle).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('updates position-only scroll changes and viewport resize without polling', () => {
        const layout = createPlayerOverlayLayout();
        const root = elementAt();
        const obstacle = elementAt({ left: 20, top: 80, width: 100, height: 40 });
        layout.registerRoot(root.element);
        layout.register(obstacle.element, () => ({ key: 'portal', role: 'notification', kind: 'control', rect: obstacle.element.getBoundingClientRect() }));
        const listener = vi.fn();
        const off = layout.source.subscribe(listener);
        vi.advanceTimersByTime(80);
        obstacle.read.mockReturnValue(new DOMRect(20, 120, 100, 40));
        window.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(80);
        expect(layout.source.get()?.obstacles[0].rect.top).toBe(120);
        root.read.mockReturnValue(new DOMRect(0, 0, 800, 400));
        resizeCallbacks[0]();
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(80);
        expect(layout.source.get()?.bounds.width).toBe(800);
        expect(listener).toHaveBeenCalledTimes(3);
        off();
    });
});
