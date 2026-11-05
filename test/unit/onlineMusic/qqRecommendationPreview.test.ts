import { describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import { createQqRecommendationPreview } from '@/services/onlineMusic/qq/qqRecommendationPreview';

// 刷歌预览的临时票据可重复开始同一批；不带票据的续歌取新批，挂起请求不跨账号采用。

const peek = async (preview: ReturnType<typeof createQqRecommendationPreview>) => (await preview.reserve()).songs;

const song = (id: number): UnifiedSong => ({ id, name: `Song ${id}` }) as UnifiedSong;
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};

describe('QQ recommendation preview reservation', () => {
    it('replays the displayed entry after another source or a refused play, while continuation stays fresh', async () => {
        const first = [song(1), song(2)];
        const next = [song(3)];
        const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
        const preview = createQqRecommendationPreview(load, () => 'opaque-a');
        const displayed = await preview.reserve();
        expect(displayed.songs).toBe(first);
        expect(displayed.playbackToken).not.toContain('opaque-a');
        expect(await preview.take(displayed.playbackToken)).toBe(first);
        // Audio can fail or be superseded after the batch was requested; the visible entry still owns it.
        expect(await preview.take(displayed.playbackToken)).toBe(first);
        expect(await preview.take()).toBe(next);
        // After switching to an ordinary queue, the card falls back to its displayed first-song batch.
        expect(await preview.take(displayed.playbackToken)).toBe(first);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('does not turn a prior-session ticket into a fresh, undisplayed batch', async () => {
        let session: string | null = 'opaque-a';
        const load = vi.fn().mockResolvedValue([song(1)]);
        const preview = createQqRecommendationPreview(load, () => session);
        const displayed = await preview.reserve();
        session = 'opaque-b';
        expect(await preview.take(displayed.playbackToken)).toEqual([]);
        expect(load).toHaveBeenCalledTimes(1);
        session = null;
        expect(await preview.take(displayed.playbackToken)).toEqual([]);
    });

    it('reserves a preview for exactly one playback batch, then reads fresh', async () => {
        const first = [song(1), song(2)];
        const next = [song(3)];
        const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
        const preview = createQqRecommendationPreview(load, () => 'opaque-a');

        expect(await peek(preview)).toBe(first);
        expect(await peek(preview)).toBe(first);
        expect(await preview.take()).toBe(first);
        expect(load).toHaveBeenCalledTimes(1);
        expect(await preview.take()).toBe(next);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('reserves a fresh preview after a settled batch was consumed by playback', async () => {
        const first = [song(1)];
        const next = [song(2)];
        const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
        const preview = createQqRecommendationPreview(load, () => 'opaque-a');
        expect(await peek(preview)).toBe(first);
        expect(await preview.take()).toBe(first);
        expect(await peek(preview)).toBe(next);
        expect(await preview.take()).toBe(next);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it.each(['preview first', 'playback first'])('coalesces concurrent preview and playback (%s)', async order => {
        const pending = deferred<UnifiedSong[]>();
        const load = vi.fn(() => pending.promise);
        const preview = createQqRecommendationPreview(load, () => 'opaque-a');
        const calls = order === 'preview first'
            ? [peek(preview), preview.take(), peek(preview)]
            : [preview.take(), peek(preview), peek(preview)];
        pending.resolve([song(1)]);

        expect(await Promise.all(calls)).toEqual([[song(1)], [song(1)], [song(1)]]);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('does not hand the same reserved batch to two simultaneous playback requests', async () => {
        const first = deferred<UnifiedSong[]>();
        const next = deferred<UnifiedSong[]>();
        const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
        const preview = createQqRecommendationPreview(load, () => 'opaque-a');
        const peeked = peek(preview);
        const played = preview.take();
        const playedNext = preview.take();
        first.resolve([song(1)]);
        next.resolve([song(2)]);

        expect(await Promise.all([peeked, played, playedNext])).toEqual([[song(1)], [song(1)], [song(2)]]);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('retries a failed or empty preview and still surfaces a real current-session error', async () => {
        const error = new Error('unavailable');
        const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce([]).mockResolvedValueOnce([song(3)]);
        const preview = createQqRecommendationPreview(load, () => 'opaque-a');

        await expect(peek(preview)).rejects.toBe(error);
        expect(await peek(preview)).toEqual([]);
        expect(await peek(preview)).toEqual([song(3)]);
        expect(await preview.take()).toEqual([song(3)]);
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('drops held songs when the opaque session changes or leaves', async () => {
        let session: string | null = 'opaque-a';
        const load = vi.fn().mockResolvedValueOnce([song(1)]).mockResolvedValueOnce([song(2)]);
        const preview = createQqRecommendationPreview(load, () => session);
        expect(await peek(preview)).toEqual([song(1)]);
        session = 'opaque-b';
        expect(await preview.take()).toEqual([song(2)]);
        session = null;
        expect(await peek(preview)).toEqual([]);
        expect(await preview.take()).toEqual([]);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('never adopts a late prior-session result, including a change back to the old key', async () => {
        let session: string | null = 'opaque-a';
        const old = deferred<UnifiedSong[]>();
        const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([song(2)]).mockResolvedValueOnce([song(3)]);
        const preview = createQqRecommendationPreview(load, () => session);
        const pending = peek(preview);
        session = 'opaque-b';
        expect(await peek(preview)).toEqual([song(2)]);
        session = 'opaque-a';
        old.resolve([song(1)]);
        expect(await pending).toEqual([]);
        expect(await preview.take()).toEqual([song(3)]);
    });

    it('discards late errors after sign-out and does not start another request', async () => {
        let session: string | null = 'opaque-a';
        const pending = deferred<UnifiedSong[]>();
        const load = vi.fn(() => pending.promise);
        const preview = createQqRecommendationPreview(load, () => session);
        const result = peek(preview);
        session = null;
        pending.reject(new Error('old request failed'));

        expect(await result).toEqual([]);
        expect(await preview.take()).toEqual([]);
        expect(load).toHaveBeenCalledTimes(1);
    });
});
