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
// Spotify is closed and started again only for a listener's own action (a play, the launch switch),
// and a run of Folia does that at most once. A status read, a pause, a resume, a seek or a queue
// write never starts Spotify and never closes it: a listener who closed Spotify keeps it closed, and
// a Spotify running without the port stays as it is until the listener plays a song.

// The port Folia asked CEF for before it let CEF pick one: the last candidate a search probes, and
// the port a Spotify an older run of Folia started is on. Only 127.0.0.1 is ever asked.
const CDP_PORT = 9283;
const CDP_HOST = '127.0.0.1';
// The file a Chromium or CEF writes the DevTools port it chose into, when it was asked for port 0.
const ACTIVE_PORT_FILE = 'DevToolsActivePort';
// The Microsoft Store build keeps its CEF profile under the package's LocalCache; the installer build
// keeps it under %APPDATA%\Spotify.
const STORE_PACKAGE_DIR = 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0';
// A search that found nothing is not repeated at once, and each one in a row waits longer: it costs
// a netstat and a probe per listener, and the Spotify it waits for may not have opened its port yet.
// A search that finds the port clears it.
const PORT_SCAN_BACKOFF_MS = Object.freeze([1000, 5000, 30000]);
// How many loopback listeners one search probes, and how long each probe may take.
const MAX_PORT_CANDIDATES = 32;
// The searches a session restore may make for the port in one run, and how far apart they are: a
// fresh run's first look can come before the app has opened its port (a listener who starts Folia and
// Spotify together), so one more look is worth making a few seconds later.
const STATUS_PORT_SEARCHES = 2;
const STATUS_PORT_SEARCH_GAP_MS = 3000;
const PORT_PROBE_LIMIT_MS = 600;
// The first of the two waits a start makes: how long the app itself is waited for - its process, its
// DevTools port and a page that answers a script - whichever way the start began (from nothing, after
// closing a Spotify the listener had open, or joining one already running).
const LAUNCH_WAIT_MS = 25000;
// The second wait, which begins only once that page has finished loading: how long the player inside
// the app is looked for. A build whose UI changed loads its page and answers no player at all, so a
// press must not be held for the whole of the first wait for it; a page that is still loading has not
// started this one, so a slow start keeps the whole of the first.
const PLAYER_FIND_WAIT_MS = 8000;
// How long a play waits for its track: the time the track itself makes no progress (a free account's
// advertisement does not count against it), and the whole wait, advertisement and all.
const START_LIMIT_MS = 5000;
const AD_START_LIMIT_MS = 60000;
const CALL_LIMIT_MS = 8000;
// A start waits for its track inside one call, so that call's own limit has to cover the whole wait
// (a free account's advertisement included) — a start cut off by the call's limit would fail where
// the wait would have succeeded.
const START_CALL_LIMIT_MS = AD_START_LIMIT_MS + CALL_LIMIT_MS;
const FIRST_SESSION_CALL_LIMIT_MS = 20000;
// The whole DevTools connection, the target list and the socket handshake both: a port taken by
// another program must not hold a play open for ever.
const CONNECT_LIMIT_MS = 4000;
// After a start that failed, an ordinary call goes to the media session for this long instead of
// starting Spotify again; a listener's own play asks once more regardless. A start that was never
// made because the restart was not agreed to leaves nothing to cool down: Spotify is untouched.
const RESTART_COOLDOWN_MS = 30000;
// How often one run of Folia may close and start Spotify again. A run that spent it stays on
// the media session until Folia is started again.
const MAX_FORCE_RESTARTS = 1;
const TRACK_ID = /^[0-9A-Za-z]{22}$/;
// The most songs one queue write may take. The renderer decides how many songs follow (its
// PREPARED_SONGS, one of them a single song where the app cannot empty its queue); this is only the
// ceiling of the page, and a test holds it to that window so a tail can never be cut here.
const MAX_QUEUED = 5;
// A Windows tool is given at most this long: a tasklist or a taskkill that hangs must not hold a play
// or the quit.
const TOOL_LIMIT_MS = 2000;
// Never less than this: a wait of a few milliseconds only ever fails, and `timeout: 0` means no limit
// at all to execFile.
const TOOL_LIMIT_FLOOR_MS = 100;
// How long a Spotify port takes to answer when nothing else says so.
const PORT_VERIFY_LIMIT_MS = 1500;
// The quit waits for the close at most 3 s in all (spotifyApiBridge's SHUTDOWN_LIMIT_MS). The taskkill
// has to be under way inside that, so what is asked before it - the tasklist, then the port search -
// waits only for what is left of this budget, less the little the taskkill itself needs to be handed
// to Windows: a close that spends the whole gate probing ports closes nothing.
const QUIT_CLOSE_BUDGET_MS = 2400;
const QUIT_TASK_ISSUE_RESERVE_MS = 250;

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

// The body of one call in the page, with the APIs as `api`.
const inPage = body => `(async () => { const api = ${FIND_APIS}; if (!api) throw new Error('player-unavailable'); ${body} })()`;

// Runs in the Spotify page: whether the app's own main interface has finished loading. The page that
// answers a script is not the page that is ready - a document still loading has a React tree without
// the player in it - so this is what starts the short wait for the player find below.
// The document being complete is the signal, and nothing narrower: a build may mount its interface
// into any element, or none, so an id it happens to use now is not something to wait on. Asked for one
// that a later version stopped using, this answered false for the whole of the first wait and a player
// that was never going to appear was looked for until that wait ran out.
const PAGE_LOADED = `(() => document.readyState === 'complete' && document.body !== null)()`;

// The player's state as it stands, read in the page and turned into Folia's status here
// (`statusFromPlayerState`). Page and process share one clock: both run on this computer.
const STATE_BODY = `
  const s = api.player.getState();
  const item = s && s.item;
  return {
    item: item ? { uri: item.uri, type: item.type, metadata: item.metadata ? { is_advertisement: item.metadata.is_advertisement } : null } : null,
    isPaused: Boolean(s && s.isPaused), isBuffering: Boolean(s && s.isBuffering),
    positionAsOfTimestamp: s && s.positionAsOfTimestamp, timestamp: s && s.timestamp, duration: s && s.duration,
    repeat: s && s.repeat,
  };
`;


// The songs that are to follow, written into the app's queue, run in the page: one added twice is one
// played twice. `queued` is the caller's own record - the ids it wrote that the app has not played
// yet - and it is what decides whether a song is written. A read taken after a write names fewer
// songs than were written, and a player that only adds can never take one back, so the read is used
// for the log and for whether the app can empty its queue at all: `probed`, null until this run's
// first write asks, and the answer kept until a later clear shows the app cannot do it after all.
// Emptying the queue is the app's own, and it takes the songs the listener queued there too: what the
// queue held that the caller's record does not own is put back, in its order, before the songs this
// write adds, so only the songs of Folia's are ever taken back.
// `generation` is the play this write belongs to, and a play that started meanwhile has emptied the
// queue for songs of its own.
const QUEUE_SOURCE = `async ({ api, uris, queued, probed, generation }) => {
  // The tracks the app plays after the one playing, as its state names them; null where it does not.
  // One of these names may be an alias the app always leaves empty while the queue is in another, so
  // an empty list is that name saying nothing, not a queue that is empty.
  const readQueue = () => {
    let s;
    try { s = api.player.getState(); } catch { return null; }
    let sawEmpty = false;
    let sawUnknown = false;
    for (const key of ['nextTracks', 'nextItems', 'queue']) {
      const list = s && s[key];
      if (!Array.isArray(list)) continue;
      if (list.length === 0) { sawEmpty = true; continue; }
      const ids = [];
      for (const entry of list) {
        const uri = typeof entry === 'string' ? entry : String((entry && (entry.uri || (entry.track && entry.track.uri))) || '');
        if (uri.indexOf('spotify:track:') === 0) ids.push(uri.slice(14));
      }
      if (ids.length) return ids;
      // An entry shape this does not know says nothing either: the caller's record is used instead.
      sawUnknown = true;
    }
    return sawUnknown ? null : sawEmpty ? [] : null;
  };
  const held = new Set(Array.isArray(queued) ? queued : []);
  // A play of a newer song emptied the app's queue for its own tail, so the songs this write would
  // add belong behind the song before it. A page loaded again has run no play at all: its generation
  // is taken as it stands rather than read as a newer one.
  if (window.__foliaPlay === undefined) window.__foliaPlay = generation;
  if (window.__foliaPlay !== generation) {
    return { aborted: true, canClear: probed, cleared: false, written: [], read: null };
  }
  // The queue as this run found it, before it wrote anything: the app may still hold the tail a
  // window before this one wrote, and a song of Folia's is never added twice behind it.
  const before = readQueue();
  let canClear = probed;
  if (canClear !== false) {
    if (typeof api.player.clearQueue !== 'function') canClear = false;
    else { try { await api.player.clearQueue(); } catch { canClear = false; } }
  }
  // A queue that reads back empty was emptied, so the whole tail is written into it. One that still
  // names songs was not emptied, and one the app does not name says nothing either way: both are
  // added to, one song at a time, and a song Folia wrote or the app already holds is left alone.
  // This is also how the first write of a run learns whether the app can empty its queue at all.
  const left = canClear === false ? null : readQueue();
  const cleared = Boolean(left) && left.length === 0;
  // A clear that ran and left songs behind emptied nothing: one song at a time for the rest of the
  // run. A queue that cannot be read says nothing, and what this run already found stands.
  if (left) canClear = cleared;
  if (window.__foliaPlay !== generation) {
    return { aborted: true, canClear, cleared: false, written: [], read: null };
  }
  const added = (cleared ? uris : uris.filter(uri => !held.has(uri.slice(14)) && !(before || []).includes(uri.slice(14))))
    .map(uri => uri.slice(14));
  // The clear took every song the app held, and the app's queue is also where the listener puts songs
  // of their own. Those are not in the caller's record, so the places they held are given back to
  // them, in the order they were in, and never counted as songs of Folia's: a later take-back leaves
  // them alone. The places Folia wrote take the songs of this write, in this write's order, so the
  // listener's songs keep their place among them; what this write has beyond those places follows
  // them. A song the listener queued twice held two places, and gets both of them back.
  const toAdd = [];
  let next = 0;
  for (const id of cleared ? (before || []) : []) {
    if (held.has(id) || uris.includes('spotify:track:' + id)) {
      // A place of Folia's: the song this write puts there, or none where it writes fewer.
      if (next < added.length) toAdd.push(added[next++]);
    } else toAdd.push(id);
  }
  while (next < added.length) toAdd.push(added[next++]);
  // The clear has already run, so a queue that cannot take these songs back leaves the listener
  // without the songs they queued: an answer of its own says so rather than failing the whole write,
  // which the caller would read as a queue it never emptied.
  if (toAdd.length) {
    try {
      await api.player.addToQueue(toAdd.map(id => ({ uri: 'spotify:track:' + id })));
    } catch (error) {
      console.warn('[SpotifyClient] the songs to follow could not be put back after the queue was emptied', error);
      return { aborted: false, canClear, cleared, restored: false, written: [], read: readQueue() };
    }
  }
  // Only the songs of Folia's are reported as written: the record decides what a take-back takes.
  return { aborted: false, canClear, cleared, restored: true, written: added, read: readQueue() };
}`;

