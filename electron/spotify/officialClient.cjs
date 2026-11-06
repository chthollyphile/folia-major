const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { spotifyError } = require('./errors.cjs');

// electron/spotify/officialClient.cjs
// Spotify's own desktop app as the player Folia steers. Spotify gives a free account no audio key
// for any player but its own, so the song sounds in the official app and Folia follows it. The app
// is started with a local DevTools port (through its App Execution Alias for the Microsoft Store
// build, measured 2026-11-06: the packaged exe refuses a direct start with EPERM) and its internal
// player, the one its own UI uses, is found in the React tree of its page and called there. When
// that port cannot be reached the system media session (SMTC) still pauses, resumes and seeks.
//
// D1: Spotify is closed and started again only for a listener's own action (a play, the launch
// switch), and a run of Folia does that at most once. A status read, a pause, a resume, a seek or a
// queue write never starts Spotify and never closes it: a listener who closed Spotify keeps it
// closed, and a Spotify running without the port stays as it is until the listener plays a song.

const CDP_PORT = 9283;
const CDP_HOST = '127.0.0.1';
const LAUNCH_WAIT_MS = 25000;
const CALL_LIMIT_MS = 8000;
const FIRST_SESSION_CALL_LIMIT_MS = 20000;
// The whole DevTools connection, the target list and the socket handshake both: a port taken by
// another program must not hold a play open for ever (M7).
const CONNECT_LIMIT_MS = 4000;
// After a start that failed, an ordinary call goes to the media session for this long instead of
// starting Spotify again; a listener's own play asks once more regardless (D1).
const RESTART_COOLDOWN_MS = 30000;
// How often one run of Folia may close and start Spotify again (D1). A run that spent it stays on
// the media session until Folia is started again.
const MAX_FORCE_RESTARTS = 1;
const TRACK_ID = /^[0-9A-Za-z]{22}$/;
const MAX_QUEUED = 5;

// Runs in the Spotify page: finds the player and the volume API in the app's React tree and keeps
// them on the window, so later calls do not walk the tree again.
const FIND_APIS = `(() => {
  const cached = window.__foliaSpotify;
  if (cached && cached.player && cached.playback) return cached;
  let fiber = null;
  for (const el of [document.getElementById('main'), ...document.querySelectorAll('body > *')]) {
    if (!el) continue;
    const key = Object.keys(el).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
    if (key) { fiber = el[key]; break; }
  }
  if (!fiber) return null;
  const has = (o, m) => { try { return Boolean(o) && typeof o[m] === 'function'; } catch { return false; } };
  const found = { player: null, playback: null };
  const seen = new WeakSet();
  const inspect = (o, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 4) return;
    seen.add(o);
    if (!found.player && has(o, 'seekTo') && has(o, 'skipToNext') && has(o, 'getState')) found.player = o;
    // The mute helper is used where the volume API has one, but not asked for to find it.
    if (!found.playback && has(o, 'setVolume') && has(o, 'getVolume') && !has(o, 'seekTo')) found.playback = o;
    let keys = [];
    try { keys = Object.keys(o).slice(0, 80); } catch { return; }
    for (const k of keys) { let v; try { v = o[k]; } catch { continue; } inspect(v, depth + 1); }
  };
  const stack = [fiber];
  const visited = new Set();
  while (stack.length && !(found.player && found.playback)) {
    const f = stack.pop();
    if (!f || visited.has(f)) continue;
    visited.add(f);
    inspect(f.memoizedProps, 0);
    let s = f.memoizedState;
    for (let i = 0; s && i < 12; i += 1) { inspect(s.memoizedState, 1); s = s.next; }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  if (!found.player || !found.playback) return null;
  window.__foliaSpotify = found;
  return found;
})()`;

// The player cached in the page is forgotten, so the next call looks for it again: Spotify
// replaces its React tree when its UI changes, and the player kept from before then throws.
const FORGET_APIS = `(() => {
  try { delete window.__foliaSpotify; } catch { /* nothing kept */ }
  return true;
})()`;

// Whether an advertisement is muted is kept on the page, apart from the player and the volume API,
// which are forgotten when Spotify's UI changes (M2): a mute that is on stays on across that
// (L2), and Folia still knows of it when it quits.
const AD_STATE = `window.__foliaAd || (window.__foliaAd = { muted: false, volumeBeforeAd: null, volumeDuringAd: null });`;

// The body of one call in the page, with the APIs as `api` and the advertisement state as `ad`.
const inPage = body => `(async () => { const api = ${FIND_APIS}; if (!api) throw new Error('player-unavailable'); const ad = ${AD_STATE} ${body} })()`;

