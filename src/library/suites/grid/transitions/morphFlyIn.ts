import type { CollectionMorphFlyIn } from './morphGeometry';

// src/library/suites/grid/transitions/morphFlyIn.ts
// A card's entrance on a collection page that opens: it settles into its slot from a short push
// out from the centred card. How far out it starts and how long it waits is morphGeometry's
// `collectionMorphFlyIn`; this file makes the animation of it and plays it.
//
// The card is moved by its own `translate`, `scale` and `opacity` in a Web Animation, which the
// compositor runs. The main thread may be held while the cards come in (the page goes on
// rendering, and so does the rest of the app), and an entrance driven from script stands still
// for as long as it is. `translate` and `scale` add to whatever `transform` is on the card, so
// that property stays framer's.

/** How long a card takes to settle. */
const FLY_IN_MS = 500;
/**
 * One eased tween for every card, not a spring each: the grid lands together, and no card
 * overshoots its slot.
 */
const FLY_IN_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** The size a card comes in at. */
const FLY_IN_SCALE = 0.94;

export interface FlyInAnimation {
    keyframes: Keyframe[];
    timing: KeyframeAnimationOptions;
}

/**
 * The entrance of a card pushed out by `flyIn`: from there, see-through and a little small, to
 * its slot. The card keeps the first keyframe through its delay, so it is never seen at rest
 * before it has come in; once it is in, the animation lets go of it.
 */
export const flyInAnimation = (flyIn: CollectionMorphFlyIn): FlyInAnimation => ({
    keyframes: [
        { opacity: 0, translate: `${flyIn.x.toFixed(1)}px ${flyIn.y.toFixed(1)}px`, scale: String(FLY_IN_SCALE) },
        { opacity: 1, translate: '0px 0px', scale: '1' },
    ],
    timing: { duration: FLY_IN_MS, delay: flyIn.delay * 1000, easing: FLY_IN_EASING, fill: 'backwards' },
});

const played = new WeakSet<Element>();

/**
 * Plays a card's entrance. It is the card's ref: called in the commit that mounts the card, so
 * no frame shows the card at rest first. A card has one entrance: a ref is given again when the
 * card is rendered again, and nothing is restarted then.
 */
export const playFlyIn = (card: HTMLElement | null, flyIn: CollectionMorphFlyIn): void => {
    if (!card || played.has(card)) return;
    played.add(card);
    const { keyframes, timing } = flyInAnimation(flyIn);
    card.animate(keyframes, timing);
};
