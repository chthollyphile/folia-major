import { describe, expect, it } from 'vitest';
import { buildLyricStyleWindowEntries } from '../../../src/components/modal/settings/navigation/lyricStyleWindowSearch';
import { searchSettings } from '../../../src/components/modal/settings/navigation/settingsNavSearch';
import zhCN from '../../../src/i18n/locales/zh-CN';

// test/unit/settings/lyricStyleWindowSearch.test.ts
// The settings search finds the lyric style window's pages and the backgrounds and styles its
// pickers show, and lands on that page of the window; these are found by their own name only.

const translate = (key: string): string => {
    const value = key.split('.').reduce<unknown>((node, part) => (
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    ), zhCN);
    return typeof value === 'string' ? value : key;
};

const entries = buildLyricStyleWindowEntries(translate, '外观 › 歌词样式与背景');
const hitsFor = (query: string) => searchSettings(entries, query, 'zh-CN');

describe('lyric style window search', () => {
    it('finds a background by name and lands on the background page', () => {
        expect(hitsFor('漫游')).toEqual([{
            sectionId: 'appearance',
            targetId: null,
            workWindowSection: 'background',
            label: '漫游',
            path: '外观 › 歌词样式与背景 › 背景',
        }]);
    });

    it('finds a page of the window by its tab name', () => {
        expect(hitsFor('字幕').map(hit => hit.workWindowSection)).toContain('subtitle');
    });

    it('does not list every entry for a query that only names the path', () => {
        expect(hitsFor('外观')).toEqual([]);
    });
});