// The player's state as it stands, read in the page and turned into Folia's status here
// (`statusFromPlayerState`). Page and process share one clock: both run on this computer.
const STATE_BODY = `
  const s = api.player.getState();
  const item = s && s.item;
  return {
    item: item ? { uri: item.uri, type: item.type, metadata: item.metadata ? { is_advertisement: item.metadata.is_advertisement } : null } : null,
    isPaused: Boolean(s && s.isPaused), isBuffering: Boolean(s && s.isBuffering),
    positionAsOfTimestamp: s && s.positionAsOfTimestamp, timestamp: s && s.timestamp, duration: s && s.duration,
    repeat: s && s.repeat, adMuted: Boolean(ad.muted),
  };
`;

// An advertisement is muted for as long as it plays (a free account cannot skip one), and the
// volume is given back when it is over. Whether it is muted is kept in the page, across Folia runs.
// The volume heard before the advertisement is written once, when the mute begins: a second mute
// asked for while the advertisement plays must not record the 0 it set (L2). A volume the listener
// chooses during the advertisement is kept apart and is the one given back (L2).
const adMuteBody = muted => `
  const muter = typeof api.playback.getMuteHelper === 'function' ? api.playback.getMuteHelper() : null;
  if (${muted}) {
    if (!ad.muted) {
      if (muter && typeof muter.mute === 'function') muter.mute();
      else { ad.volumeBeforeAd = await api.playback.getVolume(); await api.playback.setVolume(0); }
    }
  } else {
    if (muter && typeof muter.unmute === 'function') muter.unmute();
    const back = ad.volumeDuringAd !== null && ad.volumeDuringAd !== undefined ? ad.volumeDuringAd : ad.volumeBeforeAd;
    if (back !== null && back !== undefined) await api.playback.setVolume(back);
  }
  ad.volumeBeforeAd = null;
  ad.volumeDuringAd = null;
  ad.muted = ${muted};
  return true;
`;

// Spotify's repeat (0 off, 1 the list, 2 the track) by the names the renderer sends.
const REPEAT_MODES = Object.freeze({ off: 0, all: 1, one: 2 });
// The media session's MediaPlaybackAutoRepeatMode (0 None, 1 Track, 2 List) by the same names.
const SESSION_REPEAT_MODES = Object.freeze({ off: 0, one: 1, all: 2 });

const repeatModeOf = name => {
  if (!Object.hasOwn(REPEAT_MODES, name)) throw spotifyError('invalid-response', 'Invalid repeat mode');
  return REPEAT_MODES[name];
};
const repeatNameOf = (modes, value) => Object.keys(modes).find(name => modes[name] === value) ?? null;

// What Spotify marks as an advertisement (metadata.is_advertisement, measured as the string 'true').
const isAdvertisementItem = item => Boolean(item && (
  item.metadata?.is_advertisement === 'true' || item.metadata?.is_advertisement === true || item.type === 'ad'
));

// The player's state, read at `now`, as Folia's status. A playing track's position is its position
// at `timestamp` plus the time since, never past its end.
function statusFromPlayerState(state, now) {
  const s = state ?? {};
  const ad = isAdvertisementItem(s.item);
  const uri = typeof s.item?.uri === 'string' ? s.item.uri : '';
  const id = !ad && uri.startsWith('spotify:track:') ? uri.slice(14) : '';
  const durationMs = Math.max(0, Math.round(Number(s.duration) || 0));
  const timestamp = Number(s.timestamp);
  const elapsed = !s.isPaused && Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : 0;
  const positionMs = Math.max(0, Math.round((Number(s.positionAsOfTimestamp) || 0) + elapsed));
  return {
    id, ad, isPaused: Boolean(s.isPaused), isBuffering: Boolean(s.isBuffering),
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs, durationMs,
    repeat: repeatNameOf(REPEAT_MODES, s.repeat),
  };
}

// The media session's answer as the same status: it names no track (`fallback`), knows no
// advertisement, gives -1 for a repeat mode it does not report, and names the track only by the
// title and artist it shows. Those two are what tells a track the app moved on to by itself from
// the one Folia asked for, which the media session cannot name (M4).
function statusFromMediaSession(data) {
  const d = data ?? {};
  const durationMs = Math.max(0, Math.round(Number(d.durationMs) || 0));
  const positionMs = Math.max(0, Math.round(Number(d.positionMs) || 0));
  return {
    id: '', ad: false, fallback: true, isPaused: d.isPaused !== false, isBuffering: false,
    positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs, durationMs,
    repeat: repeatNameOf(SESSION_REPEAT_MODES, d.repeat),
    title: typeof d.title === 'string' ? d.title : '',
    artist: typeof d.artist === 'string' ? d.artist : '',
  };
}