// A start's own emptying of the app's queue, run in the page. The app's queue is also where the
// listener puts songs of their own, and a start used to empty it wholly: what it took that Folia
// never wrote is given back, in the order it was in, and never counted as a song of Folia's.
//
// `owned` is the caller's record - the ids it wrote that the app has not played yet. Only those
// places are Folia's, and a start writes nothing of its own into the queue: the song it starts is
// played by its own call, and the songs that follow it are put there by the queue write after. So
// what is given back is exactly the listener's songs, in the order they held. A player that cannot
// empty its queue, or one whose clear left songs behind, is left as it is and said so: nothing is
// taken from the listener then, and the queue write that follows adds to it.
const START_QUEUE_SOURCE = `async ({ api, owned, replaceQueue }) => {
  // The tracks the app plays after the one playing, as its state names them; null where none of its
  // names says anything (an alias left empty, an entry shape this does not know).
  const heldIds = () => {
    let s;
    try { s = api.player.getState(); } catch { return null; }
    let sawEmpty = false;
    for (const key of ['nextTracks', 'nextItems', 'queue']) {
      const list = s && s[key];
      if (!Array.isArray(list)) continue;
      if (list.length === 0) { sawEmpty = true; continue; }
      const ids = [];
      for (const entry of list) {
        const uri = typeof entry === 'string' ? entry : String((entry && (entry.uri || (entry.track && entry.track.uri))) || '');
        if (uri.indexOf('spotify:track:') === 0) ids.push(uri.slice(14));
      }
      if (ids.length) return ids;
    }
    return sawEmpty ? [] : null;
  };
  if (typeof api.player.clearQueue !== 'function') return { cleared: false, canClear: false, written: [], read: null };
  const mine = new Set(Array.isArray(owned) ? owned : []);
  // What the queue held before the clear, and the songs of the listener's among them.
  const before = heldIds();
  try { await api.player.clearQueue(); } catch { return { cleared: false, canClear: false, written: [], read: null }; }
  // A clear that ran and left songs behind emptied nothing: it is not emptied again for this run.
  const left = heldIds();
  if (left && left.length > 0) return { cleared: false, canClear: false, written: [], read: left };
  // A queue that cannot be read back after the clear says nothing either way: it is no proof that the
  // songs are gone, so this start claims neither that it emptied the queue nor that the app can empty
  // it at all. canClear is left unknown rather than answered, and the caller keeps what it already
  // knows, as a write does with a queue it cannot read (QUEUE_SOURCE).
  const emptied = Boolean(left) && left.length === 0;
  if (!emptied) return { cleared: false, canClear: null, written: [], read: left };
  if (!before) return { cleared: true, canClear: true, written: [], read: left };
  // A whole list of the listener's replaced Folia's queue: the queue they had built in the app goes
  // with it, their own songs included, and nothing is put back. Every other start takes back only the
  // places of Folia's own record.
  if (replaceQueue === true) return { cleared: true, canClear: true, restored: true, written: [], read: heldIds() };
  const theirs = before.filter(id => !mine.has(id));
  if (theirs.length) {
    try {
      await api.player.addToQueue(theirs.map(id => ({ uri: 'spotify:track:' + id })));
    } catch (error) {
      // The clear has already run, so the listener's songs are gone with it: said rather than
      // failing the start, which the caller would read as a song that never loaded.
      console.warn('[SpotifyClient] the songs the app queue held could not be put back after it was emptied', error);
      return { cleared: true, canClear: true, restored: false, written: [], read: heldIds() };
    }
  }
  return { cleared: true, canClear: true, restored: true, written: [], read: heldIds() };
}`;

// The listener's own repeat and shuffle, as far as one play has to change them, run in the page.
// Only what would stop Folia's queue from being played as written is touched, and what was changed
// is answered so it can be put back afterwards (`RESTORE_STATE_SOURCE`).
//
// Repeat: the play names one track uri and no context, so Spotify's repeat of the list has nothing
// to repeat here and is the listener's to keep. Repeat of the track does not: it replays this song
// wherever the queue would go on, which is exactly the handoff Folia wrote into that queue.
// Shuffle: it reorders the queue the app plays from, so the songs Folia put behind this one would
// come out in an order Folia never wrote. It is turned off, and said so.
const PLAY_STATE_SOURCE = `async ({ api }) => {
  const changed = { repeat: null, shuffle: null };
  let s;
  try { s = api.player.getState(); } catch { return changed; }
  if (s && s.repeat === 2 && typeof api.player.setRepeat === 'function') {
    try { await api.player.setRepeat(0); changed.repeat = 'one'; } catch { /* left as it was */ }
  }
  if (s && s.shuffle === true && typeof api.player.setShuffle === 'function') {
    try { await api.player.setShuffle(false); changed.shuffle = true; } catch { /* left as it was */ }
  }
  return changed;
}`;

// What a play changed of the listener's own, put back as it was. `repeat` is Spotify's own number
// (2 the track, 1 the list) or null where this play changed none, and `shuffle` says whether it
// turned a shuffle off. Each one is written back only where the app still holds the value the play
// left it at - repeat off, shuffle off. A value the listener set themselves after the play is theirs
// and is never written over: it answers 'theirs', which is read as done rather than tried again.
// The state is read first, and where it cannot be read nothing is written at all: without it there
// is no sign the value is still the one Folia wrote, so the record is kept for a later restore.
// A player that refuses a call leaves that one as it is.
const RESTORE_STATE_SOURCE = `async ({ api, repeat, shuffle }) => {
  const put = { repeat: false, shuffle: false, read: true };
  if (repeat === null && !shuffle) return put;
  let s = null;
  try { s = typeof api.player.getState === 'function' ? api.player.getState() : null; } catch { s = null; }
  if (!s || typeof s !== 'object') {
    put.read = false;
    return put;
  }
  if (repeat !== null && typeof api.player.setRepeat === 'function') {
    if (s.repeat === 0) {
      try { await api.player.setRepeat(repeat); put.repeat = true; } catch { /* left as it is */ }
    } else {
      put.repeat = 'theirs';
    }
  }
  if (shuffle && typeof api.player.setShuffle === 'function') {
    if (s.shuffle === false) {
      try { await api.player.setShuffle(true); put.shuffle = true; } catch { /* left as it is */ }
    } else {
      put.shuffle = 'theirs';
    }
  }
  return put;
}`;

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

