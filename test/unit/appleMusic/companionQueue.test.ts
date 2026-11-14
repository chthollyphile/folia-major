import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Run the exact isolated-page queue operations without audio, tokens or a browser account.
const require = createRequire(import.meta.url);
const { requestExpression, validateRequest } = require('../../../electron/appleMusic/companionRequests.cjs');
const item = (id: string) => ({ id, attributes: { playParams: { catalogId: id } } });
function player() {
    const queue = { items: [item('123')], position: 0, clearAfterCurrent: vi.fn(async () => { queue.items = queue.items.slice(0, queue.position + 1); }) };
    const mk = { api: { music: vi.fn() }, queue, nowPlayingItem: item('123'), isPlaying: true,
        playLater: vi.fn(async ({ songs }: { songs: string[] }) => { queue.items.push(...songs.map(item)); }),
        setQueue: vi.fn(async () => {}), play: vi.fn(async () => {}),
        changeToMediaAtIndex: vi.fn(async (index: number) => { queue.position = index; mk.nowPlayingItem = queue.items[index]; }),
    };
    const window = { MusicKit: { getInstance: () => mk } };
    const call = (operation: string, params: unknown) => runInNewContext(requestExpression(validateRequest({ id: 'test', operation, params })), { window, console });
    return { mk, call };
}

describe('Apple Music prepared queue', () => {
    it('validates a bounded, distinct catalog-only tail', () => {
        expect(validateRequest({ id: '1', operation: 'prepareNext', params: { catalogId: '123', nextIds: ['456', '789'] } })).not.toBeNull();
        // The sounding song may be an upload; its tail is still catalog songs only.
        expect(validateRequest({ id: '1', operation: 'prepareNext', params: { catalogId: 'i.upload', nextIds: ['456'] } })).not.toBeNull();
        for (const nextIds of [['i.library'], ['123'], ['456', '456'], ['1', '2', '3']]) {
            expect(validateRequest({ id: '1', operation: 'prepareNext', params: { catalogId: '123', nextIds } })).toBeNull();
        }
    });
    it('updates only the tail and does not interrupt the current song', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456', '789'] });
        expect(mk.queue.items.map(value => value.id)).toEqual(['123', '456', '789']);
        await call('prepareNext', { catalogId: '123', nextIds: ['456', '789'] });
        expect(mk.playLater).toHaveBeenCalledOnce();
        await call('prepareNext', { catalogId: '123', nextIds: [] });
        expect(mk.queue.items.map(value => value.id)).toEqual(['123']);
        expect(mk.setQueue).not.toHaveBeenCalled();
        expect(mk.play).not.toHaveBeenCalled();
    });
    it('adopts an already sounding successor without rebuilding or restarting it', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        mk.nowPlayingItem = item('456');
        mk.queue.position = 1;
        await expect(call('playSong', { catalogId: '456' })).resolves.toMatchObject({ ok: true, data: { reusedQueue: true } });
        expect(mk.setQueue).not.toHaveBeenCalled();
        expect(mk.play).not.toHaveBeenCalled();
        expect(mk.changeToMediaAtIndex).not.toHaveBeenCalled();
    });

    it('extends the rolling tail without throwing away an already buffered successor', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456', '789'] });
        mk.nowPlayingItem = item('456');
        mk.queue.position = 1;
        await call('playSong', { catalogId: '456' });
        await call('prepareNext', { catalogId: '456', nextIds: ['789', '999'] });
        expect(mk.queue.clearAfterCurrent).not.toHaveBeenCalled();
        expect(mk.playLater).toHaveBeenLastCalledWith({ songs: ['999'] });
    });

    it('preserves a user pause when Folia adopts the automatically advanced item', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        mk.nowPlayingItem = item('456');
        mk.queue.position = 1;
        mk.isPlaying = false;
        await expect(call('playSong', { catalogId: '456' })).resolves.toMatchObject({ data: { reusedQueue: true, isPlaying: false } });
        expect(mk.play).not.toHaveBeenCalled();
    });
    it('switches directly to a prepared successor on manual next', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        await call('playSong', { catalogId: '456' });
        expect(mk.changeToMediaAtIndex).toHaveBeenCalledWith(1);
        expect(mk.play).not.toHaveBeenCalled();
        expect(mk.setQueue).not.toHaveBeenCalled();
    });
    it('falls back once to normal loading when the prepared switch is rejected', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        mk.changeToMediaAtIndex.mockRejectedValueOnce(new Error('switch rejected'));
        await expect(call('playSong', { catalogId: '456' })).resolves.toMatchObject({ ok: true });
        expect(mk.changeToMediaAtIndex).toHaveBeenCalledOnce();
        expect(mk.setQueue).toHaveBeenCalledWith({ song: '456', startPlaying: false, startTime: 0 });
        expect(mk.play).toHaveBeenCalledOnce();
    });
    it('does not restart a target already sounding when the optimized call rejects', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        mk.changeToMediaAtIndex.mockImplementationOnce(async () => {
            mk.nowPlayingItem = item('456');
            mk.queue.position = 1;
            throw new Error('late rejection');
        });
        await expect(call('playSong', { catalogId: '456' })).resolves.toMatchObject({ ok: true, data: { reusedQueue: true } });
        expect(mk.setQueue).not.toHaveBeenCalled();
        expect(mk.play).not.toHaveBeenCalled();
    });
    it('reports the actual failed fallback stage without retrying indefinitely', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        mk.changeToMediaAtIndex.mockRejectedValueOnce(new Error('switch rejected'));
        mk.play.mockRejectedValueOnce(new Error('play rejected'));
        await expect(call('playSong', { catalogId: '456' })).resolves.toMatchObject({ ok: true });
        await new Promise(resolve => setTimeout(resolve, 0));
        await expect(call('playbackStatus', {})).resolves.toMatchObject({ ok: false, error: 'playback-failed' });
        expect(mk.setQueue).toHaveBeenCalledOnce();
        expect(mk.play).toHaveBeenCalledOnce();
    });
    it('does not restart the song when the same play request is retried', async () => {
        const { mk, call } = player();
        await call('playSong', { catalogId: '123', requestKey: 'play_one' });
        await call('playSong', { catalogId: '123', requestKey: 'play_one' });
        expect(mk.setQueue).toHaveBeenCalledOnce();
        expect(mk.play).toHaveBeenCalledOnce();
        await call('playSong', { catalogId: '123', requestKey: 'play_two' });
        expect(mk.setQueue).toHaveBeenCalledTimes(2);
    });

    it('adopts a verified native handoff even after a tail refresh replaced the plan', async () => {
        const { mk, call } = player();
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        mk.nowPlayingItem = item('456');
        mk.queue.position = 1;
        await call('prepareNext', { catalogId: '456', nextIds: [] });
        await expect(call('playSong', { catalogId: '456', adoptCurrent: true, requestKey: 'handoff' }))
            .resolves.toMatchObject({ data: { reusedQueue: true } });
        expect(mk.setQueue).not.toHaveBeenCalled();
        expect(mk.play).not.toHaveBeenCalled();
    });

    it('chooses the prepared future occurrence rather than a repeated song in playback history', async () => {
        const { mk, call } = player();
        mk.queue.items = [item('456'), item('123')];
        mk.queue.position = 1;
        await call('prepareNext', { catalogId: '123', nextIds: ['456'] });
        await call('playSong', { catalogId: '456' });
        expect(mk.changeToMediaAtIndex).toHaveBeenCalledWith(2);
        expect(mk.play).not.toHaveBeenCalled();
    });

});
