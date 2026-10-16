import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONITOR_SCRIPT = path.join(SCRIPT_DIR, 'musicMonitor.applescript');
const ONESHOT_SCRIPT = path.join(SCRIPT_DIR, 'music.applescript');

/** Cap stderr/stdout parse buffer so a stuck stream cannot grow forever. */
const MAX_BUFFER = 8 * 1024;

/**
 * @typedef {{
 *   ok: boolean,
 *   reason?: string,
 *   state?: string,
 *   hasSong?: boolean,
 *   id?: string,
 *   title?: string,
 *   artist?: string,
 *   album?: string,
 *   duration?: number,
 *   position?: number,
 *   sampledAtMs?: number,
 *   readLatencyMs?: number,
 * }} MusicSnapshot
 */

/** @type {MusicSnapshot} */
let latest = { ok: false, reason: 'idle', sampledAtMs: 0, readLatencyMs: 0 };
/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
let buffer = '';
let restartTimer = null;
let starting = false;
/** When false, monitor stays down to save RAM/CPU (no Folia clients). */
let wantRunning = false;

function remember(snap) {
  latest = {
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
    readLatencyMs: 0,
  };
}

function stopMonitor() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    child.removeAllListeners();
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    // Hard-kill if AppleScript ignores SIGTERM.
    const proc = child;
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }, 800);
    child = null;
  }
  buffer = '';
}

function scheduleRestart() {
  if (!wantRunning || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (wantRunning) startMonitor();
  }, 1200);
}

export function startMonitor() {
  wantRunning = true;
  if (child || starting) return;
  starting = true;
  try {
    const proc = spawn('osascript', [MONITOR_SCRIPT], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = proc;
    buffer = '';

    const onChunk = (chunk) => {
      buffer += String(chunk);
      if (buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(-Math.floor(MAX_BUFFER / 2));
      }
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        const jsonStart = line.indexOf('{');
        if (jsonStart > 0) line = line.slice(jsonStart);
        if (!line.startsWith('{')) continue;
        try {
          remember(JSON.parse(line));
        } catch {
          // ignore malformed line
        }
      }
    };

    proc.stderr?.on('data', onChunk);
    proc.on('exit', () => {
      child = null;
      starting = false;
      buffer = '';
      if (wantRunning) scheduleRestart();
    });
    proc.on('error', () => {
      child = null;
      starting = false;
      buffer = '';
      if (wantRunning) scheduleRestart();
    });
  } finally {
    starting = false;
  }
}

/** Stop the AppleScript monitor to free RAM when nobody is connected. */
export function pauseMonitor() {
  wantRunning = false;
  stopMonitor();
  latest = { ...latest, reason: 'idle' };
}

export function stopMusicMonitor() {
  wantRunning = false;
  stopMonitor();
}

export function isMonitorRunning() {
  return Boolean(child);
}

/** Latest cached snapshot from the persistent monitor (non-blocking). */
export function getCachedMusicSnapshot() {
  return latest;
}

/** One-shot fallback when monitor is idle / cold. */
export async function readMusicSnapshot() {
  if (latest.ok && latest.sampledAtMs && Date.now() - latest.sampledAtMs < 1200) {
    return latest;
  }

  try {
    const started = Date.now();
    const { stdout, stderr } = await execFileAsync('osascript', [ONESHOT_SCRIPT], {
      timeout: 4000,
      maxBuffer: 64 * 1024,
    });
    const text = String(stdout || stderr || '').trim();
    const jsonStart = text.indexOf('{');
    const payload = jsonStart >= 0 ? text.slice(jsonStart) : text;
    if (!payload) {
      return { ok: false, reason: 'empty', sampledAtMs: Date.now(), readLatencyMs: Date.now() - started };
    }
    const snap = JSON.parse(payload);
    const readLatencyMs = Date.now() - started;
    remember(snap);
    latest.readLatencyMs = readLatencyMs;
    return latest;
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      sampledAtMs: Date.now(),
      readLatencyMs: 0,
    };
  }
}
