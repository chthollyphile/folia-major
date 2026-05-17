// src/components/app/navigation/createPanelNavigation.ts

// Creates panel-specific navigation handlers that only depend on top-level app routing.
export const createPanelNavigation = (navigateDirectHome: () => void) => {
    return {
        handleDirectHomeFromPanel: () => {
            navigateDirectHome();
        },
    };
};
