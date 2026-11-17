import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Pixi from 'pixi.js';

// test/unit/lattice/latticeLyricRaster.test.ts
// 歌词场景的测量缓存跨挂载共享（电台墙每次切歌、浏览、拖动都会重建场景），网页字体加载完时作废。

type Listener = () => void;

const setup = async () => {
    vi.resetModules();
    const listeners = new Map<string, Listener[]>();
    const fonts = {
        addEventListener: vi.fn((type: string, listener: Listener) => {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        }),
    };
    const measureText = vi.fn((text: string) => ({
        width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
    }));
    const context = { font: '', measureText };
    vi.stubGlobal('document', { fonts, createElement: () => ({ getContext: () => context }) });
    const { createLatticeRaster } = await import('../../../src/components/app/lattice/lyrics/latticeLyricRaster');
    const pixi = {} as typeof Pixi;
    const fire = (type: string) => listeners.get(type)?.forEach(listener => listener());
    return { createLatticeRaster, pixi, fonts, measureText, fire };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('Lattice lyric measurement cache', () => {
    it('is shared by every runtime, so a rebuilt scene measures nothing again', async () => {
        const { createLatticeRaster, pixi, measureText } = await setup();
        const first = createLatticeRaster(pixi);
        expect(first.measure('電台', '600 24px serif')).toEqual({ width: 20, height: 10 });
        const second = createLatticeRaster(pixi);
        second.measure('電台', '600 24px serif');
        expect(measureText).toHaveBeenCalledTimes(1);
    });

    it('is dropped when a web font finishes loading, with one listener for all runtimes', async () => {
        const { createLatticeRaster, pixi, fonts, measureText, fire } = await setup();
        const raster = createLatticeRaster(pixi);
        createLatticeRaster(pixi);
        expect(fonts.addEventListener).toHaveBeenCalledTimes(1);
        raster.measure('radio', '600 24px serif');
        fire('loadingdone');
        createLatticeRaster(pixi).measure('radio', '600 24px serif');
        expect(measureText).toHaveBeenCalledTimes(2);
    });
});
