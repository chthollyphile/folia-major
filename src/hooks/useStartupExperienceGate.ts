import { useCallback, useEffect, useState } from 'react';
import { USER_GUIDE_AUTO_OPEN_VERSION } from '../components/modal/userGuideContent';
import { skipsStartupExperience } from '../dev/devLaunchFlags';
import { hasOnboardingLibrarySuiteChoice } from '../library/app/librarySuiteChoice';
import { requestPlaybackEntryViewPrompt, usePlaybackEntryViewStore } from '../stores/usePlaybackEntryViewStore';
import { useSettingsModalStore } from '../stores/useSettingsModalStore';

// src/hooks/useStartupExperienceGate.ts

const LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY = 'folia_last_seen_guide_version';

export type StartupExperienceStep = 'release-notes' | 'playback-entry-view' | 'ponder' | null;

type StartupExperienceState = {
    isCurrentRelease: boolean;
    /** Ponder onboarding was completed in some version (it is shown once per install). */
    hasSeenPonder: boolean;
    /**
     * Ponder onboarding was completed in this version. It is the last startup step and nothing else opens it,
     * so this means the whole sequence already ran for this release.
     */
    hasFinishedThisRelease: boolean;
    hasSeenReleaseNotes: boolean;
    isReleaseNotesOpen: boolean;
    hasChosenPlaybackEntryView: boolean;
    /**
     * The library-interface page is still owed (both suites exist and it has never been shown). Unlike everything
     * else here it is not gated by the release: everyone is asked once (2026-10-10), whatever version they are on.
     */
    needsLibrarySuitePrompt: boolean;
    isPlaybackEntryViewPromptOpen: boolean;
    isPonderOnboardingOpen: boolean;
};

/** Chooses the next blocking surface while ensuring that two startup dialogs never overlap. */
export const resolveStartupExperienceStep = ({
    isCurrentRelease,
    hasSeenPonder,
    hasFinishedThisRelease,
    hasSeenReleaseNotes,
    isReleaseNotesOpen,
    hasChosenPlaybackEntryView,
    needsLibrarySuitePrompt,
    isPlaybackEntryViewPromptOpen,
    isPonderOnboardingOpen,
}: StartupExperienceState): StartupExperienceStep => {
    if (isReleaseNotesOpen || isPlaybackEntryViewPromptOpen || isPonderOnboardingOpen) {
        return null;
    }
    // The release sequence (notes, the playback choice, the Ponder gate) only runs on the release that auto-opens
    // it, and not again once finished. Release notes are per version; the playback choice and the Ponder gate are
    // once per install, so having finished Ponder must not suppress a later release's notes.
    const releaseDue = isCurrentRelease && !hasFinishedThisRelease;
    if (releaseDue && !hasSeenReleaseNotes) {
        return 'release-notes';
    }
    // The library-interface page is owed once to every install, outside the release gate.
    if ((releaseDue && !hasChosenPlaybackEntryView) || needsLibrarySuitePrompt) {
        return 'playback-entry-view';
    }
    return releaseDue && !hasSeenPonder ? 'ponder' : null;
};

const readLastSeenReleaseNotesVersion = (): string | null => (
    typeof window === 'undefined'
        ? null
        : localStorage.getItem(LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY)
);

/**
 * Runs the first-launch sequence: release notes, the two-page choice prompt (library interface, then
 * playback destination), then the Ponder shortcut gate. The prompt is gated by the playback choice alone,
 * so installs that answered the older single-page prompt are not asked again.
 */
export const useStartupExperienceGate = () => {
    const lastSeenPonderVersion = useSettingsModalStore(state => state.lastSeenGuideVersion);
    const isPonderOnboardingOpen = useSettingsModalStore(state => state.isUserGuideModalOpen);
    const setIsPonderOnboardingOpen = useSettingsModalStore(state => state.setIsUserGuideModalOpen);
    const hasChosenPlaybackEntryView = usePlaybackEntryViewStore(state => state.hasChosenPlaybackEntryView);
    const hasSeenLibrarySuitePrompt = usePlaybackEntryViewStore(state => state.hasSeenLibrarySuitePrompt);
    const needsLibrarySuitePrompt = hasOnboardingLibrarySuiteChoice() && !hasSeenLibrarySuitePrompt;
    const isPlaybackEntryViewPromptOpen = usePlaybackEntryViewStore(state => state.isPlaybackEntryViewPromptOpen);
    const [lastSeenReleaseNotesVersion, setLastSeenReleaseNotesVersion] = useState(readLastSeenReleaseNotesVersion);
    const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
    const appVersion = typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__;

    // Dev shortcut (devLaunchFlags.ts): nothing opens and nothing is marked seen, so turning it off brings the sequence back.
    const nextStep = skipsStartupExperience ? null : resolveStartupExperienceStep({
        isCurrentRelease: Boolean(appVersion && USER_GUIDE_AUTO_OPEN_VERSION === appVersion),
        hasSeenPonder: lastSeenPonderVersion !== null,
        hasFinishedThisRelease: Boolean(appVersion && lastSeenPonderVersion === appVersion),
        hasSeenReleaseNotes: Boolean(appVersion && lastSeenReleaseNotesVersion === appVersion),
        isReleaseNotesOpen,
        hasChosenPlaybackEntryView,
        needsLibrarySuitePrompt,
        isPlaybackEntryViewPromptOpen,
        isPonderOnboardingOpen,
    });

    useEffect(() => {
        if (nextStep === 'release-notes') {
            setIsReleaseNotesOpen(true);
        } else if (nextStep === 'playback-entry-view') {
            requestPlaybackEntryViewPrompt({ withLibrarySuite: hasOnboardingLibrarySuiteChoice() });
        } else if (nextStep === 'ponder') {
            setIsPonderOnboardingOpen(true);
        }
    }, [nextStep, setIsPonderOnboardingOpen]);

    const closeReleaseNotes = useCallback(() => {
        if (appVersion) {
            localStorage.setItem(LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY, appVersion);
            setLastSeenReleaseNotesVersion(appVersion);
        }
        setIsReleaseNotesOpen(false);
    }, [appVersion]);

    return { isReleaseNotesOpen, closeReleaseNotes };
};
