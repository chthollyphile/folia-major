import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, isHexColorStart, parseHexColor } from '@/components/modal/settings/kit/hexColor';

// test/unit/settings/hexColor.test.ts
// The conversions behind the colour picker (kit/hexColor.ts): what a typed HEX is read as, and a
// colour as hue, saturation and value and back. A wrong rule here moves the picker's handles to
// the wrong place or writes a colour nobody typed, and nothing reports it.

describe('a typed HEX', () => {
    it('reads six digits with or without the #, in either case', () => {
        expect(parseHexColor('ff7aa8')).toBe('#ff7aa8');
        expect(parseHexColor('#FF7AA8')).toBe('#ff7aa8');
        expect(parseHexColor('#Ff7aA8')).toBe('#ff7aa8');
        expect(parseHexColor('  #ff7aa8 ')).toBe('#ff7aa8');
    });

    it('reads three digits as each digit twice', () => {
        expect(parseHexColor('f7a')).toBe('#ff77aa');
        expect(parseHexColor('#F7A')).toBe('#ff77aa');
        expect(parseHexColor('000')).toBe('#000000');
    });

    it('reads nothing else as a colour', () => {
        for (const text of ['', '#', 'f', 'ff', 'ff7a', 'ff7aa', 'ff7aa8a', '#ff7aa8a', 'gg0000', 'ff 7aa8', '##fff', 'rgb(1,2,3)', 'red']) {
            expect(parseHexColor(text), text).toBeNull();
        }
    });

    it('knows a text that can still become a colour from one that cannot', () => {
        for (const text of ['', '#', 'f', '#ff7a', 'FF7AA', 'ff7aa8']) {
            expect(isHexColorStart(text), text).toBe(true);
        }
        for (const text of ['g', 'ff7aa8a', '#ff7aa8a', 'ff 7', '##f', 'rgb']) {
            expect(isHexColorStart(text), text).toBe(false);
        }
    });
});

describe('hue, saturation and value', () => {
    it('reads the pure colours, black, white and a grey', () => {
        expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
        expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 });
        expect(hexToHsv('0000FF')).toEqual({ h: 240, s: 1, v: 1 });
        expect(hexToHsv('#ff00ff')).toEqual({ h: 300, s: 1, v: 1 });
        expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
        expect(hexToHsv('#fff')).toEqual({ h: 0, s: 0, v: 1 });
        expect(hexToHsv('#808080')).toEqual({ h: 0, s: 0, v: 128 / 255 });
    });

    it('answers null for a text that is not a colour', () => {
        expect(hexToHsv('ff7a')).toBeNull();
        expect(hexToHsv('')).toBeNull();
    });

    it('gives every colour back unchanged after going to hue, saturation and value', () => {
        const levels = [0, 1, 17, 51, 102, 127, 128, 153, 204, 238, 254, 255];
        for (const r of levels) {
            for (const g of levels) {
                for (const b of levels) {
                    const hex = `#${[r, g, b].map(level => level.toString(16).padStart(2, '0')).join('')}`;
                    expect(hsvToHex(hexToHsv(hex)!), hex).toBe(hex);
                }
            }
        }
    });

    it('takes the hue round and holds saturation and value in their range', () => {
        expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
        expect(hsvToHex({ h: -120, s: 1, v: 1 })).toBe('#0000ff');
        expect(hsvToHex({ h: 120, s: 2, v: 2 })).toBe('#00ff00');
        expect(hsvToHex({ h: 200, s: -1, v: 0.5 })).toBe('#808080');
    });
});
