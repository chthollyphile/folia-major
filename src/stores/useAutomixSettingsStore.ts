// src/stores/useAutomixSettingsStore.ts
// FOLIA's smart-transition switches: whether blending is on, which strategy plans the change,
// and the two transition animation toggles.
//
// Split out of useSettingsUiStore.

import { create } from 'zustand';
import { modelsPresent } from '../services/analysis/modelAvailability';

import { clampCrossfadeSeconds, CROSSFADE_DEFAULT_SEC } from '../services/automix/crossfadePlanner';
import { DEFAULT_TRANSITION_SETTINGS, isTransitionMode, type TransitionMode } from '../services/automix/transitionStrategy';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

/** Set only by the reminder's own "don't remind me" button. Absent = still worth asking. */
export const AUTOMIX_MODEL_REMINDER_MUTED_KEY = 'folia_automix_model_reminder_muted';

/**
 * Whether switching transitions on is worth interrupting for.
 *
 * Three ways to answer no, and they are three different reasons rather than one condition:
 *
 * - Not a desktop build. The browser cannot run either model no matter what it downloads, so a
 *   prompt there is an errand that does not exist - which is the same distinction the engine badge
 *   already draws between "a limit" and "something you can go and fix".
 * - The weights are already here. Asked of `modelsPresent()`, which the automix hook refreshes at
 *   startup, so a fresh launch with both files installed answers correctly without opening
 *   Settings first.
 * - The listener said not to ask again. That one is remembered rather than re-derived, because it
 *   is a preference and not a fact about the machine.
 *
 * Either model missing counts: the beat grid is what the crossfade mode reads for its alignment
 * too, so "I only use crossfade" is not a reason to be missing beat_this.
 */
export const shouldRemindAboutModels = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (typeof window.electron?.separateStems !== 'function') return false;
    if (getStoredBoolean(AUTOMIX_MODEL_REMINDER_MUTED_KEY, false)) return false;
    const present = modelsPresent();
    return !present.beat_this || !present.htdemucs;
};

const AUTOMIX_ENABLED_KEY = 'folia_automix_enabled';

const TRANSITION_MODE_KEY = 'folia_transition_mode';

const CROSSFADE_MAX_SEC_KEY = 'folia_crossfade_max_sec';

const TRANSITION_PERFORMANCE_KEY = 'folia_transition_performance';

const TRANSITION_ANIMATION_KEY = 'folia_transition_animation';

const TRANSITION_ANIMATION_CARD_KEY = 'folia_transition_animation_card';

/**
 * The card border's switch, seeded once from the switch the two renderers used to share.
 *
 * Before the split, that switch on meant the card's border was what you actually saw on the lyrics
 * page - the ring stood down wherever the card was up - so starting this one off would read as the
 * update having taken something away.
 *
 * Written back rather than derived on every start, and that is the part worth keeping: the old key
 * now belongs to the RING alone, so a listener who turns the ring on later would otherwise find the
 * border had switched itself back on at the next launch. A migration has to happen once and then be
 * over.
 */
const readTransitionAnimationCard = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    if (localStorage.getItem(TRANSITION_ANIMATION_CARD_KEY) !== null) {
        return getStoredBoolean(TRANSITION_ANIMATION_CARD_KEY, false);
    }

    const inherited = getStoredBoolean(TRANSITION_ANIMATION_KEY, false);
    setStoredBoolean(TRANSITION_ANIMATION_CARD_KEY, inherited);
    return inherited;
};

const readStoredTransitionMode = (): TransitionMode => {
    if (typeof window === 'undefined') return DEFAULT_TRANSITION_SETTINGS.mode;
    const saved = localStorage.getItem(TRANSITION_MODE_KEY);
    return isTransitionMode(saved) ? saved : DEFAULT_TRANSITION_SETTINGS.mode;
};

const readStoredCrossfadeMaxSec = (): number => {
    if (typeof window === 'undefined') return CROSSFADE_DEFAULT_SEC;
    const saved = localStorage.getItem(CROSSFADE_MAX_SEC_KEY);
    return saved === null ? CROSSFADE_DEFAULT_SEC : clampCrossfadeSeconds(Number(saved));
};