// The wait a play makes for the track it asked for, run in the page. A free account's start is often
// preceded by an advertisement, and the time the app spends on one is no sign that the track will not
// come: only the time with no advertisement on the screen counts against the start, and the whole wait
// is capped, so a start can neither fail on an advertisement nor hang on one that does not end.
// Answers 'loaded' (the track is the one loaded), 'advertisement' (the app took the track and an
// advertisement still runs before it: the status reads follow it), 'not-loaded' (the track never came),
// 'unavailable' (the page says it will not play this track, with the code and reasons it gave),
// 'premium-only' (the same, with the account's plan as the only reason it gives) or 'preempted' (a
// newer play took the app). A source string because it is the page's code; a test drives it with a
// stand-in player.
const START_WAIT_SOURCE = `async ({ api, uri, isAd, current, sleep }) => {
  let waited = 0;
  let total = 0;
  let lastWasAd = false;
  // A track Spotify will not play is named by the player itself as soon as it is asked for, and no
  // wait makes it come: it is read on every look, and a code and reasons such as
  // ONE_TRACK_UNPLAYABLE with NOT_AVAILABLE_IN_CURRENT_REGION are answered as they are. A reason that
  // says the free account is what stops it, and no other, is not the track being gone: that one is
  // answered as its own thing, and the song is shown as one a plan would play. Every other error, an
  // error of another shape, and a player that throws while its error is read say nothing about this
  // track, and the wait goes on as it does without one.
  // The error is the page's own record of the last track it was told to play, so it outlives the
  // start that made it: one look does not say this start failed. A refusal read once is held and
  // read again one look later (refusedFor below), and an error that names a track of its own speaks
  // only about that track - an error naming none is the player's own answer for what it is playing,
  // and the second look is what speaks for it.
  // Only the fields that name the track the app was told to play: the context track of an error is the
  // list it plays from, so naming one there would read a song of the list as this start's own answer.
  const errorTrackUri = error => {
    for (const value of [error?.uri, error?.item?.uri, error?.track?.uri]) {
      if (typeof value === 'string' && value) return value;
    }
    return null;
  };
  const refusal = () => {
    try {
      const error = api.player?._contextPlayer?.getError?.();
      const words = r => r.toUpperCase().replace(/[^A-Z]/g, '');
      const code = typeof error?.code === 'string' ? words(error.code) : '';
      const reasons = Array.isArray(error?.reasons) ? error.reasons.filter(r => typeof r === 'string') : [];
      const gone = reasons.map(words).filter(r => r.indexOf('NOTAVAILABLE') === 0);
      if (code !== 'ONETRACKUNPLAYABLE' || gone.length === 0) return null;
      const planOnly = gone.length === 1 && gone[0] === 'NOTAVAILABLEINNONPREMIUM';
      return { answered: { answer: planOnly ? 'premium-only' : 'unavailable', code: error.code, reasons }, trackUri: errorTrackUri(error) };
    } catch {
      return null;
    }
  };
  const refusedFor = () => {
    const read = refusal();
    if (!read) return null;
    if (read.trackUri && read.trackUri !== uri) return null;
    return read.answered;
  };
  // The refusal of the look before, held until the next look says the same: a track named once and
  // gone from the player's error by the next look is the error of the song before this one.
  let heldRefusal = null;
  while (true) {
    const s = api.player.getState();
    if (s && s.item && s.item.uri === uri) return 'loaded';
    // An advertisement on the screen says nothing about the track this start asked for: the error the
    // page keeps is then the one of the song before this start, and a free account's start is exactly
    // where an advertisement plays. No refusal is taken while one is on, and the one held before it is
    // dropped, so the look right after the advertisement is this start's first one again: a refusal
    // read there is held and read once more, as it is for a start with no advertisement at all.
    lastWasAd = isAd(s && s.item);
    const refused = lastWasAd ? null : refusedFor();
    if (refused) {
      if (heldRefusal && heldRefusal.answer === refused.answer) return refused;
      heldRefusal = refused;
    } else {
      heldRefusal = null;
    }
    total += 100;
    if (!lastWasAd) waited += 100;
    if (waited >= ${START_LIMIT_MS} || total >= ${AD_START_LIMIT_MS}) return lastWasAd ? 'advertisement' : 'not-loaded';
    await sleep(100);
    if (!current()) return 'preempted';
  }
}`;

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
// the one Folia asked for, which the media session cannot name.
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

// The window of a Spotify this run starts is never on the screen, and only that window is touched.
//
// Spotify shows its window by itself, from its own process, a moment after it starts: measured
// 2026-11-07 on the Microsoft Store build (1.306.1921.0, Windows 11), the CEF window exists hidden
// about 0.9 s after the alias is run and Spotify shows it about 0.1 s later. Nothing Folia can put on
// the start talks it out of that: STARTUPINFO's SW_HIDE (Node's `windowsHide`) and the app's own
// `--minimized` are both ignored, and the packaged exe cannot be started at all outside the alias
// (measured: EPERM, and `C:\Program Files\WindowsApps` cannot even be listed). So the hide is Folia's
// to make, in the same frame: the window is caught by a WinEvent hook the moment it is shown and
// hidden with ShowWindow, which waits for Spotify's own thread to take it. Measured: one sample at
// 5 ms against 1.4 s before, i.e. under one frame — the taskbar button never has the time to appear.
//
// The PIDs already running are skipped: a Spotify the listener opened is not Folia's to tuck away.
const WINDOW_WATCH_SCRIPT = skipPids => `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class FoliaSpotifyWindow
{
    delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr window, int idObject, int idChild, uint thread, uint time);
    public delegate bool EnumWindowsDelegate(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventDelegate callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsDelegate callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint id, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr window; public uint id; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    const uint EVENT_OBJECT_SHOW = 0x8002;
    const uint WM_QUIT = 0x0012;
    const uint GW_OWNER = 4;
    const int SW_HIDE = 0;

    static readonly int[] Skip = new int[] {${skipPids.join(', ')}};
    static readonly object Decision = new object();
    // Whether a window belongs to the Spotify this start made never changes for a PID, and the sweep
    // looks at every window of the desktop: what it decided once, it keeps (a start lasts seconds).
    static readonly HashSet<int> Ours = new HashSet<int>();
    static readonly HashSet<int> Theirs = new HashSet<int>();
    static WinEventDelegate _callback;
    static uint _pumpThread;
    static volatile bool _stop;
    static int _hidden;

    static bool IsOurs(uint pid)
    {
        int id = (int)pid;
        lock (Decision) {
            if (Ours.Contains(id)) return true;
            if (Theirs.Contains(id)) return false;
        }
        foreach (int skip in Skip) { if (skip == id) return false; }
        bool ours;
        try { using (Process process = Process.GetProcessById(id)) { ours = process.ProcessName.StartsWith("Spotify", StringComparison.OrdinalIgnoreCase); } }
        catch { ours = false; }
        lock (Decision) { (ours ? Ours : Theirs).Add(id); }
        return ours;
    }

    // The song window and nothing else: CEF's own top-level window of a Spotify this start created,
    // once it is visible. ShowWindow waits for Spotify's thread to take the hide, which is what keeps
    // the window off the screen rather than off it one frame late.
    static void Hide(IntPtr window)
    {
        if (window == IntPtr.Zero) return;
        if (GetWindow(window, GW_OWNER) != IntPtr.Zero) return;
        StringBuilder name = new StringBuilder(256);
        GetClassName(window, name, 256);
        if (!name.ToString().StartsWith("Chrome_WidgetWin_1", StringComparison.Ordinal)) return;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        if (!IsOurs(pid)) return;
        if (!IsWindowVisible(window)) return;
        ShowWindow(window, SW_HIDE);
        Interlocked.Increment(ref _hidden);
        Console.Out.WriteLine("HIDDEN " + window.ToInt64() + " " + pid);
        Console.Out.Flush();
    }

    // The hook runs on the thread that shows the window, so it takes no lock the sweep could be holding:
    // waiting for a sweep to walk the desktop would be the frame this hide exists to win.
    static void OnShow(IntPtr hook, uint eventType, IntPtr window, int idObject, int idChild, uint thread, uint time)
    {
        if (idObject != 0) return;
        Hide(window);
    }

    // The hook covers the show itself; this covers a window that is created visible, which sends no
    // show of its own.
    static void Sweep()
    {
        while (!_stop)
        {
            EnumWindows(delegate(IntPtr window, IntPtr parameter) { Hide(window); return true; }, IntPtr.Zero);
            Thread.Sleep(20);
        }
    }

    static void Expire(int milliseconds)
    {
        Thread.Sleep(milliseconds);
        _stop = true;
        PostThreadMessage(_pumpThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    public static void Run(int lifetimeMs)
    {
        _pumpThread = GetCurrentThreadId();
        Thread sweep = new Thread(delegate() { Sweep(); });
        sweep.IsBackground = true;
        sweep.Start();
        Thread expiry = new Thread(delegate() { Expire(lifetimeMs); });
        expiry.IsBackground = true;
        expiry.Start();
        _callback = new WinEventDelegate(OnShow);
        SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, IntPtr.Zero, _callback, 0, 0, 0);
        Console.Out.WriteLine("ARMED");
        Console.Out.Flush();
        Message message;
        while (!_stop && GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
    }
}
"@
[FoliaSpotifyWindow]::Run(${WATCH_LIFETIME_MS})
`;

