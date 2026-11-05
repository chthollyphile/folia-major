// src/utils/clickThroughUnlockHotspot.ts
// Geometry of the hover hotspot that temporarily lifts `setIgnoreMouseEvents` while click-through is
// on, so the unlock button (AppShell) stays clickable. The main process polls the cursor against the
// same rectangle (`MAIN_WINDOW_CLICK_THROUGH_UNLOCK_HOTSPOT` in electron/main.cjs), so the two
// constants must stay identical.
//
// The unlock button sits at `right-[180px]` normally and at `right-[224px]` while the titlebar shows
// the fullscreen button (AppShell). It is 28px wide (`w-7`). The hotspot has to cover both spots,
// otherwise the button is revealed beside the hotspot and moving onto it drops the unlock again.
// The media buttons to its left (ClickThroughMediaControls, #471) come up with it, so the hotspot
// reaches over them as well: an 86px group separated by 1px from the lock, at 209px from the right edge,
// or 253px with fullscreen. The hotspot conservatively covers the whole joined row.
// It only grows leftward: its right edge stays 176px in, clear of the caption buttons (about 138px
// on Windows) of a maximized window underneath, which would otherwise land on these buttons.

export const CLICK_THROUGH_UNLOCK_HOTSPOT = {
    width: 172,
    height: 40,
    rightInset: 176,
    topInset: 4,
    leftShift: 4,
} as const;

// Right-edge offsets (px from the window's right edge) of the unlock button in AppShell.
export const CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET = 180;
export const CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON = 224;
export const CLICK_THROUGH_UNLOCK_BUTTON_WIDTH = 28;

// Right-edge offsets and width of the media button group beside the unlock button in AppShell.
export const CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET = 209;
export const CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON = 253;
export const CLICK_THROUGH_MEDIA_CONTROLS_WIDTH = 86;

// Whether a viewport point lies inside the unlock hotspot of a window `viewportWidth` px wide.
export const isWithinClickThroughUnlockHotspot = (
    clientX: number,
    clientY: number,
    viewportWidth: number,
    side: 'left' | 'right' = 'right',
): boolean => {
    if (side === 'left') clientX = viewportWidth - clientX + CLICK_THROUGH_UNLOCK_HOTSPOT.leftShift;
    const right = viewportWidth - CLICK_THROUGH_UNLOCK_HOTSPOT.rightInset;
    const left = right - CLICK_THROUGH_UNLOCK_HOTSPOT.width;
    const top = CLICK_THROUGH_UNLOCK_HOTSPOT.topInset;
    const bottom = top + CLICK_THROUGH_UNLOCK_HOTSPOT.height;
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
};
