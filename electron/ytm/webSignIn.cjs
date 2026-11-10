const fs = require('node:fs');
const { BrowserSignInError, cookieHeaderOf, isSignedIn } = require('./browserSignIn.cjs');
const { describeError, toErrorResult, ytmError } = require('./errors.cjs');
const { isUser } = require('./session.cjs');

// electron/ytm/webSignIn.cjs
// The web sign-in of YouTube Music. The listener signs in to YouTube Music in a browser of their
// own (browserSignIn.cjs); the account's requests then carry that browser's YouTube cookies.
// Here: the stored sign-in, the guard on where its headers may go, and the sign-in itself.
//
// Secrets. The Cookie header is the account. It is sealed where it is stored and goes into no log
// line, no error and no answer to the renderer; neither does the path of the sign-in folder. The
// account's name is in no log line or error either.

const WEB_SESSION_KEY = 'YTM_WEB_SESSION_V1';
// A sign-in window still open after this long is ended, and what it left is read: a person who
// signed in and left the window open keeps the sign-in (see `runOut`).
const SIGN_IN_LIMIT_MS = 10 * 60 * 1000;
// YouTube is asked whose the cookies are for this long at most. A connection can stay open and
// silent (a proxy that takes it and then says nothing), and the next start waits for this
// sign-in to settle. The sessions of ytmApiBridge.cjs wait as long for theirs.
const ACCOUNT_LIMIT_MS = 45 * 1000;
// A sign-in folder that could not be removed is tried again this long after the last try.
const SWEEP_AGAIN_MS = 60 * 1000;
// What a start is refused with while the folder of an earlier sign-in cannot be removed.
const FOLDER_IN_USE = 'The folder of an earlier YouTube Music sign-in could not be removed; a browser may still be open on it';
const ACCOUNT_ORIGINS = Object.freeze(['https://www.youtube.com', 'https://music.youtube.com']);
const ACCOUNT_HEADERS = Object.freeze(['Cookie', 'Authorization', 'X-Goog-AuthUser', 'X-Goog-PageId']);

