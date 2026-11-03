import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/audioCacheRemove.test.ts
// The renderer's half of deleting a cached copy that playback found to be a clip: only the file of
// the size that was read goes, on the desktop side (which compares it there) and in IndexedDB (the
// copies a build without the desktop side keeps), so a whole file written since the read stays.

const { stored, removeFromCache } = vi.hoisted(() => ({
    stored: new Map<string, unknown>(),
    removeFromCache: vi.fn(),
}));

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => stored.get(key) ?? null),
    removeFromCache: (key: string) => removeFromCache(key),
    saveToCache: vi.fn(),
}));

const { removeAudioBlob } = await import('@/services/audioCache');

describe('removeAudioBlob', () => {
    afterEach(() => {
        stored.clear();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('deletes an IndexedDB copy only while it is the size that was read', async () => {
        vi.stubGlobal('window', {});
        stored.set('audio_x', new Blob(['12345']));

        await expect(removeAudioBlob('audio_x', 9)).resolves.toBe(false);
        expect(removeFromCache).not.toHaveBeenCalled();

        await expect(removeAudioBlob('audio_x', 5)).resolves.toBe(true);
        expect(removeFromCache).toHaveBeenCalledExactlyOnceWith('audio_x');
    });

    it('hands the size read to the desktop side and answers with what it did', async () => {
        const removeAudioCache = vi.fn(async (_key: string, size: number) => size === 5);
        vi.stubGlobal('window', { electron: { getAudioCache: vi.fn(), hasAudioCache: vi.fn(), saveAudioCache: vi.fn(), removeAudioCache } });

        await expect(removeAudioBlob('audio_x', 5)).resolves.toBe(true);
        await expect(removeAudioBlob('audio_x', 4)).resolves.toBe(false);
        expect(removeAudioCache.mock.calls).toEqual([['audio_x', 5], ['audio_x', 4]]);
        expect(removeFromCache).not.toHaveBeenCalled();
    });
});
