// @builtin-sources
import { describe, expect, it, vi } from 'vitest';
import { requestBodian } from '../../../sources/bodian/client/bodianTransport';
import { describeBodianFailure } from '../../../sources/bodian/client/bodianFailure';
import { OnlineProviderError } from '@/types/onlineMusic';
import { setBuiltinSourceRpc } from '../helpers/builtinSources';
import { bodianProvider, hostBodianSong } from '../helpers/bodianSource';

// test/unit/onlineMusic/bodianTransport.test.ts
// The transport of the Bodian source mod: what the main entry's `request` answers (the bridge's { ok, data } or
// { ok: false, error }) is set here per case. Folium 2.0 S5: the source only runs in the desktop window, next to its
// main entry, so "no desktop bridge" (the web build) is no case of its own any more; an error names its provider once
// it has passed the host's adapter, so the cases that read `providerId` go through the registered provider.

/** The main entry's `request`, as the bridge: `answer` is what the bridge hands back (or how it fails). */
const bridge = (answer: (...args: unknown[]) => unknown) => {
    const bodianRequest = vi.fn(answer);
    setBuiltinSourceRpc('bodian', { request: bodianRequest });
    return bodianRequest;
};
const someSong = () => hostBodianSong({ id: 1, name: 'Song' });

// 取出 requestBodian 的拒绝值；意外 resolve 时让用例失败。
const rejectionOf = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error('expected requestBodian to reject'); },
    (caught: unknown) => caught as OnlineProviderError,
);

describe('Bodian page-size adaptation', () => {
    it.each([150, 1000])('bounds the GridView batch of %s while preserving its physical cursor', async limit => {
        const data = { list: [{ id: 1 }], bodianPagination: { nextOffset: 200, hasMore: true } };
        const bodianRequest = bridge(async () => ({ ok: true, data }));
        expect(await requestBodian('playlist_tracks', { id: '123', limit, offset: 100, source: 5 })).toEqual(data);
        expect(bodianRequest).toHaveBeenCalledWith('playlist_tracks', { id: '123', limit: 100, offset: 100, source: 5 });
    });
});

// What the errors mean for playback and the grid is bodianFailure.ts's to say: these read the facts through it.
describe('Bodian transport failures', () => {
    it('reports a rejected IPC call as the local service failing and keeps the cause', async () => {
        const ipcFailure = new Error('IPC channel closed');
        bridge(async () => { throw ipcFailure; });
        const error = await rejectionOf(requestBodian('audio', { id: '1' }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error.cause).toBe(ipcFailure);
        expect(describeBodianFailure('audio', error)).toEqual({ case: 'local-service-stopped' });
    });

    it.each([
        [{ code: 'network', message: 'Bodian request timed out' }, 'network', null],
        [{ code: 'network', message: 'Bodian HTTP 503' }, 'network', { httpStatus: 503 }],
        [{ code: 'not-playable', message: 'Bodian requires additional playback rights' }, 'not-playable', { case: 'entitlement-required' }],
        [{ code: 'not-playable', message: 'Bodian preview is unavailable' }, 'not-playable', { case: 'preview-only' }],
        [{ code: 'auth-required', message: 'Bodian requires additional playback rights' }, 'auth-required', { signedOut: true }],
        [{ code: 'auth-required', message: 'Bodian rejected the request (code 11012)' }, 'auth-required', { code: '11012' }],
        [{ code: 'region-restricted', message: '由于版权保护，该资源仅限中国大陆地区使用' },
            'region-restricted', { message: '由于版权保护，该资源仅限中国大陆地区使用' }],
    ])('hands the package error %j on as it was, and says what it means', async (bridgeError, code, said) => {
        bridge(async () => ({ ok: false, error: bridgeError }));
        const error = await rejectionOf(bodianProvider().playback!.getAudioSource(someSong(), 'standard'));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({ providerId: 'bodian', code, message: bridgeError.message });
        expect(describeBodianFailure('audio', error)).toEqual(said);
    });

    it('keeps auth-required for library sign-in failures so session cleanup still runs', async () => {
        const bridgeError = { code: 'auth-required', message: 'Bodian sign-in is required' };
        bridge(async () => ({ ok: false, error: bridgeError }));
        await expect(requestBodian('user_albums')).rejects.toMatchObject({ code: 'auth-required', message: 'Bodian sign-in is required' });
    });
});
