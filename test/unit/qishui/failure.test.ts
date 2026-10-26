import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qishuiProvider } from '@/services/onlineMusic/qishui/qishuiProvider';
import { describeQishuiFailure } from '@/services/onlineMusic/qishui/qishuiFailure';
import { clearQishuiPlayback, readQishuiSongs } from '@/services/onlineMusic/qishui/qishuiPlayback';
import { readQishuiSceneIcon, requestQishui } from '@/services/onlineMusic/qishui/qishuiTransport';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import { omni } from '@/services/onlineMusic/omni';
import { track } from './fixtures';

// What a failed Qishui request means to the shared failure rules, to the sign-in diagnostics and to a
// look-up by id; the bridge answers with the package's own codes and sentences.
const request = vi.fn();
beforeEach(() => {
    clearQishuiPlayback();
    request.mockReset();
    vi.stubGlobal('window', { electron: { qishuiRequest: request } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const thrownBy = async (reply: () => unknown) => {
    request.mockImplementationOnce(reply);
    try { await requestQishui('audio', { id: '1', quality: 'standard' }); } catch (error) { return error; }
    throw new Error('the request did not fail');
};
const caseOf = (error: unknown) => onlineFailureOf({ operation: 'audio', providerId: 'qishui' },
    { error, detail: describeQishuiFailure('audio', error) ?? undefined });
const refusal = (code: string, message: string, upstreamCode?: string) => async () => ({ ok: false, error: { code, message, upstreamCode } });

describe('Qishui failure cases', () => {
    it('names the web build, where there is no desktop bridge, as not configured', async () => {
        vi.stubGlobal('window', {});
        let error: unknown;
        try { await requestQishui('audio', { id: '1', quality: 'standard' }); } catch (thrown) { error = thrown; }
        expect(describeQishuiFailure('audio', error)).toEqual({ case: 'not-configured' });
        expect(caseOf(error).case).toBe('not-configured');
    });
    it('names a failed bridge call as the local side stopping, not the network', async () => {
        const error = await thrownBy(async () => { throw new Error('An object could not be cloned.'); });
        expect(describeQishuiFailure('audio', error)).toEqual({ case: 'local-service-stopped' });
        expect(caseOf(error).case).toBe('local-service-stopped');
    });
    it('names protected audio only as no playable audio, without a pointless retry', async () => {
        const error = await thrownBy(refusal('unsupported', 'Qishui returned protected audio only; decryption is disabled'));
        const shown = caseOf(error);
        expect(shown.case).toBe('no-audio');
        expect(shown.facts.message).toBeUndefined();
    });
    it('names a media the service will not serve as taken down, not as a missing address', async () => {
        const error = await thrownBy(refusal('not-playable', 'Qishui did not return the track'));
        expect(describeQishuiFailure('audio', error)).toEqual({ case: 'taken-down' });
        expect(caseOf(error).case).toBe('taken-down');
    });
    it('says "sign in to play" when nobody is signed in', async () => {
        const error = await thrownBy(refusal('auth-required', 'Sign in to Qishui first'));
        expect(caseOf(error)).toMatchObject({ case: 'sign-in-needed', facts: { signedOut: true } });
        const expired = await thrownBy(refusal('auth-required', 'Qishui rejected the request', '28001003'));
        expect(caseOf(expired)).toMatchObject({ case: 'sign-in-needed', facts: { code: '28001003' } });
        expect(caseOf(expired).facts.signedOut).toBeUndefined();
    });
    it('reads the HTTP status and the platform code from the package sentences', async () => {
        expect(caseOf(await thrownBy(refusal('network', 'Qishui HTTP 503')))).toMatchObject({ case: 'unreachable', facts: { httpStatus: 503 } });
        expect(caseOf(await thrownBy(refusal('unavailable', 'Qishui HTTP 429')))).toMatchObject({ case: 'retry-later', facts: { httpStatus: 429 } });
        expect(caseOf(await thrownBy(refusal('unavailable', 'Qishui rejected the request', '4001')))).toMatchObject({ case: 'refused', facts: { code: '4001' } });
    });
    it('leaves what it does not know to the shared rules, and other providers alone', async () => {
        expect(describeQishuiFailure('audio', await thrownBy(refusal('invalid-response', 'Qishui operation failed')))).toBeNull();
        expect(describeQishuiFailure('audio', new Error('Qishui requires the desktop app'))).toBeNull();
        expect(caseOf(await thrownBy(refusal('network', 'Qishui service could not be reached'))).case).toBe('unreachable');
    });
    it('is the provider\'s describeFailure', () => {
        expect(qishuiProvider.describeFailure).toBe(describeQishuiFailure);
    });
});

describe('Qishui playability records', () => {
    it('reads the service\'s own record before the risk check', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { statuses: [
            { id: '1', riskResult: 0, status: 0 },
            { id: '2', riskResult: -2, status: 20 },
            { id: '3', riskResult: -2, status: 10 },
            { id: '4', riskResult: -2, status: 0 },
        ] } });
        const songs = await readQishuiSongs(['1', '2', '3', '4', '5'].map(id => track(id)));
        const availability = (index: number) => qishuiProvider.playback!.getAvailability!(songs[index]);
        expect(availability(0)).toEqual({ state: 'playable' });
        // A media the service will not serve, though the risk check says nothing about it.
        expect(availability(1)).toEqual({ state: 'unavailable', reason: 'taken-down' });
        // Encrypted audio only is a restriction, not a takedown.
        expect(availability(2)).toEqual({ state: 'unknown', reason: 'restricted' });
        // Served, with no risk result either way, and a media the answer did not mention: both unknown.
        expect(availability(3)).toEqual({ state: 'unknown' });
        expect(availability(4)).toEqual({ state: 'unknown' });
    });
});

describe('Qishui sign-in diagnostics', () => {
    it('reports only failures of sign-in operations', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { key: 'a'.repeat(32) } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'invalid-response', message: 'Qishui did not identify the account', stage: 'account' } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable', message: 'Qishui rejected the request', upstreamCode: '4001' } });
        await qishuiProvider.auth!.startLogin!();
        await expect(requestQishui('login_qr_check', { key: 'a'.repeat(32) })).rejects.toMatchObject({ code: 'invalid-response' });
        // A lyric read in the background while the sign-in window is open is not the sign-in's failure.
        await expect(requestQishui('lyrics', { id: '1' })).rejects.toMatchObject({ code: 'unavailable' });
        const lines = await qishuiProvider.auth!.getLoginDiagnostics!();
        expect(lines).toHaveLength(1);
        expect(lines[0].text).toContain('stage=account code=invalid-response');
        expect(lines[0].text).not.toContain('4001');
    });
    it('reports nothing when only other requests failed since the sign-in began', async () => {
        request.mockResolvedValueOnce({ ok: true, data: { key: 'b'.repeat(32) } })
            .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'Qishui HTTP 502' } });
        await qishuiProvider.auth!.startLogin!();
        await expect(requestQishui('feed', { queue: 'fm' })).rejects.toMatchObject({ code: 'network' });
        expect(await qishuiProvider.auth!.getLoginDiagnostics!()).toEqual([]);
    });
});

