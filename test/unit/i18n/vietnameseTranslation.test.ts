import { describe, expect, it } from 'vitest';
import en from '../../../src/i18n/locales/en';
import zhCN from '../../../src/i18n/locales/zh-CN';
import vi from '../../../src/i18n/locales/vi';

// test/unit/i18n/vietnameseTranslation.test.ts
// Verifies Vietnamese locale structure, key coverage, and interpolation safety.

function flatten(obj: Record<string, any>, prefix = ''): Record<string, string> {
    let result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (Array.isArray(value)) {
            value.forEach((v, idx) => {
                result[`${path}.${idx}`] = String(v);
            });
        } else if (typeof value === 'object' && value !== null) {
            result = { ...result, ...flatten(value, path) };
        } else {
            result[path] = String(value);
        }
    }
    return result;
}

function extractTokens(str: string): string[] {
    const matches = str.match(/\{\{[^}]+\}\}/g);
    return matches ? Array.from(new Set(matches)).sort() : [];
}

describe('vietnamese translation integrity', () => {
    it('defines essential player controls', () => {
        expect((vi as any).player?.play).toBeTruthy();
        expect((vi as any).player?.pause).toBeTruthy();
        expect((vi as any).player?.like).toBeTruthy();
        expect((vi as any).player?.unlike).toBeTruthy();
        expect((vi as any).player?.loopAll).toBeTruthy();
        expect((vi as any).player?.loopOne).toBeTruthy();
    });

    it('defines essential navigation and library labels', () => {
        expect((vi as any).libraryBravais?.homeTitle).toBeTruthy();
        expect((vi as any).libraryBravais?.wallLabel).toBeTruthy();
        expect((vi as any).libraryBravais?.playNow).toBeTruthy();
        expect((vi as any).libraryBravais?.addToQueue).toBeTruthy();
        expect((vi as any).playlist?.play).toBeTruthy();
    });

    it('covers all top-level sections from en locale', () => {
        const enSections = Object.keys(en);
        const viSections = Object.keys(vi);
        for (const section of enSections) {
            expect(viSections).toContain(section);
        }
    });

    it('preserves all interpolation tokens from en locale', () => {
        const enFlat = flatten(en);
        const viFlat = flatten(vi);

        const mismatchedTokens: Array<{ key: string; enTokens: string[]; viTokens: string[] }> = [];

        for (const [key, enVal] of Object.entries(enFlat)) {
            const viVal = viFlat[key];
            if (!viVal) continue;

            const enTokens = extractTokens(enVal);
            const viTokens = extractTokens(viVal);

            const missing = enTokens.filter(t => !viTokens.includes(t));
            if (missing.length > 0) {
                mismatchedTokens.push({ key, enTokens, viTokens });
            }
        }

        expect(mismatchedTokens).toEqual([]);
    });
});
