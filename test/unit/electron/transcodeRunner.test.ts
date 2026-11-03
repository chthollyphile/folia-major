import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// Keeps FFmpeg invocation argument-only, audio-only and deterministic across platforms.

const require = createRequire(import.meta.url);
const { DSD_PCM_RATE, encodeArgs, validateArgs } = require('../../../electron/transcode/runner.cjs') as {
    DSD_PCM_RATE: number;
    encodeArgs: (input: string, output: string, format: 'flac' | 'wav') => string[];
    validateArgs: (output: string) => string[];
};

describe('transcode runner arguments', () => {
    it('maps one audio stream into source-rate stereo FLAC without metadata or shell text', () => {
        const args = encodeArgs('input weird;name.ape', 'output.flac', 'flac');
        expect(args).toContain('input weird;name.ape');
        expect(args).toContain('flac');
        expect(args).not.toContain('-ar');
        expect(args).not.toContain('48000');
        expect(args).toContain('2');
        expect(args).toEqual(expect.arrayContaining(['-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1']));
    });

    it('brings DSD down to one PCM rate the FLAC encoder accepts', () => {
        for (const input of ['input.dsf', 'INPUT.DFF']) {
            const args = encodeArgs(input, 'output.flac', 'flac');
            expect(args[args.indexOf('-ar') + 1]).toBe(String(DSD_PCM_RATE));
        }
        expect(DSD_PCM_RATE).toBe(88200);
        expect(encodeArgs('input.flac', 'output.flac', 'flac')).not.toContain('-ar');
    });

    it('uses one bounded PCM WAV fallback profile', () => {
        expect(encodeArgs('input', 'output.wav', 'wav')).toEqual(expect.arrayContaining(['-c:a', 'pcm_s16le', '-f', 'wav']));
    });

    it('strictly decodes the complete output for validation', () => {
        expect(validateArgs('output.flac')).toEqual(expect.arrayContaining(['-xerror', '-i', 'output.flac', '-map', '0:a:0', '-f', 'null', '-']));
    });
});
