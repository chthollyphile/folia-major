import { describe, expect, it } from 'vitest';
import { resolvePlayerEscapeAction } from '@/components/app/playback/bridges/usePlaybackInteractionBridge';

// test/unit/playback/playbackEscapeNavigation.test.ts

const resolveAction = (overrides: Partial<Parameters<typeof resolvePlayerEscapeAction>[0]> = {}) => (
    resolvePlayerEscapeAction({
        currentView: 'player',
        hasBlockingWindow: false,
        isFullscreen: false,
        isPanelOpen: false,
        isRepeat: false,
        ...overrides,
    })
);

describe('player Escape navigation', () => {
    it('lets the browser consume Escape while fullscreen instead of navigating back', () => {
        expect(resolveAction({ isFullscreen: true })).toBe('allow-fullscreen-exit');
    });

    it('closes the player panel before navigating back', () => {
        expect(resolveAction({ isPanelOpen: true })).toBe('close-panel');
    });

    it('navigates back from an unobstructed player page', () => {
        expect(resolveAction()).toBe('navigate-back');
    });

    it('ignores Escape outside the player or behind a blocking window', () => {
        expect(resolveAction({ currentView: 'home' })).toBe('ignore');
        expect(resolveAction({ hasBlockingWindow: true })).toBe('ignore');
    });

    it('ignores repeated Escape events', () => {
        expect(resolveAction({ isRepeat: true })).toBe('ignore');
    });
});
