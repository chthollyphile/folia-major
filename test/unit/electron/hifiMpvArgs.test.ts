import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// 钉住 mpv 的启动参数（顺序、位精确要的开关、不上命令行的东西）、设备名清洗、各平台实际下发的独占开关、管道名和 loadfile 命令。

type MpvArgsOptions = {
    platform?: string;
    ipc?: { kind: 'fd' } | { kind: 'pipe'; path: string } | { kind: string; path?: unknown };
    audioDevice?: unknown;
    exclusive?: boolean;
    dsdMode?: string;
    ao?: unknown;
};

const require = createRequire(import.meta.url);
const { AUDIO_CLIENT_NAME, buildMpvArgs, sanitizeAudioDevice, effectiveExclusive, buildPipeName, buildLoadfileCommand } = require('../../../electron/hifi/mpvArgs.cjs') as {
    AUDIO_CLIENT_NAME: string;
    buildMpvArgs: (options: MpvArgsOptions) => string[];
    sanitizeAudioDevice: (value: unknown) => string;
    effectiveExclusive: (platform: string, exclusive: unknown) => boolean;
    buildPipeName: (hex: unknown) => string;
    buildLoadfileCommand: (url: unknown, mode: unknown, options?: { startSec?: unknown }) => Array<string | number>;
};

const BASE_ARGS = [
    '--idle=yes',
    '--no-config',
    '--no-video',
    '--audio-display=no',
    '--load-scripts=no',
    '--ytdl=no',
    '--osc=no',
    '--input-default-bindings=no',
    '--input-terminal=no',
    '--input-media-keys=no',
    '--media-controls=no',
    '--terminal=no',
    '--msg-level=all=warn',
    '--keep-open=yes',
    '--gapless-audio=weak',
    '--prefetch-playlist=yes',
    '--replaygain=no',
    '--af=',
    '--audio-pitch-correction=no',
    '--audio-normalize-downmix=no',
    '--audio-channels=auto',
    '--volume=100',
    '--volume-max=100',
    '--audio-fallback-to-null=no',
    '--audio-client-name=Folia HiFi',
];

