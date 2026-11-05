import { listMods, isModsBridgeAvailable } from '../../mods/ipc';
import {
    SETTINGS_CATALOG,
    SETTINGS_GROUPS,
    settingsCatalogEntry,
    type SettingsGroupId,
    type SettingsValueType,
} from './settingsCatalog';

// src/services/settingsTransfer/settingsBundle.ts
// The whole-settings document: building one from what this Folia stored, and reading one back.
//
// It is deliberately not the visual config code. That one is a shortcode shared with the web
// build's OBS quick import, and its shape cannot grow (see utils/appearanceCodec.ts). This is a
// JSON file a person keeps, so it can carry a version, the groups, and names for what it holds.
//
// What goes in is decided by settingsCatalog.ts alone; this file only moves values. A value is
// written as the JSON shape the store reads it back as, not as the string localStorage holds, so
// the file stays readable and a hand edit stays possible.

export const SETTINGS_BUNDLE_FORMAT = 'folia-settings';

/** Bumped when the file's shape changes in a way an older build cannot read. */
export const SETTINGS_BUNDLE_VERSION = 1;

/** The name a downloaded bundle is saved under. */
export const SETTINGS_BUNDLE_FILE_NAME = 'folia-settings.json';

/** One installed mod, as the bundle names it: what is installed, not what it holds. */
export type SettingsBundleMod = {
    id: string;
    name: string;
    version: string | null;
    enabled: boolean;
};

export type SettingsBundle = {
    format: typeof SETTINGS_BUNDLE_FORMAT;
    version: number;
    /** When the bundle was written, ISO 8601. */
    createdAt: string;
    /** What wrote it: enough to explain a bundle that will not read. */
    app: {
        version: string;
        platform: string;
    };
    /** Grouped so a reader can tell what a bundle is about, and pick it a group at a time. */
    settings: Partial<Record<SettingsGroupId, Record<string, unknown>>>;
    /** The mods that were installed. Absent on the web build, which has no mods. */
    mods?: SettingsBundleMod[];
};

/** What the bundle says about the settings it could not read, kept for the import dialog. */
export type SettingsBundleReadResult = {
    bundle: SettingsBundle;
    /** Entries that were skipped, with why: a bundle from a newer build, a value of the wrong shape. */
    skipped: Array<{ key: string; reason: string }>;
};

const appVersion = (): string => {
    const value = (globalThis as { __APP_VERSION__?: unknown }).__APP_VERSION__;
    return typeof value === 'string' ? value : '';
};

const appPlatform = (): string => {
    if (typeof navigator === 'undefined') {
        return 'unknown';
    }
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
    return platform || navigator.platform || 'unknown';
};

/** Reads one stored setting in the shape the catalog says it has; undefined when it is not set. */
export const readStoredSetting = (key: string, type: SettingsValueType): unknown => {
    if (typeof localStorage === 'undefined') {
        return undefined;
    }
    const stored = localStorage.getItem(key);
    if (stored === null) {
        return undefined;
    }
    switch (type) {
        case 'boolean':
            return stored === 'true';
        case 'number': {
            const value = Number(stored);
            return Number.isFinite(value) ? value : undefined;
        }
        case 'json':
            try {
                return JSON.parse(stored);
            } catch {
                return undefined;
            }
        default:
            return stored;
    }
};

/**
 * The string the stores expect for a value of this type, or null when the value is not one they
 * could read. A bundle is a file people edit, so a wrong shape is refused rather than stored.
 */
export const encodeStoredSetting = (key: string, value: unknown): string | null => {
    const type = settingsCatalogEntry(key)?.type;
    if (!type) {
        return null;
    }
    switch (type) {
        case 'boolean':
            return typeof value === 'boolean' ? String(value) : null;
        case 'number':
            return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
        case 'json':
            return value === null || typeof value === 'object' ? JSON.stringify(value) : null;
        default:
            return typeof value === 'string' ? value : null;
    }
};

/** The installed mods, for the bundle's list. Empty where there is no mod system (the web build). */
const readInstalledMods = async (): Promise<SettingsBundleMod[] | undefined> => {
    if (!isModsBridgeAvailable()) {
        return undefined;
    }
    const payload = await listMods();
    return payload.mods.map(mod => ({
        id: mod.id,
        name: mod.name,
        version: mod.version,
        enabled: mod.enabled,
    }));
};

