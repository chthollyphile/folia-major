const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { app } = require('electron');

// electron/librespotBridge.cjs
// Spotify 本地音频内核桥接服务：基于 go-librespot 守护进程提供官方 320kbps 高清音频流播放、Spotify Connect 设备广播与播放控制

const LIBRESPOT_PORT = 3678;
const LIBRESPOT_HOST = '127.0.0.1';
const LIBRESPOT_BASE_URL = `http://${LIBRESPOT_HOST}:${LIBRESPOT_PORT}`;
const SILENT_PORT = 32112;

let librespotProcess = null;
let isShuttingDown = false;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

let silentServer = null;
let currentPlayingTrackId = null;

/** 静音载波单次分配的时长上限：duration 完全来自查询串，不封顶时一个超长值就能把内存打满 */
const SILENT_WAV_MAX_SECONDS = 3600;
/** 按秒缓存已生成的静音缓冲，最多留两份（双 deck 交叉淡入时会同时要两个时长） */
const silentWavCache = new Map();

/**
 * 取（必要时生成）指定时长的静音 WAV 缓冲。
 * 每次请求都重新分配整段缓冲的话，长曲子按 Range 分段请求会反复占几十到几百 MB。
 */
function getSilentWavBuffer(durationSec) {
  const cached = silentWavCache.get(durationSec);
  if (cached) return cached;

  const buffer = createSilentWavBuffer(durationSec);
  silentWavCache.set(durationSec, buffer);
  while (silentWavCache.size > 2) {
    silentWavCache.delete(silentWavCache.keys().next().value);
  }
  return buffer;
}

/**
 * 标准化 Spotify 曲目 URI，避免双重前缀导致 go-librespot 无法解析
 */
function normalizeSpotifyTrackUri(rawIdOrUri) {
  if (!rawIdOrUri) return '';
  const cleanId = String(rawIdOrUri).trim().replace(/^spotify:track:/i, '');
  return `spotify:track:${cleanId}`;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

/**
 * 构造用于驱动浏览器 <audio> 进度条与歌词同步的标准 44.1kHz 16-bit 单声道静音 WAV 缓冲区
 */
function createSilentWavBuffer(durationSec) {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * Math.max(1, durationSec));
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF 头
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt 子块
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data 子块
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // 16-bit PCM 零振幅中心值为 0x00，Buffer.alloc 默认为 0，提供纯净无杂音静音

  return buffer;
}

/**
 * 启动静音载波流本地 HTTP 服务，支持 HTTP 206 Partial Content 拖动进度与 CORS 预检
 */
function startSilentStreamServer() {
  if (silentServer) return;

  silentServer = http.createServer((req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (parsedUrl.pathname === '/silent.wav') {
        const id = parsedUrl.searchParams.get('id');
        const playId = parsedUrl.searchParams.get('playId') || id;
        const durationSec = Math.min(
          SILENT_WAV_MAX_SECONDS,
          Math.max(1, parseFloat(parsedUrl.searchParams.get('duration') || '180') || 180),
        );

        const totalBuffer = getSilentWavBuffer(durationSec);
        const totalSize = totalBuffer.length;

        if (req.method === 'HEAD') {
          res.writeHead(200, {
            ...CORS_HEADERS,
            'Content-Length': totalSize,
            'Content-Type': 'audio/wav',
            'Accept-Ranges': 'bytes',
          });
          res.end();
          return;
        }

        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
          const chunkSize = (end - start) + 1;

          res.writeHead(206, {
            ...CORS_HEADERS,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'audio/wav',
          });
          res.end(totalBuffer.subarray(start, end + 1));
        } else {
          res.writeHead(200, {
            ...CORS_HEADERS,
            'Content-Length': totalSize,
            'Content-Type': 'audio/wav',
            'Accept-Ranges': 'bytes',
          });
          res.end(totalBuffer);
        }
        return;
      }

      res.writeHead(404, CORS_HEADERS);
      res.end('Not Found');
    } catch (err) {
      res.writeHead(500, CORS_HEADERS);
      res.end(String(err));
    }
  });

  silentServer.listen(SILENT_PORT, '127.0.0.1', () => {
    console.log(`[Librespot] Silent audio carrier bridge listening on 127.0.0.1:${SILENT_PORT}`);
  });

  silentServer.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('[Librespot] Silent server error:', err);
    }
  });
}

