import {
    resolveSongThemeAutoGenerateChange,
    resolveSongThemeAutoSwitchChange,
    type ThemePreferenceSwitchState,
} from '../services/themePreferences';
import { mergeUrlBackgroundList } from './urlBackground';
import { normalizeFontWeight } from './fontStacks';
import type { UrlBackgroundItem } from '../types';

// src/utils/appearanceImportPlan.ts
// What an imported config would actually change, computed before anything is applied. Pure: the
// caller passes the incoming config and a snapshot of the current one, both in the shape
// decompressConfig/buildVisualSettingsConfig already speak, so the diff is a field-by-field compare.
//
// The point of doing this up front is the derived changes. The three song-theme switches are
// mutually exclusive by construction (see themePreferences resolvers), so accepting an incoming
// auto-switch value can also flip "prefer custom theme" — a setting that is not in the config at
// all and would otherwise change with no warning.

export type ImportGroup = 'theme' | 'visualizer' | 'fonts' | 'background' | 'songTheme' | 'trackCard';

export const IMPORT_GROUPS: ImportGroup[] = ['theme', 'visualizer', 'fonts', 'background', 'songTheme', 'trackCard'];

export interface ImportChange {
    group: ImportGroup;
    // Config field name, or the state field for a derived change.
    key: string;
    from: unknown;
    to: unknown;
    // True when the config never mentioned this field and the change follows from a resolver rule.
    derived?: boolean;
    // For a derived change, the picked fields that would cause it. A derived row is only real while
    // one of them is still selected, so declining the cause must also retract the warning.
    causedBy?: string[];
    // Rows this one drags along: accepting it necessarily accepts them too, because the setter that
    // applies it also writes theirs. Declining any of them therefore has to decline this one.
    forces?: string[];
    // Informational, does not block the row: `fontUnavailable` means the incoming font is not
    // installed here and will render through the fallback stack; `listMerged` means the row's
    // "after" value is the merge of both lists rather than the incoming one on its own.
    note?: 'fontUnavailable' | 'listMerged';
    // Leaf-level differences inside a nested settings object. A tuning bundle changes as a whole,
    // but saying so is useless when one slider moved — these let the row be opened and read.
    children?: ImportChange[];
}

export interface ImportPlan {
    changes: ImportChange[];
    // Fields the config carries that already match — shown so "not listed" never has to mean two
    // different things, but not selectable: applying them would be a no-op either way.
    unchanged: ImportChange[];
    // Groups with at least one change, in display order.
    groups: ImportGroup[];
}

// The theme is offered per side. Wanting someone's night colours while keeping your own day ones is
// the common case, and a single theme row cannot express it.
export const THEME_LIGHT_KEY = 'themeLight';
export const THEME_DARK_KEY = 'themeDark';

// Switching to the custom theme is its own change: a config carries a theme, but taking it says
// nothing about whether the app should stop showing the default or AI theme and display it. Offered
// whenever the config has a theme and custom is not already the active mode, so importing a theme
// that happens to match the saved one still has a way to activate it.
export const ACTIVATE_CUSTOM_THEME_KEY = 'activateCustomTheme';

