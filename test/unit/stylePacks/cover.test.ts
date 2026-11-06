// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { loadCodeCover } from '../../../src/stylePacks/code/cover';

// Cover failures must never display the preceding song; late decodes cannot resurrect stale bitmaps.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('clears before loading a replacement and remains empty when that image fails', async () => {
    let image: HTMLImageElement;
    vi.stubGlobal('Image', class { constructor() { image = this as unknown as HTMLImageElement; } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setCover = vi.fn().mockResolvedValue(undefined);
    const dispose = loadCodeCover('missing.png', { setCover });
    expect(setCover).toHaveBeenCalledExactlyOnceWith(null);
    image!.onerror!(new Event('error')); await Promise.resolve();
    expect(setCover).toHaveBeenCalledTimes(1); dispose();
});
it('closes an obsolete decoded image instead of sending it to the new song', async () => {
    let image: HTMLImageElement, finish: (bitmap: ImageBitmap) => void;
    vi.stubGlobal('Image', class { constructor() { image = this as unknown as HTMLImageElement; } });
    vi.stubGlobal('createImageBitmap', () => new Promise<ImageBitmap>(resolve => { finish = resolve; }));
    const setCover = vi.fn().mockResolvedValue(undefined), close = vi.fn();
    const dispose = loadCodeCover('a.png', { setCover });
    image!.onload!(new Event('load')); dispose(); finish!({ close } as unknown as ImageBitmap);
    await Promise.resolve(); await Promise.resolve();
    expect(close).toHaveBeenCalledOnce(); expect(setCover).toHaveBeenCalledExactlyOnceWith(null);
});
