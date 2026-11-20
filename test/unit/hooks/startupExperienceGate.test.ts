import { describe, expect, it } from 'vitest';
import { resolveStartupExperienceStep } from '../../../src/hooks/useStartupExperienceGate';

// test/unit/hooks/startupExperienceGate.test.ts

const readyState = {
    isCurrentRelease: true,
    hasSeenPonder: false,
    hasFinishedThisRelease: false,
    hasSeenReleaseNotes: false,
    isReleaseNotesOpen: false,
    hasChosenPlaybackEntryView: false,
    needsLibrarySuitePrompt: false,
    needsSourcesPrompt: false,
    isPlaybackEntryViewPromptOpen: false,
    isPonderOnboardingOpen: false,
};

describe('startup experience gate', () => {
    it('orders release notes, playback entry choice, then Ponder onboarding', () => {
        expect(resolveStartupExperienceStep(readyState)).toBe('release-notes');

        expect(resolveStartupExperienceStep({
            ...readyState,
            hasSeenReleaseNotes: true,
        })).toBe('playback-entry-view');

        expect(resolveStartupExperienceStep({
            ...readyState,
            hasSeenReleaseNotes: true,
            hasChosenPlaybackEntryView: true,
        })).toBe('ponder');
    });

    it('waits for each blocking surface to close before advancing', () => {
        expect(resolveStartupExperienceStep({
            ...readyState,
            isReleaseNotesOpen: true,
        })).toBeNull();

        expect(resolveStartupExperienceStep({
            ...readyState,
            hasSeenReleaseNotes: true,
            hasChosenPlaybackEntryView: true,
            isPlaybackEntryViewPromptOpen: true,
        })).toBeNull();
    });

    it('does nothing once the sequence has finished for this release', () => {
        expect(resolveStartupExperienceStep({
            ...readyState,
            hasSeenPonder: true,
            hasFinishedThisRelease: true,
        })).toBeNull();
    });

    it('shows Ponder only once per install, while each release still gets its notes', () => {
        const upgraded = { ...readyState, hasChosenPlaybackEntryView: true, hasSeenPonder: true };
        expect(resolveStartupExperienceStep(upgraded)).toBe('release-notes');
        expect(resolveStartupExperienceStep({ ...upgraded, hasSeenReleaseNotes: true })).toBeNull();
    });

    it('stays quiet on builds without release notes', () => {
        expect(resolveStartupExperienceStep({ ...readyState, isCurrentRelease: false })).toBeNull();
    });

    // 2026-10-10：「资料库界面」那一页每个安装都问一次，不看版本（发版说明的版本号每版都变，不能拿来门控它）。
    it('asks for the library interface once on every install, whatever the release', () => {
        const owed = { ...readyState, needsLibrarySuitePrompt: true };
        // 发版说明照旧排在前面。
        expect(resolveStartupExperienceStep(owed)).toBe('release-notes');
        expect(resolveStartupExperienceStep({ ...owed, hasSeenReleaseNotes: true })).toBe('playback-entry-view');
        // 答过旧版单页提问、这一版的流程也走完了的老安装：仍然问一次。
        const answered = { ...owed, hasSeenReleaseNotes: true, hasChosenPlaybackEntryView: true, hasSeenPonder: true, hasFinishedThisRelease: true };
        expect(resolveStartupExperienceStep(answered)).toBe('playback-entry-view');
        // 不是自动弹发版说明的那一版也问。
        expect(resolveStartupExperienceStep({ ...owed, isCurrentRelease: false, hasChosenPlaybackEntryView: true })).toBe('playback-entry-view');
        // 问过就不再问；开着时等它关。
        expect(resolveStartupExperienceStep({ ...answered, needsLibrarySuitePrompt: false })).toBeNull();
        expect(resolveStartupExperienceStep({ ...answered, isPlaybackEntryViewPromptOpen: true })).toBeNull();
    });

    // Folium 2.0 S8：全新安装欠「你用哪些平台听歌」那一页，不看版本；答过（主进程记成 done）就不欠了。
    it('opens the prompt for a fresh profile that owes the sources page, whatever the release', () => {
        const owed = { ...readyState, needsSourcesPrompt: true };
        expect(resolveStartupExperienceStep(owed)).toBe('release-notes');
        expect(resolveStartupExperienceStep({ ...owed, hasSeenReleaseNotes: true })).toBe('playback-entry-view');
        expect(resolveStartupExperienceStep({ ...owed, isCurrentRelease: false, hasChosenPlaybackEntryView: true })).toBe('playback-entry-view');
        const answered = { ...owed, hasSeenReleaseNotes: true, hasChosenPlaybackEntryView: true, hasSeenPonder: true, hasFinishedThisRelease: true };
        expect(resolveStartupExperienceStep(answered)).toBe('playback-entry-view');
        expect(resolveStartupExperienceStep({ ...answered, isPlaybackEntryViewPromptOpen: true })).toBeNull();
        expect(resolveStartupExperienceStep({ ...answered, needsSourcesPrompt: false })).toBeNull();
    });
});
