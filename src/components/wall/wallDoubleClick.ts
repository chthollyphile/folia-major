import type { MouseEvent } from 'react';

// src/components/wall/wallDoubleClick.ts
// Which card a double click on a wall belongs to (#834). The browser sends `dblclick` to whatever
// the second click hit, without checking it is what the first click hit, and the first click moves
// the wall: Lattice pans the grown poster to the middle, Bravais pushes a collection's layer and
// flips its first song into the pressed slot. So a card acts on a double click only when the first
// click of it landed on that same card, showing the same item.

let firstPressKey: string | null = null;

/** A click on a card: the first click of a run notes the card it hit. */
export const noteWallPress = (event: MouseEvent<HTMLElement>, cardKey: string) => {
    if (event.detail === 1) firstPressKey = cardKey;
};

/** Whether this double click's first click landed on the same card. */
export const isWallDoubleClickOn = (cardKey: string) => firstPressKey === cardKey;
