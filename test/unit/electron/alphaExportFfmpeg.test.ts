import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// test/unit/electron/alphaExportFfmpeg.test.ts
// The transparent export finds a full ffmpeg the user installed and checks what it can write before
// using it: output parsing (version, encoder and demuxer lists of several ffmpeg generations), the
// candidate places per platform, and the resolver's order (chosen file, then the search) with its
// rejection of stripped builds. Processes and the file system are faked.

const require = createRequire(import.meta.url);
const capabilities = require('../../../electron/alphaExport/ffmpegCapabilities.cjs') as {
    ALPHA_FORMATS: readonly { id: string; encoder: string; extension: string; muxer: string; args: readonly string[] }[];
    parseFfmpegVersion: (stdout: string) => string | null;
    parseCodecList: (stdout: string) => Set<string>;
    describeExportCapabilities: (input: { encoders: Set<string> | string[]; demuxers: Set<string> | string[] }) => {
        rawvideo: boolean; formats: string[]; usable: boolean; problem: string | null;
    };
};
const { listSystemFfmpegCandidates } = require('../../../electron/alphaExport/systemFfmpegLocator.cjs') as {
    listSystemFfmpegCandidates: (options: { platform: string; env?: Record<string, string>; homedir?: string; readdir?: (dir: string) => string[] }) => string[];
};
const { createExportFfmpegResolver, probeFfmpegBinary, MANUAL_PATH_STORE_KEY } = require('../../../electron/alphaExport/exportFfmpeg.cjs') as {
    createExportFfmpegResolver: (options: Record<string, unknown>) => {
        resolve: (options?: { refresh?: boolean }) => Promise<ResolvedStatus>;
        chooseManual: (filePath: string) => Promise<{ ok: boolean; problem: string | null; status: ResolvedStatus }>;
        clearManual: () => Promise<ResolvedStatus>;
    };
    probeFfmpegBinary: (ffmpegPath: string, options: Record<string, unknown>) => Promise<{ ok: boolean; version: string | null; formats: string[]; problem: string | null }>;
    MANUAL_PATH_STORE_KEY: string;
};

type ResolvedStatus = {
    available: boolean; source: string | null; path: string | null; version: string | null; formats: string[];
    manualPath: string | null; manualProblem: string | null; checked: { path: string; problem: string | null }[];
};

const VERSION_GYAN_5 = 'ffmpeg version 5.1.2-essentials_build-www.gyan.dev Copyright (c) 2000-2022 the FFmpeg developers\nbuilt with gcc 12.1.0\n';
const VERSION_BREW_7 = 'ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n';

const ENCODERS_FULL = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D a64multi             Multicolor charset for Commodore 64 (codec a64_multi)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 VFS... prores_ks            Apple ProRes (iCodec Pro) (codec prores)
 V..... qtrle                QuickTime Animation (RLE) video
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D flac                 FLAC (Free Lossless Audio Codec)
`;
// What the audio-only transcode runtime this app ships answers: no video encoder with alpha.
const ENCODERS_AUDIO_ONLY = ` A..... = Audio
 ------
 A....D flac                 FLAC (Free Lossless Audio Codec)
 A....D pcm_s16le            PCM signed 16-bit little-endian
`;
const DEMUXERS_FULL = `Demuxers:
 D. = Demuxing supported
 .E = Muxing supported
 --
 D  aac             raw ADTS AAC (Advanced Audio Coding)
 D  mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV
 D  rawvideo        raw video
`;
// ffmpeg 7 adds a device column: ` D d dshow`.
const DEMUXERS_DEVICES = `File formats:
 D.. = Demuxing supported
 .E. = Muxing supported
 ..d = Is a device (demuxing and/or muxing)
 ---
 D d dshow           DirectShow capture
 D   dv              DV (Digital Video)
 D   rawvideo        raw video
`;
const DEMUXERS_AUDIO_ONLY = ` --
 D  flac            raw FLAC
 D  wav             WAV / WAVE (Waveform Audio)
