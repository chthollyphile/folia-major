'use strict';

/**
 * Built-in macOS Now Playing bridge for Folia desktop.
 * Speaks the same protocol as Widdit Now Playing so the existing renderer
 * NowPlayingProvider keeps working:
 *   ws://127.0.0.1:9863/api/ws/lyric
 *   GET http://127.0.0.1:9863/api/query/progress → { progress }
 *
 * Active only when Stage Mode source is `now-playing` on darwin.
 */

const http = require('http');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 9863;
const WS_PATH = '/api/ws/lyric';
const PROGRESS_PUSH_MS = 1500;
const OFFSET_MS = 500;
const POLL_MS = 250;
const IDLE_STOP_MS = 15_000;
const MAX_BUFFER = 8 * 1024;
const LYRIC_CACHE_MAX = 8;
const UA = 'Folia-macOS-MusicNowPlaying/0.1';

function resolveBundledScript(filename) {
  const alongside = path.join(__dirname, filename);
  const marker = `${path.sep}app.asar${path.sep}`;
  if (alongside.includes(marker)) {
    return alongside.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return alongside;
}

const MONITOR_SCRIPT = resolveBundledScript('musicMonitor.applescript');
const ONESHOT_SCRIPT = resolveBundledScript('music.applescript');

function createMacosMusicNowPlayingController({ log = console } = {}) {
  /** @type {import('http').Server | null} */
  let server = null;
  /** @type {import('ws').WebSocketServer | null} */
  let wss = null;
  /** @type {Set<import('ws').WebSocket>} */
  const clients = new Set();
  /** @type {import('child_process').ChildProcess | null} */
  let monitorChild = null;
  let monitorBuffer = '';
  let monitorWanted = false;
  let monitorRestartTimer = null;
  let pollTimer = null;
  let idleStopTimer = null;
  let startingServer = false;

  let latestSnap = { ok: false, reason: 'idle', sampledAtMs: 0, readLatencyMs: 0 };
  let lastTrackId = null;
  let lastTitle = '';
  let lastArtist = '';
  let lastPaused = true;
  let lastEmittedProgressMs = -1;
  let lastProgressPushAt = 0;
  let lyricTrackKey = '';
  let smoothPosMs = null;
  let lastProgressSample = null;
  /** @type {Map<string, string | null>} */
  const lyricCache = new Map();

  const info = (...args) => log.info?.('[MacMusicNP]', ...args) ?? console.log('[MacMusicNP]', ...args);
  const warn = (...args) => log.warn?.('[MacMusicNP]', ...args) ?? console.warn('[MacMusicNP]', ...args);

  function rememberSnap(snap) {
    latestSnap = {
      ok: Boolean(snap.ok),
      reason: snap.reason,
      state: snap.state,
      hasSong: snap.hasSong,
      id: snap.id,
      title: snap.title,
      artist: snap.artist,
      album: snap.album,
      duration: snap.duration,
      position: snap.position,
      sampledAtMs: Date.now(),
      readLatencyMs: Number(snap.readLatencyMs) || 0,
    };
  }

  function stopMonitor() {
    if (monitorRestartTimer) {
      clearTimeout(monitorRestartTimer);
      monitorRestartTimer = null;
    }
    if (monitorChild) {
      const proc = monitorChild;
      monitorChild = null;
      try { proc.removeAllListeners(); } catch { /* ignore */ }
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }, 800);
    }
    monitorBuffer = '';
  }

  function scheduleMonitorRestart() {
    if (!monitorWanted || monitorRestartTimer) return;
    monitorRestartTimer = setTimeout(() => {
      monitorRestartTimer = null;
      if (monitorWanted) startMonitor();
    }, 1200);
  }

  function startMonitor() {
    monitorWanted = true;
    if (monitorChild) return;
    const proc = spawn('osascript', [MONITOR_SCRIPT], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    monitorChild = proc;
    monitorBuffer = '';
    const onChunk = (chunk) => {
      monitorBuffer += String(chunk);
      if (monitorBuffer.length > MAX_BUFFER) {
        monitorBuffer = monitorBuffer.slice(-Math.floor(MAX_BUFFER / 2));
      }
      let idx;
      while ((idx = monitorBuffer.indexOf('\n')) >= 0) {
        let line = monitorBuffer.slice(0, idx).trim();
        monitorBuffer = monitorBuffer.slice(idx + 1);
        const jsonStart = line.indexOf('{');
        if (jsonStart > 0) line = line.slice(jsonStart);
        if (!line.startsWith('{')) continue;
        try {
          rememberSnap(JSON.parse(line));
        } catch {
          // ignore
        }
      }
    };
    proc.stderr?.on('data', onChunk);
    proc.on('exit', () => {
      monitorChild = null;
      monitorBuffer = '';
      if (monitorWanted) scheduleMonitorRestart();
    });
    proc.on('error', () => {
      monitorChild = null;
      monitorBuffer = '';
      if (monitorWanted) scheduleMonitorRestart();
    });
  }

  function pauseMonitor() {
    monitorWanted = false;
    stopMonitor();
  }

  function readMusicSnapshotOnce() {
    return new Promise((resolve) => {
      if (latestSnap.ok && latestSnap.sampledAtMs && Date.now() - latestSnap.sampledAtMs < 1200) {
        resolve(latestSnap);
        return;
      }
      const started = Date.now();
      execFile('osascript', [ONESHOT_SCRIPT], { timeout: 4000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            reason: error.message,
            sampledAtMs: Date.now(),
            readLatencyMs: 0,
          });
          return;
        }
        const text = String(stdout || stderr || '').trim();
        const jsonStart = text.indexOf('{');
        const payload = jsonStart >= 0 ? text.slice(jsonStart) : text;
        try {
          const snap = JSON.parse(payload);
          rememberSnap({ ...snap, readLatencyMs: Date.now() - started });
          resolve(latestSnap);
        } catch (parseError) {
          resolve({
            ok: false,
            reason: parseError instanceof Error ? parseError.message : String(parseError),
            sampledAtMs: Date.now(),
            readLatencyMs: Date.now() - started,
          });
        }
      });
    });
  }

  function cacheKey(title, artist, durationSec) {
    const dur = Number.isFinite(durationSec) ? Math.round(durationSec) : 0;
    return `${String(title || '').trim().toLowerCase()}|${String(artist || '').trim().toLowerCase()}|${dur}`;
  }

  function rememberLyric(key, lrc) {
    if (lyricCache.has(key)) lyricCache.delete(key);
    lyricCache.set(key, lrc);
    while (lyricCache.size > LYRIC_CACHE_MAX) {
      const oldest = lyricCache.keys().next().value;
      if (oldest === undefined) break;
      lyricCache.delete(oldest);
    }
  }

  function pickLrc(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const synced = typeof entry.syncedLyrics === 'string' ? entry.syncedLyrics.trim() : '';
    if (synced) return synced;
    const plain = typeof entry.plainLyrics === 'string' ? entry.plainLyrics.trim() : '';
    if (!plain) return null;
    return plain
      .split('\n')
      .filter(Boolean)
      .slice(0, 200)
      .map((line, i) => `[00:${String(i).padStart(2, '0')}.00]${line}`)
      .join('\n');
  }

  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[（(].*?[）)]/g, '')
      .replace(/[-–—:].*$/u, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function scoreCandidate(entry, title, artist, durationSec) {
    const nTitle = normalizeName(title);
    const nArtist = normalizeName(artist);
    const eTitle = normalizeName(entry.trackName);
    const eArtist = normalizeName(entry.artistName);
    let score = 0;
    if (eTitle === nTitle) score += 100;
    else if (eTitle.includes(nTitle) || nTitle.includes(eTitle)) score += 50;
    if (nArtist && eArtist === nArtist) score += 40;
    else if (nArtist && (eArtist.includes(nArtist) || nArtist.includes(eArtist))) score += 20;
    if (Number.isFinite(durationSec) && Number.isFinite(entry.duration)) {
      const delta = Math.abs(Number(entry.duration) - Number(durationSec));
      if (delta <= 2) score += 30;
      else if (delta <= 5) score += 15;
      else if (delta <= 12) score += 5;
      else score -= 20;
    }
    if (entry.syncedLyrics) score += 10;
    return score;
  }

  async function fetchJson(url) {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (resp.status === 404 || resp.status === 429 || !resp.ok) return null;
    return resp.json();
  }

  async function fetchLyrics(track) {
    const title = String(track.title || '').trim();
    const artist = String(track.artist || '').trim();
    if (!title) return { lrc: null, source: null };
    const key = cacheKey(title, artist, track.duration);
    if (lyricCache.has(key)) {
      const lrc = lyricCache.get(key) ?? null;
      return { lrc, source: lrc ? 'lrclib' : null };
    }
    try {
      const getParams = new URLSearchParams({
        track_name: title,
        artist_name: artist || 'Unknown',
      });
      if (track.album) getParams.set('album_name', String(track.album));
      if (Number.isFinite(track.duration) && track.duration > 0) {
        getParams.set('duration', String(Math.round(track.duration)));
      }
      const exact = await fetchJson(`https://lrclib.net/api/get?${getParams}`);
      const exactLrc = pickLrc(exact);
      if (exactLrc) {
        rememberLyric(key, exactLrc);
        return { lrc: exactLrc, source: 'lrclib' };
      }
      const searchParams = new URLSearchParams({ track_name: title, artist_name: artist || '' });
      const results = await fetchJson(`https://lrclib.net/api/search?${searchParams}`);
      let best = null;
      let bestScore = -Infinity;
      if (Array.isArray(results)) {
        for (const entry of results) {
          const score = scoreCandidate(entry, title, artist, track.duration);
          if (score > bestScore) {
            bestScore = score;
            best = entry;
          }
        }
      }
      const lrc = best && bestScore >= 60 ? pickLrc(best) : null;
      rememberLyric(key, lrc);
      return { lrc, source: lrc ? 'lrclib' : null };
    } catch {
      return { lrc: null, source: null };
    }
  }

  function toProgressMs(snap, { resetSmooth = false } = {}) {
    const isPlaying = String(snap.state).toLowerCase() === 'playing';
    let raw = (Number(snap.position) || 0) * 1000;
    if (isPlaying) raw += (Number(snap.readLatencyMs) || 0) / 2;
    if (isPlaying && snap.sampledAtMs) raw += Math.max(0, Date.now() - snap.sampledAtMs);
    raw = Math.max(0, raw);

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

  function emitProgress(progressMs, { force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastProgressPushAt < PROGRESS_PUSH_MS) return;
    if (!force && Math.abs(progressMs - lastEmittedProgressMs) < 80) return;
    lastProgressPushAt = now;
    lastEmittedProgressMs = progressMs;
    lastProgressSample = { progressMs, paused: lastPaused, atMs: now };
    broadcast('PlayerProgress', { progress: progressMs });
  }

  function tick() {
    if (clients.size === 0) return;
    const snap = latestSnap;
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
    const changed = id !== lastTrackId || snap.title !== lastTitle || snap.artist !== lastArtist;
    const progressMs = toProgressMs(snap, { resetSmooth: changed });

    if (changed) {
      lastTrackId = id;
      lastTitle = snap.title || '';
      lastArtist = snap.artist || '';
      lastEmittedProgressMs = -1;
      lastProgressPushAt = 0;
      broadcast('PlayerProgressReplay', {});
      broadcast('Track', {
        id,
        title: snap.title || 'Now Playing',
        author: snap.artist || 'Unknown',
        album: snap.album || '',
        cover: '',
        duration: Number(snap.duration) || 0,
      });
      const key = `${id}|${Math.round(Number(snap.duration) || 0)}`;
      if (key !== lyricTrackKey) {
        lyricTrackKey = key;
        void fetchLyrics(snap).then((result) => {
          if (lyricTrackKey !== key) return;
          broadcast('Lyric', {
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
    }

    const isPaused = String(snap.state).toLowerCase() !== 'playing';
    if (isPaused !== lastPaused || changed) {
      lastPaused = isPaused;
      const durationSec = Number(snap.duration) || 0;
      broadcast('PlayerPauseState', {
        hasSong: true,
        isPaused,
        seekbarCurrentPosition: progressMs / 1000,
        statePercent: durationSec > 0 ? Math.min(1, Math.max(0, (progressMs / 1000) / durationSec)) : 0,
      });
      emitProgress(progressMs, { force: true });
      return;
    }

    if (!isPaused) emitProgress(progressMs);
    else lastProgressSample = { progressMs, paused: true, atMs: Date.now() };
  }

  async function pushSnapshotTo(client) {
    const snap = await readMusicSnapshotOnce();
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
    void fetchLyrics(snap).then((result) => {
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

  function ensureMonitorForClients() {
    if (idleStopTimer) {
      clearTimeout(idleStopTimer);
      idleStopTimer = null;
    }
    if (clients.size > 0) startMonitor();
  }

  function scheduleIdleStop() {
    if (idleStopTimer) clearTimeout(idleStopTimer);
    idleStopTimer = setTimeout(() => {
      idleStopTimer = null;
      if (clients.size === 0) {
        pauseMonitor();
        lastTrackId = null;
        lastTitle = '';
        lastArtist = '';
        lastPaused = true;
        lastEmittedProgressMs = -1;
        lastProgressSample = null;
        smoothPosMs = null;
        lyricTrackKey = '';
        info('idle: Music monitor paused');
      }
    }, IDLE_STOP_MS);
  }

  async function handleProgressQuery(res) {
    try {
      let snap = latestSnap;
      const stale = !snap.sampledAtMs || Date.now() - snap.sampledAtMs > 1500;
      if (clients.size > 0 && (!snap.ok || stale)) {
        snap = await readMusicSnapshotOnce();
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
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  function getStatus() {
    return {
      running: Boolean(server),
      port: DEFAULT_PORT,
      clients: clients.size,
      monitor: Boolean(monitorChild),
      platform: process.platform,
    };
  }

  async function start() {
    if (process.platform !== 'darwin') {
      return getStatus();
    }
    if (server || startingServer) {
      return getStatus();
    }
    startingServer = true;
    try {
      server = http.createServer((req, res) => {
        const url = req.url || '/';
        if (url === '/health' || url === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            service: 'folia-builtin-macos-music-nowplaying',
            ...getStatus(),
          }));
          return;
        }
        if (url === '/api/query/progress' || url.startsWith('/api/query/progress?')) {
          void handleProgressQuery(res);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Folia built-in macOS Music Now Playing\n');
      });

      wss = new WebSocketServer({
        server,
        path: WS_PATH,
        perMessageDeflate: false,
        maxPayload: 64 * 1024,
      });

      wss.on('connection', (socket) => {
        clients.add(socket);
        ensureMonitorForClients();
        info(`client connected (${clients.size})`);
        void pushSnapshotTo(socket);
        socket.on('close', () => {
          clients.delete(socket);
          info(`client disconnected (${clients.size})`);
          if (clients.size === 0) scheduleIdleStop();
        });
      });

      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(DEFAULT_PORT, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });

      if (!pollTimer) {
        pollTimer = setInterval(() => {
          try { tick(); } catch (error) {
            warn('poll error', error instanceof Error ? error.message : error);
          }
        }, POLL_MS);
      }

      info(`listening on ws://127.0.0.1:${DEFAULT_PORT}${WS_PATH}`);
    } catch (error) {
      warn('failed to start', error instanceof Error ? error.message : error);
      await stop();
    } finally {
      startingServer = false;
    }
    return getStatus();
  }

  async function stop() {
    if (idleStopTimer) {
      clearTimeout(idleStopTimer);
      idleStopTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pauseMonitor();
    for (const client of clients) {
      try { client.close(); } catch { /* ignore */ }
    }
    clients.clear();
    if (wss) {
      try { wss.close(); } catch { /* ignore */ }
      wss = null;
    }
    if (server) {
      const current = server;
      server = null;
      await new Promise((resolve) => {
        current.close(() => resolve());
      }).catch(() => {});
    }
    startingServer = false;
    return getStatus();
  }

  /**
   * Keep the built-in bridge running iff Stage Mode is on and source is now-playing.
   */
  async function sync({ modeEnabled, source } = {}) {
    if (process.platform !== 'darwin') {
      await stop();
      return getStatus();
    }
    const shouldRun = Boolean(modeEnabled) && source === 'now-playing';
    if (shouldRun) return start();
    return stop();
  }

  return {
    start,
    stop,
    sync,
    getStatus,
  };
}

module.exports = {
  createMacosMusicNowPlayingController,
  DEFAULT_PORT,
};
