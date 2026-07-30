import { afterEach, describe, expect, it, vi } from 'vitest';
import { SonnetTexturePool } from '@/components/visualizer/sonnet/sonnetTexturePool';

// test/unit/visualizer/sonnetTexturePool.test.ts
// Prevents one Sonnet runtime from unloading textures still owned by another runtime.
describe('Sonnet texture pool', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reference-counts shared loads and delays final unload', async () => {
        vi.useFakeTimers();
        const texture = { id: 'heart' };
        const load = vi.fn(async () => texture);
        const unload = vi.fn(async () => undefined);
        const pool = new SonnetTexturePool(load, unload, 100);

        expect(await pool.acquire('heart.svg')).toBe(texture);
        expect(await pool.acquire('heart.svg')).toBe(texture);
        expect(load).toHaveBeenCalledTimes(1);

        pool.release('heart.svg');
        await vi.advanceTimersByTimeAsync(150);
        expect(unload).not.toHaveBeenCalled();

        pool.release('heart.svg');
        await vi.advanceTimersByTimeAsync(99);
        expect(unload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(unload).toHaveBeenCalledWith('heart.svg');
    });

    it('cancels pending unload when a replacement runtime acquires the asset', async () => {
        vi.useFakeTimers();
        const load = vi.fn(async () => ({ id: 'star' }));
        const unload = vi.fn(async () => undefined);
        const pool = new SonnetTexturePool(load, unload, 100);

        await pool.acquire('star.svg');
        pool.release('star.svg');
        await vi.advanceTimersByTimeAsync(50);
        await pool.acquire('star.svg');
        await vi.advanceTimersByTimeAsync(100);

        expect(load).toHaveBeenCalledTimes(1);
        expect(unload).not.toHaveBeenCalled();
    });
});
