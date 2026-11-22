// src/stores/usePlaybackEntryViewStore.ts
// Which surface a "play this song" action lands on, plus the one-time prompt that asks for it.
//
// Kept out of useAppViewStore on purpose: that store is where the app *is*, this one is a stored
// preference about where playback should take it. The prompt's open state lives here too, because
// the only thing that opens it is this preference never having been chosen.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';

/**
 * Where pressing play lands. `player` is the visualizer page, `lattice` the queue collage, and
 * `stay` leaves the listener where they pressed it (the library card or wall just shows that the
 * song is playing). `stay` was added later (fb3, 2026-10-07): stored values from before still read
 * back as what they were, and anything unknown falls back to `player`.
 */
export type PlaybackEntryView = 'player' | 'lattice' | 'stay';

export const PLAYBACK_ENTRY_VIEWS: readonly PlaybackEntryView[] = ['player', 'lattice', 'stay'];

export const isPlaybackEntryView = (value: unknown): value is PlaybackEntryView => (
    typeof value === 'string' && (PLAYBACK_ENTRY_VIEWS as readonly string[]).includes(value)
);

/**
 * The surface an explicit "open the playback view" lands on (the player capsule, the startup view,
 * bravais' enter button on the playing card). `stay` has no surface of its own, so it opens the
 * player — the listener asked to go somewhere, and the visualizer is the default somewhere.
 */
export const resolvePlaybackSurface = (view: PlaybackEntryView): 'player' | 'lattice' => (
    view === 'lattice' ? 'lattice' : 'player'
);

const ENTRY_VIEW_KEY = 'playback_entry_view';
const ENTRY_VIEW_CHOSEN_KEY = 'playback_entry_view_chosen';
/**
 * The library-interface page (grid / bravais) of the startup prompt has been shown once on this install.
 * Its own flag, not tied to any version: everyone sees that page exactly once (2026-10-10), including installs
 * that answered the older single-page prompt — and it must not ride on the release-notes version, which moves
 * every release.
 */
const LIBRARY_SUITE_PROMPT_SEEN_KEY = 'library_suite_prompt_seen';

/**
 * The pages the startup prompt can show, in order. `sources` (Folium 2.0 plan §5.3) is asked of a fresh desktop
 * profile once; whether it is owed and its answer live in the main process, not here
 * (components/modal/playback-entry-view/sourcesOnboarding.ts).
 */
export type StartupPromptPage = 'sources' | 'library-suite' | 'playback-entry-view';

/** What the assembly layer knows about the pages this store does not keep the answers of. */
export type StartupPromptOptions = { withSources?: boolean; withLibrarySuite?: boolean };

const readEntryView = (): PlaybackEntryView => {
    const stored = getStoredString(ENTRY_VIEW_KEY, 'player');
    return isPlaybackEntryView(stored) ? stored : 'player';
};

export type PlaybackEntryViewState = {
    playbackEntryView: PlaybackEntryView;
    /** True once the listener has answered the prompt, or changed the setting by hand. */
    hasChosenPlaybackEntryView: boolean;
    /** True once the library-interface page has been shown (see LIBRARY_SUITE_PROMPT_SEEN_KEY). */
    hasSeenLibrarySuitePrompt: boolean;
    isPlaybackEntryViewPromptOpen: boolean;
    /** The pages of the prompt that is open (empty while closed); fixed for one opening. */
    promptPages: readonly StartupPromptPage[];

    setPlaybackEntryView: (view: PlaybackEntryView) => void;
    /**
     * Opens the prompt with the pages still unanswered: the sources page when `withSources` (the main process says a
     * fresh profile owes it), the library-interface page when `withLibrarySuite` (both suites exist in this build)
     * and it has not been shown yet, the playback page when that has not been chosen. Returns whether it opened
     * (nothing left to ask → false).
     */
    requestPlaybackEntryViewPrompt: (options?: StartupPromptOptions) => boolean;
    /** Closes the prompt and records both questions as answered, so it never opens again. */
    closePlaybackEntryViewPrompt: () => void;
};

export const usePlaybackEntryViewStore = create<PlaybackEntryViewState>((set, get) => ({
    playbackEntryView: readEntryView(),
    hasChosenPlaybackEntryView: getStoredBoolean(ENTRY_VIEW_CHOSEN_KEY, false),
    hasSeenLibrarySuitePrompt: getStoredBoolean(LIBRARY_SUITE_PROMPT_SEEN_KEY, false),
    isPlaybackEntryViewPromptOpen: false,
    promptPages: [],

    // Picking a view *is* answering the question, wherever it is picked, so this also retires the
    // prompt: someone who set it in the options should not be asked about it again afterwards.
    setPlaybackEntryView: (view) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(ENTRY_VIEW_KEY, view);
        }
        setStoredBoolean(ENTRY_VIEW_CHOSEN_KEY, true);
        set({ playbackEntryView: view, hasChosenPlaybackEntryView: true });
    },
    requestPlaybackEntryViewPrompt: ({ withSources = false, withLibrarySuite = false } = {}) => {
        const state = get();
        if (state.isPlaybackEntryViewPromptOpen) {
            return false;
        }
        const pages: StartupPromptPage[] = [];
        if (withSources) pages.push('sources');
        if (withLibrarySuite && !state.hasSeenLibrarySuitePrompt) pages.push('library-suite');
        if (!state.hasChosenPlaybackEntryView) pages.push('playback-entry-view');
        if (pages.length === 0) {
            return false;
        }
        set({ isPlaybackEntryViewPromptOpen: true, promptPages: pages });
        return true;
    },
    closePlaybackEntryViewPrompt: () => {
        setStoredBoolean(ENTRY_VIEW_CHOSEN_KEY, true);
        setStoredBoolean(LIBRARY_SUITE_PROMPT_SEEN_KEY, true);
        set({ isPlaybackEntryViewPromptOpen: false, hasChosenPlaybackEntryView: true, hasSeenLibrarySuitePrompt: true });
    },
}));

/** Module-level handle for the assembly layer; it is an action, so it needs no subscription. */
export const requestPlaybackEntryViewPrompt = (options?: StartupPromptOptions) => (
    usePlaybackEntryViewStore.getState().requestPlaybackEntryViewPrompt(options)
);
