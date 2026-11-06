const fs = require('node:fs');
const path = require('node:path');
const { spawn: spawnProcess } = require('node:child_process');
const WebSocket = require('ws');
const { spotifyError } = require('./errors.cjs');
const { EXIT_EXPIRED, createSoloistBuildReader } = require('./soloistBuild.cjs');

// electron/spotify/soloist.cjs
// Spotify Soloist: Spotify's own player, a program on this computer that the person downloads
// from Spotify (Folia may not hand it out). It is the other way Spotify plays here, for accounts
// Spotify gives no audio key to (electron/spotify/audio.cjs): the program plays to the system's
// sound output itself, and Folia steers it and follows its clock (the renderer's external route).
//
// - It runs only while it is wanted: started at the first play, or while the setup checklist asks
//   whether it is paired; stopped when the app quits. Its control socket is opened on a port the
//   system picks (`--ws 127.0.0.1:0`), read back from the `ws.port` file it writes in its data
//   directory. The socket has no authentication of its own, so it listens on loopback only, and
//   only this process talks to it: the renderer never learns the port.
// - Its API key is the person's own (made in Spotify's developer dashboard with a Premium account).
//   It is kept sealed with the OS keychain, never in the clear, and never returned to the renderer.
//   Soloist takes the key only on its command line (`-k`); the program's documentation offers no
//   other way, so the key is visible in the process list of this computer while it runs.
// - It signs in to the account through Spotify Connect: the person picks "Folia" as the device in
//   another Spotify app on the same network once, and the program keeps that in its data directory.
// - It has no event for the end of a track, and may go on with a recommendation of its own when
//   one ends: the end is read from its position and its moving away from the track asked for, and
//   it is paused at once then. Folia's queue decides what plays next.

const CONFIG_KEY = 'SPOTIFY_SOLOIST_V1';
const DEVICE_NAME = 'Folia';
const CACHE_MB = 512;
// How long a start may take before the program has opened its control socket.
const START_LIMIT_MS = 8000;
const START_POLL_MS = 200;
// A start that failed is not tried again on its own (by the setup's asking) for this long.
const START_RETRY_MS = 15_000;
const CONNECT_LIMIT_MS = 3000;
const STOP_LIMIT_MS = 2500;
// How long a play may take before the program says it plays the track.
const PLAY_LIMIT_MS = 10_000;
// A track that stopped, or was left, this close to its end has ended.
const END_SLACK_MS = 2500;
// A timestamp further than this from this computer's clock is not a wall-clock time.
const CLOCK_SLACK_MS = 60 * 60 * 1000;
const KEY_SHAPE = /^[!-~]{8,512}$/;
const TRACK_URI = /^spotify:track:[0-9A-Za-z]{22}$/;

// The sentences the renderer is told; it sorts them by the reason word (spotifySoloistPlayback.ts).
const SOLOIST_NOT_SET_UP = 'Spotify Soloist is not set up';
const SOLOIST_NOT_PAIRED = 'Spotify Soloist is not paired with the account';
const SOLOIST_DID_NOT_START = 'Spotify Soloist did not start';
const SOLOIST_GONE = 'Spotify Soloist is not running';
const SOLOIST_REFUSED = 'Spotify Soloist did not play the track';

