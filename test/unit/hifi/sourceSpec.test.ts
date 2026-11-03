import { afterEach, describe, expect, it, vi } from 'vitest';
import { navidromeSourceSpec, readLocalSourceSpec } from '@/services/hifi/sourceSpec';

// test/unit/hifi/sourceSpec.test.ts
// The source stage of the signal path: a local file's format read from its header (tiny real WAV and
// DSF files built here), and a Navidrome song's format from its Subsonic fields.

const ascii = (view: DataView, offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
};

/** A 16-bit PCM WAV: the canonical 44-byte header and `frames` frames of a ramp. */
const buildWav = (sampleRate: number, channels: number, frames: number): Uint8Array<ArrayBuffer> => {
    const blockAlign = channels * 2;
    const dataLength = frames * blockAlign;
    const bytes = new Uint8Array(44 + dataLength);
    const view = new DataView(bytes.buffer);
    ascii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    ascii(view, 8, 'WAVE');
    ascii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    ascii(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    for (let frame = 0; frame < frames * channels; frame += 1) view.setInt16(44 + frame * 2, (frame * 37) % 32768, true);
    return bytes;
};

/** A DSD64 stereo DSF with one 4096-byte block per channel (the layout mkdsf.mjs writes). */
const buildDsf = (dsdRate: number, channels: number): Uint8Array<ArrayBuffer> => {
    const block = 4096;
    const dataLength = block * channels;
    const total = 28 + 52 + 12 + dataLength;
    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);
    ascii(view, 0, 'DSD ');
    view.setBigUint64(4, 28n, true);
    view.setBigUint64(12, BigInt(total), true);
    view.setBigUint64(20, 0n, true);
    ascii(view, 28, 'fmt ');
    view.setBigUint64(32, 52n, true);
    view.setUint32(40, 1, true);
    view.setUint32(44, 0, true);
    view.setUint32(48, 2, true);
    view.setUint32(52, channels, true);
    view.setUint32(56, dsdRate, true);
    view.setUint32(60, 1, true);
    view.setBigUint64(64, BigInt(block * 8), true);
    view.setUint32(72, block, true);
    ascii(view, 80, 'data');
    view.setBigUint64(84, BigInt(12 + dataLength), true);
    bytes.fill(0x69, 92);
    return bytes;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('readLocalSourceSpec', () => {
    it('reads a 16-bit PCM WAV', async () => {
        const file = new File([buildWav(44100, 2, 4410)], 'tone.wav');
        const spec = await readLocalSourceSpec(file, file.name);
        expect(spec).toMatchObject({
            origin: 'local',
            container: 'WAVE',
            codec: 'PCM',
            bitDepth: 16,
            sampleRate: 44100,
            channels: 2,
            lossless: true,
            isDsd: false,
            dsdRate: null,
            bitrate: 1411200,
        });
    });

    it('reads a DSF as DSD with its bit rate', async () => {
        const file = new File([buildDsf(2822400, 2)], 'tone.dsf');
        const spec = await readLocalSourceSpec(file, file.name);
        expect(spec).toMatchObject({
            origin: 'local',
            container: 'DSF',
            codec: 'DSD',
            bitDepth: 1,
            sampleRate: 2822400,
            channels: 2,
            lossless: true,
            isDsd: true,
            dsdRate: 2822400,
            bitrate: 5644800,
        });
    });

    it('returns an empty spec instead of throwing on an unreadable file', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const file = new File([new Uint8Array(256).fill(7)], 'broken.flac');
        const spec = await readLocalSourceSpec(file, file.name);
        expect(spec).toEqual({
            origin: 'local',
            codec: null,
            container: null,
            bitDepth: null,
            sampleRate: null,
            channels: null,
            lossless: null,
            isDsd: false,
            dsdRate: null,
            bitrate: null,
        });
        expect(warn).toHaveBeenCalledWith('[HiFi] source spec: could not read the format of', 'broken.flac', expect.any(Error));
    });
});

describe('navidromeSourceSpec', () => {
    it('maps the OpenSubsonic fields of a hi-res FLAC', () => {
        expect(navidromeSourceSpec({ suffix: 'flac', contentType: 'audio/flac', bitRate: 2500, bitDepth: 24, samplingRate: 96000, channelCount: 2 })).toEqual({
            origin: 'navidrome',
            codec: 'FLAC',
            container: 'flac',
            bitDepth: 24,
            sampleRate: 96000,
            channels: 2,
            lossless: true,
            isDsd: false,
            dsdRate: null,
            bitrate: 2500000,
        });
    });

    it.each([
        ['flac', true],
        ['FLAC', true],
        ['alac', true],
        ['wav', true],
        ['aiff', true],
        ['ape', true],
        ['wv', true],
        ['dsf', true],
        ['dff', true],
        ['mp3', false],
        ['aac', false],
        ['ogg', false],
        ['opus', false],
        ['m4a', null],
        ['xyz', null],
    ] as const)('judges %s lossless: %s', (suffix, lossless) => {
        expect(navidromeSourceSpec({ suffix }).lossless).toBe(lossless);
    });

    it.each(['dsf', 'dff'])('reads a .%s as DSD and normalises its rate', suffix => {
        expect(navidromeSourceSpec({ suffix, samplingRate: 2822400, channelCount: 2 })).toMatchObject({
            isDsd: true,
            codec: 'DSD',
            bitDepth: 1,
            dsdRate: 2822400,
        });
        // ffmpeg-style byte rate for DSD64.
        expect(navidromeSourceSpec({ suffix, samplingRate: 352800 }).dsdRate).toBe(2822400);
        expect(navidromeSourceSpec({ suffix }).dsdRate).toBeNull();
    });

    it('drops zero and missing numbers, and falls back to the content type without a suffix', () => {
        expect(navidromeSourceSpec({ suffix: 'mp3', bitRate: 320, bitDepth: 0, samplingRate: 44100, channelCount: 2 })).toMatchObject({
            bitDepth: null,
            bitrate: 320000,
            lossless: false,
        });
        expect(navidromeSourceSpec({ suffix: '', contentType: 'audio/x-flac' })).toMatchObject({ container: 'flac', lossless: true });
        expect(navidromeSourceSpec({ suffix: undefined, contentType: 'audio/x-dsf' }).isDsd).toBe(true);
        expect(navidromeSourceSpec({ suffix: null })).toMatchObject({ container: null, codec: null, lossless: null, isDsd: false });
    });
});