// Windows' media session, through one PowerShell kept running: it reads one JSON command a line
// and answers one JSON line. Only what the session offers is asked of it.
const SMTC_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $command = $line | ConvertFrom-Json
    $session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'Spotify' } | Select-Object -First 1
    if (-not $session) { [Console]::Out.WriteLine((@{ id = $command.id; ok = $false; error = 'no-session' } | ConvertTo-Json -Compress)); continue }
    $data = $null
    switch ($command.op) {
      'status' {
        $info = $session.GetPlaybackInfo(); $timeline = $session.GetTimelineProperties()
        $position = $timeline.Position.TotalMilliseconds
        if ($info.PlaybackStatus -eq 'Playing') { $position += ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalMilliseconds }
        $repeat = if ($null -ne $info.AutoRepeatMode) { [int]$info.AutoRepeatMode } else { -1 }
        $title = ''; $artist = ''
        try {
          $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
          if ($props) { $title = [string]$props.Title; $artist = [string]$props.Artist }
        } catch { }
        $data = @{ isPaused = ($info.PlaybackStatus -ne 'Playing'); positionMs = [Math]::Max(0, [Math]::Round($position)); durationMs = [Math]::Round($timeline.EndTime.TotalMilliseconds); repeat = $repeat; title = $title; artist = $artist }
      }
      'pause' { $data = Await ($session.TryPauseAsync()) ([bool]) }
      'resume' { $data = Await ($session.TryPlayAsync()) ([bool]) }
      'seek' { $data = Await ($session.TryChangePlaybackPositionAsync([long]($command.ms * 10000))) ([bool]) }
    }
    [Console]::Out.WriteLine((@{ id = $command.id; ok = $true; data = $data } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $command.id; ok = $false; error = "$_" } | ConvertTo-Json -Compress))
  }
}
`;

// Hides the main window of the Spotify this run just started into the tray, without activating it
// (SW_HIDE): the fallback for a start that ignored --minimized. The window leaves the taskbar and the
// Spotify tray icon restores it; nothing is closed. A window already in the tray has no handle
// (MainWindowHandle is 0 for a hidden window) and is left alone.
const MINIMIZE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Folia -Name SpotifyWin -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);'
foreach ($p in Get-Process -Name Spotify -ErrorAction SilentlyContinue) {
  if ($p.MainWindowHandle -ne [System.IntPtr]::Zero) { [Folia.SpotifyWin]::ShowWindowAsync($p.MainWindowHandle, 0) | Out-Null }
}
`;
// The flag Spotify's own start-up entry uses to start in the tray rather than with a window.
const START_MINIMIZED_FLAG = '--minimized';
const MINIMIZE_LIMIT_MS = 8000;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A promise that gives up after `ms`; the timer is cleared once either side settled (L1).
const withLimit = (promise, ms, what) => {
  let timer = null;
  const limit = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(spotifyError('network', `${what} did not answer in time`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  });
};

const trackUri = id => {
  if (typeof id !== 'string' || !TRACK_ID.test(id)) throw spotifyError('invalid-response', 'Invalid Spotify track');
  return `spotify:track:${id}`;
};

// The program that starts Spotify: the Microsoft Store build's App Execution Alias, else the
// installer build. An alias is a reparse point that `existsSync` reports as missing.
function findLauncher(env) {
  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'Spotify.exe'),
    env.APPDATA && path.join(env.APPDATA, 'Spotify', 'Spotify.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { fs.lstatSync(candidate); return candidate; } catch { /* not this one */ }
  }
  return null;
}

