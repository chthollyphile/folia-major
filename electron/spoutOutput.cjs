// electron/spoutOutput.cjs
// Windows-only Spout2 output: publishes the existing OBS overlay page as a Spout2 sender.
//
// Electron renders the token-protected OBS overlay URL in a hidden offscreen BrowserWindow with
// `webPreferences.offscreen.useSharedTexture: true`; every paint event yields an
// OffscreenSharedTexture whose NT HANDLE is local to the MAIN process. The native helper
// folia-spout-sender.exe (packaging/windows/spout-sender, built by another lane) duplicates that
// handle into itself, opens it on D3D11 and copies it into its own Spout shared texture. Electron
// calls texture.release() only after the helper acks the frame (done / frameError / shutdown), so
// the handle stays valid for the helper's whole copy — never released early, never leaked.
//
// The pure half (settings keys, validation, line parser, frame queue) lives in
// spoutOutputProtocol.cjs. All side effects (spawn, window, store, stdout wiring) are injected.


const path = require('path');
const fs = require('fs');
const {
  SPOUT_OUTPUT_ENABLED_SETTING_KEY,
  SPOUT_OUTPUT_SENDER_NAME_SETTING_KEY,
  SPOUT_OUTPUT_WIDTH_SETTING_KEY,
  SPOUT_OUTPUT_HEIGHT_SETTING_KEY,
  SPOUT_OUTPUT_FPS_SETTING_KEY,
  SPOUT_MAX_FRAMES_IN_FLIGHT,
  SPOUT_ERROR_HELPER_MISSING,
  SPOUT_ERROR_HELPER_CRASHED,
  SPOUT_ERROR_UNSUPPORTED_PLATFORM,
  normalizeSpoutSenderName,
  clampSpoutResolution,
  clampSpoutFps,
  validateSpoutConfigPatch,
  parseSpoutHelperLine,
  createSpoutFrameQueue,
} = require('./spoutOutputProtocol.cjs');

// ---------------------------------------------------------------------------
// Controller (Electron side effects injected) — created from main.cjs
// ---------------------------------------------------------------------------

// The helper ships as resources/folia-spout-sender.exe (packaging/windows/spout-sender).
// FOLIA_SPOUT_SENDER_PATH overrides it for non-packaged (dev) runs, mirroring
// FOLIA_WALLPAPER_HELPER_PATH in main.cjs. A missing binary reports error 'helper-missing'.
function resolveSpoutSenderPath({ env = process.env, resourcesPath = process.resourcesPath, existsSync = fs.existsSync }) {
  const override = env.FOLIA_SPOUT_SENDER_PATH;
  if (override) {
    return existsSync(override) ? override : null;
  }
  const candidate = path.join(resourcesPath, 'folia-spout-sender.exe');
  return existsSync(candidate) ? candidate : null;
}

