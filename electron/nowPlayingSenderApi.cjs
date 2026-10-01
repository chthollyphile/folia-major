const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');

// electron/nowPlayingSenderApi.cjs
// Mode 1 "Now Playing 发送": Folia acts as a producer and broadcasts its own
// track / lyric / progress to local clients. The wire format mirrors what the
// now-playing-service consumer (nowPlayingProvider.ts) reads — a `{ event, data }`
// envelope plus GET query endpoints — but the server is completely independent
// from Stage mode and from the read-only Lyric API.
//
// One decision worth stating up front: every `duration` on the wire is seconds, because that is
// what now-playing-service actually serves — `Track.duration` / `Lyric.duration` are commented
// 秒 in the entities, and its frontend feeds them straight into a seconds-based progress bar.
// ServerAPI.md documents milliseconds, but that file describes the MusicBee plugin, which is a
// different implementation from the one these clients connect to.

const NOW_PLAYING_SENDER_VERSION = 2;
const NOW_PLAYING_SENDER_EVENTS = ['Track', 'Lyric', 'PlayerPauseState', 'PlayerProgress', 'PlayerProgressReplay'];
const NOW_PLAYING_SENDER_REPEAT_TYPES = new Set(['NONE', 'ONE', 'ALL']);

// Bounds for the user-facing progress heartbeat. `0` means "never on a timer": only playback
// events (play/pause, track change, seek) still put a progress anchor on the wire, which is what
// a client needs to stop extrapolating badly between reports.
const NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC = 0;
const NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC = 10;

/** One-decimal seconds, clamped to the documented range. Anything unparseable reads as the default. */
const normalizeNowPlayingSenderProgressIntervalSec = (value, fallback = 0.5) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const clamped = Math.min(
    NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC,
    Math.max(NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC, numeric),
  );
  return Math.round(clamped * 10) / 10;
};

const copyText = (value) => (typeof value === 'string' ? value : '');

/** Milliseconds → the whole seconds now-playing-service puts on the wire. */
const toNowPlayingSenderDurationSec = (durationMs) => {
  const safeMs = Number(durationMs);
  return Number.isFinite(safeMs) && safeMs > 0 ? Math.round(safeMs / 1000) : 0;
};

/**
 * Track snapshot → the `Track` message shape now-playing clients already normalize
 * (author/title/album/cover/duration/id), `duration` in seconds.
 */
const serializeNowPlayingSenderTrack = (snapshot) => {
  if (!snapshot) {
    return null;
  }
  return {
    id: snapshot.id === null || snapshot.id === undefined ? null : String(snapshot.id),
    title: copyText(snapshot.title),
    author: copyText(snapshot.artist),
    album: copyText(snapshot.album),
    cover: copyText(snapshot.coverUrl),
    duration: toNowPlayingSenderDurationSec(snapshot.durationMs),
  };
};

/**
 * Lyric payload → the `Lyric` message shape. `lrc` is the line-level timeline and
 * `karaokeLyric` carries the word-level timeline when one exists.
 */
const serializeNowPlayingSenderLyric = (payload) => {
  if (!payload) {
    return null;
  }
  return {
    source: copyText(payload.source),
    title: copyText(payload.title),
    author: copyText(payload.artist),
    duration: toNowPlayingSenderDurationSec(payload.durationMs),
    hasLyric: Boolean(payload.hasLyric),
    hasTranslatedLyric: Boolean(payload.hasTranslatedLyric),
    hasKaraokeLyric: Boolean(payload.hasKaraokeLyric),
    lrc: copyText(payload.lrc),
    translatedLyric: copyText(payload.translatedLyric),
    karaokeLyric: copyText(payload.karaokeLyric),
  };
};

const areNowPlayingSenderRecordsEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** The blank `/api/query` track, mirroring now-playing-service's default-constructed `Track`.
 *  A fresh copy per response: a caller that mutates what it got must not poison later answers. */
const EMPTY_NOW_PLAYING_SENDER_TRACK = () => ({
  author: '',
  title: '',
  album: '',
  cover: '',
  duration: 0,
  durationHuman: '0:00',
  url: '',
  id: '',
  isVideo: false,
  isAdvertisement: false,
  inLibrary: false,
});

/** Same for `/api/lyric`: now-playing-service answers with its default Lyric entity, never null. */
const EMPTY_NOW_PLAYING_SENDER_LYRIC = () => ({
  source: '',
  title: '',
  author: '',
  duration: 0,
  hasLyric: false,
  hasTranslatedLyric: false,
  hasKaraokeLyric: false,
  lrc: '',
  translatedLyric: '',
  karaokeLyric: '',
});