describe('buildMpvArgs', () => {
    it('builds the Unix argument list in order, with socketpair IPC on fd 3', () => {
        expect(buildMpvArgs({
            platform: 'darwin',
            ipc: { kind: 'fd' },
            exclusive: true,
            dsdMode: 'pcm',
        })).toEqual([
            ...BASE_ARGS,
            '--audio-device=auto',
            '--audio-exclusive=yes',
            '--input-ipc-client=fd://3',
        ]);
    });

    it('uses a named pipe server on Windows and adds DoP only in dop mode', () => {
        const pipePath = buildPipeName('0123abcd');
        expect(buildMpvArgs({
            platform: 'win32',
            ipc: { kind: 'pipe', path: pipePath },
            exclusive: true,
            dsdMode: 'dop',
        })).toEqual([
            ...BASE_ARGS,
            '--audio-device=auto',
            '--audio-exclusive=yes',
            '--audio-spdif=dsd',
            `--input-ipc-server=${pipePath}`,
        ]);
        expect(buildMpvArgs({ platform: 'win32', ipc: { kind: 'pipe', path: pipePath }, exclusive: false, dsdMode: 'pcm' }))
            .toContain('--audio-exclusive=no');
    });

    it('Linux: never asks for exclusive output (PipeWire would mark mpv\'s node exclusive; hw: is direct anyway)', () => {
        const args = buildMpvArgs({ platform: 'linux', ipc: { kind: 'fd' }, exclusive: true, dsdMode: 'pcm' });
        expect(args).toContain('--audio-exclusive=no');
        expect(args).not.toContain('--audio-exclusive=yes');
    });

    it('names mpv\'s client "Folia HiFi" on every platform, as one argument (the probe finds the PipeWire stream by it)', () => {
        expect(AUDIO_CLIENT_NAME).toBe('Folia HiFi');
        for (const platform of ['linux', 'darwin', 'win32']) {
            const ipc = platform === 'win32' ? { kind: 'pipe', path: buildPipeName('ab') } : { kind: 'fd' };
            const args = buildMpvArgs({ platform, ipc, exclusive: false, dsdMode: 'pcm' });
            expect(args.filter(arg => arg.startsWith('--audio-client-name')), platform).toEqual(['--audio-client-name=Folia HiFi']);
        }
    });

    it('appends the test ao override last', () => {
        const args = buildMpvArgs({ platform: 'linux', ipc: { kind: 'fd' }, audioDevice: 'auto', exclusive: false, dsdMode: 'pcm', ao: 'null' });
        expect(args[args.length - 1]).toBe('--ao=null');
        expect(args).toContain('--audio-device=auto');
        expect(args).not.toContain('--audio-spdif=dsd');
    });

    it('never forces a sample rate or format, and carries no source', () => {
        const args = buildMpvArgs({ platform: 'darwin', ipc: { kind: 'fd' }, audioDevice: 'coreaudio/AppleUSBAudioEngine:x', exclusive: true, dsdMode: 'dop' });
        expect(args.some(arg => arg.startsWith('--audio-samplerate') || arg.startsWith('--audio-format'))).toBe(false);
        expect(args.every(arg => arg.startsWith('--'))).toBe(true);
        expect(args.some(arg => /^--(ao|playlist)=/.test(arg))).toBe(false);
    });

    it('never puts a device name on the command line: mpv starts on auto and the session switches over IPC', () => {
        for (const audioDevice of ['alsa/file:|touch /tmp/x,raw', 'alsa/hw:CARD=D10,DEV=0', 'bad\ndevice']) {
            const args = buildMpvArgs({ platform: 'linux', ipc: { kind: 'fd' }, audioDevice, exclusive: true, dsdMode: 'pcm' });
            expect(args.filter(arg => arg.startsWith('--audio-device='))).toEqual(['--audio-device=auto']);
            expect(args.some(arg => arg.includes('|') || arg.includes('hw:'))).toBe(false);
        }
    });

    it('rejects IPC setups that cannot work', () => {
        expect(() => buildMpvArgs({ platform: 'win32', ipc: { kind: 'fd' } })).toThrow(TypeError);
        expect(() => buildMpvArgs({ platform: 'win32', ipc: { kind: 'pipe', path: '' } })).toThrow(TypeError);
        expect(() => buildMpvArgs({ platform: 'linux', ipc: { kind: 'tcp' } })).toThrow(TypeError);
        expect(() => buildMpvArgs({ platform: 'linux' })).toThrow(TypeError);
        expect(() => buildMpvArgs({ platform: 'linux', ipc: { kind: 'fd' }, ao: 'null --input-ipc-server=/tmp/x' })).toThrow(TypeError);
    });
});

describe('sanitizeAudioDevice', () => {
    it('keeps real device names', () => {
        expect(sanitizeAudioDevice('pipewire/alsa_output.usb-Topping_D10-00.analog-stereo')).toBe('pipewire/alsa_output.usb-Topping_D10-00.analog-stereo');
        expect(sanitizeAudioDevice('auto')).toBe('auto');
        // mpv 0.41.0 在这台机器上列出的设备（节选），加上 Windows 和 macOS 的样子。
        for (const name of [
            'pipewire',
            'pipewire/effect_input.eq6',
            'pipewire/alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Speaker__sink',
            'pulse/remap_input.remap-FL-FR-to-FR-FL',
            'alsa',
            'alsa/lavrate',
            'alsa/pipewire',
            'alsa/hdmi:CARD=NVidia,DEV=3',
            'alsa/usbstream:CARD=NVidia',
            'alsa/sysdefault:CARD=sofhdadsp',
            'alsa/hw:CARD=D10,DEV=0',
            'alsa/plughw:CARD=D10,DEV=0',
            'jack',
            'openal',
            'sndio',
            'wasapi/{0.0.0.00000000}.{a1b2c3d4-0000-1111-2222-333344445555}',
            'coreaudio/AppleUSBAudioEngine:Topping:D10:20100000:1',
            'coreaudio/~:AMS2_Aggregate:0',
        ]) {
            expect(sanitizeAudioDevice(name), name).toBe(name);
        }
    });

    it('turns names mpv never lists into auto: shell characters, and ALSA plugins that write files or run commands', () => {
        for (const name of [
            // ALSA 的 file 插件把 | 开头的文件名交给 shell 执行。
            'alsa/file:|touch /tmp/x,raw',
            'alsa/file:/tmp/x,raw',
            'alsa/file',
            'alsa/tee:hw,/tmp/x',
            'alsa/plug:file:x',
            'alsa/plug:SLAVE=tee',
            'alsa/shm:sock,hw',
            'alsa/ladspa:x',
            'ALSA/File:x',
            // 花括号能在 ALSA 的参数里写一段配置；路径和空格 ALSA 的设备名里都没有。
            'alsa/plug:{SLAVE x}',
            'alsa/hw:CARD=D10/../x',
            'alsa/hw:CARD=D10 ,DEV=0',
            'pipewire/a|b',
            'pulse/$(id)',
            'pulse/`id`',
            'x;y',
            '"quoted"',
            '\'quoted\'',
            '/etc/passwd',
            '-auto',
            ' auto',
        ]) {
            expect(sanitizeAudioDevice(name), name).toBe('auto');
        }
        // 只是名字里带着这几个字母的不算。
        expect(sanitizeAudioDevice('alsa/hw:CARD=filer,DEV=0')).toBe('alsa/hw:CARD=filer,DEV=0');
        expect(sanitizeAudioDevice('pipewire/file_sink')).toBe('pipewire/file_sink');
    });

    it('turns empty, non-string, oversized and control-character values into auto', () => {
        expect(sanitizeAudioDevice('')).toBe('auto');
        expect(sanitizeAudioDevice('   ')).toBe('auto');
        expect(sanitizeAudioDevice(null)).toBe('auto');
        expect(sanitizeAudioDevice(3)).toBe('auto');
        expect(sanitizeAudioDevice('a'.repeat(513))).toBe('auto');
        expect(sanitizeAudioDevice('a'.repeat(512))).toBe('a'.repeat(512));
        expect(sanitizeAudioDevice('alsa/hw:0\u0000')).toBe('auto');
        expect(sanitizeAudioDevice('alsa/hw:0\u007f')).toBe('auto');
    });
});

