import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { useNeteaseApiStatusStore } from '@/services/onlineMusic/netease/useNeteaseApiStatusStore';
import type { ProviderNotice } from '@/types/onlineMusic';

// test/unit/onlineMusic/providerWatch.test.ts
// What a provider watches while the app is open (`watch`) is declared by its adapter and started
// through omni.watchProviders; App names no provider for it. Pinned here: which adapters declare
// it, and what the one that does (the desktop app's local NetEase service) tells and mirrors.

type Status = { status: string; error: string | null; updatedAt: number };

// The desktop bridge as the watcher uses it: the status read at start, and a way to push a change.
const makeBridge = (initial: Status) => {
    let push: ((status: Status) => void) | null = null;
    return {
        bridge: {
            getNeteaseApiStatus: async () => initial,
            onNeteaseApiStatusChanged: (listener: (status: Status) => void) => {
                push = listener;
                return () => { push = null; };
            },
        },
        change: (status: Status) => push?.(status),
        isListening: () => push !== null,
    };
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
let updatedAt = 1000;
const status = (state: string, error: string | null = null): Status => ({ status: state, error, updatedAt: updatedAt += 1 });

describe('what a provider watches while the app is open', () => {
    const told: ProviderNotice[] = [];
    const tell = (notice: ProviderNotice) => { told.push(notice); };

    beforeEach(() => {
        told.length = 0;
        useNeteaseApiStatusStore.setState({ supported: false, status: null, restarting: false });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('is declared only by the provider that has something to watch', () => {
        expect(listOnlineMusicProviders().filter(provider => provider.watch).map(provider => provider.id)).toEqual(['netease']);
    });

    it('does nothing where there is no desktop bridge', async () => {
        const stop = omni.watchProviders(tell);
        await settle();
        expect(told).toEqual([]);
        expect(useNeteaseApiStatusStore.getState().supported).toBe(false);
        stop();
    });

    it('mirrors the local service into the store and tells a failure once, with its own words', async () => {
        const failed = status('error', ' xeapi key missing ');
        const desktop = makeBridge(failed);
        vi.stubGlobal('window', { electron: desktop.bridge });

        const stop = omni.watchProviders(tell);
        expect(useNeteaseApiStatusStore.getState().supported).toBe(true);
        await settle();

        expect(useNeteaseApiStatusStore.getState().status).toEqual(failed);
        expect(told).toEqual([{
            type: 'error',
            textKey: 'status.neteaseApiStartupFailedDetail',
            params: { reason: 'xeapi key missing' },
            nonce: failed.updatedAt,
            durationMs: 8000,
        }]);

        // The same failure reported again is not told again; a running service tells nothing.
        desktop.change(failed);
        const running = status('running');
        desktop.change(running);
        expect(told).toHaveLength(1);
        expect(useNeteaseApiStatusStore.getState().status).toEqual(running);

        // A later failure that brings no words of its own gets the plain sentence.
        const silent = status('error');
        desktop.change(silent);
        expect(told[1]).toEqual({ type: 'error', textKey: 'status.neteaseApiStartupFailed', nonce: silent.updatedAt, durationMs: 8000 });

        stop();
        expect(desktop.isListening()).toBe(false);
    });

    // The service's sentence comes from the main process as Node wrote it, with the path of the
    // file it could not open: the message on screen and the log line both carry it whole, so a
    // report says which file it was. The paths here are made up.
    it('tells the failure in its own words, on screen and in the log, also when the status cannot be read', async () => {
        const failed = status('error', "ENOENT: no such file or directory, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\ncm\\anonymous_token'");
        vi.stubGlobal('window', { electron: makeBridge(failed).bridge });
        const stop = omni.watchProviders(tell);
        await settle();
        stop();
        expect(told[0].params).toEqual({ reason: "ENOENT: no such file or directory, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\ncm\\anonymous_token'" });

        vi.stubGlobal('window', {
            electron: { getNeteaseApiStatus: async () => { throw new Error('read C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\status.json failed'); } },
        });
        omni.watchProviders(tell)();
        await settle();
        const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
        expect(logged).toContain('Netease API failed to start');
        expect(logged).toContain('Failed to read Netease API status');
        expect(logged).toContain('anonymous_token');
    });

    it('started again, does not tell the failure it told before', async () => {
        const failed = status('error', 'port in use');
        vi.stubGlobal('window', { electron: makeBridge(failed).bridge });

        omni.watchProviders(tell)();
        const stop = omni.watchProviders(tell);
        await settle();
        stop();
        omni.watchProviders(tell);
        await settle();

        expect(told).toHaveLength(1);
    });

    it('stopped before the first answer arrives, mirrors and tells nothing', async () => {
        vi.stubGlobal('window', { electron: makeBridge(status('error', 'late')).bridge });

        omni.watchProviders(tell)();
        await settle();

        expect(told).toEqual([]);
        expect(useNeteaseApiStatusStore.getState().status).toBeNull();
    });
});
