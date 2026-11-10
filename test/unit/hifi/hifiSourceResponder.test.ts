import { describe, expect, it, vi } from 'vitest';
import { createHifiSourceResponder, createSourceKey } from '@/services/hifi/hifiSourceResponder';
import type { HifiReadRequest, HifiReadResponse } from '@/types/hifi';

// test/unit/hifi/hifiSourceResponder.test.ts
// 源桥向渲染端要本地文件的字节：按偏移切片、越过文件尾截断、未知键和读失败各回对应状态。

const BYTES = Uint8Array.from({ length: 10 }, (_, index) => index);

const makeFile = () => new File([BYTES], 'song.flac', { type: 'audio/flac' });

const request = (overrides: Partial<HifiReadRequest> = {}): HifiReadRequest => ({
    readId: 'read-1',
    sourceKey: 'source-a',
    offset: 0,
    length: 4,
    ...overrides,
});

const setup = () => {
    const replies: Array<{ readId: string; response: HifiReadResponse }> = [];
    const respond = vi.fn((readId: string, response: HifiReadResponse) => {
        replies.push({ readId, response });
    });
    const responder = createHifiSourceResponder({ respond });
    responder.register('source-a', makeFile());
    return { responder, respond, replies };
};

const bytesOf = (response: HifiReadResponse) => {
    expect(response.status).toBe('ok');
    return response.status === 'ok' ? Array.from(response.data) : [];
};

describe('hifi source responder', () => {
    it('answers a read with the bytes at that offset and sends the same answer back', async () => {
        const { responder, replies } = setup();

        const head = await responder.handleRead(request({ offset: 0, length: 4 }));
        expect(bytesOf(head)).toEqual([0, 1, 2, 3]);

        const middle = await responder.handleRead(request({ readId: 'read-2', offset: 3, length: 4 }));
        expect(bytesOf(middle)).toEqual([3, 4, 5, 6]);

        expect(replies.map(reply => reply.readId)).toEqual(['read-1', 'read-2']);
        expect(replies[1].response).toBe(middle);
    });

    it('returns the tail exactly and clamps a length that runs past the end', async () => {
        const { responder } = setup();

        expect(bytesOf(await responder.handleRead(request({ offset: 6, length: 4 })))).toEqual([6, 7, 8, 9]);
        expect(bytesOf(await responder.handleRead(request({ offset: 8, length: 1024 })))).toEqual([8, 9]);
        expect(bytesOf(await responder.handleRead(request({ offset: 10, length: 4 })))).toEqual([]);
    });

    it('says unknown-source for a key it never had', async () => {
        const { responder, replies } = setup();

        const response = await responder.handleRead(request({ sourceKey: 'source-b' }));

        expect(response).toEqual({ status: 'unknown-source' });
        expect(replies).toEqual([{ readId: 'read-1', response: { status: 'unknown-source' } }]);
    });

    it('says failed when the file cannot be read', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { responder } = setup();
        const broken = makeFile();
        const readError = new Error('NotReadableError');
        vi.spyOn(broken, 'slice').mockReturnValue({
            arrayBuffer: () => Promise.reject(readError),
        } as unknown as Blob);
        responder.register('source-broken', broken);

        const response = await responder.handleRead(request({ sourceKey: 'source-broken' }));

        expect(response).toEqual({ status: 'failed' });
        expect(warn).toHaveBeenCalledWith('[HiFi] source read failed', readError);
        warn.mockRestore();
    });

    it('says failed for a range that is not a non-negative integer', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { responder } = setup();

        expect(await responder.handleRead(request({ offset: -1 }))).toEqual({ status: 'failed' });
        expect(await responder.handleRead(request({ length: Number.NaN }))).toEqual({ status: 'failed' });
        warn.mockRestore();
    });

    it('forgets a source on unregister and every source on clear', async () => {
        const { responder } = setup();
        responder.register('source-b', makeFile());

        responder.unregister('source-a');
        expect(responder.has('source-a')).toBe(false);
        expect(responder.has('source-b')).toBe(true);
        expect(await responder.handleRead(request({ sourceKey: 'source-a' }))).toEqual({ status: 'unknown-source' });

        responder.clear();
        expect(responder.has('source-b')).toBe(false);
        expect(await responder.handleRead(request({ sourceKey: 'source-b' }))).toEqual({ status: 'unknown-source' });
    });

    it('still resolves when sending the reply throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sendError = new Error('window gone');
        const responder = createHifiSourceResponder({ respond: () => Promise.reject(sendError) });
        responder.register('source-a', makeFile());

        expect(bytesOf(await responder.handleRead(request()))).toEqual([0, 1, 2, 3]);
        expect(warn).toHaveBeenCalledWith('[HiFi] source read reply failed', sendError);
        warn.mockRestore();
    });
});

describe('createSourceKey', () => {
    it('makes 32 hex characters, different every time', () => {
        const keys = new Set(Array.from({ length: 20 }, () => createSourceKey()));

        expect(keys.size).toBe(20);
        for (const key of keys) {
            expect(key).toMatch(/^[0-9a-f]{32}$/);
        }
    });
});
