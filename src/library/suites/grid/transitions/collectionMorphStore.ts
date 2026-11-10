import { create } from 'zustand';
import { useCollectionNavigationStore, type CollectionNavigationSnapshot } from '../../../../stores/useCollectionNavigationStore';
import { collectionKey } from '../../../core/collection/collectionIdentity';
import { captureClickedCard, latticeSourceKey, type CollectionMorphCapture } from './morphProbes';
import { installCollectionFlight, LATTICE_TILE_ATTR, type CollectionFlightCarrier } from '../../../../components/collectionFlight';
import {
    COLLECTION_MORPH_OBSERVATION_WINDOW_MS,
    COLLECTION_MORPH_PLAN_TTL_MS,
    type CollectionMorphCard,
    type CollectionMorphExit,
    type CollectionMorphPending,
    type CollectionMorphPlan,
} from './morphGeometry';

// src/library/suites/grid/transitions/collectionMorphStore.ts
// Shared-element「移形换影」transition state — and nothing else.
//
// The rectangles it hands around are measured in morphProbes.ts, and the flight
// itself is driven by CollectionMorphOverlay. What lives here is only what has
// to outlive a single component: the clicked card's cover, the entrance plan
// the detail grid reads, the cards the open pages were opened from (where the
// flights back land), the armed exit, and what the overlay's carrier is doing
// (for what is outside the overlay).
//
// A capture only survives the observation window when a collection actually
// opens within it; a click that merely centers the slider discards it.

/** What the overlay's carrier is doing: it stands and waits for its landing place, it is in the
 * air, or it has landed and dissolves over the card under it. (Told outside the suite as well:
 * components/collectionFlight, installed at the end of this file.) */
export type MorphCarrierPhase = CollectionFlightCarrier;

interface CollectionMorphState {
    pending: CollectionMorphPending | null;
    /** The entrance the page that opens next is to make. Committed BEFORE the navigation, so
     * that the page has it at its first render: with the click's capture for a card of the home
     * screen (CollectionMorphOverlay), by the host's beforePush for a page opened from a page
     * (gridHostTransitions), by the poster wall for its tile (planPageFromWall, below). */
    plan: CollectionMorphPlan | null;
    /** How deep in the navigation the page the plan is for stands (1: the first page). A page
     * at another depth that mounts while the plan lasts is not the one it was made for: the page
     * before, gone back to through the history with no flight armed, is such a page. */
    planDepth: number;
    /** The home card this session's forward morph opened from; the reverse
     * flight's destination. Survives consume() of the forward payload. */
    lastHome: CollectionMorphPending | null;
    /** The collection that card opened (`collectionKey` of the navigation's root).
     * The reverse flight lands on the card only when the collection being left is
     * that one: a collection opened without a card click (by "locate the playing
     * song") has no home card, and would otherwise be flown onto the card of
     * whichever collection a click had opened before it. */
    lastHomeRoot: string;
    /** The card the CURRENT nesting level was pushed from (e.g. the song card
     * whose click opened the artist page); the page before centres on it again
     * when it comes back, and shows its picture where the flight back lands.
     * Depth and snapshot identity bind it to this navigation, not a later
     * async push at the same depth whose capture has already expired. */
    lastSource: CollectionMorphPending | null;
    lastSourceDepth: number;
    lastSourceNavigation: CollectionNavigationSnapshot | null;
    /** Armed by the host right before leaving a collection. */
    exit: CollectionMorphExit | null;
    /** What the overlay's carrier is doing; null while there is none. The overlay's own state,
     * told here for what is outside it: what would take the overlay down with the view while a
     * flight is on (useMorphKeepsHost in components/collectionFlight), and the poster wall's log of its flights. */
    carrier: MorphCarrierPhase | null;
    capture: (payload: CollectionMorphPending) => void;
    /** Clears an already-launched pending so it can never re-launch. */
    ackPending: () => void;
    commitPlan: (plan: CollectionMorphPlan, depth: number) => void;
    setLastHome: (home: CollectionMorphPending) => void;
    setLastSource: (source: CollectionMorphPending, depth: number) => void;
    armExit: (from: CollectionMorphCard) => void;
    armNestedExit: (from: CollectionMorphCard) => void;
    consume: () => void;
    clear: () => void;
    setCarrier: (carrier: MorphCarrierPhase | null) => void;
    /** The overlay is taken down: it leaves no armed exit and no carrier behind. */
    overlayTakenDown: () => void;
}

