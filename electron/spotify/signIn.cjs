const crypto = require('node:crypto');
const http = require('node:http');
const { describeError, lineReason, spotifyError, statusError } = require('./errors.cjs');

// electron/spotify/signIn.cjs
// Sign-in in the listener's own browser: Spotify's consent page, which sends the browser back to
// a loopback address this process listens on while one attempt lasts (authorization code with
// PKCE, no secret). The listener types nothing here and sets nothing up. Spotify knows the app as
// its own desktop client, the identity the open-source players sign in with: an app registered
// by us may have five users, each entered by hand in Spotify's dashboard.

const CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
// The redirect this client was measured with (2026-10-08). Whether Spotify accepts another port
// for it was not measured: it checks the address only after the person has signed in.
const PORT = 5588;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/login`;
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const ATTEMPT_MS = 10 * 60 * 1000;
// A token request that is not answered in this time has failed; without a limit it could wait for ever.
const REQUEST_LIMIT_MS = 30 * 1000;
// What the open-source players ask for with this client (librespot's list).
const SCOPES = [
  'app-remote-control', 'playlist-modify', 'playlist-modify-private', 'playlist-modify-public', 'playlist-read',
  'playlist-read-collaborative', 'playlist-read-private', 'streaming', 'ugc-image-upload', 'user-follow-modify',
  'user-follow-read', 'user-library-modify', 'user-library-read', 'user-modify', 'user-modify-playback-state',
  'user-modify-private', 'user-personalized', 'user-read-birthdate', 'user-read-currently-playing', 'user-read-email',
  'user-read-play-history', 'user-read-playback-position', 'user-read-playback-state', 'user-read-private',
  'user-read-recently-played', 'user-top-read',
].join(' ');

// The page the browser is left on. It is the only text of the app shown outside its window.
const PAGE_TEXT = Object.freeze({
  'zh-CN': { done: '已登录 Spotify，可以回到 Folia 了。', refused: '未授权。请回到 Folia 重试。', failed: '登录未完成。请回到 Folia 重试。' },
  'zh-TW': { done: '已登入 Spotify，可以回到 Folia 了。', refused: '未授權。請回到 Folia 重試。', failed: '登入未完成。請回到 Folia 重試。' },
  en: { done: 'Signed in to Spotify. You can go back to Folia.', refused: 'Not authorized. Try again in Folia.', failed: 'Sign-in not completed. Try again in Folia.' },
  in: { done: 'Sudah masuk ke Spotify. Anda bisa kembali ke Folia.', refused: 'Tidak diizinkan. Coba lagi di Folia.', failed: 'Proses masuk belum selesai. Coba lagi di Folia.' },
  vi: { done: 'Đã đăng nhập Spotify. Bạn có thể quay lại Folia.', refused: 'Chưa được ủy quyền. Vui lòng thử lại trong Folia.', failed: 'Đăng nhập chưa hoàn tất. Vui lòng thử lại trong Folia.' },
});
const pageOf = text => `<!doctype html><meta charset="utf-8"><title>Folia</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#121212;color:#fff;font:16px system-ui,sans-serif">${text}</body>`;
const PAGE_HEADERS = Object.freeze({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
// The reason word for the `error` Spotify sends the browser back with in place of a code (the
// words of OAuth 2.0, RFC 6749 4.1.2.1). Any other word Spotify gives is a refusal; with none,
// nothing is known.
const RETURN_REASONS = Object.freeze({ access_denied: 'access-denied', server_error: 'unreachable', temporarily_unavailable: 'asked-to-wait' });

const base64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createSpotifySignIn({
  fetch, openExternal, language = () => 'zh-CN', now = Date.now, createServer = () => http.createServer(),
  randomBytes = size => crypto.randomBytes(size), log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
}) {
  let pending = null;

  // Asks Spotify's token endpoint; the answer is `{ access_token, refresh_token, expires_at }`.
  const tokens = async (fields, kept) => {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_LIMIT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }).toString(),
    });
    const body = await response.json().catch(() => null);
    // The grant itself was refused: it was revoked, or it is past the six months Spotify gives one.
    if (body?.error === 'invalid_grant') throw spotifyError('auth-required', 'Spotify no longer accepts the sign-in', 'invalid_grant');
    const refreshToken = body?.refresh_token ?? kept;
    if (!response.ok || typeof body?.access_token !== 'string' || typeof refreshToken !== 'string') {
      throw statusError(response.status, 'invalid-response', 'Spotify did not issue a token', `HTTP ${response.status} ${body?.error ?? ''}`);
    }
    return { access_token: body.access_token, refresh_token: refreshToken, expires_at: now() + Math.max(60, Number(body.expires_in) || 3600) * 1000 };
  };

  const stopListening = attempt => {
    clearTimeout(attempt.timer);
    attempt.server.close();
    attempt.server.closeAllConnections?.();
  };
  const drop = () => {
    if (pending) stopListening(pending);
    pending = null;
  };

  // Spotify sends the browser back here once, with a code or with the reason there is none.
  const answer = (attempt, request, response) => {
    // Anything on this machine may knock while the port is open, also with a request line that
    // is no address (`GET //`): it is answered like any other stranger, never thrown on.
    let url = null;
    try { url = new URL(request.url, REDIRECT_URI); } catch { /* answered below */ }
    if (!url || request.method !== 'GET' || url.pathname !== '/login') {
      response.writeHead(404).end();
      return;
    }
    const text = PAGE_TEXT[language()] ?? PAGE_TEXT.en;
    // Not this attempt's answer: most likely Spotify's answer to one a later start replaced, from
    // a tab that was still open. That tab is told the sign-in did not complete; nothing of the
    // attempt open now changes.
    if (url.searchParams.get('state') !== attempt.state) {
      response.writeHead(200, PAGE_HEADERS).end(pageOf(text.failed));
      return;
    }
    if (attempt.settling) {
      response.writeHead(404).end();
      return;
    }
    attempt.settling = true;
    const leave = (words, outcome) => {
      attempt.outcome = outcome;
      response.writeHead(200, PAGE_HEADERS);
      response.end(pageOf(words), () => stopListening(attempt));
    };
    const code = url.searchParams.get('code');
    if (!code) {
      const said = url.searchParams.get('error');
      const reason = Object.hasOwn(RETURN_REASONS, said ?? '') ? RETURN_REASONS[said] : said ? 'refused' : 'sign-in-failed';
      warn(`[Spotify] Sign-in was not completed: ${reason}`);
      leave(reason === 'access-denied' ? text.refused : text.failed, { error: reason });
      return;
    }
    tokens({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: attempt.verifier }).then(
      issued => leave(text.done, { tokens: issued }),
      error => {
        warn(`[Spotify] The code Spotify sent back was not exchanged: ${describeError(error)}`);
        // Why, where it is known: the line failed, or Spotify refused the code itself (invalid_grant).
        leave(text.failed, { error: lineReason(error) ?? (error?.code === 'auth-required' ? 'refused' : 'sign-in-failed') });
      },
    );
  };

  return {
    // Begins an attempt, replacing one still open: there is one address to come back to.
    async start() {
      drop();
      const verifier = base64url(randomBytes(64));
      const attempt = {
        key: randomBytes(16).toString('hex'), verifier, state: base64url(randomBytes(16)), server: createServer(),
        expiresAt: now() + ATTEMPT_MS, outcome: null, settling: false, timer: null,
      };
      attempt.page = `${AUTHORIZE_URL}?${new URLSearchParams({
        response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPES,
        code_challenge_method: 'S256', code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()), state: attempt.state,
      })}`;
      attempt.server.on('request', (request, response) => answer(attempt, request, response));
      await new Promise((resolve, reject) => {
        attempt.server.once('error', error => reject(spotifyError('unavailable', 'Spotify sign-in could not listen for the answer', error?.code, 'cannot-listen')));
        attempt.server.listen(PORT, '127.0.0.1', resolve);
      });
      attempt.timer = setTimeout(() => stopListening(attempt), ATTEMPT_MS);
      attempt.timer.unref?.();
      pending = attempt;
      log(`[Spotify] Sign-in is waiting on 127.0.0.1:${PORT} for ${ATTEMPT_MS / 60000} min`);
      return { key: attempt.key, expiresInMs: ATTEMPT_MS };
    },
    // Opens Spotify's page from here, so no caller-supplied address reaches the shell.
    async open(key) {
      if (pending?.key !== key || pending.outcome) return false;
      await openExternal(pending.page);
      return true;
    },
    // `approved` carries the tokens; the caller ends the attempt with `finish` once it has used them.
    check(key) {
      if (pending?.key !== key) return { state: 'expired' };
      if (pending.outcome?.tokens) return { state: 'approved', tokens: pending.outcome.tokens };
      if (pending.outcome) {
        const message = pending.outcome.error;
        drop();
        return { state: 'error', message };
      }
      if (now() >= pending.expiresAt) {
        drop();
        return { state: 'expired' };
      }
      return { state: 'waiting' };
    },
    holds: key => pending?.key === key,
    finish(key) { if (pending?.key === key) drop(); },
    cancel() { drop(); },
    renew: refreshToken => tokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken),
  };
}

module.exports = { createSpotifySignIn, CLIENT_ID, PORT, REDIRECT_URI };
