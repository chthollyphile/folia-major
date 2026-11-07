// electron/quitShutdown.cjs
// Which quit asks the bridges to shut down. Every quit asks them: their work — a sign-in under way, a
// renewal whose answer is not stored yet, the player outside Folia — belongs to that quit. A quit
// that was cancelled halfway (another handler took it, a window refused to close) leaves nothing
// behind, so the next one asks again. The one quit that does not ask is the same quit asked for
// again after that work held it: their work must not be done twice (the player outside Folia is
// closed once, not on every quit).

/**
 * `resume()` marks the quit that comes back after the bridges held it; `asks()` reports whether this
 * `before-quit` must ask them, consuming the mark because the quit it belongs to has arrived.
 * `holding` is true while a quit the bridges held is still under way: that quit was asked already,
 * and one arriving meanwhile is no new quit to ask for. It spends the mark too, so the quit after it
 * asks rather than inheriting the answer. A quit nobody held starts out asking.
 */
function createQuitShutdownGate() {
  let resumed = false;
  return {
    resume() {
      resumed = true;
    },
    asks({ holding = false } = {}) {
      // Spent by whichever quit arrives, the held one included: a quit that comes while the bridges
      // still hold another is the quit they were asked for, and the quit after it is a new one.
      const wasResumed = resumed;
      resumed = false;
      if (holding) return false;
      return !wasResumed;
    },
  };
}

module.exports = { createQuitShutdownGate };