// The fallback for a start whose watcher did not run: the main window of a Spotify that was not there
// before the start is hidden without activation (SW_HIDE). It leaves the taskbar, the Spotify tray
// icon restores it, and nothing is closed. A window already in the tray has no handle (MainWindowHandle
// is 0 for a hidden window) and is left alone, and so is a Spotify that was there before this start.
const WINDOW_SWEEP_SCRIPT = skipPids => `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Folia -Name SpotifyWin -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);'
$skip = @(${skipPids.join(', ')})
foreach ($p in Get-Process -Name Spotify -ErrorAction SilentlyContinue) {
  if ($skip -contains $p.Id) { continue }
  if ($p.MainWindowHandle -ne [System.IntPtr]::Zero) { [Folia.SpotifyWin]::ShowWindow($p.MainWindowHandle, 0) | Out-Null }
}
`;
// The flag Spotify's own start-up entry uses to start in the tray rather than with a window. Spotify
// ignores it as it ignores STARTUPINFO's SW_HIDE (measured, above); it stays because it asks for what
// Folia wants and a build that honours it saves the hide.
const START_MINIMIZED_FLAG = '--minimized';
const SWEEP_LIMIT_MS = 8000;
// How long the watcher has to get its hook in place before the start goes on without it: a watcher
// that arms late would let the first window through, and the sweep is the fallback for that.
const WATCH_ARM_LIMIT_MS = 2500;
// The watcher's own backstop, for a start that never ends: it is killed when the start does.
const WATCH_LIFETIME_MS = 60000;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A promise that gives up after `ms`; the timer is cleared once either side settled.
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

// What a call the page refused is answered with: a call it refuses for its parameter is not the
// player being out of reach, everything else the page threw is.
const refusalCode = text => (/invalid|argument|must be/i.test(String(text)) ? 'invalid-response' : 'unavailable');

// The CEF profiles Spotify's DevTools port file may be written into: the Microsoft Store build keeps
// its profile under the package's LocalCache (measured: the CEF profile's files are there; only
// DevToolsActivePort is ever read),
// the installer build under %APPDATA%\Spotify.
function spotifyProfileDirs(env) {
    const dirs = [];
    const store = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages', STORE_PACKAGE_DIR, 'LocalCache');
    if (store) {
        dirs.push(path.join(store, 'Spotify'));
        dirs.push(path.join(store, 'Local', 'Spotify', 'User Data'));
    }
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Spotify'));
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'Spotify'));
    return dirs;
}

// The port the CEF wrote into its profile, or null. The file holds the port on its first line and the
// page's browser path on the second.
function portFromProfile(env) {
    for (const dir of spotifyProfileDirs(env)) {
        try {
            const [first] = fs.readFileSync(path.join(dir, ACTIVE_PORT_FILE), 'utf8').split(/\r?\n/);
            const port = Number.parseInt(String(first).trim(), 10);
            if (Number.isInteger(port) && port > 0 && port < 65536) return port;
        } catch { /* this profile has no port file */ }
    }
    return null;
}