// The browser name the account's requests are sent under: a desktop Chrome of the version this
// app is built on, written as Chrome writes it (the major version alone, one fixed system each).
const desktopChromeName = (version = process.versions.chrome, platform = process.platform) => {
  const system = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${String(version).split('.')[0]}.0.0.0 Safari/537.36`;
};

// The fetch the session of the web sign-in is given. The account's headers leave only towards
// YouTube's two hosts; towards any other address they are taken off the request.
// A request that carries them is not followed through a redirect either: the new address would
// be chosen below this guard, where nobody judges it. Measured in Electron 43.7.5 (2026-10-09,
// two local servers): with 'follow' the other origin was sent Authorization, X-Goog-AuthUser and
// X-Goog-PageId (not Cookie); with 'error' the fetch failed and nothing was sent there.
const guardAccountHeaders = fetch => (input, init = {}) => {
  const address = new URL(typeof input === 'string' ? input : input.href ?? input.url);
  const headers = new Headers(init.headers ?? input.headers);
  if (ACCOUNT_ORIGINS.includes(address.origin)) {
    return fetch(input, ACCOUNT_HEADERS.some(name => headers.has(name)) ? { ...init, redirect: 'error' } : init);
  }
  for (const name of ACCOUNT_HEADERS) headers.delete(name);
  return fetch(input, { ...init, headers });
};

// Whether a text can be the value of a request header: visible ASCII and spaces, nothing else.
const isHeaderValue = text => /^[\x20-\x7e]*$/.test(text);

const isWebSession = value => Boolean(value && value.version === 1 && typeof value.cookie === 'string' && value.cookie
  && typeof value.userAgent === 'string' && value.userAgent && isUser(value.user) && Number.isFinite(value.storedAt));

// The stored web sign-in: sealed with the OS keychain, kept for this run only where that is
// unavailable or is Linux's plain `basic_text` backend, and never written plain.
function createYtmWebSessionRepository({
  store, safeStorage, now = Date.now, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
}) {
  let loaded = false;
  let current = null;
  // A sign-in is stored that this run could not read for want of OS encryption (see `get`).
  let unread = false;
  const canEncrypt = () => safeStorage?.isEncryptionAvailable()
    && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  // Where nothing can be sealed, the sign-in of this run still replaces the stored one: that one
  // is deleted, so an older account cannot come back at a later start. Where the store cannot be
  // written (a file locked for a moment), what is stored stays as it was, unless it is another
  // account's: `replaced` is the sign-in a new one takes the place of (`set`), and where its account
  // is not the new one's, it is deleted as well. The first is said once a run.
  let toldUnsealed = false;
  const persist = (replaced = null) => {
    if (!canEncrypt()) {
      store.delete(WEB_SESSION_KEY);
      if (!toldUnsealed) warn('[Ytm] Web sign-in is kept for this run only: OS encryption is unavailable');
      toldUnsealed = true;
      return;
    }
    try {
      store.set(WEB_SESSION_KEY, safeStorage.encryptString(JSON.stringify(current)).toString('base64'));
    } catch (error) {
      let removed = false;
      if (replaced && replaced.user.id !== current.user.id) {
        try {
          store.delete(WEB_SESSION_KEY);
          removed = true;
        } catch { /* as locked as the write: what is stored stays, as said below */ }
      }
      warn(`[Ytm] Web sign-in could not be stored; ${removed ? 'the one of another account stored before was removed' : 'what is stored stays as it was'}`, error);
    }
  };
  return {
    get() {
      if (loaded) return current;
      loaded = true;
      try {
        const sealed = store.get(WEB_SESSION_KEY);
        if (typeof sealed !== 'string') {
          log('[Ytm] No stored web sign-in');
          return null;
        }
        // Only a run without OS encryption leaves it unread, for a run that has it. What does not
        // unseal while encryption works (sealed by another OS account, a keychain that was reset,
        // damaged) is nothing stored.
        if (!canEncrypt()) {
          unread = true;
          warn('[Ytm] Stored web sign-in cannot be read: OS encryption is unavailable');
          return null;
        }
        const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
        if (isWebSession(value)) current = value;
      } catch { /* damaged, or sealed by another OS account: reported below */ }
      if (current) log(`[Ytm] Stored web sign-in restored, made ${Math.round((now() - current.storedAt) / 3600000)}h ago`);
      else warn('[Ytm] Stored web sign-in could not be restored');
      return current;
    },
    // `cookie` is the Cookie header for youtube.com, `userAgent` the browser name its requests go under.
    set({ cookie, userAgent, user }) {
      const value = { version: 1, cookie, userAgent, user: { ...user }, storedAt: now() };
      if (!isWebSession(value)) throw new Error('Invalid YouTube Music web session');
      const replaced = canEncrypt() ? this.get() : null;
      loaded = true;
      current = value;
      persist(replaced);
    },
    // Whether the account has Premium was learnt anew (`user.premium`). The stored sign-in stays
    // the object it was: a request under way tells by it whether the sign-in changed meanwhile.
    setPremium(premium) {
      if (!this.get() || current.user.premium === premium) return;
      current.user.premium = premium;
      persist();
    },
    // Whether a sign-in is stored that this run could not read (see `get`): who is signed in is
    // then not known, which is not the same as nobody.
    unreadable() {
      return !this.get() && unread;
    },
    clear() {
      loaded = true;
      current = null;
      unread = false;
      store.delete(WEB_SESSION_KEY);
    },
  };
}

// The sign-in itself, one at a time. `browser` is browserSignIn.cjs's, `profileDir()` the folder
// its window runs on. `accountOf({ cookie, userAgent })` asks YouTube whose the cookies are and
// throws when they are nobody's; `keep({ cookie, userAgent, user })` stores the sign-in.
//
// The folder holds the listener's whole Google session once they have signed in, and only
// YouTube's cookies are kept: it is removed when a sign-in ends, however it ends, and a folder
// an earlier run left is removed before a browser is started on it. A removal that fails is
// tried again (`sweepIfLeft`), and a quit waits for one under way (`quit`).
function createYtmWebSignIn({
  // `exists` asks about the path itself: a link that points nowhere is there, and is removed.
  browser, profileDir, accountOf, keep, browserName = desktopChromeName, exists = dir => Boolean(fs.lstatSync(dir, { throwIfNoEntry: false })),
  now = Date.now, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
}) {
  // The sign-in under way, or the last one until the next start: its outcome is asked for later.
  let current = null;
  // Resolves when the browser of the last sign-in has ended and its folder is gone.
  let lastSettled = Promise.resolve();
  let folderWork = Promise.resolve();
  // What a quit waits for: resolves once the browser of the last sign-in has ended and its
  // folder was removed, or could not be. null when no browser is to end and no folder to remove.
  let leaving = null;
  // Whether a folder may be on disk that nothing is about to remove. Not known until this run
  // has looked (an earlier run may have left one); after that, what the last removal answered.
  let mayBeLeft = true;
  let sweptAt = -Infinity;
  let sweeping = false;

  // Removals take turns, and answer whether the folder is gone. A folder a running browser still
  // holds stays; removeProfile says so. `left` says that no sign-in of this run has a browser on
  // the folder: one that still runs there was left by an earlier run, and is ended first.
  const clearFolder = (left = false) => {
    folderWork = folderWork.then(async () => {
      const dir = profileDir();
      if (!dir || !exists(dir)) return true;
      const ended = !left || await browser.endLeftBrowsers(dir);
      return await browser.removeProfile(dir) && ended;
    }).catch(error => {
      // A removal that threw has not removed the folder; the turns after it still get theirs.
      warn(`[Ytm] The removal of the sign-in folder failed (${error?.code ?? 'unknown'})`);
      return false;
    }).then(cleared => {
      mayBeLeft = !cleared;
      return cleared;
    });
    return folderWork;
  };
  // Removes a folder that was left, once no sign-in's browser is still to end.
  const sweep = () => lastSettled.then(() => clearFolder(true));

  // A sign-in leaves 'waiting' once, with one log line.
  const conclude = (login, state, words, say = log) => {
    clearTimeout(login.limit);
    login.state = state;
    say(`[Ytm] Web sign-in after ${now() - login.startedAt}ms: ${words}`);
  };
  // Ends a sign-in that still waits: its browser is ended, and nothing in its folder is read.
  const end = (login, words) => {
    if (login?.state !== 'waiting') return;
    conclude(login, 'expired', words);
    login.opened?.stop();
  };
  // The time for a sign-in is over and its window is still open: the browser is ended, and its
  // folder is read as after a window that was closed. Ended on Windows, a browser has no time
  // to write what it has not written yet; Chromium writes its cookies within half a minute of a
  // change, so a sign-in made earlier than that is in the folder, and YouTube is asked whether
  // the cookies are an account's before anything is kept. Where the folder holds no sign-in, or
  // cannot be read, the sign-in is given up, as before.
  const runOut = login => {
    if (login.state !== 'waiting') return;
    login.ranOut = true;
    log(`[Ytm] The time for the web sign-in is over after ${now() - login.startedAt}ms: its browser is ended, and its folder read`);
    login.opened.stop();
  };
  // YouTube asked whose the cookies are, given up after ACCOUNT_LIMIT_MS.
  const askAccount = signIn => {
    let limit;
    return Promise.race([
      accountOf(signIn),
      new Promise((_, reject) => {
        limit = setTimeout(() => reject(ytmError('network', 'YouTube Music did not answer', `no answer in ${ACCOUNT_LIMIT_MS}ms`, 'no-answer')), ACCOUNT_LIMIT_MS);
      }),
    ]).finally(() => clearTimeout(limit));
  };

  // Runs once the browser of a sign-in has ended, however it ended. `folderDone()` is called
  // when the folder was removed or could not be: a quit waits until then and no longer.
  const settle = async (login, browserPath, outcome, folderDone) => {
    let cookies = [];
    let failure;
    if (login.state === 'waiting') {
      // 'at-once': nobody closed a window. A running browser holds the folder, or the browser cannot start.
      // 'stopped' is read only where the time for the sign-in ran out (runOut).
      if (outcome !== 'closed' && !(outcome === 'stopped' && login.ranOut)) failure = new BrowserSignInError('exited');
      else cookies = await browser.readCookies(browserPath, profileDir()).catch(error => { failure = error; return []; });
    }
    await clearFolder();
    folderDone();
    try {
      if (login.state !== 'waiting') return;
      if (login.ranOut && (failure || !isSignedIn(cookies))) {
        conclude(login, 'expired', `given up, the time for it is over${failure ? `; the browser's folder could not be read (${failure.code ?? 'unknown'})` : ''}`);
        return;
      }
      if (failure) throw failure;
      if (!isSignedIn(cookies)) {
        conclude(login, 'expired', 'the browser was closed without a sign-in');
        return;
      }
      const signIn = { cookie: cookieHeaderOf(cookies), userAgent: browserName() };
      // A cookie with a character no header may carry is refused here, before the header is
      // used or stored: where a request is made it is refused by an error that quotes it whole.
      if (!isHeaderValue(signIn.cookie)) throw new BrowserSignInError('protocol');
      const user = await askAccount(signIn);
      // Cancelled, given up or started again while YouTube was asked: nothing is kept.
      if (login.state !== 'waiting') return;
      keep({ ...signIn, user });
      login.user = user;
      conclude(login, 'confirmed', 'signed in');
    } catch (error) {
      if (login.state !== 'waiting') return;
      // What the renderer is told of the failure: the code, the sentence and, where there is one, the reason.
      login.failure = toErrorResult(error).error;
      conclude(login, 'error', `failed, ${describeError(error)}`, warn);
    }
  };

  return {
    // Opens the sign-in window and answers at once; `check()` says how the sign-in stands.
    async start() {
      const dir = profileDir();
      const browserPath = dir ? browser.findBrowser() : null;
      if (!browserPath) throw ytmError('unsupported', 'No browser for the YouTube Music sign-in was found', undefined, 'no-browser');
      // A second start takes the place of a sign-in under way.
      end(current, 'replaced by a new start');
      const login = { state: 'waiting', startedAt: now() };
      current = login;
      const cleared = await sweep();
      // Cancelled or started again while the folder was being cleared.
      if (login.state !== 'waiting') throw ytmError('unavailable', 'YouTube Music sign-in was cancelled or started again');
      // A browser an earlier run left could not be ended, or something still holds the folder.
      // No second browser is started there: it would hand its start over to the first.
      if (!cleared) {
        const refusal = ytmError('unavailable', FOLDER_IN_USE, undefined, 'folder-in-use');
        login.failure = toErrorResult(refusal).error;
        conclude(login, 'error', 'not started, the folder of an earlier sign-in is still in use', warn);
        throw refusal;
      }
      login.opened = browser.openSignIn(browserPath, dir);
      login.limit = setTimeout(() => runOut(login), SIGN_IN_LIMIT_MS);
      login.limit.unref?.();
      let folderDone;
      const gone = new Promise(resolve => { folderDone = resolve; }).then(() => {
        if (leaving === gone) leaving = null;
      });
      leaving = gone;
      lastSettled = login.opened.closed.then(outcome => settle(login, browserPath, outcome, folderDone));
      return {};
    },
    // { state: 'waiting' | 'confirmed' | 'expired' | 'error' }, with `user` once confirmed and,
    // after an error, its `code`, its `message` and (where there is one) its `reason`.
    check() {
      if (!current) return { state: 'expired' };
      const { state, user, failure } = current;
      return { state, ...(user ? { user } : {}), ...failure };
    },
    cancel(words = 'cancelled') {
      end(current, words);
      current = null;
    },
    sweep,
    // Called with every request. Removes a folder that was left, by an earlier run or by a
    // removal of this run that failed, and takes only a success for done: after a failure the
    // removal is tried again with a later request, SWEEP_AGAIN_MS later at the earliest.
    sweepIfLeft() {
      if (!mayBeLeft || sweeping || now() - sweptAt < SWEEP_AGAIN_MS) return;
      sweeping = true;
      sweptAt = now();
      const done = () => { sweeping = false; };
      sweep().then(done, done);
    },
    // The app is quitting: a sign-in under way is ended. Answers what the quit is to wait for
    // (see `leaving`), or null when there is nothing.
    quit() {
      this.cancel('the app is quitting');
      return leaving;
    },
  };
}

module.exports = {
  createYtmWebSessionRepository, createYtmWebSignIn, desktopChromeName, guardAccountHeaders, WEB_SESSION_KEY,
};
