import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SETTINGS_SECTION,
    SETTINGS_LAST_SECTION_STORAGE_KEY,
    getAvailableSettingsSectionIds,
    isSettingsSectionSubview,
    readLastSettingsSection,
    resolveInitialSettingsSection,
    sectionForSettingsSubview,
    writeLastSettingsSection,
    type SettingsSectionStorage,
} from '../../../src/components/modal/settings/navigation/settingsLastSection';
import { buildSettingsNavGroups, flattenSettingsNavItems } from '../../../src/components/modal/settings/navigation/settingsNavModel';

// test/unit/settings/settingsLastSection.test.ts
// The settings dialog remembers the last options section it was on. These pin the rules that are easy
// to break silently: an unusable stored id must fall back, a named target must beat the memory, and a
// storage that throws must never take the dialog down with it.

const DESKTOP = { isElectron: true };
const WEB = { isElectron: false };

const createStorage = (initial: Record<string, string> = {}): SettingsSectionStorage & { data: Record<string, string> } => {
    const data = { ...initial };
    return {
        data,
        getItem: (key: string) => (key in data ? data[key] : null),
        setItem: (key: string, value: string) => {
            data[key] = value;
        },
    };
};

const throwingStorage: SettingsSectionStorage = {
    getItem: () => {
        throw new Error('storage blocked');
    },
    setItem: () => {
        throw new Error('quota exceeded');
    },
};