// One DevTools connection to Spotify's page, opened again when it closes.
function createPageConnection({ fetch, port }) {
  let socket = null;
  let opening = null;
  let nextId = 0;
  const pending = new Map();

  const drop = () => {
    socket = null;
    for (const { reject } of pending.values()) reject(spotifyError('network', 'Spotify closed its DevTools connection'));
    pending.clear();
  };

  const open = async () => {
    const list = await (await fetch(`http://${CDP_HOST}:${port}/json/list`)).json();
    const page = Array.isArray(list) ? list.find(target => target.type === 'page' && /xpui/.test(String(target.url))) : null;
    if (!page?.webSocketDebuggerUrl) throw spotifyError('unavailable', 'Spotify has no page open yet');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    // A socket that closes before it opened is a refused connection, not a connection: it rejects
    // here, and the walk is over (M7).
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(spotifyError('network', 'Spotify refused the DevTools connection'));
      ws.onclose = () => reject(spotifyError('network', 'Spotify closed the DevTools connection before it opened'));
    });
    ws.onmessage = message => {
      let answer;
      try { answer = JSON.parse(String(message.data)); } catch { return; }
      const entry = pending.get(answer.id);
      if (!entry) return;
      pending.delete(answer.id);
      entry.resolve(answer);
    };
    ws.onclose = () => { if (socket === ws) drop(); };
    socket = ws;
    return ws;
  };

  // The target list and the handshake are bounded together: a port that never answers is not a
  // connection to wait on (M7). A failed walk leaves nothing open behind it.
  const connect = () => withLimit(open(), CONNECT_LIMIT_MS, 'Spotify').catch(error => {
    socket = null;
    opening = null;
    throw error;
  });

  async function connection() {
    if (socket) return socket;
    opening ||= connect().finally(() => { opening = null; });
    return opening;
  }

  return {
    async evaluate(expression) {
      const ws = await connection();
      const id = ++nextId;
      const answer = await withLimit(new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      }), CALL_LIMIT_MS, 'Spotify').finally(() => pending.delete(id));
      const details = answer.result?.exceptionDetails;
      if (details) {
        const text = String(details.exception?.description ?? details.text ?? '');
        // Everything the page threw means the player cannot be reached, except a call it refuses
        // for its parameter: that one must not be answered with the media session (M2).
        const refused = /invalid|argument|must be/i.test(text);
        throw spotifyError(refused ? 'invalid-response' : 'unavailable', 'Spotify\'s player refused the call', text.split('\n')[0]);
      }
      return answer.result?.result?.value;
    },
    // Whether a page is open right now: a connection still being made is no page to ask anything.
    connected: () => socket !== null,
    close() {
      try { socket?.close(); } catch { /* closed already */ }
      socket = null;
      opening = null;
      drop();
    },
  };
}

// A helper that answers nothing within its limit is ended and started again (M5).
const HELPER_RETRY_MS = Object.freeze([20000, 60000, 300000]);

