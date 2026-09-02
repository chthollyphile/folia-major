import { describe, expect, it } from 'vitest';
import { parseObsCssDataUrl, parseObsCssImageList, readObsCustomCssAssets } from '@/services/obs/obsCustomCss';

// test/unit/obs/obsCustomCss.test.ts
// Guards the consumer-side parsing of the OBS Custom CSS transport. Only a genuine data: URL should
// be adopted; anything else must yield null/empty so the overlay keeps its cover / builtin fallback.

const toCssListValue = (entries: unknown): string => `"${Buffer.from(JSON.stringify(entries), 'utf-8').toString('base64')}"`;

describe('parseObsCssDataUrl', () => {
    it('extracts a double-quoted data URL', () => {
        expect(parseObsCssDataUrl('url("data:image/jpeg;base64,AAAA")')).toBe('data:image/jpeg;base64,AAAA');
    });

    it('extracts a single-quoted data URL', () => {
        expect(parseObsCssDataUrl("url('data:image/png;base64,BBBB')")).toBe('data:image/png;base64,BBBB');
    });

    it('extracts an unquoted data URL', () => {
        expect(parseObsCssDataUrl('url(data:image/jpeg;base64,CCCC)')).toBe('data:image/jpeg;base64,CCCC');
    });

    it('tolerates surrounding whitespace', () => {
        expect(parseObsCssDataUrl('  url(  "data:image/png;base64,DDDD"  )  ')).toBe('data:image/png;base64,DDDD');
    });

    it('rejects a non-data url (only self-contained assets are adopted)', () => {
        expect(parseObsCssDataUrl('url("https://example.com/cover.png")')).toBeNull();
    });

    it('returns null for empty or missing values', () => {
        expect(parseObsCssDataUrl('')).toBeNull();
        expect(parseObsCssDataUrl(null)).toBeNull();
        expect(parseObsCssDataUrl(undefined)).toBeNull();
    });
});

describe('parseObsCssImageList', () => {
    it('decodes a base64(JSON) pack, preserving id/name (incl. non-ASCII) and url', () => {
        const entries = [
            { id: '1', name: '😀笑', url: 'data:image/png;base64,AAAA' },
            { id: '2', name: 'wave', url: 'data:image/png;base64,BBBB' },
        ];
        expect(parseObsCssImageList(toCssListValue(entries))).toEqual(entries);
    });

    it('drops entries whose url is not a data URL', () => {
        const value = toCssListValue([
            { id: '1', name: 'ok', url: 'data:image/png;base64,AAAA' },
            { id: '2', name: 'bad', url: 'https://example.com/x.png' },
        ]);
        expect(parseObsCssImageList(value)).toEqual([{ id: '1', name: 'ok', url: 'data:image/png;base64,AAAA' }]);
    });

    it('returns an empty list for non-array payloads, junk base64, or empty input', () => {
        expect(parseObsCssImageList(toCssListValue({ not: 'an array' }))).toEqual([]);
        expect(parseObsCssImageList('"@@@not-base64@@@"')).toEqual([]);
        expect(parseObsCssImageList('')).toEqual([]);
        expect(parseObsCssImageList(null)).toEqual([]);
    });
});

describe('readObsCustomCssAssets', () => {
    it('returns empty assets outside a DOM (node env has no document/getComputedStyle)', () => {
        expect(readObsCustomCssAssets()).toEqual({
            backgroundUrl: null,
            portraitUrl: null,
            cappellaEmojis: [],
            cappellaAvatars: [],
        });
    });
});
