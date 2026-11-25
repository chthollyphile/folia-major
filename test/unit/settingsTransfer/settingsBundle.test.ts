// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    SETTINGS_BUNDLE_FORMAT,
    SETTINGS_BUNDLE_VERSION,
    buildSettingsBundle,
    encodeStoredSetting,
    parseSettingsBundle,
    readStoredSetting,
    serializeSettingsBundle,
} from '../../../src/services/settingsTransfer/settingsBundle';
import { allPlannedGroups, applySettingsImport, planSettingsImport } from '../../../src/services/settingsTransfer/settingsImportPlan';

// test/unit/settingsTransfer/settingsBundle.test.ts
// The whole-settings document: what it carries, what it refuses, and what taking one writes.
//
// The cases that matter are the ones a person's file can be wrong in: a bundle from a newer build,
// a key this build does not know, a value of the wrong shape, and a file that is not a bundle at
// all. Each is refused or skipped by name rather than written half-way.
//
// The keys used here are the catalog's own: appearance's theme switches and the scene, playback's
// quality, the player page's offset. The visual config code's keys (visualizer_mode, the lyrics
// font) are deliberately not among them — one setting reaches the other machine one way, and those
// travel in the shortcode.

const seed = (entries: Record<string, string>) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) {
        localStorage.setItem(key, value);
    }
};

beforeEach(() => {
    localStorage.clear();
});

describe('stored setting values', () => {
    it('reads a stored setting in the shape the catalog says it has', () => {
        seed({
            default_theme_daylight: 'true',
            player_bottom_bar_offset: '0.42',
            scene_options: '{"hall":{"quality":"high"}}',
            scene_id: 'hall',
        });
        expect(readStoredSetting('default_theme_daylight', 'boolean')).toBe(true);
        expect(readStoredSetting('player_bottom_bar_offset', 'number')).toBe(0.42);
        expect(readStoredSetting('scene_options', 'json')).toEqual({ hall: { quality: 'high' } });
        expect(readStoredSetting('scene_id', 'string')).toBe('hall');
    });

    it('leaves an unset key unset rather than inventing a default', () => {
        expect(readStoredSetting('default_theme_daylight', 'boolean')).toBeUndefined();
    });

    it('refuses a value of the wrong shape, so a hand-edited bundle cannot store one', () => {
        expect(encodeStoredSetting('default_theme_daylight', 'yes')).toBeNull();
        expect(encodeStoredSetting('player_bottom_bar_offset', Number.NaN)).toBeNull();
        expect(encodeStoredSetting('scene_id', 7)).toBeNull();
        // A key the catalog does not name is refused whatever its value looks like: one that is
        // excluded because it belongs to this machine, and one the visual config code carries.
        expect(encodeStoredSetting('player_volume', 0.5)).toBeNull();
        expect(encodeStoredSetting('visualizer_mode', 'sonnet')).toBeNull();
    });

    it('writes the string the stores read back', () => {
        expect(encodeStoredSetting('default_theme_daylight', true)).toBe('true');
        expect(encodeStoredSetting('player_bottom_bar_offset', 0.42)).toBe('0.42');
        expect(encodeStoredSetting('scene_options', { hall: { quality: 'high' } })).toBe('{"hall":{"quality":"high"}}');
        expect(encodeStoredSetting('scene_id', 'hall')).toBe('hall');
    });
});

