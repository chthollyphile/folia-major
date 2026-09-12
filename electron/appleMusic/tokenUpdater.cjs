// electron/appleMusic/tokenUpdater.cjs

// Refresh a live SDK only when the signed token changes; concurrent IPC calls share the update.
function createTokenUpdater({ resolveToken, configure }) {
  let applied;
  let pending;
  function update() {
    if (pending) return pending;
    pending = (async () => {
      const token = await resolveToken();
      if (token !== applied) {
        await configure(token);
        applied = token;
      }
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return { update, reset: () => { applied = undefined; } };
}
module.exports = { createTokenUpdater };
