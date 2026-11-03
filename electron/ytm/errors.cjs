const { BrowserSignInError } = require('./browserSignIn.cjs');

// electron/ytm/errors.cjs

// The codes the renderer understands (`ProviderErrorCode` in src/types/onlineMusic.ts).
const CODES = new Set(['auth-required', 'unsupported', 'unavailable', 'not-playable', 'region-restricted', 'network', 'invalid-response']);

class YtmError extends Error {
  // `detail` is what the other side said, for the log; the renderer gets the code and the message.
  // `reason` is this process's own word for why a sign-in failed, where it has one; the renderer
  // gets it too, and sorts the failure by it (src/services/onlineMusic/ytm/ytmLoginFailure.ts).
  constructor(code, message, detail, reason) {
    super(message);
    this.name = 'YtmError';
    this.code = code;
    if (detail) this.detail = detail;
    if (reason) this.reason = reason;
  }
}

const ytmError = (code, message, detail, reason) => new YtmError(code, message, detail, reason);

// Why the browser of the web sign-in gave no cookies (BrowserSignInError's codes), as the
// renderer is told.
const BROWSER_FAILURES = Object.freeze({
  'not-started': ['unavailable', 'The browser for the YouTube Music sign-in could not be started'],
  exited: ['unavailable', 'The browser for the YouTube Music sign-in ended without an answer'],
  timeout: ['unavailable', 'The browser for the YouTube Music sign-in did not answer in time'],
  protocol: ['invalid-response', 'The browser for the YouTube Music sign-in gave an answer that could not be used'],
});

// Library and network exceptions carry request URLs and response bodies; only a code and a fixed
// sentence leave the main process, and with them the `reason` a sign-in failed for: the one a
// YtmError was given, or the code of the BrowserSignInError.
function toErrorResult(error) {
  if (error instanceof YtmError && CODES.has(error.code)) {
    return { ok: false, error: { code: error.code, message: error.message, ...(error.reason ? { reason: error.reason } : {}) } };
  }
  if (error instanceof BrowserSignInError && BROWSER_FAILURES[error.code]) {
    const [code, message] = BROWSER_FAILURES[error.code];
    return { ok: false, error: { code, message, reason: error.code } };
  }
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  // YouTube asks to wait: a sentence of its own, so the renderer can tell it from a network that
  // fails (src/services/onlineMusic/ytm/ytmFailure.ts). The code stays the one of an unreachable service.
  if (/status code 429\b/i.test(text)) {
    return { ok: false, error: { code: 'network', message: 'YouTube Music asked to wait before trying again' } };
  }
  if (/fetch failed|net::|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|socket|TimeoutError|AbortError|status code 5\d\d\b/i.test(text)) {
    return { ok: false, error: { code: 'network', message: 'YouTube Music could not be reached' } };
  }
  return { ok: false, error: { code: 'invalid-response', message: 'YouTube Music operation failed' } };
}

// What a log line says about a failure: the code the renderer gets and the failure's own words,
// without the addresses (plain or JSON-escaped), file paths and long tokens that library,
// network and file exceptions carry. A path has the name of the computer's user in it. One is
// taken to start at a drive letter, at "\\server", or at /Users/ or /home/; a folder's name may
// hold spaces ("Application Support"), so it runs through its last separator and then to the
// next space or quote. (Any other POSIX path goes only where it is a long token.)
function describeError(error) {
  const words = String(error?.detail ?? error?.message ?? error).replace(/https?:\\*\/\\*\/\S+/gi, '<address>')
    .replace(/(?:\b[a-z]:|\\\\[^\\/\s'"<>|?*:]+|(?=\/(?:Users|home)\/))[\\/](?:[^\\/\r\n'"<>|?*:]*[\\/])*[^\\/\s'"<>|?*:]*/gi, '<path>')
    .replace(/[\w.~+/=%-]{32,}/g, '<long>').slice(0, 160);
  return `${toErrorResult(error).error.code} (${words})`;
}

module.exports = { YtmError, describeError, toErrorResult, ytmError };
