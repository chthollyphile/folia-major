// src/components/app/presentation/buildHomeSurfacePresentation.ts

type BuildHomeSurfacePresentationInput = {
    currentView: string;
    isSettingsModalOpen: boolean;
    isPanelOpen: boolean;
};

// Derives independent mount and visibility state for the Home surface.
export const buildHomeSurfacePresentation = ({
    currentView,
    isSettingsModalOpen,
    isPanelOpen,
}: BuildHomeSurfacePresentationInput) => {
    // Overlays may hide Home while it is active, but must not remount it from the player view.
    const shouldKeepHomeMounted = currentView === 'home';
    const shouldShowHomeSurface = currentView === 'home' && !isSettingsModalOpen && !isPanelOpen;

    return {
        shouldKeepHomeMounted,
        shouldShowHomeSurface,
    };
};
