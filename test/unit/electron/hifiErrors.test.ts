import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';
import type { HifiErrorCode } from '../../../src/types/hifi';

// 钉住 HiFi 错误码表、带码 Error、日志说明去敏，以及 mpv 日志行和 end-file 到错误码的归类。

type LogLine = { prefix?: string; level?: string; text?: string };

const require = createRequire(import.meta.url);
const {
    HIFI_ERROR_CODES,
    isHifiErrorCode,
    createHifiError,
    toHifiErrorCode,
    sanitizeDetail,
    isOutputStreamLost,
    classifyLogLine,
    classifyEndFile,
} = require('../../../electron/hifi/hifiErrors.cjs') as {
    HIFI_ERROR_CODES: readonly HifiErrorCode[];
    isHifiErrorCode: (value: unknown) => value is HifiErrorCode;
    createHifiError: (code: string, detail?: unknown) => Error & { code: HifiErrorCode; hifiDetail?: string };
    toHifiErrorCode: (error: unknown, fallback?: string) => HifiErrorCode;
    sanitizeDetail: (text: unknown) => string;
    isOutputStreamLost: (line: LogLine) => boolean;
    classifyLogLine: (line: LogLine) => HifiErrorCode | null;
    classifyEndFile: (
        endFile: { reason?: string; fileError?: string; file_error?: string },
        recentLogLines?: LogLine[],
        sourceErrorCode?: string | null,
    ) => HifiErrorCode | null;
};

// 和 src/types/hifi.ts 的联合类型逐项对照；那边加了码而这里没加，tsc 会在这行报错。
const EXPECTED_CODES: Record<HifiErrorCode, true> = {
    MPV_NOT_FOUND: true,
    MPV_TOO_OLD: true,
    MPV_SPAWN_FAILED: true,
    MPV_CRASHED: true,
    IPC_TIMEOUT: true,
    CIRCUIT_OPEN: true,
    DEVICE_BUSY: true,
    DEVICE_UNAVAILABLE: true,
    SOURCE_UNREACHABLE: true,
    SOURCE_REJECTED: true,
    FORMAT_UNSUPPORTED: true,
    LOAD_FAILED: true,
    INVALID_REQUEST: true,
    UNSUPPORTED_PLATFORM: true,
    INSTALL_FAILED: true,
    INSTALL_CHECKSUM_MISMATCH: true,
    INSTALL_CANCELLED: true,
    UNKNOWN: true,
};

describe('HiFi error codes', () => {
    it('lists exactly the HifiErrorCode members, frozen', () => {
        expect([...HIFI_ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED_CODES).sort());
        expect(Object.isFrozen(HIFI_ERROR_CODES)).toBe(true);
    });

    it('recognises only listed codes', () => {
        expect(isHifiErrorCode('DEVICE_BUSY')).toBe(true);
        expect(isHifiErrorCode('device_busy')).toBe(false);
        expect(isHifiErrorCode('ENOENT')).toBe(false);
        expect(isHifiErrorCode(undefined)).toBe(false);
        expect(isHifiErrorCode(42)).toBe(false);
    });
});

describe('createHifiError', () => {
    it('carries the code and a sanitised detail', () => {
        const error = createHifiError('SOURCE_UNREACHABLE', 'Failed to open http://nas.lan/rest/stream.view?u=me&t=abc&s=salt');
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('SOURCE_UNREACHABLE');
        expect(error.hifiDetail).toBe('Failed to open http://nas.lan/rest/stream.view');
        expect(error.message).toBe('SOURCE_UNREACHABLE: Failed to open http://nas.lan/rest/stream.view');
    });

    it('has no detail when none is given, and maps unknown codes to UNKNOWN', () => {
        const error = createHifiError('IPC_TIMEOUT');
        expect(error.message).toBe('IPC_TIMEOUT');
        expect(error.hifiDetail).toBeUndefined();
        expect(createHifiError('NOT_A_CODE').code).toBe('UNKNOWN');
    });

    it('takes the message of an Error as its detail', () => {
        expect(createHifiError('MPV_CRASHED', new Error('write EPIPE')).hifiDetail).toBe('write EPIPE');
    });
});

describe('toHifiErrorCode', () => {
    it('reads the code off an error, a bare code, or falls back', () => {
        expect(toHifiErrorCode(createHifiError('DEVICE_BUSY'))).toBe('DEVICE_BUSY');
        expect(toHifiErrorCode('LOAD_FAILED')).toBe('LOAD_FAILED');
        expect(toHifiErrorCode(Object.assign(new Error('spawn mpv ENOENT'), { code: 'ENOENT' }), 'MPV_SPAWN_FAILED')).toBe('MPV_SPAWN_FAILED');
        expect(toHifiErrorCode(null)).toBe('UNKNOWN');
        expect(toHifiErrorCode(new Error('x'), 'bogus')).toBe('UNKNOWN');
    });
});

describe('sanitizeDetail', () => {
    it('drops query strings, fragments and user info from URLs', () => {
        expect(sanitizeDetail('GET https://nas.example/rest/stream?id=1&u=a&t=b&s=c failed')).toBe('GET https://nas.example/rest/stream failed');
        expect(sanitizeDetail("Failed to open 'http://h/x.flac#frag'.")).toBe("Failed to open 'http://h/x.flac'.");
        expect(sanitizeDetail('http://alice:secret@nas.lan/song.flac')).toBe('http://nas.lan/song.flac');
    });

    it('collapses whitespace and caps the length', () => {
        expect(sanitizeDetail('  audio\n  output\tfailed  ')).toBe('audio output failed');
        expect(sanitizeDetail('x'.repeat(1000))).toHaveLength(300);
        expect(sanitizeDetail(undefined)).toBe('');
        expect(sanitizeDetail(null)).toBe('');
    });
});

