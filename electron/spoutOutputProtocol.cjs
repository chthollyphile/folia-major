// electron/spoutOutputProtocol.cjs
// Pure, Electron-free half of the Spout output (see spoutOutput.cjs): settings keys/defaults,
// config validation, the helper stdout JSONL parser and the frame-queue backpressure bookkeeping.
// Kept separate so it can be unit-tested headless (test/unit/electron/spoutOutput.test.ts).

// electron-store keys and defaults — SSOT is the integration contract (scratchpad
// spout-contract.md); do not rename.
const SPOUT_OUTPUT_ENABLED_SETTING_KEY = 'SPOUT_OUTPUT_ENABLED';
const SPOUT_OUTPUT_SENDER_NAME_SETTING_KEY = 'SPOUT_OUTPUT_SENDER_NAME';
const SPOUT_OUTPUT_WIDTH_SETTING_KEY = 'SPOUT_OUTPUT_WIDTH';
const SPOUT_OUTPUT_HEIGHT_SETTING_KEY = 'SPOUT_OUTPUT_HEIGHT';
const SPOUT_OUTPUT_FPS_SETTING_KEY = 'SPOUT_OUTPUT_FPS';

const SPOUT_DEFAULT_SENDER_NAME = 'Folia';
const SPOUT_DEFAULT_WIDTH = 1920;
const SPOUT_DEFAULT_HEIGHT = 1080;
const SPOUT_DEFAULT_FPS = 60;

// Resolution presets offered in the UI (contract): stored as width/height pairs.
const SPOUT_RESOLUTION_PRESETS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

const SPOUT_FPS_CHOICES = [30, 60];

// Backpressure: at most 2 frames in flight; a paint arriving with the queue full is released
// immediately (dropped) rather than queued.
const SPOUT_MAX_FRAMES_IN_FLIGHT = 2;

// Sender name limits (contract): trimmed, 1..255 bytes UTF-8.
const SPOUT_SENDER_NAME_MAX_BYTES = 255;

// fatal codes the helper can report (contract, exact strings). Mapped 1:1 into status.error.
const SPOUT_FATAL_CODES = ['name-in-use', 'd3d-init-failed', 'spout-register-failed', 'bad-args'];

const SPOUT_ERROR_HELPER_MISSING = 'helper-missing';
const SPOUT_ERROR_HELPER_CRASHED = 'helper-crashed';
const SPOUT_ERROR_UNSUPPORTED_PLATFORM = 'unsupported-platform';

// ---------------------------------------------------------------------------
// Pure helpers (no Electron imports) — unit-tested in test/unit/electron/spoutOutput.test.ts
// ---------------------------------------------------------------------------

// Normalizes a persisted sender name (see isUsableSpoutSenderName). Falls back to
// the default when the input has no usable content or is over limit.
function normalizeSpoutSenderName(value) {
  if (typeof value !== 'string') {
    return SPOUT_DEFAULT_SENDER_NAME;
  }
  const trimmed = value.trim();
  return isUsableSpoutSenderName(trimmed) ? trimmed : SPOUT_DEFAULT_SENDER_NAME;
}

// Mirrors validate_sender_name in packaging/windows/spout-sender/src/sender_names.rs: non-empty,
// at most 255 UTF-8 bytes, no NUL, and an ASCII first character. Spout receivers read the sender
// list with a signed `char` and treat a first byte >= 0x80 as the end of the list, so a name such
// as "歌词" would be invisible to OBS.
function isUsableSpoutSenderName(name) {
  return Boolean(name)
    && Buffer.byteLength(name, 'utf8') <= SPOUT_SENDER_NAME_MAX_BYTES
    && !name.includes('\0')
    && name.charCodeAt(0) < 0x80;
}

