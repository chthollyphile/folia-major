// src/components/shared/sheetKeys.ts
// What a sheet does with Escape and with Tab, as rules without a DOM: Sheet.tsx listens for the
// keys and asks here.

type EscapeState = {
    /** Something inside the sheet already acted on the key. */
    taken: boolean;
    /** The key is held down and repeating. */
    held: boolean;
    /** An input method is composing text: Escape cancels the composition. */
    composing: boolean;
    /** A pick list or a menu inside the sheet is open: Escape closes that. */
    popupOpen: boolean;
    closeDisabled: boolean;
};

/** Whether Escape closes the topmost sheet. */
export const escapeCloses = ({ taken, held, composing, popupOpen, closeDisabled }: EscapeState): boolean => (
    !taken && !held && !composing && !popupOpen && !closeDisabled
);

/**
 * Where Tab goes so that focus stays in the sheet. `count` is how many parts of the sheet Tab stops
 * at and `current` the place of the focused one among them, -1 when focus is on none of them (on
 * the sheet itself, or outside it). Answers the place to focus, or null when the browser's own
 * step already stays inside.
 */
export const tabTarget = (count: number, current: number, backwards: boolean): number | null => {
    if (count === 0) {
        return null;
    }
    if (current < 0) {
        return backwards ? count - 1 : 0;
    }
    if (backwards) {
        return current === 0 ? count - 1 : null;
    }
    return current === count - 1 ? 0 : null;
};
