// electron/voiceInputPause.cjs
// Watches Windows microphone capture state (system voice typing, IME voice input)
// and notifies the renderer so playback can pause and resume automatically.

const { execFile } = require('child_process');

const MICROPHONE_CONSENT_STORE_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const DEFAULT_POLL_INTERVAL_MS = 1000;
const START_CONFIRM_SAMPLES = 2;
const STOP_CONFIRM_SAMPLES = 3;
const REG_QUERY_TIMEOUT_MS = 5000;

// NonPackaged consent-store subkeys encode the exe full path with '#' separators.
function normalizeConsentStoreExePath(subKey) {
  return String(subKey || '').replace(/#/g, '\\').toLowerCase();
}

function normalizeExePath(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function isOwnProcessKey(keyPath, ownExePath) {
  const normalizedOwn = normalizeExePath(ownExePath);
  if (!normalizedOwn) {
    return false;
  }

  const nonPackagedMarker = '\\nonpackaged\\';
  const markerIndex = keyPath.toLowerCase().indexOf(nonPackagedMarker);
  if (markerIndex === -1) {
    return false;
  }

  const subKey = keyPath.slice(markerIndex + nonPackagedMarker.length);
  return normalizeConsentStoreExePath(subKey) === normalizedOwn;
}

// Parses `reg query <microphone ConsentStore> /s` output. An app is actively
// capturing when LastUsedTimeStop == 0 while LastUsedTimeStart != 0.
function parseMicrophoneConsentStoreInUse(output, ownExePath) {
  if (typeof output !== 'string' || !output.trim()) {
    return false;
  }

  const entries = [];
  let currentEntry = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (/^HKEY_/i.test(line)) {
      currentEntry = { keyPath: line, start: null, stop: null };
      entries.push(currentEntry);
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    const match = /^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-fA-F]+)/.exec(line);
    if (!match) {
      continue;
    }

    const value = BigInt(match[2]);
    if (match[1] === 'LastUsedTimeStart') {
      currentEntry.start = value;
    } else {
      currentEntry.stop = value;
    }
  }

  return entries.some((entry) => {
    if (isOwnProcessKey(entry.keyPath, ownExePath)) {
      return false;
    }

    return entry.start !== null && entry.start !== BigInt(0) && entry.stop === BigInt(0);
  });
}

function queryWindowsMicrophoneInUse(ownExePath) {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', MICROPHONE_CONSENT_STORE_KEY, '/s'],
      { timeout: REG_QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        resolve(parseMicrophoneConsentStoreInUse(stdout, ownExePath));
      }
    );
  });
}

// Polls microphone capture state while enabled and publishes `active` flips to the
// main window. Requires consecutive samples before flipping to avoid brief mic
// touches (device probes, per-sentence gaps) toggling playback.
function createVoiceInputPauseMonitor(options = {}) {
  const getMainWindow = typeof options.getMainWindow === 'function' ? options.getMainWindow : () => null;
  const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => false;
  const getOwnExePath = typeof options.getOwnExePath === 'function' ? options.getOwnExePath : () => '';
  const queryInUse = typeof options.queryInUse === 'function' ? options.queryInUse : queryWindowsMicrophoneInUse;
  const isSupported = typeof options.isSupported === 'boolean' ? options.isSupported : process.platform === 'win32';
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(200, options.pollIntervalMs) : DEFAULT_POLL_INTERVAL_MS;

  let timer = null;
  let active = false;
  let pendingSample = null;
  let confirmCount = 0;

  const publishState = () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('voice-input-state-changed', {
        active,
        enabled: isEnabled(),
        supported: isSupported,
      });
    }
  };

  const applySample = (inUse) => {
    if (inUse === active) {
      pendingSample = null;
      confirmCount = 0;
      return;
    }

    if (pendingSample !== inUse) {
      pendingSample = inUse;
      confirmCount = 1;
    } else {
      confirmCount += 1;
    }

    const neededSamples = inUse ? START_CONFIRM_SAMPLES : STOP_CONFIRM_SAMPLES;
    if (confirmCount >= neededSamples) {
      active = inUse;
      pendingSample = null;
      confirmCount = 0;
      publishState();
    }
  };

  const tick = async () => {
    try {
      const inUse = await queryInUse(getOwnExePath());
      if (typeof inUse === 'boolean') {
        applySample(inUse);
      }
    } catch (error) {
      console.warn('[VoiceInput] Microphone capture probe failed', error);
    }
  };

  const syncState = () => {
    const shouldRun = isSupported && isEnabled();

    if (shouldRun && !timer) {
      timer = setInterval(() => {
        void tick();
      }, pollIntervalMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      void tick();
    } else if (!shouldRun && timer) {
      clearInterval(timer);
      timer = null;
    }

    // Release the renderer immediately when the feature turns off mid-dictation.
    if (!shouldRun && active) {
      active = false;
      pendingSample = null;
      confirmCount = 0;
      publishState();
    }

    return getStatus();
  };

  const getStatus = () => ({
    active,
    enabled: isEnabled(),
    supported: isSupported,
  });

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    active = false;
    pendingSample = null;
    confirmCount = 0;
  };

  return {
    getStatus,
    stop,
    syncState,
  };
}

module.exports = {
  createVoiceInputPauseMonitor,
  parseMicrophoneConsentStoreInUse,
};