// Clamps width/height to one of the contract presets (nearest by total pixel count; exact matches
// are the normal case since the UI only offers presets).
function clampSpoutResolution(width, height) {
  const targetW = Number(width);
  const targetH = Number(height);
  if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
    return { width: SPOUT_DEFAULT_WIDTH, height: SPOUT_DEFAULT_HEIGHT };
  }
  const exact = SPOUT_RESOLUTION_PRESETS.find(
    preset => preset.width === targetW && preset.height === targetH,
  );
  if (exact) {
    return { width: exact.width, height: exact.height };
  }
  const nearest = SPOUT_RESOLUTION_PRESETS.reduce((best, preset) => {
    const bestArea = Math.abs(best.width * best.height - targetW * targetH);
    const presetArea = Math.abs(preset.width * preset.height - targetW * targetH);
    return presetArea < bestArea ? preset : best;
  });
  return { width: nearest.width, height: nearest.height };
}

// Clamps fps to the contract's two allowed values (default 60).
function clampSpoutFps(fps) {
  return fps === 30 ? 30 : 60;
}

// Validates a config patch coming over IPC. Returns { patch } with only the recognized keys,
// normalized/clamped, or { error } describing the first invalid key. `enabled` must be a real
// boolean when present; senderName must pass isUsableSpoutSenderName after trimming.
function validateSpoutConfigPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'bad-args' };
  }
  const patch = {};
  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') {
      return { error: 'bad-args' };
    }
    patch.enabled = raw.enabled;
  }
  if ('senderName' in raw) {
    if (typeof raw.senderName !== 'string') {
      return { error: 'bad-args' };
    }
    const trimmed = raw.senderName.trim();
    if (!isUsableSpoutSenderName(trimmed)) {
      return { error: 'bad-args' };
    }
    patch.senderName = trimmed;
  }
  if ('width' in raw && 'height' in raw) {
    if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height)) {
      return { error: 'bad-args' };
    }
    const preset = SPOUT_RESOLUTION_PRESETS.find(
      candidate => candidate.width === raw.width && candidate.height === raw.height,
    );
    if (!preset) {
      return { error: 'bad-args' };
    }
    patch.width = preset.width;
    patch.height = preset.height;
  } else if ('width' in raw || 'height' in raw) {
    // Resolution is a pair; half a pair would silently desync the stored preset.
    return { error: 'bad-args' };
  }
  if ('fps' in raw) {
    if (raw.fps !== 30 && raw.fps !== 60) {
      return { error: 'bad-args' };
    }
    patch.fps = raw.fps;
  }
  return { patch };
}

