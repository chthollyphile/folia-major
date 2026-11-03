import { createRequire } from 'module';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

// test/unit/electron/ffmpegRuntimeSlots.test.ts
// The mod exporters and the transcode fallback share one resolver but need different binaries:
// the bundled runtime is audio-only and cannot answer a transparent video export, and a full
// build dropped in for exports carries codecs the shipped runtime lacks. These tests lock all
// three candidate slots apart - environment override, in-repo directory, packaged directory -
// and lock the packaging destination to the one the transcode fallback actually looks in.

const require = createRequire(import.meta.url);
const {
    resolveFfmpeg,
    MODS_RUNTIME_DIR,
    TRANSCODE_RUNTIME_DIR,
    RUNTIME_SLOTS,
    FFMPEG_BINARY_NAME,
} = require('../../../electron/ffmpeg.cjs') as {
    resolveFfmpeg: (options: { appGetAppPath: () => string; packagedDirName?: string; }) => Promise<{ candidates: string[]; }>;
    MODS_RUNTIME_DIR: string;
    TRANSCODE_RUNTIME_DIR: string;
    RUNTIME_SLOTS: Record<string, { envVar: string; localDirName: string }>;
    FFMPEG_BINARY_NAME: string;
};

const RESOURCES = path.join('/tmp', 'folia-resources-fixture');
const APP_PATH = path.join('/tmp', 'folia-app-fixture');
const MODS_SLOT = RUNTIME_SLOTS[MODS_RUNTIME_DIR];
const TRANSCODE_SLOT = RUNTIME_SLOTS[TRANSCODE_RUNTIME_DIR];
const originalResourcesPath = process.resourcesPath;
const originalOverrides = new Map(
    [MODS_SLOT.envVar, TRANSCODE_SLOT.envVar].map(name => [name, process.env[name]] as const),
);

// `resourcesPath` only exists inside Electron, so the packaged candidate has to be simulated.
const withResourcesPath = async (packagedDirName: string | undefined, env: Record<string, string> = {}) => {
    Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true });
    originalOverrides.forEach((_value, name) => { delete process.env[name]; });
    Object.entries(env).forEach(([name, value]) => { process.env[name] = value; });
    const result = await resolveFfmpeg({ appGetAppPath: () => APP_PATH, packagedDirName });
    return result.candidates;
};

afterEach(() => {
    Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true });
    originalOverrides.forEach((value, name) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    });
});

describe('ffmpeg runtime slots', () => {
    it('keeps the bundled audio-only runtime out of the mod exporters slot', () => {
        expect(TRANSCODE_RUNTIME_DIR).not.toBe(MODS_RUNTIME_DIR);
        expect(TRANSCODE_SLOT.envVar).not.toBe(MODS_SLOT.envVar);
        expect(TRANSCODE_SLOT.localDirName).not.toBe(MODS_SLOT.localDirName);
    });

    it('offers the mods slot to a caller that does not ask for another', async () => {
        const candidates = await withResourcesPath(undefined);
        expect(candidates).toContain(path.join(RESOURCES, MODS_RUNTIME_DIR, FFMPEG_BINARY_NAME));
        expect(candidates).not.toContain(path.join(RESOURCES, TRANSCODE_RUNTIME_DIR, FFMPEG_BINARY_NAME));
    });

    it('offers only the audio runtime to the transcode fallback', async () => {
        const candidates = await withResourcesPath(TRANSCODE_RUNTIME_DIR);
        expect(candidates).toContain(path.join(RESOURCES, TRANSCODE_RUNTIME_DIR, FFMPEG_BINARY_NAME));
        expect(candidates).not.toContain(path.join(RESOURCES, MODS_RUNTIME_DIR, FFMPEG_BINARY_NAME));
    });

    it('gives each caller its own in-repo directory, which is what dev resolves from', async () => {
        const modsCandidates = await withResourcesPath(MODS_RUNTIME_DIR);
        const transcodeCandidates = await withResourcesPath(TRANSCODE_RUNTIME_DIR);
        const modsLocal = path.join(APP_PATH, MODS_SLOT.localDirName, FFMPEG_BINARY_NAME);
        const transcodeLocal = path.join(APP_PATH, TRANSCODE_SLOT.localDirName, FFMPEG_BINARY_NAME);

        expect(modsCandidates).toContain(modsLocal);
        expect(modsCandidates).not.toContain(transcodeLocal);
        expect(transcodeCandidates).toContain(transcodeLocal);
        expect(transcodeCandidates).not.toContain(modsLocal);
    });

    it('does not let one caller\'s environment override re-point the other', async () => {
        const modsOverride = path.join('/tmp', 'folia-mods-ffmpeg');
        const transcodeOverride = path.join('/tmp', 'folia-transcode-ffmpeg');
        const env = { [MODS_SLOT.envVar]: modsOverride, [TRANSCODE_SLOT.envVar]: transcodeOverride };

        const modsCandidates = await withResourcesPath(MODS_RUNTIME_DIR, env);
        const transcodeCandidates = await withResourcesPath(TRANSCODE_RUNTIME_DIR, env);

        expect(modsCandidates[0]).toBe(modsOverride);
        expect(modsCandidates).not.toContain(transcodeOverride);
        expect(transcodeCandidates[0]).toBe(transcodeOverride);
        expect(transcodeCandidates).not.toContain(modsOverride);
    });

    it('packages the bundled runtime into the directory the transcode fallback reads', () => {
        const destinations = packageJson.build.extraResources
            .filter(entry => typeof entry.from === 'string' && entry.from.startsWith('build/ffmpeg/'))
            .map(entry => entry.to);
        expect(destinations).toEqual([TRANSCODE_RUNTIME_DIR]);
    });
});
