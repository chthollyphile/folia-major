import { describe, expect, it } from 'vitest';
import { SETTINGS_ANCHOR_DEFINITIONS } from '../../../src/components/modal/settings/navigation/settingsAnchorModel';
import { SETTINGS_NAV_GROUP_SPECS, buildSettingsNavGroups, findSettingsNavItem, flattenSettingsNavItems, type SettingsSectionId } from '../../../src/components/modal/settings/navigation/settingsNavModel';
import en from '../../../src/i18n/locales/en';
import zhCN from '../../../src/i18n/locales/zh-CN';
import id from '../../../src/i18n/locales/in';

// test/unit/settings/settingsNavModel.test.ts
// The nav model is the one list of settings categories; these lock in that every category appears
// exactly once, that every place other code can open belongs to one of them, and that every key the
// model points at exists in all locales.

const echo = (key: string) => key;

const ALL_SECTIONS: SettingsSectionId[] = [
    'appearance', 'player', 'home', 'playback', 'lyrics', 'general', 'interaction', 'integration', 'storage', 'desktop', 'graphics', 'mods', 'developer',
];

const lookup = (bundle: Record<string, unknown>, key: string): unknown => (
    key.split('.').reduce<unknown>((node, part) => (
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    ), bundle)
);

describe('settingsNavModel', () => {
    it('lists every section exactly once on desktop, in side-list order', () => {
        const ids = flattenSettingsNavItems(buildSettingsNavGroups(echo, { isElectron: true })).map(item => item.id);
        expect(ids).toEqual(ALL_SECTIONS);
    });

    it('drops desktop-only sections on web without leaving an empty group', () => {
        const groups = buildSettingsNavGroups(echo, { isElectron: false });
        const ids = flattenSettingsNavItems(groups).map(item => item.id);

        expect(ids).not.toContain('desktop');
        expect(ids).not.toContain('mods');
        expect(ids).toHaveLength(ALL_SECTIONS.length - 2);
        expect(groups.every(group => group.items.length > 0)).toBe(true);
    });

    it('resolves a nav item for every section id', () => {
        const groups = buildSettingsNavGroups(echo, { isElectron: true });
        for (const sectionId of ALL_SECTIONS) {
            expect(findSettingsNavItem(groups, sectionId)?.id).toBe(sectionId);
        }
    });

    // A command or a link names an anchor; the table has to send it to a category that exists.
    it('places every anchor in a category of the model', () => {
        for (const [anchorId, definition] of Object.entries(SETTINGS_ANCHOR_DEFINITIONS)) {
            expect(ALL_SECTIONS, `${anchorId} → ${definition.section}`).toContain(definition.section);
        }
    });

    it.each([['en', en], ['zh-CN', zhCN], ['in', id]] as const)('has every label key in %s', (_name, bundle) => {
        const keys = SETTINGS_NAV_GROUP_SPECS.flatMap(group => [
            group.labelKey,
            ...group.sections.map(section => section.labelKey),
        ]);

        for (const key of keys) {
            expect(typeof lookup(bundle as unknown as Record<string, unknown>, key), `${key} missing`).toBe('string');
        }
    });
});
