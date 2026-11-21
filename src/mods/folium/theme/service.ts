import { isThemeHexColor } from '@/services/themeSanitizer';
import { generateBuiltinDualTheme } from '@/utils/builtinTheme/generateBuiltinDualTheme';
import type { ModRuntimeInfo } from '../../types';
import type {
    FoliumContextKind,
    FoliumDualTheme,
    FoliumDualThemeInput,
    FoliumTheme,
    FoliumThemeHelpers,
    FoliumThemeInput,
    FoliumThemeOverride,
    FoliumThemeWriteResult,
} from '../contract';
import type { FoliumStoppedCheck } from '../api';
import type { FoliumPermissionId } from '../shared';
import { toFoliumTheme } from '../dto';
import { FOLIUM_THEME_HELPERS } from '../sharedHelpers';

// src/mods/folium/theme/service.ts
// `folium.theme` as a mod sees it: the font helpers builtin modes share, and (Folium 1.10) the theme on
// screen and a mod's theme laid over the song's theme. Like equalizer/service.ts this module is loaded in
// the export window too, so it imports no store and nothing of runtime/: the main window installs the
// source (runtime/theme/hostTheme.ts). Here: the argument checks, the order of the refusals the contract
// gives, and each mod's write allowance.

/** One mod's theme, checked: hex colors only, every field copied out of the mod's objects. */
export interface FoliumThemeOverrideInput {
    readonly light: FoliumThemeInput;
    readonly dark: FoliumThemeInput;
}

/** Where the main window's theme comes from (runtime/theme/hostTheme.ts). */
export interface FoliumThemeSource {
    getCurrent(): FoliumTheme;
    getOverride(): FoliumThemeOverride;
    /** Whether laying this mod's theme would change anything. Pure. */
    wouldChange(mod: ModRuntimeInfo, theme: FoliumThemeOverrideInput): boolean;
    /** Lays the theme; whether anything changed. */
    apply(mod: ModRuntimeInfo, theme: FoliumThemeOverrideInput): boolean;
    /** Takes this mod's theme off; false when the theme in place is not this mod's, or there is none. */
    release(mod: ModRuntimeInfo): boolean;
}

let themeSource: FoliumThemeSource | null = null;

/** Installs (or with null removes) the main window's `folium.theme` source. */
export const registerFoliumThemeSource = (source: FoliumThemeSource | null) => {
    themeSource = source;
};

/** The permission `apply` and `release` need. */
const THEME_WRITE: FoliumPermissionId = 'theme.write';

/** The shortest time between two counted writes of one mod. */
const THEME_WRITE_MIN_INTERVAL_MS = 1000;
/** The counted writes one mod may make in any 60 seconds. */
const THEME_WRITES_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

/** The most colors `fromColors` reads. */
const FROM_COLORS_MAX = 8;
/** The most keyword colors and icons one side keeps (the host's sanitizer keeps 12 icons). */
const MAX_WORD_COLORS = 64;
const MAX_LYRICS_ICONS = 12;
const MAX_TEXT_LENGTH = 200;

/** When each mod's counted writes were, within the last minute, by mod id: a reload of the mod keeps them. */
const countedWrites = new Map<string, number[]>();

const withinAllowance = (modId: string, now: number): boolean => {
    const recent = (countedWrites.get(modId) ?? []).filter((at) => now - at < MINUTE_MS);
    countedWrites.set(modId, recent);
    const last = recent.at(-1);
    if (last !== undefined && now - last < THEME_WRITE_MIN_INTERVAL_MS) return false;
    return recent.length < THEME_WRITES_PER_MINUTE;
};

const countWrite = (modId: string, now: number) => {
    countedWrites.set(modId, [...(countedWrites.get(modId) ?? []), now]);
};

/** Forgets every mod's counted writes; for tests (call it in afterEach). */
export const resetFoliumThemeWriteLimitsForTest = () => {
    countedWrites.clear();
};

const invalid = (problem: string) => new TypeError(`invalid-arguments: ${problem}`);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const COLOR_FIELDS = ['backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'] as const;
const TEXT_FIELDS = ['name', 'description'] as const;

