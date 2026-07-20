import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/lyrics/workerClient.test.ts

describe('lyrics worker client', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('does not post provider callbacks or song identity to the parser worker', async () => {
        const messages: Array<Record<string, unknown>> = [];

        class FakeWorker {
            onmessage: ((event: MessageEvent) => void) | null = null;

            postMessage(message: Record<string, unknown>) {
                messages.push(message);
                structuredClone(message);
                this.onmessage?.({
                    data: {
                        type: 'result',
                        data: { lines: [] },
                        requestId: message.requestId,
                    },
                } as MessageEvent);
            }
        }

        vi.stubGlobal('Worker', FakeWorker);
        const { parseLyricsAsync } = await import('@/utils/lyrics/workerClient');
        const fetchChorusRanges = vi.fn(async () => []);

        await expect(parseLyricsAsync('lrc', '[00:00.00]Line', '', {
            includeInterludes: false,
            filterPattern: '^metadata$',
            songId: 123,
            fetchChorusRanges,
        })).resolves.toEqual({ lines: [] });

        expect(messages[0]?.options).toEqual({
            includeInterludes: false,
            filterPattern: '^metadata$',
        });
        expect(fetchChorusRanges).not.toHaveBeenCalled();
    });
});
