// electron/ytm/poToken.cjs
// YouTube's audio servers answer its web player only when the request carries a "proof of origin"
// token, made by Google's BotGuard script; without one they answer 403. BotGuard is third-party
// code that changes without notice, so it runs in the sandbox page. The two requests around it
// (for the script, and to trade its answer for an integrity token) are made from here, and only
// finished tokens leave the page.

// The key YouTube's web player names itself with when it asks for a BotGuard script.
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const SIGNALS = '__foliaYtmSignals';
const MINT = '__foliaYtmMint';
// Google says how long its integrity token lasts (twelve hours when measured); this stands in
// when it does not.
const DEFAULT_LIFETIME_MS = 6 * 60 * 60 * 1000;
// Every track waits for the set-up, so a request that gets no answer is given up.
const REQUEST_LIMIT_MS = 15000;

// ESM-only, and needed only once a track is played, so it loads on first use.
const loadBotGuardLibrary = async () => {
  const [botguard, utils] = await Promise.all([import('bgutils-js/botguard'), import('bgutils-js/utils')]);
  return { getChallenge: botguard.getChallenge, buildURL: utils.buildURL, getHeaders: utils.getHeaders };
};

// Page script: starts the BotGuard program and resolves to its answer. The minter factory the
// program hands out stays in the page.
const runProgram = challenge => `(async () => {
  const vm = globalThis[${JSON.stringify(challenge.globalName)}];
  if (!vm || typeof vm.a !== 'function') throw new Error('BotGuard is unavailable');
  let started;
  const functions = new Promise(resolve => { started = resolve; });
  const quiet = () => {};
  await vm.a(${JSON.stringify(challenge.program)}, snapshot => started(snapshot), true, undefined, quiet, [[], []], undefined, false, [quiet, quiet, quiet, quiet, quiet]);
  const snapshot = await functions;
  const signals = [];
  const answer = await new Promise(resolve => snapshot(resolve, [undefined, undefined, signals, undefined]));
  globalThis.${SIGNALS} = signals;
  return answer;
})()`;

// Page script: turns the integrity token into a function that mints a token for one binding.
const installMinter = integrityToken => `(async () => {
  const standard = ${JSON.stringify(integrityToken)}.split('-').join('+').split('_').join('/').split('.').join('=');
  const mint = await globalThis.${SIGNALS}[0](Uint8Array.from(atob(standard), char => char.charCodeAt(0)));
  if (typeof mint !== 'function') throw new Error('BotGuard returned no minter');
  globalThis.${MINT} = async binding => {
    const bytes = await mint(new TextEncoder().encode(binding));
    return btoa(String.fromCharCode(...bytes)).split('+').join('-').split('/').join('_');
  };
  return true;
})()`;

// Page script: null when the page holds no minter (it was replaced since the last set-up).
const mintIn = binding => `(typeof globalThis.${MINT} === 'function' ? globalThis.${MINT}(${JSON.stringify(binding)}) : null)`;

// `fetch` reaches Google; `evaluate(code)` runs a script in the sandbox page and resolves to its result.
function createYtmTokenMinter({ fetch, evaluate, loadLibrary = loadBotGuardLibrary, now = Date.now }) {
  let current = null;
  const ask = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_LIMIT_MS) });

  // Both requests go to www.youtube.com, like the web player's own.
  const setUp = async () => {
    const { getChallenge, buildURL, getHeaders } = await loadLibrary();
    const challenge = await getChallenge({ fetchFunction: ask, requestKey: REQUEST_KEY, useYouTubeAPI: true });
    const interpreter = challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreter || !challenge.program || !challenge.globalName) throw new Error('BotGuard challenge is incomplete');
    await evaluate(`(() => { ${interpreter}\n })(); true`);
    const answer = await evaluate(runProgram(challenge));
    const response = await ask(buildURL('GenerateIT', true), {
      method: 'POST', headers: getHeaders(), body: JSON.stringify([REQUEST_KEY, answer]),
    });
    if (!response.ok) throw new Error(`BotGuard answer was refused (status ${response.status})`);
    const [integrityToken, lifetimeSeconds] = await response.json();
    if (typeof integrityToken !== 'string' || !integrityToken) throw new Error('BotGuard returned no integrity token');
    await evaluate(installMinter(integrityToken));
    return Number(lifetimeSeconds) > 0 ? Number(lifetimeSeconds) * 1000 : DEFAULT_LIFETIME_MS;
  };

  // One set-up at a time, shared by concurrent callers and replaced at half the token's lifetime.
  const minter = () => {
    if (!current || (current.until !== null && now() >= current.until)) {
      const holder = { ready: null, until: null };
      holder.ready = setUp().then(lifetimeMs => { holder.until = now() + lifetimeMs / 2; });
      holder.ready.catch(() => { if (current === holder) current = null; });
      current = holder;
    }
    return current;
  };

  return {
    // Resolves to a token bound to `binding` (a video id): it unlocks that track's audio only.
    async mint(binding) {
      let holder = minter();
      await holder.ready;
      let token = await evaluate(mintIn(binding));
      if (typeof token !== 'string') {
        if (current === holder) current = null;
        holder = minter();
        await holder.ready;
        token = await evaluate(mintIn(binding));
      }
      if (typeof token !== 'string' || !token) throw new Error('BotGuard minted no token');
      return token;
    },
  };
}

module.exports = { createYtmTokenMinter };