// The PowerShell that speaks to the media session; started on first use, again after it ends. A
// helper that could not be started is not started again at once: each start that failed in a row
// pushes the next one further out, and one answer clears it (M5). A PowerShell this computer does
// not have would otherwise be spawned once per status read.
function createMediaSession({ spawnProcess, warn, shellPath = 'powershell.exe', now = Date.now }) {
  let child = null;
  let buffer = '';
  let nextId = 0;
  // Starts in a row that did not reach a working helper, and how long the next one waits.
  let failures = 0;
  let retryAt = 0;
  // The start failure already written to the log: the same one is not written again.
  let notedStartFailure = '';
  const pending = new Map();

  const noteFailure = () => {
    failures += 1;
    retryAt = now() + HELPER_RETRY_MS[Math.min(failures, HELPER_RETRY_MS.length) - 1];
  };
  const noteAnswer = () => {
    failures = 0;
    retryAt = 0;
    notedStartFailure = '';
  };

  // The helper is let go whole: its pending answers fail, its process ends and the next command
  // starts a new one. Its buffer goes too, so half a line of the old helper never reaches the new
  // one's answers (M5).
  const drop = error => {
    const proc = child;
    child = null;
    buffer = '';
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    try { proc?.kill(); } catch { /* ended already */ }
  };

  const start = () => {
    // The script goes in as -EncodedCommand (UTF-16LE, base64), so stdin carries the commands only.
    const encoded = Buffer.from(SMTC_SCRIPT, 'utf16le').toString('base64');
    const proc = spawnProcess(shellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('{')) continue;
        let answer;
        try { answer = JSON.parse(line); } catch { continue; }
        const entry = pending.get(answer.id);
        if (!entry) continue;
        pending.delete(answer.id);
        // The helper works: the next one that has to be started starts at once.
        noteAnswer();
        if (answer.ok) entry.resolve(answer.data);
        else entry.reject(spotifyError('unavailable', 'The media session did not answer', String(answer.error ?? '')));
      }
    });
    // A helper whose input went away cannot answer anything again: it is let go, and the next
    // command starts a fresh one (M5).
    proc.stdin.on('error', error => {
      warn('[SpotifyClient] the media session helper lost its input', error);
      if (child !== proc) return;
      noteFailure();
      drop(spotifyError('unavailable', 'The media session helper is not reachable'));
    });
    // A helper that ended is let go, and the next command starts a new one. Only the helper that is
    // still the current one: an older process ending later must not fail the answers of the new one
    // (M5, L1).
    proc.on('exit', () => {
      if (child !== proc) return;
      child = null;
      noteFailure();
      for (const { reject } of pending.values()) reject(spotifyError('unavailable', 'The media session helper ended'));
      pending.clear();
    });
    // A start that failed: the same error is written once, not on every status read that tries it.
    proc.on('error', error => {
      noteFailure();
      const line = String(error?.message ?? error);
      if (line !== notedStartFailure) {
        notedStartFailure = line;
        warn('[SpotifyClient] the media session helper could not be started', error);
      }
      if (child === proc) drop(spotifyError('unavailable', 'The media session helper could not be started'));
    });
    child = proc;
    return proc;
  };

  return {
    ask(op, extra = {}) {
      // A helper that just failed to start waits its backoff out before another is started (M5).
      if (!child && now() < retryAt) {
        return Promise.reject(spotifyError('unavailable', 'The media session is not reachable', 'its helper is being retried'));
      }
      // Loading the WinRT projection takes a few seconds the first time.
      const started = child !== null;
      const proc = child ?? start();
      const id = ++nextId;
      let timedOut = false;
      const answer = withLimit(new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { proc.stdin.write(`${JSON.stringify({ id, op, ...extra })}\n`); } catch (error) {
          pending.delete(id);
          reject(spotifyError('unavailable', 'The media session helper could not be asked', String(error?.message ?? error)));
        }
      }), started ? CALL_LIMIT_MS : FIRST_SESSION_CALL_LIMIT_MS, 'The media session').catch(error => {
        timedOut = error?.code === 'network';
        throw error;
      }).finally(() => {
        pending.delete(id);
        // A helper that did not answer is ended: the next command starts a fresh one (M5).
        if (timedOut && child === proc) {
          noteFailure();
          drop(spotifyError('unavailable', 'The media session helper was restarted'));
        }
      });
      return answer;
    },
    close() {
      try { child?.kill(); } catch { /* ended already */ }
      child = null;
      buffer = '';
    },
  };
}

