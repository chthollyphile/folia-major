#!/usr/bin/env node
/**
 * Folia macOS Now Playing bridge (memory-conscious)
 *
 * Speaks the same WebSocket protocol Folia expects:
 *   ws://localhost:9863/api/ws/lyric
 * And Folia's precise progress probe:
 *   GET http://localhost:9863/api/query/progress → { "progress": <ms> }
 *
 * Memory strategy:
 * - Do not start the AppleScript monitor until a Folia client connects
 * - Pause the monitor shortly after the last client disconnects
 * - Small lyric LRU, no deflate WS contexts, capped Node heap via npm start
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import {
  getCachedMusicSnapshot,
  readMusicSnapshot,
  startMonitor,
  pauseMonitor,
  stopMusicMonitor,
  isMonitorRunning,
} from './musicSource.js';
import { fetchLyrics, lyricCacheSize } from './lyrics.js';

const PORT = Number(process.env.FOLIA_NP_PORT || 9863);
const HOST = process.env.FOLIA_NP_HOST || '127.0.0.1';
const POLL_MS = Number(process.env.FOLIA_NP_POLL_MS || 250);
const PROGRESS_PUSH_MS = Number(process.env.FOLIA_NP_PROGRESS_PUSH_MS || 1500);
const OFFSET_MS = Number(process.env.FOLIA_NP_OFFSET_MS || 500);
/** Keep monitor alive this long after last client leaves (avoids thrash on reconnect). */
const IDLE_STOP_MS = Number(process.env.FOLIA_NP_IDLE_STOP_MS || 15000);
const WS_PATH = '/api/ws/lyric';
const DEMO = process.env.FOLIA_NP_DEMO === '1' || process.argv.includes('--demo');

const DEMO_LRC = `[00:00.00]Folia macOS Now Playing demo
[00:04.00]Music.app is the audio source
[00:08.00]Folia renders the lyric stage
[00:12.00]Protocol: ws://localhost:9863/api/ws/lyric
[00:16.00]Events: Track / Lyric / Progress`;

function readDemoSnapshot(startedAt) {
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const duration = 24;
  const position = elapsedSec % duration;
  return {
    ok: true,
    state: 'playing',
    hasSong: true,
    id: 'demo-1',
    title: 'Folia macOS Now Playing Demo',
    artist: 'Folia Tools',
    album: 'tools/macos-nowplaying',
    duration,
    position,
    sampledAtMs: Date.now(),
    readLatencyMs: 0,
  };
}

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

let lastTrackId = null;
let lastTitle = '';
let lastArtist = '';
let lastPaused = true;
let lastEmittedProgressMs = -1;
let lastProgressPushAt = 0;
let lyricTrackKey = '';
let lyricInFlight = null;
let smoothPosMs = null;
/** @type {{ progressMs: number, paused: boolean, atMs: number } | null} */
let lastProgressSample = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let idleStopTimer = null;

function broadcast(event, data) {
  if (clients.size === 0) return;
  const payload = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function sendTo(client, event, data) {
  if (client.readyState === 1) {
    client.send(JSON.stringify({ event, data }));
  }
}

function trackKey(snap) {
  return `${snap.id || ''}|${snap.title || ''}|${snap.artist || ''}|${Math.round(snap.duration || 0)}`;
}

function rawPositionMs(snap) {
  const positionSec = Number(snap.position) || 0;
  const readLatencyMs = Number(snap.readLatencyMs) || 0;
  const isPlaying = String(snap.state).toLowerCase() === 'playing';
  let ms = positionSec * 1000;
  if (isPlaying) ms += readLatencyMs / 2;
  if (isPlaying && snap.sampledAtMs) {
    ms += Math.max(0, Date.now() - snap.sampledAtMs);
  }
  return Math.max(0, ms);
}

function toProgressMs(snap, { resetSmooth = false } = {}) {
  const isPlaying = String(snap.state).toLowerCase() === 'playing';
  const raw = rawPositionMs(snap);

  if (resetSmooth || smoothPosMs === null || !isPlaying) {
    smoothPosMs = raw;
  } else {
    const delta = raw - smoothPosMs;
    if (delta >= -1500 && delta <= 2500) {
      smoothPosMs = smoothPosMs * 0.72 + raw * 0.28;
    }
  }

  return Math.max(0, Math.floor(smoothPosMs - OFFSET_MS));
}

function currentSnap() {
  if (DEMO) return readDemoSnapshot(demoStartedAt);
  return getCachedMusicSnapshot();
}

function ensureMonitorForClients() {
  if (DEMO) return;
  if (idleStopTimer) {
    clearTimeout(idleStopTimer);
    idleStopTimer = null;
  }
  if (clients.size > 0) {
    startMonitor();
  }
}

function scheduleIdleStop() {
  if (DEMO) return;
  if (idleStopTimer) clearTimeout(idleStopTimer);
  idleStopTimer = setTimeout(() => {
    idleStopTimer = null;
    if (clients.size === 0) {
      pauseMonitor();
      // Drop track bookkeeping so reconnect starts clean without retaining lyric key state.
      lastTrackId = null;
      lastTitle = '';
      lastArtist = '';
      lastPaused = true;
      lastEmittedProgressMs = -1;
      lastProgressSample = null;
      smoothPosMs = null;
      lyricTrackKey = '';
      if (typeof globalThis.gc === 'function') {
        try { globalThis.gc(); } catch { /* optional */ }
      }
      console.log('[np] idle: Music monitor paused (no clients)');
    }
  }, IDLE_STOP_MS);
}

function memoryStats() {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    externalMb: Math.round(mem.external / 1024 / 1024),
    lyricCache: lyricCacheSize(),
    monitor: isMonitorRunning(),
    clients: clients.size,
  };
}