// Every config field the import path actually applies, mapped to the group it is presented under.
// Fields the codec round-trips but the import path does not apply are deliberately absent, so the
// plan can never promise a change that will not happen.
const FIELD_GROUPS: Record<string, ImportGroup> = {
    visualizerMode: 'visualizer',
    randomVisualizerModePerSong: 'visualizer',
    visualizerOpacity: 'visualizer',
    hidePlayerTranslationSubtitle: 'visualizer',
    showSubtitleTranslation: 'visualizer',
    subtitleContentMode: 'visualizer',
    subtitleOverlayBackground: 'visualizer',
    subtitleOverlayOpacity: 'visualizer',
    showHarmonySubtitle: 'visualizer',
    harmonySubtitleBackground: 'visualizer',
    visualizerTunings: 'visualizer',
    classicTuning: 'visualizer',
    cadenzaTuning: 'visualizer',
    partitaTuning: 'visualizer',
    fumeTuning: 'visualizer',
    claddaghTuning: 'visualizer',
    cappellaTuning: 'visualizer',
    tiltTuning: 'visualizer',
    dioramaTuning: 'visualizer',
    monetTuning: 'visualizer',
    pendoloTuning: 'visualizer',
    sonnetTuning: 'visualizer',
    temperaTuning: 'visualizer',

    lyricsFontStyle: 'fonts',
    lyricsFontScale: 'fonts',
    // Not truthy-guarded: null is a real value ("use the mode default"), so importing it must be
    // able to reset a weight, and applyImportedConfig applies it unconditionally.
    lyricsFontWeight: 'fonts',
    lyricsFontFallbackFamilies: 'fonts',
    lyricsCustomFontFamily: 'fonts',
    subtitleFontInheritsLyrics: 'fonts',
    subtitleFontScale: 'fonts',
    subtitleFontStyle: 'fonts',
    subtitleFontWeight: 'fonts',
    subtitleFontFamily: 'fonts',
    subtitleFontFallbackFamilies: 'fonts',

    visualizerBackgroundMode: 'background',
    backgroundOpacity: 'background',
    useCoverColorBg: 'background',
    disableVisualizerGeometricBackground: 'background',
    disableVisualizerVignette: 'background',
    // Static mode is presented under background rather than visualizer: what it actually does is
    // drop the geometric background to save resources, which is how the settings panel describes it.
    staticMode: 'background',
    monetBackgroundTuning: 'background',
    nomandBackgroundTuning: 'background',
    latentBackgroundTuning: 'background',
    urlBackgroundList: 'background',
    urlBackgroundSelectedId: 'background',

    songThemeAutoSwitchEnabled: 'songTheme',
    songThemeAutoGenerateEnabled: 'songTheme',
    themeGenerationSource: 'songTheme',
    followSystemTheme: 'theme',

    // Its own group rather than folded into visualizer: the card is chrome around the picture, not
    // part of it, and the three rows are read together — someone taking a configuration for its
    // colours has a reason to leave the card alone, and a reason to take all three of it at once.
    stageTrackPillMode: 'trackCard',
    stageTrackPillTimeoutSec: 'trackCard',
    stageTrackPillOnHome: 'trackCard',
};

// Fields the import applies only when the incoming value is truthy, so an incoming null means "the
// exporter had none" rather than "clear yours". Offering them would promise a change that the apply
// path skips. Kept in step with the guards in applyImportedConfig.
const TRUTHY_GUARDED_FIELDS = new Set([
    'visualizerMode',
    'visualizerBackgroundMode',
    // applyImportedConfig only applies subtitleContentMode for the known enum values, all of which
    // are truthy strings, so an empty/absent one is skipped there the same as here.
    'subtitleContentMode',
    'lyricsFontStyle',
    'lyricsFontFallbackFamilies',
    'lyricsCustomFontFamily',
    'subtitleFontStyle',
    'subtitleFontFallbackFamilies',
    'visualizerTunings',
    'classicTuning',
    'cadenzaTuning',
    'partitaTuning',
    'fumeTuning',
    'claddaghTuning',
    'cappellaTuning',
    'tiltTuning',
    'dioramaTuning',
    'monetTuning',
    'pendoloTuning',
    'sonnetTuning',
    'temperaTuning',
    'monetBackgroundTuning',
    'nomandBackgroundTuning',
    'latentBackgroundTuning',
    'urlBackgroundSelectedId',
    // applyImportedConfig only applies the card's mode for the three known values, all truthy
    // strings, so an absent one is skipped there the same as here.
    'stageTrackPillMode',
]);

// Per-renderer tunings the import skips whenever the visualizerTunings bundle is present. The three
// background tunings are not in this set: they are applied unconditionally.
const BUNDLED_TUNING_FIELDS = new Set([
    'classicTuning',
    'cadenzaTuning',
    'partitaTuning',
    'fumeTuning',
    'claddaghTuning',
    'cappellaTuning',
    'tiltTuning',
    'dioramaTuning',
    'monetTuning',
    'pendoloTuning',
    'sonnetTuning',
    'temperaTuning',
]);

// Structural compare over the plain JSON the codec emits — enough for tunings and font arrays, and
// it keeps the module dependency-free.
const isSameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (a === undefined || b === undefined || a === null || b === null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
};

// A theme side is compared on what it renders as. name/provider/description are labels, and an empty
// list is the same as an absent one — comparing those too would report a change the user cannot see.
//
// animationIntensity is deliberately absent: saveCustomDualTheme runs the saved theme through
// applyStoredAnimationIntensityToDualTheme, which overwrites both sides with this machine's stored
// intensity. Comparing it would report a difference that the save discards, and re-importing the
// same config would report it again forever.
const THEME_SIDE_FIELDS = [
    'backgroundColor',
    'primaryColor',
    'accentColor',
    'secondaryColor',
    'fontStyle',
    'fontFamily',
    'wordColors',
    'lyricsIcons',
] as const;

