import type { Variants } from 'framer-motion';

// src/components/app/lattice/tileMotion.ts
// The motion every tile of the wall shares, a poster (LatticePoster) and a section's heading
// (LatticeHeading) alike: how high above its slot a landing tile starts, and how a tile leaves
// when the whole wall leaves the window.

// How far above its slot a landing tile starts, in world units.
export const ENTRANCE_LIFT = 90;

// Resolved at exit time from the card's own `custom`, so the leaving wave reads the live camera.
export const LEAVING: Variants = {
    leaving: (resolve: () => { y: number; delay: number | null }) => {
        const { y, delay } = resolve();
        // No wave: the wall fades as a whole (wallLayer.ts). The card stays as it is, and its
        // exit is over at once.
        if (delay === null) return { transition: { duration: 0 } };
        return { y, opacity: 0, scale: 0.88, scaleX: 1, scaleY: 1,
            transition: { duration: 0.28, delay, ease: [0.4, 0, 1, 1] } };
    },
};