function broadcastLyric(snap, lrc, source) {
  broadcast('Lyric', {
    source: lrc ? (source || 'lrclib') : null,
    title: snap.title,
    author: snap.artist,
    duration: snap.duration,
    hasLyric: Boolean(lrc),
    hasTranslatedLyric: false,
    hasKaraokeLyric: false,
    lrc: lrc || '',
    translatedLyric: '',
    karaokeLyric: '',
  });
}

async function ensureLyrics(snap) {
  const key = trackKey(snap);
  if (key === lyricTrackKey) return;
  lyricTrackKey = key;

  if (DEMO) {
    broadcastLyric(snap, DEMO_LRC, 'demo');
    return;
  }

  const request = fetchLyrics({
    title: snap.title,
    artist: snap.artist,
    album: snap.album,
    duration: snap.duration,
  }).then((result) => {
    if (lyricTrackKey !== key) return;
    broadcastLyric(snap, result.lrc, result.source);
  }).finally(() => {
    if (lyricInFlight === request) lyricInFlight = null;
  });

  lyricInFlight = request;
  await request;
}

function emitTrack(snap) {
  broadcast('Track', {
    id: snap.id || `${snap.title}-${snap.artist}`,
    title: snap.title || 'Now Playing',
    author: snap.artist || 'Unknown',
    album: snap.album || '',
    cover: '',
    duration: Number(snap.duration) || 0,
  });
}

function emitPauseState(snap, isPaused, progressMs) {
  const durationSec = Number(snap.duration) || 0;
  const positionSec = progressMs / 1000;
  broadcast('PlayerPauseState', {
    hasSong: true,
    isPaused,
    seekbarCurrentPosition: positionSec,
    statePercent: durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0,
  });
}

function emitProgress(progressMs, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastProgressPushAt < PROGRESS_PUSH_MS) return;
  if (!force && Math.abs(progressMs - lastEmittedProgressMs) < 80) return;
  lastProgressPushAt = now;
  lastEmittedProgressMs = progressMs;
  lastProgressSample = { progressMs, paused: lastPaused, atMs: now };
  broadcast('PlayerProgress', { progress: progressMs });
}

const demoStartedAt = Date.now();

function tick() {
  // No Folia clients → do nothing (monitor should also be paused after idle grace).
  if (clients.size === 0 && !DEMO) return;

  const snap = currentSnap();

  if (!snap.ok || !snap.hasSong) {
    if (lastTrackId !== null) {
      lastTrackId = null;
      lastTitle = '';
      lastArtist = '';
      lastPaused = true;
      lastEmittedProgressMs = -1;
      lastProgressSample = null;
      smoothPosMs = null;
      lyricTrackKey = '';
      broadcast('PlayerProgressReplay', {});
      broadcast('PlayerPauseState', {
        hasSong: false,
        isPaused: true,
        seekbarCurrentPosition: 0,
        statePercent: 0,
      });
    }
    return;
  }

  const id = String(snap.id || `${snap.title}|${snap.artist}`);
  const changed = id !== lastTrackId
    || snap.title !== lastTitle
    || snap.artist !== lastArtist;

  const progressMs = toProgressMs(snap, { resetSmooth: changed });

  if (changed) {
    lastTrackId = id;
    lastTitle = snap.title || '';
    lastArtist = snap.artist || '';
    lastEmittedProgressMs = -1;
    lastProgressPushAt = 0;
    broadcast('PlayerProgressReplay', {});
    emitTrack(snap);
    void ensureLyrics(snap);
  }

  const isPaused = String(snap.state).toLowerCase() !== 'playing';
  if (isPaused !== lastPaused || changed) {
    lastPaused = isPaused;
    emitPauseState(snap, isPaused, progressMs);
    emitProgress(progressMs, { force: true });
    return;
  }

  if (!isPaused) {
    emitProgress(progressMs);
  } else {
    lastProgressSample = { progressMs, paused: true, atMs: Date.now() };
  }
}

