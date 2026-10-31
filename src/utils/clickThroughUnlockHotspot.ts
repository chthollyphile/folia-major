// src/utils/clickThroughUnlockHotspot.ts
// Geometry of the hover hotspot that temporarily lifts `setIgnoreMouseEvents` while click-through is
// on, so the unlock button (AppShell) stays clickable. The main process polls the cursor against the
// same rectangle (`MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT` in electron/main.cjs), so the two
// constants must stay identical.
//
// The unlock button sits at `right-[180px]` normally and at `right-[224px]` while the titlebar shows
// the fullscreen button (AppShell). It is 28px wide (`w-7`). The hotspot has to cover both spots,
// otherwise the button is revealed beside the hotspot and moving onto it drops the unlock again.

export const CLICK_THROUGH_UNLOCK_HOTSPOT = {
    width: 84,
    height: 40,
    rightInset: 176,
    topInset: 4,
} as const;

// Right-edge offsets (px from the window's right edge) of the unlock button in AppShell.
export const CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET = 224;
export const CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON = 300;
export const CLICK_THROUGH_UNLOCK_BUTTON_WIDTH = 28;

// Whether a viewport point lies inside the unlock hotspot of a window `viewportWidth` px wide.
export const isWithinClickThroughUnlockHotspot = (
    clientX: number,
    clientY: number,
    viewportWidth: number,
): boolean => {
    const right = viewportWidth - CLICK_THROUGH_UNLOCK_HOTSPOT.rightInset;
    const left = right - CLICK_THROUGH_UNLOCK_HOTSPOT.width;
    const top = CLICK_THROUGH_UNLOCK_HOTSPOT.topInset;
    const bottom = top + CLICK_THROUGH_UNLOCK_HOTSPOT.height;
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
};
