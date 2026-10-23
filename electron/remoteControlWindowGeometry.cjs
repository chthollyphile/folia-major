// electron/remoteControlWindowGeometry.cjs
// Where the remote control window opens, which part of it lets clicks through, and how far left
// it may be dragged. Pure: screen positions in, screen positions out.

// The window is one size for good: 4 px of room around a 594 x 176 card. The card in use is the
// right 420 of it; the 174 to its left hold the large cover of the idle look and are empty in use.
// The page lays itself out to the same numbers (src/components/remote/remote.css).
const REMOTE_CONTROL_WINDOW_WIDTH = 602;
const REMOTE_CONTROL_WINDOW_HEIGHT = 184;
const REMOTE_CONTROL_CARD_WIDTH = 594;
const REMOTE_CONTROL_SLEEVE_WIDTH = 174;
/** The window before it grew to the left. Electron centred it on the primary screen. */
const LEGACY_REMOTE_CONTROL_WINDOW_WIDTH = 428;

/** Where the window opens: the card in use exactly where the old, narrower window put it. */
function getInitialRemoteControlWindowPosition(workArea) {
  const legacyX = workArea.x + Math.floor((workArea.width - LEGACY_REMOTE_CONTROL_WINDOW_WIDTH) / 2);
  return {
    x: Math.max(workArea.x, legacyX - REMOTE_CONTROL_SLEEVE_WIDTH),
    y: workArea.y + Math.floor((workArea.height - REMOTE_CONTROL_WINDOW_HEIGHT) / 2),
  };
}

/** Whether a screen point is over the part of the window left of the card in use. */
function isPointOverRemoteControlStrip(bounds, point) {
  // The card is centred in the window, so a window manager that sizes the window differently moves it.
  const stripRight = bounds.x + Math.floor((bounds.width - REMOTE_CONTROL_CARD_WIDTH) / 2) + REMOTE_CONTROL_SLEEVE_WIDTH;
  return point.x >= bounds.x
    && point.x < stripRight
    && point.y >= bounds.y
    && point.y < bounds.y + bounds.height;
}

const containsPoint = (area, point) => (
  point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
);

const overlapArea = (a, b) => (
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
);

/**
 * The x the window may take, given the screens' bounds: its left edge, where the large cover sits,
 * stays on a screen. Over another screen is fine; past the outer left edge of the screen that
 * holds most of the window it is pushed back to that edge.
 */
function clampRemoteControlWindowX(bounds, screenBounds) {
  const leftEdge = { x: bounds.x, y: bounds.y + Math.floor(bounds.height / 2) };
  if (screenBounds.some(area => containsPoint(area, leftEdge))) {
    return bounds.x;
  }

  let home = null;
  let homeOverlap = 0;
  for (const area of screenBounds) {
    const overlap = overlapArea(area, bounds);
    if (overlap > homeOverlap) {
      home = area;
      homeOverlap = overlap;
    }
  }
  return home ? Math.max(bounds.x, home.x) : bounds.x;
}

/**
 * A remembered remote-control position, made safe to open at. The x is clamped the same way a drag
 * is; the y must still sit inside some screen, or the spot no longer exists (monitor unplugged,
 * resolution changed) and the caller falls back to the centred default. Returns null for an invalid
 * or absent saved position.
 */
function resolveRemoteControlWindowPosition(saved, screenBounds) {
  if (!saved || typeof saved !== 'object' || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return null;
  }

  const bounds = { x: saved.x, y: saved.y, width: REMOTE_CONTROL_WINDOW_WIDTH, height: REMOTE_CONTROL_WINDOW_HEIGHT };
  const onSomeScreen = screenBounds.some(area => (
    bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height
  ));
  if (!onSomeScreen) {
    return null;
  }

  return { x: clampRemoteControlWindowX(bounds, screenBounds), y: bounds.y };
}

module.exports = {
  REMOTE_CONTROL_WINDOW_WIDTH,
  REMOTE_CONTROL_WINDOW_HEIGHT,
  getInitialRemoteControlWindowPosition,
  isPointOverRemoteControlStrip,
  clampRemoteControlWindowX,
  resolveRemoteControlWindowPosition,
};
