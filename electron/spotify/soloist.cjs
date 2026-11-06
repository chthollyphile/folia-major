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
// A program just started may open its socket before it has signed in with its stored pairing.
const SIGN_IN_WAIT_MS = 5000;
// A command refused while a play waits fails the play only if the play does not take this soon after:
// the refusal may be of another command (repeat off, the volume) sent beside it.
const REFUSAL_GRACE_MS = 1500;
// A timestamp further than this from this computer's clock is not a wall-clock time.
const CLOCK_SLACK_MS = 60 * 60 * 1000;
const KEY_SHAPE = /^[!-~]{8,512}$/;
// The process id of the program Folia started, written by Folia beside its data (the program's
// own files say nothing of it): a program an earlier run left running can then be stopped.
const PID_FILE = 'folia-soloist.pid';
const TRACK_URI = /^spotify:track:[0-9A-Za-z]{22}$/;

// The sentences the renderer is told; it sorts them by the reason word (spotifySoloistPlayback.ts).
const SOLOIST_NOT_SET_UP = 'Spotify Soloist is not set up';
const SOLOIST_NOT_PAIRED = 'Spotify Soloist is not paired with the account';
const SOLOIST_DID_NOT_START = 'Spotify Soloist did not start';
const SOLOIST_GONE = 'Spotify Soloist is not running';
const SOLOIST_REFUSED = 'Spotify Soloist did not play the track';

