// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyTransport.test.ts
// How long the renderer waits for the app's own answer. The follow's read goes through the main
// process, which may look for the DevTools port on that very read: the look reads the app's port
// file and runs a netstat over the machine's loopback listeners, which took up to about 5.6 seconds
// in the worst case measured. A wait shorter than that dropped the read of every poll the look
// landed on - the app had answered, and the renderer had already thrown the answer away.

type Request = (operation: string, params: Record<string, unknown>) => Promise<unknown>;

const electronOf = (request: Request) => ({ spotifyRequest: request }) as unknown as Window['electron'];

const requestSpotify = async () => (await import('@/services/onlineMusic/spotify/spotifyTransport')).requestSpotify;

describe('how long a read of the app is waited for', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // The look the main process makes on this very read answers well after the old 1.5 s wait.
    it('keeps the answer of the watcher read that the port search delayed', async () => {
        const answer = { id: 'x'.repeat(22), ad: false, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 200000 };
        window.electron = electronOf((_operation, _params) => new Promise(resolve => {
            setTimeout(() => resolve({ ok: true, data: answer }), 3000);
        }));

        const read = (await requestSpotify())<typeof answer>('client_status_follow');
        await vi.advanceTimersByTimeAsync(3100);

        await expect(read).resolves.toEqual(answer);
    });

    it('gives up on the watcher read after six seconds, not sooner', async () => {
        window.electron = electronOf(() => new Promise(() => {}));

        const read = (await requestSpotify())('client_status_follow');
        const settled = vi.fn();
        void Promise.resolve(read).then(settled, settled);
        await vi.advanceTimersByTimeAsync(5500);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(600);
        expect(settled).toHaveBeenCalled();
    });

    // Nothing else moved: a read that only asks what the app holds stays on its short wait, since a
    // page wedged on a dialog is not coming back within seconds and the next poll waits on it.
    it('leaves the other reads on their short wait', async () => {
        window.electron = electronOf(() => new Promise(() => {}));

        const read = (await requestSpotify())('client_status');
        const settled = vi.fn();
        void Promise.resolve(read).then(settled, settled);
        await vi.advanceTimersByTimeAsync(1600);
        expect(settled).toHaveBeenCalled();
    });
});
