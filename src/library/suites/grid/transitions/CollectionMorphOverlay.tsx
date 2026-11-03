import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCollectionNavigationStore, type CollectionNavigationSnapshot } from '../../../../stores/useCollectionNavigationStore';
import { planForOpening, reportMorphCapture, useCollectionMorphStore } from './collectionMorphStore';
import { FLIGHT_MS, HANDOVER_MS, flightPictureKeyframes, flightTurn, planFlight, type MorphFlightTitle } from './morphFlight';
import {
    COLLECTION_MORPH_Z_INDEX,
    type CollectionMorphCard,
    type CollectionMorphPending,
} from './morphGeometry';
import {
    attachMorphCapture,
    cardOf,
    centredCardOf,
    findMorphCard,
    isCardToCome,
    leavingGridRoot,
    measureSourceCard,
    probeMorphTarget,
    rectOfElement,
    type MeasuredCard,
} from './morphProbes';
import { scatterCards } from './morphScatter';

// src/library/suites/grid/transitions/CollectionMorphOverlay.tsx
// The「移形换影」transition: the card that was clicked flies to the page that opens, and the card
// at the middle of a page that is left flies back to it, while the page's other cards are pushed
// out of its way.
//
// What flies is a carrier, portalled to <body>: the card's frame, its picture and its title, each
// its own piece. It flies to a place that is on the page already: the page's stand-in card or the
// artist's picture on the way in (measured once, in the commit that mounts the page), the card it
// came from on the way back. Every piece is moved by `transform` and `opacity` alone, as Web
// Animations, so the compositor carries them while the page that opens mounts on the main
// thread. The keyframes are in morphFlight.ts.
//
// Over the pieces lies the frame's edge: its outline in the theme's text colour, and a shadow
// that lifts it off the page. It is lit while the card is in the air and not at all at either
// end, where the carrier is to be the card as its page draws it.
//
// The cards at the two ends are not shown while the carrier stands for them. When it has landed,
// the card it landed on is shown again beneath it and the carrier dissolves over it: what the
// carrier does not draw of that card (its smaller lines, its buttons) comes in with that, and
// what it does draw is the same on both and is not seen to change. Where the landing place shows
// another picture or title (the artist's, the home card's on the way back), the carrier turns
// into those in mid-flight.
//
// A card that draws a layer over its picture and marks it (the poster wall's grown tile: its
// shade) has the carrier wear that layer over its own picture, whole where the carrier stands on
// that card: the picture under it is then as dark there as the card shows it, and not bare from
// one frame to the next. It goes in the first part of a flight from that card, and comes in the
// last part of a flight to it.
//
// Both pages put their landing place up in their first render (the artist's page its round
// picture, before it has read the artist). A page whose landing place is not there then keeps
// the card waiting where it was clicked; it flies when the place is there. On the way back a
// card waits for one landing place only: the poster wall's tile, which its wall draws a frame or
// two after it is put up. (The wall draws that tile hidden while the flight back to it is armed:
// this overlay finds it, and could hide it, only after it has been painted.) A flight back to any
// other place that is not there in the commit it starts in does not wait (the artist's page that
// is come back to has none until it has read its artist), and the card shrinks and fades where
// it is.
//
// The carrier takes no input and blocks none. A second flight takes the place of the first.
//
// The overlay is inside the home screen, which is taken down for the poster wall. What holds it
// there keeps it until a flight back to the wall is over: the store is told what the carrier is
// doing (`carrier`), and when the overlay is taken down (`overlayTakenDown`).

// A flight ends when its animation says so; this much later it is ended anyway (a hidden window
// does not advance animations, and no card may stay hidden behind a carrier that never lands).
const END_MARGIN_MS = 250;
// An exit is armed before the navigation; one whose navigation has not come in this long is dropped.
const EXIT_WAIT_MS = 1000;
// A page whose landing place is not on it yet: the card waits where it was clicked for this
// long at most, looking this often.
const HOLD_MS = 1200;
const HOLD_LOOK_MS = 30;
// A flight with nowhere to land shrinks to this and fades where it is.
const NO_LANDING_SCALE = 0.86;

