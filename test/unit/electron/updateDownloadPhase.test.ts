import { describe, expect, it } from 'vitest';
import { createUpdateDownloadPhase, getInstallerSize } from '../../../electron/updateDownloadPhase.cjs';

// test/unit/electron/updateDownloadPhase.test.ts
// Telling the updater's differential download from the full one it falls back to, by the progress total.

const info = {
    files: [
        { url: 'Folia-Setup-1.0.0.exe.blockmap', size: 90 },
        { url: 'Folia-Setup-1.0.0.EXE', size: 1000 },
    ],
};

describe('getInstallerSize', () => {
    it('reads the size of the first .exe file', () => {
        expect(getInstallerSize(info)).toBe(1000);
    });

    it('is null without a usable size', () => {
        expect(getInstallerSize({ files: [{ url: 'a.exe' }] })).toBeNull();
        expect(getInstallerSize(null)).toBeNull();
    });
});

describe('createUpdateDownloadPhase', () => {
    it('marks the full download after a differential one as a fallback', () => {
        const phase = createUpdateDownloadPhase();
        phase.setInstaller(info);
        expect(phase.phaseOf({ total: 300 })).toEqual({ mode: 'differential', fallback: false });
        expect(phase.phaseOf({ total: 1000 })).toEqual({ mode: 'full', fallback: true });
    });

    it('a full download on its own is not a fallback', () => {
        const phase = createUpdateDownloadPhase();
        phase.setInstaller(info);
        expect(phase.phaseOf({ total: 1000 })).toEqual({ mode: 'full', fallback: false });
    });

    it('a full download without a length after a differential one is still the fallback', () => {
        const phase = createUpdateDownloadPhase();
        phase.setInstaller(info);
        phase.phaseOf({ total: 300 });
        expect(phase.phaseOf({})).toEqual({ mode: 'full', fallback: true });
    });

    it('finding the same update again during its download keeps the fallback', () => {
        const phase = createUpdateDownloadPhase();
        phase.setInstaller({ ...info, version: '1.0.0' });
        phase.phaseOf({ total: 300 });
        phase.setInstaller({ ...info, version: '1.0.0' });
        expect(phase.phaseOf({ total: 1000 })).toEqual({ mode: 'full', fallback: true });
    });

    it('does not guess without the installer size', () => {
        const phase = createUpdateDownloadPhase();
        phase.setInstaller({ files: [] });
        expect(phase.phaseOf({ total: 300 })).toEqual({ mode: null, fallback: false });
    });

    it('forgets the differential download when the download restarts or the update changes', () => {
        const phase = createUpdateDownloadPhase();
        phase.setInstaller(info);
        phase.phaseOf({ total: 300 });
        phase.restart();
        expect(phase.phaseOf({ total: 1000 }).fallback).toBe(false);
        phase.phaseOf({ total: 300 });
        phase.setInstaller({ ...info, version: '1.0.1' });
        expect(phase.phaseOf({ total: 1000 }).fallback).toBe(false);
    });
});
