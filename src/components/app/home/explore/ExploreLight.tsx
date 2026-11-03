import React, { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';

// src/components/app/home/explore/ExploreLight.tsx
// The page's one light. It lies under the list, is made of the picture of the entry that is
// pointed at (or that the keyboard is on) and drifts to that entry; left alone it stays with the
// entry it was last called to, and before anything was pointed at it lies under the page's first one.
// It is meant to be felt rather than seen: wide, faint, without an edge, and slow to move.
// The entries know nothing of it. It stands behind the list, as large as the list's window, and
// finds the entries by `data-explore-card` from the list's own events; where it lies is kept as a
// place in what the list holds, and the list's scroll is taken from it, so it goes up with the list.
// Towards the window's edges it fades out: the window would cut it on a straight line otherwise.

/** How strong the light is at its middle, of 1. The one number to turn it up or down by. */
const STRENGTH = 0.2;
/** Slow and without overshoot: at rest after about a second and a half. */
const DRIFT = { stiffness: 60, damping: 20, mass: 1 };
/** Seconds the light takes to become another picture's. */
const TURN = 0.9;
// A grain over the light, so that so faint a fall of it shows no steps.
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>'
    + '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>',
)}")`;
// How the light falls off from its middle to nothing at its edge: as a bell does, not as a cone.
const FALL = 'radial-gradient(closest-side, black, rgb(0 0 0 / 0.55) 40%, rgb(0 0 0 / 0.18) 70%, transparent)';
// How the whole of it fades out towards the edges of the list's window, within this many pixels of them.
const EDGE = 96;
const EDGES = `linear-gradient(to bottom, transparent, black ${EDGE}px, black calc(100% - ${EDGE}px), transparent), linear-gradient(to right, transparent, black ${EDGE}px, black calc(100% - ${EDGE}px), transparent)`;

/** `list` is the element that scrolls the entries; the light is put before it, into the element both fill. */
export const ExploreLight: React.FC<{ list: RefObject<HTMLElement | null> }> = ({ list }) => {
    const calm = useReducedMotionFor('uiMicroMotion');
    const [picture, setPicture] = useState('');
    // Where the light lies in what the list holds, and how far the list is scrolled.
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const scrolled = useMotionValue(0);
    const driftX = useSpring(x, DRIFT);
    const driftY = useSpring(y, DRIFT);
    const shownY = useTransform([driftY, scrolled], ([at, by]: number[]) => at - by);

    useEffect(() => {
        const holder = list.current;
        if (!holder) return undefined;
        // The entry the light lies under.
        let lit: Element | null = null;
        // Puts the light under `entry`, or under the page's first one where that one is gone.
        const aim = (entry: Element | null) => {
            const next = entry?.isConnected ? entry : holder.querySelector('[data-explore-card]');
            if (!next) {
                // A page without an entry has no light.
                lit = null;
                setPicture('');
                return;
            }
            const image = next.querySelector('img');
            const box = (image ?? next).getBoundingClientRect();
            const frame = holder.getBoundingClientRect();
            x.set(box.left + box.width / 2 - frame.left + holder.scrollLeft);
            y.set(box.top + box.height / 2 - frame.top + holder.scrollTop);
            // It is there from the start, and with reduced motion wherever it is put.
            if (!lit || calm) {
                driftX.jump(x.get());
                driftY.jump(y.get());
            }
            lit = next;
            setPicture(image?.currentSrc || image?.src || '');
        };
        const follow = (event: Event) => {
            const over = event.target instanceof Element ? event.target.closest('[data-explore-card]') : null;
            if (over && over !== lit) aim(over);
        };
        const scroll = () => scrolled.set(holder.scrollTop);
        // The entry it lies under moves with the page (a section opens above it, the window is another
        // size) or leaves it (another read).
        const keep = () => aim(lit);
        const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keep);
        resized?.observe(holder);
        if (holder.firstElementChild) resized?.observe(holder.firstElementChild);
        const changed = new MutationObserver(keep);
        changed.observe(holder, { childList: true, subtree: true });
        holder.addEventListener('pointerover', follow);
        holder.addEventListener('focusin', follow);
        holder.addEventListener('scroll', scroll, { passive: true });
        scroll();
        keep();
        return () => {
            resized?.disconnect();
            changed.disconnect();
            holder.removeEventListener('pointerover', follow);
            holder.removeEventListener('focusin', follow);
            holder.removeEventListener('scroll', scroll);
        };
    }, [calm, driftX, driftY, list, scrolled, x, y]);

    return (
        <div
            aria-hidden
            data-explore-light
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ maskImage: EDGES, WebkitMaskImage: EDGES, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }}
        >
            <motion.div className="absolute left-0 top-0" style={{ x: driftX, y: shownY }}>
                <AnimatePresence>
                    {picture && (
                        <motion.span
                            key={picture}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: STRENGTH }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: calm ? 0.14 : TURN, ease: 'easeInOut' }}
                            // Its middle is where the layer above was moved to.
                            className="absolute -left-[440px] -top-[330px] block h-[660px] w-[880px]"
                            style={{ maskImage: FALL, WebkitMaskImage: FALL }}
                        >
                            <img src={picture} alt="" draggable={false} className="h-full w-full object-cover blur-[100px] saturate-150" />
                            <span className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: GRAIN }} />
                        </motion.span>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};
