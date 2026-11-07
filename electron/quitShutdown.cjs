// electron/quitShutdown.cjs
// Which quit asks the bridges to shut down. Every quit of its own asks them: their work — a sign-in
// under way, a renewal whose answer is not stored yet, the player outside Folia — belongs to that
// quit, and a quit that was cancelled halfway (another handler took it, a window refused to close)
// leaves nothing behind for the next one, which asks again. The one quit that does not ask is the
// same quit asked for again after that work held it: the bridges were asked for by the quit they held,
// and their work must not be done twice (the player outside Folia is closed once, not on every quit).

/**
 * `resume()` marks the quit that is asked for again after the bridges held it, and `asks()` tells
 * whether this `before-quit` must ask them — consuming the mark, because the quit it belongs to has
 * arrived. `holding` is true while a quit the bridges held is still under way: that quit was asked
 * already, and a quit that arrives meanwhile is no new one to ask for. A quit nobody held starts out
 * asking.
 */
function createQuitShutdownGate() {
  let resumed = false;
  return {
    resume() {
      resumed = true;
    },
    asks({ holding = false } = {}) {
      if (holding) return false;
      const wasResumed = resumed;
      resumed = false;
      return !wasResumed;
    },
  };
}

module.exports = { createQuitShutdownGate };
