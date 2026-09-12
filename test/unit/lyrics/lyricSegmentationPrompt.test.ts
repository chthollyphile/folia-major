import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as esm from '../../../shared/lyricSegmentationPrompt.mjs';

// test/unit/lyrics/lyricSegmentationPrompt.test.ts
// The prompt exists twice: an .mjs for the browser client, Vercel and the Worker, and a .cjs for
// Electron's main process — the same split shared/themeSanitizer already uses. Two copies can
// drift, and drift here means the desktop build and the "run it yourself" path ask a model for
// subtly different output, so the parity assertions below are the point of this file.

const cjs = createRequire(import.meta.url)('../../../shared/lyricSegmentationPrompt.cjs');

const LINES = ['我想要说的话', 'Hello, world', '世界。'];

describe('lyric segmentation prompt parity', () => {
    it('produces an identical system prompt in both module formats', () => {
        expect(cjs.buildSegmentationSystemPrompt()).toBe(esm.buildSegmentationSystemPrompt());
    });

    it('produces an identical source prompt in both module formats', () => {
        expect(cjs.buildSegmentationSourcePrompt(LINES)).toBe(esm.buildSegmentationSourcePrompt(LINES));
    });

    it('produces an identical manual prompt in both module formats', () => {
        expect(cjs.buildSegmentationManualPrompt(LINES)).toBe(esm.buildSegmentationManualPrompt(LINES));
    });

    it('shares the suppression ladder and token budget', () => {
        expect(cjs.REASONING_SUPPRESSION_ATTEMPTS).toEqual(esm.REASONING_SUPPRESSION_ATTEMPTS);
        expect(cjs.SEGMENTATION_MAX_OUTPUT_TOKENS).toBe(esm.SEGMENTATION_MAX_OUTPUT_TOKENS);
    });

    it('shares one schema, name and delimiter', () => {
        expect(cjs.SEGMENTATION_JSON_SCHEMA).toEqual(esm.SEGMENTATION_JSON_SCHEMA);
        expect(cjs.SEGMENTATION_SCHEMA_NAME).toBe(esm.SEGMENTATION_SCHEMA_NAME);
        expect(cjs.SEGMENTATION_DELIMITER).toBe(esm.SEGMENTATION_DELIMITER);
    });
});

describe('buildSegmentationSourcePrompt', () => {
    it('numbers every line so a dropped one is visible in the response', () => {
        const prompt = esm.buildSegmentationSourcePrompt(LINES);
        expect(prompt).toContain('Segment these 3 lyric lines.');
        expect(prompt).toContain('1. 我想要说的话');
        expect(prompt).toContain('3. 世界。');
    });
});

