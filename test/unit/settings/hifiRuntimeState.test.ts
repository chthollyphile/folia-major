import { describe, expect, it } from 'vitest';
import type { HifiInstallProgress, HifiRuntimeStatus } from '../../../src/types/hifi';
import {
    canOfferRuntimeDownload,
    isRuntimeInstalling,
    runtimeLine,
} from '../../../src/components/modal/settings/pages/hifi/runtimeState';

// test/unit/settings/hifiRuntimeState.test.ts
// The questions the HiFi page's runtime row and the palette's mpv commands share: is a download
// running, is a download or update on offer, and which line names the mpv in use.

const runtime = (download: Partial<HifiRuntimeStatus['download']> = {}, patch: Partial<HifiRuntimeStatus> = {}): HifiRuntimeStatus => ({
    available: true,
    path: '/Applications/mpv.app/Contents/MacOS/mpv',
    version: '0.40.0',
    source: 'system',
    errorCode: null,
    manualPathRejected: false,
    platform: 'darwin',
    arch: 'arm64',
    download: { supported: true, version: '0.41.0', installedVersion: null, updateAvailable: false, installing: false, ...download },
    dopCapable: false,
    ...patch,
});

const progress = (phase: HifiInstallProgress['phase']): HifiInstallProgress => ({
    phase,
    version: '0.41.0',
    receivedBytes: 1,
    totalBytes: 2,
    errorCode: null,
});

const t = (key: string, values?: Record<string, string>) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe('the HiFi runtime state', () => {
    it('counts a download as running from the status or from its progress', () => {
        expect(isRuntimeInstalling(runtime({ installing: true }), null)).toBe(true);
        expect(isRuntimeInstalling(runtime(), progress('downloading'))).toBe(true);
        expect(isRuntimeInstalling(runtime(), progress('extracting'))).toBe(true);
        expect(isRuntimeInstalling(runtime(), progress('done'))).toBe(false);
        expect(isRuntimeInstalling(null, null)).toBe(false);
    });

    it('offers the download where nothing is installed or something newer is out', () => {
        expect(canOfferRuntimeDownload(runtime(), null, 'darwin')).toBe(true);
        expect(canOfferRuntimeDownload(runtime({ installedVersion: '0.40.0', updateAvailable: true }), null, 'win32')).toBe(true);
        expect(canOfferRuntimeDownload(runtime({ installedVersion: '0.41.0' }), null, 'win32')).toBe(false);
    });

    it('offers no download on Linux, without a build, while one runs, or before the runtime is known', () => {
        expect(canOfferRuntimeDownload(runtime(), null, 'linux')).toBe(false);
        expect(canOfferRuntimeDownload(runtime({ supported: false }), null, 'win32')).toBe(false);
        expect(canOfferRuntimeDownload(runtime(), progress('verifying'), 'win32')).toBe(false);
        expect(canOfferRuntimeDownload(null, null, 'win32')).toBe(false);
    });

    it('names the mpv in use, or why there is none', () => {
        expect(runtimeLine(runtime(), t)).toEqual({ tone: 'ok', text: 'hifi.settings.runtimeFound:{"version":"0.40.0","source":"hifi.settings.sourceSystem"}' });
        expect(runtimeLine(runtime({}, { available: false, version: '0.36.0', errorCode: 'MPV_TOO_OLD' }), t))
            .toEqual({ tone: 'warn', text: 'hifi.settings.runtimeTooOld:{"version":"0.36.0"}' });
        expect(runtimeLine(runtime({}, { available: false, errorCode: 'MPV_NOT_FOUND' }), t)).toEqual({ tone: 'warn', text: 'hifi.settings.runtimeNotFound' });
        expect(runtimeLine(null, t)).toEqual({ text: 'hifi.settings.runtimeChecking' });
    });
});
