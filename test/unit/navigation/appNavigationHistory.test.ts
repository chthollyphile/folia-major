import { describe, expect, it } from 'vitest';
import {
    isStartupLatticeDeferred,
    resolveStartupView,
    resolvePlayerCapsuleNavigationTarget,
    shouldNavigatePlayerBackThroughHistory,
    shouldReplacePlayerNavigation,
    type NavigationHistoryState,
} from '@/hooks/useAppNavigation';

// test/unit/navigation/appNavigationHistory.test.ts
// Guards player-back behavior so collection pages are popped instead of duplicated.

const state = (
    view: NavigationHistoryState['view'],
    appHistoryIndex: number,
): NavigationHistoryState => ({
    view,
    appHistoryIndex,
    search: null,
    collection: null,
});

describe('player navigation history', () => {
    it('returns through browser history when the player was opened from an app page', () => {
        expect(shouldNavigatePlayerBackThroughHistory(state('player', 2))).toBe(true);
    });

    it('uses the direct-home fallback for a player startup entry', () => {
        expect(shouldNavigatePlayerBackThroughHistory(state('player', 0))).toBe(false);
    });

    it('does not treat a home entry as player back navigation', () => {
        expect(shouldNavigatePlayerBackThroughHistory(state('home', 2))).toBe(false);
    });

    it('replaces the current entry when navigating to an already active player', () => {
        expect(shouldReplacePlayerNavigation(state('player', 2))).toBe(true);
    });

    it('pushes a new entry when opening the player from home', () => {
        expect(shouldReplacePlayerNavigation(state('home', 2))).toBe(false);
    });
});

describe('player capsule navigation', () => {
    it('opens Lattice from any non-Lattice page when it is the configured entry view', () => {
        expect(resolvePlayerCapsuleNavigationTarget('home', 'lattice')).toBe('lattice');
        expect(resolvePlayerCapsuleNavigationTarget('player', 'lattice')).toBe('lattice');
    });

    it('does not navigate away when the progress bar already belongs to Lattice', () => {
        expect(resolvePlayerCapsuleNavigationTarget('lattice', 'lattice')).toBeNull();
    });
});

describe('startup view resolution', () => {
    const base = { openPlayerOnLaunch: true, playbackEntryView: 'player' as const, queueLength: 3 };

    it('opens home when the setting is off, whatever the entry preference is', () => {
        expect(resolveStartupView({ ...base, openPlayerOnLaunch: false, playbackEntryView: 'lattice' })).toBe('home');
    });

    it('opens the player when the preference is player', () => {
        expect(resolveStartupView(base)).toBe('player');
    });

    it('opens Lattice when the preference is Lattice and the queue has songs', () => {
        expect(resolveStartupView({ ...base, playbackEntryView: 'lattice' })).toBe('lattice');
    });

    it('falls back to the player on an empty queue', () => {
        expect(resolveStartupView({ ...base, playbackEntryView: 'lattice', queueLength: 0 })).toBe('player');
    });

    it('marks only a Lattice launch as deferrable', () => {
        expect(isStartupLatticeDeferred({ openPlayerOnLaunch: true, playbackEntryView: 'lattice' })).toBe(true);
        expect(isStartupLatticeDeferred({ openPlayerOnLaunch: true, playbackEntryView: 'player' })).toBe(false);
        expect(isStartupLatticeDeferred({ openPlayerOnLaunch: false, playbackEntryView: 'lattice' })).toBe(false);
    });
});
