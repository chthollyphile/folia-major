import { describe, expect, it } from 'vitest';
import { escapeCloses, tabTarget } from '../../../src/components/shared/sheetKeys';

// test/unit/shared/sheetKeys.test.ts
// The two keyboard rules of the shared sheet. Nobody tries them by hand on every dialog, and each
// has a way of being wrong that looks fine with a mouse: Escape closing the sheet under an open
// pick list, and Tab walking out of the sheet into the page behind it.

describe('whether Escape closes the topmost sheet', () => {
    const free = { taken: false, held: false, composing: false, popupOpen: false, closeDisabled: false };

    it('closes it when nothing else has a claim on the key', () => {
        expect(escapeCloses(free)).toBe(true);
    });

    it.each([
        ['a part inside already acted on the key', { taken: true }],
        ['the key is held and repeating', { held: true }],
        ['an input method is composing', { composing: true }],
        ['a pick list or a menu inside is open', { popupOpen: true }],
        ['the caller has locked the close', { closeDisabled: true }],
    ])('does not close it when %s', (_reason, claim) => {
        expect(escapeCloses({ ...free, ...claim })).toBe(false);
    });
});

describe('where Tab goes so that focus stays in the sheet', () => {
    it('wraps from the last stop to the first', () => {
        expect(tabTarget(3, 2, false)).toBe(0);
    });

    it('wraps from the first stop back to the last', () => {
        expect(tabTarget(3, 0, true)).toBe(2);
    });

    it('leaves a step between two stops to the browser', () => {
        expect(tabTarget(3, 0, false)).toBeNull();
        expect(tabTarget(3, 1, false)).toBeNull();
        expect(tabTarget(3, 2, true)).toBeNull();
        expect(tabTarget(3, 1, true)).toBeNull();
    });

    // Focus on the sheet itself or on the page behind: the browser's own step would leave the sheet.
    it('goes to the first stop, or the last going backwards, when focus is on none of them', () => {
        expect(tabTarget(3, -1, false)).toBe(0);
        expect(tabTarget(3, -1, true)).toBe(2);
    });

    it('keeps a single stop focused both ways', () => {
        expect(tabTarget(1, 0, false)).toBe(0);
        expect(tabTarget(1, 0, true)).toBe(0);
    });

    it('has nowhere to go in a sheet without stops', () => {
        expect(tabTarget(0, -1, false)).toBeNull();
        expect(tabTarget(0, -1, true)).toBeNull();
    });
});
