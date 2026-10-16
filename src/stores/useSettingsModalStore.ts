// src/stores/useSettingsModalStore.ts
// The settings dialog's own UI state: which tab and subview are open, the user-guide gate, the
// pinned command slots, and the app language preference.
//
// Split out of useSettingsUiStore — this is chrome around the settings, not a setting itself.

import { create } from 'zustand';
import i18n from '../i18n/config';


import { normalizePinnedCommandIds, readPinnedCommandIds, writePinnedCommandIds, type PinnedCommandIds } from '../components/command-palette/pinnedCommandPreferences';
import { applyAppLanguagePreference, readStoredAppLanguagePreference, type AppLanguagePreference } from '../i18n/config';
import { setStatusMessage } from './useStatusMessageStore';
import type { SettingsAnchorId } from '../components/modal/settings/navigation/settingsAnchorModel';

export type SettingsModalInitialTab = 'help' | 'options';

export type SettingsSubviewId = 'appearance' | 'general' | 'playback' | 'interaction' | 'integration' | 'storage' | 'desktop' | 'graphics' | 'mods' | 'lab' | 'visualizer' | 'themePark' | 'lyricFilter' | 'globalLyricOffset';

/** 歌词动画调参台的四页。列成数组是为了让「思索」的设置直达在单测里能核对 section 真实存在。 */
export const VISUALIZER_SETTINGS_SECTIONS = ['common', 'background', 'visualizer', 'subtitle'] as const;
export type VisualizerSettingsSection = typeof VISUALIZER_SETTINGS_SECTIONS[number];

export type SettingsModalState = {
    isOpen: boolean;
    initialTab: SettingsModalInitialTab;
    initialSubview?: SettingsSubviewId | null;
    initialVisualizerSection?: VisualizerSettingsSection | null;
    /**
     * A section inside the subview to land on, rather than its top. The sidebar table of contents
     * already knows how to scroll to one; this is the same destination, reachable from outside.
     * Carries a seq so that asking for the same anchor twice still scrolls the second time.
     */
    initialAnchor?: { id: SettingsAnchorId; seq: number } | null;
};

// Separate from the retired guide key so people who saw the old carousel still receive the Ponder lesson.
const LAST_SEEN_GUIDE_VERSION_STORAGE_KEY = 'folia_last_seen_ponder_onboarding_version';

export type SettingsModalUiState = {
    appLanguagePreference: AppLanguagePreference;
    pinnedCommandIds: PinnedCommandIds;
    isSubSettingsViewOpen: boolean;
    settingsModalState: SettingsModalState;
    lastSeenGuideVersion: string | null;
    isUserGuideModalOpen: boolean;
    setLastSeenGuideVersion: (version: string) => void;
    setIsUserGuideModalOpen: (isOpen: boolean) => void;
    setIsSubSettingsViewOpen: (open: boolean) => void;
    openSettings: (
        initialTab?: SettingsModalInitialTab,
        initialSubview?: SettingsSubviewId | null,
        initialVisualizerSection?: VisualizerSettingsSection | null,
        initialAnchorId?: SettingsAnchorId | null,
    ) => void;
    closeSettings: () => void;
    handleSetAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void>;
    setPinnedCommandId: (slotIndex: number, commandId: string | null) => void;
};

export const useSettingsModalStore = create<SettingsModalUiState>((set, get) => ({
    appLanguagePreference: readStoredAppLanguagePreference(),
    pinnedCommandIds: readPinnedCommandIds(),
    isSubSettingsViewOpen: false,
    settingsModalState: {
        isOpen: false,
        initialTab: 'help',
        initialSubview: null,
        initialVisualizerSection: null,
        initialAnchor: null,
    },
    lastSeenGuideVersion: typeof window !== 'undefined' ? localStorage.getItem(LAST_SEEN_GUIDE_VERSION_STORAGE_KEY) : null,
    isUserGuideModalOpen: false,
    setLastSeenGuideVersion: (version) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LAST_SEEN_GUIDE_VERSION_STORAGE_KEY, version);
        }
        set({ lastSeenGuideVersion: version });
    },
    setIsUserGuideModalOpen: (isOpen) => set({ isUserGuideModalOpen: isOpen }),
    setIsSubSettingsViewOpen: (open) => set({ isSubSettingsViewOpen: open }),
    openSettings: (initialTab = 'help', initialSubview = null, initialVisualizerSection = null, initialAnchorId = null) => set({
        settingsModalState: {
            isOpen: true,
            initialTab,
            initialSubview,
            initialVisualizerSection,
            initialAnchor: initialAnchorId
                ? { id: initialAnchorId, seq: (get().settingsModalState.initialAnchor?.seq ?? 0) + 1 }
                : null,
        },
    }),
    closeSettings: () => set(state => ({
        settingsModalState: {
            ...state.settingsModalState,
            isOpen: false,
        },
    })),
    handleSetAppLanguagePreference: async (preference) => {
        await applyAppLanguagePreference(preference);
        set({ appLanguagePreference: preference });
        const getLanguageLabel = (pref: AppLanguagePreference): string => {
            switch (pref) {
                case 'zh-CN': return i18n.t('options.appLanguageZhCN', { lng: 'zh-CN' });
                case 'vi': return i18n.t('options.appLanguageViVN', { lng: 'vi' });
                case 'in': return i18n.t('options.appLanguageInID', { lng: 'in' });
                case 'en': return i18n.t('options.appLanguageEnUS', { lng: 'en' });
                default: return '';
            }
        };

        setStatusMessage({
            type: 'info',
            text: preference === 'system'
                ? i18n.t('notifications.langFollowSystem')
                : i18n.t('notifications.langManual', { language: getLanguageLabel(preference) }),
        });
    },
    setPinnedCommandId: (slotIndex, commandId) => {
        if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 3) {
            return;
        }
        const current = get().pinnedCommandIds;
        const next = normalizePinnedCommandIds(
            current.map((currentCommandId, index) => (
                index === slotIndex ? commandId : currentCommandId
            )),
        );
        writePinnedCommandIds(next);
        set({ pinnedCommandIds: next });
    },
}));

/**
 * The SettingsModal half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectSettingsModalSnapshot = (state: SettingsModalUiState) => ({
    appLanguagePreference: state.appLanguagePreference,
    pinnedCommandIds: state.pinnedCommandIds,
    isSubSettingsViewOpen: state.isSubSettingsViewOpen,
    settingsModalState: state.settingsModalState,
    lastSeenGuideVersion: state.lastSeenGuideVersion,
    isUserGuideModalOpen: state.isUserGuideModalOpen,
    setLastSeenGuideVersion: state.setLastSeenGuideVersion,
    setIsUserGuideModalOpen: state.setIsUserGuideModalOpen,
    setIsSubSettingsViewOpen: state.setIsSubSettingsViewOpen,
    openSettings: state.openSettings,
    closeSettings: state.closeSettings,
    handleSetAppLanguagePreference: state.handleSetAppLanguagePreference,
    setPinnedCommandId: state.setPinnedCommandId,
});

// Module-level handles for the assembly layer; actions need no subscription.
export const openSettings = (
    initialTab?: SettingsModalInitialTab,
    initialSubview?: SettingsSubviewId | null,
    initialVisualizerSection?: VisualizerSettingsSection | null,
    initialAnchorId?: SettingsAnchorId | null,
) => useSettingsModalStore.getState().openSettings(initialTab, initialSubview, initialVisualizerSection, initialAnchorId);
export const closeSettings = () => useSettingsModalStore.getState().closeSettings();
