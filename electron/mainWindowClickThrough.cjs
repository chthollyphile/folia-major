// Calculates the native unlock hotspot and coordinates renderer requests with cursor polling.
function isCursorInsideUnlockHotspot({ bounds, cursor, hotspot, viewportWidth, viewportOrigin, scale = 1, side = 'right' }) {
  const width = viewportWidth == null ? bounds.width : Math.min(bounds.width, viewportWidth * scale);
  const origin = Number.isFinite(viewportOrigin) && viewportOrigin >= bounds.x && viewportOrigin + width <= bounds.x + bounds.width + 2
    ? viewportOrigin : bounds.x;
  // Left-side window buttons mirror the row: the hotspot starts rightInset in from the left edge.
  const right = side === 'left'
    ? origin + (hotspot.rightInset + hotspot.width) * scale
    : origin + width - hotspot.rightInset * scale;
  const top = bounds.y + hotspot.topInset * scale;
  return cursor.x >= right - hotspot.width * scale && cursor.x <= right
    && cursor.y >= top && cursor.y <= top + hotspot.height * scale;
}

// With the macOS traffic lights the drawn minimize / maximize / close are gone, so the lock and the
// media buttons sit three buttons (132px) closer to the edge. On the left they also clear the
// traffic lights (76px). Same numbers as resolveWindowControlsExtent in clickThroughUnlockHotspot.ts.
const NATIVE_TRAFFIC_LIGHTS_DROPPED_BUTTONS_WIDTH = 132;
const NATIVE_TRAFFIC_LIGHTS_RESERVED_WIDTH = 76;

function resolveUnlockHotspot(hotspot, { nativeTrafficLights = false, side = 'right' } = {}) {
  if (!nativeTrafficLights) return hotspot;
  const shift = NATIVE_TRAFFIC_LIGHTS_DROPPED_BUTTONS_WIDTH - (side === 'left' ? NATIVE_TRAFFIC_LIGHTS_RESERVED_WIDTH : 0);
  return { ...hotspot, rightInset: hotspot.rightInset - shift };
}

function createUnlockHoverRequests({ platform, pollCursor, setHover }) {
  let side = 'right';
  let viewportWidth = null;
  let originOffset = 0;
  return {
    getSide: () => side,
    getViewportWidth: () => viewportWidth,
    getViewportOrigin: (bounds) => bounds.x + originOffset,
    handle(active, width, coordinates, bounds, scale = 1, nextSide) {
      if (nextSide === 'left' || nextSide === 'right') side = nextSide;
      if (platform !== 'darwin') return setHover(active);
      if (typeof width === 'number' && Number.isFinite(width) && width > 0) viewportWidth = width;
      if (coordinates && bounds && Number.isFinite(coordinates.screenX) && Number.isFinite(coordinates.clientX)) {
        const offset = coordinates.screenX - coordinates.clientX * scale - bounds.x;
        if (offset >= 0 && offset + width * scale <= bounds.width + 2) originOffset = offset;
      }
      // Only the native cursor decides hover on macOS, including after a delayed mouseleave.
      return pollCursor();
    },
  };
}

module.exports = { isCursorInsideUnlockHotspot, createUnlockHoverRequests, resolveUnlockHotspot };
