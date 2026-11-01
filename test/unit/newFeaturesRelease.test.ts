import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en';
import inLocale from '../../src/i18n/locales/in';
import zhCN from '../../src/i18n/locales/zh-CN';
import { NEW_FEATURES_RELEASE } from '../../src/components/modal/newFeaturesRelease';
import { USER_GUIDE_AUTO_OPEN_VERSION } from '../../src/components/modal/userGuideContent';

// test/unit/newFeaturesRelease.test.ts
// The release intro reads every card's text by key at render time; a key missing in one locale shows the raw key there.

const LOCALES = { en, in: inLocale, 'zh-CN': zhCN } as Record<string, unknown>;

const lookup = (tree: unknown, path: string): unknown => path.split('.').reduce<unknown>(
    (node, segment) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined),
    tree,
);

describe('new features release', () => {
    it.each(Object.keys(LOCALES))('has the intro and every card title / description in %s', (locale) => {
        const tree = LOCALES[locale];
        const texts = [
            `${NEW_FEATURES_RELEASE.i18nKey}.intro`,
            ...NEW_FEATURES_RELEASE.features.flatMap(feature => [
                `${NEW_FEATURES_RELEASE.i18nKey}.${feature.id}.title`,
                `${NEW_FEATURES_RELEASE.i18nKey}.${feature.id}.description`,
            ]),
        ];
        for (const key of texts) {
            expect(lookup(tree, key), key).toEqual(expect.any(String));
        }
    });

    it.each(Object.keys(LOCALES))('has the major update label in %s whenever the release names one', (locale) => {
        if (!NEW_FEATURES_RELEASE.majorUpdate) return;
        const label = lookup(LOCALES[locale], 'help.majorUpdateLabel');
        expect(label).toEqual(expect.stringContaining('{{codename}}'));
        if (!NEW_FEATURES_RELEASE.majorUpdate.servicePack) return;
        const servicePackLabel = lookup(LOCALES[locale], 'help.servicePackLabel');
        expect(servicePackLabel).toEqual(expect.stringContaining('{{codename}}'));
        expect(servicePackLabel).toEqual(expect.stringContaining('{{servicePack}}'));
    });

    it('uses card ids once each and the release key that matches the auto-open version', () => {
        const ids = NEW_FEATURES_RELEASE.features.map(feature => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(NEW_FEATURES_RELEASE.i18nKey).toBe(`releaseNotes.v${(USER_GUIDE_AUTO_OPEN_VERSION ?? '').replace(/\./g, '_')}`);
    });
});