describe('Qishui song look-up by id', () => {
    it('reports a track the service did not return as missing, and other failures as failed', async () => {
        request.mockImplementation(async (operation: string, params: { id?: string }) => {
            if (operation === 'check_tracks') return { ok: true, data: { statuses: [] } };
            if (params.id === '1') return { ok: true, data: track('1') };
            if (params.id === '2') return { ok: false, error: { code: 'not-playable', message: 'Qishui did not return the track' } };
            return { ok: false, error: { code: 'network', message: 'Qishui service could not be reached' } };
        });
        const details = await omni.getSongDetails('qishui', ['1', '2', '3']);
        expect(details.map(detail => detail.status)).toEqual(['found', 'missing', 'failed']);
        expect(details[0]).toMatchObject({ song: { id: '1', sourceRef: { providerId: 'qishui', mediaId: '1' } } });
        await expect(omni.getSongDetail('qishui', '2')).resolves.toBeNull();
    });
});

describe('Qishui scene icons', () => {
    const icon = (bytes: number[], type: string | null) => {
        const fetch = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: type ? { 'content-type': type } : {} }));
        vi.stubGlobal('fetch', fetch);
        return fetch;
    };
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const JPEG = [0xff, 0xd8, 0xff, 0xe0];
    const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    const url = 'https://p3-luna.douyinpic.com/img/scene.png~tplv-test-image.image';
    it('labels the data URL with the image\'s own type', async () => {
        icon(WEBP, 'image/png');
        expect(await readQishuiSceneIcon(url)).toMatch(/^data:image\/webp;base64,/);
        icon(JPEG, 'image/jpeg');
        expect(await readQishuiSceneIcon(url)).toMatch(/^data:image\/jpeg;base64,/);
        const fetch = icon(PNG, 'image/png; charset=binary');
        expect(await readQishuiSceneIcon(url)).toMatch(/^data:image\/png;base64,/);
        expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    });
    it('falls back to the declared raster type, and refuses what is not one', async () => {
        icon([1, 2, 3, 4], 'image/avif');
        expect(await readQishuiSceneIcon(url)).toMatch(/^data:image\/avif;base64,/);
        icon([0x3c, 0x73, 0x76, 0x67], 'image/svg+xml');
        await expect(readQishuiSceneIcon(url)).rejects.toThrow('not a raster image');
        icon(PNG, 'text/html');
        await expect(readQishuiSceneIcon(url)).rejects.toThrow('unavailable');
    });
});