/** "m:ss" / "h:mm:ss", matching the documented `*Human` fields. */
const formatNowPlayingSenderHumanTime = (totalSeconds) => {
  const safeSeconds = Number.isFinite(Number(totalSeconds)) ? Math.max(0, Math.floor(Number(totalSeconds))) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};

function createNowPlayingSenderApi({
  store,
  getMainWindow,
  enabledSettingKey,
  progressIntervalSettingKey,
  // Resolved on every use so a port changed at runtime takes effect on the next start
  // without rebuilding the controller.
  getPort,
}) {
  let server = null;
  let webSocketServer = null;
  const webSockets = new Set();
  let lastError = null;
  let latestTrack = null;
  let latestLyric = null;
  // Progress + pause state are published separately so the documented `seekbarCurrentPosition`
  // (not a raw progressMs) can be rendered without guessing a unit on read.
  let latestPauseState = null;
  let latestProgress = null;
  // Volume and repeat live in the renderer, so they ride along with each playback report
  // instead of being polled from the main process.
  let latestVolumePercent = 0;
  let latestRepeatType = 'NONE';
  // Dedupe: a Track/Lyric message only goes out when its normalized record changed.
  let publishedTrack = null;
  let publishedLyric = null;

  const isEnabled = () => store.get(enabledSettingKey) === true;

  const readPort = () => getPort();

  // The renderer owns the heartbeat timer; this value is what it schedules against, and the
  // main process only persists and reports it.
  const readProgressIntervalSec = () => normalizeNowPlayingSenderProgressIntervalSec(
    progressIntervalSettingKey ? store.get(progressIntervalSettingKey) : undefined,
  );

  const resolveNowPlayingSenderDurationSec = () => {
    const durationSec = Number(latestTrack?.duration);
    return Number.isFinite(durationSec) && durationSec > 0 ? Math.floor(durationSec) : 0;
  };

  const hasNowPlayingSenderTrack = () => Boolean(latestTrack) && isEnabled();

  const buildPlayerSnapshot = () => {
    const durationSec = resolveNowPlayingSenderDurationSec();
    // No track and no playback report: report a paused player at the start rather than a fake
    // position. The `!latestTrack` half of this matters because clearing the track also clears
    // the progress/pause pair below — without it, leaving Stage mode left `/api/query` answering
    // `hasSong: false` next to the retired song's clock and pause bit.
    if (!latestTrack || (!latestPauseState && !latestProgress)) {
      return {
        hasSong: hasNowPlayingSenderTrack(),
        isPaused: true,
        volumePercent: latestVolumePercent,
        seekbarCurrentPosition: 0,
        seekbarCurrentPositionHuman: formatNowPlayingSenderHumanTime(0),
        statePercent: 0,
        likeStatus: 'INDIFFERENT',
        repeatType: latestRepeatType,
      };
    }
    const progressSec = Math.max(0, Math.floor((latestProgress?.progressMs ?? 0) / 1000));
    return {
      hasSong: hasNowPlayingSenderTrack(),
      isPaused: Boolean(latestPauseState?.isPaused),
      volumePercent: latestVolumePercent,
      seekbarCurrentPosition: progressSec,
      seekbarCurrentPositionHuman: formatNowPlayingSenderHumanTime(progressSec),
      // Documented as a 0..1 ratio; 0 when the duration is unknown.
      statePercent: durationSec > 0 ? Math.min(1, progressSec / durationSec) : 0,
      likeStatus: 'INDIFFERENT',
      repeatType: latestRepeatType,
    };
  };

  // now-playing-service answers with a populated `track` whether or not a song plays, because its
  // clients read `track.title` before checking `player.hasSong`. Returning `null` here throws in
  // that read, so an empty player gets blank fields with `hasSong: false` standing beside them.
  const buildTrackSnapshot = () => {
    if (!hasNowPlayingSenderTrack()) {
      return EMPTY_NOW_PLAYING_SENDER_TRACK();
    }
    const durationSec = resolveNowPlayingSenderDurationSec();
    return {
      ...latestTrack,
      duration: durationSec,
      durationHuman: formatNowPlayingSenderHumanTime(durationSec),
      // Filled in by now-playing-service; no Folia-side equivalent yet. Kept so clients that
      // read the documented shape get the field instead of `undefined`.
      url: '',
      isVideo: false,
      isAdvertisement: false,
      inLibrary: false,
    };
  };

  const buildQuerySnapshot = () => ({
    player: buildPlayerSnapshot(),
    track: buildTrackSnapshot(),
  });

  const buildStatus = () => ({
    enabled: isEnabled(),
    running: Boolean(server?.listening),
    port: readPort(),
    // `/api/query` is the documented probe endpoint; the per-field routes remain for
    // lighter polling.
    url: isEnabled() ? `http://127.0.0.1:${readPort()}/api/query` : null,
    wsUrl: isEnabled() ? `ws://127.0.0.1:${readPort()}/api/ws/lyric` : null,
    progressIntervalSec: readProgressIntervalSec(),
    clientCount: webSockets.size,
    error: lastError,
  });

  const broadcastStatus = () => {
    const mainWindow = getMainWindow?.();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('now-playing-sender-status-changed', buildStatus());
    }
  };

  const sendJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  };

  const sendWebSocketEvent = (socket, event, data) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify({ event, data }));
    return true;
  };

  const broadcastWebSocketEvent = (event, data) => {
    for (const socket of webSockets) {
      sendWebSocketEvent(socket, event, data);
    }
  };

  // A new connection gets the full current state, mirroring how now-playing-service
  // rehydrates a freshly connected consumer. A null Track/Lyric is sent explicitly so a
  // client that reconnects mid-session clears its stale song instead of keeping it.
  const sendBootstrapEvents = (socket) => {
    // The cached `latestTrack` itself, not `buildTrackSnapshot()`: that would make the track a
    // client sees on connect differ in shape from the one it gets on the next switch.
    sendWebSocketEvent(socket, 'Track', latestTrack);
    sendWebSocketEvent(socket, 'Lyric', latestLyric);
    sendWebSocketEvent(socket, 'PlayerPauseState', buildPlayerSnapshot());
    sendWebSocketEvent(socket, 'PlayerProgress', { progress: latestProgress?.progressMs ?? 0 });
  };

  const rejectUpgrade = (socket, statusCode, message) => {
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const handleUpgrade = (req, socket, head) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/api/ws/lyric') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!isEnabled()) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    if (!webSocketServer) {
      webSocketServer = new WebSocketServer({ noServer: true });
    }
    webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
      webSockets.add(webSocket);
      webSocket.on('close', () => {
        webSockets.delete(webSocket);
        broadcastStatus();
      });
      webSocket.on('error', () => {
        webSockets.delete(webSocket);
        broadcastStatus();
      });
      sendBootstrapEvents(webSocket);
      broadcastStatus();
    });
  };

  const handleRequest = (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${readPort()}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    switch (requestUrl.pathname) {
      // Documented probe endpoint: PV Tool only checks that the service answers.
      case '/api/query':
      case '/api/query/now':
        sendJson(res, 200, buildQuerySnapshot());
        return;
      // `/query/track` is a Track by itself, not a wrapped snapshot — same distinction
      // now-playing-service makes between NowPlayingController.query() and queryTrack().
      case '/api/query/track':
      case '/query/track':
        sendJson(res, 200, buildTrackSnapshot());
        return;
      case '/api/query/progress':
      case '/query/progress':
        sendJson(res, 200, { progress: latestProgress?.progressMs ?? 0 });
        return;
      case '/api/query/player':
      case '/query/player':
        sendJson(res, 200, buildPlayerSnapshot());
        return;
      case '/api/query/hasSong':
        sendJson(res, 200, { data: buildPlayerSnapshot().hasSong });
        return;
      case '/api/query/isConnected':
        sendJson(res, 200, { data: hasNowPlayingSenderTrack() });
        return;
      // The lyric Gem the AMLL/Apple Music-style players and now-playing-service both expose.
      // Same record as the `Lyric` WS message so the two agree at any instant.
      case '/api/lyric':
        sendJson(res, 200, latestLyric ?? EMPTY_NOW_PLAYING_SENDER_LYRIC());
        return;
      default:
        sendJson(res, 404, { error: 'Not found.' });
    }
  };

  const start = async () => {
    if (!isEnabled() || server?.listening) {
      return buildStatus();
    }

    const listenPort = readPort();
    const nextServer = http.createServer(handleRequest);
    nextServer.on('upgrade', handleUpgrade);
    try {
      await new Promise((resolve, reject) => {
        nextServer.once('error', reject);
        nextServer.listen(listenPort, '127.0.0.1', () => {
          nextServer.off('error', reject);
          resolve();
        });
      });
      server = nextServer;
      lastError = null;
      console.log(`[NowPlayingSender] Listening on http://127.0.0.1:${listenPort}/api/query.`);
    } catch (error) {
      // Almost always EADDRINUSE from another now-playing listener. The port is fixed and shared by
      // definition, so there is nothing to retry towards: report it and stay stopped.
      if (error?.code === 'EADDRINUSE') {
        lastError = `Port ${listenPort} is already in use.`;
      } else {
        lastError = error instanceof Error ? error.message : String(error);
      }
      try {
        nextServer.close();
      } catch {
        // nothing was bound; nothing to release
      }
    }
    broadcastStatus();
    return buildStatus();
  };

  const closeWebSockets = () => {
    for (const socket of webSockets) {
      try {
        socket.close(1001, 'Now Playing sender stopped.');
      } catch {
        // closing a dead socket is not actionable
      }
    }
    webSockets.clear();
    if (webSocketServer) {
      try {
        webSocketServer.close();
      } catch {
        // same
      }
      webSocketServer = null;
    }
  };

  const stop = async () => {
    // Clearing the cached state keeps a stopped sender from answering with a stale song.
    latestTrack = null;
    latestLyric = null;
    latestPauseState = null;
    latestProgress = null;
    publishedTrack = null;
    publishedLyric = null;
    closeWebSockets();
    if (!server) {
      broadcastStatus();
      return buildStatus();
    }
    const activeServer = server;
    server = null;
    broadcastStatus();
    await new Promise((resolve) => activeServer.close(() => resolve()));
    broadcastStatus();
    return buildStatus();
  };

  const setEnabled = async (enabled) => {
    store.set(enabledSettingKey, Boolean(enabled));
    lastError = null;
    return enabled ? start() : stop();
  };

  const setProgressIntervalSec = (value) => {
    const nextIntervalSec = normalizeNowPlayingSenderProgressIntervalSec(value);
    if (progressIntervalSettingKey) {
      store.set(progressIntervalSettingKey, nextIntervalSec);
    }
    // No restart: the heartbeat is the renderer's timer, and it picks this up from the status
    // broadcast below, so a change lands on the next scheduled tick.
    broadcastStatus();
    return buildStatus();
  };

  const publishTrack = (snapshot) => {
    latestTrack = serializeNowPlayingSenderTrack(snapshot);
    // Progress and pause are the cleared song's; keeping them would let /api/query and a late
    // `/api/query/player` reader describe a position on a song that is no longer there.
    if (!latestTrack) {
      latestPauseState = null;
      latestProgress = null;
    }
    if (!areNowPlayingSenderRecordsEqual(publishedTrack, latestTrack)) {
      publishedTrack = latestTrack;
      broadcastWebSocketEvent('Track', latestTrack);
    }
  };

  const publishLyric = (payload) => {
    latestLyric = serializeNowPlayingSenderLyric(payload);
    if (!areNowPlayingSenderRecordsEqual(publishedLyric, latestLyric)) {
      publishedLyric = latestLyric;
      broadcastWebSocketEvent('Lyric', latestLyric);
    }
  };

  const publishPlayback = ({ progressMs, isPaused, isReplay, volumePercent, repeatType } = {}) => {
    const safeProgressMs = Number.isFinite(Number(progressMs)) ? Math.max(0, Math.floor(Number(progressMs))) : 0;
    const safeVolume = Number(volumePercent);
    latestVolumePercent = Number.isFinite(safeVolume) ? Math.min(100, Math.max(0, Math.round(safeVolume))) : 0;
    latestRepeatType = NOW_PLAYING_SENDER_REPEAT_TYPES.has(repeatType) ? repeatType : 'NONE';
    const wasPaused = latestPauseState?.isPaused ?? true;
    latestPauseState = { isPaused: Boolean(isPaused) };
    latestProgress = { progressMs: safeProgressMs };

    // Progress is a fresh anchor on every report; the pause message only fires when the
    // played/paused bit actually flips (or when a replay rewinds), which is what the
    // documented notification types describe.
    const shouldPublishPauseState = Boolean(isReplay) || latestPauseState.isPaused !== wasPaused;
    if (shouldPublishPauseState) {
      broadcastWebSocketEvent('PlayerPauseState', buildPlayerSnapshot());
    }
    if (isReplay) {
      broadcastWebSocketEvent('PlayerProgressReplay', {});
    }
    broadcastWebSocketEvent('PlayerProgress', { progress: safeProgressMs });
  };

  return {
    buildStatus,
    publishLyric,
    publishPlayback,
    publishTrack,
    setEnabled,
    setProgressIntervalSec,
    start,
    stop,
    version: NOW_PLAYING_SENDER_VERSION,
  };
}

module.exports = {
  NOW_PLAYING_SENDER_EVENTS,
  NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC,
  NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC,
  NOW_PLAYING_SENDER_VERSION,
  createNowPlayingSenderApi,
  formatNowPlayingSenderHumanTime,
  normalizeNowPlayingSenderProgressIntervalSec,
  serializeNowPlayingSenderLyric,
  serializeNowPlayingSenderTrack,
};