/**
 * 获取 go-librespot 可执行文件路径
 */
function getLibrespotExecutablePath() {
  if (process.platform !== 'win32') {
    return null;
  }

  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'librespot', 'go-librespot.exe');
    if (app?.isPackaged && fs.existsSync(packagedPath)) {
      return packagedPath;
    }
  }

  const devPath = path.join(__dirname, '..', 'resources', 'librespot', 'go-librespot.exe');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  const scratchPath = path.join(__dirname, '..', 'scratch', 'go-librespot.exe');
  if (fs.existsSync(scratchPath)) {
    return scratchPath;
  }

  return null;
}

/**
 * 启动 go-librespot 后台守护进程与静音载波服务
 */
function startLibrespotDaemon() {
  startSilentStreamServer();

  if (librespotProcess) {
    return { success: true, running: true };
  }

  const exePath = getLibrespotExecutablePath();
  if (!exePath) {
    console.warn('[Librespot] go-librespot executable not found for platform:', process.platform);
    return { success: false, error: 'Executable not found' };
  }

  const appDataRoot = (app && typeof app.getPath === 'function')
    ? app.getPath('appData')
    : (process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'));
  const userDataRoot = (app && typeof app.getPath === 'function')
    ? app.getPath('userData')
    : path.join(appDataRoot, 'Folia');

  let configDir = path.join(userDataRoot, 'librespot');
  if (!fs.existsSync(path.join(configDir, 'state.json'))) {
    const fallbackFoliaDir = path.join(appDataRoot, 'Folia', 'librespot');
    if (fs.existsSync(path.join(fallbackFoliaDir, 'state.json'))) {
      configDir = fallbackFoliaDir;
    }
  }
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  } catch (err) {
    console.error('[Librespot] Failed to create config dir:', err);
  }

  const args = [
    '--config_dir', configDir,
    '-c', 'server.enabled=true',
    '-c', `server.port=${LIBRESPOT_PORT}`,
    '-c', `server.address=${LIBRESPOT_HOST}`,
    '-c', 'device_name=Folia Spotify',
    '-c', 'device_type=computer',
    '-c', 'zeroconf_enabled=true',
    '-c', 'credentials.type=device_auth',
    '-c', 'credentials.zeroconf.persist_credentials=true',
    '-c', 'bitrate=320',
    '-c', 'log_level=info',
  ];

  console.log('[Librespot] Spawning:', exePath, args.join(' '));
  try {
    isShuttingDown = false;
    librespotProcess = spawn(exePath, args, {
      cwd: path.dirname(exePath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    librespotProcess.stdout.on('data', (data) => {
      console.log(`[Librespot] ${data.toString().trim()}`);
    });

    librespotProcess.stderr.on('data', (data) => {
      console.log(`[Librespot] ${data.toString().trim()}`);
    });

    librespotProcess.on('exit', (code, signal) => {
      console.log(`[Librespot] Process exited with code ${code}, signal ${signal}`);
      librespotProcess = null;
      if (!isShuttingDown && restartAttempts < MAX_RESTART_ATTEMPTS) {
        restartAttempts++;
        console.log(`[Librespot] Scheduling restart attempt ${restartAttempts}...`);
        setTimeout(() => {
          if (!isShuttingDown) startLibrespotDaemon();
        }, 2000);
      }
    });

    librespotProcess.on('error', (err) => {
      console.error('[Librespot] Process error:', err);
      librespotProcess = null;
    });

    // 计数针对「连续失败」：稳定运行一段时间后清零，否则累计崩满 MAX_RESTART_ATTEMPTS 次
    // 之后，本次会话里再也不会自动拉起守护进程
    const spawnedProcess = librespotProcess;
    setTimeout(() => {
      if (!isShuttingDown && librespotProcess === spawnedProcess) restartAttempts = 0;
    }, 15000);

    return { success: true, running: true };
  } catch (err) {
    console.error('[Librespot] Failed to spawn process:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 停止 go-librespot 后台守护进程与静音载波服务
 */
function stopLibrespotDaemon() {
  isShuttingDown = true;
  currentPlayingTrackId = null;

  if (silentServer) {
    try {
      silentServer.close();
    } catch {}
    silentServer = null;
  }

  if (librespotProcess) {
    try {
      librespotProcess.kill('SIGINT');
      setTimeout(() => {
        if (librespotProcess) {
          librespotProcess.kill('SIGKILL');
          librespotProcess = null;
        }
      }, 1500);
    } catch {
      // 进程可能已退出
    }
    librespotProcess = null;
  }
}

/**
 * 查询 go-librespot 当前就绪状态与播放状态
 */
async function getLibrespotStatus() {
  try {
    const rootRes = await fetch(`${LIBRESPOT_BASE_URL}/`, { signal: AbortSignal.timeout(1000) });
    if (!rootRes.ok) return { online: false };
    const rootData = await rootRes.json();

    let playerStatus = null;
    try {
      const statusRes = await fetch(`${LIBRESPOT_BASE_URL}/status`, { signal: AbortSignal.timeout(1000) });
      if (statusRes.status === 200) {
        playerStatus = await statusRes.json();
      }
    } catch {}

    return {
      online: true,
      playbackReady: Boolean(rootData.playback_ready),
      player: playerStatus,
    };
  } catch {
    return { online: false, playbackReady: false, player: null };
  }
}

/**
 * 获取当前 device_auth 配对地址与配对码
 */
async function getLibrespotAuthCode() {
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/auth/code`, { signal: AbortSignal.timeout(1500) });
    if (res.status === 200) {
      return await res.json();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 起播或续播。同一个 playId 再次进来就是"继续播"（暂停后恢复），换了 playId 才是换曲。
 *
 * 起播必须由渲染进程在真正 onPlay 时发起：浏览器"只加载不播放"（恢复上次会话但保持暂停、
 * 或仅取元数据）同样会 GET 静音载波，在那里触发会让界面显示暂停、声音却在放。
 */
async function startLibrespotTrack(rawIdOrUri, playId) {
  const normalizedPlayId = playId ? String(playId) : '';
  if (normalizedPlayId && normalizedPlayId === currentPlayingTrackId) {
    return resumeLibrespotTrack();
  }
  currentPlayingTrackId = normalizedPlayId || null;
  return playLibrespotTrack(normalizeSpotifyTrackUri(rawIdOrUri));
}

/**
 * 调用 go-librespot 播放指定 Spotify URI 曲目
 */
async function playLibrespotTrack(spotifyUri) {
  const normalizedUri = normalizeSpotifyTrackUri(spotifyUri);
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/player/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: normalizedUri }),
      signal: AbortSignal.timeout(5000),
    });
    return { success: res.ok, status: res.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 调用 go-librespot 暂停播放
 */
async function pauseLibrespotTrack() {
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/player/pause`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 调用 go-librespot 恢复播放
 */
async function resumeLibrespotTrack() {
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/player/resume`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 调用 go-librespot 跳转播放进度
 */
async function seekLibrespotTrack(positionMs) {
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/player/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: Math.max(0, Math.round(positionMs)), relative: false }),
      signal: AbortSignal.timeout(2000),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 调用 go-librespot 设置音量 (0 - 100)
 */
async function setLibrespotVolume(volumePercent) {
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/player/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: Math.min(100, Math.max(0, Math.round(volumePercent))) }),
      signal: AbortSignal.timeout(2000),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 调用 go-librespot 停止播放
 */
async function stopLibrespotTrack() {
  currentPlayingTrackId = null;
  try {
    const res = await fetch(`${LIBRESPOT_BASE_URL}/player/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  startLibrespotDaemon,
  stopLibrespotDaemon,
  getLibrespotStatus,
  getLibrespotAuthCode,
  startLibrespotTrack,
  playLibrespotTrack,
  pauseLibrespotTrack,
  resumeLibrespotTrack,
  seekLibrespotTrack,
  setLibrespotVolume,
  stopLibrespotTrack,
};
