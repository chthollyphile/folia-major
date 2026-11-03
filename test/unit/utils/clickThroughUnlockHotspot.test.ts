import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET,
    CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON,
    CLICK_THROUGH_MEDIA_CONTROLS_WIDTH,
    CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET,
    CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON,
    CLICK_THROUGH_UNLOCK_BUTTON_WIDTH,
    CLICK_THROUGH_UNLOCK_HOTSPOT,
    isWithinClickThroughUnlockHotspot,
} from '../../../src/utils/clickThroughUnlockHotspot';

// test/unit/utils/clickThroughUnlockHotspot.test.ts
// The click-through unlock button is hover-driven: while the window ignores mouse events it only
// becomes clickable once the cursor is inside the hotspot. Adding the titlebar fullscreen button
// shifted the button 44px left, out of the hotspot, so it could no longer be unlocked.

const VIEWPORT_WIDTH = 1920;
const BUTTON_CENTER_Y = 16;

describe('click-through unlock hotspot', () => {
    it.each([
        ['without the fullscreen button', CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET],
        ['with the fullscreen button', CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON],
    ])('covers the whole unlock button %s', (_label, rightOffset) => {
        const buttonRight = VIEWPORT_WIDTH - rightOffset;
        const buttonLeft = buttonRight - CLICK_THROUGH_UNLOCK_BUTTON_WIDTH;

        for (const x of [buttonLeft, buttonLeft + 1, (buttonLeft + buttonRight) / 2, buttonRight - 1, buttonRight]) {
            expect(isWithinClickThroughUnlockHotspot(x, BUTTON_CENTER_Y, VIEWPORT_WIDTH)).toBe(true);
        }
    });

    it.each([
        ['without the fullscreen button', CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET, CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET],
        ['with the fullscreen button', CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON, CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON],
    ])('covers the media buttons and the gap to the unlock button %s (#471)', (_label, rightOffset, unlockRightOffset) => {
        const groupRight = VIEWPORT_WIDTH - rightOffset;
        const groupLeft = groupRight - CLICK_THROUGH_MEDIA_CONTROLS_WIDTH;
        const unlockRight = VIEWPORT_WIDTH - unlockRightOffset;
        const unlockLeft = unlockRight - CLICK_THROUGH_UNLOCK_BUTTON_WIDTH;

        // The group sits clear of the unlock button, to its left; the cursor crosses the gap
        // between them, so the whole run from the group's left edge to the lock's right edge counts.
        expect(groupRight).toBeLessThan(unlockLeft);
        for (let x = groupLeft; x <= unlockRight; x += 1) {
            expect(isWithinClickThroughUnlockHotspot(x, BUTTON_CENTER_Y, VIEWPORT_WIDTH)).toBe(true);
        }
    });

    it('keeps clear of the caption buttons of a maximized window underneath', () => {
        // Windows draws minimize / maximize / close 46px wide each, so they reach 138px in.
        expect(isWithinClickThroughUnlockHotspot(VIEWPORT_WIDTH - 138, BUTTON_CENTER_Y, VIEWPORT_WIDTH)).toBe(false);
        expect(CLICK_THROUGH_UNLOCK_HOTSPOT.rightInset).toBeGreaterThanOrEqual(CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET - 4);
    });

    it('stays inactive away from the button and outside the vertical band', () => {
        const right = VIEWPORT_WIDTH - CLICK_THROUGH_UNLOCK_HOTSPOT.rightInset;
        expect(isWithinClickThroughUnlockHotspot(right + 1, BUTTON_CENTER_Y, VIEWPORT_WIDTH)).toBe(false);
        expect(isWithinClickThroughUnlockHotspot(right - CLICK_THROUGH_UNLOCK_HOTSPOT.width - 1, BUTTON_CENTER_Y, VIEWPORT_WIDTH)).toBe(false);
        expect(isWithinClickThroughUnlockHotspot(right - 10, CLICK_THROUGH_UNLOCK_HOTSPOT.topInset - 1, VIEWPORT_WIDTH)).toBe(false);
        expect(isWithinClickThroughUnlockHotspot(right - 10, CLICK_THROUGH_UNLOCK_HOTSPOT.topInset + CLICK_THROUGH_UNLOCK_HOTSPOT.height + 1, VIEWPORT_WIDTH)).toBe(false);
    });

    it('matches the rectangle the main process polls the cursor against', () => {
        const source = readFileSync(path.resolve(__dirname, '../../../electron/main.cjs'), 'utf8');
        const block = source.match(/const MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT = \{([^}]*)\};/)?.[1] ?? '';
        const readField = (name: string) => Number(block.match(new RegExp(`${name}:\\s*(\\d+)`))?.[1]);

        expect({
            width: readField('width'),
            height: readField('height'),
            rightInset: readField('rightInset'),
            topInset: readField('topInset'),
        }).toEqual(CLICK_THROUGH_UNLOCK_HOTSPOT);
    });
});