// Pure JSONL line parser for helper stdout events (contract § stdout events). Returns the typed
// event object for well-formed lines, null otherwise — side-effect free for direct unit testing.
function parseSpoutHelperLine(line) {
  if (typeof line !== 'string' || line.trim() === '') {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  switch (parsed.type) {
    case 'ready':
      return typeof parsed.senderName === 'string' && parsed.senderName
        ? { type: 'ready', senderName: parsed.senderName }
        : null;
    case 'done':
      return Number.isInteger(parsed.id) && parsed.id >= 0 && parsed.id <= 0xffffffff
        ? { type: 'done', id: parsed.id }
        : null;
    case 'frameError':
      return Number.isInteger(parsed.id) && parsed.id >= 0 && parsed.id <= 0xffffffff
        ? { type: 'frameError', id: parsed.id, message: String(parsed.message ?? '') }
        : null;
    case 'fatal':
      return SPOUT_FATAL_CODES.includes(parsed.code)
        ? { type: 'fatal', code: parsed.code, message: String(parsed.message ?? '') }
        : null;
    default:
      return null;
  }
}

// Pure frame-queue / backpressure bookkeeping. The queue tracks frames handed to the helper and
// awaiting their terminal ack (`done` / `frameError`). Textures are owned by the caller; the queue
// only decides WHEN to release (drop / ack / release-all) so that decision logic is testable.
//
//   const queue = createSpoutFrameQueue({ maxInFlight: 2, releaseFrame });
//   const verdict = queue.offer(frame);       // 'sent' | 'dropped' (dropped ⇒ caller's release
//                                            //  callback already ran for that frame)
//   queue.ack(id);                            // resolves done/frameError; releases that texture
//   queue.releaseAll();                       // helper died: releases every pending texture
//   queue.pendingCount / queue.inFlightCount
function createSpoutFrameQueue({ maxInFlight = SPOUT_MAX_FRAMES_IN_FLIGHT, releaseFrame } = {}) {
  if (typeof releaseFrame !== 'function') {
    throw new Error('createSpoutFrameQueue requires a releaseFrame callback');
  }
  let nextFrameId = 1;
  // Insertion-ordered map: frame id -> { frame, command }. The helper acks frames in order, but a
  // defensive by-id lookup (not shift-only) keeps a misbehaving helper from wedging the queue.
  const inFlight = new Map();

  // Builds the JSON `frame` command line for a texture info, per the contract. `handleValue` is
  // the decimal-string u64 read off textureInfo.handle.ntHandle.readBigUInt64LE(0).
  function buildFrameCommand(entry) {
    const { textureInfo } = entry.frame;
    return JSON.stringify({
      type: 'frame',
      id: entry.id,
      handle: entry.frame.handleString,
      codedWidth: textureInfo.codedSize.width,
      codedHeight: textureInfo.codedSize.height,
      x: textureInfo.visibleRect.x,
      y: textureInfo.visibleRect.y,
      width: textureInfo.visibleRect.width,
      height: textureInfo.visibleRect.height,
      format: entry.frame.format,
    });
  }

  return {
    get inFlightCount() {
      return inFlight.size;
    },
    // Registers a frame and returns 'sent' plus the JSON command line to write to the helper's
    // stdin, or 'dropped' when the in-flight budget is exhausted (the texture is released
    // immediately in that case — dropping is the whole point of backpressure).
    offer(frame) {
      if (inFlight.size >= maxInFlight) {
        releaseFrame(frame);
        return { verdict: 'dropped', command: null };
      }
      const id = nextFrameId;
      // u32 ids per the contract; wrap past 2^32-1 (ids only need uniqueness among in-flight
      // frames, and 4 billion frames at 60fps is ~2.3 years of uptime).
      nextFrameId = nextFrameId >= 0xffffffff ? 1 : nextFrameId + 1;
      const entry = { id, frame };
      inFlight.set(id, entry);
      return { verdict: 'sent', command: buildFrameCommand(entry) };
    },
    // Terminal ack (done or frameError) for one frame id. Returns the acked id, or null when the
    // id is unknown (already acked, or a frame that was dropped). Releases the texture.
    ack(id) {
      const entry = inFlight.get(id);
      if (!entry) {
        return null;
      }
      inFlight.delete(id);
      releaseFrame(entry.frame);
      return id;
    },
    // Helper is gone: release every texture still pending. Returns how many were released.
    releaseAll() {
      const count = inFlight.size;
      for (const entry of inFlight.values()) {
        releaseFrame(entry.frame);
      }
      inFlight.clear();
      return count;
    },
  };
}

module.exports = {
  SPOUT_OUTPUT_ENABLED_SETTING_KEY,
  SPOUT_OUTPUT_SENDER_NAME_SETTING_KEY,
  SPOUT_OUTPUT_WIDTH_SETTING_KEY,
  SPOUT_OUTPUT_HEIGHT_SETTING_KEY,
  SPOUT_OUTPUT_FPS_SETTING_KEY,
  SPOUT_DEFAULT_SENDER_NAME,
  SPOUT_DEFAULT_WIDTH,
  SPOUT_DEFAULT_HEIGHT,
  SPOUT_DEFAULT_FPS,
  SPOUT_RESOLUTION_PRESETS,
  SPOUT_FPS_CHOICES,
  SPOUT_MAX_FRAMES_IN_FLIGHT,
  SPOUT_FATAL_CODES,
  SPOUT_ERROR_HELPER_MISSING,
  SPOUT_ERROR_HELPER_CRASHED,
  SPOUT_ERROR_UNSUPPORTED_PLATFORM,
  normalizeSpoutSenderName,
  isUsableSpoutSenderName,
  clampSpoutResolution,
  clampSpoutFps,
  validateSpoutConfigPatch,
  parseSpoutHelperLine,
  createSpoutFrameQueue,
};
