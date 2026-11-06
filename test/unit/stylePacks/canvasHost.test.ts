// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPackCanvas } from '../../../src/stylePacks/canvasHost';
import { EXAMPLE_PACK } from '../../../src/stylePacks/example';
import { fixtureFrame } from '../../../src/stylePacks/fixtures';

// Exercises the scheduling boundary where browser visibility, pauses and teardown matter.
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../../../src/stylePacks/render', () => ({ createPackRenderer: () => render }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); render.mockReset(); });
describe('pack canvas lifecycle', () => {
    const setup = (animate = true) => {
        let callback: FrameRequestCallback = () => {};
        const cancel = vi.fn(), disconnect = vi.fn();
        vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 7; });
        vi.stubGlobal('cancelAnimationFrame', cancel);
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
        const canvas = document.createElement('canvas');
        Object.defineProperties(canvas, { clientWidth: { value: 4000 }, clientHeight: { value: 2000 } });
        vi.spyOn(canvas, 'getContext').mockReturnValue({} as ReturnType<HTMLCanvasElement['getContext']>);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        const fail = vi.fn();
        const host = mountPackCanvas(canvas, () => ({ pack: EXAMPLE_PACK, frame: fixtureFrame(1), animate }), fail);
        return { host, canvas, tick: (time: number) => callback(time), fail, cancel, disconnect };
    };
    it('caps raster size and frame rate, suspends hidden drawing and disposes resources', () => {
        const { host, canvas, tick, cancel, disconnect } = setup();
        tick(0); tick(5); tick(40);
        expect(render).toHaveBeenCalledTimes(2);
        expect([canvas.width, canvas.height]).toEqual([1920, 960]);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        tick(100);
        expect(render).toHaveBeenCalledTimes(2);
        host.dispose(); tick(200); host.draw();
        expect(render).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledWith(7);
        expect(disconnect).toHaveBeenCalledOnce();
    });
    it('only redraws paused content on explicit invalidation', () => {
        const { host, tick } = setup(false);
        tick(0); tick(100); expect(render).toHaveBeenCalledOnce();
        host.draw(); tick(140); expect(render).toHaveBeenCalledTimes(2); host.dispose();
    });
    it('coalesces a high-frequency static clock and blocks invalidations in the background', () => {
        const { host, tick } = setup(false);
        for (let i = 0; i < 120; i++) { host.draw(); tick(i * 1000 / 120); }
        expect(render.mock.calls.length).toBeLessThanOrEqual(30);
        const count = render.mock.calls.length;
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        for (let i = 0; i < 120; i++) { host.draw(); tick(1000 + i * 1000 / 120); }
        expect(render).toHaveBeenCalledTimes(count);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        tick(2100); expect(render).toHaveBeenCalledTimes(count + 1);
        host.dispose();
    });
    it('reports render failures once and stops drawing', () => {
        const { host, tick, fail } = setup();
        render.mockImplementation(() => { throw new Error('draw failed'); });
        tick(0); tick(100); host.draw();
        expect(fail).toHaveBeenCalledOnce();
        expect(render).toHaveBeenCalledOnce(); host.dispose();
    });
    it.each([60, 120, 144])('sustains 30 fps on a %i Hz display without accumulating timestamp drift', hz => {
        const { host, tick } = setup();
        const gaps: number[] = [];
        let previous = -1;
        for (let i = 0; i < hz * 60; i++) {
            const now = i * 1000 / hz;
            const before = render.mock.calls.length;
            tick(now);
            if (render.mock.calls.length !== before) {
                if (previous >= 0) gaps.push(now - previous);
                previous = now;
            }
        }
        expect(render.mock.calls.length).toBeGreaterThanOrEqual(1799);
        expect(render.mock.calls.length).toBeLessThanOrEqual(1801);
        expect(gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)]).toBeLessThanOrEqual(40);
        host.dispose();
    });
    it('reports a missing canvas context without throwing out of React effects', () => {
        const canvas = document.createElement('canvas');
        vi.spyOn(canvas, 'getContext').mockReturnValue(null);
        const fail = vi.fn();
        const host = mountPackCanvas(canvas, () => ({ pack: EXAMPLE_PACK, frame: fixtureFrame(0) }), fail);
        expect(fail).toHaveBeenCalledOnce();
        host.dispose();
    });
});
