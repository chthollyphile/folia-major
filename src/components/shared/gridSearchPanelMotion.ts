// Builds the shared top-down search entrance used by every grid surface.
export const gridSearchPanelMotion = {
    initial: {
        opacity: 0,
        y: -64,
    },
    animate: {
        opacity: 1,
        y: 0,
    },
    exit: {
        opacity: 0,
        y: -32,
    },
    transition: {
        duration: 0.34,
        ease: [0.16, 1, 0.3, 1],
    },
};
