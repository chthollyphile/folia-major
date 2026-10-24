const crypto = require('node:crypto');
const { parseRangeHeader } = require('../transcode/protocol.cjs');
const { TrackBuffer, createByteLru } = require('./trackBuffer.cjs');
const { VIDEO_ID } = require('./tiles.cjs');
const { YtmError, describeError, toErrorResult, ytmError } = require('./errors.cjs');

// electron/ytm/audio.cjs

const YTM_AUDIO_SCHEME = 'folia-ytm';
const YTM_AUDIO_PRIVILEGED_SCHEME = {
  scheme: YTM_AUDIO_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

// The quality levels a track is kept at. A plan, a buffered track and a URL are of one track at
// one level: the same track asked at another level is planned and downloaded as another file.
// 'ultra' is offered to a Premium member's account only. A track that cannot be had at it is
// served at 'high', and is then kept, addressed and named as the 'high' track it is (`issue`).
const YTM_AUDIO_LEVELS = ['standard', 'high', 'ultra'];

// What `loadPlan` rejects with for a playable track whose answer holds no format of the level
// 'ultra'. That is known of the track from then on (`issue`); any other failure at that level
// may pass.
class NoUltraFormat extends YtmError {
  constructor() { super('not-playable', 'YouTube Music offered no audio of the level ultra for this track'); }
}

const MAX_ISSUED_KEYS = 512;
// A connection can go quiet without closing. A download that brings nothing for this long (twice
// the stream's own stall check) is stopped, and the next request for the track plans it again.
const STALL_MS = 30000;
// A plan takes a second or two, and up to half a minute right after the app starts on a slow
// line. One that YouTube never answers must not keep the track loading for good.
const PLAN_LIMIT_MS = 60000;
// When a download breaks, the audio element asks for the rest until about thirty requests have
// failed: half a minute when they fail at once. Those requests plan the track again no sooner
// than this after its last attempt: a short network drop heals, and YouTube is not asked thirty
// times.
const RETRY_GAP_MS = 3000;
// The element counts failed requests, not time, and an attempt at a plan can take up to its
// limit to fail, which would stretch the half minute to many. Requests for the bytes that have
// found no plan for this long are answered with a status instead, and the renderer takes over.
const HEAL_MS = 30000;
// The element asks again within a second or two of a failed request. With no failed attempt for
// this long the asking had stopped (the listener moved on, or the element gave up), and the half
// minute starts again with the next request: the line may be back.
const QUIET_MS = 10000;
// A new plan helps a broken download only so often. A track given this many of them in this
// time is left alone until the time has passed, however the element and the renderer go on
// reacting. Attempts that made no plan do not count, so an outage refuses nothing afterwards.
const MAX_REPLANS = 4;
const REPLAN_WINDOW_MS = 5 * 60 * 1000;

// Serves tracks to the renderer as `folia-ytm://audio/<videoId>/<level>?k=<key>`.
// `loadPlan(videoId, failed, level)` asks YouTube how the track can be played at that quality
// level and resolves to
// `{ route, mimeType, contentLength, open() }`; `open()` starts the download and resolves to
// `{ stream, abort() }`. `failed` is the track's previous plan when its download broke.
// `route` names the way the plan was made by: a route's plans can be dropped alone (`clear`).
// The download starts on the first request for the bytes, and a URL is honoured only when its key
// was issued here during this run, so page content cannot make the app fetch an arbitrary id.
// A URL stands for one file: the audio element keeps the bytes it has read of it.
function createYtmAudio({
  loadPlan,
  now = Date.now,
  randomKey = () => crypto.randomBytes(16).toString('hex'),
  maxCacheBytes = 96 * 1024 * 1024,
  maxTrackBytes = 256 * 1024 * 1024,
  planTtlMs = 30 * 60 * 1000,
  stallMs = STALL_MS,
  planLimitMs = PLAN_LIMIT_MS,
  log = (...args) => console.log(...args),
  warn = (...args) => console.warn(...args),
}) {
  // An entry that leaves the cache (evicted, replaced, signed out) stops downloading: nothing can
  // ask for it again, and its buffer is as large as the track.
  const ready = createByteLru(maxCacheBytes, entry => {
    entry.released = true;
    entry.stop?.();
  });
  const pending = new Map();
  const keys = new Map();
  // track at a level -> { triedAt: its last attempt at a plan, failedAt: when that attempt failed, replans:
  // when broken downloads got a new one, since: when requests for the bytes began to find no plan }.
  const history = new Map();
  // route -> how often clear() dropped its plans: a plan requested for the previous account
  // must not be kept or handed out.
  const generation = new Map();
  const sessionChanged = ytmError('auth-required', 'YouTube Music session changed');
  // The 'high' entries of tracks found to have no format of 'ultra' (`issue`). What is known
  // of a track lasts as long as the plan it is served by.
  let withoutUltra = new WeakSet();

  // A plan is reusable while its download is healthy, or until YouTube's stream URL may have expired.
  const usable = entry => Boolean(entry) && !entry.track?.error
    && (entry.track !== null || now() - entry.plannedAt < planTtlMs);

  // `unasked` marks a request for the bytes, as opposed to the renderer asking for a URL.
  const prepare = (videoId, level, unasked) => {
    // What the track at this level is kept under.
    const id = `${videoId}/${level}`;
    const cached = ready.get(id);
    if (usable(cached)) return Promise.resolve(cached);
    let job = pending.get(id);
    if (!job) {
      // The entry of a broken download stays until a new plan replaces it, so that every
      // attempt knows which route broke.
      const failed = cached?.track?.error ? cached.plan : undefined;
      const past = history.get(id);
      const replans = (past?.replans ?? []).filter(at => now() - at < REPLAN_WINDOW_MS);
      // The element and the renderer go on asking after a refusal; its reason is logged once.
      const refuse = (why, error) => {
        if (past.told !== why) warn(`[Ytm] ${videoId} ${why}`);
        past.told = why;
        return Promise.reject(error);
      };
      if (failed && replans.length >= MAX_REPLANS) {
        return refuse(`is left alone: ${MAX_REPLANS} new plans in ${REPLAN_WINDOW_MS / 60000} min did not keep its download going`,
          ytmError('not-playable', 'YouTube Music playback of this track kept breaking'));
      }
      const going = past?.failedAt !== undefined && now() - past.failedAt <= QUIET_MS ? past.since : undefined;
      const since = going ?? (unasked ? now() : undefined);
      if (unasked && now() - since >= HEAL_MS) {
        return refuse(`found no plan for ${HEAL_MS / 1000}s; its URL is given up`, ytmError('unavailable', 'YouTube Music did not recover in time'));
      }
      if (unasked && past && now() - past.triedAt < RETRY_GAP_MS) return Promise.reject(ytmError('network', 'YouTube Music was asked a moment ago'));
      const record = { triedAt: now(), replans, since };
      history.delete(id);
      history.set(id, record);
      while (history.size > MAX_ISSUED_KEYS) history.delete(history.keys().next().value);
      const startedIn = new Map(generation);
      job = (async () => {
        let limit;
        const plan = await Promise.race([
          loadPlan(videoId, failed, level),
          new Promise((_, reject) => {
            limit = setTimeout(() => {
              reject(ytmError('network', 'YouTube Music did not answer'));
              warn(`[Ytm] ${videoId} got no plan in ${planLimitMs}ms; the wait is over`);
            }, planLimitMs);
          }),
        ]).finally(() => clearTimeout(limit));
        if (startedIn.get(plan.route) !== generation.get(plan.route)) throw sessionChanged;
        if (!Number.isSafeInteger(plan.contentLength) || plan.contentLength <= 0 || plan.contentLength > maxTrackBytes) {
          throw ytmError('not-playable', 'YouTube Music offered no usable audio for this track');
        }
        if (failed) replans.push(now());
        const entry = { plan, plannedAt: now(), track: null };
        ready.set(id, entry, plan.contentLength);
        return entry;
      })();
      pending.set(id, job);
      const settled = () => { if (pending.get(id) === job) pending.delete(id); };
      job.then(settled, () => {
        record.failedAt = now();
        settled();
      });
    }
    return job;
  };

  const download = (videoId, entry) => {
    const track = new TrackBuffer(entry.plan.contentLength, entry.plan.mimeType);
    entry.track = track;
    const startedAt = now();
    let stalled = false;
    (async () => {
      const source = await entry.plan.open();
      if (entry.released) {
        source.abort();
        throw new Error('Track was released');
      }
      entry.stop = () => source.abort();
      const reader = source.stream.getReader();
      // Aborting ends the stream with an error, which fails the track.
      let quiet;
      try {
        for (;;) {
          quiet = setTimeout(() => {
            stalled = true;
            source.abort();
          }, stallMs);
          const { done, value } = await reader.read();
          clearTimeout(quiet);
          if (done) break;
          // A stream that brings more than it declared has not failed and would go on.
          try { track.push(value); } catch (error) { source.abort(); throw error; }
        }
      } finally {
        clearTimeout(quiet);
      }
      if (track.filled !== track.total) throw new Error('Track ended before its declared length');
    })().then(() => {
      log(`[Ytm] Download of ${videoId} by the ${entry.plan.route} route is complete: ${track.total} bytes in ${now() - startedAt}ms`);
    }, error => {
      track.fail(error);
      // A released entry was stopped on purpose (evicted, signed out).
      if (entry.released) return;
      const why = stalled ? `no data for ${stallMs}ms` : describeError(error);
      warn(`[Ytm] Download of ${videoId} by the ${entry.plan.route} route broke at ${track.filled} of ${track.total} bytes after ${now() - startedAt}ms: ${why}`);
    }).finally(() => { entry.stop = null; });
    return track;
  };

  const gone = () => new Response(null, { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } });

  return {
    // Checks that the track can be played and hands out a fresh URL for it. The URL differs on
    // every call so that reloading a failed source is a real change for the audio element.
    // `level` is the quality level the track is asked at; the URL names the level it is served at.
    async issue(videoId, level = 'high') {
      if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) throw ytmError('unsupported', 'Invalid YouTube Music track id');
      if (!YTM_AUDIO_LEVELS.includes(level)) throw ytmError('unsupported', 'Invalid YouTube Music quality level');
      // A plan made as an account whose sign-in went while it was being made is dropped; the
      // track is then planned once more, for who is signed in now.
      const planned = at => prepare(videoId, at).catch(error => {
        if (error !== sessionChanged) throw error;
        return prepare(videoId, at);
      });
      // A track that cannot be had at 'ultra' (`loadPlan` has said why) is served at 'high'. It
      // is then the 'high' track in everything: the plan and the buffer it shares with a request
      // at 'high', the URL, and the answer here. Were it kept or named as 'ultra', a file of
      // half the bitrate would stand for that level wherever the name is believed.
      // `lacks` says that the track has no format of 'ultra' (NoUltraFormat). While the plan it
      // is then served by stands, it is not asked for at 'ultra' again.
      let served = level;
      const atHigh = async lacks => {
        served = 'high';
        log(`[Ytm] ${videoId} is served at high in place of ultra`);
        const entry = await planned(served);
        if (lacks) withoutUltra.add(entry);
        return entry;
      };
      const lower = level === 'ultra' ? ready.get(`${videoId}/high`) : undefined;
      const { plan } = await (usable(lower) && withoutUltra.has(lower) ? atHigh(true) : planned(level).catch(error => {
        if (level !== 'ultra') throw error;
        return atHigh(error instanceof NoUltraFormat);
      }));
      const key = randomKey();
      keys.set(key, { videoId, level: served, route: plan.route, contentLength: plan.contentLength, mimeType: plan.mimeType });
      while (keys.size > MAX_ISSUED_KEYS) keys.delete(keys.keys().next().value);
      // The route is for the renderer's log line.
      // (So are the format's itag and bitrate, where the plan names them.) `loudnessDb` is YouTube's
      // loudness figure for the track, the renderer's track gain.
      // `level` is there only when the track is served at another level than the one asked for.
      return {
        url: `${YTM_AUDIO_SCHEME}://audio/${videoId}/${served}?k=${key}`, route: plan.route, itag: plan.itag, bitrate: plan.bitrate,
        ...(Number.isFinite(plan.loudnessDb) ? { loudnessDb: plan.loudnessDb } : {}),
        ...(served === level ? {} : { level: served }),
      };
    },

    // Answers a request for the scheme. No failure carries a body: callers save whatever body
    // they receive as the track's audio. A failure that may pass is a network error, after which
    // the audio element goes on asking while it plays what it has. One that will not pass is a
    // status, which ends its asking in about a second, so that the renderer can ask for a new
    // URL or move on.
    async handle(request) {
      try {
        const url = new URL(request.url);
        const [videoId, level] = url.pathname.slice(1).split('/');
        const link = keys.get(url.searchParams.get('k') ?? '');
        if (request.method !== 'GET' || url.hostname !== 'audio' || !VIDEO_ID.test(videoId)) return Response.error();
        // A key dropped by a sign-in or sign-out will not come back; the track plays from a new URL.
        // (Nor does a key answer for another level than the one it was issued for.)
        if (link?.videoId !== videoId || link.level !== level) return gone();
        const entry = await prepare(videoId, level, true);
        // The other route may offer another file. Its bytes cannot continue the ones the element
        // already has (the track would end early with no error), and a new URL plays it at once.
        if (entry.plan.contentLength !== link.contentLength || entry.plan.mimeType !== link.mimeType) return gone();
        const track = entry.track ?? download(videoId, entry);
        const range = parseRangeHeader(request.headers.get('range'), track.total);
        if (range?.invalid) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${track.total}`, 'Access-Control-Allow-Origin': '*' } });
        }
        const start = range ? range.start : 0;
        const end = range ? range.end : track.total - 1;
        const headers = {
          'Content-Type': track.mimeType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Content-Length': String(end - start + 1),
        };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${track.total}`;
        return new Response(track.read(start, end), { status: range ? 206 : 200, headers });
      } catch (error) {
        return toErrorResult(error).error.code === 'network' ? Response.error() : gone();
      }
    },

    // Drops every buffered track and issued URL that `route` planned, and what is known of a
    // track from that route's answers. What was planned as the account of the web sign-in goes
    // with that sign-in (sign-out, another account), while the plans and URLs of the guest's
    // route stay. A plan under way is dropped when it turns out to be that route's (`prepare`).
    clear(route) {
      generation.set(route, (generation.get(route) ?? 0) + 1);
      // A URL issued for that route's plan stays where its track is buffered from another
      // route's plan by now (a broken download had it planned anew): that plan stays too.
      for (const [key, link] of keys) {
        if (link.route !== route) continue;
        const buffered = ready.get(`${link.videoId}/${link.level}`);
        if (!buffered || buffered.plan.route === route) keys.delete(key);
      }
      for (const id of ready.keys()) {
        if (ready.get(id).plan.route !== route) continue;
        ready.delete(id);
        history.delete(id);
      }
      withoutUltra = new WeakSet();
    },
  };
}

module.exports = { NoUltraFormat, YTM_AUDIO_LEVELS, YTM_AUDIO_PRIVILEGED_SCHEME, YTM_AUDIO_SCHEME, createYtmAudio };
