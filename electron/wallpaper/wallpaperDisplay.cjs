// electron/wallpaper/wallpaperDisplay.cjs
// The display the user chose for wallpaper mode (Settings → Desktop), stored in the main-process
// store under `wallpaper_display` as null or { id, bounds: { x, y, width, height }, label }.
//
// null (or nothing stored) is the automatic rule each platform had before there was a choice:
// Windows follows the app window (windowsWallpaperTarget.cjs), macOS and X11 use the primary
// display. A choice whose display is not connected resolves to nothing, and the caller falls back
// to that same rule.
//
// No Electron in here: every function takes plain display records ({ id, bounds, label,
// scaleFactor }, the shape of Electron's Display), so the rules are unit-testable headless.

const WALLPAPER_DISPLAY_SETTING_KEY = 'wallpaper_display';

// Electron reports -1 for a display whose id is not known yet and -10 for a virtual display on a
// unified desktop; neither can be matched against a later display list, so those fall back to
// matching by geometry.
function isUsableDisplayId(id) {
  return Number.isInteger(id) && id > 0;
}

function isBounds(bounds) {
  return Boolean(bounds)
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height);
}

function sameBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function copyBounds(bounds) {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

// A choice as it is stored: id, geometry and label, nothing else. Given what the store holds it
// reads the choice back, and anything that is not a whole choice (a hand-edited file) counts as no
// choice; given a connected display it makes the value to store for it.
function normalizeWallpaperDisplayChoice(value) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.id) || !isBounds(value.bounds)) {
    return null;
  }
  return {
    id: value.id,
    bounds: copyBounds(value.bounds),
    label: typeof value.label === 'string' ? value.label : '',
  };
}

// The connected display a choice (or any remembered { id, bounds }) points at: by id when the
// platform reported a usable one, by exact geometry otherwise (also covers an id that changed
// since it was remembered). null when there is no choice or its display is not connected.
function resolveWallpaperDisplay(displays, choice) {
  if (!choice || !Array.isArray(displays)) {
    return null;
  }
  if (isUsableDisplayId(choice.id)) {
    const byId = displays.find((display) => display && display.id === choice.id);
    if (byId) {
      return byId;
    }
  }
  if (!isBounds(choice.bounds)) {
    return null;
  }
  return displays.find((display) => display && isBounds(display.bounds) && sameBounds(display.bounds, choice.bounds)) || null;
}

// Whether two records name one display: the same usable id (its geometry may have changed), or
// the same geometry.
function isSameDisplay(a, b) {
  if (!a || !b) {
    return false;
  }
  if (isUsableDisplayId(a.id) && a.id === b.id) {
    return true;
  }
  return isBounds(a.bounds) && isBounds(b.bounds) && sameBounds(a.bounds, b.bounds);
}

// Asked after the choice or the display list changed, while a wallpaper is up on `current`
// ({ id, bounds }): does the wallpaper have to go to another display? Yes when the chosen display
// is connected and the wallpaper is elsewhere, and when the wallpaper sits on the chosen display
// and that display is gone. Without a choice it is never yes: the automatic rule keeps the
// wallpaper where it is.
function shouldMoveWallpaper(displays, choice, current) {
  if (!choice || !current || !Array.isArray(displays) || !displays.length) {
    return false;
  }
  const chosen = resolveWallpaperDisplay(displays, choice);
  if (chosen) {
    return !isSameDisplay(chosen, current);
  }
  return isSameDisplay(choice, current);
}

// What the settings page is told: the connected displays, the stored choice, which connected
// display that choice is (`chosenId`), and which display the wallpaper is on, or would be on if
// it were entered now (`activeId`).
function describeWallpaperDisplays({ displays, primaryId, choice, active }) {
  const connected = (Array.isArray(displays) ? displays : []).filter((display) => display && isBounds(display.bounds));
  const chosen = resolveWallpaperDisplay(connected, choice);
  return {
    displays: connected.map((display) => ({
      id: display.id,
      label: typeof display.label === 'string' ? display.label : '',
      bounds: copyBounds(display.bounds),
      scaleFactor: Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1,
      primary: display.id === primaryId,
    })),
    choice: choice ?? null,
    chosenId: chosen ? chosen.id : null,
    activeId: active ? active.id : null,
  };
}

module.exports = {
  WALLPAPER_DISPLAY_SETTING_KEY,
  isUsableDisplayId,
  normalizeWallpaperDisplayChoice,
  resolveWallpaperDisplay,
  isSameDisplay,
  shouldMoveWallpaper,
  describeWallpaperDisplays,
};
