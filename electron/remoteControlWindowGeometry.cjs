// electron/remoteControlWindowGeometry.cjs
// Where the remote control window opens, which part of it lets clicks through, how far left it
// may be dragged, and whether a remembered spot still fits. Pure: screen positions in, screen
// positions out.

// The window is one size, except while it shows the play queue (getRemoteControlQueueExpansion):
// then it grows down or up by the queue's height. 4 px of room around a 594 x 176 card. The card in use is the
// right 420 of it; the 174 to its left hold the large cover of the idle look and are empty in use
// (and always, with the switch "expand cover" off).
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

/** How wide the part of the window left of the card in use is. */
function getRemoteControlStripWidth(bounds) {
  // The card is centred in the window, so a window manager that sizes the window differently moves it.
  return Math.floor((bounds.width - REMOTE_CONTROL_CARD_WIDTH) / 2) + REMOTE_CONTROL_SLEEVE_WIDTH;
}

/** Whether a screen point is over the part of the window left of the card in use. */
function isPointOverRemoteControlStrip(bounds, point) {
  const stripRight = bounds.x + getRemoteControlStripWidth(bounds);
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
 * The x the window may take, given the screens' bounds: the left edge of what is drawn stays on a
 * screen. With the cover expanded that is the window's own left edge, where the large cover sits;
 * with it collapsed the strip left of the card is always empty, so it is the card in use's edge.
 * Over another screen is fine; past the outer left edge of the screen that holds most of what is
 * drawn it is pushed back to that edge.
 */
function clampRemoteControlWindowX(bounds, screenBounds, expandCover = true) {
  const inset = expandCover ? 0 : getRemoteControlStripWidth(bounds);
  const drawn = { x: bounds.x + inset, y: bounds.y, width: bounds.width - inset, height: bounds.height };
  const leftEdge = { x: drawn.x, y: drawn.y + Math.floor(drawn.height / 2) };
  if (screenBounds.some(area => containsPoint(area, leftEdge))) {
    return bounds.x;
  }

  let home = null;
  let homeOverlap = 0;
  for (const area of screenBounds) {
    const overlap = overlapArea(area, drawn);
    if (overlap > homeOverlap) {
      home = area;
      homeOverlap = overlap;
    }
  }
  return home ? Math.max(drawn.x, home.x) - inset : bounds.x;
}

/**
 * A remembered remote-control position, kept only if it can be opened at as it is: what is drawn
 * (the whole window with the cover expanded, the card in use with it collapsed, as in
 * clampRemoteControlWindowX) must sit wholly inside one screen's work area. Otherwise the spot no
 * longer exists (monitor unplugged, resolution changed) and the caller falls back to the centred
 * default. Returns null for an invalid or absent saved position.
 */
function resolveRemoteControlWindowPosition(saved, workAreas, expandCover = true) {
  if (!saved || typeof saved !== 'object' || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)
    || !Array.isArray(workAreas)) {
    return null;
  }

  const bounds = { x: saved.x, y: saved.y, width: REMOTE_CONTROL_WINDOW_WIDTH, height: REMOTE_CONTROL_WINDOW_HEIGHT };
  const inset = expandCover ? 0 : getRemoteControlStripWidth(bounds);
  const drawn = { x: bounds.x + inset, y: bounds.y, width: bounds.width - inset, height: bounds.height };
  const fitsOnSomeScreen = workAreas.some(area => (
    drawn.x >= area.x
    && drawn.y >= area.y
    && drawn.x + drawn.width <= area.x + area.width
    && drawn.y + drawn.height <= area.y + area.height
  ));
  return fitsOnSomeScreen ? { x: bounds.x, y: bounds.y } : null;
}

/**
 * The queue, squeezed into a short strip of screen, still keeps its search field and three rows:
 * 6 gap + 40 search + 3 x 36 rows + 6 (src/components/remote/useRemoteQueue.ts lays it out).
 */
const REMOTE_CONTROL_QUEUE_MIN_HEIGHT = 160;

/** @typedef {'down' | 'up'} RemoteControlQueueDirection */
/** @typedef {{ direction: RemoteControlQueueDirection, height: number }} RemoteControlQueueExpansion */

/**
 * Where the window grows to show the play queue: down when the work area has room below the
 * window, else up when it has room above, else towards the larger room, the queue cut to fit it
 * (but never below REMOTE_CONTROL_QUEUE_MIN_HEIGHT). `bounds` is the window without the queue.
 * `preferred` is the side the page has anchored the card for (a queue already shown, or one the
 * page asked where to put): it is kept, only the height changing, as long as that side still holds
 * the search field and three rows; otherwise the side is chosen afresh rather than run off the
 * screen. Without a work area (Wayland: a client is not told where its window is) it grows down,
 * uncut.
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {{ x: number, y: number, width: number, height: number } | null} workArea
 * @param {number} wantedHeight
 * @param {RemoteControlQueueDirection | null} [preferred]
 * @returns {RemoteControlQueueExpansion}
 */
function getRemoteControlQueueExpansion(bounds, workArea, wantedHeight, preferred = null) {
  const wanted = Math.max(0, Math.round(wantedHeight));
  if (!workArea) {
    return { direction: 'down', height: wanted };
  }

  const room = {
    down: workArea.y + workArea.height - (bounds.y + bounds.height),
    up: bounds.y - workArea.y,
  };
  const least = Math.min(wanted, REMOTE_CONTROL_QUEUE_MIN_HEIGHT);
  const side = preferred && room[preferred] >= least
    ? preferred
    : room.down >= wanted ? 'down' : room.up >= wanted ? 'up' : room.up > room.down ? 'up' : 'down';
  return { direction: side, height: Math.min(wanted, Math.max(least, room[side])) };
}

/**
 * The window's bounds with the queue shown (`expansion`) or not (null), from where the card sits.
 * @param {{ x: number, y: number }} cardPosition
 * @param {RemoteControlQueueExpansion | null} expansion
 */
function getRemoteControlWindowBounds(cardPosition, expansion) {
  const height = REMOTE_CONTROL_WINDOW_HEIGHT + (expansion ? expansion.height : 0);
  const y = expansion && expansion.direction === 'up' ? cardPosition.y - expansion.height : cardPosition.y;
  return { x: cardPosition.x, y, width: REMOTE_CONTROL_WINDOW_WIDTH, height };
}

/**
 * Where the window sits without the queue, from where it sits with it: the spot that is remembered.
 * @param {{ x: number, y: number }} bounds
 * @param {RemoteControlQueueExpansion | null} expansion
 */
function getRemoteControlCardPosition(bounds, expansion) {
  return {
    x: bounds.x,
    y: expansion && expansion.direction === 'up' ? bounds.y + expansion.height : bounds.y,
  };
}

module.exports = {
  REMOTE_CONTROL_WINDOW_WIDTH,
  REMOTE_CONTROL_WINDOW_HEIGHT,
  getRemoteControlQueueExpansion,
  getRemoteControlWindowBounds,
  getRemoteControlCardPosition,
  getInitialRemoteControlWindowPosition,
  isPointOverRemoteControlStrip,
  clampRemoteControlWindowX,
  resolveRemoteControlWindowPosition,
};
