import { useState } from 'react';
import type { WallLayout } from './wallLayout';
import type { LatticeTile } from './latticeModel';
import type { ActiveLatticePoster } from './useLatticePlaybackFocus';

// src/components/app/lattice/useLatticePosterSelection.ts
// Preserve a selected tile across changes of the wall's list (a queue edit, other entries of the
// explore page), before a stale slot can reach the DOM.

export function useLatticePosterSelection(tiles: LatticeTile[], layout: WallLayout) {
    const [previousTiles, setPreviousTiles] = useState(tiles);
    const [selection, setSelection] = useState<ActiveLatticePoster | null>(null);
    let resolved = selection;
    if (previousTiles !== tiles) {
        if (selection) {
            const queueIndex = tiles.findIndex(tile => tile.id === selection.tile.id);
            const old = selection.instance;
            const instance = layout.nearest(queueIndex, {
                x: old.x + old.width / 2,
                y: old.y + old.height / 2,
            });
            resolved = instance ? { instance, tile: tiles[queueIndex] } : null;
        }
        // This guarded render adjustment avoids showing the new song at the old queue index
        // for one frame, and clearing a deleted selection prevents later resurrection.
        setPreviousTiles(tiles);
        setSelection(resolved);
    }
    return [resolved, setSelection] as const;
}
