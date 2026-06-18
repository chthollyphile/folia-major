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
    const shouldKeepHomeMounted = currentView === 'home' || isSettingsModalOpen || isPanelOpen;
    const shouldShowHomeSurface = currentView === 'home' && !isSettingsModalOpen && !isPanelOpen;

    return {
        shouldKeepHomeMounted,
        shouldShowHomeSurface,
    };
};
