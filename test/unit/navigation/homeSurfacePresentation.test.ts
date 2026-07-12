import { describe, expect, it } from 'vitest';
import { buildHomeSurfacePresentation } from '../../../src/components/app/presentation/buildHomeSurfacePresentation';

// test/unit/navigation/homeSurfacePresentation.test.ts

describe('buildHomeSurfacePresentation', () => {
    it('shows Home only on an unobstructed home view', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'home',
            isSettingsModalOpen: false,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: true,
            shouldShowHomeSurface: true,
        });
    });

    it('does not remount Home behind player panel overlays', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'player',
            isSettingsModalOpen: false,
            isPanelOpen: true,
        })).toEqual({
            shouldKeepHomeMounted: false,
            shouldShowHomeSurface: false,
        });
    });

    it('does not remount Home behind settings opened from the player view', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'player',
            isSettingsModalOpen: true,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: false,
            shouldShowHomeSurface: false,
        });
    });

    it('does not reveal Home while player view waits for delayed unmount', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'player',
            isSettingsModalOpen: false,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: false,
            shouldShowHomeSurface: false,
        });
    });

    it('hides Home while home overlays are open', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'home',
            isSettingsModalOpen: true,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: true,
            shouldShowHomeSurface: false,
        });
    });
});
