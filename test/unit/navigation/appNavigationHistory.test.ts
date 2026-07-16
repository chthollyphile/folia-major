import { describe, expect, it } from 'vitest';
import {
    shouldNavigatePlayerBackThroughHistory,
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
});
