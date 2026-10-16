'use strict';

const net = require('net');
const nodeFs = require('fs');
const nodePath = require('path');
const { spawn: nodeSpawn } = require('child_process');

// electron/nowPlayingLauncher.cjs
// 舞台来源选为 Now Playing 时，自动在后台启动本机的 Now Playing（now-playing-service）。
// 从 main.cjs 抽出来，是为了不启动 Electron 也能单测；spawn、fs、端口探测都可以注入。
//
// - 只在 Windows 上提供：Now Playing 只发布 Windows 版本。
// - 可执行文件路径只能经主进程的文件选择框写入（见 main.cjs），渲染进程不能传任意路径来执行。
// - 启动前先探测 Now Playing 的端口，已经在运行就不再启动；刚启动过的一段时间内也不重复启动，
//   因为 Now Playing 是 Java 程序，进程起来到端口开始监听之间有几秒空档。
// - 以 detached 方式启动并 unref，Folia 退出时不结束它：用户可能还在别处使用 Now Playing。

const NOW_PLAYING_PORT = 9863;
const NOW_PLAYING_PROBE_TIMEOUT_MS = 600;
const NOW_PLAYING_RELAUNCH_GUARD_MS = 30_000;

/** 探测本机 Now Playing 端口是否已有服务在监听。 */
const probeNowPlayingPort = ({ host = '127.0.0.1', port = NOW_PLAYING_PORT, timeoutMs = NOW_PLAYING_PROBE_TIMEOUT_MS } = {}) => (
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  })
);

/** 只接受存在的 .exe 文件；返回规范化后的绝对路径，否则返回 null。 */
const resolveNowPlayingExecutablePath = (candidate, fs = nodeFs, path = nodePath) => {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const resolved = path.resolve(candidate.trim());
  if (path.extname(resolved).toLowerCase() !== '.exe') return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
};

/**
 * 创建启动器。`shouldLaunch` 由调用方给出「当前是否需要 Now Playing」（舞台模式开启且来源是 Now Playing），
 * 启动器只负责开关、路径、去重和真正的启动。
 */
const createNowPlayingLauncher = ({
  store,
  enabledSettingKey,
  executablePathSettingKey,
  shouldLaunch,
  platform = process.platform,
  spawn = nodeSpawn,
  fs = nodeFs,
  path = nodePath,
  probe = probeNowPlayingPort,
  now = () => Date.now(),
  logger = console,
}) => {
  const supported = platform === 'win32';
  let lastLaunchAt = 0;
  let lastError = null;
  let launching = null;

  const getExecutablePath = () => {
    const stored = store.get(executablePathSettingKey);
    return typeof stored === 'string' && stored ? stored : null;
  };

  const isEnabled = () => supported && Boolean(store.get(enabledSettingKey));

  const getStatus = () => ({
    supported,
    enabled: isEnabled(),
    executablePath: getExecutablePath(),
    lastError,
  });

  const launch = async () => {
    const executablePath = resolveNowPlayingExecutablePath(getExecutablePath(), fs, path);
    if (!executablePath) {
      lastError = 'missing-executable';
      return 'missing-executable';
    }

    if (await probe()) {
      lastError = null;
      return 'already-running';
    }

    if (now() - lastLaunchAt < NOW_PLAYING_RELAUNCH_GUARD_MS) {
      return 'recently-launched';
    }

    try {
      const child = spawn(executablePath, [], {
        cwd: path.dirname(executablePath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      // spawn 失败（文件被删、无权限）以异步 error 事件报告；不监听会变成未捕获异常。
      child.once?.('error', (error) => {
        lastError = 'spawn-failed';
        logger.error?.('[NowPlaying] Failed to launch Now Playing.', error);
      });
      child.unref?.();
      lastLaunchAt = now();
      lastError = null;
      logger.log?.(`[NowPlaying] Launched ${executablePath}.`);
      return 'launched';
    } catch (error) {
      lastError = 'spawn-failed';
      logger.error?.('[NowPlaying] Failed to launch Now Playing.', error);
      return 'spawn-failed';
    }
  };

  /** 条件都满足时启动 Now Playing；并发调用共用同一次启动。返回本次结果，不需要启动时返回 'skipped'。 */
  const ensureRunning = async () => {
    if (!isEnabled() || !shouldLaunch()) return 'skipped';
    if (!launching) {
      launching = launch().finally(() => {
        launching = null;
      });
    }
    return launching;
  };

  const setEnabled = async (enabled) => {
    if (!supported) return getStatus();
    store.set(enabledSettingKey, Boolean(enabled));
    if (!enabled) lastError = null;
    await ensureRunning();
    return getStatus();
  };

  /** 写入经主进程文件选择框选出的路径；无效路径不写入。 */
  const setExecutablePath = async (candidate) => {
    if (!supported) return getStatus();
    const executablePath = resolveNowPlayingExecutablePath(candidate, fs, path);
    if (!executablePath) {
      lastError = 'invalid-executable';
      return getStatus();
    }
    store.set(executablePathSettingKey, executablePath);
    lastError = null;
    await ensureRunning();
    return getStatus();
  };

  return {
    getStatus,
    ensureRunning,
    setEnabled,
    setExecutablePath,
  };
};

module.exports = {
  NOW_PLAYING_PORT,
  NOW_PLAYING_RELAUNCH_GUARD_MS,
  probeNowPlayingPort,
  resolveNowPlayingExecutablePath,
  createNowPlayingLauncher,
};
