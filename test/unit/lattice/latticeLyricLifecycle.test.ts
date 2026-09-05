import { describe, expect, it, vi } from 'vitest';
import { createLatticeLyricFrameLoop } from '../../../src/components/app/lattice/lyrics/latticeLyricFrameLoop';
import { startLatticeLyricSession } from '../../../src/components/app/lattice/lyrics/latticeLyricSession';
import type { LatticeLyricRuntime } from '../../../src/components/app/lattice/lyrics/types';

// test/unit/lattice/latticeLyricLifecycle.test.ts
const runtime = (): LatticeLyricRuntime => ({ update: vi.fn(), resize: vi.fn(), setVisible: vi.fn(), destroy: vi.fn() });

describe('demand-driven card rendering', () => {
    it('coalesces clock writes and stops after paused animation settles', () => {
        let callback: FrameRequestCallback = () => {};
        const request = vi.fn((cb: FrameRequestCallback) => { callback = cb; return 1; });
        const draw = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        const loop = createLatticeLyricFrameLoop(draw, request, vi.fn());
        loop.wake(); loop.wake(); loop.wake(); expect(request).toHaveBeenCalledTimes(1);
        callback(100); expect(request).toHaveBeenCalledTimes(2);
        callback(120); expect(request).toHaveBeenCalledTimes(2);
        loop.wake(); expect(request).toHaveBeenCalledTimes(3);
        loop.destroy();
    });
    it('does not render while offscreen and cannot wake after destruction', () => {
        const request = vi.fn(() => 42), cancel = vi.fn(), draw = vi.fn();
        const loop = createLatticeLyricFrameLoop(draw, request, cancel);
        loop.wake(); loop.setVisible(false); expect(cancel).toHaveBeenCalledWith(42);
        loop.wake(); expect(request).toHaveBeenCalledTimes(1);
        loop.setVisible(true); expect(request).toHaveBeenCalledTimes(2);
        loop.destroy(); loop.wake(); loop.setVisible(true); expect(request).toHaveBeenCalledTimes(2);
        expect(draw).not.toHaveBeenCalled();
    });
});

describe('asynchronous WebGL lifetime', () => {
    it('disposes a late initialization after unmount without publishing ready', async () => {
        let resolve!: (value: LatticeLyricRuntime) => void;
        let signal!: AbortSignal;
        const ready = vi.fn(), failed = vi.fn(), value = runtime();
        const session = startLatticeLyricSession(s => { signal = s; return new Promise(r => { resolve = r; }); }, ready, failed);
        session.destroy(); expect(signal.aborted).toBe(true);
        resolve(value); await session.completion;
        expect(value.destroy).toHaveBeenCalledOnce(); expect(ready).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    });
    it('releases the previous song once when a new session replaces it', async () => {
        const old = runtime(), next = runtime();
        const a = startLatticeLyricSession(async () => old, vi.fn(), vi.fn());
        await a.completion; a.destroy(); a.destroy();
        const ready = vi.fn(); const b = startLatticeLyricSession(async () => next, ready, vi.fn());
        await b.completion;
        expect(old.destroy).toHaveBeenCalledOnce(); expect(next.destroy).not.toHaveBeenCalled();
        expect(ready).toHaveBeenCalledWith(next); b.destroy(); expect(next.destroy).toHaveBeenCalledOnce();
    });
    it('reports initialization failure but suppresses a canceled failure', async () => {
        const error = new Error('WebGL unavailable'), failed = vi.fn();
        const a = startLatticeLyricSession(async () => { throw error; }, vi.fn(), failed);
        await a.completion; expect(failed).toHaveBeenCalledWith(error);
        const ignored = vi.fn();
        const b = startLatticeLyricSession(async () => { throw error; }, vi.fn(), ignored);
        b.destroy(); await b.completion; expect(ignored).not.toHaveBeenCalled();
    });
});