describe('classifyLogLine', () => {
    it('recognises a busy exclusive device on each platform', () => {
        const busyLines: LogLine[] = [
            { prefix: 'ao/wasapi', level: 'error', text: 'Error opening device: AUDCLNT_E_DEVICE_IN_USE (0x8889000a)\n' },
            { prefix: 'ao/alsa', level: 'error', text: 'Playback open error: Device or resource busy\n' },
            { prefix: 'ao/coreaudio', level: 'error', text: 'Failed to set hog mode on the device\n' },
            { prefix: 'ao/wasapi', level: 'warn', text: 'Exclusive mode request denied: device in use\n' },
            { prefix: 'ao', level: 'error', text: 'The device is busy\n' },
        ];
        for (const line of busyLines) expect(classifyLogLine(line)).toBe('DEVICE_BUSY');
    });

    // mpv 0.41.0 在 PipeWire 上开着独占、声卡上已经连着别的流时原样报的几行（warn）。
    const streamLostLines: LogLine[] = [
        { prefix: 'ao/pipewire', level: 'warn', text: 'Stream in error state, trying to reload...\n' },
        { prefix: 'ao/pipewire', level: 'warn', text: 'Error during playback: No such file or directory, no target node available\n' },
        { prefix: 'ao', level: 'warn', text: 'dropping frame due to pin disconnect\n' },
        { prefix: 'ao/pulse', level: 'error', text: 'Stream in error state\n' },
    ];

    it('counts a PipeWire / PulseAudio stream that cannot reach its output as a busy device', () => {
        for (const line of streamLostLines) {
            expect(isOutputStreamLost(line), line.text).toBe(true);
            expect(classifyLogLine(line), line.text).toBe('DEVICE_BUSY');
        }
    });

    it('only from the audio output modules, and only at the failure levels', () => {
        expect(isOutputStreamLost({ prefix: 'ffmpeg', level: 'error', text: 'Stream in error state\n' })).toBe(false);
        expect(isOutputStreamLost({ prefix: 'ao/alsa', level: 'error', text: 'no target node available\n' })).toBe(false);
        expect(isOutputStreamLost({ prefix: 'ao/pipewire', level: 'v', text: 'Stream in error state, trying to reload...\n' })).toBe(false);
        expect(isOutputStreamLost({ prefix: 'ao/pipewire', level: 'warn', text: 'drain timeout\n' })).toBe(false);
        expect(isOutputStreamLost({ level: 'warn', text: 'Stream in error state\n' })).toBe(false);
        expect(isOutputStreamLost({})).toBe(false);
    });

    it('ignores other failures and non-failure levels', () => {
        expect(classifyLogLine({ prefix: 'ao/alsa', level: 'error', text: 'Playback open error: No such file or directory\n' })).toBeNull();
        expect(classifyLogLine({ prefix: 'ao/coreaudio', level: 'v', text: 'hog mode acquired\n' })).toBeNull();
        expect(classifyLogLine({ prefix: 'ao/coreaudio', level: 'info', text: 'Device busy\n' })).toBeNull();
        expect(classifyLogLine({})).toBeNull();
    });
});

describe('classifyEndFile', () => {
    const busyLog: LogLine = { prefix: 'ao/alsa', level: 'error', text: 'Playback open error: Device or resource busy\n' };
    const missingLog: LogLine = { prefix: 'ao/alsa', level: 'error', text: 'Playback open error: No such file or directory\n' };

    it('is null unless mpv ended the file with an error', () => {
        expect(classifyEndFile({ reason: 'eof' }, [busyLog], 'SOURCE_UNREACHABLE')).toBeNull();
        expect(classifyEndFile({ reason: 'stop' })).toBeNull();
    });

    it('prefers the error the source bridge recorded', () => {
        expect(classifyEndFile({ reason: 'error', fileError: 'loading failed' }, [], 'SOURCE_REJECTED')).toBe('SOURCE_REJECTED');
        expect(classifyEndFile({ reason: 'error', fileError: 'audio output initialization failed' }, [busyLog], 'SOURCE_UNREACHABLE')).toBe('SOURCE_UNREACHABLE');
    });

    it('tells a busy device from an unavailable one by the recent log lines', () => {
        const aoFailed = { reason: 'error', fileError: 'audio output initialization failed' };
        expect(classifyEndFile(aoFailed, [missingLog, busyLog])).toBe('DEVICE_BUSY');
        expect(classifyEndFile(aoFailed, [missingLog])).toBe('DEVICE_UNAVAILABLE');
        expect(classifyEndFile(aoFailed)).toBe('DEVICE_UNAVAILABLE');
    });

    it('maps loading and format failures, then falls back to LOAD_FAILED', () => {
        expect(classifyEndFile({ reason: 'error', fileError: 'loading failed' })).toBe('SOURCE_UNREACHABLE');
        expect(classifyEndFile({ reason: 'error', fileError: 'unrecognized file format' })).toBe('FORMAT_UNSUPPORTED');
        expect(classifyEndFile({ reason: 'error', fileError: 'no audio or video data played' })).toBe('FORMAT_UNSUPPORTED');
        expect(classifyEndFile({ reason: 'error', fileError: 'demuxer error' }, [{ prefix: 'cplayer', level: 'error', text: 'Failed to recognize file format.\n' }])).toBe('FORMAT_UNSUPPORTED');
        expect(classifyEndFile({ reason: 'error', fileError: 'something new' })).toBe('LOAD_FAILED');
        expect(classifyEndFile({ reason: 'error' })).toBe('LOAD_FAILED');
    });

    it('accepts the raw file_error field mpv sends', () => {
        expect(classifyEndFile({ reason: 'error', file_error: 'loading failed' })).toBe('SOURCE_UNREACHABLE');
    });
});
