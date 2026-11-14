import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import ind from '@/i18n/locales/in';
import vi from '@/i18n/locales/vi';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { listBuiltinSourceDirs } from '../helpers/builtinSources';

// test/unit/i18n/providerName.test.ts
// A provider names itself in the interface through `shortNameKey` (`onlineProviderName.<id>`), and the
// interface translates it. These pin that every registered provider has that key in every language
// (otherwise the English interface would fall back to the platform's own, usually Chinese, name),
// and that the Mandarin names live in the Mandarin bundle.
//
// Folium 2.0: a platform moved into sources/<id>/ (S5) names itself from its own manifest and locale files
// (the built-in manifest check, test/unit/sources/builtinManifests.test.ts, wants the four languages there),
// so its key leaves the host's bundles; the providers still registered by the host keep theirs here.

type Bundle = { onlineProviderName?: Record<string, string> };
const names = (bundle: unknown): Record<string, string> => (bundle as Bundle).onlineProviderName ?? {};

/** The source ids the source mods in sources/ declare. */
const movedIds = new Set(listBuiltinSourceDirs().flatMap((dir) => (
    (JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')) as { sources?: { id: string }[] }).sources ?? []
).map((source) => source.id)));

describe('provider names in the locale bundles', () => {
    it('has a short name for every provider the host registers, in every language', () => {
        const ids = listOnlineMusicProviders().map(provider => provider.id).filter(id => !movedIds.has(id)).sort();
        expect(ids.length).toBeGreaterThan(0);
        for (const bundle of [en, zhCN, ind, vi]) {
            expect(Object.keys(names(bundle)).sort()).toEqual(ids);
        }
    });

    it('keeps the Mandarin names in the Mandarin bundle', () => {
        const expected = { netease: '网易云', kugou: '酷狗', qq: 'QQ音乐', bodian: '波点', qishui: '汽水' };
        expect(names(zhCN)).toMatchObject(Object.fromEntries(Object.entries(expected).filter(([id]) => !movedIds.has(id))));
    });
});