// `onProcessExit(stop)` registers what stops the program when this process ends without quitting
// (a crash, a relaunch): on macOS and Linux a child outlives its parent and would go on playing.
// `isAlive(pid)` and `killPid(pid)` reach a program an earlier run left running.
function createSoloist({
  store, safeStorage, dataDirectory, cacheDirectory, chooseFile,
  spawn = spawnProcess, readBuild = createSoloistBuildReader(), WebSocketClass = WebSocket, files = fs,
  now = Date.now, wait = ms => new Promise(resolve => { setTimeout(resolve, ms); }),
  log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
  onProcessExit = stop => { process.once('exit', stop); },
  isAlive = pid => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  killPid = pid => { process.kill(pid); },
  signInWaitMs = SIGN_IN_WAIT_MS,
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
    const words = String(text ?? '');
    return (keyInMemory ? words.split(keyInMemory).join('<key>') : words).slice(-600);
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
  // The program is paused because Folia asked it to (the listener's pause), not by itself at an end.
  let pausedByUs = false;
  // Bumped by every play asked for: a play still waiting its turn when a newer one is asked is dropped.
  let playAsked = 0;
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

  // The track asked for stopped at its end: the program is idle there, or paused there by itself
  // (a pause Folia asked for near the end is the listener's, not an end).
  const stoppedAtEnd = () => {
    const status = playback?.status;
    return (status === 'idle' || (status === 'paused' && !pausedByUs)) && nearEnd(positionNow(), durationNow());
  };

  const onEvent = event => {
    if (!event || typeof event.type !== 'string') return;
    eventSeq += 1;
    // Where the track asked for was just before this event changes what the program plays (once the
    // program has been seen playing it: before that, what it says is of the track before).
    if (wanted?.seen && !wanted.ended && playback?.item?.uri === wanted.uri) wanted.lastMs = positionNow();
    const before = wanted?.lastMs ?? 0;
    switch (event.type) {
      case 'auth_state':
        auth = { loggedIn: event.logged_in === true, active: event.is_active === true };
        break;
      case 'playback_state':
        playback = {
          status: event.status, item: event.item ?? null, position: event.position ?? null, positionAt: now(), volume: event.volume,
          options: event.options ?? playback?.options,
        };
        break;
      case 'track_changed': {
        // Another track begins: the position sent for the one before is not its position.
        const changed = event.item?.uri !== playback?.item?.uri;
        playback = { ...playback, item: event.item ?? null, ...(changed ? { position: null, positionAt: now() } : {}) };
        break;
      }
      case 'playback_changed': {
        // A stop keeps the position it stopped at, not the one sent while it played; a start moves
        // on from where it stopped.
        const at = positionNow();
        const was = playback?.status;
        const stopped = was === 'playing' && event.status !== 'playing';
        const started = was !== 'playing' && event.status === 'playing';
        playback = {
          ...playback,
          status: event.status,
          ...(stopped || started ? { position: { position_ms: at, timestamp_ms: now(), speed: started ? 1 : 0 }, positionAt: now() } : {}),
        };
        break;
      }
      case 'position_sync':
        playback = { ...playback, position: event.position ?? null, positionAt: now() };
        break;
      case 'options_changed':
        playback = { ...playback, options: event.options ?? playback?.options };
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
        // Seen only once the program plays the track after it was asked to: until then, its state
        // (stopped at an end) can still be of the track before, or of this one played before.
        if (playback?.status === 'playing' || playback?.status === 'buffering') wanted.seen = true;
        if (wanted.seen) {
          // The program's own length of the track is the one its position is measured against.
          const told = Number(playback?.item?.duration_ms);
          if (Number.isFinite(told) && told > 0) wanted.durationMs = told;
          if (stoppedAtEnd()) endWanted('it stopped at its end');
          // From its end back to its start without being asked (a seek Folia sends moves `lastMs`
          // first): the program finished the track and went back, as at the end of a list.
          else if (nearEnd(before, wanted.durationMs) && positionNow() + END_SLACK_MS < before) endWanted('it went back to its start');
        }
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
    let grace = null;
    const waiter = {
      check: () => {
        if (test()) {
          finish(null);
        } else if (playback?.refusalSeq > since && !grace) {
          const refusal = playback.refusal;
          grace = setTimeout(() => finish(spotifyError('unavailable', SOLOIST_REFUSED, `${what}: ${refusal}`, 'soloist-refused')), REFUSAL_GRACE_MS);
        }
      },
      lost: () => finish(spotifyError('unavailable', SOLOIST_GONE, `${what}: the program stopped`, 'soloist-gone')),
    };
    const timer = setTimeout(() => finish(spotifyError('unavailable', SOLOIST_REFUSED, `${what}: no answer in ${limitMs}ms`, 'soloist-refused')), limitMs);
    function finish(error) {
      clearTimeout(timer);
      clearTimeout(grace);
      waiters.delete(waiter);
      if (error) reject(error);
      else resolve();
    }
    waiters.add(waiter);
  });

  // Waits for `test` to hold, up to `limitMs`; answers whether it did. Refusals are not its business.
  const waitFor = (test, limitMs) => new Promise(resolve => {
    if (test()) {
      resolve(true);
      return;
    }
    const waiter = {
      check: () => { if (test()) done(true); },
      lost: () => done(false),
    };
    const timer = setTimeout(() => done(false), limitMs);
    function done(held) {
      clearTimeout(timer);
      waiters.delete(waiter);
      resolve(held);
    }
    waiters.add(waiter);
  });

  const lost = closed => {
    if (socket !== closed) return;
    socket = null;
    // A program taken over from an earlier run that went away: its process id may be another's later.
    adopted = null;
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

  // The files a stopped program leaves: its control address (it removes them itself only when it
  // stops cleanly) and the process id Folia wrote.
  const forgetRunFiles = () => {
    for (const name of ['ws.port', 'ws.addr', PID_FILE]) {
      try { files.rmSync(path.join(dataDir(), name), { force: true }); } catch { /* not there */ }
    }
  };

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
      try { killPid(left.pid); } catch { /* already gone */ }
      // A new program refuses the data directory while this one still holds it.
      const deadline = now() + STOP_LIMIT_MS;
      while (isAlive(left.pid) && now() < deadline) await wait(50);
      forgetRunFiles();
      log(`[Soloist] Stopped the program an earlier run left (pid ${left.pid})`);
    }
    if (!running) return;
    if (running.proc.exitCode === null && running.proc.signalCode === null) {
      running.proc.kill();
      const stopped = await Promise.race([running.exited.then(() => true), wait(STOP_LIMIT_MS).then(() => false)]);
      if (!stopped) {
        try { running.proc.kill('SIGKILL'); } catch { /* gone */ }
      }
      log('[Soloist] Stopped');
    }
    forgetRunFiles();
  };

  // This process ends without quitting: the program it started, or took over, ends with it.
  onProcessExit(() => {
    try { child?.proc.kill(); } catch { /* gone */ }
    try { if (adopted) killPid(adopted.pid); } catch { /* gone */ }
  });

  const notSetUp = (what, detail) => spotifyError('unavailable', SOLOIST_NOT_SET_UP, detail ?? what, `soloist-${what}`);

  const start = async () => {
    // A program this data directory already has (an earlier run of the app ended without stopping
    // it) is used: a second one would refuse the data directory.
    const left = endpoint();
    if (left) {
      try {
        await connect(left);
        let pid = null;
        try { pid = Number(files.readFileSync(path.join(dataDir(), PID_FILE), 'utf8').trim()) || null; } catch { /* none */ }
        adopted = pid ? { pid } : null;
        lastError = null;
        log(`[Soloist] Using the program an earlier run left running${pid ? ` (pid ${pid})` : ', with no process id to stop it by'}`);
        return;
      } catch { /* an address left by a program that is gone */ }
    }
    // Whatever was taken over before is gone (its address did not answer): its id is not this run's.
    adopted = null;
    if (!config.executable) throw notSetUp('program');
    const build = await readBuild(config.executable);
    if (quitting) throw spotifyError('unavailable', SOLOIST_GONE, 'the app is quitting', 'soloist-gone');
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
    // The key is taken out before the text is cut: a cut must not leave part of it.
    proc.stderr?.on('data', chunk => {
      const text = `${said}${chunk}`;
      said = (keyInMemory ? text.split(keyInMemory).join('<key>') : text).slice(-4000);
    });
    const exited = new Promise(resolve => {
      proc.once('exit', code => resolve(code));
      proc.once('error', error => {
        said = `${said}\n${error?.message ?? error}`;
        resolve(null);
      });
    });
    const entry = { proc, exited };
    child = entry;
    if (proc.pid) {
      try { files.writeFileSync(path.join(dataDir(), PID_FILE), String(proc.pid)); } catch { /* it can still be stopped by this run */ }
    }
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
    while (child === entry && !quitting && now() - startedAt < START_LIMIT_MS) {
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

  // Waits for a start under way to end (either way): what stops the program and starts it again must
  // not have that start's failure land after it.
  const settleStart = async () => {
    if (starting) await starting.catch(() => { });
  };

  const requireTrack = uri => {
    if (typeof uri !== 'string' || !TRACK_URI.test(uri)) throw spotifyError('invalid-response', 'Invalid Spotify track');
  };

  // A program just started signs in with its stored pairing a moment after it opens its socket: that
  // moment is waited for before the program is taken for unpaired.
  const requirePaired = async () => {
    await ensureRunning();
    if (auth?.loggedIn) return;
    if (await waitFor(() => auth?.loggedIn === true, signInWaitMs)) return;
    throw spotifyError('unavailable', SOLOIST_NOT_PAIRED, 'not signed in through Spotify Connect', 'soloist-unpaired');
  };

  // The commands that move the program run one after another, in the order asked: a resume sent
  // right after a seek must find the track the seek put back, and a pause after a play must come
  // after the play has taken.
  let turn = Promise.resolve();
  const inTurn = work => {
    const run = turn.then(work);
    turn = run.catch(() => { });
    return run;
  };

  // Starts the track asked for (`wanted`) from `startMs`, and waits for the program to play it.
  const playWanted = async startMs => {
    const { uri } = wanted;
    wanted.ended = false;
    wanted.seen = false;
    wanted.lastMs = Math.max(0, Math.round(startMs));
    pausedByUs = false;
    // The same track played again: where it stopped last time is not where it is going to be.
    if (playback?.item?.uri === uri) playback = { ...playback, position: null, positionAt: now() };
    if (playback?.options?.repeat !== 'off') {
      send('set_repeat_track', { enabled: false });
      send('set_repeat_context', { enabled: false });
    }
    send('play', { uri });
    await until(() => playback?.item?.uri === uri && (playback.status === 'playing' || playback.status === 'buffering'), PLAY_LIMIT_MS, `play ${uri}`);
    // Only now: a seek sent with the play would be applied to the track before it.
    if (startMs > 1000) send('seek', { position_ms: Math.round(startMs) });
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
      await settleStart();
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
      await settleStart();
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
      await settleStart();
      await stopRunning();
      keyInMemory = null;
      lastError = null;
      startFailedAt = 0;
      await ensureRunning();
    },

    // Plays `uri` from `startMs`. Folia's queue decides what comes next: repeat is turned off in the
    // program, and its own next track is paused when this one ends.
    play({ uri, startMs = 0, durationMs = 0 }) {
      requireTrack(uri);
      const asked = ++playAsked;
      return inTurn(async () => {
        // A newer play was asked while this one waited: this track is not wanted any more.
        if (asked !== playAsked) return;
        await requirePaired();
        wanted = { uri, durationMs: Number(durationMs) > 0 ? Number(durationMs) : 0, ended: false, seen: false, lastMs: 0 };
        await playWanted(Number(startMs) || 0);
      });
    },

    // Nothing sounds where the program does not run: there is nothing to pause.
    pause() {
      return inTurn(async () => {
        pausedByUs = true;
        if (socket) send('pause');
      });
    },

    // A program that went on to a track of its own (this one ended), or was started again, is put
    // back on the track asked for first.
    resume() {
      return inTurn(async () => {
        await requirePaired();
        if (!wanted) throw spotifyError('unavailable', SOLOIST_REFUSED, 'no track was asked for', 'soloist-refused');
        if (playback?.item?.uri !== wanted.uri || wanted.ended) {
          await playWanted(wanted.ended ? 0 : wanted.lastMs ?? 0);
          return;
        }
        pausedByUs = false;
        send('play');
      });
    },

    // A seek on a track the program is no longer on puts the track back there, paused: the renderer
    // resumes it after the seek when it should play.
    seek(positionMs) {
      const at = Math.max(0, Math.round(Number(positionMs) || 0));
      return inTurn(async () => {
        if (wanted && (playback?.item?.uri !== wanted.uri || wanted.ended)) {
          await requirePaired();
          await playWanted(at);
          pausedByUs = true;
          send('pause');
          return;
        }
        if (wanted) wanted.lastMs = at;
        // The position is where it was asked to go from now on, not where the old anchor runs to:
        // a seek back from near the end is not the track going back to its start by itself.
        if (playback) playback = { ...playback, position: { position_ms: at, timestamp_ms: now(), speed: playback.status === 'playing' ? 1 : 0 }, positionAt: now() };
        send('seek', { position_ms: at });
      });
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
      if (wanted?.seen && !wanted.ended && uri === wanted.uri) {
        wanted.lastMs = positionNow();
        if (stoppedAtEnd()) endWanted('it stopped at its end');
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
    // A start under way is not waited for: it stops at its next step, and what it started is
    // stopped here.
    shutdown() {
      quitting = true;
      if (!child && !adopted && !socket && !starting) return null;
      return stopRunning();
    },
  };
}

module.exports = {
  CONFIG_KEY, DEVICE_NAME, END_SLACK_MS, PLAY_LIMIT_MS, START_LIMIT_MS, START_RETRY_MS,
  SOLOIST_NOT_SET_UP, SOLOIST_NOT_PAIRED, SOLOIST_DID_NOT_START, SOLOIST_GONE, SOLOIST_REFUSED,
  createSoloist,
};
