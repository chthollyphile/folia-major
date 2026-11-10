import { ARTIST_INTRO_ATTR, GRID_CARD_ITEM_ID_ATTR } from './gridMorphContract';
import { collectionMorphEntranceTravel, collectionMorphSeed } from './morphGeometry';

// src/library/suites/grid/transitions/morphScatter.ts
// The other cards of a page that is left: while one card flies back, the rest are pushed out from
// it, each along its own direction, a short way, and the page's own fade takes them. It goes the
// way the cards' entrance came, as far and about as long; unlike the entrance, each card is
// tilted a little as it goes.
//
// The page's real cards are moved, where they stand, by `translate`, `rotate` and `scale`: the
// properties of their own that add to whatever `transform` the grid has put on them, and that the
// compositor animates. Nothing is copied and nothing is laid out again.

/** How long a card is pushed for. */
export const SCATTER_MS = 420;
/** The card farthest from the one that flies starts this much after the nearest. */
const STAGGER_MS = 70;
const SCALE = 0.92;
/** The cards nearest the one that flies; a page seldom shows as many, and the rest go with the fade. */
const MOST = 60;

export interface ScatterPush {
    x: number;
    y: number;
    rotate: number;
    delay: number;
}

/**
 * The push of the card at `card`, out from `origin` by `reach`. `farthest` is the distance of the
 * farthest card pushed; `seed` (0 to 1) is the card's own, and turns it a little one way or the other.
 */
export const scatterPush = (
    card: { x: number; y: number },
    origin: { x: number; y: number },
    reach: number,
    farthest: number,
    seed: number,
): ScatterPush => {
    const dx = card.x - origin.x;
    const dy = card.y - origin.y;
    const distance = Math.hypot(dx, dy);
    const direction = distance > 1 ? { x: dx / distance, y: dy / distance } : { x: 0, y: -1 };
    return {
        x: direction.x * reach,
        y: direction.y * reach,
        rotate: (seed < 0.5 ? -1 : 1) * (1.6 + ((seed * 7) % 1) * 1.6),
        // The cards next to the one that flies go first: a wave outward.
        delay: Math.min(distance / Math.max(farthest, 1), 1) * STAGGER_MS,
    };
};

/**
 * Pushes the cards under `root` that are on the screen out from `origin`, but `except` (the card
 * that flies). Their page is leaving, so nothing is put back: the cards go with it.
 */
export const scatterCards = (root: ParentNode, origin: { x: number; y: number }, except: Element | null): Animation[] => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const cards = [...root.querySelectorAll<HTMLElement>(`[${GRID_CARD_ITEM_ID_ATTR}], [${ARTIST_INTRO_ATTR}]`)]
        .filter(card => !except || (card !== except && !card.contains(except) && !except.contains(card)))
        .map((card) => {
            const rect = card.getBoundingClientRect();
            const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            return { card, rect, centre, distance: Math.hypot(centre.x - origin.x, centre.y - origin.y) };
        })
        .filter(({ rect }) => rect.width >= 1 && rect.right > 0 && rect.left < viewport.width && rect.bottom > 0 && rect.top < viewport.height)
        .sort((left, right) => left.distance - right.distance)
        .slice(0, MOST);
    const reach = collectionMorphEntranceTravel(viewport);
    const farthest = Math.max(1, ...cards.map(({ distance }) => distance));
    return cards.map(({ card, centre }) => {
        const seed = collectionMorphSeed(card.getAttribute(GRID_CARD_ITEM_ID_ATTR) ?? `${Math.round(centre.x)}:${Math.round(centre.y)}`);
        const push = scatterPush(centre, origin, reach, farthest, seed);
        return card.animate(
            [
                { translate: '0px 0px', rotate: '0deg', scale: '1' },
                { translate: `${push.x.toFixed(1)}px ${push.y.toFixed(1)}px`, rotate: `${push.rotate.toFixed(2)}deg`, scale: String(SCALE) },
            ],
            { duration: SCATTER_MS, delay: push.delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
        );
    });
};