let discardTimer: ReturnType<typeof setTimeout> | null = null;
let planTtlTimer: ReturnType<typeof setTimeout> | null = null;

const cancelPlanTtl = () => {
    if (planTtlTimer !== null) {
        clearTimeout(planTtlTimer);
        planTtlTimer = null;
    }
};

const cancelDiscard = () => {
    if (discardTimer !== null) {
        clearTimeout(discardTimer);
        discardTimer = null;
    }
};

const scheduleDiscard = (clear: () => void) => {
    cancelDiscard();
    discardTimer = setTimeout(() => {
        discardTimer = null;
        clear();
    }, COLLECTION_MORPH_OBSERVATION_WINDOW_MS);
};

export const useCollectionMorphStore = create<CollectionMorphState>((set, get) => {
    const commitPlan = (plan: CollectionMorphPlan, depth: number) => {
        cancelPlanTtl();
        planTtlTimer = setTimeout(() => {
            planTtlTimer = null;
            if (get().plan) {
                set({ plan: null });
            }
        }, COLLECTION_MORPH_PLAN_TTL_MS);
        set({ plan, planDepth: depth });
    };
    return {
        pending: null,
        plan: null,
        planDepth: 0,
        lastHome: null,
        lastHomeRoot: '',
        lastSource: null,
        lastSourceDepth: 0,
        lastSourceNavigation: null,
        exit: null,
        carrier: null,
        capture: (payload) => set({ pending: payload, plan: null, exit: null }),
        // ackPending only ever runs when a flight actually launched, so it also
        // cancels the observation window — otherwise the discard timer could fire
        // mid-flight and consume the live morph plan.
        ackPending: () => {
            cancelDiscard();
            set({ pending: null });
        },
        commitPlan,
        setLastHome: (home) => set({
            lastHome: home,
            lastHomeRoot: collectionKey(useCollectionNavigationStore.getState().snapshot?.stack[0]),
        }),
        setLastSource: (source, depth) => set({
            lastSource: source,
            lastSourceDepth: depth,
            lastSourceNavigation: useCollectionNavigationStore.getState().snapshot,
        }),
        armExit: (from) => {
            const { lastHome, lastHomeRoot } = get();
            const navigation = useCollectionNavigationStore.getState().snapshot;
            const root = navigation?.stack[0];
            if (!lastHome || !navigation || !root || collectionKey(root) !== lastHomeRoot) {
                return;
            }
            cancelPlanTtl();
            set({
                exit: { from, sourceKey: lastHome.sourceKey, nested: false, armedDepth: navigation.stack.length, armedAt: Date.now() },
                plan: null,
            });
        },
        armNestedExit: (from) => {
            const navigation = useCollectionNavigationStore.getState().snapshot;
            const depth = navigation?.stack.length ?? 0;
            const { lastSource, lastSourceDepth, lastSourceNavigation } = get();
            // Only a source captured for THIS nesting level is the card the page before
            // comes back centred on; an async push whose capture was discarded left none,
            // and the page before then shows the picture that flies back to it.
            const source = lastSource && lastSourceDepth === depth && depth > 1 && lastSourceNavigation === navigation
                ? lastSource
                : null;
            set({ exit: { from, sourceKey: null, nested: true, armedDepth: depth, armedAt: Date.now() } });
            const lands = source ?? from;
            commitPlan({ kind: 'morph', coverUrl: lands.url, title: lands.title?.text ?? null }, depth - 1);
        },
        // consume() intentionally keeps lastHome: the forward morph ends long before
        // the user backs out, and the reverse flight needs the original home card.
        consume: () => {
            cancelDiscard();
            const { pending, exit } = get();
            // A capture that arrived AFTER the exit was armed belongs to the next
            // session (quick back-out + reopen while the exit still plays) — keep it
            // so the overlay launches it once the exit lifecycle finishes.
            const keepPending = pending && exit && pending.capturedAt > exit.armedAt
                ? pending
                : null;
            set({
                pending: keepPending, plan: null, exit: null,
                // Keep the source during forward-flight completion, release it after back.
                ...(exit ? { lastSource: null, lastSourceDepth: 0, lastSourceNavigation: null } : {}),
            });
        },
        clear: () => {
            cancelDiscard();
            set({ pending: null, plan: null, lastHome: null, lastHomeRoot: '', lastSource: null, lastSourceDepth: 0, lastSourceNavigation: null, exit: null });
        },
        setCarrier: (carrier) => {
            if (get().carrier !== carrier) {
                set({ carrier });
            }
        },
        // The overlay is what runs an armed exit and what draws the carrier. Taken down (its
        // host goes with the view), it leaves neither behind: an exit that stayed armed would
        // be started by the overlay's next mount, from a card that is long gone.
        overlayTakenDown: () => {
            if (get().exit) {
                get().consume();
            }
            get().setCarrier(null);
        },
    };
});

