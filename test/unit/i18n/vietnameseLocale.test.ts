import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAst } from 'vite';
import en from '@/i18n/locales/en';
import vi from '@/i18n/locales/vi';

type Bundle = Record<string, unknown>;

/** Flattens nested locale object into dot notation 'a.b.c' -> string */
const flatten = (node: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
        for (const [key, value] of Object.entries(node as Bundle)) {
            flatten(value, prefix ? `${prefix}.${key}` : key, out);
        }
        return out;
    }
    if (Array.isArray(node)) {
        node.forEach((value, index) => flatten(value, `${prefix}.${index}`, out));
        return out;
    }
    out[prefix] = node;
    return out;
};

const flatEN = flatten(en);
const flatVI = flatten(vi);

describe('vi locale structure and parity with en', () => {
    it('matches the exact set of keys from en', () => {
        const enKeys = Object.keys(flatEN).sort();
        const viKeys = Object.keys(flatVI).sort();
        expect(viKeys).toEqual(enKeys);
    });

    it('ensures every value is a string, and only empty if en is empty', () => {
        const invalid = Object.entries(flatVI).filter(([key, value]) => {
            if (typeof value !== 'string') return true;
            if (value.trim() === '' && String(flatEN[key]).trim() !== '') return true;
            return false;
        });
        expect(invalid).toEqual([]);
    });

    it('matches interpolation placeholders with en', () => {
        const placeholders = (value: string) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort();
        const mismatched = Object.keys(flatEN).filter(key => {
            const enPH = placeholders(String(flatEN[key]));
            const viPH = placeholders(String(flatVI[key]));
            return JSON.stringify(enPH) !== JSON.stringify(viPH);
        });
        expect(mismatched, `Placeholders mismatch in: ${mismatched.slice(0, 20).join(', ')}`).toEqual([]);
    });
});

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MAIN_TABLES = [
    ['electron/main.cjs', 'mainLocale'],
    ['electron/modSystem/approval.cjs', 'TRUST_DIALOG_LOCALE'],
    ['electron/modSystem/safeStart.cjs', 'SAFE_START_LOCALE'],
    ['electron/spotify/signIn.cjs', 'PAGE_TEXT'],
] as const;

type Entry = string | ((...args: string[]) => string);
type LocaleTable = Record<string, Record<string, Entry>>;
type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

const findInit = (node: unknown, name: string): AstNode | null => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findInit(child, name);
            if (found) return found;
        }
        return null;
    }
    const current = node as AstNode;
    if (current.type === 'VariableDeclarator' && (current.id as { name?: string })?.name === name) {
        return current.init as AstNode;
    }
    for (const [key, child] of Object.entries(current)) {
        if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') continue;
        const found = findInit(child, name);
        if (found) return found;
    }
    return null;
};

const readTable = (file: string, name: string): LocaleTable => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const init = findInit(parseAst(source, { lang: 'js' }), name);
    if (!init) throw new Error(`${file} missing ${name}`);
    return new Function(`return (${source.slice(init.start, init.end)});`)() as LocaleTable;
};

describe.each(MAIN_TABLES)('main process table %s %s', (file, name) => {
    const table = readTable(file, name);

    it('has vi defined and matches keys with en', () => {
        expect(table['vi'], `${name} is missing vi locale`).toBeDefined();
        expect(Object.keys(table['vi']).sort()).toEqual(Object.keys(table['en']).sort());
    });
});
