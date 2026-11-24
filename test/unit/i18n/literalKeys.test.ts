import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import zhCN from '../../../src/i18n/locales/zh-CN';

// test/unit/i18n/literalKeys.test.ts
// Every literal key handed to t() in src/ has text in zh-CN (the bundled fallback): a key that is not there
// reaches the screen, the system media panel or a tooltip as the raw key ("ui.unknownArtist"). Keys built at
// run time (concatenated or templated) and calls that give their own defaultValue are not checked.

const SRC = path.resolve(__dirname, '../../../src');
const LOCALES = path.join(SRC, 'i18n', 'locales');
// t('a.b') or t('a.b', …): the whole first argument is one literal with at least one dot.
const LITERAL_CALL = /\bt\(\s*'([a-zA-Z][\w-]*(?:\.[\w-]+)+)'\s*([,)])/g;

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return file === LOCALES ? [] : walk(file);
    return /\.(ts|tsx)$/.test(name) ? [file] : [];
});

const lookup = (key: string): unknown => key.split('.').reduce<unknown>(
    (node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    zhCN,
);

// A plural key is stored as key_one / key_other.
const hasText = (key: string) => lookup(key) !== undefined || lookup(`${key}_other`) !== undefined;

describe('literal i18n keys', () => {
    it('every literal t() key in src/ exists in zh-CN', () => {
        const missing: string[] = [];
        for (const file of walk(SRC)) {
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(LITERAL_CALL)) {
                const key = match[1];
                if (match[2] === ',' && /^[^)]*defaultValue/.test(text.slice((match.index ?? 0) + match[0].length))) continue;
                if (!hasText(key)) {
                    const line = text.slice(0, match.index).split('\n').length;
                    missing.push(`${path.relative(SRC, file)}:${line} ${key}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