describe('parseSegmentationResponse', () => {
    it('reads the documented object shape', () => {
        const raw = JSON.stringify({ lines: [['我', '想要', '说', '的话'], ['Hello, ', 'world'], ['世界。']] });
        expect(esm.parseSegmentationResponse(raw, LINES).boundaries).toEqual([
            ['我', '想要', '说', '的话'],
            ['Hello, ', 'world'],
            ['世界。'],
        ]);
    });

    it('accepts a bare array, which models return often enough to be worth tolerating', () => {
        expect(esm.parseSegmentationResponse('[["我想要说的话"],["Hello, world"],["世界。"]]', LINES).boundaries).toHaveLength(3);
    });

    it('strips a markdown code fence', () => {
        const raw = '```json\n{"lines":[["我想要说的话"],["Hello, world"],["世界。"]]}\n```';
        expect(esm.parseSegmentationResponse(raw, LINES).boundaries).toHaveLength(3);
    });

    it('rejects a response that drops a line', () => {
        expect(() => esm.parseSegmentationResponse('{"lines":[["我想要说的话"]]}', LINES))
            .toThrow('Segmentation response had 1 lines, expected 3');
    });

    it('realigns whitespace the model normalised, keeping slices of the original', () => {
        // Every one of these is a real thing models do to a line on the way back. The split points
        // are still right, so the run must survive — and the output must be slices of the
        // original, never the model's own text.
        const cases: Array<[string, string[]]> = [
            ['Hello, world ', ['Hello,', 'world']],       // trailing space dropped
            ['Hello,  world', ['Hello,', 'world']],       // double space collapsed
            ['我　想要', ['我', '想要']],                    // full-width space folded away
            [' Hello world', ['Hello', 'world']],         // leading space dropped
        ];

        cases.forEach(([line, boundaries]) => {
            const [result] = esm.parseSegmentationResponse(JSON.stringify({ lines: [boundaries] }), [line]).boundaries;
            expect(result.join(''), `${JSON.stringify(line)} must be reproduced exactly`).toBe(line);
            expect(result.length).toBe(boundaries.length);
        });
    });

    it('returns the boundaries untouched when they already match', () => {
        const line = '我想要说的话';
        const boundaries = ['我', '想要', '说', '的话'];
        expect(esm.parseSegmentationResponse(JSON.stringify({ lines: [boundaries] }), [line]).boundaries[0])
            .toEqual(boundaries);
    });

    it('still refuses a line whose non-whitespace content changed', () => {
        // Realignment must not become a licence to accept edits: a dropped, added, rewritten or
        // re-punctuated word would reach the user as lyrics rendered at an offset. Such a line
        // comes back null — it keeps the default split — and is reported.
        const refuse = (line: string, boundaries: string[]) => {
            // Paired with a good line so the "nothing usable" throw does not fire instead.
            const result = esm.parseSegmentationResponse(
                JSON.stringify({ lines: [boundaries, ['ok']] }), [line, 'ok'],
            );
            expect(result.boundaries[0], `${JSON.stringify(boundaries)} must be refused`).toBeNull();
            expect(result.boundaries[1]).toEqual(['ok']);
            expect(result.rejections).toHaveLength(1);
        };

        refuse('我想要说', ['我', '想说']);          // rewritten
        refuse('我想要说', ['我', '想要']);          // dropped
        refuse('我想要说', ['我', '想要说', '了']);   // added
        refuse('世界。', ['世界', '.']);            // punctuation substituted
    });

    it('keeps the good lines when one is mangled, rather than failing the whole song', () => {
        const raw = JSON.stringify({ lines: [['我', '想要', '说', '的话'], ['WRONG'], ['世界。']] });
        const { boundaries, rejections } = esm.parseSegmentationResponse(raw, LINES);

        expect(boundaries[0]).toEqual(['我', '想要', '说', '的话']);
        expect(boundaries[1]).toBeNull();
        expect(boundaries[2]).toEqual(['世界。']);
        expect(rejections).toHaveLength(1);
    });

    it('throws only when nothing at all is usable', () => {
        const raw = JSON.stringify({ lines: [['a'], ['b'], ['c']] });
        expect(() => esm.parseSegmentationResponse(raw, LINES)).toThrow('reproduced none of the lines');
    });

    it('names the line and the first differing character in its rejection', () => {
        const { rejections } = esm.parseSegmentationResponse(
            '{"lines":[["我","想说"],["ok"]]}', ['我想要说', 'ok'],
        );
        expect(rejections[0]).toMatch(/line 1 .*first difference at character 3.*expected "我想要说".*got "我想说"/s);
    });

    it('rejects only the line the model rewrote, keeping the other two', () => {
        const raw = JSON.stringify({ lines: [['我', '想要', '说'], ['Hello, ', 'world'], ['世界。']] });
        const { boundaries, rejections } = esm.parseSegmentationResponse(raw, LINES);

        expect(boundaries[0]).toBeNull();
        expect(boundaries.filter(Boolean)).toHaveLength(2);
        expect(rejections[0]).toContain('line 1 does not reproduce the original text');
    });

    it('rejects empty and non-JSON responses', () => {
        expect(() => esm.parseSegmentationResponse('', LINES)).toThrow('Empty segmentation response');
        expect(() => esm.parseSegmentationResponse('sure! here you go', LINES)).toThrow('not valid JSON');
        expect(() => esm.parseSegmentationResponse('{"other":1}', LINES)).toThrow('no "lines" array');
    });
});
