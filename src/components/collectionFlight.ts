import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

// src/components/collectionFlight.ts
// 封面飞行（网格 suite 的「移形换影」，src/library/suites/grid/transitions）与 suite 以外的界面之间的约定：
// 队列拼贴（components/app/lattice）从放大的图块打开集合页、再飞回那张图块，探索页的卡片作为起点，App 在飞回墙的途中
// 留着首页层。suite 以外的代码不能 import suite（test/unit/library/layerBoundaries.test.ts），所以这里只有两样：
// - 这些卡片自己挂的 DOM 属性名（网格的 gridMorphContract 原样转出它们，morph 的探针从那里读）；
// - 网格的转场加载时装上的接口（installCollectionFlight）：一份只读的飞行状态，和「墙要打开一页」这一个动作。
// 没装上时（没有网格 suite 的构建、单测）状态一直是空的，什么都不飞。

/** A card of any other surface that opens a collection (the explore page's); its value is a key
 * of what it opens, by which the card is found again for the flight back. */
export const MORPH_SOURCE_ATTR = 'data-folia-morph-source';

/** The line of a card that says what it is (PolaroidCard, the home slider's cards, the explore
 * page's, GridView's stand-in). It flies with the cover. */
export const CARD_TITLE_ATTR = 'data-folia-card-title';

/** The grown collection tile of the poster wall (the 'lattice' view); its value is the tile's id.
 * The wall draws one entry many times over, and only the grown one carries this: a flight to
 * the tile's page starts from it, and the flight back lands on it. It draws its cover as an
 * <img>, as every card the morph reads does. */
export const LATTICE_TILE_ATTR = 'data-folia-lattice-tile';

/** The layer a card draws over its cover, where the cover's flight is to wear it too: the poster
 * wall's grown tile marks its shade with this. The carrier that stands for such a card draws the
 * layer over its own cover, as that element draws it (its background, read off it). A card that
 * marks none has none, and flies as a bare cover. */
export const MORPH_SHADE_ATTR = 'data-folia-morph-shade';

/** The poster wall itself, for as long as it is on the page. Put up anew, it draws its tiles a
 * frame or two later: by this a flight back to its tile knows that the tile is still to come. */
export const LATTICE_WALL_ATTR = 'data-folia-lattice-wall';

/** What the morph's carrier is doing: it stands and waits for its landing place, it is in the air,
 * or it has landed and dissolves over the card under it. */
export type CollectionFlightCarrier = 'waits' | 'flies' | 'landed';

/** What of a flight those outside the morph read. */
export interface CollectionFlightState {
    /** A flight back from a page, armed right before the page was left: to the card with this
     * source key (null: none known), armed at this `Date.now()`. Null while none is armed. */
    readonly exit: { readonly sourceKey: string | null; readonly armedAt: number } | null;
    readonly carrier: CollectionFlightCarrier | null;
}

/** A read-only store of that state (the morph's own store fits it). */
export interface CollectionFlightStore {
    getState: () => CollectionFlightState;
    getInitialState: () => CollectionFlightState;
    subscribe: (listener: (state: CollectionFlightState, previous: CollectionFlightState) => void) => () => void;
}

export interface CollectionFlight {
    store: CollectionFlightStore;
    /** The source key a flight to or from the wall's grown tile with this id goes by. */
    sourceKeyOfTile: (tileId: string) => string;
    /**
     * Readies the morph for the page the wall is about to open, before the navigation (the page
     * reads its plan at its first render): with `flies`, the wall's grown tile is the card that
     * flies to the page; without, the page comes up as it does with motion reduced.
     */
    planPageFromWall: (flies: boolean) => void;
}

const NO_FLIGHT: CollectionFlight = {
    store: createStore<CollectionFlightState>(() => ({ exit: null, carrier: null })),
    sourceKeyOfTile: tileId => tileId,
    planPageFromWall: () => {},
};

let installed: CollectionFlight = NO_FLIGHT;

/** Called by the grid's transitions once, when they are loaded (before anything renders). */
export const installCollectionFlight = (flight: CollectionFlight): void => {
    installed = flight;
};

export const collectionFlight = (): CollectionFlight => installed;

/** A piece of the flight's state, as a hook. */
export const useCollectionFlight = <T>(select: (state: CollectionFlightState) => T): T => (
    useStore(installed.store, select)
);

/**
 * Whether the morph has a flight back to run or a carrier up. For what takes the morph's host
 * down with the view: a page left for the poster wall is kept under the wall, with the morph,
 * until the flight back to the wall is over (App.tsx). Answers false while not `asked`, so that
 * nothing renders for a flight the asker holds nothing for.
 */
export const useMorphKeepsHost = (asked: boolean): boolean => (
    useCollectionFlight(state => asked && (state.exit !== null || state.carrier !== null))
);