describe('settingsLastSection', () => {
    it('keeps the storage key stable', () => {
        // A renamed key silently forgets everyone's last page.
        expect(SETTINGS_LAST_SECTION_STORAGE_KEY).toBe('folia_settings_last_section');
    });

    it('lists the same sections the sidebar shows on each platform', () => {
        for (const availability of [DESKTOP, WEB]) {
            const sidebarIds = flattenSettingsNavItems(buildSettingsNavGroups(key => key, availability)).map(item => item.id);
            expect(getAvailableSettingsSectionIds(availability)).toEqual(sidebarIds);
        }
    });

    describe('read', () => {
        it('restores a stored section that is still available', () => {
            const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'graphics' });
            expect(readLastSettingsSection(WEB, storage)).toBe('graphics');
        });

        it('returns null when nothing is stored', () => {
            expect(readLastSettingsSection(WEB, createStorage())).toBeNull();
        });

        it('returns null for an id that no longer exists', () => {
            // 'lab' is a category an older build could have stored; it has since been dissolved.
            for (const id of ['someRemovedSection', 'lab']) {
                const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: id });
                expect(readLastSettingsSection(DESKTOP, storage)).toBeNull();
            }
        });

        it('returns null for subview ids that are not sidebar sections', () => {
            for (const id of ['visualizer', 'themePark', 'lyricFilter', 'globalLyricOffset', '']) {
                const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: id });
                expect(readLastSettingsSection(DESKTOP, storage)).toBeNull();
            }
        });

        it('returns null for a section the current platform hides', () => {
            const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'desktop' });
            expect(readLastSettingsSection(WEB, storage)).toBeNull();
            expect(readLastSettingsSection(DESKTOP, storage)).toBe('desktop');

            storage.data[SETTINGS_LAST_SECTION_STORAGE_KEY] = 'mods';
            expect(readLastSettingsSection(WEB, storage)).toBeNull();
        });

        it('returns null instead of throwing when storage is unavailable', () => {
            expect(readLastSettingsSection(WEB, throwingStorage)).toBeNull();
            expect(readLastSettingsSection(WEB, null)).toBeNull();
        });
    });

    describe('write', () => {
        it('stores an available section', () => {
            const storage = createStorage();
            writeLastSettingsSection('integration', WEB, storage);
            expect(storage.data[SETTINGS_LAST_SECTION_STORAGE_KEY]).toBe('integration');
        });

        it('does not store a section the platform hides', () => {
            const storage = createStorage();
            writeLastSettingsSection('desktop', WEB, storage);
            expect(storage.data).toEqual({});
        });

        it('swallows storage errors', () => {
            expect(() => writeLastSettingsSection('storage', WEB, throwingStorage)).not.toThrow();
            expect(() => writeLastSettingsSection('storage', WEB, null)).not.toThrow();
        });
    });

    describe('sectionForSettingsSubview', () => {
        it('maps section subviews to themselves', () => {
            expect(sectionForSettingsSubview('player')).toBe('player');
            expect(sectionForSettingsSubview('mods')).toBe('mods');
        });

        it('maps the lyrics secondary panels back to lyrics', () => {
            expect(sectionForSettingsSubview('lyricFilter')).toBe('lyrics');
            expect(sectionForSettingsSubview('globalLyricOffset')).toBe('lyrics');
        });

        it('has no section for overlay workbenches or empty targets', () => {
            expect(sectionForSettingsSubview('visualizer')).toBeNull();
            expect(sectionForSettingsSubview('themePark')).toBeNull();
            expect(sectionForSettingsSubview(null)).toBeNull();
            expect(sectionForSettingsSubview(undefined)).toBeNull();
        });

        it('only counts real sections as entered pages', () => {
            expect(isSettingsSectionSubview('general')).toBe(true);
            expect(isSettingsSectionSubview('lyricFilter')).toBe(false);
            expect(isSettingsSectionSubview('visualizer')).toBe(false);
            expect(isSettingsSectionSubview(null)).toBe(false);
        });
    });

    describe('resolveInitialSettingsSection', () => {
        it('restores the remembered section on a bare open', () => {
            const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'storage' });
            expect(resolveInitialSettingsSection({ initialSubview: null, hasInitialAnchor: false, ...WEB }, storage)).toBe('storage');
            expect(resolveInitialSettingsSection({ initialSubview: undefined, hasInitialAnchor: false, ...WEB }, storage)).toBe('storage');
        });

        it('falls back to the default when the memory is empty or unusable', () => {
            const request = { initialSubview: null, hasInitialAnchor: false, ...WEB };
            expect(resolveInitialSettingsSection(request, createStorage())).toBe(DEFAULT_SETTINGS_SECTION);
            expect(resolveInitialSettingsSection(request, createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'gone' }))).toBe(DEFAULT_SETTINGS_SECTION);
            expect(resolveInitialSettingsSection(request, createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'desktop' }))).toBe(DEFAULT_SETTINGS_SECTION);
            expect(resolveInitialSettingsSection(request, throwingStorage)).toBe(DEFAULT_SETTINGS_SECTION);
            expect(resolveInitialSettingsSection(request, null)).toBe(DEFAULT_SETTINGS_SECTION);
        });

        it('lets an explicit subview beat the memory', () => {
            const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'storage' });
            expect(resolveInitialSettingsSection({ initialSubview: 'player', hasInitialAnchor: false, ...WEB }, storage)).toBe('player');
            expect(resolveInitialSettingsSection({ initialSubview: 'lyricFilter', hasInitialAnchor: false, ...WEB }, storage)).toBe('lyrics');
        });

        it('does not let the memory leak behind an overlay target', () => {
            const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'storage' });
            expect(resolveInitialSettingsSection({ initialSubview: 'visualizer', hasInitialAnchor: false, ...WEB }, storage)).toBe(DEFAULT_SETTINGS_SECTION);
            expect(resolveInitialSettingsSection({ initialSubview: 'themePark', hasInitialAnchor: false, ...WEB }, storage)).toBe(DEFAULT_SETTINGS_SECTION);
        });

        it('treats an anchor as an explicit target too', () => {
            const storage = createStorage({ [SETTINGS_LAST_SECTION_STORAGE_KEY]: 'storage' });
            expect(resolveInitialSettingsSection({ initialSubview: null, hasInitialAnchor: true, ...WEB }, storage)).toBe(DEFAULT_SETTINGS_SECTION);
        });

        it('round-trips through write then resolve', () => {
            const storage = createStorage();
            writeLastSettingsSection('graphics', DESKTOP, storage);
            expect(resolveInitialSettingsSection({ initialSubview: null, hasInitialAnchor: false, ...DESKTOP }, storage)).toBe('graphics');
        });
    });
});
