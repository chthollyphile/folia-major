const crypto = require('node:crypto');
const { parseRangeHeader } = require('../transcode/protocol.cjs');
const { SpotifyError, describeError, plainWords, spotifyError, statusError, toErrorResult } = require('./errors.cjs');
const { CLIENT_ID } = require('./signIn.cjs');

// electron/spotify/audio.cjs
// Spotify's own audio, for a paying account, served to the renderer as
// `folia-spotify://audio/<trackId>?k=<key>`.
// Spotify keeps a track as an encrypted file on its CDN. The playback component (librespot,
// through `@lox-audioserver/node-librespot`) connects to Spotify as the account and is told where
// the file is and what its key is. The bytes are then fetched here, by range, as the audio
// element asks for them, and decrypted on their way through: nothing decrypted is written to
// disk here and no track is held whole.
// With song caching on, the encrypted file is also kept on disk as Spotify sends it
// (`audioFiles.cjs`), and a kept file is read from there instead of from the CDN. The key is
// never written: every run asks Spotify for it, so a kept file opens only for a signed-in
// paying account.

const SPOTIFY_AUDIO_SCHEME = 'folia-spotify';
const SPOTIFY_AUDIO_PRIVILEGED_SCHEME = {
  scheme: SPOTIFY_AUDIO_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

const TRACK_ID = /^[0-9A-Za-z]{22}$/;
// The counter every Spotify audio file is encrypted from (AES-128 in counter mode).
const AUDIO_IV = Buffer.from('72e067fbddcbcf77ebe8bc643f630d93', 'hex');
// Spotify puts a page of its own before an Ogg stream. Players do not read it.
const OGG_LEAD_BYTES = 0xa7;
const MAX_ISSUED_KEYS = 512;
const MAX_FILES = 32;
const MAX_TRACK_BYTES = 256 * 1024 * 1024;
// The address Spotify gives for a file is good for a while only. It is asked for again after
// this long, or as soon as the CDN refuses it.
const FILE_TTL_MS = 10 * 60 * 1000;
// The CDN's answer has to begin within this time, and a read that was asked for has to bring
// bytes within it; a connection can go quiet without closing.
const QUIET_LIMIT_MS = 30 * 1000;
// The statuses by which the CDN says an address is no longer good.
const REFUSED = new Set([401, 403, 404, 410]);
// Spotify refuses a track's key (the component says `audio key unavailable: ... AesKey`). Before it
// gave this account any key in this run, it is an account Spotify gives no key to at all (common for
// accounts made since about the end of 2024); after, it is asking to slow down. A new connection
// helps neither. The renderer tells the two apart by these sentences
// (src/services/onlineMusic/spotify/spotifyFailure.ts).
const KEY_REFUSED = /audio key unavailable.*AesKey/i;
const ACCOUNT_GETS_NO_KEY = 'Spotify gives this account no audio key';
const KEY_REFUSED_FOR_NOW = 'Spotify refused the audio key for now';

// The counter for the 16-byte block that holds byte `offset` of the file.
function counterAt(offset) {
  const counter = Buffer.from(AUDIO_IV);
  let carry = Math.floor(offset / 16);
  for (let index = 15; index >= 0 && carry > 0; index -= 1) {
    const sum = counter[index] + (carry % 256);
    counter[index] = sum % 256;
    carry = Math.floor(carry / 256) + Math.floor(sum / 256);
  }
  return counter;
}

// Decrypts bytes of the file that begin at `offset`: counter mode can start anywhere.
function decipherAt(key, offset) {
  const decipher = crypto.createDecipheriv('aes-128-ctr', key, counterAt(offset));
  decipher.update(Buffer.alloc(offset % 16));
  return decipher;
}

// What the audio element is told the file is, and how many of its first bytes it is not given.
const shapeOf = format => (/^OGG_VORBIS/.test(format) ? { mimeType: 'audio/ogg', skip: OGG_LEAD_BYTES }
  : /^MP3/.test(format) ? { mimeType: 'audio/mpeg', skip: 0 } : null);

// Closing must not fail anything: a rejection that nobody handles ends the app.
function closeQuietly(session) {
  try {
    Promise.resolve(session.close()).catch(() => {});
  } catch { /* closed already */ }
}

// Connects the playback component to Spotify as the account. It is a native module with a build
// for some systems only; where there is none, Spotify cannot be played.
function openLibrespotSession({ accessToken, deviceId }) {
  let librespot;
  try {
    librespot = require('@lox-audioserver/node-librespot');
  } catch (error) {
    throw spotifyError('unavailable', 'Spotify playback is not available on this system', `${process.platform}-${process.arch}: ${error?.message}`);
  }
  return librespot.createSession({ accessToken, clientId: CLIENT_ID, deviceName: deviceId });
}

// `accessToken()` resolves to the account's token; `deviceId()` names this installation to
// Spotify; `fetch` reaches the CDN; `openSession({ accessToken, deviceId })` resolves to
// `{ resolveAudioFileAsync({ uri, bitrate }), close() }`.
// A URL is honoured only when its key was issued here during this run, so page content cannot
// make the app fetch an arbitrary id.
// `disk` is the store of kept files (`audioFiles.cjs`); without one nothing is kept.
// `onKept(limitBytes)` is called after a file was written, with the size the cache is to stay under.
function createSpotifyAudio({
  accessToken, deviceId, fetch, openSession = openLibrespotSession, now = Date.now, quietLimitMs = QUIET_LIMIT_MS,
  randomKey = () => crypto.randomBytes(16).toString('hex'),
  log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
  disk = null, onKept = () => {},
}) {
  const keys = new Map();
  // `<trackId>:<bitrate>` -> where the file is, its key, and what the element is told of it.
  const files = new Map();
  const pending = new Map();
  // The files being written to disk, by the name they are kept under.
  const keeping = new Map();
  // The component's connection to Spotify. A token is good for an hour; the connection is made
  // with one and then lasts as long as Spotify keeps it.
  let held = null;
  let opening = null;
  // Bumped by clear(): what was asked for the previous account is not kept or handed out.
  let generation = 0;
  // Whether Spotify has given the signed-in account a track's key in this run.
  let keyGiven = false;
  const sessionChanged = spotifyError('auth-required', 'Spotify session changed');

  // A step Spotify never answers must not keep a track loading for good.
  const within = (step, what) => {
    let limit;
    return Promise.race([step, new Promise((_, reject) => {
      limit = setTimeout(() => reject(spotifyError('network', 'Spotify did not answer', `${what} took over ${quietLimitMs}ms`)), quietLimitMs);
    })]).finally(() => clearTimeout(limit));
  };

  const connect = () => {
    if (held) return Promise.resolve(held);
    if (!opening) {
      const startedIn = generation;
      const startedAt = now();
      const attempt = (async () => {
        const making = Promise.resolve(accessToken()).then(token => openSession({ accessToken: token, deviceId: deviceId() }));
        const session = await within(making, 'connecting').catch(error => {
          // A connection that is there only after the wait for it ended is not kept.
          making.then(closeQuietly, () => {});
          if (error instanceof SpotifyError) throw error;
          throw spotifyError(toErrorResult(error).error.code === 'network' ? 'network' : 'unavailable', 'Spotify playback could not connect', error?.message);
        });
        if (startedIn !== generation) {
          closeQuietly(session);
          throw sessionChanged;
        }
        held = { session, closed: false };
        log(`[Spotify] Playback connected in ${now() - startedAt}ms`);
        return held;
      })().finally(() => { if (opening === attempt) opening = null; });
      opening = attempt;
    }
    return opening;
  };
  // Two tracks that failed on one connection both drop it; it is closed once.
  const disconnect = connection => {
    if (held === connection) held = null;
    if (connection.closed) return;
    connection.closed = true;
    closeQuietly(connection.session);
  };

  // Where a track's file is and what opens it. Spotify may have closed a connection that was
  // made earlier, so a failure on one is tried once more on a new connection.
  const locate = async (trackId, bitrate) => {
    for (;;) {
      const kept = held;
      const connection = await connect();
      try {
        return await within(connection.session.resolveAudioFileAsync({ uri: `spotify:track:${trackId}`, bitrate }), 'locating the file');
      } catch (error) {
        const said = String(error?.message ?? error);
        if (KEY_REFUSED.test(said)) {
          if (keyGiven) {
            warn(`[Spotify] ${trackId}: Spotify refused the key after giving keys in this run; asked to try later (${plainWords(said)})`);
            throw spotifyError('unavailable', KEY_REFUSED_FOR_NOW, said);
          }
          warn(`[Spotify] ${trackId}: Spotify has given this account no key in this run; the account cannot play here (${plainWords(said)})`);
          throw spotifyError('unavailable', ACCOUNT_GETS_NO_KEY, said);
        }
        const aboutTheTrack = /track is unavailable|no audio files available/i.test(said);
        if (aboutTheTrack || connection !== kept) {
          // A new connection that cannot load the track's entry: Spotify has no such track.
          if (aboutTheTrack || /failed to load audio item/i.test(said)) throw spotifyError('not-playable', 'Spotify has no audio for this track', said);
          disconnect(connection);
          throw spotifyError(toErrorResult(error).error.code === 'network' ? 'network' : 'unavailable', 'Spotify did not give the track', said);
        }
        warn(`[Spotify] ${trackId} could not be located on the kept connection; a new one is made (${plainWords(said)})`);
        disconnect(connection);
      }
    }
  };

  // Bytes [from, to] of the encrypted file. Resolves to `{ response, stop() }`.
  const request = async (cdnUrl, from, to) => {
    const control = new AbortController();
    const limit = setTimeout(() => control.abort(), quietLimitMs);
    try {
      const response = await fetch(cdnUrl, { headers: { Range: `bytes=${from}-${to}` }, signal: control.signal });
      if (response.status !== 206) {
        control.abort();
        // A 429 is Spotify asking to wait, not a network that fails.
        throw REFUSED.has(response.status)
          ? spotifyError('unavailable', 'Spotify did not send the audio', `HTTP ${response.status}`)
          : statusError(response.status, 'network', 'Spotify did not send the audio', `HTTP ${response.status}`);
      }
      // Bytes of another place would be decrypted with the counter of the place asked for.
      const begins = /^bytes (\d+)-/.exec(response.headers.get('content-range') ?? '')?.[1];
      if (begins !== String(from)) {
        control.abort();
        throw spotifyError('network', 'Spotify sent another part of the audio', `asked from ${from}, answered from ${begins}`);
      }
      return { response, stop: () => control.abort() };
    } finally {
      clearTimeout(limit);
    }
  };

  // How long the kept file is, when the key opens it. One it does not open is dropped; a disk
  // that cannot be read counts as holding nothing, and the track plays from the CDN.
  const keptLength = async (keptAs, opens, headBytes) => {
    try {
      const length = await disk.size(keptAs);
      if (length === null) return null;
      if (opens(await disk.head(keptAs, headBytes))) return length;
      warn(`[Spotify] The kept file ${keptAs} is not the one Spotify now gives; it is dropped`);
      await disk.remove(keptAs);
    } catch (error) {
      warn(`[Spotify] The kept file ${keptAs} could not be read: ${plainWords(String(error?.message ?? error))}`);
    }
    return null;
  };
  // Whether the whole of a file is on disk. Asked of a located file or of what an issued URL
  // stands for: both say the name it is kept under and how long it is.
  const isKept = async ({ keptAs, length }) => Boolean(keptAs) && await disk.size(keptAs) === length;

  // The file of a track at a bitrate, located once and kept while its address is good.
  const prepare = (trackId, bitrate, anew = false) => {
    const name = `${trackId}:${bitrate}`;
    const kept = files.get(name);
    if (kept && !anew && now() - kept.locatedAt < FILE_TTL_MS) return Promise.resolve(kept);
    let job = pending.get(name);
    if (!job) {
      const startedIn = generation;
      const startedAt = now();
      job = (async () => {
        const located = await locate(trackId, bitrate);
        if (startedIn === generation) keyGiven = true;
        const shape = shapeOf(String(located?.format));
        if (!shape || !/^[0-9a-f]{32}$/i.test(String(located?.keyHex)) || typeof located.cdnUrl !== 'string') {
          throw spotifyError('not-playable', 'Spotify offered no usable audio for this track', `format ${located?.format}`);
        }
        const key = Buffer.from(located.keyHex, 'hex');
        const opens = head => decipherAt(key, 0).update(head).subarray(shape.skip, shape.skip + 4).toString('latin1') === 'OggS';
        // Only a file the key can be checked against is kept: one of another encoding of the
        // track, left by an earlier run, must not be played with this key.
        const keptAs = disk && shape.skip ? `${trackId}-${bitrate}` : null;
        let length = keptAs ? await keptLength(keptAs, opens, shape.skip + 4) : null;
        const onDisk = length !== null;
        if (!onDisk) {
          // The first bytes say how long the file is, and whether the key opens it.
          const { response, stop } = await request(located.cdnUrl, 0, shape.skip + 3);
          length = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1]);
          const head = Buffer.from(await within(response.arrayBuffer(), 'the first bytes').finally(stop));
          if (startedIn !== generation) throw sessionChanged;
          if (!Number.isSafeInteger(length) || length <= shape.skip || length > MAX_TRACK_BYTES) {
            throw spotifyError('not-playable', 'Spotify offered no usable audio for this track', `length ${length}`);
          }
          if (shape.skip && !opens(head)) {
            throw spotifyError('invalid-response', 'Spotify audio could not be opened', `no Ogg page after the lead of a ${located.format} file`);
          }
        } else if (startedIn !== generation) {
          throw sessionChanged;
        }
        const file = { cdnUrl: located.cdnUrl, key, format: located.format, ...shape, total: length - shape.skip, length, keptAs, locatedAt: now() };
        files.delete(name);
        files.set(name, file);
        while (files.size > MAX_FILES) files.delete(files.keys().next().value);
        log(`[Spotify] ${trackId} located${anew ? ' again' : ''} in ${now() - startedAt}ms: ${file.format}, ${file.total} bytes${onDisk ? ', kept on disk' : ''}`);
        return file;
      })().finally(() => { if (pending.get(name) === job) pending.delete(name); });
      pending.set(name, job);
    }
    return job;
  };

  // The decrypted bytes of encrypted ones that begin at byte `offset` of the file, read as the
  // reader asks: a reader that has enough for now holds the CDN's connection back with it.
  const opened = ({ body, stop }, key, offset) => {
    const decipher = decipherAt(key, offset);
    const reader = body.getReader();
    return new ReadableStream({
      async pull(controller) {
        let quiet;
        try {
          const { done, value } = await Promise.race([reader.read(), new Promise((_, reject) => {
            quiet = setTimeout(() => reject(new Error('Spotify audio went quiet')), quietLimitMs);
          })]);
          if (done) controller.close();
          else controller.enqueue(decipher.update(value));
        } catch (error) {
          stop();
          controller.error(error);
        } finally {
          clearTimeout(quiet);
        }
      },
      cancel: stop,
    });
  };

  const gone = () => new Response(null, { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } });
  // An address stands for one file: bytes of another cannot continue the ones the element has.
  const sameFile = (file, link) => file.total === link.total && file.mimeType === link.mimeType;
  // Bytes [from, to] of a file from the CDN, with the file they are of. An address that has run
  // out is asked for again, once.
  const fromCdn = async (file, link, from, to) => {
    try {
      return [await request(file.cdnUrl, from, to), file];
    } catch (error) {
      if (!(error instanceof SpotifyError) || error.code !== 'unavailable') throw error;
      const again = await prepare(link.trackId, link.bitrate, true);
      if (!sameFile(again, link)) throw error;
      return [await request(again.cdnUrl, from, to), again];
    }
  };
  // What an issued URL stands for; a URL that was not issued in this run stands for nothing.
  const linkOf = address => {
    try {
      const url = new URL(address);
      const link = keys.get(url.searchParams.get('k') ?? '');
      return link?.trackId === url.pathname.slice(1) ? link : null;
    } catch {
      return null;
    }
  };
  // The chunks of an answer, each within the time a read may take.
  const chunksOf = async function* ({ response, stop }) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await within(reader.read(), 'the audio');
        if (done) return;
        yield value;
      }
    } finally {
      stop();
    }
  };

  return {
    // Checks that the track can be played and hands out a fresh URL for it. The URL differs on
    // every call so that reloading a failed source is a real change for the audio element.
    async issue(trackId, bitrate) {
      if (typeof trackId !== 'string' || !TRACK_ID.test(trackId)) throw spotifyError('unsupported', 'Invalid Spotify track id');
      // A sign-in or sign-out while the file was being located drops it; the track is then
      // located once more, for the session that is there now.
      const file = await prepare(trackId, bitrate).catch(error => {
        if (error !== sessionChanged) throw error;
        return prepare(trackId, bitrate);
      });
      const key = randomKey();
      keys.set(key, { trackId, bitrate, total: file.total, mimeType: file.mimeType, keptAs: file.keptAs, length: file.length });
      while (keys.size > MAX_ISSUED_KEYS) keys.delete(keys.keys().next().value);
      return { url: `${SPOTIFY_AUDIO_SCHEME}://audio/${trackId}?k=${key}`, format: file.format };
    },

    // Answers a request for the scheme. No failure carries a body: callers keep whatever body
    // they receive as the track's audio. A failure that may pass is a network error, after which
    // the audio element goes on asking while it plays what it has. One that will not pass is a
    // status, which ends its asking, so that the renderer can ask for a new URL or move on.
    async handle(incoming) {
      try {
        const url = new URL(incoming.url);
        const trackId = url.pathname.slice(1);
        const link = keys.get(url.searchParams.get('k') ?? '');
        if (incoming.method !== 'GET' || url.hostname !== 'audio' || !TRACK_ID.test(trackId)) return Response.error();
        // A key dropped by a sign-in or sign-out will not come back; the track plays from a new URL.
        if (link?.trackId !== trackId) return gone();
        const file = await prepare(trackId, link.bitrate);
        if (!sameFile(file, link)) return gone();
        const range = parseRangeHeader(incoming.headers.get('range'), link.total);
        if (range?.invalid) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${link.total}`, 'Access-Control-Allow-Origin': '*' } });
        }
        const start = range ? range.start : 0;
        const end = range ? range.end : link.total - 1;
        // A kept file is read from disk; any other from the CDN.
        let source;
        let { key } = file;
        if (await isKept(file)) {
          source = disk.read(file.keptAs, start + file.skip, end + file.skip);
        } else {
          const [answer, read] = await fromCdn(file, link, start + file.skip, end + file.skip);
          source = { body: answer.response.body, stop: answer.stop };
          key = read.key;
        }
        const headers = {
          'Content-Type': link.mimeType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Content-Length': String(end - start + 1),
        };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${link.total}`;
        return new Response(opened(source, key, start + file.skip), { status: range ? 206 : 200, headers });
      } catch (error) {
        const failed = toErrorResult(error).error.code;
        if (failed !== 'network') warn(`[Spotify] A request for audio was refused: ${describeError(error)}`);
        return failed === 'network' ? Response.error() : gone();
      }
    },

    // Whether the file an issued URL plays is on disk. Asks Spotify nothing.
    async kept(address) {
      const link = linkOf(address);
      return Boolean(link) && isKept(link);
    },

    // Puts the file an issued URL plays on disk, as Spotify sends it: encrypted, and without its
    // key. Resolves to true when it is there, to false for a file that is not kept at all, and
    // rejects when it could not be read or written.
    async keep(address, limitBytes) {
      const link = linkOf(address);
      if (!link?.keptAs) return false;
      if (await isKept(link)) return true;
      const { keptAs, length } = link;
      let job = keeping.get(keptAs);
      if (!job) {
        const startedAt = now();
        job = (async () => {
          const file = await prepare(link.trackId, link.bitrate);
          // The length is the one the address stands for. A file Spotify has since replaced with
          // another must not be written under it: it would be kept cut short.
          if (!sameFile(file, link)) throw spotifyError('unavailable', 'Spotify now gives another file for this track', `${file.total} bytes, the address stands for ${link.total}`);
          const [answer] = await fromCdn(file, link, 0, length - 1);
          // A write that fails before it reads leaves the answer open; it is closed here.
          await disk.write(keptAs, length, chunksOf(answer)).finally(answer.stop);
          log(`[Spotify] ${link.trackId} kept on disk in ${now() - startedAt}ms: ${length} bytes, encrypted`);
          await onKept(limitBytes);
        })().finally(() => { if (keeping.get(keptAs) === job) keeping.delete(keptAs); });
        keeping.set(keptAs, job);
      }
      await job;
      return true;
    },

    // Drops every issued URL and located file and closes the connection (sign-in, sign-out).
    // The files on disk stay: they are the same for every account, and none opens without one.
    clear() {
      generation += 1;
      keyGiven = false;
      keys.clear();
      files.clear();
      pending.clear();
      // A connection still being made is for the account before; it closes itself when it is there.
      opening = null;
      if (held) disconnect(held);
    },
  };
}

module.exports = { SPOTIFY_AUDIO_PRIVILEGED_SCHEME, SPOTIFY_AUDIO_SCHEME, counterAt, createSpotifyAudio };