`;

describe('ffmpeg output parsing', () => {
    it('reads the version token of the first line', () => {
        expect(capabilities.parseFfmpegVersion(VERSION_GYAN_5)).toBe('5.1.2-essentials_build-www.gyan.dev');
        expect(capabilities.parseFfmpegVersion(VERSION_BREW_7)).toBe('7.1.1');
        expect(capabilities.parseFfmpegVersion('ffprobe version 7.1\n')).toBeNull();
        expect(capabilities.parseFfmpegVersion('')).toBeNull();
    });

    it('lists encoder names under the rule and skips the legend', () => {
        const names = capabilities.parseCodecList(ENCODERS_FULL);
        expect([...names]).toEqual(expect.arrayContaining(['prores_ks', 'qtrle', 'libvpx-vp9', 'libx264', 'flac']));
        expect(names.has('=')).toBe(false);
        expect(names.has('Video')).toBe(false);
    });

    it('splits comma-joined demuxer names and skips the device column', () => {
        const names = capabilities.parseCodecList(DEMUXERS_FULL);
        expect(names.has('rawvideo')).toBe(true);
        expect(names.has('mov')).toBe(true);
        expect(names.has('mp4')).toBe(true);
        const devices = capabilities.parseCodecList(DEMUXERS_DEVICES);
        expect(devices.has('dshow')).toBe(true);
        expect(devices.has('dv')).toBe(true);
        expect(devices.has('rawvideo')).toBe(true);
        expect(devices.has('d')).toBe(false);
    });

    it('offers only the formats whose encoder the build has, in table order', () => {
        const full = capabilities.describeExportCapabilities({
            encoders: capabilities.parseCodecList(ENCODERS_FULL),
            demuxers: capabilities.parseCodecList(DEMUXERS_FULL),
        });
        expect(full).toEqual({ rawvideo: true, formats: ['prores', 'vp9', 'qtrle'], usable: true, problem: null });
        const vp9Only = capabilities.describeExportCapabilities({ encoders: ['libvpx-vp9'], demuxers: ['rawvideo'] });
        expect(vp9Only.formats).toEqual(['vp9']);
    });

    it('refuses the audio-only runtime and a build without alpha encoders', () => {
        const audio = capabilities.describeExportCapabilities({
            encoders: capabilities.parseCodecList(ENCODERS_AUDIO_ONLY),
            demuxers: capabilities.parseCodecList(DEMUXERS_AUDIO_ONLY),
        });
        expect(audio).toMatchObject({ usable: false, problem: 'no-rawvideo', formats: [] });
        const noAlpha = capabilities.describeExportCapabilities({ encoders: ['libx264'], demuxers: ['rawvideo'] });
        expect(noAlpha).toMatchObject({ usable: false, problem: 'no-alpha-encoder' });
    });

    it('keeps an alpha pixel format in every format argument list', () => {
        for (const format of capabilities.ALPHA_FORMATS) {
            const pixFmt = format.args[format.args.indexOf('-pix_fmt') + 1];
            expect(pixFmt, format.id).toMatch(/a/);
            expect(format.args).toContain(format.encoder);
        }
    });

    it('names the container itself, so a typed file name cannot change it', () => {
        expect(Object.fromEntries(capabilities.ALPHA_FORMATS.map(format => [format.id, format.muxer])))
            .toEqual({ prores: 'mov', vp9: 'webm', qtrle: 'mov' });
    });
});

describe('system ffmpeg candidates', () => {
    it('Windows: PATH first, then winget, Scoop, Chocolatey and Program Files', () => {
        const candidates = listSystemFfmpegCandidates({
            platform: 'win32',
            env: {
                Path: 'C:\\Tools\\bin;"C:\\Quoted Dir";;C:\\ProgramData\\chocolatey\\bin',
                LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
                ProgramFiles: 'C:\\Program Files',
            },
            homedir: 'C:\\Users\\u',
            readdir: (dir: string) => {
                if (dir.endsWith('WinGet\\Packages')) return ['Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'Other.Tool'];
                if (dir.endsWith('8wekyb3d8bbwe')) return ['ffmpeg-7.0-full_build', 'ffmpeg-7.1-full_build'];
                throw new Error('ENOENT');
            },
        });
        expect(candidates.slice(0, 3)).toEqual([
            'C:\\Tools\\bin\\ffmpeg.exe',
            'C:\\Quoted Dir\\ffmpeg.exe',
            'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
        ]);
        const wingetPackage = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe';
        expect(candidates).toContain('C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe');
        // The newer unpacked version is tried first.
        expect(candidates.indexOf(`${wingetPackage}\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe`))
            .toBeLessThan(candidates.indexOf(`${wingetPackage}\\ffmpeg-7.0-full_build\\bin\\ffmpeg.exe`));
        expect(candidates).toContain('C:\\Users\\u\\scoop\\apps\\ffmpeg\\current\\bin\\ffmpeg.exe');
        expect(candidates).toContain('C:\\ProgramData\\chocolatey\\lib\\ffmpeg\\tools\\ffmpeg\\bin\\ffmpeg.exe');
        expect(candidates).toContain('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
        // Chocolatey's shim is on PATH and in its own place: probed once, case aside.
        expect(candidates.filter(c => c.toLowerCase() === 'c:\\programdata\\chocolatey\\bin\\ffmpeg.exe')).toHaveLength(1);
    });

    it('macOS: Homebrew is looked in even when PATH is the short one an app gets from Finder', () => {
        const candidates = listSystemFfmpegCandidates({ platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, homedir: '/Users/u' });
        expect(candidates).toEqual(['/usr/bin/ffmpeg', '/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/local/bin/ffmpeg']);
    });

    it('Linux: the distribution, Linuxbrew, ~/.local and snap', () => {
        const candidates = listSystemFfmpegCandidates({ platform: 'linux', env: { PATH: '' }, homedir: '/home/u' });
        expect(candidates).toEqual([
            '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/home/linuxbrew/.linuxbrew/bin/ffmpeg', '/home/u/.local/bin/ffmpeg', '/snap/bin/ffmpeg',
        ]);
    });
});

type FakeBuild = { version: string; encoders: string; demuxers: string } | 'crash';

/** execFile stand-in that answers per binary path from a table of fake builds. */
const fakeExecFile = (builds: Record<string, FakeBuild>) => (
    file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout?: string) => void,
) => {
    const build = builds[file];
    if (!build || build === 'crash') {
        callback(new Error('spawn failed'));
        return;
    }
    const flag = args[args.length - 1];
    callback(null, flag === '-version' ? build.version : flag === '-encoders' ? build.encoders : build.demuxers);
};

const FULL: FakeBuild = { version: VERSION_GYAN_5, encoders: ENCODERS_FULL, demuxers: DEMUXERS_FULL };
const AUDIO_ONLY: FakeBuild = { version: VERSION_BREW_7, encoders: ENCODERS_AUDIO_ONLY, demuxers: DEMUXERS_AUDIO_ONLY };

const memoryStore = (initial: Record<string, unknown> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
        get: (key: string) => data.get(key),
        set: (key: string, value: unknown) => { data.set(key, value); },
        delete: (key: string) => { data.delete(key); },
        data,
    };
};

const makeResolver = (builds: Record<string, FakeBuild>, store = memoryStore(), pathDirs: string[] = ['/opt/a', '/opt/b']) => createExportFfmpegResolver({
    store,
    appGetAppPath: () => '/app',
    platform: 'linux',
    env: { PATH: pathDirs.join(':') },
    homedir: '/home/u',
    readdir: () => [],
    exists: (candidate: string) => candidate in builds,
    execFileImpl: fakeExecFile(builds),
    logger: { info: () => {}, warn: () => {} },
});

describe('export ffmpeg resolver', () => {
    it('probes one binary into version, formats and a problem code', async () => {
        const builds = { '/x/ffmpeg': FULL, '/y/ffmpeg': AUDIO_ONLY, '/z/ffmpeg': 'crash' as const };
        const options = { execFileImpl: fakeExecFile(builds), exists: (p: string) => p in builds };
        await expect(probeFfmpegBinary('/x/ffmpeg', options)).resolves.toMatchObject({ ok: true, version: '5.1.2-essentials_build-www.gyan.dev', formats: ['prores', 'vp9', 'qtrle'] });
        await expect(probeFfmpegBinary('/y/ffmpeg', options)).resolves.toMatchObject({ ok: false, problem: 'no-rawvideo' });
        await expect(probeFfmpegBinary('/z/ffmpeg', options)).resolves.toMatchObject({ ok: false, problem: 'not-runnable' });
        await expect(probeFfmpegBinary('/missing', options)).resolves.toMatchObject({ ok: false, problem: 'not-found' });
    });

    it('passes over a stripped build on PATH and takes the next full one', async () => {
        const resolver = makeResolver({ '/opt/a/ffmpeg': AUDIO_ONLY, '/opt/b/ffmpeg': FULL });
        const status = await resolver.resolve();
        expect(status).toMatchObject({ available: true, source: 'auto', path: '/opt/b/ffmpeg', formats: ['prores', 'vp9', 'qtrle'] });
        expect(status.checked.map(item => [item.path, item.problem])).toEqual([['/opt/a/ffmpeg', 'no-rawvideo'], ['/opt/b/ffmpeg', null]]);
    });

    it('says none fits when every build found is stripped', async () => {
        const status = await makeResolver({ '/opt/a/ffmpeg': AUDIO_ONLY }).resolve();
        expect(status).toMatchObject({ available: false, source: null, path: null, formats: [] });
        expect(status.checked).toHaveLength(1);
    });

    it('a chosen file wins over the search and is kept in the store', async () => {
        const store = memoryStore();
        const resolver = makeResolver({ '/opt/a/ffmpeg': FULL, '/picked/ffmpeg': FULL }, store);
        expect((await resolver.resolve()).path).toBe('/opt/a/ffmpeg');
        const chosen = await resolver.chooseManual('/picked/ffmpeg');
        expect(chosen.ok).toBe(true);
        expect(chosen.status).toMatchObject({ source: 'manual', path: '/picked/ffmpeg', manualPath: '/picked/ffmpeg' });
        expect(store.data.get(MANUAL_PATH_STORE_KEY)).toBe('/picked/ffmpeg');
        const cleared = await resolver.clearManual();
        expect(cleared).toMatchObject({ source: 'auto', path: '/opt/a/ffmpeg', manualPath: null });
        expect(store.data.has(MANUAL_PATH_STORE_KEY)).toBe(false);
    });

    it('refuses to keep a chosen file that cannot export', async () => {
        const store = memoryStore();
        const resolver = makeResolver({ '/opt/a/ffmpeg': FULL, '/picked/ffmpeg': AUDIO_ONLY }, store);
        const chosen = await resolver.chooseManual('/picked/ffmpeg');
        expect(chosen).toMatchObject({ ok: false, problem: 'no-rawvideo' });
        expect(store.data.has(MANUAL_PATH_STORE_KEY)).toBe(false);
        expect(chosen.status.path).toBe('/opt/a/ffmpeg');
    });

    it('a stored choice that broke falls back to the search and says why', async () => {
        const store = memoryStore({ [MANUAL_PATH_STORE_KEY]: '/gone/ffmpeg' });
        const status = await makeResolver({ '/opt/b/ffmpeg': FULL }, store).resolve();
        expect(status).toMatchObject({ available: true, source: 'auto', path: '/opt/b/ffmpeg', manualPath: '/gone/ffmpeg', manualProblem: 'not-found' });
    });

    it('a choice made while a slow search runs is what the status ends up saying', async () => {
        const store = memoryStore();
        const builds: Record<string, FakeBuild> = { '/opt/a/ffmpeg': FULL, '/picked/ffmpeg': FULL };
        let releaseSlow: () => void = () => {};
        const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
        const exec = fakeExecFile(builds);
        const resolver = createExportFfmpegResolver({
            store, appGetAppPath: () => '/app', platform: 'linux', env: { PATH: '/opt/a' }, homedir: '/home/u', readdir: () => [],
            exists: (candidate: string) => candidate in builds,
            // The search's probe of /opt/a waits until the choice below is made.
            execFileImpl: (file: string, args: string[], options: unknown, callback: (error: Error | null, stdout?: string) => void) => {
                if (file === '/opt/a/ffmpeg') { void slowGate.then(() => exec(file, args, options, callback)); return; }
                exec(file, args, options, callback);
            },
            logger: { info: () => {}, warn: () => {} },
        });
        const startup = resolver.resolve();
        const choosing = resolver.chooseManual('/picked/ffmpeg');
        releaseSlow();
        await startup;
        const chosen = await choosing;
        expect(chosen.status).toMatchObject({ source: 'manual', path: '/picked/ffmpeg' });
        expect(await resolver.resolve()).toMatchObject({ source: 'manual', path: '/picked/ffmpeg' });
    });

    it('answers from its cache until asked to search again', async () => {
        const builds: Record<string, FakeBuild> = { '/opt/b/ffmpeg': FULL };
        const resolver = makeResolver(builds);
        expect((await resolver.resolve()).available).toBe(true);
        delete builds['/opt/b/ffmpeg'];
        expect((await resolver.resolve()).available).toBe(true);
        expect((await resolver.resolve({ refresh: true })).available).toBe(false);
    });
});