// Creates the Spout output controller. Side effects are injected (BrowserWindow, spawn, store,
// stdout wiring) so the state machine stays describable; main.cjs owns the wiring.
//
// deps:
//   store — electron-store instance (settings persistence)
//   BrowserWindow — Electron BrowserWindow class
//   getOverlayUrl — () => string | null; the token-protected OBS overlay URL
//   ensureOverlayServer — () => Promise<void>; resolves once the overlay HTTP server is listening
//   isSupportedPlatform — () => boolean (process.platform === 'win32' at the call site)
//   onStatusChange — () => void; main.cjs broadcasts + persists the rebuilt status
//   spawnFn, existsSync, env, resourcesPath, processPid — injectable for tests
function createSpoutOutputController(deps) {
  const {
    store,
    BrowserWindow,
    getOverlayUrl,
    ensureOverlayServer = async () => {},
    isSupportedPlatform = () => process.platform === 'win32',
    onStatusChange,
    spawnFn = require('child_process').spawn,
    existsSync = fs.existsSync,
    env = process.env,
    resourcesPath = process.resourcesPath,
    processPid = process.pid,
    logWarn = console.warn.bind(console),
    logError = console.error.bind(console),
    createFrameQueue = createSpoutFrameQueue,
  } = deps;

  const supported = isSupportedPlatform();
  let helperProcess = null;
  let overlayWindow = null;
  let frameQueue = null;
  let running = false; // helper reported ready and the window is painting
  let error = null;

  // --- settings read/write -------------------------------------------------

  function readEnabled() {
    return store.get(SPOUT_OUTPUT_ENABLED_SETTING_KEY) === true;
  }

  function readConfig() {
    const resolution = clampSpoutResolution(
      store.get(SPOUT_OUTPUT_WIDTH_SETTING_KEY),
      store.get(SPOUT_OUTPUT_HEIGHT_SETTING_KEY),
    );
    return {
      senderName: normalizeSpoutSenderName(store.get(SPOUT_OUTPUT_SENDER_NAME_SETTING_KEY)),
      width: resolution.width,
      height: resolution.height,
      fps: clampSpoutFps(store.get(SPOUT_OUTPUT_FPS_SETTING_KEY)),
    };
  }

  function buildStatus() {
    return {
      supported,
      enabled: readEnabled(),
      running,
      ...readConfig(),
      error,
    };
  }

  function emitStatus() {
    try {
      onStatusChange?.(buildStatus());
    } catch (err) {
      logError('[Spout] status listener failed', err);
    }
  }

  // --- teardown --------------------------------------------------------------

  // Releases every texture still held for the helper. Call before the helper goes away or the
  // window is destroyed — a texture released after its owning window dies is a leaked GPU handle.
  function releasePendingFrames() {
    if (frameQueue) {
      frameQueue.releaseAll();
    }
  }

  function destroyOverlayWindow() {
    releasePendingFrames();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
    }
    overlayWindow = null;
  }

  function stopHelper() {
    releasePendingFrames();
    if (!helperProcess) {
      return;
    }
    const child = helperProcess;
    helperProcess = null;
    // Graceful stop first: {"type":"stop"} makes the helper unregister the sender and exit 0.
    // Kill after a grace delay in case the helper is wedged; it also self-exits on stdin EOF and
    // when the parent pid dies, so every path converges on the process going away.
    try {
      child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
      child.stdin.end();
    } catch {
      // stdin may already be gone (helper crashed); the exit handler owns the rest.
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already dead
      }
    }, 3000);
    child.once('exit', () => clearTimeout(killTimer));
  }

  // Full teardown of one session. `nextError` becomes the reported status error (null on a clean,
  // user-initiated disable — an intentional stop is not a failure).
  function teardown({ nextError = null } = {}) {
    stopHelper();
    destroyOverlayWindow();
    frameQueue = null;
    running = false;
    error = nextError;
    emitStatus();
  }

  // --- helper stdout events ----------------------------------------------------

  function handleHelperEvent(event) {
    if (!event) {
      return;
    }
    switch (event.type) {
      case 'ready':
        running = true;
        error = null;
        emitStatus();
        break;
      case 'done':
      case 'frameError':
        // Both are terminal acks for the frame id; the queue releases the texture either way and
        // the helper keeps running after a frameError (contract).
        if (event.type === 'frameError') {
          logWarn('[Spout] helper could not copy frame', event.id, event.message);
        }
        frameQueue?.ack(event.id);
        break;
      case 'fatal':
        logError('[Spout] helper fatal:', event.code, event.message);
        teardown({ nextError: event.code });
        break;
      default:
        break;
    }
  }

  // Buffers partial lines off the helper's stdout (events are '\n'-terminated JSON, but reads are
  // not line-aligned).
  function createStdoutLineReader(onLine) {
    let buffer = '';
    return (chunk) => {
      if (!chunk) {
        return;
      }
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const event = parseSpoutHelperLine(line);
        if (event) {
          onLine(event);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    };
  }

  // --- session start --------------------------------------------------------

  function start() {
    if (!supported) {
      error = SPOUT_ERROR_UNSUPPORTED_PLATFORM;
      emitStatus();
      return;
    }
    if (helperProcess || overlayWindow) {
      return;
    }

    const config = readConfig();
    const overlayUrl = getOverlayUrl();
    if (!overlayUrl) {
      // The OBS overlay server/token could not be produced; the main-process wiring guarantees the
      // server runs while Spout is enabled, so this is an unexpected internal state.
      logError('[Spout] no OBS overlay URL available; cannot start');
      teardown({ nextError: SPOUT_ERROR_HELPER_CRASHED });
      return;
    }

    const senderPath = resolveSpoutSenderPath({ env, resourcesPath, existsSync });
    if (!senderPath) {
      logWarn('[Spout] folia-spout-sender.exe not found (set FOLIA_SPOUT_SENDER_PATH for dev runs)');
      error = SPOUT_ERROR_HELPER_MISSING;
      emitStatus();
      return;
    }

    // Hidden offscreen window: paints into GPU shared textures (no visible surface), transparent
    // so the alpha channel survives into Spout. backgroundThrottling must stay off or Chromium
    // stops painting an invisible window entirely.
    try {
      overlayWindow = new BrowserWindow({
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        width: config.width,
        height: config.height,
        backgroundThrottling: false,
        webPreferences: {
          offscreen: { useSharedTexture: true },
          // The overlay page is the app's own token-protected read-only surface; no node access.
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
    } catch (err) {
      logError('[Spout] failed to create the offscreen overlay window', err);
      teardown({ nextError: SPOUT_ERROR_HELPER_CRASHED });
      return;
    }

    frameQueue = createFrameQueue({
      maxInFlight: SPOUT_MAX_FRAMES_IN_FLIGHT,
      releaseFrame: (frame) => {
        // Release exactly once per texture; a double release would be as bad as a leak.
        if (frame?.texture && !frame.released) {
          frame.released = true;
          try {
            frame.texture.release();
          } catch (err) {
            logWarn('[Spout] texture release failed', err);
          }
        }
      },
    });

    overlayWindow.webContents.on('paint', (_event, dirty, frame) => {
      if (!frame?.textureInfo) {
        return;
      }
      const textureInfo = frame.textureInfo;
      const handleBuffer = textureInfo.handle?.ntHandle;
      if (!helperProcess || !frameQueue || !handleBuffer || handleBuffer.length < 8) {
        // Nothing to hand the texture to (startup race, teardown, or no NT handle). Chromium only
        // keeps a small pool of shared textures, so an unreleased one would stall painting.
        try {
          frame.texture?.release();
        } catch (err) {
          logWarn('[Spout] texture release failed', err);
        }
        return;
      }
      // The NT HANDLE is a u64 local to this (main) process; sent as a decimal string because it
      // does not fit a JS number safely (contract).
      const spoutFrame = {
        texture: frame.texture,
        textureInfo,
        handleString: handleBuffer.readBigUInt64LE(0).toString(),
        // Electron is asked for BGRA (the helper's Spout texture is DXGI B8G8R8A8_UNORM); rgba
        // would only appear if Chromium ignored the request, and the helper documents that case.
        format: textureInfo.pixelFormat === 'rgba' ? 'rgba' : 'bgra',
        released: false,
      };
      const { verdict, command } = frameQueue.offer(spoutFrame);
      if (verdict === 'sent' && command) {
        try {
          helperProcess.stdin.write(command + '\n');
        } catch (err) {
          // Helper stdin died mid-frame; the queue entry is released by the exit path's
          // releaseAll — never release here, the helper may still be copying.
          logWarn('[Spout] failed to write frame command', err);
        }
      }
      // verdict === 'dropped': the queue already released the texture (backpressure drop).
    });

    overlayWindow.webContents.once('did-finish-load', () => {
      overlayWindow?.webContents.setFrameRate(config.fps);
    });

    overlayWindow.on('closed', () => {
      overlayWindow = null;
    });

    try {
      helperProcess = spawnFn(
        senderPath,
        ['--name', config.senderName, '--parent-pid', String(processPid)],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (err) {
      logError('[Spout] failed to spawn folia-spout-sender', err);
      teardown({ nextError: SPOUT_ERROR_HELPER_MISSING });
      return;
    }

    const readStdoutLine = createStdoutLineReader(handleHelperEvent);
    helperProcess.stdout.on('data', (chunk) => readStdoutLine(chunk.toString('utf8')));
    helperProcess.stderr.on('data', (chunk) => {
      // Free-form logs; surfaced at debug level only.
      logWarn('[Spout:helper]', String(chunk).trimEnd());
    });
    helperProcess.on('error', (err) => {
      logError('[Spout] helper spawn/pipe error', err);
      teardown({ nextError: SPOUT_ERROR_HELPER_MISSING });
    });
    helperProcess.on('exit', (code, signal) => {
      // Expected on a clean stop (we cleared helperProcess in stopHelper first); an unexpected
      // exit while we still believe we own a session is a crash.
      if (!helperProcess) {
        return;
      }
      helperProcess = null;
      logWarn('[Spout] helper exited unexpectedly', { code, signal });
      teardown({ nextError: SPOUT_ERROR_HELPER_CRASHED });
    });

    running = false;
    error = null;
    // The overlay server may still be binding (Spout can be the only reason it runs), so wait for
    // it before loading; a teardown in the meantime leaves overlayWindow null and skips the load.
    const windowForSession = overlayWindow;
    Promise.resolve()
      .then(() => ensureOverlayServer())
      .then(() => {
        if (overlayWindow === windowForSession && !windowForSession.isDestroyed()) {
          return windowForSession.loadURL(overlayUrl);
        }
        return undefined;
      })
      .catch((err) => {
        logError('[Spout] failed to load the OBS overlay URL', err);
        if (overlayWindow === windowForSession) {
          teardown({ nextError: SPOUT_ERROR_HELPER_CRASHED });
        }
      });
    emitStatus();
  }

  // --- public surface ---------------------------------------------------------

  return {
    getStatus: buildStatus,
    isEnabled: readEnabled,
    // Applies a validated patch ({ senderName?, width+height?, fps?, enabled? }) and reconciles
    // the running session: enable/disable starts/stops it; any config change restarts it so name,
    // resolution and fps always match what is stored.
    applyConfig(patch) {
      if (Object.prototype.hasOwnProperty.call(patch, 'senderName')) {
        store.set(SPOUT_OUTPUT_SENDER_NAME_SETTING_KEY, patch.senderName);
      }
      if (patch.width !== undefined && patch.height !== undefined) {
        store.set(SPOUT_OUTPUT_WIDTH_SETTING_KEY, patch.width);
        store.set(SPOUT_OUTPUT_HEIGHT_SETTING_KEY, patch.height);
      }
      if (patch.fps !== undefined) {
        store.set(SPOUT_OUTPUT_FPS_SETTING_KEY, patch.fps);
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
        store.set(SPOUT_OUTPUT_ENABLED_SETTING_KEY, patch.enabled);
      }
      const isEnabled = readEnabled();

      const configChanged = Boolean(
        patch.senderName !== undefined
        || patch.width !== undefined
        || patch.height !== undefined
        || patch.fps !== undefined,
      );

      if (!isEnabled) {
        if (helperProcess || overlayWindow) {
          teardown({ nextError: null });
        } else {
          error = null;
          emitStatus();
        }
      } else {
        const hasSession = Boolean(helperProcess || overlayWindow);
        // Start when there is no session yet (fresh enable, or startup reconciliation of a stored
        // enabled toggle); restart an existing session only when a config value actually changed,
        // so a no-op patch never bounces the helper.
        if (!hasSession) {
          start();
        } else if (configChanged) {
          teardown({ nextError: null });
          start();
        } else {
          emitStatus();
        }
      }
      return buildStatus();
    },
    // App quit (before-quit / will-quit): window and helper teardown without status broadcasts —
    // the renderer is going away with us.
    dispose() {
      stopHelper();
      destroyOverlayWindow();
      frameQueue = null;
      running = false;
    },
  };
}

module.exports = {
  resolveSpoutSenderPath,
  createSpoutOutputController,
  validateSpoutConfigPatch,
};