describe('building a bundle', () => {
    it('carries the stored settings, grouped, and nothing that is not set', async () => {
        seed({ default_theme_daylight: 'true', auto_hide_player_chrome: 'true' });
        const bundle = await buildSettingsBundle();

        expect(bundle.format).toBe(SETTINGS_BUNDLE_FORMAT);
        expect(bundle.version).toBe(SETTINGS_BUNDLE_VERSION);
        expect(bundle.settings.appearance).toEqual({ default_theme_daylight: true });
        expect(bundle.settings.player).toEqual({ auto_hide_player_chrome: true });
        // A group nothing is set in is left out rather than written empty.
        expect(bundle.settings.lyrics).toBeUndefined();
        // The web build has no mod system, so the list is absent rather than empty.
        expect(bundle.mods).toBeUndefined();
    });

    it('leaves out a key that belongs to this machine, even when it is stored', async () => {
        seed({ default_theme_daylight: 'true', player_volume: '0.5' });
        const bundle = await buildSettingsBundle();
        expect(JSON.stringify(bundle)).not.toContain('player_volume');
    });

    it('leaves the main process\u2019s desktop switches behind, since the launch snapshot overwrites them', async () => {
        seed({
            default_theme_daylight: 'true',
            close_to_tray: 'true',
            wallpaper_mode: 'true',
            gpu_preference: 'high-performance',
            mod_system_enabled: 'true',
        });
        const bundle = await buildSettingsBundle();
        const stored = JSON.stringify(bundle);
        // An import of these would be undone before the reload finished: the main process sends its
        // own values on launch and they are written over localStorage.
        for (const key of ['close_to_tray', 'wallpaper_mode', 'gpu_preference', 'mod_system_enabled']) {
            expect(stored).not.toContain(key);
        }
        // The interface's own preference still travels; the desktop group has nothing left to carry.
        expect(bundle.settings.appearance).toEqual({ default_theme_daylight: true });
        expect(bundle.settings.desktop).toBeUndefined();
    });

    it('leaves the visual config code\u2019s own keys to the shortcode, so one setting travels one way', async () => {
        seed({
            default_theme_daylight: 'true',
            // Both belong to the shortcode, which carries only a system font family and never an
            // uploaded file. Listing them here too is the duplicate the review asked to settle.
            visualizer_mode: 'sonnet',
            lyrics_custom_font: JSON.stringify({ source: 'uploaded', family: 'My Font', fontId: 'font-1' }),
        });
        const bundle = await buildSettingsBundle();
        const stored = JSON.stringify(bundle);
        expect(stored).not.toContain('font-1');
        expect(stored).not.toContain('lyrics_custom_font');
        expect(stored).not.toContain('visualizer_mode');
        expect(bundle.settings.appearance).toEqual({ default_theme_daylight: true });
    });
});

describe('reading a bundle', () => {
    const stamp = { format: SETTINGS_BUNDLE_FORMAT, version: 1, createdAt: '2026-01-01T00:00:00.000Z', app: { version: '1.0.0', platform: 'test' } };

    it('round-trips what was written', async () => {
        seed({ default_theme_daylight: 'true', default_audio_quality: 'lossless' });
        const written = await buildSettingsBundle();
        const read = parseSettingsBundle(serializeSettingsBundle(written));
        expect(read.bundle.settings).toEqual(written.settings);
        expect(read.skipped).toEqual([]);
    });

    it('refuses text that is not a bundle', () => {
        expect(() => parseSettingsBundle('not json')).toThrow();
        expect(() => parseSettingsBundle('{"hello":1}')).toThrow();
        expect(() => parseSettingsBundle(JSON.stringify({ ...stamp, format: 'something-else' }))).toThrow();
    });

    it('refuses a bundle from a newer build rather than dropping what it added', () => {
        expect(() => parseSettingsBundle(JSON.stringify({ ...stamp, version: SETTINGS_BUNDLE_VERSION + 1 })))
            .toThrow(/newer/);
    });

    it('names what it cannot take instead of writing it blind', () => {
        const read = parseSettingsBundle(JSON.stringify({
            ...stamp,
            settings: {
                appearance: {
                    default_theme_daylight: true,
                    some_future_setting: true,
                    scene_id: 42,
                    // The shortcode's key: this build refuses it by name rather than writing it.
                    visualizer_mode: 'sonnet',
                },
            },
        }));
        expect(read.bundle.settings.appearance).toEqual({ default_theme_daylight: true });
        expect(read.skipped.map(entry => entry.key).sort())
            .toEqual(['scene_id', 'some_future_setting', 'visualizer_mode']);
    });

    it('keeps the mods a bundle lists, for the dialog to mention', () => {
        const read = parseSettingsBundle(JSON.stringify({
            ...stamp,
            settings: {},
            mods: [{ id: 'k3panel', name: 'K3 Panel', version: '1.2.0', enabled: true }],
        }));
        expect(read.bundle.mods).toEqual([{ id: 'k3panel', name: 'K3 Panel', version: '1.2.0', enabled: true }]);
    });
});

