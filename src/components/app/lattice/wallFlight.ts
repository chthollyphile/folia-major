import { collectionFlight, useCollectionFlight } from '../../collectionFlight';

// src/components/app/lattice/wallFlight.ts
// What the wall does for the cover's flight to a collection's page and back (the grid's morph,
// reached through components/collectionFlight). At the press that opens the page: a card of the
// home screen is captured by the morph overlay's click listener, and its page's plan committed
// with it; neither is mounted while the wall is up, so the wall has the morph do both for its own
// tile (planPageFromWall). The flight, and the flight back to the tile, are the morph's; of the
// flight back the wall asks only whether one is armed, and its tile whether that one is on its
// way to it.

/**
 * Whether a flight back to the wall is armed (asked when the wall is put up). The page the
 * flight starts from is then kept under the wall until it is over (App.tsx).
 */
export const isFlightBackArmed = (): boolean => collectionFlight().store.getState().exit !== null;

/**
 * Whether a flight back to the wall's grown tile with this id is armed and has not landed (null:
 * the tile is not the grown one, and no flight's end). The carrier stands for the tile for that
 * long, and the tile is not shown. The morph ends every armed flight, landed or not, and one
 * that is over is armed no more.
 */
export const useFlightBackTo = (tileId: string | null): boolean => (
    useCollectionFlight(state => tileId !== null && state.exit?.sourceKey === collectionFlight().sourceKeyOfTile(tileId))
);

/**
 * Readies the morph for the page the wall is about to open. Called before the navigation: the
 * page reads its plan at its first render. `flies` (motion is not reduced): the wall's grown
 * tile is the card that flies to the page. Otherwise the page comes up as it does with motion
 * reduced. (The rules are the morph's: planPageFromWall in the grid's collectionMorphStore.)
 */
export const planPageFromWall = (flies: boolean): void => collectionFlight().planPageFromWall(flies);
