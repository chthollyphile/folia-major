import { describe, expect, it } from 'vitest';
import { resolveOverlayPopState, resolveOverlayPushState } from '@/hooks/useAppNavigation';

describe('useAppNavigation state helpers', () => {
    it('keeps overlays in the home view when opening from home', () => {
        expect(resolveOverlayPushState('home', 0, null)).toEqual({
            view: 'home',
            overlayView: 'home',
            overlayOriginView: 'home',
        });
    });

    it('keeps overlays in the home view when opening from player and remembers the origin', () => {
        expect(resolveOverlayPushState('player', 0, null)).toEqual({
            view: 'home',
            overlayView: 'home',
            overlayOriginView: 'player',
        });
    });

    it('restores the previous overlay in home instead of player when popping nested overlays', () => {
        expect(resolveOverlayPopState(1, 'home')).toEqual({
            view: 'home',
            overlayView: 'home',
            overlayOriginView: 'home',
        });
    });

    it('returns to the remembered origin after the last overlay closes', () => {
        expect(resolveOverlayPopState(0, 'player')).toEqual({
            view: 'player',
            overlayView: null,
            overlayOriginView: null,
        });
    });
});