function createSoloist({
  store, safeStorage, dataDirectory, cacheDirectory, chooseFile,
  spawn = spawnProcess, readBuild = createSoloistBuildReader(), WebSocketClass = WebSocket, files = fs,
  now = Date.now, wait = ms => new Promise(resolve => { setTimeout(resolve, ms); }),
  log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
}) {
  const readConfig = () => {
    const value = store.get(CONFIG_KEY);
    return {
      executable: typeof value?.executable === 'string' && value.executable ? value.executable : null,
      sealedKey: typeof value?.sealedKey === 'string' && value.sealedKey ? value.sealedKey : null,
    };
  };
  let config = readConfig();
  const writeConfig = next => {
    store.set(CONFIG_KEY, next);
    config = next;
  };
  const canSeal = () => Boolean(safeStorage?.isEncryptionAvailable()) && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

  let keyInMemory = null;
  // 'saved' (and the key), 'missing', 'locked' (sealed, and the keychain cannot open it in this
  // run) or 'unreadable' (sealed by another keychain).
  const readKey = () => {
    if (keyInMemory) return { state: 'saved', key: keyInMemory };
    if (!config.sealedKey) return { state: 'missing', key: null };
    if (!canSeal()) return { state: 'locked', key: null };
    try {
      keyInMemory = safeStorage.decryptString(Buffer.from(config.sealedKey, 'base64'));
      return { state: 'saved', key: keyInMemory };
    } catch {
      return { state: 'unreadable', key: null };
    }
  };
  // What the program said, with the key taken out should it ever say it.
  const scrub = text => {
    const words = String(text ?? '').slice(-600);
    return keyInMemory ? words.split(keyInMemory).join('<key>') : words;
  };

  let child = null;
  // A program left running by an earlier run of the app (it ended without stopping it), found by
  // its control socket and used: its process id, to stop it when the app quits.
  let adopted = null;
  let starting = null;
  let startFailedAt = 0;
  // Why the program is not running, after it was started and is not: 'expired', 'start', 'exited'.
  let lastError = null;
  let socket = null;
  let quitting = false;
  // What the program last said: whether it is signed in, and what it plays.
  let auth = null;
  let playback = null;
  // Bumped by every event, so a wait can ask for one that came after a command.
  let eventSeq = 0;
  const waiters = new Set();
  // The track Folia asked for: its length, the last position it was seen at, and whether it ended.
  let wanted = null;
  // The volume Folia last asked for (0 to 100), given to a program started later as its first one.
  let volume = null;

  const dataDir = () => dataDirectory();
  const endpoint = () => {
    try {
      const port = Number(files.readFileSync(path.join(dataDir(), 'ws.port'), 'utf8').trim());
      return Number.isInteger(port) && port > 0 && port < 65536 ? `ws://127.0.0.1:${port}` : null;
    } catch {
      return null;
    }
  };

  // Where the track is now: the program sends a position with the time it was at, and moves on
  // from it at its speed while it plays.
  const positionNow = () => {
    const anchor = playback?.position;
    if (!anchor || !Number.isFinite(anchor.position_ms)) return 0;
    if (playback.status !== 'playing') return Math.max(0, anchor.position_ms);
    const stamped = Number.isFinite(anchor.timestamp_ms) && Math.abs(now() - anchor.timestamp_ms) < CLOCK_SLACK_MS;
    const from = stamped ? anchor.timestamp_ms : playback.positionAt;
    const speed = Number.isFinite(anchor.speed) ? anchor.speed : 1;
    return Math.max(0, anchor.position_ms + Math.max(0, now() - from) * speed);
  };
  const durationNow = () => {
    const told = Number(playback?.item?.duration_ms);
    return Number.isFinite(told) && told > 0 ? told : wanted?.durationMs ?? 0;
  };
  const nearEnd = (atMs, durationMs) => durationMs > 0 && atMs >= durationMs - END_SLACK_MS;

  const send = (command, fields = {}) => {
    if (!socket || socket.readyState !== WebSocketClass.OPEN) throw spotifyError('unavailable', SOLOIST_GONE, `${command}: no control socket`, 'soloist-gone');
    socket.send(JSON.stringify({ type: 'command', command, ...fields }));
  };

  // The track asked for ended: it is marked so, and the program is paused before its own next
  // track goes on.
  const endWanted = why => {
    if (!wanted || wanted.ended) return;
    wanted.ended = true;
    log(`[Soloist] ${wanted.uri} ended (${why})`);
    try {
      if (playback?.status === 'playing' || playback?.status === 'buffering') send('pause');
    } catch { /* not running any more: nothing plays */ }
  };

  const onEvent = event => {
    if (!event || typeof event.type !== 'string') return;
    eventSeq += 1;
    // Where the track asked for was just before this event changes what the program plays.
    if (wanted && !wanted.ended && playback?.item?.uri === wanted.uri) wanted.lastMs = positionNow();
    switch (event.type) {
      case 'auth_state':
        auth = { loggedIn: event.logged_in === true, active: event.is_active === true };
        break;
      case 'playback_state':
        playback = { status: event.status, item: event.item ?? null, position: event.position ?? null, positionAt: now(), volume: event.volume };
        break;
      case 'track_changed':
        playback = { ...playback, item: event.item ?? null };
        break;
      case 'playback_changed': {
        // A stop keeps the position it stopped at, not the one sent while it played.
        const at = positionNow();
        const stopped = playback?.status === 'playing' && event.status !== 'playing';
        playback = { ...playback, status: event.status, ...(stopped ? { position: { position_ms: at, timestamp_ms: now(), speed: 0 }, positionAt: now() } : {}) };
        break;
      }
      case 'position_sync':
        playback = { ...playback, position: event.position ?? null, positionAt: now() };
        break;
      case 'volume_changed':
        playback = { ...playback, volume: event.volume };
        break;
      case 'error':
        playback = { ...playback, refusal: String(event.message ?? '').slice(0, 200), refusalSeq: eventSeq };
        warn(`[Soloist] A command was refused: ${scrub(event.message)}`);
        break;
      default:
        break;
    }
    if (wanted && !wanted.ended) {
      const uri = playback?.item?.uri;
      if (uri === wanted.uri) {
        wanted.seen = true;
        // The program's own length of the track is the one its position is measured against.
        const told = Number(playback?.item?.duration_ms);
        if (Number.isFinite(told) && told > 0) wanted.durationMs = told;
        const status = playback?.status;
        if ((status === 'idle' || status === 'paused') && nearEnd(positionNow(), durationNow())) endWanted(`it stopped at its end`);
      } else if (wanted.seen && nearEnd(wanted.lastMs ?? 0, wanted.durationMs)) {
        endWanted(`the program went on to ${uri ?? 'nothing'}`);
      }
    }
    for (const waiter of [...waiters]) waiter.check();
  };

  // Waits for the program to say something `test` accepts; rejects when it refuses a command, stops
  // or takes longer than `limitMs`.
  const until = (test, limitMs, what) => new Promise((resolve, reject) => {
    const since = eventSeq;
    const waiter = {
      check: () => {
        if (playback?.refusalSeq > since) finish(spotifyError('unavailable', SOLOIST_REFUSED, `${what}: ${playback.refusal}`, 'soloist-refused'));
        else if (test()) finish(null);
      },
      lost: () => finish(spotifyError('unavailable', SOLOIST_GONE, `${what}: the program stopped`, 'soloist-gone')),
    };
    const timer = setTimeout(() => finish(spotifyError('unavailable', SOLOIST_REFUSED, `${what}: no answer in ${limitMs}ms`, 'soloist-refused')), limitMs);
    function finish(error) {
      clearTimeout(timer);
      waiters.delete(waiter);
      if (error) reject(error);
      else resolve();
    }
    waiters.add(waiter);
  });

  const lost = closed => {
    if (socket !== closed) return;
    socket = null;
    auth = null;
    playback = null;
    for (const waiter of [...waiters]) waiter.lost();
  };

  // Opens the control socket; resolves once the program has said whether it is signed in (it does
  // on every new connection).
  const connect = url => new Promise((resolve, reject) => {
    const ws = new WebSocketClass(url);
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* gone */ }
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('the program did not say whether it is signed in')), CONNECT_LIMIT_MS);
    ws.on('message', raw => {
      let event;
      try {
        event = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!settled && event?.type === 'auth_state') {
        settled = true;
        clearTimeout(timer);
        if (socket && socket !== ws) {
          try { socket.terminate(); } catch { /* gone */ }
        }
        socket = ws;
        onEvent(event);
        resolve();
        return;
      }
      if (socket === ws) onEvent(event);
    });
    ws.on('error', error => fail(error));
    ws.on('close', () => {
      if (!settled) fail(new Error('the control socket closed'));
      else lost(ws);
    });
  });

  const stopRunning = async () => {
    const running = child;
    const left = adopted;
    child = null;
    adopted = null;
    const closing = socket;
    socket = null;
    if (closing) {
      try { closing.terminate(); } catch { /* gone */ }
      lost(closing);
    }
    auth = null;
    playback = null;
    if (left) {
      try {
        process.kill(left.pid);
        log(`[Soloist] Stopped the program an earlier run left (pid ${left.pid})`);
      } catch { /* already gone */ }
    }
    if (!running || running.proc.exitCode !== null || running.proc.signalCode !== null) return;
    running.proc.kill();
    const stopped = await Promise.race([running.exited.then(() => true), wait(STOP_LIMIT_MS).then(() => false)]);
    if (!stopped) {
      try { running.proc.kill('SIGKILL'); } catch { /* gone */ }
    }
    log('[Soloist] Stopped');
  };

  const notSetUp = (what, detail) => spotifyError('unavailable', SOLOIST_NOT_SET_UP, detail ?? what, `soloist-${what}`);

  const start = async () => {
    // A program this data directory already has (an earlier run of the app ended without stopping
    // it) is used: a second one would refuse the data directory.
    const left = endpoint();
    if (left) {
      try {
        await connect(left);
        let pid = null;
        try { pid = Number(files.readFileSync(path.join(dataDir(), 'soloist.pid'), 'utf8').trim()) || null; } catch { /* none */ }
        adopted = pid ? { pid } : null;
        lastError = null;
        log('[Soloist] Using the program an earlier run left running');
        return;
      } catch { /* an address left by a program that is gone */ }
    }
    if (!config.executable) throw notSetUp('program');
    const build = await readBuild(config.executable);
    if (build.state === 'missing' || build.state === 'invalid') throw notSetUp('program', `${build.state}: ${config.executable}`);
    if (build.state === 'expired') {
      lastError = 'expired';
      throw notSetUp('expired', `built ${build.builtAt ? new Date(build.builtAt).toISOString() : 'at an unknown time'}`);
    }
    const { key, state } = readKey();
    if (!key) throw notSetUp('key', `key ${state}`);
    const cacheDir = cacheDirectory();
    files.mkdirSync(dataDir(), { recursive: true });
    files.mkdirSync(cacheDir, { recursive: true });
    for (const name of ['ws.port', 'ws.addr']) {
      try { files.rmSync(path.join(dataDir(), name), { force: true }); } catch { /* not there */ }
    }
    const args = ['-n', DEVICE_NAME, '-k', key, '-D', dataDir(), '-C', cacheDir, '-z', String(CACHE_MB), '-w', '127.0.0.1:0'];
    if (volume !== null) args.push('-i', String(volume));
    const startedAt = now();
    const proc = spawn(config.executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let said = '';
    proc.stderr?.on('data', chunk => { said = `${said}${chunk}`.slice(-4000); });
    const exited = new Promise(resolve => {
      proc.once('exit', code => resolve(code));
      proc.once('error', error => {
        said = `${said}\n${error?.message ?? error}`;
        resolve(null);
      });
    });
    const entry = { proc, exited };
    child = entry;
    void exited.then(code => {
      if (child !== entry) return;
      child = null;
      lastError = code === EXIT_EXPIRED ? 'expired' : 'exited';
      warn(`[Soloist] The program ended (exit ${code ?? 'not started'}): ${scrub(said) || 'it said nothing'}`);
      const closing = socket;
      socket = null;
      if (closing) {
        try { closing.terminate(); } catch { /* gone */ }
        lost(closing);
      }
    });
    while (child === entry && now() - startedAt < START_LIMIT_MS) {
      const url = endpoint();
      if (url) {
        try {
          await connect(url);
          lastError = null;
          log(`[Soloist] Started in ${now() - startedAt}ms (signed in: ${auth?.loggedIn ? 'yes' : 'not yet'})`);
          return;
        } catch { /* not listening yet */ }
      }
      await wait(START_POLL_MS);
    }
    const ended = child !== entry;
    if (!ended) await stopRunning();
    const expired = lastError === 'expired';
    lastError = expired ? 'expired' : 'start';
    throw spotifyError('unavailable', expired ? SOLOIST_NOT_SET_UP : SOLOIST_DID_NOT_START, scrub(said) || (ended ? 'it ended at once' : 'no control socket'),
      expired ? 'soloist-expired' : 'soloist-start');
  };

  const ensureRunning = () => {
    if (socket) return Promise.resolve();
    if (quitting) return Promise.reject(spotifyError('unavailable', SOLOIST_GONE, 'the app is quitting', 'soloist-gone'));
    if (!starting) {
      starting = start().catch(error => {
        startFailedAt = now();
        throw error;
      }).finally(() => { starting = null; });
    }
    return starting;
  };

  const requireTrack = uri => {
    if (typeof uri !== 'string' || !TRACK_URI.test(uri)) throw spotifyError('invalid-response', 'Invalid Spotify track');
  };

  const requirePaired = async () => {
    await ensureRunning();
    if (!auth?.loggedIn) throw spotifyError('unavailable', SOLOIST_NOT_PAIRED, 'not signed in through Spotify Connect', 'soloist-unpaired');
  };

  return {
    // The setup checklist's view of the program. With `start`, a program that is set up is started
    // (to say whether it is paired), unless a start failed a moment ago.
    async state({ start: wanting = false } = {}) {
      const build = config.executable ? await readBuild(config.executable) : null;
      const key = readKey().state;
      const usable = build && build.state !== 'missing' && build.state !== 'invalid' && build.state !== 'expired';
      if (wanting && usable && key === 'saved' && !socket && !quitting && now() - startFailedAt >= START_RETRY_MS) {
        await ensureRunning().catch(error => warn(`[Soloist] Not started for the setup: ${error.detail ?? error.message}`));
      }
      return {
        executable: build,
        key,
        canSealKey: canSeal(),
        running: Boolean(socket),
        paired: Boolean(socket && auth?.loggedIn),
        error: socket ? null : lastError,
      };
    },

    // The person picks the program they downloaded. Kept only when it is a Soloist that runs.
    async pickExecutable() {
      const chosen = await chooseFile();
      if (!chosen) return { picked: false, executable: null };
      const build = await readBuild(chosen);
      if (build.state === 'missing' || build.state === 'invalid' || build.state === 'expired') {
        log(`[Soloist] The chosen program was not kept: ${build.state}`);
        return { picked: false, executable: build };
      }
      await stopRunning();
      writeConfig({ ...config, executable: chosen });
      lastError = null;
      startFailedAt = 0;
      log(`[Soloist] Program chosen: version ${build.version ?? 'unknown'}, ${build.state}`);
      return { picked: true, executable: build };
    },

    // Keeps the API key, sealed. A running program is stopped, to start again with the new key.
    async saveKey(value) {
      const key = typeof value === 'string' ? value.trim() : '';
      if (!KEY_SHAPE.test(key)) return { saved: false, why: 'shape' };
      if (!canSeal()) return { saved: false, why: 'keychain' };
      const sealedKey = safeStorage.encryptString(key).toString('base64');
      await stopRunning();
      writeConfig({ ...config, sealedKey });
      keyInMemory = key;
      lastError = null;
      startFailedAt = 0;
      log('[Soloist] API key saved (sealed)');
      return { saved: true };
    },

    // Starts the program again (after the keychain was unlocked, or a pairing in another app).
    async restart() {
      await stopRunning();
      keyInMemory = null;
      lastError = null;
      startFailedAt = 0;
      await ensureRunning();
    },

    // Plays `uri` from `startMs`. Folia's queue decides what comes next: repeat is turned off in the
    // program, and its own next track is paused when this one ends.
    async play({ uri, startMs = 0, durationMs = 0 }) {
      requireTrack(uri);
      await requirePaired();
      wanted = { uri, durationMs: Number(durationMs) > 0 ? Number(durationMs) : 0, ended: false, seen: false, lastMs: 0 };
      send('set_repeat_track', { enabled: false });
      send('set_repeat_context', { enabled: false });
      send('play', { uri });
      await until(() => playback?.item?.uri === uri && (playback.status === 'playing' || playback.status === 'buffering'), PLAY_LIMIT_MS, `play ${uri}`);
      // Only now: a seek sent with the play would be applied to the track before it.
      if (Number(startMs) > 1000) send('seek', { position_ms: Math.round(Number(startMs)) });
    },

    async pause() {
      send('pause');
    },

    async resume() {
      await requirePaired();
      if (wanted?.ended) throw spotifyError('unavailable', SOLOIST_REFUSED, 'the track ended', 'soloist-refused');
      send('play');
    },

    async seek(positionMs) {
      const at = Math.max(0, Math.round(Number(positionMs) || 0));
      if (wanted) {
        wanted.ended = false;
        wanted.lastMs = at;
      }
      send('seek', { position_ms: at });
    },

    async setVolume(level) {
      const next = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
      volume = next;
      if (socket) send('set_volume', { volume: next });
    },

    // What the program plays now, for the renderer's clock: the track (its uri), whether it plays,
    // where it is, how long it is, and whether the track Folia asked for ended.
    // A track that ended is answered as itself, at its end, whatever the program went on to: the
    // renderer then moves to the next song instead of taking the program's own next one for a
    // track someone started in another app.
    status() {
      const uri = playback?.item?.uri ?? null;
      if (wanted && !wanted.ended && uri === wanted.uri) {
        const at = positionNow();
        wanted.lastMs = at;
        if (playback?.status !== 'playing' && playback?.status !== 'buffering' && nearEnd(at, durationNow())) endWanted('it stopped at its end');
      }
      const running = Boolean(socket);
      const paired = Boolean(socket && auth?.loggedIn);
      if (wanted?.ended) {
        const durationMs = Math.round(wanted.durationMs || wanted.lastMs || 0);
        return { running, paired, uri: wanted.uri, status: 'idle', positionMs: durationMs, durationMs, ended: true };
      }
      return {
        running,
        paired,
        uri,
        status: playback?.status ?? 'idle',
        positionMs: Math.round(positionNow()),
        durationMs: Math.round(durationNow()),
        ended: false,
      };
    },

    // The app is quitting: the program is stopped. Answers null when nothing runs.
    shutdown() {
      quitting = true;
      if (!child && !adopted && !socket && !starting) return null;
      return (starting ?? Promise.resolve()).catch(() => { }).then(stopRunning);
    },
  };
}

module.exports = {
  CONFIG_KEY, DEVICE_NAME, END_SLACK_MS, PLAY_LIMIT_MS, START_LIMIT_MS, START_RETRY_MS,
  SOLOIST_NOT_SET_UP, SOLOIST_NOT_PAIRED, SOLOIST_DID_NOT_START, SOLOIST_GONE, SOLOIST_REFUSED,
  createSoloist,
};