const isEmptyish = (value: unknown) =>
    value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

const isSameThemeSide = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return THEME_SIDE_FIELDS.every((field) => {
        const left = (a as Record<string, unknown>)[field];
        const right = (b as Record<string, unknown>)[field];
        if (isEmptyish(left) && isEmptyish(right)) return true;
        return isSameValue(left, right);
    });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// A tuning leaf belongs to `renderer` either because the whole object is that renderer's, or because
// the visualizerTunings bundle put the renderer's name at the head of the path.
const leafBelongsTo = (ownerField: string, leafPath: string, renderer: string) =>
    ownerField === `${renderer}Tuning` || leafPath.startsWith(`${renderer}.`);

// Local assets a config cannot carry: an uploaded image or emoji pack lives in this browser only, so
// a source that names one is meaningless on a machine that does not have it.
export interface LocalAssetAvailability {
    // Whether this machine has a custom Cappella emoji pack.
    hasCappellaEmojiPack?: boolean;
    // Whether this machine has an uploaded Monet global background image.
    hasMonetBackgroundImage?: boolean;
    // Whether this machine has an uploaded Monet portrait image.
    hasMonetPortraitImage?: boolean;
}

// Leaves that will not hold whatever the config says, either because the setter overwrites them or
// because an app-level effect puts them straight back. Listing one promises a change that cannot
// land, and because the value never converges the same config reports it again on every re-import —
// the same trap animationIntensity sets on a theme side.
const isPinnedLeaf = (
    ownerField: string,
    leafPath: string,
    to: unknown,
    assets: LocalAssetAvailability,
): boolean => {
    const leaf = leafPath.split('.').pop();

    // handleSetCadenzaTuning writes beamIntensity: 0 after the patch; the beam is disabled and its
    // slider was removed, so no value other than 0 can survive.
    if (leaf === 'beamIntensity' && leafBelongsTo(ownerField, leafPath, 'cadenza')) return true;

    // handleSetCappellaTuning falls back to 'builtin' unless this machine has an emoji pack.
    if (leaf === 'emojiPackSource' && to === 'custom' && !assets.hasCappellaEmojiPack
        && leafBelongsTo(ownerField, leafPath, 'cappella')) return true;

    // These two are not clamped by their setters — resolveMonetBackgroundSource and
    // resolveMonetPortraitSource pass them through — but useAppPreferences reverts each on the next
    // tick when the image it names is not stored here. The write lands and is then undone.
    //
    // monetBackgroundTuning is neither `monetTuning` nor part of the bundle, so it only ever arrives
    // as a top-level field with a bare leaf; leafBelongsTo would not match it.
    if (leaf === 'backgroundSource' && to === 'uploaded-global' && !assets.hasMonetBackgroundImage
        && ownerField === 'monetBackgroundTuning') return true;

    if (leaf === 'portraitSource' && to === 'custom' && !assets.hasMonetPortraitImage
        && leafBelongsTo(ownerField, leafPath, 'monet')) return true;

    return false;
};

// Every leaf that differs between two settings objects, keyed by its dotted path. Recursing keeps
// nested groups (a renderer's geometryVisibility, say) readable instead of collapsing to "changed".
const diffLeaves = (from: unknown, to: unknown, group: ImportGroup, prefix = ''): ImportChange[] => {
    if (!isPlainObject(to)) return [];
    const base = isPlainObject(from) ? from : {};
    const leaves: ImportChange[] = [];

    for (const key of Object.keys(to)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const left = base[key];
        const right = to[key];
        if (isSameValue(left, right)) continue;
        if (isPlainObject(right)) {
            leaves.push(...diffLeaves(left, right, group, path));
            continue;
        }
        leaves.push({ group, key: path, from: left, to: right });
    }

    return leaves;
};