interface Flight {
    id: number;
    direction: 'in' | 'out';
    from: CollectionMorphCard;
    /** Where it lands; null where there is nowhere, and it shrinks and fades where it is. */
    to: CollectionMorphCard | null;
    /** Not flying yet: it stands at `from` until this finds its landing place on the page. Null for one that flies. */
    waiting: (() => MeasuredCard | null) | null;
    /** The picture of the place it lands on, where that is another one and is ready. */
    arriving: { url: string; proportions: number } | null;
    /** The cards at its two ends: not shown while the carrier stands for them. */
    source: HTMLElement | null;
    landing: HTMLElement | null;
}

interface CollectionMorphOverlayProps {
    /**
     * 是否允许播放转场。由宿主读「降低动态效果」的 collectionMorph 面得出，为 false 时
     * 既不挂捕获监听也不起飞 —— 转场是纯装饰，降级时应当完全不出现，而不是缩短。
     */
    enabled?: boolean;
}

// Did the CURRENT navigation state move in the opening direction relative to when the captured
// click's gesture began? A click that opens a collection (home open or nested push) always
// deepens the nav state after the click; a click that merely plays/centers a card leaves it
// identical, and the observation window discards its capture.
const openedByGesture = (payload: CollectionMorphPending, navigation: CollectionNavigationSnapshot | null): boolean => {
    const { wasOpen, depth } = payload.navAtGestureStart;
    return (!wasOpen && Boolean(navigation)) || (navigation?.stack.length ?? 0) > depth;
};

const isReady = (picture: HTMLElement | null): picture is HTMLImageElement => (
    picture instanceof HTMLImageElement && picture.complete && picture.naturalWidth > 0
);

/**
 * Takes a card off the screen, and returns what shows it again. An animation rather than a
 * style: a card's own `transition: all` would hold a change of `visibility` or `opacity` back by
 * its length, and the card would stand beside its carrier for that long.
 */
const veil = (card: HTMLElement): (() => void) => {
    const veiled = card.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'both' });
    return () => veiled.cancel();
};

const timing = { duration: FLIGHT_MS, easing: 'linear', fill: 'both' } as const;

/** A title of the carrier: the line as its card draws it, laid out at the window's corner. */
const TitleLine: React.FC<{ piece: MorphFlightTitle; lineRef: React.Ref<HTMLSpanElement> }> = ({ piece, lineRef }) => {
    const { title } = piece;
    const clamp = title.style.WebkitLineClamp;
    return (
        <span
            ref={lineRef}
            data-folia-collection-morph="title"
            style={{
                position: 'absolute', left: 0, top: 0, width: title.width, height: title.height,
                transformOrigin: '0 0', willChange: 'transform, opacity',
                transform: String(piece.move[0].transform), opacity: Number(piece.fade[0].opacity),
            }}
        >
            <span
                style={{
                    ...(title.style as React.CSSProperties),
                    display: clamp && clamp !== 'none' ? '-webkit-box' : 'block',
                    WebkitBoxOrient: 'vertical', overflow: 'hidden', width: '100%', height: '100%',
                }}
            >
                {title.text}
            </span>
        </span>
    );
};

let flights = 0;

