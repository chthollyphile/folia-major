import type { SettingsSubviewId } from '../../../../stores/useSettingsModalStore';
import { SETTINGS_NAV_GROUP_SPECS, type SettingsSectionId } from './settingsNavModel';

// src/components/modal/settings/navigation/settingsLastSection.ts
// Remembers which options-tab section the settings dialog was last on, and decides which section it
// opens on. This is navigation memory, not a setting: it stays out of appearance import/export,
// sync and the command palette on purpose.
//
// Everything here is pure or takes its storage as an argument, so the rules (a stale or unavailable
// id falls back, an explicit target always wins, a throwing storage is survivable) are testable
// without a DOM.

export const SETTINGS_LAST_SECTION_STORAGE_KEY = 'folia_settings_last_section';

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'appearance';

/** The slice of Storage this module touches; tests pass a plain object. */
export type SettingsSectionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface SettingsSectionAvailability {
    isElectron: boolean;
}

/** Section ids the sidebar actually shows on this runtime, in sidebar order. */
export const getAvailableSettingsSectionIds = ({ isElectron }: SettingsSectionAvailability): SettingsSectionId[] => (
    SETTINGS_NAV_GROUP_SPECS
        .flatMap(group => group.sections)
        .filter(section => !section.electronOnly || isElectron)
        .map(section => section.id)
);

/**
 * Which options-tab section a subview target lands on. `lyricFilter` and `globalLyricOffset` are
 * secondary panels opened from the lyrics section, so closing them falls back to it. The overlay
 * workbenches (`visualizer`, `themePark`) have no section of their own and return null.
 */
export const sectionForSettingsSubview = (subview: SettingsSubviewId | null | undefined): SettingsSectionId | null => {
    if (!subview) {
        return null;
    }
    if (subview === 'globalLyricOffset' || subview === 'lyricFilter') {
        return 'lyrics';
    }
    const isSection = SETTINGS_NAV_GROUP_SPECS.some(group => group.sections.some(section => section.id === subview));
    return isSection ? (subview as SettingsSectionId) : null;
};

/** True only when the subview IS a sidebar section, i.e. the user is really entering that page. */
export const isSettingsSectionSubview = (subview: SettingsSubviewId | null | undefined): subview is SettingsSubviewId & SettingsSectionId => (
    Boolean(subview) && sectionForSettingsSubview(subview) === subview
);

// Reading window.localStorage can itself throw (blocked site data, sandboxed frames), so even
// fetching the handle is inside the guard.
const getDefaultStorage = (): SettingsSectionStorage | null => {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
};

/** The stored section, or null when nothing usable is stored: missing, unknown id, or hidden here. */
export const readLastSettingsSection = (
    availability: SettingsSectionAvailability,
    storage: SettingsSectionStorage | null = getDefaultStorage(),
): SettingsSectionId | null => {
    if (!storage) {
        return null;
    }
    try {
        const stored = storage.getItem(SETTINGS_LAST_SECTION_STORAGE_KEY);
        if (!stored) {
            return null;
        }
        return getAvailableSettingsSectionIds(availability).find(id => id === stored) ?? null;
    } catch {
        return null;
    }
};

/** Persists the section; ids the sidebar does not show here are ignored so they cannot be stored. */
export const writeLastSettingsSection = (
    section: SettingsSectionId,
    availability: SettingsSectionAvailability,
    storage: SettingsSectionStorage | null = getDefaultStorage(),
): void => {
    if (!storage || !getAvailableSettingsSectionIds(availability).includes(section)) {
        return;
    }
    try {
        storage.setItem(SETTINGS_LAST_SECTION_STORAGE_KEY, section);
    } catch {
        // Navigation memory is best-effort; a full or blocked storage must never break the dialog.
    }
};

export interface InitialSettingsSectionRequest extends SettingsSectionAvailability {
    initialSubview: SettingsSubviewId | null | undefined;
    /** An anchor is also a named destination, so it counts as an explicit target. */
    hasInitialAnchor: boolean;
}

/**
 * Picks the section the dialog opens on. A caller that named a target (subview or anchor) always
 * gets its own page and the memory is not consulted; only a bare open restores the last section.
 * Overlay targets (`visualizer`, `themePark`) keep the default section behind them, as before.
 */
export const resolveInitialSettingsSection = (
    request: InitialSettingsSectionRequest,
    storage?: SettingsSectionStorage | null,
): SettingsSectionId => {
    const { initialSubview, hasInitialAnchor } = request;
    if (initialSubview || hasInitialAnchor) {
        return sectionForSettingsSubview(initialSubview) ?? DEFAULT_SETTINGS_SECTION;
    }
    return readLastSettingsSection(request, storage === undefined ? getDefaultStorage() : storage) ?? DEFAULT_SETTINGS_SECTION;
};
