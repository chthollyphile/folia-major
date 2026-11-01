import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Verify that recovery destroys stale playback work without erasing the account's session.
const require = createRequire(import.meta.url);
const { recoverPlaybackDocument } = require('../../../electron/appleMusic/companionRecovery.cjs');
const { createRequestDispatcher } = require('../../../electron/appleMusic/companionRequests.cjs');

describe('Apple Music playback recovery', () => {
    it('navigates through a blank document before restoring the Apple page', async () => {
        const invalidate = vi.fn();
        const contents = {
            isDestroyed: () => false,
            getURL: () => 'https://music.apple.com/cn/home',
            loadURL: vi.fn(async (_url: string) => { expect(invalidate).toHaveBeenCalledOnce(); }),
            close: vi.fn(),
        };
        expect(await recoverPlaybackDocument(contents, invalidate)).toBe(true);
        expect(contents.loadURL.mock.calls).toEqual([['about:blank'], ['https://music.apple.com/cn/home']]);
        expect(contents.close).not.toHaveBeenCalled();
    });

    it('closes a renderer whose recovery stalls', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const contents = {
                isDestroyed: () => false,
                getURL: () => 'https://music.apple.com/cn/home',
                loadURL: vi.fn(() => new Promise(() => {})),
                close: vi.fn(),
            };
            const result = recoverPlaybackDocument(contents, vi.fn(), 10);
            await vi.advanceTimersByTimeAsync(10);
            expect(await result).toBe(false);
            expect(contents.close).toHaveBeenCalledOnce();
        } finally { vi.useRealTimers(); warn.mockRestore(); }
    });

    it('invalidates queued commands and accepts work only after recovery replaces the document', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            let generation = 0;
            let resolveOld!: (value: unknown) => void;
            let resolveRecovery!: (value: boolean) => void;
            const contents = {
                isDestroyed: () => false,
                getURL: () => 'https://music.apple.com/cn/home',
                executeJavaScript: vi.fn((): Promise<unknown> => new Promise(resolve => { resolveOld = resolve; })),
            };
            const recover = vi.fn(() => {
                generation++;
                return new Promise(resolve => { resolveRecovery = resolve; });
            });
            const dispatch = createRequestDispatcher(() => contents, 10, () => generation, recover);
            const start = dispatch({ id: 'start', operation: 'playSong', params: { catalogId: '123' } });
            const pause = dispatch({ id: 'pause', operation: 'pause' });
            await vi.advanceTimersByTimeAsync(10);
            expect(await start).toMatchObject({ error: 'timeout' });
            expect(await pause).toMatchObject({ error: 'timeout' });
            expect(recover).toHaveBeenCalledOnce();
            expect(await dispatch({ id: 'wait', operation: 'resume' })).toMatchObject({ error: 'not-ready' });
            resolveOld({ ok: true });
            await vi.advanceTimersByTimeAsync(0);
            expect(contents.executeJavaScript).toHaveBeenCalledOnce();
            resolveRecovery(true);
            await vi.advanceTimersByTimeAsync(0);
            contents.executeJavaScript.mockImplementation(async () => ({ ok: true, data: {} }));
            expect(await dispatch({ id: 'retry', operation: 'pause' })).toMatchObject({ ok: true });
        } finally { vi.useRealTimers(); warn.mockRestore(); }
    });

    it('does not execute a queued command in a newly navigated page', async () => {
        let generation = 0;
        let finish!: (value: unknown) => void;
        const contents = {
            isDestroyed: () => false,
            getURL: () => 'https://music.apple.com/',
            executeJavaScript: vi.fn(() => new Promise(resolve => { finish = resolve; })),
        };
        const dispatch = createRequestDispatcher(() => contents, 1000, () => generation);
        const first = dispatch({ id: 'first', operation: 'pause' });
        const second = dispatch({ id: 'second', operation: 'resume' });
        await Promise.resolve();
        await Promise.resolve();
        generation++;
        finish({ ok: true });
        expect(await first).toMatchObject({ error: 'not-ready' });
        expect(await second).toMatchObject({ error: 'not-ready' });
        expect(contents.executeJavaScript).toHaveBeenCalledOnce();
    });
    it('recovers hung reads before their occupied slots can block playback forever', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            let generation = 0;
            const contents = {
                isDestroyed: () => false,
                getURL: () => 'https://music.apple.com/',
                executeJavaScript: vi.fn((): Promise<unknown> => new Promise(() => {})),
            };
            const recover = vi.fn(async () => { generation++; return true; });
            const dispatch = createRequestDispatcher(() => contents, 10, () => generation, recover);
            const reads = ['search', 'lyrics', 'accountStatus', 'playbackStatus'].map((operation, index) =>
                dispatch({ id: 'read_' + index, operation, params: { query: 'example', songId: '123' } }));
            await vi.advanceTimersByTimeAsync(10);
            expect((await Promise.all(reads)).every(result => result.error === 'timeout')).toBe(true);
            expect(recover).toHaveBeenCalledOnce();
            contents.executeJavaScript.mockImplementation(async () => ({ ok: true, data: {} }));
            expect(await dispatch({ id: 'play', operation: 'playSong', params: { catalogId: '123' } })).toMatchObject({ ok: true });
        } finally { vi.useRealTimers(); warn.mockRestore(); }
    });

    it('does not hold pause behind a pending tail preparation', async () => {
        let finish!: (value: unknown) => void;
        const contents = {
            isDestroyed: () => false,
            getURL: () => 'https://music.apple.com/',
            executeJavaScript: vi.fn((expression: string) => expression.includes('"operation":"prepareNext"')
                ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, data: {} })),
        };
        const dispatch = createRequestDispatcher(() => contents, 1000);
        const prepare = dispatch({ id: 'prepare', operation: 'prepareNext', params: { catalogId: '123', nextIds: ['456'] } });
        await Promise.resolve();
        await Promise.resolve();
        expect(await dispatch({ id: 'pause', operation: 'pause' })).toMatchObject({ ok: true });
        finish({ ok: true });
        expect(await prepare).toMatchObject({ ok: true });
    });

    it('lets pause bypass a saturated preparation queue', async () => {
        const finishes: Array<(value: unknown) => void> = [];
        const contents = {
            isDestroyed: () => false,
            getURL: () => 'https://music.apple.com/',
            executeJavaScript: vi.fn((expression: string) => expression.includes('"operation":"prepareNext"')
                ? new Promise(resolve => { finishes.push(resolve); }) : Promise.resolve({ ok: true, data: {} })),
        };
        const dispatch = createRequestDispatcher(() => contents, 1000);
        const preparations = Array.from({ length: 4 }, (_, index) => dispatch({ id: 'prepare_' + index,
            operation: 'prepareNext', params: { catalogId: '123', nextIds: ['456'] } }));
        await Promise.resolve();
        await Promise.resolve();
        expect(await dispatch({ id: 'pause', operation: 'pause' })).toMatchObject({ ok: true });
        for (let index = 0; index < 4; index++) {
            await vi.waitFor(() => expect(finishes.length).toBeGreaterThan(index));
            finishes[index]({ ok: true });
        }
        await Promise.all(preparations);
    });

});
