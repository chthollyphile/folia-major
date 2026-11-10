import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import id from '@/i18n/locales/in';

// test/unit/ponder/ponderQuotedLabels.test.ts
// A lesson text that puts a name in quotes names something on screen: 「…」 in Chinese, “…” in English
// and Indonesian. That name has to be the text the app shows in the same language. When a label is
// reworded and the lesson is not, nothing fails: the lesson just quotes a name nobody can find.
//
// So every quoted name in the ponder block must be a text of the same locale outside that block, or be
// listed below with the reason it is not one.
//
// The limit: the test knows that a name is shown somewhere in the app, not which control it belongs to.
// A caption that quotes the wrong control still passes when that name is a label elsewhere (“Cancel”).

const LOCALES = {
    'zh-CN': { bundle: zhCN, quoted: /「([^」]+)」/g },
    en: { bundle: en, quoted: /“([^”]+)”/g },
    in: { bundle: id, quoted: /“([^”]+)”/g },
} as const;

/** Quoted on purpose although no label of the locale file reads so. */
const NOT_LABELS: Record<keyof typeof LOCALES, readonly string[]> = {
    'zh-CN': [
        // Sayings and ideas, not names of controls.
        '最近用过', '找功能', '退出时提交', '最多淡到多少',
        // What the Bravais wall draws itself, not from the language files (its lessons came with it from upstream).
        '⋯ 更多', '…', '⋯', '种类 · 曲目数', '✓ 已在队列', '进入', 'Lattice',
    ],
    en: [
        // The tray menu's own texts (electron/main.cjs, mainLocale).
        'Wallpaper Mode', 'Remote Window',
        // Sayings and ideas, not names of controls.
        'recent first', 'recently used', 'I pinned it and it still moves', 'finding a feature',
        'title - artist - album', 'just this artist’s songs',
        '⋯ More', '…', '⋯', 'kind · track count', '✓ In queue', 'open', 'Lattice',
    ],
    in: [
        'Mode Wallpaper', 'Jendela Remote',
        'yang terbaru di atas', 'baru dipakai', 'Sudah saya semat kok masih berpindah', 'mencari fitur',
        'judul - artis - album', 'hanya lagu artis ini',
        '⋯ Lainnya', '…', '⋯', 'jenis · jumlah lagu', '✓ Sudah di antrean', 'buka', 'Tembus pandang', 'Lattice',
    ],
};

const texts = (node: unknown): string[] => {
    if (typeof node === 'string') return [node];
    if (!node || typeof node !== 'object') return [];
    return Object.values(node as Record<string, unknown>).flatMap(texts);
};

describe('names a lesson text puts in quotes', () => {
    it.each(Object.keys(LOCALES) as Array<keyof typeof LOCALES>)('%s: each is a label of the same language', localeName => {
        const { bundle, quoted } = LOCALES[localeName];
        const { ponder, ...rest } = bundle as Record<string, unknown>;
        const labels = new Set(texts(rest));
        const names = new Set(texts(ponder).flatMap(text => [...text.matchAll(quoted)].map(match => match[1])));

        const unknown = [...names].filter(name => !labels.has(name) && !NOT_LABELS[localeName].includes(name));
        expect(unknown, `${localeName}: quoted in a lesson, shown nowhere in the app`).toEqual([]);

        // An exception nobody quotes any more would hide the next wrong name of the same spelling.
        const stale = NOT_LABELS[localeName].filter(name => !names.has(name));
        expect(stale, `${localeName}: listed as an exception, quoted by no lesson`).toEqual([]);
    });
});