export interface ImportPlanInput {
    // decompressConfig output.
    incoming: Record<string, unknown>;
    // Same field names, read from the live settings (buildVisualSettingsConfig plus the theme).
    current: Record<string, unknown>;
    // Drives the derived song-theme changes; isCustomThemePreferred is not a config field.
    switches: ThemePreferenceSwitchState;
    // Only a system font family is portable, so an uploaded font is never in the config — but
    // accepting a family replaces it and deletes the stored file. Pass the current source so that
    // loss can be shown rather than discovered afterwards.
    customFontSource?: 'system' | 'uploaded' | null;
    // What the user sees named in the font picker. An uploaded font exports as null, so without this
    // the row would claim the user currently has no font at all.
    customFontLabel?: string | null;
    // From isFontFamilyAvailable. Undefined means it was not measured, which stays quiet.
    incomingFontAvailable?: boolean;
    // Whether the custom theme is the mode on screen right now. Drives the activate row.
    isCustomThemeActive?: boolean;
    // Which browser-local assets exist here. A source that names one this machine does not have is
    // reverted, so offering it would promise a change that cannot land.
    assets?: LocalAssetAvailability;
}

export function buildImportPlan({
    incoming,
    current,
    switches,
    customFontSource,
    customFontLabel,
    incomingFontAvailable,
    isCustomThemeActive,
    assets = {},
}: ImportPlanInput): ImportPlan {
    const changes: ImportChange[] = [];
    const unchanged: ImportChange[] = [];
    const record = (change: ImportChange, same: boolean) => (same ? unchanged : changes).push(change);

    if (incoming.theme) {
        const incomingTheme = incoming.theme as { light?: unknown; dark?: unknown; };
        const currentTheme = (current.theme ?? null) as { light?: unknown; dark?: unknown; } | null;
        for (const [key, side] of [[THEME_LIGHT_KEY, 'light'], [THEME_DARK_KEY, 'dark']] as const) {
            const from = currentTheme?.[side] ?? null;
            const to = incomingTheme[side];
            if (to === undefined) continue;
            record({ group: 'theme', key, from, to }, isSameThemeSide(from, to));
        }

        // Switching to the custom theme is its own row, because a config whose theme already matches
        // the saved one has no side to pick and would otherwise offer no way to switch to it.
        //
        // It is not a free choice alongside a side, though: saveCustomDualTheme sets the mode to
        // custom as part of saving, so taking someone's colours necessarily shows them. The rows are
        // linked rather than left to promise a combination the setter cannot produce.
        if (!isCustomThemeActive) {
            changes.push({ group: 'theme', key: ACTIVATE_CUSTOM_THEME_KEY, from: false, to: true });
            for (const change of changes) {
                if (change.key === THEME_LIGHT_KEY || change.key === THEME_DARK_KEY) {
                    change.forces = [ACTIVATE_CUSTOM_THEME_KEY];
                }
            }
        }
    }

    // The import applies the per-renderer tunings only when the bundle is absent, so listing them
    // alongside a bundle would promise changes that never happen.
    const bundled = incoming.visualizerTunings !== undefined;

    // The list is merged rather than replaced, so the incoming array is not what ends up stored.
    // Diff against the merge instead, or the row would count items that never appear.
    const mergedUrlList = incoming.urlBackgroundList !== undefined
        ? mergeUrlBackgroundList((current.urlBackgroundList as UrlBackgroundItem[] | undefined) ?? [], incoming.urlBackgroundList)
        : null;

    for (const [key, group] of Object.entries(FIELD_GROUPS)) {
        if (incoming[key] === undefined) continue;
        if (bundled && BUNDLED_TUNING_FIELDS.has(key)) continue;
        if (TRUTHY_GUARDED_FIELDS.has(key) && !incoming[key]) continue;

        if (key === 'urlBackgroundList' && mergedUrlList) {
            const change: ImportChange = { group, key, from: current[key], to: mergedUrlList };
            const same = isSameValue(mergedUrlList, current[key]);
            if (!same) change.note = 'listMerged';
            record(change, same);
            continue;
        }

        // Applying a selection that is not in the merged list is skipped, so offering it would
        // promise a change that cannot happen.
        if (key === 'urlBackgroundSelectedId') {
            const currentList = (current.urlBackgroundList as UrlBackgroundItem[] | undefined) ?? [];
            const inCurrent = currentList.some(item => item.id === incoming[key]);
            if (!(mergedUrlList ?? currentList).some(item => item.id === incoming[key])) continue;

            const change: ImportChange = { group, key, from: current[key], to: incoming[key] };
            // The apply path only merges the list when its row was taken, and validates the id
            // against whatever list results. An id that only the merge introduces therefore needs
            // the list row to come with it, or the write is silently skipped.
            if (!inCurrent) change.forces = ['urlBackgroundList'];
            record(change, isSameValue(incoming[key], current[key]));
            continue;
        }

        // The font row names what the picker shows, which for an uploaded font is not in `current`
        // at all — reporting "none -> X" there would contradict the screen.
        if (key === 'lyricsCustomFontFamily') {
            const from = customFontLabel ?? (current[key] as string | null | undefined) ?? null;
            const change: ImportChange = { group, key, from, to: incoming[key] };
            const same = isSameValue(incoming[key], from);
            if (!same && incomingFontAvailable === false) change.note = 'fontUnavailable';
            record(change, same);
            continue;
        }

        // The weight setters clamp to [100,900] and round to a step of 10, but the codec carries the
        // raw value. Diff against the value the setter will actually store, so the row shows what
        // will happen and a non-canonical incoming weight (a hand-authored or cross-version config)
        // does not re-appear on every import -- the same never-settling trap as animationIntensity.
        if (key === 'lyricsFontWeight' || key === 'subtitleFontWeight') {
            const to = normalizeFontWeight(incoming[key]);
            record({ group, key, from: current[key], to }, isSameValue(to, current[key]));
            continue;
        }

        const change: ImportChange = { group, key, from: current[key], to: incoming[key] };
        let same = isSameValue(incoming[key], current[key]);

        // A settings object is judged by its leaves, not by isSameValue. That compare is
        // JSON.stringify-based and so key-order sensitive, while the incoming object is rebuilt by
        // the codec in its own field order and the current one comes straight from the store — two
        // semantically identical tunings can serialize differently. The setters take a patch, so
        // "no leaf differs" is exactly "nothing will change"; reporting a change anyway produces a
        // row that claims one while showing the same value on both sides and opening to nothing.
        if (isPlainObject(incoming[key])) {
            const children = diffLeaves(current[key], incoming[key], group)
                .filter(child => !isPinnedLeaf(key, child.key, child.to, assets));
            same = children.length === 0;
            if (!same) change.children = children;
        }

        record(change, same);
    }

    // Derived: taking a system font family evicts an uploaded one, and the stored file is deleted
    // with it. The config cannot carry an uploaded font, so this loss is invisible in the diff above.
    if (incoming.lyricsCustomFontFamily && customFontSource === 'uploaded') {
        changes.push({
            group: 'fonts',
            key: 'uploadedLyricsFont',
            from: true,
            to: false,
            derived: true,
            causedBy: ['lyricsCustomFontFamily'],
        });
    }

    // Derived: replay the resolvers in the order the import applies them, threading the state so the
    // second resolver sees the first one's result — the same composition the theme controller uses.
    const wantsSwitch = incoming.songThemeAutoSwitchEnabled;
    const wantsGenerate = incoming.songThemeAutoGenerateEnabled;
    if (wantsSwitch !== undefined || wantsGenerate !== undefined) {
        let next = switches;
        if (wantsSwitch !== undefined) next = resolveSongThemeAutoSwitchChange(next, Boolean(wantsSwitch));
        if (wantsGenerate !== undefined) next = resolveSongThemeAutoGenerateChange(next, Boolean(wantsGenerate));
        if (next.isCustomThemePreferred !== switches.isCustomThemePreferred) {
            changes.push({
                group: 'songTheme',
                key: 'isCustomThemePreferred',
                from: switches.isCustomThemePreferred,
                to: next.isCustomThemePreferred,
                derived: true,
                causedBy: [
                    ...(wantsSwitch !== undefined ? ['songThemeAutoSwitchEnabled'] : []),
                    ...(wantsGenerate !== undefined ? ['songThemeAutoGenerateEnabled'] : []),
                ],
            });
        }
    }

    // The two song-theme switches are not independent. resolveSongThemeAutoGenerateChange(_, true)
    // also turns auto-switch on, and resolveSongThemeAutoSwitchChange(_, false) also turns
    // auto-generate off — so declining one of the pair while accepting the other cannot hold, and
    // the dialog has to move them together rather than promise a choice the setters overrule.
    const linkSwitches = (key: string, when: boolean, target: string) => {
        const change = changes.find(c => c.key === key && !c.derived);
        const targetChange = changes.find(c => c.key === target && !c.derived);
        if (change && targetChange && change.to === when) change.forces = [target];
    };
    linkSwitches('songThemeAutoGenerateEnabled', true, 'songThemeAutoSwitchEnabled');
    linkSwitches('songThemeAutoSwitchEnabled', false, 'songThemeAutoGenerateEnabled');

    const present = new Set(changes.map(c => c.group));
    return { changes, unchanged, groups: IMPORT_GROUPS.filter(g => present.has(g)) };
}