export const CollectionMorphOverlay: React.FC<CollectionMorphOverlayProps> = ({ enabled = true }) => {
    const pending = useCollectionMorphStore((state) => state.pending);
    const exit = useCollectionMorphStore((state) => state.exit);
    const navigation = useCollectionNavigationStore((state) => state.snapshot);

    const [flight, setFlight] = useState<Flight | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const edgeRef = useRef<HTMLDivElement | null>(null);
    const coverRef = useRef<HTMLDivElement | null>(null);
    const leavingRef = useRef<HTMLImageElement | null>(null);
    const arrivingRef = useRef<HTMLImageElement | null>(null);
    const shadeRef = useRef<HTMLDivElement | null>(null);
    const leavingTitleRef = useRef<HTMLSpanElement | null>(null);
    const arrivingTitleRef = useRef<HTMLSpanElement | null>(null);
    // The exit a flight was started for (by the moment it was armed): started once.
    const startedExitRef = useRef(0);

    // Records which card the user clicked. Attached from an effect (and disposed
    // with it) rather than as a module side effect, so HMR cannot stack a second
    // document listener behind the first.
    // A card of the home screen opens its page in the very click that is captured here, and the
    // page reads its plan at its first render: the plan is committed with the capture, ahead of
    // the navigation. (A page opened from a page has its plan from the host's beforePush,
    // gridHostTransitions.ts.) A click that opens nothing leaves it to the observation window,
    // which takes it back with the capture.
    useEffect(() => {
        if (!enabled) {
            return;
        }
        return attachMorphCapture((capture) => {
            reportMorphCapture(capture);
            if (!useCollectionNavigationStore.getState().snapshot) {
                useCollectionMorphStore.getState().commitPlan(planForOpening(), 1);
            }
        });
    }, [enabled]);

    // Starts a flight of `card` to `target`, or with `waiting` (what looks for its landing place)
    // stands it where it is. `source` is the card on the page it flies from. One in the air is
    // replaced; with `fromTheAir`, the new one starts where the carrier is at this moment.
    const start = useCallback((
        direction: Flight['direction'],
        card: CollectionMorphCard,
        target: MeasuredCard | null,
        source: HTMLElement | null,
        how: { fromTheAir?: boolean; waiting?: () => MeasuredCard | null } = {},
    ) => {
        const inTheAir = how.fromTheAir ? rectOfElement(coverRef.current) : null;
        const frameInTheAir = inTheAir ? rectOfElement(frameRef.current) : null;
        const from: CollectionMorphCard = inTheAir
            ? {
                ...card,
                rect: inTheAir,
                frame: card.frame && frameInTheAir ? { ...card.frame, rect: frameInTheAir } : card.frame,
                // The title is taken along by as much as the picture is off its place.
                title: card.title && {
                    ...card.title,
                    rect: { ...card.title.rect, x: card.title.rect.x + inTheAir.x - card.rect.x, y: card.title.rect.y + inTheAir.y - card.rect.y },
                },
            }
            : card;
        const isSame = Boolean(target?.url) && target?.url === card.url;
        flights += 1;
        setFlight({
            id: flights, direction, from,
            to: target ? cardOf(target) : null,
            waiting: how.waiting ?? null,
            arriving: target && !isSame && target.url && isReady(target.picture)
                ? { url: target.url, proportions: target.proportions }
                : null,
            source,
            landing: target?.card ?? null,
        });
    }, []);

    // A card was clicked and a page opened for it: the card flies to where the page takes it.
    // A layout effect of the commit that mounted the page, which is when the landing place is
    // there to be measured (the page's plan was committed before the navigation: with the click's
    // capture, or by the host's beforePush) and before anything of the page has been painted.
    useLayoutEffect(() => {
        if (!enabled || !pending || navigation?.origin !== 'home' || !openedByGesture(pending, navigation)) {
            return;
        }
        const store = useCollectionMorphStore.getState();
        store.ackPending();
        // Remember the top-level source card: the flight back lands on exactly this
        // home card when the user backs out later. Nested opens (song card →
        // album/artist) must NOT overwrite it — the eventual top-level back still
        // targets the original home card. The nested push's own source card is
        // remembered for the nested back instead.
        const depth = navigation.stack.length;
        if (depth <= 1) {
            store.setLastHome(pending);
        } else if (pending.sourceKey) {
            store.setLastSource(pending, depth);
        }
        // The clicked card itself: on the home surface, or on the page that is being left.
        const leaving = depth <= 1 ? null : leavingGridRoot();
        const source = depth <= 1 || leaving ? findMorphCard(pending.sourceKey, leaving) : null;
        const target = probeMorphTarget();
        start('in', pending, target, source, { waiting: target ? undefined : probeMorphTarget });
    }, [enabled, navigation, pending, start]);

    // A card that waits flies when its landing place has come, and fades where it is when it
    // has not come in time.
    useEffect(() => {
        const look = flight?.waiting;
        if (!flight || !look) {
            return;
        }
        const since = performance.now();
        const timer = setInterval(() => {
            const target = look();
            if (target || performance.now() - since >= HOLD_MS) {
                start(flight.direction, flight.from, target, flight.source);
            }
        }, HOLD_LOOK_MS);
        return () => clearInterval(timer);
    }, [flight, start]);

    // The flight back: armed by the host right before backing out, started once the navigation
    // has moved (through the history, some milliseconds later) and what it lands on is shown.
    // The page that is left is still on the screen, fading: its other cards are pushed out from
    // the one that flies.
    useLayoutEffect(() => {
        if (!exit || startedExitRef.current === exit.armedAt || (navigation?.stack.length ?? 0) >= exit.armedDepth) {
            return;
        }
        startedExitRef.current = exit.armedAt;
        if (!enabled) {
            useCollectionMorphStore.getState().consume();
            return;
        }
        const leaving = leavingGridRoot();
        const centred = leaving ? centredCardOf(leaving)?.card ?? null : null;
        if (leaving) {
            const { rect } = exit.from;
            scatterCards(leaving, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, centred);
        }
        const landing = exit.nested ? probeMorphTarget() : measureSourceCard(exit.sourceKey);
        start('out', exit.from, landing, centred, {
            fromTheAir: true,
            // The poster wall has not drawn its tile yet: the card waits for it where it stands.
            waiting: !landing && isCardToCome(exit.sourceKey) ? () => measureSourceCard(exit.sourceKey) : undefined,
        });
    }, [enabled, exit, navigation, start]);

    useEffect(() => {
        if (!exit || startedExitRef.current === exit.armedAt) {
            return;
        }
        const timer = setTimeout(() => {
            if (startedExitRef.current !== exit.armedAt) useCollectionMorphStore.getState().consume();
        }, EXIT_WAIT_MS);
        return () => clearTimeout(timer);
    }, [exit]);

    // The pieces: where each is laid out and what moves it. A carrier that waits, or has nowhere
    // to land, is the card standing where it is.
    const pieces = useMemo(() => {
        if (!flight) {
            return null;
        }
        const end = flight.to ?? flight.from;
        return {
            ...planFlight(flight.from, end),
            leaving: flight.from.url ? flightPictureKeyframes(flight.from.rect, end.rect, flight.from.proportions) : null,
            arriving: flight.arriving ? flightPictureKeyframes(flight.from.rect, end.rect, flight.arriving.proportions) : null,
        };
    }, [flight]);

    // The flight itself. Its end, by whichever way it comes, shows the cards at its two ends.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!flight || !pieces || !root) {
            return;
        }
        const unveil = [flight.source, flight.landing].filter((card): card is HTMLElement => card !== null).map(veil);
        const show = () => {
            for (const shown of unveil) shown();
        };
        if (flight.waiting) {
            return show;
        }
        const animations: Animation[] = [];
        const move = (element: Element | null, ...keyframes: Array<Keyframe[] | null | undefined>) => {
            for (const frames of keyframes) {
                if (element && frames) animations.push(element.animate(frames, timing));
            }
        };
        if (flight.to) {
            move(coverRef.current, pieces.cover.box, pieces.cover.corners);
            move(leavingRef.current, pieces.leaving?.image);
            move(arrivingRef.current, pieces.arriving?.image, flightTurn.arriving);
            move(shadeRef.current, pieces.shade?.fade);
            move(frameRef.current, pieces.frame?.box, pieces.frame?.corners, pieces.frame?.fade);
            move(edgeRef.current, pieces.frame?.box, pieces.frame?.corners, pieces.frame?.edge);
            move(leavingTitleRef.current, pieces.leavingTitle?.move, pieces.leavingTitle?.fade);
            move(arrivingTitleRef.current, pieces.arrivingTitle?.move, pieces.arrivingTitle?.fade);
        } else {
            animations.push(root.animate(
                [{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${NO_LANDING_SCALE})`, opacity: 0 }],
                { duration: FLIGHT_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'both' },
            ));
        }
        let isOver = false;
        let handover: ReturnType<typeof setTimeout> | undefined;
        const end = () => setFlight(current => (current?.id === flight.id ? null : current));
        const land = () => {
            if (isOver) return;
            isOver = true;
            show();
            useCollectionMorphStore.getState().consume();
            useCollectionMorphStore.getState().setCarrier('landed');
            if (!flight.to) {
                end();
                return;
            }
            // The card it landed on is under it now; the carrier goes over it.
            animations.push(root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HANDOVER_MS, easing: 'ease-out', fill: 'both' }));
            handover = setTimeout(end, HANDOVER_MS);
        };
        const timer = setTimeout(land, FLIGHT_MS + END_MARGIN_MS);
        animations[0]?.finished.then(land, () => {});
        return () => {
            isOver = true;
            clearTimeout(timer);
            clearTimeout(handover);
            for (const animation of animations) animation.cancel();
            show();
        };
    }, [flight, pieces]);

    // What the carrier is doing, told to the store for what is outside the overlay (`carrier`
    // there). That it has landed is told at the landing, above.
    useLayoutEffect(() => {
        useCollectionMorphStore.getState().setCarrier(flight ? (flight.waiting ? 'waits' : 'flies') : null);
    }, [flight]);
    useEffect(() => () => useCollectionMorphStore.getState().overlayTakenDown(), []);

    // Ended at once: the setting was switched off in mid-flight, or the page a card is flying
    // to was closed with no flight back armed (a back through the browser's history).
    useLayoutEffect(() => {
        if (!flight || (enabled && (flight.direction === 'out' || navigation || exit))) {
            return;
        }
        setFlight(null);
        useCollectionMorphStore.getState().consume();
    }, [enabled, exit, flight, navigation]);

    if (!enabled || !flight || !pieces || typeof document === 'undefined') {
        return null;
    }

    const { cover, frame, leavingTitle, arrivingTitle, leaving, arriving, shade } = pieces;
    const centre = { x: flight.from.rect.x + flight.from.rect.width / 2, y: flight.from.rect.y + flight.from.rect.height / 2 };
    const boxStyle = (box: typeof cover): React.CSSProperties => ({
        position: 'absolute', left: box.rect.x, top: box.rect.y, width: box.rect.width, height: box.rect.height,
        transformOrigin: '0 0', willChange: 'transform',
        transform: String(box.box[0].transform), borderRadius: String(box.corners[0].borderRadius),
    });
    const pictureStyle = (picture: NonNullable<typeof leaving>): React.CSSProperties => ({
        position: 'absolute', left: picture.picture.x, top: picture.picture.y, width: picture.picture.width, height: picture.picture.height,
        maxWidth: 'none', transformOrigin: '50% 50%', willChange: 'transform', transform: String(picture.image[0].transform),
    });

    return createPortal(
        <div
            key={flight.id}
            ref={rootRef}
            data-folia-collection-morph="carrier"
            aria-hidden="true"
            style={{
                position: 'fixed', left: 0, top: 0, width: 0, height: 0, zIndex: COLLECTION_MORPH_Z_INDEX,
                pointerEvents: 'none', transformOrigin: `${centre.x}px ${centre.y}px`,
            }}
        >
            {frame && (
                <div
                    ref={frameRef}
                    data-folia-collection-morph="frame"
                    style={{
                        ...boxStyle(frame), boxSizing: 'border-box',
                        background: frame.look.background, border: frame.look.border, boxShadow: frame.look.shadow,
                        opacity: frame.fade ? Number(frame.fade[0].opacity) : 1,
                    }}
                />
            )}
            <div
                ref={coverRef}
                data-folia-collection-morph="cover"
                data-folia-collection-morph-direction={flight.direction}
                style={{ ...boxStyle(cover), overflow: 'hidden', background: leaving ? undefined : 'rgba(127, 127, 127, 0.25)' }}
            >
                {leaving && flight.from.url && (
                    <img ref={leavingRef} src={flight.from.url} alt="" draggable={false} decoding="sync" style={pictureStyle(leaving)} />
                )}
                {arriving && flight.arriving && (
                    <img ref={arrivingRef} src={flight.arriving.url} alt="" draggable={false} decoding="sync" style={{ ...pictureStyle(arriving), opacity: 0 }} />
                )}
                {/* Fills the box, and is scaled with it: the layer as its card draws it over a picture of that size. */}
                {shade && (
                    <div
                        ref={shadeRef}
                        data-folia-collection-morph="shade"
                        style={{
                            position: 'absolute', inset: 0, background: shade.look, willChange: 'opacity',
                            opacity: shade.fade ? Number(shade.fade[0].opacity) : 1,
                        }}
                    />
                )}
            </div>
            {leavingTitle && <TitleLine piece={leavingTitle} lineRef={leavingTitleRef} />}
            {arrivingTitle && flight.to && <TitleLine piece={arrivingTitle} lineRef={arrivingTitleRef} />}
            {/* Not lit until the flight lights it: a carrier that waits, or has nowhere to land, shows none. */}
            {frame && (
                <div
                    ref={edgeRef}
                    data-folia-collection-morph="edge"
                    style={{
                        ...boxStyle(frame), willChange: 'transform, opacity', opacity: 0,
                        boxShadow: `inset 0 0 0 1px ${frame.look.edge}, 0 14px 36px rgba(0, 0, 0, 0.28)`,
                    }}
                />
            )}
        </div>,
        document.body,
    );
};

export default CollectionMorphOverlay;
