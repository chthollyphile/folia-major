import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Slow buffering must release IPC while retaining deferred error and cancellation handling.
const { validateRequest, requestExpression } = createRequire(import.meta.url)('../../../electron/appleMusic/companionRequests.cjs');
it('returns before slow play resolves and reports a later rejection', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_, fail) => { reject = fail; });
    const mk = { api: { music: vi.fn() }, setQueue: vi.fn(), play: () => pending };
    const context = { window: { MusicKit: { getInstance: () => mk } }, console };
    const run = (operation: string, params = {}) => runInNewContext(requestExpression(validateRequest({ id: 'test', operation, params })), context);
    expect(await run('playSong', { catalogId: '123' })).toMatchObject({ ok: true });
    reject(new Error('media failed'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await run('playbackStatus')).toMatchObject({ ok: false, error: 'playback-failed' });
});
it('does not let an old pending start pause a subsequent resume', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const mk = { api: { music: vi.fn() }, setQueue: vi.fn(), play: vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined), pause: vi.fn() };
    const context = { window: { MusicKit: { getInstance: () => mk } }, console };
    const run = (operation: string, params = {}) => runInNewContext(requestExpression(validateRequest({ id: 'test', operation, params })), context);
    await run('playSong', { catalogId: '123' });
    await run('pause');
    await run('resume');
    resolve();
    await new Promise(done => setTimeout(done, 0));
    expect(mk.pause).toHaveBeenCalledTimes(1);
});

it('preserves a newer seek while the original start is buffering', async () => {
    let resolve!: () => void;
    const mk = { api: { music: vi.fn() }, setQueue: vi.fn(), play: () => new Promise<void>(done => { resolve = done; }), seekToTime: vi.fn(), currentPlaybackTime: 0 };
    const context = { window: { MusicKit: { getInstance: () => mk } }, console };
    const run = (operation: string, params = {}) => runInNewContext(requestExpression(validateRequest({ id: 'test', operation, params })), context);
    await run('playSong', { catalogId: '123', startSec: 60 });
    await run('seek', { seconds: 10 });
    resolve();
    await new Promise(done => setTimeout(done, 0));
    expect(mk.seekToTime).toHaveBeenCalledExactlyOnceWith(10);
});

it('ignores an interrupted start rejection after a successful resume', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => { reject = fail; });
    const mk = { api: { music: vi.fn() }, setQueue: vi.fn(), play: vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined), pause: vi.fn() };
    const context = { window: { MusicKit: { getInstance: () => mk } }, console };
    const run = (operation: string, params = {}) => runInNewContext(requestExpression(validateRequest({ id: 'test', operation, params })), context);
    await run('playSong', { catalogId: '123' });
    await run('pause');
    await run('resume');
    reject(new Error('interrupted'));
    await new Promise(done => setTimeout(done, 0));
    expect(await run('playbackStatus')).toMatchObject({ ok: true });
});
