import { describe, expect, it } from 'vitest';
import { buildImportPlan } from '@/utils/appearanceImportPlan';
import type { ThemePreferenceSwitchState } from '@/services/themePreferences';

// test/unit/utils/appearanceImportPlan.test.ts
// The diff an import would apply, computed before anything is applied. The derived cases matter
// most: accepting a song-theme switch can also unpin a custom theme, which the config never names.

const pinned: ThemePreferenceSwitchState = {
    isCustomThemePreferred: true,
    songThemeAutoSwitchEnabled: false,
    songThemeAutoGenerateEnabled: false,
};
const unpinned: ThemePreferenceSwitchState = {
    isCustomThemePreferred: false,
    songThemeAutoSwitchEnabled: true,
    songThemeAutoGenerateEnabled: false,
};

// Custom is the active mode unless a test says otherwise, so the activate row stays out of the way
// of the cases that are about the theme sides themselves.
const plan = (incoming: Record<string, unknown>, current: Record<string, unknown> = {}, switches = pinned) =>
    buildImportPlan({ incoming, current, switches, isCustomThemeActive: true });

const keys = (p: ReturnType<typeof plan>) => p.changes.map(c => c.key);

describe('buildImportPlan', () => {
    it('reports nothing when the incoming config matches the current one', () => {
        const same = { visualizerMode: 'monet', backgroundOpacity: 0.75, lyricsFontScale: 1 };
        const p = plan(same, same, unpinned);
        expect(p.changes).toEqual([]);
        expect(p.groups).toEqual([]);
    });

    it('ignores fields the incoming config does not mention', () => {
        const p = plan({ visualizerMode: 'monet' }, { visualizerMode: 'classic', backgroundOpacity: 0.5 }, unpinned);
        expect(keys(p)).toEqual(['visualizerMode']);
    });

    it('plans the system theme preference as a theme setting', () => {
        const p = plan({ followSystemTheme: true }, { followSystemTheme: false }, unpinned);
        expect(p.changes).toContainEqual(expect.objectContaining({
            key: 'followSystemTheme',
            group: 'theme',
            from: false,
            to: true,
        }));
    });

    it('sorts changes into the group they are presented under', () => {
        const p = plan({
            theme: { light: { name: 'X' }, dark: { name: 'Y' } },
            visualizerMode: 'monet',
            lyricsFontScale: 1.25,
            backgroundOpacity: 0.3,
        }, { visualizerMode: 'classic', lyricsFontScale: 1, backgroundOpacity: 0.75 }, unpinned);
        expect(p.groups).toEqual(['theme', 'visualizer', 'fonts', 'background']);
    });

    // Regression: applyImportedConfig applies these dev-merge fields, so buildImportPlan must diff
    // them too. Left out of FIELD_GROUPS the plan emits no row, the plan-gated apply never sees the
    // key, and the exported value is silently dropped on import with no warning.
    it('plans the subtitle and harmony fields the apply path writes', () => {
        const p = plan({
            subtitleContentMode: 'romanization',
            showHarmonySubtitle: true,
            harmonySubtitleBackground: true,
            subtitleFontScale: 1.4,
        }, {
            subtitleContentMode: 'translation',
            showHarmonySubtitle: false,
            harmonySubtitleBackground: false,
            subtitleFontScale: 1,
        }, unpinned);
        expect(keys(p)).toEqual(expect.arrayContaining([
            'subtitleContentMode', 'showHarmonySubtitle', 'harmonySubtitleBackground', 'subtitleFontScale',
        ]));
        expect(p.changes.find(c => c.key === 'subtitleContentMode')?.group).toBe('visualizer');
        expect(p.changes.find(c => c.key === 'subtitleFontScale')?.group).toBe('fonts');
    });

    // The harmony toggles are diffed both ways: false is a real value, not "the exporter had none",
    // so turning one off must still be offered.
    it('plans a harmony toggle turning off', () => {
        expect(keys(plan({ showHarmonySubtitle: false }, { showHarmonySubtitle: true }, unpinned)))
            .toContain('showHarmonySubtitle');
    });

    // subtitleContentMode is enum-guarded in applyImportedConfig (only translation/romanization/none
    // land), so an empty incoming value is skipped there and must not be promised here.
    it('skips an empty subtitleContentMode the apply path would not set', () => {
        expect(keys(plan({ subtitleContentMode: '' }, { subtitleContentMode: 'translation' }, unpinned)))
            .not.toContain('subtitleContentMode');
    });

    // Now that buildVisualSettingsConfig carries the font weights they round-trip, so the plan must
    // diff them. null is a real value ("use the mode default"), not "the exporter carried none", so
    // it is diffed too and can reset a weight rather than being dropped.
    it('plans the custom font weights, including a reset to the mode default', () => {
        expect(keys(plan({ lyricsFontWeight: 700 }, { lyricsFontWeight: 400 }, unpinned)))
            .toContain('lyricsFontWeight');
        expect(keys(plan({ subtitleFontWeight: null }, { subtitleFontWeight: 700 }, unpinned)))
            .toContain('subtitleFontWeight');
    });

    // The weight setters clamp+round, but the codec carries the raw value, so the plan diffs against
    // the normalized value apply will store: the row shows what actually happens and a re-import of a
    // non-canonical weight converges instead of re-appearing forever.
    it('normalizes an incoming weight to what apply will store', () => {
        expect(plan({ lyricsFontWeight: 555 }, { lyricsFontWeight: null }, unpinned)
            .changes.find(c => c.key === 'lyricsFontWeight')?.to).toBe(560);
        expect(keys(plan({ lyricsFontWeight: 555 }, { lyricsFontWeight: 560 }, unpinned)))
            .not.toContain('lyricsFontWeight');
    });

    // Tunings are nested objects; a structural compare keeps an unchanged tuning out of the plan.
    it('compares nested tunings structurally', () => {
        const tuning = { cameraSpeed: 1, motionAmount: 1 };
        expect(plan({ dioramaTuning: { ...tuning } }, { dioramaTuning: tuning }, unpinned).changes).toEqual([]);
        expect(keys(plan({ dioramaTuning: { ...tuning, cameraSpeed: 2 } }, { dioramaTuning: tuning }, unpinned)))
            .toEqual(['dioramaTuning']);
    });

    // The import applies the bundle instead of the individual tunings, so listing both would promise
    // a change that never lands.
    it('drops the per-renderer tunings when the bundle is present', () => {
        const incoming = {
            visualizerTunings: { classic: { wordSpacing: 0.9 } },
            classicTuning: { wordSpacing: 0.9 },
            dioramaTuning: { cameraSpeed: 2 },
            monetTuning: { fontScale: 1.5 },
            monetBackgroundTuning: { backgroundBlurPx: 9 },
        };
        expect(keys(plan(incoming, {}, unpinned))).toEqual(['visualizerTunings', 'monetBackgroundTuning']);
    });

    it('keeps the per-renderer tunings when there is no bundle', () => {
        const p = plan({ classicTuning: { wordSpacing: 0.9 }, dioramaTuning: { cameraSpeed: 2 } }, {}, unpinned);
        expect(keys(p)).toEqual(['classicTuning', 'dioramaTuning']);
    });

    // buildVisualSettingsConfig reports null for an uploaded font, so without the label the row
    // would claim the user has no font while the picker shows one.
    it('names the font the picker shows as the from-value', () => {
        const p = buildImportPlan({
            incoming: { lyricsCustomFontFamily: 'Comic Sans MS' },
            current: { lyricsCustomFontFamily: null },
            switches: unpinned,
            customFontSource: 'uploaded',
            customFontLabel: 'DFGKaiSho-XB',
        });
        expect(p.changes.find(c => c.key === 'lyricsCustomFontFamily'))
            .toMatchObject({ from: 'DFGKaiSho-XB', to: 'Comic Sans MS' });
    });

    it('reports no font change when the incoming family is the one already shown', () => {
        const p = buildImportPlan({
            incoming: { lyricsCustomFontFamily: 'DFGKaiSho-XB' },
            current: { lyricsCustomFontFamily: null },
            switches: unpinned,
            customFontLabel: 'DFGKaiSho-XB',
        });
        expect(p.changes.some(c => c.key === 'lyricsCustomFontFamily')).toBe(false);
    });

    it('flags an incoming font this machine cannot render', () => {
        const unavailable = buildImportPlan({
            incoming: { lyricsCustomFontFamily: 'Comic Sans MS' },
            current: {},
            switches: unpinned,
            incomingFontAvailable: false,
        });
        expect(unavailable.changes.find(c => c.key === 'lyricsCustomFontFamily')?.note).toBe('fontUnavailable');

        // Available, and not measured at all, both stay quiet.
        for (const incomingFontAvailable of [true, undefined]) {
            const p = buildImportPlan({
                incoming: { lyricsCustomFontFamily: 'Comic Sans MS' },
                current: {},
                switches: unpinned,
                incomingFontAvailable,
            });
            expect(p.changes.find(c => c.key === 'lyricsCustomFontFamily')?.note).toBeUndefined();
        }
    });

    // Only a system family is portable, so the config can never carry the uploaded font it evicts.
    it('warns that accepting a font family discards an uploaded one', () => {
        const p = buildImportPlan({
            incoming: { lyricsCustomFontFamily: 'Comic Sans MS' },
            current: {},
            switches: unpinned,
            customFontSource: 'uploaded',
        });
        expect(p.changes).toContainEqual({
            group: 'fonts',
            key: 'uploadedLyricsFont',
            from: true,
            to: false,
            derived: true,
            causedBy: ['lyricsCustomFontFamily'],
        });
    });

    it('does not warn about an uploaded font when there is none', () => {
        for (const customFontSource of ['system', null, undefined] as const) {
            const p = buildImportPlan({
                incoming: { lyricsCustomFontFamily: 'Comic Sans MS' },
                current: {},
                switches: unpinned,
                customFontSource,
            });
            expect(p.changes.some(c => c.key === 'uploadedLyricsFont')).toBe(false);
        }
    });

    it('surfaces the unpinning that accepting auto-switch implies', () => {
        const p = plan({ songThemeAutoSwitchEnabled: true, songThemeAutoGenerateEnabled: false }, {}, pinned);
        const derived = p.changes.find(c => c.derived);
        expect(derived).toMatchObject({
            group: 'songTheme',
            key: 'isCustomThemePreferred',
            from: true,
            to: false,
        });
    });

    // The pin only survives when the config asks for both switches off.
    it('reports no derived change when the config turns the automation off', () => {
        const p = plan({ songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false }, {}, pinned);
        expect(p.changes.some(c => c.derived)).toBe(false);
    });

    it('reports no derived change when nothing was pinned to begin with', () => {
        const p = plan({ songThemeAutoSwitchEnabled: true, songThemeAutoGenerateEnabled: true }, {}, unpinned);
        expect(p.changes.some(c => c.derived)).toBe(false);
    });

    // Threading matters: auto-generate on force-enables auto-switch, so the pin goes even when the
    // config's own auto-switch value is what the user already has.
    it('threads the resolvers so auto-generate can unpin on its own', () => {
        const p = plan({ songThemeAutoGenerateEnabled: true }, {}, pinned);
        expect(p.changes.find(c => c.derived)).toMatchObject({ key: 'isCustomThemePreferred', to: false });
    });

    const side = (accentColor: string) => ({
        backgroundColor: '#000000',
        primaryColor: '#ffffff',
        accentColor,
        secondaryColor: '#888888',
        fontStyle: 'sans',
        animationIntensity: 'normal',
    });

    // Offered per side so someone's night colours can be taken without their day ones.
    it('splits the theme into a light and a dark row', () => {
        const current = { theme: { light: side('#111111'), dark: side('#111111') } };
        const p = plan({ theme: { light: side('#ea580c'), dark: side('#0df1fe') } }, current, unpinned);
        expect(keys(p)).toEqual(['themeLight', 'themeDark']);
        expect(p.changes[0]).toMatchObject({ from: current.theme.light, to: side('#ea580c') });
    });

    it('offers only the side that actually differs', () => {
        const p = plan(
            { theme: { light: side('#ea580c'), dark: side('#0df1fe') } },
            { theme: { light: side('#ea580c'), dark: side('#111111') } },
            unpinned,
        );
        expect(keys(p)).toEqual(['themeDark']);
        expect(p.unchanged.map(c => c.key)).toEqual(['themeLight']);
    });

    // A saved theme carries provider/description and empty word-colour lists that a hand-written or
    // freshly decoded one does not. Reporting those would claim a change the user cannot see.
    it('ignores theme metadata and empty-vs-absent lists', () => {
        const saved = {
            backgroundColor: '#f5f5f4', primaryColor: '#1c1917', accentColor: '#ea580c', secondaryColor: '#44403c',
            fontStyle: 'sans', animationIntensity: 'normal', wordColors: [], lyricsIcons: [], provider: 'Custom', description: '',
        };
        const incoming = {
            name: 'Whatever Else', backgroundColor: '#f5f5f4', primaryColor: '#1c1917', accentColor: '#ea580c',
            secondaryColor: '#44403c', fontStyle: 'sans', animationIntensity: 'normal',
        };
        const p = plan({ theme: { light: incoming, dark: incoming } }, { theme: { light: saved, dark: saved } }, unpinned);
        expect(p.changes).toEqual([]);
        expect(p.unchanged.map(c => c.key)).toEqual(['themeLight', 'themeDark']);
    });

    // saveCustomDualTheme overwrites both sides with this machine's stored intensity, so comparing it
    // would report a difference the save discards -- and report it again on every re-import.
    it('does not compare animation intensity', () => {
        const base = { backgroundColor: '#000', primaryColor: '#fff', accentColor: '#ea580c', secondaryColor: '#888' };
        const p = plan(
            { theme: { light: { ...base, animationIntensity: 'chaotic' }, dark: { ...base, animationIntensity: 'chaotic' } } },
            { theme: { light: { ...base, animationIntensity: 'calm' }, dark: { ...base, animationIntensity: 'calm' } } },
            unpinned,
        );
        expect(p.changes).toEqual([]);
        expect(p.unchanged.map(c => c.key)).toEqual(['themeLight', 'themeDark']);
    });

    // Saving a theme and showing it are separate steps: a config whose theme already matches the
    // saved one has no side to pick, so without this row there would be no way to switch to it.
    describe('activating the custom theme', () => {
        const side = { backgroundColor: '#000', primaryColor: '#fff', accentColor: '#ea580c', secondaryColor: '#888' };
        const build = (isCustomThemeActive: boolean) => buildImportPlan({
            incoming: { theme: { light: side, dark: side } },
            current: { theme: { light: side, dark: side } },
            switches: unpinned,
            isCustomThemeActive,
        });

        it('is offered when an identical theme arrives while another mode is on screen', () => {
            const p = build(false);
            expect(keys(p)).toEqual(['activateCustomTheme']);
            expect(p.unchanged.map(c => c.key)).toEqual(['themeLight', 'themeDark']);
        });

        it('is not offered when the custom theme is already the active mode', () => {
            expect(keys(build(true))).toEqual([]);
        });

        it('is not offered when the config carries no theme at all', () => {
            const p = buildImportPlan({ incoming: { visualizerMode: 'monet' }, current: {}, switches: unpinned });
            expect(keys(p)).toEqual(['visualizerMode']);
        });

        // saveCustomDualTheme sets the mode to custom as part of saving, so a side cannot be taken
        // without switching. The rows move together rather than offering an impossible combination.
        it('links a picked side to activating, since saving is what switches the mode', () => {
            const p = buildImportPlan({
                incoming: { theme: { light: { ...side, accentColor: '#0df1fe' }, dark: side } },
                current: { theme: { light: side, dark: side } },
                switches: unpinned,
                isCustomThemeActive: false,
            });
            expect(keys(p)).toEqual(['themeLight', 'activateCustomTheme']);
            expect(p.changes.find(c => c.key === 'themeLight')?.forces).toEqual(['activateCustomTheme']);
        });

        it('does not link when custom is already active and there is no activate row', () => {
            const p = buildImportPlan({
                incoming: { theme: { light: { ...side, accentColor: '#0df1fe' }, dark: side } },
                current: { theme: { light: side, dark: side } },
                switches: unpinned,
                isCustomThemeActive: true,
            });
            expect(keys(p)).toEqual(['themeLight']);
            expect(p.changes.find(c => c.key === 'themeLight')?.forces).toBeUndefined();
        });
    });

    it('still reports a theme side whose colours differ', () => {
        const base = { backgroundColor: '#000', primaryColor: '#fff', accentColor: '#ea580c', secondaryColor: '#888', fontStyle: 'sans', animationIntensity: 'normal' };
        const p = plan(
            { theme: { light: base, dark: { ...base, accentColor: '#0df1fe' } } },
            { theme: { light: { ...base, provider: 'Custom' }, dark: { ...base, provider: 'Custom' } } },
            unpinned,
        );
        expect(keys(p)).toEqual(['themeDark']);
    });

    // A tuning bundle that moved one slider must not read the same as one replaced wholesale.
    it('breaks a changed settings object down to the leaves that moved', () => {
        const p = plan(
            { monetBackgroundTuning: { backgroundBlurPx: 24, backgroundSaturation: 0, backgroundWash: 0.34 } },
            { monetBackgroundTuning: { backgroundBlurPx: 6, backgroundSaturation: 1.05, backgroundWash: 0.34 } },
            unpinned,
        );
        const change = p.changes.find(c => c.key === 'monetBackgroundTuning');
        expect(change?.children).toEqual([
            { group: 'background', key: 'backgroundBlurPx', from: 6, to: 24 },
            { group: 'background', key: 'backgroundSaturation', from: 1.05, to: 0 },
        ]);
    });

    // isSameValue is JSON.stringify-based and so key-order sensitive, but the codec rebuilds an
    // incoming tuning in its own field order. Judging by the leaves keeps a reordered-but-identical
    // tuning out of the plan instead of showing a row that opens to nothing.
    it('does not report a settings object whose leaves all match', () => {
        const p = plan(
            { dioramaTuning: { motionAmount: 1, cameraSpeed: 2 } },
            { dioramaTuning: { cameraSpeed: 2, motionAmount: 1 } },
            unpinned,
        );
        expect(p.changes).toEqual([]);
        expect(p.unchanged.map(c => c.key)).toEqual(['dioramaTuning']);
    });

    // The setters take a patch, so keys the incoming object omits are left alone.
    it('does not report a partial settings object that repeats current values', () => {
        const p = plan(
            { dioramaTuning: { cameraSpeed: 2 } },
            { dioramaTuning: { cameraSpeed: 2, motionAmount: 1, extra: 'x' } },
            unpinned,
        );
        expect(p.changes).toEqual([]);
    });

    it('reaches leaves nested inside a settings object', () => {
        const p = plan(
            { dioramaTuning: { cameraSpeed: 1, geometryVisibility: { mode: 'clouds', rings: false } } },
            { dioramaTuning: { cameraSpeed: 1, geometryVisibility: { mode: 'clouds', rings: true } } },
            unpinned,
        );
        expect(p.changes[0]?.children).toEqual([
            { group: 'visualizer', key: 'geometryVisibility.rings', from: true, to: false },
        ]);
    });

    // "Not listed" must never be ambiguous between "absent from the config" and "already equal".
    it('reports matching fields as unchanged rather than dropping them', () => {
        const p = plan(
            { visualizerMode: 'monet', backgroundOpacity: 0.5 },
            { visualizerMode: 'monet', backgroundOpacity: 0.75 },
            unpinned,
        );
        expect(keys(p)).toEqual(['backgroundOpacity']);
        expect(p.unchanged.map(c => c.key)).toEqual(['visualizerMode']);
        expect(p.unchanged[0]).toMatchObject({ from: 'monet', to: 'monet' });
    });

    it('does not flag an unavailable font on a row that is not changing', () => {
        const p = buildImportPlan({
            incoming: { lyricsCustomFontFamily: 'Same Font' },
            current: {},
            switches: unpinned,
            customFontLabel: 'Same Font',
            incomingFontAvailable: false,
        });
        expect(p.changes).toEqual([]);
        expect(p.unchanged[0]?.note).toBeUndefined();
    });

    // The import applies these only when the incoming value is truthy, so a null means "the exporter
    // had none", not "clear yours". Offering one would promise a change the apply path skips.
    it('skips a field the import would not apply because the incoming value is null', () => {
        const p = plan(
            { lyricsCustomFontFamily: null, visualizerMode: null, subtitleFontFamily: null },
            { lyricsCustomFontFamily: 'Georgia', visualizerMode: 'monet', subtitleFontFamily: 'Georgia' },
            unpinned,
        );
        // subtitleFontFamily has no truthiness guard on apply, so clearing it is real and offered.
        expect(keys(p)).toEqual(['subtitleFontFamily']);
    });

    describe('webpage backgrounds', () => {
        const a = { id: 'a', url: 'https://a.example/', note: 'a' };
        const b = { id: 'b', url: 'https://b.example/', note: 'b' };

        // The apply path merges by id. Diffing against the incoming array would count items that
        // never appear -- "2 -> 1" while three end up stored.
        it('diffs against the merged list rather than the incoming one', () => {
            const p = plan({ urlBackgroundList: [b] }, { urlBackgroundList: [a] }, unpinned);
            const change = p.changes.find(c => c.key === 'urlBackgroundList');
            expect(change?.to).toEqual([a, b]);
            expect(change?.note).toBe('listMerged');
        });

        it('reports no change when the incoming entries are all already present', () => {
            const p = plan({ urlBackgroundList: [a] }, { urlBackgroundList: [a] }, unpinned);
            expect(keys(p)).toEqual([]);
            expect(p.unchanged.map(c => c.key)).toEqual(['urlBackgroundList']);
        });

        // An empty incoming list cannot clear anything, so it must not be offered as if it could.
        it('reports no change for an empty incoming list', () => {
            const p = plan({ urlBackgroundList: [] }, { urlBackgroundList: [a] }, unpinned);
            expect(keys(p)).toEqual([]);
        });

        // Entries without an id or with a non-http url are dropped on the way in.
        it('does not count entries the sanitizer discards', () => {
            const p = plan({ urlBackgroundList: [{ id: '', url: 'https://x.example/' }, { id: 'c', url: 'ftp://nope/' }] }, { urlBackgroundList: [a] }, unpinned);
            expect(keys(p)).toEqual([]);
        });

        // Applying a selection that is not in the merged list is skipped.
        it('offers the selected id only when it survives the merge', () => {
            expect(keys(plan({ urlBackgroundList: [b], urlBackgroundSelectedId: 'b' }, { urlBackgroundList: [a] }, unpinned)))
                .toEqual(['urlBackgroundList', 'urlBackgroundSelectedId']);
            expect(keys(plan({ urlBackgroundSelectedId: 'gone' }, { urlBackgroundList: [a] }, unpinned)))
                .toEqual([]);
        });

        // The apply path only merges when the list row was taken, so an id that only the merge
        // introduces has to bring the list with it or the write is silently skipped.
        it('links a selected id that only the merge introduces to the list row', () => {
            const p = plan({ urlBackgroundList: [b], urlBackgroundSelectedId: 'b' }, { urlBackgroundList: [a] }, unpinned);
            expect(p.changes.find(c => c.key === 'urlBackgroundSelectedId')?.forces).toEqual(['urlBackgroundList']);
        });

        it('does not link an id the current list already has', () => {
            const p = plan(
                { urlBackgroundList: [b], urlBackgroundSelectedId: 'a' },
                { urlBackgroundList: [a], urlBackgroundSelectedId: null },
                unpinned,
            );
            expect(p.changes.find(c => c.key === 'urlBackgroundSelectedId')?.forces).toBeUndefined();
        });
    });

    // Some setters overwrite a leaf no matter what arrives. Offering one promises a change that
    // cannot land, and the value never converges, so a re-import reports it forever.
    describe('leaves the setters pin', () => {
        it('drops cadenza beamIntensity, which the setter always writes as 0', () => {
            expect(keys(plan({ cadenzaTuning: { beamIntensity: 0.8, fontScale: 1 } }, { cadenzaTuning: { beamIntensity: 0, fontScale: 1 } }, unpinned)))
                .toEqual([]);
            // Bundled paths carry the renderer in the key, and must be dropped the same way.
            expect(keys(plan({ visualizerTunings: { cadenza: { beamIntensity: 0.8 } } }, { visualizerTunings: { cadenza: { beamIntensity: 0 } } }, unpinned)))
                .toEqual([]);
        });

        it('drops a custom cappella emoji source when this machine has no pack', () => {
            const incoming = { cappellaTuning: { emojiPackSource: 'custom', showEmoMessages: true } };
            const current = { cappellaTuning: { emojiPackSource: 'builtin', showEmoMessages: true } };
            expect(keys(plan(incoming, current, unpinned))).toEqual([]);

            const withPack = buildImportPlan({ incoming, current, switches: unpinned, assets: { hasCappellaEmojiPack: true } });
            expect(keys(withPack)).toEqual(['cappellaTuning']);
        });

        // Not clamped by their setters -- useAppPreferences reverts each on the next tick when the
        // image it names is not stored here, so the write lands and is then undone.
        it('drops an uploaded monet background source when this machine has no image', () => {
            const incoming = { monetBackgroundTuning: { backgroundSource: 'uploaded-global' } };
            const current = { monetBackgroundTuning: { backgroundSource: 'cover-derived' } };
            expect(keys(plan(incoming, current, unpinned))).toEqual([]);

            const withImage = buildImportPlan({ incoming, current, switches: unpinned, assets: { hasMonetBackgroundImage: true } });
            expect(keys(withImage)).toEqual(['monetBackgroundTuning']);
        });

        it('drops a custom monet portrait source when this machine has no image', () => {
            const incoming = { monetTuning: { portraitSource: 'custom' } };
            const current = { monetTuning: { portraitSource: 'cover' } };
            expect(keys(plan(incoming, current, unpinned))).toEqual([]);

            // The bundle carries the same leaf under the renderer's name.
            expect(keys(plan(
                { visualizerTunings: { monet: { portraitSource: 'custom' } } },
                { visualizerTunings: { monet: { portraitSource: 'cover' } } },
                unpinned,
            ))).toEqual([]);

            const withImage = buildImportPlan({ incoming, current, switches: unpinned, assets: { hasMonetPortraitImage: true } });
            expect(keys(withImage)).toEqual(['monetTuning']);
        });

        // Going back to a source that needs nothing local always applies.
        it('keeps a switch back to a cover-derived source', () => {
            expect(keys(plan(
                { monetBackgroundTuning: { backgroundSource: 'cover-derived' } },
                { monetBackgroundTuning: { backgroundSource: 'uploaded-global' } },
                unpinned,
            ))).toEqual(['monetBackgroundTuning']);
        });

        // Going back to builtin is always applied, so it stays on offer.
        it('keeps a switch back to the builtin emoji source', () => {
            const p = plan(
                { cappellaTuning: { emojiPackSource: 'builtin' } },
                { cappellaTuning: { emojiPackSource: 'custom' } },
                unpinned,
            );
            expect(keys(p)).toEqual(['cappellaTuning']);
        });

        it('leaves other leaves of the same tuning alone', () => {
            const p = plan(
                { cadenzaTuning: { beamIntensity: 0.8, fontScale: 2 } },
                { cadenzaTuning: { beamIntensity: 0, fontScale: 1 } },
                unpinned,
            );
            expect(p.changes.find(c => c.key === 'cadenzaTuning')?.children)
                .toEqual([{ group: 'visualizer', key: 'fontScale', from: 1, to: 2 }]);
        });
    });

    // resolveSongThemeAutoGenerateChange(_, true) also turns auto-switch on, and
    // resolveSongThemeAutoSwitchChange(_, false) also turns auto-generate off, so declining one of
    // the pair while accepting the other cannot hold.
    describe('linking the song-theme switches', () => {
        const find = (p: ReturnType<typeof plan>, key: string) => p.changes.find(c => c.key === key);

        it('links auto-generate to auto-switch when both are turning on', () => {
            const p = plan(
                { songThemeAutoSwitchEnabled: true, songThemeAutoGenerateEnabled: true },
                { songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false },
                pinned,
            );
            expect(find(p, 'songThemeAutoGenerateEnabled')?.forces).toEqual(['songThemeAutoSwitchEnabled']);
            expect(find(p, 'songThemeAutoSwitchEnabled')?.forces).toBeUndefined();
        });

        it('links auto-switch to auto-generate when both are turning off', () => {
            const p = plan(
                { songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false },
                { songThemeAutoSwitchEnabled: true, songThemeAutoGenerateEnabled: true },
                { isCustomThemePreferred: false, songThemeAutoSwitchEnabled: true, songThemeAutoGenerateEnabled: true },
            );
            expect(find(p, 'songThemeAutoSwitchEnabled')?.forces).toEqual(['songThemeAutoGenerateEnabled']);
        });

        it('leaves a lone switch unlinked', () => {
            const p = plan({ songThemeAutoSwitchEnabled: true }, { songThemeAutoSwitchEnabled: false }, pinned);
            expect(find(p, 'songThemeAutoSwitchEnabled')?.forces).toBeUndefined();
        });
    });

    // A derived row is only real while the row that causes it is still accepted.
    it('names what causes an unpin so declining it can retract the warning', () => {
        const p = plan(
            { songThemeAutoSwitchEnabled: true },
            { songThemeAutoSwitchEnabled: false },
            pinned,
        );
        expect(p.changes.find(c => c.key === 'isCustomThemePreferred'))
            .toMatchObject({ derived: true, causedBy: ['songThemeAutoSwitchEnabled'] });
    });

    // The now playing card gets its own group: someone taking a configuration for its colours has a
    // reason to leave the card alone, and taking it means taking all three rows together.
    describe('the now playing card', () => {
        it('plans all three rows under one group of their own', () => {
            const p = plan(
                { stageTrackPillMode: 'always', stageTrackPillTimeoutSec: 24, stageTrackPillOnHome: true },
                { stageTrackPillMode: 'auto', stageTrackPillTimeoutSec: 10, stageTrackPillOnHome: false },
                unpinned,
            );
            expect(keys(p)).toEqual(['stageTrackPillMode', 'stageTrackPillTimeoutSec', 'stageTrackPillOnHome']);
            expect(p.groups).toEqual(['trackCard']);
        });

        // false and 'never' are real values, not "the exporter had none", so both have to be offered.
        it('offers turning the card off and taking it off the home page', () => {
            const p = plan(
                { stageTrackPillMode: 'never', stageTrackPillOnHome: false },
                { stageTrackPillMode: 'auto', stageTrackPillOnHome: true },
                unpinned,
            );
            expect(keys(p)).toEqual(['stageTrackPillMode', 'stageTrackPillOnHome']);
        });

        // Truthy-guarded to match the apply path, which only applies one of the three known values.
        it('does not offer a mode the apply path would skip', () => {
            const p = plan({ stageTrackPillMode: '' }, { stageTrackPillMode: 'auto' }, unpinned);
            expect(keys(p)).toEqual([]);
        });
    });
});
