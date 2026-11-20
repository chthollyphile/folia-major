// electron/spotify/errors.cjs
// What a failed Spotify request becomes on its way out of the main process: for the renderer a
// code it understands and a fixed sentence, for the log the failure's own words with addresses
// and tokens taken out.

// The codes the renderer understands (`ProviderErrorCode` in src/types/onlineMusic.ts).
const CODES = new Set(['auth-required', 'unsupported', 'unavailable', 'not-playable', 'preview-only', 'subscription-required', 'region-restricted', 'network', 'invalid-response']);

class SpotifyError extends Error {
  // `detail` is what the other side said, for the log; the renderer gets the code and the message.
  // `reason` is this process's own word for why a sign-in failed, where it has one; the renderer
  // gets it too, and sorts the failure by it (src/services/onlineMusic/spotify/spotifyLoginFailure.ts).
  constructor(code, message, detail, reason) {
    super(message);
    this.name = 'SpotifyError';
    this.code = code;
    if (detail) this.detail = detail;
    if (reason) this.reason = reason;
  }
}

const spotifyError = (code, message, detail, reason) => new SpotifyError(code, message, detail, reason);

// Spotify asks to wait (429): a sentence of its own, so the renderer can tell it from a network
// that fails (src/services/onlineMusic/spotify/spotifyFailure.ts). The code stays the one of an
// unreachable service.
const ASKED_TO_WAIT = 'Spotify asked to wait before trying again';

// What an answer of Spotify's that is no success is thrown as: 429 and 5xx under the code of a
// service that cannot be reached (asked again later, it may answer), 429 with the sentence above;
// any other status under `code`, with `message`.
const statusError = (status, code, message, detail) => (status === 429
  ? spotifyError('network', ASKED_TO_WAIT, detail)
  : spotifyError(status >= 500 ? 'network' : code, message, detail));

// Network exceptions carry request addresses; only a code, a fixed sentence and, where the main
// process named one, its reason word leave the main process.
function toErrorResult(error) {
  if (error instanceof SpotifyError && CODES.has(error.code)) {
    return { ok: false, error: { code: error.code, message: error.message, ...(error.reason ? { reason: error.reason } : {}) } };
  }
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  if (/fetch failed|net::|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|socket|TimeoutError|AbortError/i.test(text)) {
    return { ok: false, error: { code: 'network', message: 'Spotify could not be reached' } };
  }
  return { ok: false, error: { code: 'invalid-response', message: 'Spotify operation failed' } };
}

// The reason word a sign-in is told with when a request to Spotify it waited on failed on the
// line (src/services/onlineMusic/spotify/spotifyLoginFailure.ts): no answer within the request's
// limit (nothing else stops these requests), Spotify asked to wait, or it could not be reached
// (a network that fails, 5xx). undefined for any other failure.
function lineReason(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'no-answer';
  const { code, message } = toErrorResult(error).error;
  if (code !== 'network') return undefined;
  return message === ASKED_TO_WAIT ? 'asked-to-wait' : 'unreachable';
}

// What a log line says about a failure: the code the renderer gets and the failure's own words,
// without the addresses and long tokens that network exceptions carry.
const plainWords = text => String(text).replace(/https?:\\*\/\\*\/\S+/gi, '<address>')
  .replace(/[\w.~+/=%-]{32,}/g, '<long>').slice(0, 160);
function describeError(error) {
  return `${toErrorResult(error).error.code} (${plainWords(error?.detail ?? error?.message ?? error)})`;
}

module.exports = { SpotifyError, describeError, lineReason, plainWords, spotifyError, statusError, toErrorResult };
