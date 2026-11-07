// electron/quitShutdown.cjs
// Which quit asks the bridges to shut down. Every quit asks them: their work — a sign-in under way, a
// renewal whose answer is not stored yet, the player outside Folia — belongs to that quit. A quit
// that was cancelled halfway (another handler took it, a window refused to close) leaves nothing
// behind, so the next one asks again. The one quit that does not ask is the same quit asked for
// again after that work held it: their work must not be done twice (the player outside Folia is
// closed once, not on every quit).

/** Which quit asks the bridges to shut down (see the file header). */
function createQuitShutdownGate() {
  // Set by the quit that comes back after the bridges held it: that quit has been asked already.
  let resumed = false;
  return {
    /** Marks the quit that comes back after the bridges held it. */
    resume() {
      resumed = true;
    },
    /**
     * Whether this `before-quit` must ask the bridges. The mark is spent here, because the quit it
     * belongs to has arrived; a quit nobody held starts out asking.
     *
     * `holding`: a quit the bridges held is still under way, so this one is that quit asked for again,
     * not a new quit to ask for.
     */
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
