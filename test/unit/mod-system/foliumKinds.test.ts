// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FOLIUM_ENTRY_NOTICE_WORDS, FOLIUM_KIND_NAMES, FOLIUM_KINDS } from '@/mods/folium/kinds';
import { listFoliumHostRegistries } from '@/mods/folium/api';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import id from '@/i18n/locales/in';

// test/unit/mod-system/foliumKinds.test.ts
// The kinds table (kinds.ts) against what is built from it. The compiler holds
// the table to the contract (one row per member of `folium.registries`) and
// asks api.ts for a registry per row. What it cannot see: that the registry
// given for a row is that kind's own, that no two kinds mark their containers
// with the same name, and that every notice a failing piece can raise has its
// sentence in the three languages.

describe('the kinds table', () => {
    it('is bound, row by row, to the registry of the same name', () => {
        const bound = listFoliumHostRegistries().slice(0, FOLIUM_KIND_NAMES.length).map((registry) => registry.name);
        expect(bound).toEqual(FOLIUM_KIND_NAMES);
    });

    it('gives each container name to one kind only', () => {
        const names = FOLIUM_KIND_NAMES.flatMap((name) => Object.keys(FOLIUM_KINDS[name].mounts));
        expect(new Set(names).size).toBe(names.length);
        expect(Object.keys(FOLIUM_ENTRY_NOTICE_WORDS).sort()).toEqual([...names].sort());
    });

    it('gives the containers of one kind different notice words, so a mount site finds its name by them', () => {
        FOLIUM_KIND_NAMES.forEach((name) => {
            const words = Object.values(FOLIUM_KINDS[name].mounts);
            expect(new Set(words).size, name).toBe(words.length);
        });
    });

    it('has the sentence of every failure notice in the three languages', () => {
        const words = new Set(Object.values(FOLIUM_ENTRY_NOTICE_WORDS));
        const locales = { en, 'zh-CN': zhCN, in: id } as unknown as Record<string, { mods: { faultNotice: Record<string, string> } }>;
        Object.entries(locales).forEach(([language, locale]) => {
            words.forEach((word) => {
                expect(locale.mods.faultNotice[word], `${language}: mods.faultNotice.${word}`).toEqual(expect.any(String));
            });
        });
    });
});
