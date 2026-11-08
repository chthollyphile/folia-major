import { describe, expect, it } from 'vitest';
import type { MouseEvent } from 'react';
import { isWallDoubleClickOn, noteWallPress } from '../../../src/components/wall/wallDoubleClick';

// A double click on a wall acts only on the card its first click hit (#834).

const click = (detail: number) => ({ detail }) as MouseEvent<HTMLElement>;

describe('wallDoubleClick', () => {
    it('notes the card of a first click', () => {
        noteWallPress(click(1), 'lattice:a:song-1');
        expect(isWallDoubleClickOn('lattice:a:song-1')).toBe(true);
    });

    it('keeps the first click when the second lands on another card', () => {
        noteWallPress(click(1), 'lattice:a:song-1');
        noteWallPress(click(2), 'lattice:b:song-2');
        expect(isWallDoubleClickOn('lattice:b:song-2')).toBe(false);
        expect(isWallDoubleClickOn('lattice:a:song-1')).toBe(true);
    });

    it('does not count a slot whose item changed between the clicks', () => {
        noteWallPress(click(1), 'bravais:0:0:card:folder:x');
        expect(isWallDoubleClickOn('bravais:0:0:track:first')).toBe(false);
    });

    it('matches no card when the first click hit a control', () => {
        noteWallPress(click(1), 'lattice:a:song-1');
        noteWallPress(click(1), '');
        expect(isWallDoubleClickOn('lattice:a:song-1')).toBe(false);
    });
});