/**
 * 记录一次卡片点击采集，并开启观察窗口。监听器本身在 morphProbes.attachMorphCapture，
 * 由 overlay 的 effect 挂载/卸载；这里只负责「采集 + 限时丢弃」这段状态机。
 *
 * 两个字段必须在这里补齐，因为只有这个时机同时知道「点击前的导航签名」和「现在几点」：
 * 监听跑在 capture 阶段，读到的导航快照才是点击之前的状态。
 */
export const reportMorphCapture = (capture: CollectionMorphCapture): void => {
    const snapshot = useCollectionNavigationStore.getState().snapshot;
    useCollectionMorphStore.getState().capture({
        ...capture,
        navAtGestureStart: {
            wasOpen: Boolean(snapshot),
            depth: snapshot?.stack.length ?? 0,
        },
        capturedAt: Date.now(),
    });
    scheduleDiscard(() => useCollectionMorphStore.getState().consume());
};

/**
 * The plan for a page that is about to open: 'morph' with the clicked card's picture and
 * title when a card was clicked within the observation window (the card will fly to the page),
 * else 'cascade'. Read at the moment of navigating, before the page's first render.
 */
export const planForOpening = (): CollectionMorphPlan => {
    const { pending } = useCollectionMorphStore.getState();
    return pending ? { kind: 'morph', coverUrl: pending.url, title: pending.title?.text ?? null } : { kind: 'cascade' };
};

/** The plan of the page at this depth of the navigation: the store's, when it was committed for it. */
export const useMorphPlanFor = (depth: number) => (
    useCollectionMorphStore(state => (state.planDepth === depth ? state.plan : null))
);

const PAGE_EXIT = { opacity: 0 };
// About as long as the push of its cards (morphScatter.ts: 420 ms, the farthest card starting
// 70 ms late), and slow to start: the cards are seen to move before the page that holds them
// is gone.
const PAGE_EXIT_WITH_FLIGHT = { opacity: 0, transition: { duration: 0.4, ease: [0.4, 0, 1, 1] as [number, number, number, number] } };

/**
 * The `exit` of a collection page's root (GridView, ArtistGridView). A page left with a flight
 * back fades for as long as its cards are pushed out; any other goes as it always did. Read in
 * the page, whose own render is the last to say how it leaves.
 */
export const useMorphPageExit = () => (
    useCollectionMorphStore(state => state.exit !== null) ? PAGE_EXIT_WITH_FLIGHT : PAGE_EXIT
);

/**
 * Readies the morph for the page the poster wall is about to open (components/collectionFlight's
 * `planPageFromWall`). Called before the navigation: the page reads its plan at its first render.
 * A card of the home screen is captured by the overlay's click listener and its page's plan is
 * committed with it; neither is mounted while the wall is up, so the wall has this done for its
 * own tile.
 * - `flies` (motion is not reduced) with the wall's grown tile there to capture: the tile is the
 *   clicked card, and the page's plan is the morph's (a stand-in for the cover to land on, the
 *   cards in a cascade).
 * - `flies` with no tile to capture: the cascade alone.
 * - Otherwise no plan: the page comes up as it does with motion reduced.
 * Where no card flies to the page, none is left remembered as the one a flight back from it
 * lands on: an earlier open of the same collection from a card of the home screen would be, and
 * this page is left for the wall.
 */
export const planPageFromWallTile = (capture: CollectionMorphCapture | null, flies: boolean): void => {
    const store = useCollectionMorphStore.getState();
    if (capture && flies) {
        reportMorphCapture(capture);
    } else {
        store.clear();
    }
    if (flies) {
        store.commitPlan(planForOpening(), 1);
    }
};

/** The wall's grown collection tile, as the card a flight starts from. Null where no tile is grown, or the one that is has no cover to fly. */
const captureWallTile = (): CollectionMorphCapture | null => {
    const tile = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(`[${LATTICE_TILE_ATTR}]`);
    return tile ? captureClickedCard(tile) : null;
};

const planPageFromWall = (flies: boolean): void => planPageFromWallTile(flies ? captureWallTile() : null, flies);

installCollectionFlight({ store: useCollectionMorphStore, sourceKeyOfTile: latticeSourceKey, planPageFromWall });
