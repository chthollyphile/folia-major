const os = require('node:os');

// The renderers' tile memory budget, raised above Chromium's default. Chromium sizes it for a web
// page (blink GetGpuMemoryPolicy: 1152 MB x screen pixels / (2056 x 1329 x 4), at least 512 MB, at
// most a quarter of RAM): 874 MB on a 4K screen. A song change in the player keeps two full-window
// backgrounds and the lyric layers alive at once; past the budget Chromium leaves whole layers out
// of a frame, which shows as colour blocks flashing. Folia doubles the per-pixel figure, still at
// least 512 MB and at most a quarter of RAM: a 1080p screen keeps Chromium's 512 MB, which its
// smaller layers already fit, and a 4K screen gets 1748 MB. While the player shows, the pool keeps
// freed tiles for reuse, so use sits near the budget; a hidden window gives them back.
const SWITCH = 'force-gpu-mem-available-mb';
const MB = 1024 * 1024;
const HEADROOM = 2;

/** Folia's budget in MB for a screen of this many physical pixels. */
function raisedTileBudgetMb(screenPixels, totalMemBytes) {
  const scaled = (1152 * screenPixels) / (2056 * 1329 * 4);
  return Math.round(Math.min(Math.max(scaled * HEADROOM, 512), totalMemBytes / MB / 4));
}

/**
 * Sets the budget for the largest screen. Called after ready (the screen module needs it) and before
 * the first window: a renderer copies the switch when it starts. One passed on the command line wins.
 */
function applyTileMemoryBudget(app, screen) {
  if (app.commandLine.hasSwitch(SWITCH)) return;
  const screenPixels = Math.max(0, ...screen.getAllDisplays().map(display => (
    Math.round(display.size.width * display.scaleFactor) * Math.round(display.size.height * display.scaleFactor)
  )));
  app.commandLine.appendSwitch(SWITCH, String(raisedTileBudgetMb(screenPixels, os.totalmem())));
}

module.exports = { applyTileMemoryBudget, raisedTileBudgetMb };
