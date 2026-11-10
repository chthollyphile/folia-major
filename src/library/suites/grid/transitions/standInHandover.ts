import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { HANDOVER_MS } from './morphFlight';
import type { CollectionMorphRect } from './morphGeometry';
import { picturesLookAlike } from './samePicture';

// src/library/suites/grid/transitions/standInHandover.ts
// How a page's stand-in gives way to the card it stood for. A page that a card flies to shows a
// stand-in at its centre, with the picture and the title that flew. The card whose place that is
// (the "hero": the page's centred card, its first track) comes later, with the page's tracks, and
// shows a picture of its own.
//
// The stand-in turns over into the hero, the way the grid's own cards come and go: it turns away
// about its vertical axis until it is edge-on, and the hero turns in from edge-on, one half-turn
// in all. The hero is held out of sight until then, and the turn waits for four things: the
// flight to the stand-in has landed and its carrier has dissolved; the hero is on the page; the
// hero's own picture has loaded (or failed), so that the card does not turn in with an empty
// plate; and it is known whether that picture is the stand-in's. The last two are waited for
// only so long.
//
// Nothing turns where there is nothing to be seen turning. A hero that shows the stand-in's own
// picture (an album: every track carries the album's; a playlist whose cover is its first
// track's) is shown beneath the stand-in, which fades; so is one that is not where the stand-in
// is (the grid was dragged meanwhile). A page with no hero just has its stand-in fade.
// Whether the two pictures are one is told from their addresses where those say so, and from
// the pictures themselves where they do not (samePicture.ts): one picture has many addresses.
//
// Only `rotate` and `opacity` are animated, as Web Animations, which the compositor carries
// while the page's cards mount on the main thread. `rotate` and not `transform`: framer-motion
// writes `transform` on the hero's element.

/** The stand-in turns away in this long; the hero then turns in in this long. */
const TURN_AWAY_MS = 140;
const TURN_IN_MS = 260;
/**
 * The stand-in gives way this long after the flight to it has landed: half the carrier's
 * dissolve. The carrier is all but gone by then, and a turn begins slowly; waiting the dissolve
 * out would leave the card standing still between its flight and its turn.
 */
const GIVES_WAY_AFTER_MS = HANDOVER_MS / 2;
/** A stand-in that does not turn fades in this long: over its hero, or with none to show. */
const FADE_OVER_HERO_MS = 140;
const FADE_ALONE_MS = 260;
/** The hero's picture is waited for this long at most, from the hero's coming. */
const PICTURE_WAIT_MS = 1200;
/**
 * Once the hero's picture is there, the word on whether it is the stand-in's is waited for this
 * much longer at most. Where neither picture has to be fetched to be read, the word takes 18 to
 * 38 ms (measured with pictures given as data, on a page mounting 79 cards; how long a picture
 * out of the browser's cache takes was not measured). A word that takes longer does not hold
 * the stand-in up: one that is in by the time the stand-in gives way is still heeded, and
 * without it the stand-in turns as for another picture.
 */
const LIKENESS_WAIT_MS = 150;
/** A hero whose centre is further than this from the stand-in's is not where the stand-in is. */
const SAME_PLACE_PX = 8;

/**
 * A cover URL without the part that asks for a size: what the pictures of one artwork have in
 * common, whichever card asked for them.
 */