describe('effectiveExclusive', () => {
    it('passes the switch on Windows and macOS and is always off on Linux', () => {
        expect(effectiveExclusive('win32', true)).toBe(true);
        expect(effectiveExclusive('darwin', true)).toBe(true);
        expect(effectiveExclusive('linux', true)).toBe(false);
        expect(effectiveExclusive('win32', false)).toBe(false);
        expect(effectiveExclusive('darwin', 'yes')).toBe(false);
    });
});

describe('buildPipeName', () => {
    it('names the pipe under the local pipe namespace', () => {
        expect(buildPipeName('deadBEEF01')).toBe('\\\\.\\pipe\\folia-hifi-deadBEEF01');
    });

    it('rejects anything that is not hex', () => {
        expect(() => buildPipeName('')).toThrow(TypeError);
        expect(() => buildPipeName('..\\evil')).toThrow(TypeError);
        expect(() => buildPipeName(12)).toThrow(TypeError);
    });
});

describe('buildLoadfileCommand', () => {
    const url = 'http://127.0.0.1:41234/0123456789abcdef0123456789abcdef/Song%20Name.flac';

    it('starts from the top without index or options', () => {
        expect(buildLoadfileCommand(url, 'replace', { startSec: 0 })).toEqual(['loadfile', url, 'replace']);
        expect(buildLoadfileCommand(url, 'append')).toEqual(['loadfile', url, 'append']);
        expect(buildLoadfileCommand(url, 'replace', { startSec: -3 })).toEqual(['loadfile', url, 'replace']);
        expect(buildLoadfileCommand(url, 'replace', { startSec: Number.NaN })).toEqual(['loadfile', url, 'replace']);
    });

    it('passes the start position with at most three decimals', () => {
        expect(buildLoadfileCommand(url, 'replace', { startSec: 83.123456 })).toEqual(['loadfile', url, 'replace', -1, 'start=83.123']);
        expect(buildLoadfileCommand(url, 'replace', { startSec: 12 })).toEqual(['loadfile', url, 'replace', -1, 'start=12']);
        expect(buildLoadfileCommand(url, 'append', { startSec: 0.5 })).toEqual(['loadfile', url, 'append', -1, 'start=0.5']);
        expect(buildLoadfileCommand(url, 'replace', { startSec: 1e-7 })).toEqual(['loadfile', url, 'replace', -1, 'start=0']);
    });

    it('rejects unknown modes and missing urls', () => {
        expect(() => buildLoadfileCommand(url, 'insert-next')).toThrow(TypeError);
        expect(() => buildLoadfileCommand('', 'replace')).toThrow(TypeError);
        expect(() => buildLoadfileCommand(undefined, 'replace')).toThrow(TypeError);
    });
});