// One DevTools connection to Spotify's page, opened again when it closes. `portOf` answers the port
// Spotify listens on now: it is looked for lazily, so a page opened before the port is known finds it.
function createPageConnection({ fetch, portOf }) {
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
        const port = await portOf();
        if (!port) throw spotifyError('unavailable', 'Spotify has no DevTools port Folia can reach', 'no port was found');
        const list = await (await fetch(`http://${CDP_HOST}:${port}/json/list`)).json();
        const page = Array.isArray(list) ? list.find(target => target.type === 'page' && /xpui/.test(String(target.url))) : null;
        if (!page?.webSocketDebuggerUrl) throw spotifyError('unavailable', 'Spotify has no page open yet');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        // A socket that closes before it opened is a refused connection, not a connection: it rejects
        // here, and the walk is over.
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
    // connection to wait on. A failed walk leaves nothing open behind it.
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
        async evaluate(expression, { limitMs = CALL_LIMIT_MS } = {}) {
            let ws;
            try {
                ws = await connection();
            } catch (error) {
                // Nothing was sent: whatever the call is, it cannot have run on the page, so a caller that
                // may only run it again when it certainly did not (see `evaluateInPage`) may do so.
                if (error && typeof error === 'object') error.notDelivered = true;
                throw error;
            }
            const id = ++nextId;
            const answer = await withLimit(new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
            }), limitMs, 'Spotify').finally(() => pending.delete(id));
            // A protocol error is a call that failed: it must not read as an answer with nothing in it.
            if (answer.error) {
                const text = String(answer.error.message ?? answer.error.code ?? '');
                throw spotifyError(refusalCode(text), 'Spotify\'s player refused the call', text);
            }
            const details = answer.result?.exceptionDetails;
            if (details) {
                const text = String(details.exception?.description ?? details.text ?? '');
                // Everything the page threw means the player cannot be reached, except a call it refuses
                // for its parameter: that one must not be answered with the media session.
                throw spotifyError(refusalCode(text), 'Spotify\'s player refused the call', text.split('\n')[0]);
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

// A helper that answers nothing within its limit is ended and started again.
const HELPER_RETRY_MS = Object.freeze([20000, 60000, 300000]);

// The PowerShell that speaks to the media session; started on first use, again after it ends. A
// helper that could not be started is not started again at once: each start that failed in a row
// pushes the next one further out, and one answer clears it. A PowerShell this computer does
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
    // one's answers.
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
        // A helper whose input went away cannot answer anything again: it is let go.
        proc.stdin.on('error', error => {
            warn('[SpotifyClient] the media session helper lost its input', error);
            if (child !== proc) return;
            noteFailure();
            drop(spotifyError('unavailable', 'The media session helper is not reachable'));
        });
        // A helper that ended is let go. Only the helper that is still the current one: an older process
        // ending later must not fail the answers of the new one.
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
            // A helper that just failed to start waits its backoff out.
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
                // A helper that did not answer is ended.
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

// `env` names the folders the launcher is looked for in; `platform` is process.platform. `port` is
// the DevTools port to ask for: 0 (the default) lets Spotify's CEF pick one, which is then looked for.
// `restartConsented` answers whether the listener agreed to Folia closing and starting their Spotify
// again: without a yes the app they have open is not touched (restartConsent.cjs keeps the answer).
function createSpotifyOfficialClient({
    env = process.env, platform = process.platform, fetch = globalThis.fetch, port = 0,
    spawnProcess = spawn, runFile = execFile, waitFor = wait, restartConsented = () => false,
    log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
} = {}) {
    // Windows' own tools are run by their absolute path: a process started with a PATH another
    // program wrote must not decide which tasklist runs, nor which PowerShell.
    const systemTool = name => path.join(env.SystemRoot || 'C:\\Windows', 'System32', name);

    // How long a step of the quit close may wait: what is left before `deadline`, never more than that
    // tool's own limit, and never so little that the call could only time out.
    const waitLimit = (limitMs, deadline) => (
        deadline ? Math.max(TOOL_LIMIT_FLOOR_MS, Math.min(limitMs, deadline - Date.now())) : limitMs
    );

    // The port asked for: 0 lets CEF pick one, and the one it picked is looked for below.
    const requestedPort = Number.isInteger(port) && port > 0 ? port : 0;
    // The port found for the Spotify this run steers, when a search that found nothing may run again,
    // and how many such searches in a row have found nothing.
    let foundPort = null;
    // Where that port was found: the file CEF writes into its profile, the machine's listeners, or the
    // port older runs used. Kept so a log line can say which one answered.
    let foundPortFrom = '';
    let nextScanAt = 0;
    let scanFailures = 0;
    // How many of the searches a session restore may make have been made in this run, and when the last
    // one started.
    let statusPortSearches = 0;
    let statusPortSearchedAt = 0;
    // The play this run is on: a start takes the next number and writes it into the page, and a queue
    // write says which one it belongs to, so a write handed over before a start is dropped instead of
    // putting the songs of the song before behind the new one.
    let playSerial = 0;
    // Whether the app's queue can be emptied, asked by this run's first queue write and kept after: a
    // player that says no is not asked again, because a queue that only grows makes an emptied one
    // look like a queue of songs that simply are not there yet.
    let queueClearable = null;
    // What a play of this run changed of the listener's own repeat and shuffle, as it was before the
    // first change: 'one' for a repeat of the track, 'all' for one of the list, true for a shuffle
    // that was on, null for one this run never changed. Kept across plays - a later play finds the
    // app already the way Folia plays it and would otherwise take Folia's own value for the
    // listener's - and put back by `restoreUserState`.
    let changedRepeat = null;
    let changedShuffle = null;
    // What those two were before this run changed them, for the renderer and for the log.
    const changedState = () => ({ repeat: changedRepeat, shuffle: changedShuffle });

    // Whether the program answering on `candidate` is Spotify: another program that happens to hold a
    // port is not Folia's, and Spotify must not be closed for it.
    const spotifyAnswersOnPort = async (candidate, limitMs = PORT_VERIFY_LIMIT_MS) => {
        if (!candidate) return false;
        try {
            const response = await withLimit(fetch(`http://${CDP_HOST}:${candidate}/json/version`), limitMs, 'Spotify');
            if (!response.ok) return false;
            const version = await response.json();
            return /spotify/i.test(`${version?.Browser ?? ''} ${version?.['User-Agent'] ?? ''}`);
        } catch { return false; }
    };

    // The loopback ports this computer's listening sockets name: `netstat -ano` lays a listener out as
    // protocol, local address, foreign address 0.0.0.0:0, state, pid, so no localized word is read.
    // Which of them is Spotify's is decided by asking the port itself.
    const listeningLoopbackPorts = (timeoutMs = TOOL_LIMIT_MS) => new Promise(resolve => {
    // Bounded tightly: this also runs on the way out of the app, where the quit waits 3 s at most.
        runFile(systemTool('netstat.exe'), ['-ano'], { windowsHide: true, timeout: timeoutMs }, (error, stdout) => {
            const ports = [];
            if (!error) {
                for (const line of String(stdout).split(/\r?\n/)) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue;
                    if (parts[2] !== '0.0.0.0:0' && parts[2] !== '[::]:0') continue;
                    const match = /^(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)$/.exec(parts[1]);
                    if (!match) continue;
                    const candidate = Number(match[1]);
                    if (candidate > 0 && !ports.includes(candidate)) ports.push(candidate);
                }
            }
            resolve(ports.slice(0, MAX_PORT_CANDIDATES));
        });
    });

    // The port Spotify listens on now, or null. A named port is the only one asked. Otherwise the port
    // is looked for: the file CEF writes into its profile first, which costs one read, then the
    // machine's loopback listeners, each asked whether it is Spotify's; the port older runs used last.
    // `again` looks once more where it stands, for a caller that is about to start Spotify or close it.
    //
    // What keeps a search cheap is the answer itself: a port already found is not looked for again (a
    // page polled twice a second follows it for free), and one search that found nothing is not repeated
    // before `nextScanAt` has passed, so a computer whose Spotify is closed is not swept per poll.
    // `deadline` caps every wait of the search: the quit's close passes it so that its taskkill is
    // issued inside the quit's gate.
    // `quiet` leaves the line about the port found to the caller, which words it its own way.
    const findPort = async ({ again = false, deadline = 0, quiet = false } = {}) => {
        if (requestedPort) return foundPort ?? requestedPort;
        if (foundPort && !again) return foundPort;
        if (!again && Date.now() < nextScanAt) return null;
        const capWait = limitMs => waitLimit(limitMs, deadline);
        const fromProfile = portFromProfile(env);
        if (fromProfile && await spotifyAnswersOnPort(fromProfile, capWait(PORT_VERIFY_LIMIT_MS))) {
            foundPort = fromProfile;
            foundPortFrom = 'the port file';
            scanFailures = 0;
            nextScanAt = 0;
            if (!quiet) log(`[SpotifyClient] the DevTools port of Spotify is ${foundPort}, from ${foundPortFrom}`);
            return foundPort;
        }
        const candidates = (await listeningLoopbackPorts(capWait(TOOL_LIMIT_MS))).filter(candidate => candidate !== fromProfile);
        const answers = await Promise.all(candidates.map(async candidate => (
            await spotifyAnswersOnPort(candidate, capWait(PORT_PROBE_LIMIT_MS)) ? candidate : null
        )));
        foundPort = answers.find(candidate => candidate !== null) ?? null;
        if (foundPort) foundPortFrom = 'the listening ports';
        if (!foundPort && await spotifyAnswersOnPort(CDP_PORT, capWait(PORT_VERIFY_LIMIT_MS))) {
            foundPort = CDP_PORT;
            foundPortFrom = 'the usual port';
        }
        if (foundPort) {
            if (!quiet) log(`[SpotifyClient] the DevTools port of Spotify is ${foundPort}, from ${foundPortFrom}`);
            scanFailures = 0;
            nextScanAt = 0;
        } else {
            scanFailures += 1;
            nextScanAt = Date.now() + PORT_SCAN_BACKOFF_MS[Math.min(scanFailures, PORT_SCAN_BACKOFF_MS.length) - 1];
        }
        return foundPort;
    };
    // Whether a DevTools port answers for Spotify now, which is what decides whether Spotify has to be
    // started: the port is asked, not merely named.
    const debugPortAnswers = async () => spotifyAnswersOnPort(await findPort({ again: true }));

    // Whether Spotify's app is on this computer at all: the launcher on disk, and nothing else.
    const spotifyInstalled = () => platform === 'win32' && Boolean(findLauncher(env));

    const page = createPageConnection({ fetch, portOf: () => findPort() });
    const mediaSession = platform === 'win32' ? createMediaSession({ spawnProcess, warn, shellPath: systemTool('WindowsPowerShell\\v1.0\\powershell.exe') }) : null;
    let starting = null;
    let failedStartAt = 0;
    let fallbackNoted = false;
    // How often Spotify was closed and started again in this run.
    let forceRestarts = 0;
    // Whether this run of Folia started Spotify: the app is closed with Folia only when it did, or
    // when the DevTools port Folia opened it with still answers.
    let startedByUs = false;

    // Whether Spotify's app is running, as `tasklist` answers it: 'running', 'stopped', or 'unknown'
    // for a tool that failed or ran out of its two seconds and therefore said nothing. No match is
    // not an error (measured: tasklist exits 0 and writes a line saying none matched), so an error
    // is a question that went unanswered rather than a Spotify that is not there - the app may well
    // be up, and a start made on top of it is the restart the listener has to agree to.
    //
    // Both tools are bounded: a taskkill that hangs must not hold the quit.
    const spotifyIsRunning = (timeoutMs = TOOL_LIMIT_MS) => new Promise(resolve => {
        runFile(systemTool('tasklist.exe'), ['/FI', 'IMAGENAME eq Spotify.exe', '/NH'], { windowsHide: true, timeout: timeoutMs }, (error, stdout) => {
            if (error) { resolve('unknown'); return; }
            resolve(/Spotify\.exe/i.test(String(stdout)) ? 'running' : 'stopped');
        });
    });

    // The Spotify processes running now, by id: a window opened by one of them is the listener's, and
    // the one a start creates is the only one Folia hides.
    const spotifyProcessIds = (timeoutMs = TOOL_LIMIT_MS) => new Promise(resolve => {
        runFile(systemTool('tasklist.exe'), ['/FI', 'IMAGENAME eq Spotify.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: timeoutMs }, (error, stdout) => {
            const pids = [];
            if (!error) {
                for (const line of String(stdout).split(/\r?\n/)) {
                    const match = /^"[^"]+","(\d+)"/.exec(line.trim());
                    if (match) pids.push(Number(match[1]));
                }
            }
            resolve(pids);
        });
    });

    // The watcher of a start under way: armed before Spotify is run, so its hook is in place before the
    // first window can be shown. Only the PIDs that were running before the start are skipped, and
    // whether it really armed is what its own ARMED line says (a watcher that could not start is not
    // waited for).
    const armWindowWatch = skipPids => {
        const encoded = Buffer.from(WINDOW_WATCH_SCRIPT(skipPids), 'utf16le').toString('base64');
        let settle = () => {};
        let settled = false;
        const armed = new Promise(resolve => { settle = value => { if (settled) return; settled = true; resolve(value); }; });
        let buffer = '';
        const child = spawnProcess(systemTool('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        child.stdout?.setEncoding?.('utf8');
        child.stdout?.on?.('data', chunk => {
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line === 'ARMED') settle(true);
                else if (line.startsWith('HIDDEN ')) log('[SpotifyClient] the Spotify window was hidden the moment it was shown');
            }
        });
        // A watcher that ended, or never started, is not waited for: the sweep below is its fallback.
        const ended = () => settle(false);
        child.on?.('error', error => {
            warn('[SpotifyClient] the Spotify window watcher could not be started', error);
            ended();
        });
        child.on?.('exit', ended);
        return { child, armed };
    };

    // Best effort, bounded: a window that cannot be hidden is no reason to fail a start.
    const sweepSpotifyWindows = skipPids => new Promise(resolve => {
        const encoded = Buffer.from(WINDOW_SWEEP_SCRIPT(skipPids), 'utf16le').toString('base64');
        runFile(systemTool('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: SWEEP_LIMIT_MS }, error => {
            // Only a sweep that could not run at all is worth a word: it is the fallback for a window the
            // watcher let through, and there is nothing else to try.
            if (error) warn('[SpotifyClient] the Spotify window could not be hidden into the tray', error);
            resolve();
        });
    });

    // The watcher of the start under way, if any: it goes when the start ends, so a window the listener
    // opens from the tray afterwards is theirs.
    let windowWatch = null;
    const stopWindowWatch = () => {
        try { windowWatch?.child?.kill?.(); } catch { /* ended already */ }
        windowWatch = null;
    };

    // Every Spotify process, by image name: the close is not narrowed to the ones this run started.
    const stopSpotify = (timeoutMs = TOOL_LIMIT_MS) => new Promise(resolve => {
        runFile(systemTool('taskkill.exe'), ['/IM', 'Spotify.exe', '/F'], { windowsHide: true, timeout: timeoutMs }, () => resolve());
    });

    // Spotify open with the DevTools port and its player found.
    //
    // `allowRestart` is the listener's own action (a play, the launch switch): only then may a
    // Spotify running without the port be closed and started again, and only once in a run.
    // Spotify that is not running is only started, never closed. Anything else answers the media
    // session instead, so a status read never closes the app the listener opened.
    //
    // A `tasklist` that could not say whether Spotify runs leaves that question open, and a start
    // made on top of an app that is already up is the same restart: the listener's own app is
    // handed the new command line, which reopens it with the DevTools port. So a start that cannot
    // rule out a running Spotify waits for the answer this app gives about closing theirs, and a
    // listener who has not agreed is left with their Spotify as it is.
    async function start({ restart = false, allowRestart = false } = {}) {
        if (platform !== 'win32') throw spotifyError('unsupported', 'The Spotify app is steered on Windows only');
        const answers = !restart && await debugPortAnswers();
        // Whether this call started the Spotify it now waits for: only then is its window Folia's to tuck away.
        let spawned = false;
        // The Spotify processes running before this start: a window of one of them is the listener's, and
        // stays where it is.
        let skipPids = [];
        if (!answers) {
            const launcher = findLauncher(env);
            if (!launcher) throw spotifyError('unavailable', 'The Spotify app is not installed', undefined, 'player-not-installed');
            const running = await spotifyIsRunning();
            // Not knowing is not the same as knowing it is closed: only 'stopped' is a Spotify that
            // this call may start without touching one the listener already has open.
            if (running !== 'stopped') {
                if (!allowRestart) throw spotifyError('unavailable', 'Spotify runs without its DevTools port', 'this call may not restart it');
                // Closing the app the listener has open is theirs to agree to, and the question is
                // asked once (restartConsent.cjs): no answer means their Spotify stays as it is.
                if (!restartConsented()) {
                    throw spotifyError('unavailable', 'Spotify runs without its DevTools port', 'the listener has not agreed to a restart', 'player-restart-consent');
                }
                if (running === 'unknown') {
                    // Nothing said Spotify was closed, so nothing here may close it: the start is made
                    // on top of whatever is there, and a restart the listener already agreed to is
                    // what it might be. Closing an app that may not be running would only spend the
                    // run's one restart on a taskkill that has nothing to do.
                    log('[SpotifyClient] tasklist could not say whether Spotify runs; it is started without closing it first');
                } else {
                    if (forceRestarts >= MAX_FORCE_RESTARTS) {
                        throw spotifyError('unavailable', 'Spotify runs without its DevTools port', `a restart already spent this run (${forceRestarts})`);
                    }
                    forceRestarts += 1;
                    log(restart ? '[SpotifyClient] Spotify is started again, as asked' : '[SpotifyClient] Spotify runs without the DevTools port; it is started again with it');
                    page.close();
                    await stopSpotify();
                    await waitFor(1500);
                }
            } else if (startedByUs) {
                // The Spotify this run started is not running any more: the listener closed it, so the one
                // started below is a new one, and the quit must not close a Spotify it did not start.
                startedByUs = false;
            }
            // Started in the tray, and followed by a watcher that hides its window the moment Spotify shows
            // it: the flag below is what a build that honours it needs, the watcher is what the builds that
            // ignore it (measured: the Microsoft Store one) need. The watcher is armed first, because a hook
            // that arrives after the window is a window on the screen.
            // The port is CEF's to pick where none was named: it writes the one it took into its profile,
            // and the search above reads it there, or finds the listener it opened.
            foundPort = null;
            nextScanAt = 0;
            // CEF refuses a WebSocket that carries an Origin header it was not told to accept, and Folia's
            // own DevTools client sends none (measured: Node's WebSocket sends no Origin). So no origin is
            // allowed when the port is not known yet — a wildcard would let any page in a browser reach the
            // port and steer the signed-in Spotify, which is exactly what must not happen. A port Folia names
            // itself is allowed, and only its own origin.
            const args = [START_MINIMIZED_FLAG, `--remote-debugging-port=${requestedPort}`];
            if (requestedPort) args.push(`--remote-allow-origins=http://${CDP_HOST}:${requestedPort}`);
            skipPids = await spotifyProcessIds();
            windowWatch = armWindowWatch(skipPids);
            const armedInTime = await Promise.race([windowWatch.armed, waitFor(WATCH_ARM_LIMIT_MS).then(() => false)]);
            if (!armedInTime) warn('[SpotifyClient] the Spotify window watcher did not arm in time; the sweep hides the window instead');
            // `windowsHide` asks for a start without a window in the only way a process is told (STARTUPINFO's
            // SW_HIDE). It is kept for a build that honours it and costs nothing here: measured, this one
            // does not, and the watcher above is what keeps the window off the screen.
            const child = spawnProcess(launcher, args, { detached: true, stdio: 'ignore', windowsHide: true });
            spawned = true;
            child.on?.('error', error => warn('[SpotifyClient] Spotify could not be started', error));
            child.unref?.();
            startedByUs = true;
            log('[SpotifyClient] Spotify was started with the DevTools port');
        }
        // The first wait: the app, its DevTools port and a page that answers a script.
        const deadline = Date.now() + LAUNCH_WAIT_MS;
        // The second, for the player inside that page. It begins at the first round the page says it
        // has finished loading, and the moment it began is kept, so a later round cannot move it.
        let findDeadline = 0;
        let lastError = null;
        let rounds = 0;
        try {
            while (Date.now() < (findDeadline || deadline)) {
                rounds += 1;
                // The fallback sweep runs at the first round a window can exist: measured, Spotify shows its
                // window 0.5-1.1 s after the alias is run, so a sweep at 1.4 s is a window on the screen for
                // the whole of the load before it.
                if (spawned && rounds === 2) await sweepSpotifyWindows(skipPids);
                try {
                    if (await page.evaluate(`Boolean(${FIND_APIS})`)) {
                        if (spawned) await sweepSpotifyWindows(skipPids);
                        return;
                    }
                    // A page answered a script, so what a round before it failed with is stale: a start
                    // that ends on a wait of its own is the player not being found, not a connection
                    // that has worked ever since.
                    lastError = null;
                    // A page that answers a script is not a page that is ready, and which of the two
                    // waits the player is looked for under is decided by the app's own interface
                    // having finished loading.
                    if (!findDeadline && await page.evaluate(PAGE_LOADED)) findDeadline = Date.now() + PLAYER_FIND_WAIT_MS;
                } catch (error) {
                    lastError = error;
                    page.close();
                }
                await waitFor(700);
            }
        } finally {
            // The start is over, hidden window or not: the watcher goes with it.
            stopWindowWatch();
        }
        if (findDeadline) log(`[SpotifyClient] Spotify loaded its page and answered no player in ${PLAYER_FIND_WAIT_MS / 1000} s`);
        throw lastError ?? spotifyError('unavailable', 'Spotify\'s player was not found', undefined, 'player-not-found');
    }

    // A start that was given up because the restart was never agreed to is not a start that failed:
    // Spotify was not touched, so there is nothing to cool down. Only a start that really went wrong
    // keeps the next ordinary call off Spotify for a while, and a listener who says yes to the
    // question right after it is asked plays at once.
    const START_GIVEN_UP_UNTOUCHED = 'player-restart-consent';
    const ensure = options => {
        starting ||= start(options).then(() => { failedStartAt = 0; }, error => {
            if (error?.reason !== START_GIVEN_UP_UNTOUCHED) failedStartAt = Date.now();
            throw error;
        }).finally(() => { starting = null; });
        return starting;
    };

    // The player kept in the page is dropped and looked for once more before a call is called a
    // failure: Spotify replaces its React tree when its UI changes.
    //
    // Only a call that may be made twice is made twice. `retry` is false for the calls that change what
    // Spotify plays: running a play again starts the song from its beginning, and running a queue write
    // again empties the queue prepared behind it. A failed connection says nothing about
    // whether the first run reached the page, so such a call is run again only when it certainly did
    // not — a connection that never opened marks its error `notDelivered` (createPageConnection).
    const evaluateInPage = async (body, { retry = true, limitMs } = {}) => {
        try {
            return await page.evaluate(inPage(body), { limitMs });
        } catch (error) {
            if (error?.code === 'invalid-response') throw error;
            if (!retry && error?.notDelivered !== true) throw error;
            try { await page.evaluate(FORGET_APIS); } catch { /* the page is gone as well */ }
            return page.evaluate(inPage(body), { limitMs });
        }
    };

    // One call in the page. `allowStart` is set only for a call a listener asked for (a play):
    // every other call reports what it could not do instead of touching Spotify.
    async function call(body, { allowStart = false, retry = true, limitMs } = {}) {
        try {
            return await evaluateInPage(body, { retry, limitMs });
        } catch (error) {
            if (error?.code === 'invalid-response') throw error;
            page.close();
            if (!allowStart) throw error;
            if (failedStartAt && Date.now() - failedStartAt < RESTART_COOLDOWN_MS) {
                // A start that failed a moment ago is not tried again: the renderer is told the app
                // cannot be reached rather than what the socket said, so it can fall back.
                throw spotifyError('unavailable', 'The Spotify app cannot be reached', 'a start was given up a moment ago');
            }
            await ensure({ allowRestart: true });
            return evaluateInPage(body, { retry, limitMs });
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

    // The player's state as a status read answers it, once, from wherever it can still be had.
    const readStatus = async () => {
        let state;
        try {
            if (!requestedPort && !foundPort) {
                throw spotifyError('unavailable', 'Spotify has no DevTools port Folia has found', 'a status read does not look for one');
            }
            state = await evaluateInPage(STATE_BODY);
        } catch (error) {
            if (error?.code === 'invalid-response') throw error;
            page.close();
            if (!mediaSession) throw error;
            return statusFromMediaSession(await mediaSession.ask('status'));
        }
        return statusFromPlayerState(state, Date.now());
    };

    return {
    // Asked by the launch switch (or at app start): tries again even within the cool-down, and
    // may close and start Spotify once, as the listener asked for it.
        launch: () => ensure({ allowRestart: true }).then(() => true),
        // Closes Spotify and starts it again with the DevTools port (a start under way is waited for
        // instead). Counted against the same once-a-run budget.
        restart() {
            page.close();
            return ensure({ restart: true, allowRestart: true }).then(() => true);
        },

        // Whether Spotify's app is on this computer at all, without starting anything: the launcher
        // is looked for on disk and nothing else. The caller caches the answer.
        available() {
            if (platform !== 'win32') return { available: false, reason: 'unsupported' };
            return spotifyInstalled() ? { available: true } : { available: false, reason: 'not-installed' };
        },

        // Folia quits and the listener asked for Spotify to be closed with it. Closed when this
        // run started it, or when it runs with the DevTools port Folia opened it with; a Spotify the
        // listener started without the port is left alone, and so is a port another program holds.
        async closeForQuit() {
            if (platform !== 'win32') return false;
            // The instant the taskkill has to be under way by; what is left of the budget is all the
            // probing before it may take.
            const issueBy = Date.now() + QUIT_CLOSE_BUDGET_MS - QUIT_TASK_ISSUE_RESERVE_MS;
            // A Spotify this run started and the listener closed meanwhile is not Folia's to close.
            // Only a tasklist that answered says so: a question that went unanswered leaves the app
            // Folia started to be closed by it, which is what the listener asked the quit to do.
            if (startedByUs && await spotifyIsRunning(waitLimit(TOOL_LIMIT_MS, issueBy)) === 'stopped') startedByUs = false;
            if (!startedByUs) {
                const port = await findPort({ again: true, deadline: issueBy });
                if (!(await spotifyAnswersOnPort(port, waitLimit(PORT_VERIFY_LIMIT_MS, issueBy)))) return false;
            }
            const closedBecause = startedByUs ? 'this run started it' : 'its DevTools port answers';
            page.close();
            await stopSpotify(waitLimit(TOOL_LIMIT_MS, issueBy));
            startedByUs = false;
            log('[SpotifyClient] Spotify was closed as Folia quits: ' + closedBecause);
            return true;
        },


        // Plays one track from `startMs` with Spotify's own repeat and shuffle off: the order is Folia's.
        // Resolves once Spotify has the track loaded, so a status read after it is about this track.
        //
        // Answers where it stopped: 'loaded' when the track is the one playing, 'preempted' when a
        // newer play took over (nothing went wrong), 'advertisement' when the app took the track and an
        // advertisement still runs before it (the status reads follow it), 'not-loaded' when Spotify
        // never got to the track, { answer: 'unavailable' } carrying the page's code and reasons when
        // Spotify says it will not play this track at all, and { answer: 'premium-only' } when the only
        // reason it gives is the free account (a plan would play it, so it is not taken down).
        // `userAction` says a listener asked for this song; only then may Spotify be started or started
        // again. An advance Folia made by itself passes false: the app it could not reach stays
        // as it is.
        //
        // `written` is the caller's record of the songs it put in the app's queue and the app has not
        // played: emptying that queue takes the listener's own songs with it, so they are given back
        // where they were (`START_QUEUE_SOURCE`). A queue the app cannot empty is left as it is.
        // `replaceQueue` says the listener played a whole list of their own here, which is the one case
        // that takes the app's queue whole: it is emptied and nothing is put back, so the queue that
        // follows is Folia's and theirs is gone with the list they asked for.
        //
        // The repeat and the shuffle are changed only where they would stop Folia's queue from being
        // played as written (`PLAY_STATE_SOURCE`), and what was changed of the listener's own is kept
        // for `restoreUserState`. The answer carries that record as `changed`, so a caller that asked
        // for the song knows what of the listener's the play took; the other answers are the app's
        // own words.
        async play({ id, startMs = 0, userAction = true, written = [], replaceQueue = false }) {
            const uri = trackUri(id);
            const from = Math.max(0, Math.round(Number(startMs) || 0));
            const owned = Array.isArray(written) ? written.filter(id => typeof id === 'string') : [];
            const replace = replaceQueue === true;
            // The number a queue write of this song is allowed to see: anything else there is a start that
            // came later, and a write that belongs to the song before it.
            playSerial += 1;
            const serial = playSerial;
            const answered = await call(`
        const uri = ${JSON.stringify(uri)};
        const owned = ${JSON.stringify(owned)};
        // A newer play makes this one stop after its next wait, before it can seek or change the
        // repeat of the track the listener asked for afterwards.
        window.__foliaPlay = ${serial};
        const current = () => window.__foliaPlay === ${serial};
        const emptied = await (${START_QUEUE_SOURCE})({ api, owned, replaceQueue: ${replace} });
        if (!current()) return 'preempted';
        await api.player.play({ uri }, {}, {});
        if (!current()) return 'preempted';
        const waited = await (${START_WAIT_SOURCE})({
          api, uri, current,
          isAd: (${isAdvertisementItem.toString()}),
          sleep: ms => new Promise(r => setTimeout(r, ms)),
        });
        // The track is moved and adjusted only once it is the one loaded: an advertisement playing
        // meanwhile is never seeked into. An advertisement still on the screen is an accepted
        // start rather than a track that never came (the status reads follow it, and
        // statusOfClient.ts reads an advertisement as the song still loading).
        if (waited && (waited.answer === 'unavailable' || waited.answer === 'premium-only')) return waited;
        if (waited !== 'loaded') return waited;
        if (!current()) return 'preempted';
        const changed = await (${PLAY_STATE_SOURCE})({ api });
        if (!current()) return 'preempted';
        if (${from} > 0) await api.player.seekTo(${from});
        return { answer: 'loaded', changed, emptied };
      `, { allowStart: userAction, retry: false, limitMs: START_CALL_LIMIT_MS });
            // Spotify named this track as one it will not play: the wait stopped there instead of
            // running its five seconds out, and what the page said is kept for the renderer's failure.
            if (answered && (answered.answer === 'unavailable' || answered.answer === 'premium-only')) {
                warn('[SpotifyClient] Spotify will not play this track (' + answered.answer + '): ' + answered.code + ' [' + answered.reasons.join(', ') + ']');
                return answered;
            }
            // A start that loaded answers what of the listener's it changed; every other answer is the
            // page's own word and carries nothing of that.
            if (!answered || answered.answer !== 'loaded') return answered;
            // The queue took the songs of this start where it could empty itself: what the listener
            // had queued in the app is put back among them, and only Folia's places were taken.
            if (answered.emptied?.restored === false) {
                warn('[SpotifyClient] the songs the listener had queued in Spotify could not be put back after its queue was emptied');
                queueClearable = false;
            } else if (answered.emptied?.cleared === true) {
                // A queue that emptied for this start is empty behind it: nothing of this run's tail is
                // still in it, so the next write fills it whole.
                queueClearable = true;
            }
            const changed = answered.changed ?? {};
            // The first play of the run that changes one keeps what the listener had: a later play
            // finds the app the way Folia left it, and its own value of that one says nothing.
            if (changed.repeat === 'one' && changedRepeat === null) changedRepeat = 'one';
            if (changed.shuffle === true && changedShuffle === null) changedShuffle = true;
            if (changed.repeat === 'one' || changed.shuffle === true) {
                log('[SpotifyClient] the listener\'s own '
                    + [changed.repeat === 'one' ? 'repeat of the track' : null, changed.shuffle === true ? 'shuffle' : null]
                        .filter(Boolean).join(' and ')
                    + ' had to be changed for Folia\'s order; it is put back when this way is left');
            }
            return 'loaded';
        },

        // The songs that are to follow, put in Spotify's queue so it moves on to them by itself. The
        // answer says what was written, whether the queue was emptied first, whether this app can empty
        // it at all, and what it names afterwards: one call tells the caller everything it needs, and a
        // read taken right after a write is never proof of what is missing. A queue write never starts
        // or closes Spotify.
        async queue({ ids, queued }) {
            const uris = (Array.isArray(ids) ? ids : []).slice(0, MAX_QUEUED).map(trackUri);
            const held = Array.isArray(queued) ? queued : [];
            const probed = queueClearable;
            const generation = playSerial;
            const answer = await call(`
        const uris = ${JSON.stringify(uris)};
        const queued = ${JSON.stringify(held)};
        const probed = ${JSON.stringify(probed)};
        const generation = ${generation};
        return (${QUEUE_SOURCE})({ api, uris, queued, probed, generation });
      `, { retry: false });
            if (typeof answer?.canClear === 'boolean') queueClearable = answer.canClear;
            return answer;
        },

        // Pausing, resuming and seeking never start or close Spotify: they answer from the
        // media session when the page cannot be reached, and fail there when it cannot either.
        pause: () => orMediaSession('await api.player.pause(); return true;', 'pause'),
        resume: () => orMediaSession('await api.player.resume(); return true;', 'resume'),

        seek({ ms }) {
            const target = Math.max(0, Math.round(Number(ms) || 0));
            return orMediaSession(`await api.player.seekTo(${target}); return true;`, 'seek', { ms: target });
        },

        // The listener's own volume, set as given.
        setVolume({ value }) {
            const volume = Math.min(1, Math.max(0, Number(value)));
            if (!Number.isFinite(volume)) throw spotifyError('invalid-response', 'Invalid volume');
            return call(`
        await api.playback.setVolume(${volume});
        return true;
      `);
        },

        // What a play of this run changed of the listener's own repeat and shuffle, as it was before:
        // `{ repeat: 'one' | 'all' | null, shuffle: true | null }`. Read by the renderer and by a test;
        // nothing is asked of Spotify here.
        changedState,

        // Puts the listener's own repeat and shuffle back as this run found them, and forgets them: it
        // is what leaving this way of playing, signing out and quitting do, so the app is left the
        // way its listener had it. A value the listener changed themselves after the play is left as
        // they set it, and its record goes with this call rather than being tried again; a state that
        // cannot be read leaves both records in place. A player that cannot be reached is left alone
        // rather than started for it - starting Spotify to put two settings back would be a change of
        // its own - so the record stays, and the next call tries again. Answers what is still to be
        // put back, for the log and for a quit that holds for it.
        async restoreUserState({ allowStart = false } = {}) {
            const repeat = changedRepeat;
            const shuffle = changedShuffle;
            if (repeat === null && shuffle === null) return changedState();
            let put;
            try {
                put = await call(`
        const repeat = ${JSON.stringify(repeat === null ? null : REPEAT_MODES[repeat])};
        const shuffle = ${JSON.stringify(shuffle === true)};
        return (${RESTORE_STATE_SOURCE})({ api, repeat, shuffle });
      `, { allowStart, retry: false });
            } catch (error) {
                warn('[SpotifyClient] the listener\'s own repeat and shuffle could not be put back; they are kept and tried again', error);
                return changedState();
            }
            // A state that could not be read says nothing about either one: both records stay for the
            // next call, which asks again rather than writing over a value of the listener's.
            if (put?.read === false) {
                log('[SpotifyClient] Spotify\'s repeat and shuffle could not be read; what is to be put back is kept and tried again');
                return changedState();
            }
            // Written back, or found to be the listener's own now: either way this record is done.
            if (put?.repeat) changedRepeat = null;
            if (put?.shuffle) changedShuffle = null;
            const putBack = [put?.repeat === true ? 'repeat' : null, put?.shuffle === true ? 'shuffle' : null].filter(Boolean);
            const keptByListener = [put?.repeat === 'theirs' ? 'repeat' : null, put?.shuffle === 'theirs' ? 'shuffle' : null].filter(Boolean);
            if (putBack.length) log('[SpotifyClient] the listener\'s own ' + putBack.join(' and ') + ' were put back as they were');
            if (keptByListener.length) {
                log('[SpotifyClient] the listener\'s own ' + keptByListener.join(' and ') + ' were changed in Spotify meanwhile and are left as they are');
            }
            return { repeat: changedRepeat, shuffle: changedShuffle };
        },

        // The player's state; from the media session (then `fallback` is set and no track is named)
        // when the page cannot be reached. A status read never starts or closes Spotify, and it
        // never looks for the DevTools port either: it is polled while a song plays, so it takes the port
        // Folia already found (or the one it named) and answers from the media session meanwhile.
        status: readStatus,

        // The same state for a session restore, with a search for the DevTools port first: a Spotify the
        // listener left running is named by the track it is on only once the port it listens on is known,
        // and a fresh run has found none. The search reads the app's port file and asks the machine's
        // loopback ports; it starts, closes and pauses nothing. A run makes at most two of them, at least
        // STATUS_PORT_SEARCH_GAP_MS apart, and none at all where the port is already known, where Spotify's
        // app is not installed, or where the caller named the port itself - so what follows cannot turn
        // into a search per poll. Where no search finds a port the answer is the media session's, as any
        // status read's is.
        async statusWithPortSearch() {
            const searching = !requestedPort && !foundPort
        && statusPortSearches < STATUS_PORT_SEARCHES
        && Date.now() - statusPortSearchedAt >= STATUS_PORT_SEARCH_GAP_MS
        && spotifyInstalled();
            if (searching) {
                statusPortSearches += 1;
                statusPortSearchedAt = Date.now();
                const port = await findPort({ again: true, quiet: true });
                const which = 'search ' + statusPortSearches + ' of ' + STATUS_PORT_SEARCHES;
                if (port) log('[SpotifyClient] the DevTools port of Spotify is ' + port + ', from ' + foundPortFrom + ' (' + which + ')');
                else log('[SpotifyClient] this status read found no DevTools port for Spotify (' + which + ')');
            }
            return readStatus();
        },

        // The player is let go: the listener's own repeat and shuffle are put back as this run found
        // them, and the media session helper and the DevTools connection are ended. Spotify itself
        // is left running as it is, and the next call builds both again. This is what leaving
        // Spotify's own app for another way of playing, and signing out of it, do: nothing of
        // Folia's is left steering an app it no longer plays in, and the helper process is not left
        // behind for the rest of the run.
        //
        // A release that could not reach the app still lets everything go: the record of what was
        // changed stays, so a later `restoreUserState` (or the quit) puts it back.
        async release() {
            await this.restoreUserState();
            page.close();
            mediaSession?.close();
            stopWindowWatch();
        },

        // The app is quitting: the page connection and the media session helper are let go. Nothing in
        // the page is changed, so a page that stopped answering cannot hold the quit.
        async close() {
            page.close();
            mediaSession?.close();
            stopWindowWatch();
        },
    };
}

module.exports = {
    CDP_PORT, MAX_QUEUED, PLAY_STATE_SOURCE, QUEUE_SOURCE, RESTORE_STATE_SOURCE, START_QUEUE_SOURCE, START_WAIT_SOURCE,
    createSpotifyOfficialClient, findLauncher, isAdvertisementItem, repeatModeOf, statusFromMediaSession, statusFromPlayerState,
};
