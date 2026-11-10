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
// reaches over them as well: an 86px group at `right-[214px]`, or `right-[258px]` with fullscreen.
// It only grows leftward: its right edge stays 176px in, clear of the caption buttons (about 138px
// on Windows) of a maximized window underneath, which would otherwise land on these buttons.

export const CLICK_THROUGH_UNLOCK_HOTSPOT = {
    width: 172,
    height: 40,
    rightInset: 176,
    topInset: 4,
} as const;

// Right-edge offsets (px from the window's right edge) of the unlock button in AppShell.
export const CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET = 180;
export const CLICK_THROUGH_UNLOCK_BUTTON_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON = 224;
export const CLICK_THROUGH_UNLOCK_BUTTON_WIDTH = 28;

// Right-edge offsets and width of the media button group beside the unlock button in AppShell.
export const CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET = 214;
export const CLICK_THROUGH_MEDIA_CONTROLS_RIGHT_OFFSET_WITH_FULLSCREEN_BUTTON = 258;
export const CLICK_THROUGH_MEDIA_CONTROLS_WIDTH = 86;

// One window button is 44px wide (`w-11` in WindowControls).
export const WINDOW_CONTROL_BUTTON_WIDTH = 44;
// Room left for the macOS traffic lights when the drawn buttons share the left edge with them.
export const NATIVE_TRAFFIC_LIGHTS_RESERVED_WIDTH = 76;
// The lock starts 4px past the window buttons; the media group ends 6px before the lock.
export const CLICK_THROUGH_UNLOCK_BUTTON_GAP = 4;
export const CLICK_THROUGH_MEDIA_CONTROLS_GAP = 6;

// How far the window buttons reach in from their edge. With the macOS traffic lights the drawn
// minimize / maximize / close are gone: only remote control and fullscreen are left, and on the
// left they start after the traffic lights. The main process shifts its hotspot by the same
// amounts (`resolveUnlockHotspot` in electron/mainWindowClickThrough.cjs).
export const resolveWindowControlsExtent = ({ hasFullscreenButton, nativeTrafficLights, side }: {
    hasFullscreenButton: boolean;
    nativeTrafficLights: boolean;
    side: 'left' | 'right';
}): number => {
    const optional = hasFullscreenButton ? 1 : 0;
    if (!nativeTrafficLights) return (4 + optional) * WINDOW_CONTROL_BUTTON_WIDTH;
    return (side === 'left' ? NATIVE_TRAFFIC_LIGHTS_RESERVED_WIDTH : 0) + (1 + optional) * WINDOW_CONTROL_BUTTON_WIDTH;
};

// With the window buttons on the left (`titlebarSide`) the row is mirrored: the same offsets count
// from the left edge, and the hotspot covers 176px to 348px in from the left.
//
// Whether a viewport point lies inside the unlock hotspot of a window `viewportWidth` px wide.
// With the window buttons on the left the whole row is mirrored, so the point is mirrored too.
export const isWithinClickThroughUnlockHotspot = (
    clientX: number,
    clientY: number,
    viewportWidth: number,
    side: 'left' | 'right' = 'right',
): boolean => {
    if (side === 'left') clientX = viewportWidth - clientX;
    const right = viewportWidth - CLICK_THROUGH_UNLOCK_HOTSPOT.rightInset;
    const left = right - CLICK_THROUGH_UNLOCK_HOTSPOT.width;
    const top = CLICK_THROUGH_UNLOCK_HOTSPOT.topInset;
    const bottom = top + CLICK_THROUGH_UNLOCK_HOTSPOT.height;
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
};