/** What this Folia has stored, as a bundle. Every catalog entry that is set, grouped. */
export const buildSettingsBundle = async (): Promise<SettingsBundle> => {
    const settings: Partial<Record<SettingsGroupId, Record<string, unknown>>> = {};
    for (const group of SETTINGS_GROUPS) {
        settings[group] = {};
    }
    for (const entry of SETTINGS_CATALOG) {
        const value = readStoredSetting(entry.key, entry.type);
        if (value === undefined) {
            continue;
        }
        (settings[entry.group] as Record<string, unknown>)[entry.key] = value;
    }
    // A group nothing is set in is noise in the file: drop it rather than write an empty object.
    for (const group of SETTINGS_GROUPS) {
        if (Object.keys(settings[group] ?? {}).length === 0) {
            delete settings[group];
        }
    }
    const mods = await readInstalledMods();
    return {
        format: SETTINGS_BUNDLE_FORMAT,
        version: SETTINGS_BUNDLE_VERSION,
        createdAt: new Date().toISOString(),
        app: { version: appVersion(), platform: appPlatform() },
        settings,
        ...(mods ? { mods } : {}),
    };
};

/** The bundle as the text of a file: indented, since a person may open it. */
export const serializeSettingsBundle = (bundle: SettingsBundle): string => `${JSON.stringify(bundle, null, 2)}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

/**
 * Reads a bundle from text, keeping the entries it can. Throws when the text is not a bundle at
 * all: a file of the wrong kind is a mistake to correct, not something to half-take.
 */
export const parseSettingsBundle = (text: string): SettingsBundleReadResult => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('not JSON');
    }
    if (!isRecord(parsed) || parsed.format !== SETTINGS_BUNDLE_FORMAT) {
        throw new Error('not a Folia settings bundle');
    }
    const version = typeof parsed.version === 'number' ? parsed.version : 0;
    if (version > SETTINGS_BUNDLE_VERSION) {
        // A newer build wrote this. Reading it with this build's rules would drop what it added
        // silently, so it is refused instead.
        throw new Error(`bundle version ${version} is newer than ${SETTINGS_BUNDLE_VERSION}`);
    }
    if (!isRecord(parsed.settings)) {
        throw new Error('bundle has no settings');
    }

    const skipped: Array<{ key: string; reason: string }> = [];
    const settings: Partial<Record<SettingsGroupId, Record<string, unknown>>> = {};
    for (const [group, values] of Object.entries(parsed.settings)) {
        if (!isRecord(values)) {
            skipped.push({ key: group, reason: 'group is not an object' });
            continue;
        }
        for (const [key, value] of Object.entries(values)) {
            const catalogEntry = settingsCatalogEntry(key);
            if (!catalogEntry) {
                // A key this build does not know: a newer build's setting, or something else
                // entirely. It is named in `skipped` rather than written blind.
                skipped.push({ key, reason: 'not a setting this build knows' });
                continue;
            }
            if (encodeStoredSetting(key, value) === null) {
                skipped.push({ key, reason: `not a ${catalogEntry.type}` });
                continue;
            }
            const bucket = (settings[catalogEntry.group] ??= {});
            bucket[key] = value;
        }
    }

    const mods = Array.isArray(parsed.mods)
        ? parsed.mods.filter((mod): mod is SettingsBundleMod => (
            isRecord(mod) && typeof mod.id === 'string'
        )).map(mod => ({
            id: String(mod.id),
            name: typeof mod.name === 'string' ? mod.name : String(mod.id),
            version: typeof mod.version === 'string' ? mod.version : null,
            enabled: mod.enabled === true,
        }))
        : undefined;

    return {
        bundle: {
            format: SETTINGS_BUNDLE_FORMAT,
            version,
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
            app: isRecord(parsed.app)
                ? {
                    version: typeof parsed.app.version === 'string' ? parsed.app.version : '',
                    platform: typeof parsed.app.platform === 'string' ? parsed.app.platform : '',
                }
                : { version: '', platform: '' },
            settings,
            ...(mods ? { mods } : {}),
        },
        skipped,
    };
};

/** Saves text as a file the browser downloads, under `fileName`. */
export const downloadTextFile = (text: string, fileName: string): void => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next turn of the loop: revoking it in the same one cancels the download in
    // some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
