import type { LayerTransition } from './layerTransition';

// src/components/visualizer/styleTransition/softFocus.ts
// Soft focus: the old style (or background) drifts forward and blurs away; the new one comes out of
// the same blur and settles into place. Both stay at or above full size, so an edge never shows.
const softFocus: LayerTransition = {
    leave: {
        to: { opacity: 0, filter: 'blur(8px)', transform: 'scale(1.02)' },
        duration: 360,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
    },
    enter: {
        from: { opacity: 0, filter: 'blur(8px)', transform: 'scale(1.02)' },
        delay: 80,
        duration: 520,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
};

export default softFocus;
