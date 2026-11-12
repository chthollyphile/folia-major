import { describe, expect, it } from 'vitest';
import { resolveLyricTextDirection } from '../../../src/utils/lyrics/textDirection';

// test/unit/lyrics/textDirection.test.ts
describe('resolveLyricTextDirection', () => {
    it('reads RTL scripts as rtl', () => {
        expect(resolveLyricTextDirection('ئەگەر شامال يەلپۈپ ئۆتسە')).toBe('rtl');
        expect(resolveLyricTextDirection('مرحبا بالعالم')).toBe('rtl');
        expect(resolveLyricTextDirection('שלום עולם')).toBe('rtl');
    });
    it('reads Latin, CJK and empty text as ltr', () => {
        expect(resolveLyricTextDirection('hello world')).toBe('ltr');
        expect(resolveLyricTextDirection('当微风吹过我的脸庞')).toBe('ltr');
        expect(resolveLyricTextDirection('')).toBe('ltr');
        expect(resolveLyricTextDirection('123 ...')).toBe('ltr');
    });
    it('decides by the first letter, skipping digits and punctuation', () => {
        expect(resolveLyricTextDirection('(2) ئەگەر hello')).toBe('rtl');
        expect(resolveLyricTextDirection('hello ئەگەر')).toBe('ltr');
    });
});
