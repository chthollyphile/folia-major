import {
    SETTINGS_GROUPS,
    settingsCatalogGroup,
    type SettingsGroupId,
} from './settingsCatalog';
import {
    encodeStoredSetting,
    parseSettingsBundle,
    readStoredSetting,
    type SettingsBundle,
} from './settingsBundle';

// src/services/settingsTransfer/settingsImportPlan.ts
// What taking a bundle would change, group by group, and then taking it.
//
// Reading and applying are kept apart for the same reason the visual config's import keeps them
// apart: a bundle changes settings the dialog has to be able to show first. Nothing is written
// until a person has picked the groups.
//
// There is no per-setting diff the stores can be told about: a whole-settings bundle covers
// settings whose stores have no setter that takes a stored value, so the picked values are written
// where the stores read them and the page is reloaded once. That is why applySettingsImport says
// how many keys it wrote and leaves the reload to the caller.

/** One setting in the plan: what is stored now and what the bundle would store. */
export type SettingsChange = {
    key: string;
    kind: 'add' | 'set';
    current: unknown;
    incoming: unknown;
};

export type SettingsGroupPlan = {
    group: SettingsGroupId;
    /** The group's changed entries, in catalog order. Unchanged ones are not listed. */
    changes: SettingsChange[];
};

export type SettingsImportPlan = {
    bundle: SettingsBundle;
    /** Only the groups that would change something, in the export dialog's order. */
    groups: SettingsGroupPlan[];
    /** Entries the bundle named that this build does not take, with why. */
    skipped: Array<{ key: string; reason: string }>;
    /** How many settings the whole bundle would change. */
    totalChanged: number;
    /** The mods the bundle was written with; nothing is installed from a bundle. */
    mods: SettingsBundle['mods'];
};

const sameValue = (left: unknown, right: unknown): boolean => {
    if (left === right) {
        return true;
    }
    if (left === undefined || right === undefined) {
        return false;
    }
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
};

/** Reads a bundle and works out, group by group, what taking it would change. Throws on text that is not a bundle. */
export const planSettingsImport = (text: string): SettingsImportPlan => {
    const { bundle, skipped } = parseSettingsBundle(text);
    const groups: SettingsGroupPlan[] = [];
    let totalChanged = 0;

    for (const group of SETTINGS_GROUPS) {
        const incoming = bundle.settings[group];
        if (!incoming) {
            continue;
        }
        const changes: SettingsChange[] = [];
        // Catalog order rather than the file's order, so the dialog lists a group the same way
        // every time and a hand-edited file cannot reorder it.
        for (const entry of settingsCatalogGroup(group)) {
            if (!(entry.key in incoming)) {
                continue;
            }
            const value = incoming[entry.key];
            const current = readStoredSetting(entry.key, entry.type);
            if (sameValue(current, value)) {
                continue;
            }
            changes.push({
                key: entry.key,
                kind: current === undefined ? 'add' : 'set',
                current,
                incoming: value,
            });
        }
        if (changes.length > 0) {
            groups.push({ group, changes });
            totalChanged += changes.length;
        }
    }

    return { bundle, groups, skipped, totalChanged, mods: bundle.mods };
};

/**
 * Writes the chosen groups' settings where the stores read them. Returns how many keys were
 * written; the caller reloads, because most stores read their value once when they are created.
 */
export const applySettingsImport = (plan: SettingsImportPlan, chosenGroups: SettingsGroupId[]): number => {
    let written = 0;
    for (const groupPlan of plan.groups) {
        if (!chosenGroups.includes(groupPlan.group)) {
            continue;
        }
        for (const change of groupPlan.changes) {
            const encoded = encodeStoredSetting(change.key, change.incoming);
            if (encoded === null) {
                // Already refused when the bundle was read; a plan is only built from that read,
                // so this cannot happen. Skipped rather than thrown: one bad key must not stop the rest.
                console.warn('[SettingsTransfer] skipped a value it could not store', change.key);
                continue;
            }
            localStorage.setItem(change.key, encoded);
            written += 1;
        }
    }
    return written;
};

/** The group every change of a plan belongs to, for a caller that wants all of them. */
export const allPlannedGroups = (plan: SettingsImportPlan): SettingsGroupId[] => plan.groups.map(group => group.group);
