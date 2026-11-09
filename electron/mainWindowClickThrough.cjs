// Calculates the native unlock hotspot and coordinates renderer requests with cursor polling.
function isCursorInsideUnlockHotspot({ bounds, cursor, hotspot, viewportWidth, viewportOrigin, scale = 1 }) {
  const width = viewportWidth == null ? bounds.width : Math.min(bounds.width, viewportWidth * scale);
  const origin = Number.isFinite(viewportOrigin) && viewportOrigin >= bounds.x && viewportOrigin + width <= bounds.x + bounds.width + 2
    ? viewportOrigin : bounds.x;
  const right = origin + width - hotspot.rightInset * scale;
  const top = bounds.y + hotspot.topInset * scale;
  return cursor.x >= right - hotspot.width * scale && cursor.x <= right
    && cursor.y >= top && cursor.y <= top + hotspot.height * scale;
}

function createUnlockHoverRequests({ platform, pollCursor, setHover }) {
  let viewportWidth = null;
  let originOffset = 0;
  return {
    getViewportWidth: () => viewportWidth,
    getViewportOrigin: (bounds) => bounds.x + originOffset,
    handle(active, width, coordinates, bounds, scale = 1) {
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

module.exports = { isCursorInsideUnlockHotspot, createUnlockHoverRequests };
