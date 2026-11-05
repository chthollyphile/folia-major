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
import { applySettingsImport, planSettingsImport } from '../../../src/services/settingsTransfer/settingsImportPlan';

// test/unit/settingsTransfer/settingsBundle.test.ts
// The whole-settings document: what it carries, what it refuses, and what taking one writes.
//
// The cases that matter are the ones a person's file can be wrong in: a bundle from a newer build,
// a key this build does not know, a value of the wrong shape, and a file that is not a bundle at
// all. Each is refused or skipped by name rather than written half-way.

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
    it('reads a stored string in the shape the catalog says it has', () => {
        seed({
            visualizer_mode: 'sonnet',
            background_opacity: '0.42',
            follow_system_theme: 'true',
            lyrics_font_fallback_families: '["A","B"]',
        });
        expect(readStoredSetting('visualizer_mode', 'string')).toBe('sonnet');
        expect(readStoredSetting('background_opacity', 'number')).toBe(0.42);
        expect(readStoredSetting('follow_system_theme', 'boolean')).toBe(true);
        expect(readStoredSetting('lyrics_font_fallback_families', 'json')).toEqual(['A', 'B']);
    });

    it('leaves an unset key unset rather than inventing a default', () => {
        expect(readStoredSetting('visualizer_mode', 'string')).toBeUndefined();
    });

    it('refuses a value of the wrong shape, so a hand-edited bundle cannot store one', () => {
        expect(encodeStoredSetting('follow_system_theme', 'yes')).toBeNull();
        expect(encodeStoredSetting('background_opacity', Number.NaN)).toBeNull();
        expect(encodeStoredSetting('visualizer_mode', 7)).toBeNull();
        // A key the catalog does not name is refused whatever its value looks like.
        expect(encodeStoredSetting('player_volume', 0.5)).toBeNull();
    });

    it('writes the string the stores read back', () => {
        expect(encodeStoredSetting('follow_system_theme', true)).toBe('true');
        expect(encodeStoredSetting('background_opacity', 0.42)).toBe('0.42');
        expect(encodeStoredSetting('lyrics_font_fallback_families', ['A'])).toBe('["A"]');
        expect(encodeStoredSetting('visualizer_mode', 'sonnet')).toBe('sonnet');
    });
});

describe('building a bundle', () => {
    it('carries the stored settings, grouped, and nothing that is not set', async () => {
        seed({ visualizer_mode: 'sonnet', auto_hide_player_chrome: 'true' });
        const bundle = await buildSettingsBundle();

        expect(bundle.format).toBe(SETTINGS_BUNDLE_FORMAT);
        expect(bundle.version).toBe(SETTINGS_BUNDLE_VERSION);
        expect(bundle.settings.appearance).toEqual({ visualizer_mode: 'sonnet' });
        expect(bundle.settings.player).toEqual({ auto_hide_player_chrome: true });
        // A group nothing is set in is left out rather than written empty.
        expect(bundle.settings.lyrics).toBeUndefined();
        // The web build has no mod system, so the list is absent rather than empty.
        expect(bundle.mods).toBeUndefined();
    });

    it('leaves out a key the catalog excludes, even when it is stored', async () => {
        seed({ visualizer_mode: 'sonnet', player_volume: '0.5' });
        const bundle = await buildSettingsBundle();
        const stored = JSON.stringify(bundle);
        expect(stored).not.toContain('player_volume');
    });
});

describe('reading a bundle', () => {
    const stamp = { format: SETTINGS_BUNDLE_FORMAT, version: 1, createdAt: '2026-01-01T00:00:00.000Z', app: { version: '1.0.0', platform: 'test' } };

    it('round-trips what was written', async () => {
        seed({ visualizer_mode: 'sonnet', background_opacity: '0.42' });
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
                    visualizer_mode: 'sonnet',
                    some_future_setting: true,
                    background_opacity: 'not a number',
                },
            },
        }));
        expect(read.bundle.settings.appearance).toEqual({ visualizer_mode: 'sonnet' });
        expect(read.skipped.map(entry => entry.key).sort()).toEqual(['background_opacity', 'some_future_setting']);
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
        seed({ visualizer_mode: 'sonnet', default_audio_quality: 'high' });
        const plan = planSettingsImport(JSON.stringify({
            ...stamp,
            settings: {
                // Same value: nothing to do.
                appearance: { visualizer_mode: 'sonnet' },
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
        seed({ visualizer_mode: 'sonnet', default_audio_quality: 'high' });
        const plan = planSettingsImport(JSON.stringify({
            ...stamp,
            settings: {
                appearance: { visualizer_mode: 'fume' },
                playback: { default_audio_quality: 'lossless' },
            },
        }));
        const written = applySettingsImport(plan, ['appearance']);
        expect(written).toBe(1);
        expect(localStorage.getItem('visualizer_mode')).toBe('fume');
        expect(localStorage.getItem('default_audio_quality')).toBe('high');
    });

    it('writes nothing when nothing is picked', () => {
        seed({ visualizer_mode: 'sonnet' });
        const plan = planSettingsImport(JSON.stringify({ ...stamp, settings: { appearance: { visualizer_mode: 'fume' } } }));
        expect(applySettingsImport(plan, [])).toBe(0);
        expect(localStorage.getItem('visualizer_mode')).toBe('sonnet');
    });
});