// `env` names the folders the launcher is looked for in; `platform` is process.platform.
function createSpotifyOfficialClient({
  env = process.env, platform = process.platform, fetch = globalThis.fetch, port = CDP_PORT,
  spawnProcess = spawn, runFile = execFile, waitFor = wait,
  log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
} = {}) {
  // Windows' own tools are run by their absolute path: a process started with a PATH another
  // program wrote must not decide which tasklist runs, nor which PowerShell (L5).
  const systemTool = name => path.join(env.SystemRoot || 'C:\\Windows', 'System32', name);

  const page = createPageConnection({ fetch, port });
  const mediaSession = platform === 'win32' ? createMediaSession({ spawnProcess, warn, shellPath: systemTool('WindowsPowerShell\\v1.0\\powershell.exe') }) : null;
  let starting = null;
  let failedStartAt = 0;
  let fallbackNoted = false;
  // How often Spotify was closed and started again in this run (D1).
  let forceRestarts = 0;
  // Whether this run of Folia started Spotify: the app is closed with Folia only when it did, or
  // when the DevTools port Folia opened it with still answers (D3).
  let startedByUs = false;
  // Whether an advertisement is muted in the page right now, as its own answers said (L2).
  let adMuted = false;

  const debugPortAnswers = async () => {
    try {
      const response = await withLimit(fetch(`http://${CDP_HOST}:${port}/json/version`), 1500, 'Spotify');
      return response.ok;
    } catch { return false; }
  };

  // Whether the program answering on the port is Spotify: another program that happens to hold
  // 9283 is not Folia's, and Spotify must not be closed for it (D3).
  const spotifyAnswersOnPort = async () => {
    try {
      const response = await withLimit(fetch(`http://${CDP_HOST}:${port}/json/version`), 1500, 'Spotify');
      if (!response.ok) return false;
      const version = await response.json();
      return /spotify/i.test(`${version?.Browser ?? ''} ${version?.['User-Agent'] ?? ''}`);
    } catch { return false; }
  };

  // Both tools are bounded (N3): a taskkill that hangs must not hold the quit.
  const spotifyIsRunning = () => new Promise(resolve => {
    runFile(systemTool('tasklist.exe'), ['/FI', 'IMAGENAME eq Spotify.exe', '/NH'], { windowsHide: true, timeout: 2000 }, (error, stdout) => {
      resolve(!error && /Spotify\.exe/i.test(String(stdout)));
    });
  });

  // Best effort, bounded: a window that cannot be hidden is no reason to fail a start.
  const minimizeSpotifyWindows = () => new Promise(resolve => {
    const encoded = Buffer.from(MINIMIZE_SCRIPT, 'utf16le').toString('base64');
    runFile(systemTool('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: MINIMIZE_LIMIT_MS }, error => {
      if (error) warn('[SpotifyClient] the Spotify window could not be hidden into the tray', error);
      resolve();
    });
  });

  const stopSpotify = () => new Promise(resolve => {
    runFile(systemTool('taskkill.exe'), ['/IM', 'Spotify.exe', '/F'], { windowsHide: true, timeout: 2000 }, () => resolve());
  });

  // Spotify open with the DevTools port and its player found.
  //
  // `allowRestart` is the listener's own action (a play, the launch switch): only then may a
  // Spotify running without the port be closed and started again, and only once in a run (D1).
  // Spotify that is not running is only started, never closed. Anything else answers the media
  // session instead, so a status read never closes the app the listener opened.
  async function start({ restart = false, allowRestart = false } = {}) {
    if (platform !== 'win32') throw spotifyError('unsupported', 'The Spotify app is steered on Windows only');
    const answers = !restart && await debugPortAnswers();
    // Whether this call started the Spotify it now waits for: only then is its window Folia's to tuck away.
    let spawned = false;
    if (!answers) {
      const launcher = findLauncher(env);
      if (!launcher) throw spotifyError('unavailable', 'The Spotify app is not installed');
      if (await spotifyIsRunning()) {
        if (!allowRestart) throw spotifyError('unavailable', 'Spotify runs without its DevTools port', 'this call may not restart it');
        if (forceRestarts >= MAX_FORCE_RESTARTS) {
          throw spotifyError('unavailable', 'Spotify runs without its DevTools port', `a restart already spent this run (${forceRestarts})`);
        }
        forceRestarts += 1;
        log(restart ? '[SpotifyClient] Spotify is started again, as asked' : '[SpotifyClient] Spotify runs without the DevTools port; it is started again with it');
        page.close();
        await stopSpotify();
        await waitFor(1500);
      } else if (startedByUs) {
        // The Spotify this run started is not running any more: the listener closed it, so the one
        // started below is a new one, and the quit must not close a Spotify it did not start (D3).
        startedByUs = false;
      }
      // Started in the tray where Spotify honours the flag, so Folia raising it neither opens a
      // window nor takes the focus; the window is hidden into the tray below where it came up anyway.
      const child = spawnProcess(launcher, [START_MINIMIZED_FLAG, `--remote-debugging-port=${port}`, `--remote-allow-origins=http://${CDP_HOST}:${port}`], { detached: true, stdio: 'ignore', windowsHide: false });
      spawned = true;
      child.on?.('error', error => warn('[SpotifyClient] Spotify could not be started', error));
      child.unref?.();
      startedByUs = true;
      log('[SpotifyClient] Spotify was started with the DevTools port');
    }
    const deadline = Date.now() + LAUNCH_WAIT_MS;
    let lastError = null;
    let rounds = 0;
    while (Date.now() < deadline) {
      rounds += 1;
      // The window usually exists a moment after the process: tucked away early too, so it does not stay up while the page loads.
      if (spawned && rounds === 3) await minimizeSpotifyWindows();
      try {
        if (await page.evaluate(`Boolean(${FIND_APIS})`)) {
          if (spawned) await minimizeSpotifyWindows();
          return;
        }
      } catch (error) {
        lastError = error;
        page.close();
      }
      await waitFor(700);
    }
    throw lastError ?? spotifyError('unavailable', 'Spotify\'s player was not found');
  }

  const ensure = options => {
    starting ||= start(options).then(() => { failedStartAt = 0; }, error => {
      failedStartAt = Date.now();
      throw error;
    }).finally(() => { starting = null; });
    return starting;
  };

  // The player kept in the page is dropped and looked for once more before a call is called a
  // failure: Spotify replaces its React tree when its UI changes (M2).
  const evaluateInPage = async body => {
    try {
      return await page.evaluate(inPage(body));
    } catch (error) {
      if (error?.code === 'invalid-response') throw error;
      try { await page.evaluate(FORGET_APIS); } catch { /* the page is gone as well */ }
      return page.evaluate(inPage(body));
    }
  };

  // One call in the page. `allowStart` is set only for a call a listener asked for (a play):
  // every other call reports what it could not do instead of touching Spotify (D1, H1, H2).
  async function call(body, { allowStart = false } = {}) {
    try {
      return await evaluateInPage(body);
    } catch (error) {
      if (error?.code === 'invalid-response') throw error;
      page.close();
      if (!allowStart) throw error;
      if (failedStartAt && Date.now() - failedStartAt < RESTART_COOLDOWN_MS) {
        // A start that failed a moment ago is not tried again (D1): the renderer is told the app
        // cannot be reached rather than what the socket said, so it can fall back (D2, M4).
        throw spotifyError('unavailable', 'The Spotify app cannot be reached', 'a start was given up a moment ago');
      }
      await ensure({ allowRestart: true });
      return evaluateInPage(body);
    }
  }

  // What can still be done without the page goes to the media session, once said in the log.
  async function orMediaSession(body, op, extra, options = {}) {
    try {
      return await call(body, options);
    } catch (error) {
      if (!mediaSession || error?.code === 'invalid-response') throw error;
      if (!fallbackNoted) {
        fallbackNoted = true;
        warn('[SpotifyClient] the player cannot be reached; the media session steers Spotify', error);
      }
      return mediaSession.ask(op, extra);
    }
  }

  // An advertisement that muted Spotify is given its volume back: the mute lives in the page and
  // would outlive Folia otherwise (L2). Bounded, because a page that stopped answering must not
  // hold the quit (N3).
  async function releaseAdMute() {
    if (!adMuted || !page.connected()) return;
    adMuted = false;
    try {
      await withLimit(page.evaluate(inPage(adMuteBody(false))), 1000, 'Spotify');
    } catch { /* the page may be gone meanwhile */ }
  }

  return {
    // Asked by the launch switch (or at app start): tries again even within the cool-down, and
    // may close and start Spotify once, as the listener asked for it (D1).
    launch: () => ensure({ allowRestart: true }).then(() => true),
    // Closes Spotify and starts it again with the DevTools port (a start under way is waited for
    // instead). Counted against the same once-a-run budget (D1).
    restart() {
      page.close();
      return ensure({ restart: true, allowRestart: true }).then(() => true);
    },

    // Whether Spotify's app is on this computer at all, without starting anything: the launcher
    // is looked for on disk and nothing else (D2). The caller caches the answer.
    available() {
      if (platform !== 'win32') return { available: false, reason: 'unsupported' };
      return findLauncher(env) ? { available: true } : { available: false, reason: 'not-installed' };
    },

    // D3: Folia quits and the listener asked for Spotify to be closed with it. Closed when this
    // run started it, or when it runs with the DevTools port Folia opened it with; a Spotify the
    // listener started without the port is left alone, and so is a port another program holds.
    //
    // An advertisement that muted Spotify has its volume given back before the app is closed (L2):
    // the mute lives in the page, and a page killed with it keeps Spotify silent for good.
    async closeForQuit() {
      if (platform !== 'win32') return false;
      // A Spotify this run started and the listener closed meanwhile is not Folia's to close.
      if (startedByUs && !(await spotifyIsRunning())) startedByUs = false;
      if (!startedByUs && !(await spotifyAnswersOnPort())) return false;
      await releaseAdMute();
      page.close();
      await stopSpotify();
      startedByUs = false;
      log('[SpotifyClient] Spotify was closed as Folia quits');
      return true;
    },

    // Whether quitting has something to wait for in the page: an advertisement mute still on (L2).
    releasePending: () => Boolean(page.connected() && adMuted),

    // Plays one track from `startMs` with Spotify's own repeat and shuffle off: the order is Folia's.
    // Resolves once Spotify has the track loaded, so a status read after it is about this track.
    //
    // Answers where it stopped (N8): 'loaded' when the track is the one playing, 'preempted' when a
    // newer play took over (nothing went wrong), and 'not-loaded' when Spotify never got to it.
    // `userAction` says a listener asked for this song; only then may Spotify be started or started
    // again (D1). An advance Folia made by itself passes false: the app it could not reach stays
    // as it is.
    async play({ id, startMs = 0, userAction = true }) {
      const uri = trackUri(id);
      const from = Math.max(0, Math.round(Number(startMs) || 0));
      return call(`
        const uri = ${JSON.stringify(uri)};
        // A newer play makes this one stop after its next wait, before it can seek or change the
        // repeat of the track the listener asked for afterwards (L3).
        window.__foliaPlay = (window.__foliaPlay || 0) + 1;
        const serial = window.__foliaPlay;
        const current = () => window.__foliaPlay === serial;
        if (typeof api.player.clearQueue === 'function') await api.player.clearQueue();
        if (!current()) return 'preempted';
        await api.player.play({ uri }, {}, {});
        if (!current()) return 'preempted';
        let loaded = false;
        for (let i = 0; i < 50; i += 1) {
          const s = api.player.getState();
          if (s && s.item && s.item.uri === uri) { loaded = true; break; }
          await new Promise(r => setTimeout(r, 100));
          if (!current()) return 'preempted';
        }
        // The track is moved and adjusted only once it is the one loaded: an advertisement playing
        // meanwhile is never seeked into (L3).
        if (!loaded) return 'not-loaded';
        if (!current()) return 'preempted';
        const s = api.player.getState();
        if (s && s.repeat !== 0) await api.player.setRepeat(0);
        if (!current()) return 'preempted';
        if (s && s.shuffle) await api.player.setShuffle(false);
        if (${from} > 0) await api.player.seekTo(${from});
        return 'loaded';
      `, { allowStart: userAction });
    },

    // The songs that are to follow, put in Spotify's queue so it moves on to them by itself. A
    // queue write is never a reason to start or close Spotify (D1): it reports what it could not
    // do, and the caller keeps its prepared tail unset and asks again (L4).
    queue({ ids }) {
      const uris = (Array.isArray(ids) ? ids : []).slice(0, MAX_QUEUED).map(trackUri);
      return call(`
        if (typeof api.player.clearQueue === 'function') await api.player.clearQueue();
        const uris = ${JSON.stringify(uris)};
        if (uris.length) await api.player.addToQueue(uris.map(uri => ({ uri })));
        return uris.length;
      `);
    },

    // Pausing, resuming and seeking never start or close Spotify (D1, H2): they answer from the
    // media session when the page cannot be reached, and fail there when it cannot either.
    pause: () => orMediaSession('await api.player.pause(); return true;', 'pause'),
    resume: () => orMediaSession('await api.player.resume(); return true;', 'resume'),

    seek({ ms }) {
      const target = Math.max(0, Math.round(Number(ms) || 0));
      return orMediaSession(`await api.player.seekTo(${target}); return true;`, 'seek', { ms: target });
    },

    // The listener's own volume; a volume chosen while an advertisement plays is the one given
    // back when it is over (L2).
    setVolume({ value }) {
      const volume = Math.min(1, Math.max(0, Number(value)));
      if (!Number.isFinite(volume)) throw spotifyError('invalid-response', 'Invalid volume');
      return call(`
        if (ad.muted) { ad.volumeDuringAd = ${volume}; return true; }
        await api.playback.setVolume(${volume});
        return true;
      `);
    },

    // The player's state; from the media session (then `fallback` is set and no track is named)
    // when the page cannot be reached. A status read never starts or closes Spotify (D1, H2).
    async status() {
      let state;
      try {
        state = await evaluateInPage(STATE_BODY);
      } catch (error) {
        if (error?.code === 'invalid-response') throw error;
        page.close();
        if (!mediaSession) throw error;
        return statusFromMediaSession(await mediaSession.ask('status'));
      }
      const status = statusFromPlayerState(state, Date.now());
      const wasMuted = Boolean(state?.adMuted);
      if (status.ad !== wasMuted) {
        try {
          await page.evaluate(inPage(adMuteBody(status.ad)));
          log(status.ad ? '[SpotifyClient] an advertisement plays; it is muted' : '[SpotifyClient] the advertisement is over; the volume is given back');
          adMuted = status.ad;
        } catch (error) {
          warn('[SpotifyClient] the advertisement mute could not be changed', error);
          adMuted = wasMuted;
        }
      } else {
        adMuted = wasMuted;
      }
      return status;
    },

    // The app is quitting. An advertisement that muted Spotify has its volume given back first:
    // the mute is kept in the page and would outlive Folia otherwise (L2).
    async close() {
      // Only a mute this run set has anything to give back: a connection that was never made has
      // nothing, and waiting on a page that is not there would hold the quit.
      await releaseAdMute();
      page.close();
      mediaSession?.close();
    },
  };
}

module.exports = {
  CDP_PORT, createSpotifyOfficialClient, findLauncher, isAdvertisementItem, repeatModeOf, statusFromMediaSession, statusFromPlayerState,
};