export type AutomixSettingsState = {
    automixEnabled: boolean;
    /** Whether the "you have no weights yet" prompt is showing. See `handleToggleAutomix`. */
    isAutomixModelReminderOpen: boolean;
    /** Which strategy plans a song change once blending is on. */
    transitionMode: TransitionMode;
    /** Seconds. The crossfade mode's ceiling; automix computes its own and ignores this. */
    crossfadeMaxSec: number;
    /** Let the mix be heard. Only reachable with automix on, and only where stems exist. */
    transitionPerformance: boolean;
    /**
     * Draw the mix as a ring in the middle of the screen. Automix only, and only for blends long
     * enough to watch.
     */
    transitionAnimation: boolean;
    /**
     * Draw the same mix on the now playing card's border, on the pages that card appears on.
     *
     * Its own switch rather than a placement rule under the one above, because the two are two
     * pictures in two places and only the listener knows which they want where. They used to share
     * a switch, with the ring standing down wherever the card was up - which meant turning the
     * animation on and never seeing the ring again on the page most people watch.
     */
    transitionAnimationCard: boolean;
    handleToggleAutomix: (enable: boolean) => void;
    /** Closes the model prompt. `mute` is the listener choosing never to see it again. */
    dismissAutomixModelReminder: (mute: boolean) => void;
    handleSetTransitionMode: (mode: TransitionMode) => void;
    handleSetCrossfadeMaxSec: (seconds: number) => void;
    handleToggleTransitionPerformance: (enable: boolean) => void;
    handleToggleTransitionAnimation: (enable: boolean) => void;
    handleToggleTransitionAnimationCard: (enable: boolean) => void;
};

export const useAutomixSettingsStore = create<AutomixSettingsState>((set, get) => ({
    automixEnabled: getStoredBoolean(AUTOMIX_ENABLED_KEY, false),
    isAutomixModelReminderOpen: false,
    transitionMode: readStoredTransitionMode(),
    crossfadeMaxSec: readStoredCrossfadeMaxSec(),
    transitionPerformance: getStoredBoolean(
        TRANSITION_PERFORMANCE_KEY, DEFAULT_TRANSITION_SETTINGS.performance,
    ),
    // Off by default: it draws over whatever the listener is already looking at, which is a
    // choice to make rather than one to arrive at after an update.
    transitionAnimation: getStoredBoolean(TRANSITION_ANIMATION_KEY, false),
    transitionAnimationCard: readTransitionAnimationCard(),
    handleToggleAutomix: (enable) => {
        setStoredBoolean(AUTOMIX_ENABLED_KEY, enable);
        // Asked here rather than in the settings section because there are two switches - the
        // options page and the volume row - and a prompt wired to one of them is missing from the
        // one people actually reach mid-song.
        set({ automixEnabled: enable, isAutomixModelReminderOpen: enable && shouldRemindAboutModels() });
    },
    dismissAutomixModelReminder: (mute) => {
        if (mute) setStoredBoolean(AUTOMIX_MODEL_REMINDER_MUTED_KEY, true);
        set({ isAutomixModelReminderOpen: false });
    },
    handleSetTransitionMode: (mode) => {
        if (!isTransitionMode(mode)) return;
        if (typeof window !== 'undefined') {
            localStorage.setItem(TRANSITION_MODE_KEY, mode);
        }
        set({ transitionMode: mode });
    },
    handleSetCrossfadeMaxSec: (seconds) => {
        const next = clampCrossfadeSeconds(seconds);
        if (typeof window !== 'undefined') {
            localStorage.setItem(CROSSFADE_MAX_SEC_KEY, String(next));
        }
        set({ crossfadeMaxSec: next });
    },
    handleToggleTransitionPerformance: (enable) => {
        setStoredBoolean(TRANSITION_PERFORMANCE_KEY, enable);
        set({ transitionPerformance: enable });
    },
    handleToggleTransitionAnimation: (enable) => {
        setStoredBoolean(TRANSITION_ANIMATION_KEY, enable);
        set({ transitionAnimation: enable });
    },
    handleToggleTransitionAnimationCard: (enable) => {
        setStoredBoolean(TRANSITION_ANIMATION_CARD_KEY, enable);
        set({ transitionAnimationCard: enable });
    },
}));

/**
 * The AutomixSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectAutomixSettingsSnapshot = (state: AutomixSettingsState) => ({
    automixEnabled: state.automixEnabled,
    isAutomixModelReminderOpen: state.isAutomixModelReminderOpen,
    transitionMode: state.transitionMode,
    crossfadeMaxSec: state.crossfadeMaxSec,
    transitionPerformance: state.transitionPerformance,
    transitionAnimation: state.transitionAnimation,
    transitionAnimationCard: state.transitionAnimationCard,
    handleToggleAutomix: state.handleToggleAutomix,
    dismissAutomixModelReminder: state.dismissAutomixModelReminder,
    handleSetTransitionMode: state.handleSetTransitionMode,
    handleSetCrossfadeMaxSec: state.handleSetCrossfadeMaxSec,
    handleToggleTransitionPerformance: state.handleToggleTransitionPerformance,
    handleToggleTransitionAnimation: state.handleToggleTransitionAnimation,
    handleToggleTransitionAnimationCard: state.handleToggleTransitionAnimationCard,
});
