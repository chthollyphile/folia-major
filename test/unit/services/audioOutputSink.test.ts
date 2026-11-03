import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySavedAudioOutputToContext } from '@/services/audioOutputSink';

// test/unit/services/audioOutputSink.test.ts
// The context is built on the first play, after the saved device was restored onto the <audio> element.
// It starts on the system default, so the saved device has to be put on it when it is created.

const fakeContext = (setSinkId?: (id: string) => Promise<void>) => {
    const context: { sinkId: string; setSinkId?: (id: string) => Promise<void> } = { sinkId: '' };
    if (setSinkId) {
        context.setSinkId = vi.fn(async (id: string) => {
            await setSinkId(id);
            context.sinkId = id;
        });
    }
    return context as typeof context & AudioContext;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('applySavedAudioOutputToContext', () => {
    it('moves a context created after the device was restored onto the saved device', async () => {
        const context = fakeContext(async () => {});
        await expect(applySavedAudioOutputToContext(context, 'blackhole-2ch')).resolves.toBe(true);
        expect(context.setSinkId).toHaveBeenCalledWith('blackhole-2ch');
        expect(context.sinkId).toBe('blackhole-2ch');
    });

    it('leaves the context alone when the system default is saved', async () => {
        for (const deviceId of ['', 'default']) {
            const context = fakeContext(async () => {});
            await expect(applySavedAudioOutputToContext(context, deviceId)).resolves.toBe(true);
            expect(context.setSinkId).not.toHaveBeenCalled();
        }
    });

    it('does not set the device again when the context is already on it', async () => {
        const context = fakeContext(async () => {});
        context.sinkId = 'blackhole-2ch';
        await expect(applySavedAudioOutputToContext(context, 'blackhole-2ch')).resolves.toBe(true);
        expect(context.setSinkId).not.toHaveBeenCalled();
    });

    it('reports false without throwing when the context cannot switch devices', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(applySavedAudioOutputToContext(fakeContext(), 'blackhole-2ch')).resolves.toBe(false);

        const failing = fakeContext(async () => { throw new DOMException('Requested device not found', 'NotFoundError'); });
        await expect(applySavedAudioOutputToContext(failing, 'dac-gone')).resolves.toBe(false);
        expect(failing.sinkId).toBe('');
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