async function pushSnapshotTo(client) {
  const snap = DEMO ? readDemoSnapshot(demoStartedAt) : await readMusicSnapshot();
  if (!snap.ok || !snap.hasSong) {
    sendTo(client, 'PlayerPauseState', {
      hasSong: false,
      isPaused: true,
      seekbarCurrentPosition: 0,
      statePercent: 0,
    });
    return;
  }

  const progressMs = toProgressMs(snap, { resetSmooth: true });
  const isPaused = String(snap.state).toLowerCase() !== 'playing';

  sendTo(client, 'Track', {
    id: snap.id || `${snap.title}-${snap.artist}`,
    title: snap.title || 'Now Playing',
    author: snap.artist || 'Unknown',
    album: snap.album || '',
    cover: '',
    duration: Number(snap.duration) || 0,
  });

  sendTo(client, 'PlayerPauseState', {
    hasSong: true,
    isPaused,
    seekbarCurrentPosition: progressMs / 1000,
    statePercent: snap.duration > 0
      ? Math.min(1, Math.max(0, (progressMs / 1000) / snap.duration))
      : 0,
  });
  sendTo(client, 'PlayerProgress', { progress: progressMs });
  lastProgressSample = { progressMs, paused: isPaused, atMs: Date.now() };
  lastEmittedProgressMs = progressMs;
  lastProgressPushAt = Date.now();

  if (DEMO) {
    sendTo(client, 'Lyric', {
      source: 'demo',
      title: snap.title,
      author: snap.artist,
      duration: snap.duration,
      hasLyric: true,
      hasTranslatedLyric: false,
      hasKaraokeLyric: false,
      lrc: DEMO_LRC,
      translatedLyric: '',
      karaokeLyric: '',
    });
    return;
  }

  void fetchLyrics({
    title: snap.title,
    artist: snap.artist,
    album: snap.album,
    duration: snap.duration,
  }).then((result) => {
    sendTo(client, 'Lyric', {
      source: result.lrc ? (result.source || 'lrclib') : null,
      title: snap.title,
      author: snap.artist,
      duration: snap.duration,
      hasLyric: Boolean(result.lrc),
      hasTranslatedLyric: false,
      hasKaraokeLyric: false,
      lrc: result.lrc || '',
      translatedLyric: '',
      karaokeLyric: '',
    });
  });
}

async function handleProgressQuery(res) {
  try {
    let snap = currentSnap();
    const stale = !snap.sampledAtMs || Date.now() - snap.sampledAtMs > 1500;
    if (!DEMO && clients.size > 0 && (!snap.ok || stale)) {
      snap = await readMusicSnapshot();
    }
    if (!snap.ok || !snap.hasSong) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ progress: 0 }));
      return;
    }
    const progress = toProgressMs(snap);
    lastProgressSample = {
      progressMs: progress,
      paused: String(snap.state).toLowerCase() !== 'playing',
      atMs: Date.now(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ progress }));
  } catch (error) {
    if (lastProgressSample) {
      let progress = lastProgressSample.progressMs;
      if (!lastProgressSample.paused) {
        progress += Math.max(0, Date.now() - lastProgressSample.atMs);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ progress: Math.max(0, Math.floor(progress)) }));
      return;
    }
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/health' || url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'folia-macos-nowplaying',
      port: PORT,
      ws: `ws://${HOST}:${PORT}${WS_PATH}`,
      offsetMs: OFFSET_MS,
      pollMs: POLL_MS,
      progressPushMs: PROGRESS_PUSH_MS,
      idleStopMs: IDLE_STOP_MS,
      mode: DEMO ? 'demo' : 'Music.app',
      memory: memoryStats(),
    }));
    return;
  }

  if (url === '/api/query/progress' || url.startsWith('/api/query/progress?')) {
    void handleProgressQuery(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(
    `Folia macOS Now Playing bridge\n`
    + `WebSocket: ws://${HOST}:${PORT}${WS_PATH}\n`
    + `Progress:  GET /api/query/progress\n`
    + `Memory:    ${JSON.stringify(memoryStats())}\n`,
  );
});

const wss = new WebSocketServer({
  server,
  path: WS_PATH,
  // Avoid per-connection zlib inflate/deflate contexts.
  perMessageDeflate: false,
  maxPayload: 64 * 1024,
});

wss.on('connection', (socket) => {
  clients.add(socket);
  ensureMonitorForClients();
  console.log(`[np] client connected (${clients.size}) monitor=${isMonitorRunning()}`);
  void pushSnapshotTo(socket);
  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[np] client disconnected (${clients.size})`);
    if (clients.size === 0) scheduleIdleStop();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[np] Folia macOS Now Playing bridge listening`);
  console.log(`[np]   HTTP  http://${HOST}:${PORT}/health`);
  console.log(`[np]   PROG  http://${HOST}:${PORT}/api/query/progress`);
  console.log(`[np]   WS    ws://${HOST}:${PORT}${WS_PATH}`);
  console.log(`[np]   mode  ${DEMO ? 'demo' : 'Music.app (start monitor on demand)'}`);
  console.log(`[np]   offset ${OFFSET_MS}ms | progress push ${PROGRESS_PUSH_MS}ms | idle stop ${IDLE_STOP_MS}ms`);
  console.log(`[np]   mem   ${JSON.stringify(memoryStats())}`);
});

setInterval(() => {
  try {
    tick();
  } catch (err) {
    console.warn('[np] poll error:', err instanceof Error ? err.message : err);
  }
}, POLL_MS);

function shutdown() {
  if (idleStopTimer) clearTimeout(idleStopTimer);
  stopMusicMonitor();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