const artworkOf = (url: string): string => {
    // A YouTube still is named by its size (hqdefault, mqdefault); what it shows is the video.
    const still = /^https?:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([^/?#]+)\//.exec(url);
    if (still) {
        return `ytimg:${still[1]}`;
    }
    // Google's picture hosts (YouTube Music's covers) take the size as an ending: `=w226-h226-l90-rj`, `=s576`.
    if (/^https?:\/\/[^/]+\.(?:googleusercontent|ggpht)\.com\//.test(url)) {
        return url.replace(/=[swh]\d[^=/]*$/, '');
    }
    // The providers the app resizes for: asked for one size, two URLs of one picture are one URL.
    // NetEase serves a picture from any of its hosts (p1, p2, ...), over http or https.
    return getSizedCoverUrl(url, 512)
        .replace(/^http:/, 'https:')
        .replace(/^https:\/\/p\d+\.music\.126\.net\//, 'https://p.music.126.net/');
};

/** Whether two cover URLs show one artwork, at whatever sizes. False where either is missing. */
export const sameArtwork = (a: string | null | undefined, b: string | null | undefined): boolean => (
    Boolean(a && b) && artworkOf(a!) === artworkOf(b!)
);

/**
 * How the stand-in gives way: it turns over into the hero; or plainly, fading over a hero that
 * shows the same picture or is somewhere else; or alone, where there is no hero.
 */
export type StandInHandoverKind = 'turn' | 'plain' | 'alone';

/** `standIn` and `hero` are where the two cards are on the screen; `hero` is null where there is none. */
export const standInHandoverKind = (
    standIn: CollectionMorphRect,
    hero: CollectionMorphRect | null,
    showsSamePicture: boolean,
): StandInHandoverKind => {
    if (!hero) {
        return 'alone';
    }
    const apart = Math.hypot(
        hero.x + hero.width / 2 - (standIn.x + standIn.width / 2),
        hero.y + hero.height / 2 - (standIn.y + standIn.height / 2),
    );
    return apart > SAME_PLACE_PX || showsSamePicture ? 'plain' : 'turn';
};

/** The address of the picture a card shows, or null for a card that shows none. */
const pictureOf = (card: HTMLElement | null): string | null => {
    const picture = card?.querySelector('img');
    return picture ? picture.currentSrc || picture.getAttribute('src') : null;
};

// The animations of the handover that last began to give way: what `settleStandInHandover` ends.
let givingWay: Animation[] = [];

/**
 * Brings a handover that is under way to its end at once: the stand-in edge-on (and so gone),
 * the hero flat. For whoever is about to measure the page's centred card: a card measured in
 * mid-turn is a sliver. One that has not begun to give way is left as it is (its stand-in is
 * the centred card, whole).
 */
export const settleStandInHandover = (): void => {
    for (const animation of givingWay) {
        // Not one that was cancelled: finishing that would start it again.
        if (animation.playState === 'running') animation.finish();
    }
};

export interface StandInHandover {
    /** The flight to the stand-in has landed. Said again, it changes nothing. */
    land: () => void;
    /**
     * Ends a handover that is not over, and leaves nothing held or turned. Once the stand-in
     * has gone (`onOver`) there is nothing to end: what is left of the hero's turn runs out by
     * itself.
     */
    cancel: () => void;
}

/**
 * Hands a page's stand-in over to its hero. `standIn` is the stand-in's card and `hero` the
 * element of the hero that framer-motion moves (each in a box with `perspective`), or null for a
 * page that has no hero to show. Call it in the commit that mounts the hero: the hero is held
 * out of sight from here on, and its picture is waited for from here. The stand-in gives way
 * once `land` has been called as well. `onOver` is called when the stand-in is no longer seen
 * and is to be taken off the page; `onSettled` after it, when the hero has come to rest as well
 * (a page that has heavy work to do on the handover does it then, with nothing moving). Where
 * the hero does not turn in, the two are called one right after the other.
 */
export const handOverStandIn = (
    standIn: HTMLElement,
    hero: HTMLElement | null,
    onOver: () => void,
    onSettled: () => void,
): StandInHandover => {
    const picture = hero?.querySelector('img') ?? null;
    // An animation rather than a style: a card's own `transition: all` would hold a change of
    // `opacity` back by its length.
    const hold = hero?.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'both' });
    const animations: Animation[] = hold ? [hold] : [];
    const pictureWait = new AbortController();
    let stage: 'waiting' | 'leaving' | 'over' = 'waiting';
    let hasLanded = false;
    // `complete` is a picture that has loaded, and one that has failed.
    let isPictureSettled = !picture || picture.complete;
    // Whether the hero shows the stand-in's own picture: known at once where the two addresses
    // are one artwork's, and from the pictures themselves where they are not.
    const flown = pictureOf(standIn);
    const own = pictureOf(hero);
    let showsSamePicture = sameArtwork(flown, own);
    let isLikenessKnown = showsSamePicture || !flown || !own;
    let landing: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let likenessDeadline: ReturnType<typeof setTimeout> | undefined;

    const start = () => {
        if (stage !== 'waiting' || !hasLanded || !isPictureSettled || !isLikenessKnown) {
            return;
        }
        stage = 'leaving';
        clearTimeout(deadline);
        clearTimeout(likenessDeadline);
        pictureWait.abort();
        // A hero that has left the page meanwhile (its card was dragged or filtered away) is none.
        const kind = standInHandoverKind(
            standIn.getBoundingClientRect(),
            hero?.isConnected ? hero.getBoundingClientRect() : null,
            showsSamePicture,
        );
        const leaving = kind === 'turn'
            ? standIn.animate({ rotate: ['y 0deg', 'y 90deg'] }, { duration: TURN_AWAY_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' })
            : standIn.animate({ opacity: [1, 0] }, { duration: kind === 'plain' ? FADE_OVER_HERO_MS : FADE_ALONE_MS, easing: 'ease-out', fill: 'forwards' });
        // Edge-on, so unseen, for as long as the stand-in is still turning away.
        const arriving = kind === 'turn' && hero
            ? hero.animate(
                { rotate: ['y -90deg', 'y 0deg'] },
                { delay: TURN_AWAY_MS, duration: TURN_IN_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
            )
            : null;
        animations.push(leaving, ...(arriving ? [arriving] : []));
        givingWay = animations;
        // A card brings its picture up by a transition of its own once the picture has loaded.
        // A hero whose picture loaded a moment ago would be shown half way through that.
        for (const running of hero?.getAnimations({ subtree: true }) ?? []) {
            if (running instanceof CSSTransition) running.finish();
        }
        hold?.cancel();
        leaving.finished.then(() => {
            if (stage === 'leaving') {
                stage = 'over';
                onOver();
            }
        }, () => {});
        // After `onOver`, also where both come of one animation's end.
        (arriving ?? leaving).finished.then(onSettled, () => {});
    };

    // The hero's picture is there (or is not coming). What is not known of it by now is not
    // waited for much longer: unless it comes to be known before the stand-in gives way, it is
    // taken for a picture of the hero's own.
    const waitBrieflyForLikeness = () => {
        if (!isLikenessKnown && likenessDeadline === undefined) {
            likenessDeadline = setTimeout(() => {
                isLikenessKnown = true;
                start();
            }, LIKENESS_WAIT_MS);
        }
    };
    const settle = () => {
        isPictureSettled = true;
        waitBrieflyForLikeness();
        start();
    };
    if (!isLikenessKnown) {
        void picturesLookAlike(flown!, own!).then((alike) => {
            // Heeded for as long as the stand-in has not begun to give way, also once it is no
            // longer waited for: the flight may land later than that.
            if (stage === 'waiting') {
                showsSamePicture = alike;
                isLikenessKnown = true;
                start();
            }
        });
    }
    if (picture && !isPictureSettled) {
        picture.addEventListener('load', settle, { signal: pictureWait.signal });
        picture.addEventListener('error', settle, { signal: pictureWait.signal });
        // Waited for long enough: the hero is shown as it is.
        deadline = setTimeout(settle, PICTURE_WAIT_MS);
    } else {
        waitBrieflyForLikeness();
    }

    return {
        land: () => {
            if (stage !== 'waiting' || landing !== undefined) {
                return;
            }
            landing = setTimeout(() => {
                hasLanded = true;
                start();
            }, GIVES_WAY_AFTER_MS);
        },
        cancel: () => {
            if (stage === 'over') {
                return;
            }
            stage = 'over';
            clearTimeout(landing);
            clearTimeout(deadline);
            clearTimeout(likenessDeadline);
            pictureWait.abort();
            for (const animation of animations) animation.cancel();
        },
    };
};
