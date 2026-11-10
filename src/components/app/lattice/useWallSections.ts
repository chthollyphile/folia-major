import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import type { WallLayout } from './wallLayout';
import type { LatticeCamera } from '../../wall/useWallCameraPan';

// src/components/app/lattice/useWallSections.ts
// Finding one's way on the explore wall: which section the window stands in, and
// the way to a section, whose heading is put at the corner the wall opens with. The queue wall
// has no sections, and none of this does anything there.
// The section is looked up at every camera move against a ref; React hears of it only when the
// point looked up enters a lot of another section, never per frame.

type WallSectionsOptions = {
    layout: WallLayout;
    cameraRef: MutableRefObject<LatticeCamera>;
    viewportRef: MutableRefObject<{ width: number; height: number }>;
    /** The pan under way, if any (useWallCameraPan). */
    animationRef: MutableRefObject<{ stop: () => void } | null>;
    panTo: (rect: { x: number; y: number; width: number; height: number }, instant?: boolean) => void;
    /** Where in the window a section's heading is put, in window pixels. Must keep its identity. */
    corner: { x: number; y: number };
};

export const useWallSections = ({ layout, cameraRef, viewportRef, animationRef, panTo, corner }: WallSectionsOptions) => {
    const count = layout.sections.length;
    const [section, setSection] = useState<number | null>(null);
    const sectionRef = useRef<number | null>(null);
    // The flight to a section the wall was sent to, for as long as it is under way.
    const flightRef = useRef<{ stop: () => void } | null>(null);
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // Called with every camera the wall applies. Names the section under one point of the window
    // (below); on a street between lots the section named stays.
    const watchCamera = useCallback((camera: LatticeCamera) => {
        const current = layoutRef.current;
        const lot = current.lotSize;
        if (!lot || current.sections.length === 0) return;
        const flight = flightRef.current;
        if (flight) {
            // On its way to a section the window crosses others: the one named is the one it goes to.
            if (animationRef.current === flight) return;
            flightRef.current = null;
            // It has landed. (Or was stopped on its way: the next move looks again.)
            if (animationRef.current === null) return;
        }
        const viewport = viewportRef.current;
        // The window's middle, but no further from the corner than the middle of a lot that stands
        // there: in a window some two lots wide or high the window's middle is on the lot beside
        // the one a flight has just put at the corner, and the first move after would name it.
        const found = current.sectionAt({
            x: (Math.min(viewport.width / 2, corner.x + lot.width * camera.scale / 2) - camera.x) / camera.scale,
            y: (Math.min(viewport.height / 2, corner.y + lot.height * camera.scale / 2) - camera.y) / camera.scale,
        });
        if (found === null || found === sectionRef.current) return;
        sectionRef.current = found;
        setSection(found);
    }, [animationRef, corner, viewportRef]);

    // Another layout may stand another section where the window is.
    useEffect(() => {
        watchCamera(cameraRef.current);
    }, [cameraRef, layout, watchCamera]);

    // Takes the camera to the nearest copy of a section's first lot, its heading at `corner`:
    // a flight, or a jump with the wall's motion reduced (`panTo` knows).
    const goToSection = useCallback((target: number) => {
        const current = layoutRef.current;
        const camera = cameraRef.current;
        const viewport = viewportRef.current;
        // Nearest to the point of the wall that is at the corner now: the shortest way for the camera.
        const start = current.sectionStart(target, {
            x: (corner.x - camera.x) / camera.scale,
            y: (corner.y - camera.y) / camera.scale,
        });
        if (!start) return;
        // `panTo` centres a rectangle: the window's own, as it stands with the heading at the corner.
        panTo({
            x: start.x - corner.x / camera.scale,
            y: start.y - corner.y / camera.scale,
            width: viewport.width / camera.scale,
            height: viewport.height / camera.scale,
        });
        flightRef.current = animationRef.current;
        sectionRef.current = target;
        setSection(target);
        console.log(`[Lattice] Explore wall goes to section ${target + 1} of ${current.sections.length}`);
    }, [animationRef, cameraRef, corner, panTo, viewportRef]);

    // PageDown and PageUp go to the next and the previous section, round the page. Answers
    // whether the key was one of the two and is dealt with.
    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): boolean => {
        const total = layoutRef.current.sections.length;
        if (total === 0 || (event.key !== 'PageDown' && event.key !== 'PageUp')) return false;
        if (event.altKey || event.ctrlKey || event.metaKey) return false;
        // Nested playback controls own their keys (the seek bar pages by these two).
        if (event.target instanceof Element && event.target.closest('.lattice-poster-controls')) return false;
        event.preventDefault();
        event.stopPropagation();
        // One press, one section: a key held down does not run through the page.
        if (event.repeat) return true;
        const from = sectionRef.current !== null && sectionRef.current < total ? sectionRef.current : 0;
        goToSection((from + (event.key === 'PageDown' ? 1 : total - 1)) % total);
        return true;
    }, [goToSection]);

    return {
        /** The section to name: the one the window stands in, the first until it has been in one. Null on a wall without sections. */
        section: count === 0 ? null : section !== null && section < count ? section : 0,
        watchCamera,
        goToSection,
        handleKeyDown,
    };
};