/* One side of `apply`'s argument: the fields the contract takes, checked and copied; the rest is ignored. */
const sideOf = (value: unknown, side: 'light' | 'dark'): FoliumThemeInput => {
    if (!isPlainObject(value)) throw invalid(`theme.${side} must be an object`);
    const out: Record<string, unknown> = {};
    for (const field of COLOR_FIELDS) {
        const color = value[field];
        if (color === undefined) continue;
        if (!isThemeHexColor(color)) throw invalid(`theme.${side}.${field} must be a hex color (#rgb or #rrggbb)`);
        out[field] = color;
    }
    for (const field of TEXT_FIELDS) {
        const text = value[field];
        if (text === undefined) continue;
        if (typeof text !== 'string') throw invalid(`theme.${side}.${field} must be a string`);
        out[field] = text.slice(0, MAX_TEXT_LENGTH);
    }
    const { wordColors, lyricsIcons } = value;
    if (wordColors !== undefined) {
        if (!Array.isArray(wordColors)) throw invalid(`theme.${side}.wordColors must be an array`);
        // By index: forEach would skip the holes of a sparse array.
        const entries: { word: string; color: string }[] = [];
        for (let index = 0; index < Math.min(wordColors.length, MAX_WORD_COLORS); index += 1) {
            const entry: unknown = wordColors[index];
            if (!isPlainObject(entry) || typeof entry.word !== 'string' || !isThemeHexColor(entry.color)) {
                throw invalid(`theme.${side}.wordColors[${index}] must be { word: string, color: hex color }`);
            }
            entries.push({ word: entry.word.slice(0, MAX_TEXT_LENGTH), color: entry.color });
        }
        out.wordColors = entries;
    }
    if (lyricsIcons !== undefined) {
        if (!Array.isArray(lyricsIcons)) throw invalid(`theme.${side}.lyricsIcons must be an array`);
        const icons: string[] = [];
        for (let index = 0; index < Math.min(lyricsIcons.length, MAX_LYRICS_ICONS); index += 1) {
            const icon: unknown = lyricsIcons[index];
            if (typeof icon !== 'string') throw invalid(`theme.${side}.lyricsIcons[${index}] must be a string`);
            icons.push(icon.slice(0, MAX_TEXT_LENGTH));
        }
        out.lyricsIcons = icons;
    }
    return Object.freeze(out);
};

/** The argument of `apply`, checked: both sides present, hex colors only. */
export const checkFoliumThemeInput = (theme: unknown): FoliumThemeOverrideInput => {
    if (!isPlainObject(theme)) throw invalid('theme must be { light, dark }');
    return Object.freeze({ light: sideOf(theme.light, 'light'), dark: sideOf(theme.dark, 'dark') });
};

/** `fromColors`: the host's cover-theme generator over the mod's colors. Pure, so both contexts have it. */
const fromColors = (colors: readonly string[]): FoliumDualTheme => {
    // Checked as unknown: a mod's code is not held to the types.
    const given: unknown = colors;
    if (!Array.isArray(given) || colors.length === 0 || colors.length > FROM_COLORS_MAX) {
        throw invalid(`colors must be an array of 1-${FROM_COLORS_MAX} hex colors`);
    }
    for (let index = 0; index < colors.length; index += 1) {
        if (!isThemeHexColor(colors[index])) throw invalid(`colors[${index}] must be a hex color (#rgb or #rrggbb)`);
    }
    const generated = generateBuiltinDualTheme({ coverColors: [...colors] });
    return Object.freeze({
        light: Object.freeze(toFoliumTheme(generated.light, true)),
        dark: Object.freeze(toFoliumTheme(generated.dark, false)),
    });
};

/**
 * `folium.theme` for one mod in `context`. `stopped` refuses the writes of an activation that was torn
 * down (and names the call in the console).
 */
export const createFoliumThemeService = (
    mod: ModRuntimeInfo,
    context: FoliumContextKind,
    stopped: FoliumStoppedCheck = () => false,
): FoliumThemeHelpers => {
    /* The installed source; outside the main window, and before it is installed, the call throws. */
    const sourceOf = (): FoliumThemeSource => {
        if (context !== 'main' || !themeSource) throw new Error(`theme-unavailable-in-${context}-context`);
        return themeSource;
    };

    /* The permission first, then where the call is made: as folium.equalizer does. */
    const writeSource = (): FoliumThemeSource => {
        if (!mod.permissions.includes(THEME_WRITE)) throw new Error(`permission-denied:${THEME_WRITE}`);
        return sourceOf();
    };

    return Object.freeze({
        ...FOLIUM_THEME_HELPERS,
        getCurrent: () => sourceOf().getCurrent(),
        getOverride: () => sourceOf().getOverride(),
        fromColors,
        apply: (theme: FoliumDualThemeInput): FoliumThemeWriteResult => {
            const source = writeSource();
            const checked = checkFoliumThemeInput(theme);
            if (stopped('theme.apply')) return Object.freeze({ ok: false, reason: 'stopped' });
            if (!source.wouldChange(mod, checked)) return Object.freeze({ ok: true, override: source.getOverride() });
            if (!source.getOverride().writable) return Object.freeze({ ok: false, reason: 'custom-preferred' });
            const now = Date.now();
            if (!withinAllowance(mod.id, now)) return Object.freeze({ ok: false, reason: 'rate-limited' });
            if (source.apply(mod, checked)) countWrite(mod.id, now);
            return Object.freeze({ ok: true, override: source.getOverride() });
        },
        release: () => {
            const source = writeSource();
            if (stopped('theme.release')) return false;
            return source.release(mod);
        },
    });
};
