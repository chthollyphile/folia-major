// @builtin-sources
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { createNeteaseCore, type NeteaseTestCore } from '../helpers/neteaseSource';

// test/unit/onlineMusic/providerWatch.test.ts
// What a provider watches while the app is open (`watch`, started through omni.watchProviders) was declared by one
// adapter only, the built-in NetEase one, for its local service. That service is now the API in the NetEase source
// mod's main entry (sources/netease/main): the main entry pushes each change of its state (rpc.send('status')), the
// client hands it to noteNeteaseBackendStatus, and a failure to start is told once through handle.notify, which the
// adapter's `watch` passes on (every source's provider has it). Pinned here: that, and what the mod tells of its
// service.

type Status = { status: string; port: number | null; error: string | null; updatedAt: number; offline?: boolean };

let updatedAt = 1000;
const status = (state: string, error: string | null = null, extra: Partial<Status> = {}): Status => ({
    status: state,
    port: state === 'running' ? 3000 : null,
    error,
    updatedAt: updatedAt += 1,
    ...extra,
});

describe('what a provider watches while the app is open', () => {
    it('is, for every registered provider, only who listens for what the source tells (handle.notify)', () => {
        const providers = listOnlineMusicProviders();
        expect(providers.map(provider => provider.id)).toContain('netease');
        expect(providers.filter(provider => !provider.watch).map(provider => provider.id)).toEqual([]);
    });
});

describe('the NetEase source tells a failure of its local service', () => {
    let core: NeteaseTestCore;
    let note: (status: Status | null) => void;

    beforeEach(async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        core = await createNeteaseCore({ desktop: true });
        ({ noteNeteaseBackendStatus: note } = await import('../../../sources/netease/core') as unknown as { noteNeteaseBackendStatus: typeof note });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('once, with its own words; the same failure pushed again and a running service tell nothing', () => {
        const failed = status('error', ' xeapi key missing ');
        note(failed);
        expect(core.notices).toEqual([{
            type: 'error',
            text: { i18nKey: 'status.startupFailedDetail', params: { reason: 'xeapi key missing' } },
            nonce: failed.updatedAt,
            durationMs: 8000,
        }]);

        note(failed);
        note(status('running'));
        expect(core.notices).toHaveLength(1);

        // A later failure that brings no words of its own gets the plain sentence.
        const silent = status('error');
        note(silent);
        expect(core.notices[1]).toEqual({ type: 'error', text: { i18nKey: 'status.startupFailed' }, nonce: silent.updatedAt, durationMs: 8000 });
    });

    // The service's sentence comes from the worker as Node wrote it, with the path of the file it could not open: the
    // message on screen and the log line both carry it whole, so a report says which file it was. The path is made up.
    it('in its own words, on screen and in the log', () => {
        const reason = "ENOENT: no such file or directory, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\ncm\\anonymous_token'";
        note(status('error', reason));
        expect(core.notices).toMatchObject([{ text: { params: { reason } } }]);
        const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
        expect(logged).toContain('the NetEase API failed to start');
        expect(logged).toContain('anonymous_token');
    });

    it('not when it failed because the machine is offline: the request that needs it says so instead', () => {
        note(status('error', 'getaddrinfo ENOTFOUND', { offline: true }));
        expect(core.notices).toEqual([]);
    });

    it('made again (switched off and on), forgets what it told and the state it was told', async () => {
        const failed = status('error', 'port in use');
        note(failed);
        const again = await createNeteaseCore({ desktop: true });
        note(failed);
        expect(again.notices).toHaveLength(1);
    });
});
