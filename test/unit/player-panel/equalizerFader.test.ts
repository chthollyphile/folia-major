import { describe, expect, it } from 'vitest';
import { faderKeyValue, faderValueAt, type FaderScale } from '@/components/panelTab/equalizer/Fader';

// test/unit/player-panel/equalizerFader.test.ts
// The two rules behind the equalizer's band fader (equalizer/Fader.tsx): which value lies under
// the pointer, and where a key moves the thumb. A wrong rule here writes a gain nobody chose (one
// off the step, past an end, or upside down) and nothing on the screen reports it.

const GAIN: FaderScale = { min: -12, max: 12, step: 1 };
/** A fader 148 px tall: the thumb's centre travels from 8 px to 140 px, 5.5 px for each dB. */
const TALL = 148;

describe('the value under the pointer', () => {
    it('has the largest value at the top and the smallest at the bottom', () => {
        expect(faderValueAt(8, TALL, GAIN)).toBe(12);
        expect(faderValueAt(140, TALL, GAIN)).toBe(-12);
        expect(faderValueAt(74, TALL, GAIN)).toBe(0);
    });

    it('stops at the ends half a thumb inside the part and anywhere beyond it', () => {
        for (const offset of [7, 0, -40, -4000]) {
            expect(faderValueAt(offset, TALL, GAIN), String(offset)).toBe(12);
        }
        for (const offset of [141, 148, 190, 4000]) {
            expect(faderValueAt(offset, TALL, GAIN), String(offset)).toBe(-12);
        }
    });

    it('lands on the nearest step', () => {
        // 5.5 px for each dB below the top end at 8 px.
        expect(faderValueAt(8 + 5.5 * 3, TALL, GAIN)).toBe(9);
        expect(faderValueAt(8 + 5.5 * 3 + 2, TALL, GAIN)).toBe(9);
        expect(faderValueAt(8 + 5.5 * 3 + 3, TALL, GAIN)).toBe(8);
        expect(faderValueAt(74 + 2, TALL, GAIN)).toBe(0);
        expect(faderValueAt(74 + 3, TALL, GAIN)).toBe(-1);
    });

    it('counts steps from the smallest value and keeps a fraction exact', () => {
        const scale: FaderScale = { min: 0.5, max: 2, step: 0.25 };
        const values = new Set<number>();
        for (let offset = 0; offset <= 116; offset += 1) {
            values.add(faderValueAt(offset, 116, scale));
        }
        expect([...values].sort((a, b) => a - b)).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    });

    it('gives a value on the scale for a fader with no room to travel', () => {
        for (const length of [0, 16, 9]) {
            expect(faderValueAt(4, length, GAIN), String(length)).toBe(0);
        }
    });
});

describe('the keys', () => {
    it('moves one step with an arrow and ten with Shift', () => {
        expect(faderKeyValue('ArrowUp', false, 0, GAIN)).toBe(1);
        expect(faderKeyValue('ArrowRight', false, 0, GAIN)).toBe(1);
        expect(faderKeyValue('ArrowDown', false, 0, GAIN)).toBe(-1);
        expect(faderKeyValue('ArrowLeft', false, 0, GAIN)).toBe(-1);
        expect(faderKeyValue('ArrowUp', true, 0, GAIN)).toBe(10);
        expect(faderKeyValue('ArrowDown', true, 3, GAIN)).toBe(-7);
    });

    it('stops at the ends', () => {
        expect(faderKeyValue('ArrowUp', false, 12, GAIN)).toBe(12);
        expect(faderKeyValue('ArrowUp', true, 5, GAIN)).toBe(12);
        expect(faderKeyValue('ArrowDown', false, -12, GAIN)).toBe(-12);
        expect(faderKeyValue('ArrowDown', true, -5, GAIN)).toBe(-12);
    });

    it('goes to the smallest value with Home and the largest with End', () => {
        expect(faderKeyValue('Home', false, 4, GAIN)).toBe(-12);
        expect(faderKeyValue('End', false, 4, GAIN)).toBe(12);
    });

    it('leaves every other key alone', () => {
        for (const key of ['Tab', 'Enter', ' ', 'Escape', 'PageUp', 'a']) {
            expect(faderKeyValue(key, false, 0, GAIN), key).toBeNull();
        }
    });
});
