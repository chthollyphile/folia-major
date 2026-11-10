import { useAppViewStore, type LatticeSource } from '../../../stores/useAppViewStore';
import type { LocateRequest } from '../../../stores/usePlayingSongLocatorStore';
import { answerLocateRequest, locatePlayingSongOnPage } from '../playing-song-locator/playingSongLocator';

// src/components/app/lattice/wallLocate.ts
// The wall's part in "locate the playing song" (playing-song-locator/). The wall is asked as a
// collection's page is, under a page key of its own, and answers as one: the request, the status
// line and the button's states are the locator's. What is the wall's own is the answer: the
// song's tile grows and the camera goes to it (useLatticePlaybackFocus.ts).

/**
 * The key a wall is asked under: one for the wall of the play queue, one for the wall of the
 * explore page's entries. No collection's page has such a key (`collectionKey` begins with the
 * collection's source).
 */
export const wallPageKey = (source: LatticeSource): string => `lattice:${source}`;

/** The page key of the wall that is up. */
export const useWallPageKey = (): string => useAppViewStore(state => wallPageKey(state.latticeSource));

/**
 * The press of the wall's locate button, and of whatever stands for it: the command, and the
 * now-playing card and bar that lie over the wall.
 */
export const locatePlayingSongOnWall = (): void => (
    locatePlayingSongOnPage(wallPageKey(useAppViewStore.getState().latticeSource))
);

/**
 * The wall's answer to a locate request: a question put to another page is left alone; the tile
 * of the song is shown (`showTile`), or the locator is told that this wall has none.
 */
export const answerWallLocate = (
    request: LocateRequest | null,
    pageKey: string,
    tiles: readonly { id: string }[],
    showTile: (tileId: string) => void,
): void => {
    if (!request || request.collectionKey !== pageKey) return;
    const isHere = tiles.some(tile => tile.id === request.songKey);
    if (isHere) showTile(request.songKey);
    console.log(`[Locate] The wall (${pageKey}, ${tiles.length} tiles) ${isHere ? 'went to the tile of the playing song' : 'has no tile of the playing song'}`);
    answerLocateRequest(request.nonce, isHere);
};