describe('taking a bundle', () => {
    const stamp = { format: SETTINGS_BUNDLE_FORMAT, version: 1, createdAt: '2026-01-01T00:00:00.000Z', app: { version: '1.0.0', platform: 'test' } };

    it('plans only what would change, and only the groups that change', () => {
        seed({ default_theme_daylight: 'true', default_audio_quality: 'high' });
        const plan = planSettingsImport(JSON.stringify({
            ...stamp,
            settings: {
                // Same value: nothing to do.
                appearance: { default_theme_daylight: true },
                // Different value: one change.
                playback: { default_audio_quality: 'lossless' },
            },
        }));
        expect(plan.groups.map(group => group.group)).toEqual(['playback']);
        expect(plan.totalChanged).toBe(1);
        expect(plan.groups[0].changes[0]).toMatchObject({ key: 'default_audio_quality', kind: 'set', incoming: 'lossless' });
    });

    it('marks a setting this machine never had as an addition', () => {
        seed({});
        const plan = planSettingsImport(JSON.stringify({ ...stamp, settings: { playback: { default_audio_quality: 'lossless' } } }));
        expect(plan.groups[0].changes[0]).toMatchObject({ kind: 'add', current: undefined });
    });

    it('writes the picked groups and leaves the others exactly as they were', () => {
        seed({ default_theme_daylight: 'true', default_audio_quality: 'high' });
        const plan = planSettingsImport(JSON.stringify({
            ...stamp,
            settings: {
                appearance: { default_theme_daylight: false },
                playback: { default_audio_quality: 'lossless' },
            },
        }));
        const written = applySettingsImport(plan, ['appearance']);
        expect(written).toBe(1);
        expect(localStorage.getItem('default_theme_daylight')).toBe('false');
        expect(localStorage.getItem('default_audio_quality')).toBe('high');
    });

    it('refuses the shortcode\u2019s keys by name, leaving this machine\u2019s own font alone', () => {
        seed({ lyrics_custom_font: JSON.stringify({ source: 'system', family: 'Noto Sans CJK SC' }) });
        const plan = planSettingsImport(JSON.stringify({
            ...stamp,
            settings: {
                lyrics: {
                    auto_use_best_lyric: false,
                    // Carried by the shortcode, which only ever names a system family.
                    lyrics_custom_font: { source: 'uploaded', family: 'Someone Else\u2019s Font', fontId: 'font-9' },
                },
            },
        }));
        expect(plan.skipped.map(entry => entry.key)).toContain('lyrics_custom_font');
        const planned = plan.groups.flatMap(group => group.changes.map(change => change.key));
        expect(planned).not.toContain('lyrics_custom_font');
        // The rest of the group is still taken, and the font this machine has is left alone.
        expect(plan.totalChanged).toBe(1);
        applySettingsImport(plan, allPlannedGroups(plan));
        expect(localStorage.getItem('lyrics_custom_font')).toBe('{"source":"system","family":"Noto Sans CJK SC"}');
    });

    it('writes nothing when nothing is picked', () => {
        seed({ default_theme_daylight: 'true' });
        const plan = planSettingsImport(JSON.stringify({ ...stamp, settings: { appearance: { default_theme_daylight: false } } }));
        expect(applySettingsImport(plan, [])).toBe(0);
        expect(localStorage.getItem('default_theme_daylight')).toBe('true');
    });
});
