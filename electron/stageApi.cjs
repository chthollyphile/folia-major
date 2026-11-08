const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Busboy = require('busboy');
const { WebSocket, WebSocketServer } = require('ws');
const { finished } = require('stream/promises');
const { createStageConnectionFile } = require('./stageConnectionFile.cjs');
const { createStageLyricsInput } = require('./stageLyricsInput.cjs');

// Stage API server for desktop-local integrations. External tools can push
// one parser-compatible lyrics session, push one media session, or ask Folia
// to search/play songs.

const fsp = fs.promises;
const STAGE_JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const STAGE_MULTIPART_FIELD_LIMIT_BYTES = 2 * 1024 * 1024;
const STAGE_MULTIPART_FILE_LIMIT_BYTES = 1024 * 1024 * 1024;
const STAGE_MULTIPART_FILE_COUNT_LIMIT = 3;
const STAGE_MULTIPART_PART_COUNT_LIMIT = 10;
const STAGE_MULTIPART_FIELD_COUNT_LIMIT = 10;
const STAGE_SESSION_RETENTION_LIMIT = 12;
const STAGE_PLAY_REQUEST_TIMEOUT_MS = 15_000;
const STAGE_PLAYER_REQUEST_TIMEOUT_MS = 10_000;
const STAGE_PLAYER_QUEUE_DEFAULT_LIMIT = 100;
const STAGE_PLAYER_QUEUE_MAX_LIMIT = 500;
const STAGE_LYRICS_FORMAT_VALUES = new Set(['lrc', 'enhanced-lrc', 'vtt', 'yrc', 'qrc']);
const STAGE_INPUT_METADATA = Object.freeze({
  domain: 'stage-input',
  direction: 'outside-in',
});
const STAGE_PLAYER_INSIDE_OUT_METADATA = Object.freeze({
  domain: 'player-playback',
  direction: 'inside-out',
});
const STAGE_PLAYER_OUTSIDE_IN_METADATA = Object.freeze({
  domain: 'player-playback',
  direction: 'outside-in',
});
const STAGE_PLAYER_CONTEXT_VALUES = new Set(['normal-playback', 'stage-session', 'external-playback-source']);
const STAGE_PLAYER_STATE_VALUES = new Set(['IDLE', 'PLAYING', 'PAUSED']);
const STAGE_PLAYER_CONTROL_ACTION_CAPABILITIES = {
  next: 'next',
  prev: 'previous',
  pause: 'pause',
  resume: 'resume',
  seek: 'seek',
};
const STAGE_PLAYER_QUEUE_ACTION_CAPABILITIES = {
  append: 'append',
  'insert-next': 'insertNext',
  remove: 'remove',
  move: 'move',
  select: 'select',
  clear: 'clear',
};

class StageApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StageApiError';
    this.statusCode = details.statusCode || 400;
    this.code = details.code || 'STAGE_API_ERROR';
    this.details = details.details || null;
  }
}

const normalizeStageText = (value) => (typeof value === 'string' ? value.trim() : '');

// A bare numeric songId names a song of the local music service, as it always has.
const STAGE_DEFAULT_SONG_PROVIDER_ID = 'netease';
// An omni provider id: a built-in one or a mod's (`folium.<modid>.<name>`).
const STAGE_PROVIDER_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const STAGE_SONG_REF_ID_MAX_LENGTH = 256;

const isStageProviderId = (value) => typeof value === 'string' && STAGE_PROVIDER_ID_PATTERN.test(value);

const buildStageSongRef = (providerId, songId) => `${providerId}:${songId}`;

// Reads a Stage song reference: a positive integer (or a string of one) is a song of the local
// service; `<provider>:<songId>` is a song at that omni provider. null for neither.
const parseStageSongRef = (value) => {
  if (typeof value === 'string' && value.includes(':')) {
    const text = value.trim();
    const separatorIndex = text.indexOf(':');
    const providerId = text.slice(0, separatorIndex);
    const rawSongId = text.slice(separatorIndex + 1).trim();
    if (!isStageProviderId(providerId) || !rawSongId || rawSongId.length > STAGE_SONG_REF_ID_MAX_LENGTH) {
      return null;
    }
    if (providerId !== STAGE_DEFAULT_SONG_PROVIDER_ID) {
      return { providerId, songId: rawSongId, songRef: buildStageSongRef(providerId, rawSongId) };
    }
    // The default provider's `<provider>:42` is the same song as `42`, so it carries the same numeric id.
    value = rawSongId;
  }

  const songId = Number(value);
  if (!Number.isInteger(songId) || songId <= 0) {
    return null;
  }
  return {
    providerId: STAGE_DEFAULT_SONG_PROVIDER_ID,
    songId,
    songRef: buildStageSongRef(STAGE_DEFAULT_SONG_PROVIDER_ID, songId),
  };
};

// Lyric files from older Chinese tools are GBK and end lines with "\r\r\n" or a bare "\r".
// A BOM wins, then strict UTF-8, then GB18030; line endings become "\n" for the LRC parser.
const decodeStageLyricsText = (bytes) => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
};

const decodeStageLyricsBuffer = (buffer) => decodeStageLyricsText(
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
).replace(/\r\n?/g, '\n');

const isStageLyricsFormat = (value) => STAGE_LYRICS_FORMAT_VALUES.has(value);

const hasLrcTimeline = (text) => /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);

const hasEnhancedWordTimeline = (text) =>
  /<\d{2}:\d{2}[.:]\d{2,3}>/.test(text) ||
  /(?:^|\n)\s*\[\d{2}:\d{2}[.:]\d{2,3}\][^\[\]\n]+(?:\[\d{2}:\d{2}[.:]\d{2,3}\][^\[\]\n]*)+/m.test(text);

const detectStageLyricsFormat = (text) => {
  const normalizedText = normalizeStageText(text);
  if (!normalizedText || !hasLrcTimeline(normalizedText)) {
    return null;
  }

  return hasEnhancedWordTimeline(normalizedText) ? 'enhanced-lrc' : 'lrc';
};

const formatLrcTimestamp = (timestampMs) => {
  const safeTimestamp = Math.max(0, Math.floor(timestampMs));
  const minutes = Math.floor(safeTimestamp / 60000);
  const seconds = Math.floor((safeTimestamp % 60000) / 1000);
  const centiseconds = Math.floor((safeTimestamp % 1000) / 10);
  return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds
    .toString()
    .padStart(2, '0')}]`;
};

const syncTextToLrc = (syncText, timeStampFormat) => {
  if (!Array.isArray(syncText) || syncText.length === 0) {
    return undefined;
  }

  if (timeStampFormat && timeStampFormat !== 2) {
    return undefined;
  }

  const lines = syncText
    .filter((line) => typeof line?.timestamp === 'number' && typeof line?.text === 'string' && line.text.trim())
    .map((line) => `${formatLrcTimestamp(line.timestamp)}${line.text.trim()}`);

  return lines.length > 0 ? `${lines.join('\n')}\n` : undefined;
};

const normalizeLyricCandidateText = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

const chooseBestLyricCandidate = (candidates) => {
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.find((candidate) => hasEnhancedWordTimeline(candidate.text)) || candidates[0];
};

const isTranslationLyricTag = (tag) => {
  const language = typeof tag.language === 'string' ? tag.language.toLowerCase() : '';
  const descriptor = typeof tag.descriptor === 'string' ? tag.descriptor.toLowerCase() : '';
  const id = typeof tag.id === 'string' ? tag.id.toLowerCase() : '';

  return (
    language === 'chi' ||
    language === 'zho' ||
    descriptor.includes('translation') ||
    descriptor.includes('trans') ||
    descriptor.includes('译') ||
    id.includes('translation') ||
    id.includes('trans')
  );
};

const extractLyricText = (tag) => {
  const directSyncText = syncTextToLrc(tag.syncText, tag.timeStampFormat);
  if (directSyncText) {
    return { text: directSyncText, hasTimeline: true };
  }

  const value = tag.value;
  if (typeof value === 'string' && value.trim()) {
    return { text: value, hasTimeline: hasLrcTimeline(value) };
  }

  if (value && typeof value === 'object') {
    const nestedSyncText = syncTextToLrc(value.syncText, value.timeStampFormat);
    if (nestedSyncText) {
      return { text: nestedSyncText, hasTimeline: true };
    }

    if (typeof value.text === 'string' && value.text.trim()) {
      return { text: value.text, hasTimeline: hasLrcTimeline(value.text) };
    }
  }

  if (typeof tag.text === 'string' && tag.text.trim()) {
    return { text: tag.text, hasTimeline: hasLrcTimeline(tag.text) };
  }

  return { text: undefined, hasTimeline: false };
};

function createStageApi({
  app,
  store,
  getMainWindow,
  stageModeEnabledSettingKey,
  stageModeSourceSettingKey,
  stageApiTokenSettingKey,
  stageApiPortSettingKey,
  defaultStageApiPort,
  getNeteasePort,
  searchStageSongs,
  connectionFilePath = /** @type {string | null} */ (null),
}) {
  let stageServer = null;
  // Set once the server listens: a server whose listen failed (port taken) is not advertised.
  let stageServerListening = false;
  // Bumped by every push and clear of the Stage input: a push that awaited is dropped when another came meanwhile.
  let stageInputVersion = 0;
  let stageLyricsSession = null;
  let stageMediaSession = null;
  let stageActiveEntryKind = null;
  let stageActiveSessionId = null;
  let stageActiveSessionFiles = {
    audioPath: null,
    coverPath: null,
  };
  const stageSessionAssetIndex = new Map();
  const pendingExternalPlayRequests = new Map();
  const pendingStagePlayerControlRequests = new Map();
  const pendingStagePlayerQueueRequests = new Map();
  const pendingStagePlayerSearchRequests = new Map();
  const stagePlayerWebSockets = new Set();
  let stagePlayerWebSocketServer = null;
  let stagePlayerSnapshot = null;
  let stagePlayerTrackKey = null;
  let stagePlayerQueueKey = null;
  let stagePlayerPlaybackKey = null;
  let musicMetadataModulePromise = null;

  const logStage = (level, message, details) => {
    const method = typeof console[level] === 'function' ? console[level] : console.log;
    if (details === undefined) {
      method(`[Stage] ${message}`);
      return;
    }
    method(`[Stage] ${message}`, details);
  };

  // 本机外部程序读的连接文件（stageConnectionFile.cjs）：服务开着时写，关掉时删
  const connectionFile = createStageConnectionFile({
    filePath: connectionFilePath,
    log: (level, message, details) => logStage(level, message, details),
  });
  const writeConnectionFile = () => {
    if (!stageServer || !stageServerListening) return;
    connectionFile.write({ port: getConfiguredStagePort(), token: getStageToken() });
  };

  const getConfiguredStagePort = () => {
    const storedPort = Number(store.get(stageApiPortSettingKey));
    return Number.isInteger(storedPort) && storedPort > 0 ? storedPort : defaultStageApiPort;
  };

  const isStageModeEnabled = () => Boolean(store.get(stageModeEnabledSettingKey));

  const getStageModeSource = () => {
    const configuredSource = store.get(stageModeSourceSettingKey);
    if (configuredSource === 'now-playing') return 'now-playing';
    if (configuredSource === 'playercap') return 'playercap';
    return 'stage-api';
  };

  const isStageEnabled = () => isStageModeEnabled() && getStageModeSource() === 'stage-api';

  const getStageToken = ({ generateIfMissing = false } = {}) => {
    const existing = store.get(stageApiTokenSettingKey);
    if (typeof existing === 'string' && existing.trim().length > 0) {
      return existing;
    }

    if (!generateIfMissing) {
      return null;
    }

    const nextToken = crypto.randomBytes(32).toString('base64url');
    store.set(stageApiTokenSettingKey, nextToken);
    logStage('info', 'Generated Stage bearer token.');
    return nextToken;
  };

  const getStageRootDirectory = () => path.join(app.getPath('userData'), 'stage');
  const getStageSessionsDirectory = () => path.join(getStageRootDirectory(), 'sessions');
  const getStageSessionDirectory = (sessionId) => path.join(getStageSessionsDirectory(), sessionId);

  const getCurrentStageMediaPath = (kind) => {
    if (kind === 'audio') {
      return stageActiveSessionFiles.audioPath;
    }

    if (kind === 'cover') {
      return stageActiveSessionFiles.coverPath;
    }

    throw new Error(`Unknown stage media kind: ${kind}`);
  };

  const buildStageMediaUrl = (kind, version) => {
    const baseUrl = `http://127.0.0.1:${getConfiguredStagePort()}/stage/media/current/${kind}`;
    if (!version) {
      return baseUrl;
    }
    return `${baseUrl}?v=${encodeURIComponent(String(version))}`;
  };

  const buildStageSessionMediaUrl = (sessionId, kind, version) => {
    const encodedSessionId = encodeURIComponent(String(sessionId));
    const baseUrl = `http://127.0.0.1:${getConfiguredStagePort()}/stage/media/session/${encodedSessionId}/${kind}`;
    if (!version) {
      return baseUrl;
    }
    return `${baseUrl}?v=${encodeURIComponent(String(version))}`;
  };

  const withStageInputMetadata = (payload) => ({
    ...STAGE_INPUT_METADATA,
    ...payload,
  });

  const withStagePlayerInsideOutMetadata = (payload) => ({
    ...STAGE_PLAYER_INSIDE_OUT_METADATA,
    ...payload,
  });

  const withStagePlayerOutsideInMetadata = (payload) => ({
    ...STAGE_PLAYER_OUTSIDE_IN_METADATA,
    ...payload,
  });

  const buildStageStatus = () => withStageInputMetadata({
    enabled: isStageEnabled(),
    modeEnabled: isStageModeEnabled(),
    source: isStageModeEnabled() ? getStageModeSource() : null,
    port: getConfiguredStagePort(),
    token: getStageToken(),
    activeEntryKind: stageActiveEntryKind,
    lyricsSession: stageLyricsSession,
    mediaSession: stageMediaSession,
  });

  const normalizeStageNumber = (value, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  };

  const normalizeStageInteger = (value, fallback = 0) => Math.floor(normalizeStageNumber(value, fallback));

  const normalizeStagePlayerContext = (value) =>
    STAGE_PLAYER_CONTEXT_VALUES.has(value) ? value : 'normal-playback';

  const normalizeStagePlayerState = (value) =>
    STAGE_PLAYER_STATE_VALUES.has(value) ? value : 'IDLE';

  const buildStagePlayerControlCapabilities = (context, current, provided = {}) => {
    const hasCurrent = Boolean(current);
    const canControlTransport = context !== 'external-playback-source' && hasCurrent;
    const isNormalPlayback = context === 'normal-playback';

    return {
      play: Boolean(provided.play ?? canControlTransport),
      pause: Boolean(provided.pause ?? canControlTransport),
      resume: Boolean(provided.resume ?? canControlTransport),
      seek: Boolean(provided.seek ?? canControlTransport),
      previous: Boolean(isNormalPlayback && provided.previous),
      next: Boolean(isNormalPlayback && provided.next),
    };
  };

  const buildStagePlayerQueueCapabilities = (context, provided = {}) => {
    const canEditQueue = context === 'normal-playback';

    return {
      append: Boolean(provided.append ?? canEditQueue),
      insertNext: Boolean(provided.insertNext ?? canEditQueue),
      remove: Boolean(provided.remove ?? canEditQueue),
      move: Boolean(provided.move ?? canEditQueue),
      select: Boolean(provided.select ?? canEditQueue),
      clear: Boolean(provided.clear ?? canEditQueue),
    };
  };

  const normalizeStagePlayerCurrent = (value) => {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const id = normalizeStageText(value.id);
    const title = normalizeStageText(value.title);
    if (!id && !title) {
      return null;
    }

    return {
      id: id || title,
      source: normalizeStageText(value.source) || 'unknown',
      title: title || 'Unknown Song',
      artist: normalizeStageText(value.artist) || '',
      album: normalizeStageText(value.album) || '',
      durationMs: Math.max(0, normalizeStageInteger(value.durationMs, 0)),
      coverUrl: normalizeStageText(value.coverUrl) || null,
    };
  };

  const normalizeStagePlayerQueueItem = (item, index) => {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const current = normalizeStagePlayerCurrent(item.current || item);
    if (!current) {
      return null;
    }

    return {
      queueItemId: normalizeStageText(item.queueItemId) || `${current.source}:${current.id}:${index}`,
      ...current,
    };
  };

  const normalizeStagePlayerQueue = (queue) => {
    const items = Array.isArray(queue?.items)
      ? queue.items.map(normalizeStagePlayerQueueItem).filter(Boolean)
      : [];
    const currentIndex = normalizeStageInteger(queue?.currentIndex, -1);

    return {
      items,
      currentIndex: currentIndex >= 0 && currentIndex < items.length ? currentIndex : -1,
      length: items.length,
    };
  };

  const normalizeStagePlayerSnapshot = (snapshot) => {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const playbackContext = normalizeStagePlayerContext(source.playbackContext);
    const current = normalizeStagePlayerCurrent(source.current);
    const queue = normalizeStagePlayerQueue(source.queue);
    const durationMs = Math.max(0, normalizeStageInteger(source.durationMs ?? current?.durationMs, 0));
    const positionMs = Math.max(0, normalizeStageInteger(source.positionMs, 0));
    const sampledAtMs = Math.max(0, normalizeStageInteger(source.sampledAtMs, Date.now()));

    return {
      playbackContext,
      current,
      playerState: normalizeStagePlayerState(source.playerState),
      positionMs: durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs,
      durationMs,
      sampledAtMs,
      updatedAt: Math.max(0, normalizeStageInteger(source.updatedAt, Date.now())),
      controlCapabilities: buildStagePlayerControlCapabilities(playbackContext, current, source.controlCapabilities),
      queueCapabilities: buildStagePlayerQueueCapabilities(playbackContext, source.queueCapabilities),
      queue,
    };
  };

  const getFallbackStagePlayerSnapshot = () => normalizeStagePlayerSnapshot({
    playbackContext: 'normal-playback',
    current: null,
    playerState: 'IDLE',
    positionMs: 0,
    durationMs: 0,
    sampledAtMs: Date.now(),
    updatedAt: Date.now(),
    queue: {
      items: [],
      currentIndex: -1,
    },
  });

  const resolveStagePlayerSnapshotTime = (snapshot) => {
    const source = snapshot || getFallbackStagePlayerSnapshot();
    const sampledAtMs = Date.now();
    let positionMs = source.positionMs;

    if (source.playerState === 'PLAYING' && Number.isFinite(source.sampledAtMs)) {
      positionMs += Math.max(0, sampledAtMs - source.sampledAtMs);
    }

    const durationMs = Math.max(0, normalizeStageInteger(source.durationMs, 0));
    return {
      positionMs: durationMs > 0 ? Math.min(Math.max(0, Math.floor(positionMs)), durationMs) : Math.max(0, Math.floor(positionMs)),
      durationMs,
      sampledAtMs,
    };
  };

  const buildStagePlayerStatus = () => {
    const snapshot = stagePlayerSnapshot || getFallbackStagePlayerSnapshot();
    const time = resolveStagePlayerSnapshotTime(snapshot);

    return withStagePlayerInsideOutMetadata({
      playbackContext: snapshot.playbackContext,
      current: snapshot.current,
      playerState: snapshot.playerState,
      positionMs: time.positionMs,
      durationMs: time.durationMs,
      sampledAtMs: time.sampledAtMs,
      updatedAt: snapshot.updatedAt,
      controlCapabilities: snapshot.controlCapabilities,
      queueCapabilities: snapshot.queueCapabilities,
      queue: buildStagePlayerQueueSummary(snapshot),
    });
  };

  const buildStagePlayerTime = () => {
    const status = buildStagePlayerStatus();
    return withStagePlayerInsideOutMetadata({
      playbackContext: status.playbackContext,
      playerState: status.playerState,
      positionMs: status.positionMs,
      durationMs: status.durationMs,
      sampledAtMs: status.sampledAtMs,
    });
  };

  const buildStagePlayerQueueEvent = (previousSnapshot = null) => {
    const status = buildStagePlayerStatus();
    return withStagePlayerInsideOutMetadata({
      playbackContext: status.playbackContext,
      current: status.current,
      queueCapabilities: status.queueCapabilities,
      ...(previousSnapshot ? { previousQueue: buildStagePlayerQueueSummary(previousSnapshot) } : {}),
      queue: status.queue,
    });
  };

  const buildStagePlayerTrackEvent = () => {
    const status = buildStagePlayerStatus();
    return withStagePlayerInsideOutMetadata({
      playbackContext: status.playbackContext,
      current: status.current,
      playerState: status.playerState,
      sampledAtMs: status.sampledAtMs,
      updatedAt: status.updatedAt,
      controlCapabilities: status.controlCapabilities,
      queueCapabilities: status.queueCapabilities,
      queue: status.queue,
    });
  };

  const getStagePlayerTrackKey = (snapshot) =>
    snapshot?.current ? `${snapshot.current.source}:${snapshot.current.id}` : 'none';

  const getStagePlayerQueueKey = (snapshot) =>
    Array.isArray(snapshot?.queue?.items)
      ? snapshot.queue.items.map((item) => item.queueItemId).join('|')
      : '';

  const getStagePlayerQueueRevision = (snapshot) =>
    crypto.createHash('sha1').update(getStagePlayerQueueKey(snapshot)).digest('hex');

  const buildStagePlayerQueueSummary = (snapshot) => {
    const queue = snapshot?.queue || getFallbackStagePlayerSnapshot().queue;
    return {
      currentIndex: normalizeStageInteger(queue.currentIndex, -1),
      length: Math.max(0, normalizeStageInteger(queue.length ?? queue.items?.length, 0)),
      revision: getStagePlayerQueueRevision(snapshot),
    };
  };

  const withStagePlayerQueueDiffRevisions = (result, previousSnapshot, nextSnapshot) => {
    if (!result || typeof result !== 'object' || !result.diff || typeof result.diff !== 'object') {
      return result;
    }

    return {
      ...result,
      diff: {
        baseRevision: getStagePlayerQueueRevision(previousSnapshot),
        revision: getStagePlayerQueueRevision(nextSnapshot),
        ops: Array.isArray(result.diff.ops) ? result.diff.ops : [],
        ...(result.diff.requiresReload === true ? { requiresReload: true } : {}),
      },
    };
  };

  const normalizeStagePlayerQueueWindow = (requestUrl, queue) => {
    const length = Math.max(0, normalizeStageInteger(queue?.length ?? queue?.items?.length, 0));
    const rawLimit = normalizeStageInteger(requestUrl?.searchParams?.get('limit'), STAGE_PLAYER_QUEUE_DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(STAGE_PLAYER_QUEUE_MAX_LIMIT, rawLimit));
    const around = normalizeStageText(requestUrl?.searchParams?.get('around'));
    let offset = Math.max(0, normalizeStageInteger(requestUrl?.searchParams?.get('offset'), 0));

    if (around === 'current') {
      const currentIndex = normalizeStageInteger(queue?.currentIndex, -1);
      offset = currentIndex >= 0 ? Math.max(0, currentIndex - Math.floor(limit / 2)) : 0;
    }

    if (length <= 0) {
      offset = 0;
    } else if (around === 'current') {
      offset = Math.min(offset, Math.max(0, length - limit));
    } else {
      offset = Math.min(offset, length);
    }

    return { offset, limit };
  };

  const getStagePlayerPlaybackKey = (snapshot) => {
    if (!snapshot) {
      return '';
    }

    return JSON.stringify({
      playbackContext: snapshot.playbackContext,
      playerState: snapshot.playerState,
      positionMs: snapshot.playerState === 'PAUSED' ? snapshot.positionMs : null,
    });
  };

  const broadcastStageEvent = (channel) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send(channel, buildStageStatus());
  };

  const sendStagePlayerWebSocketEvent = (socket, event, payload = buildStagePlayerStatus()) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify({
      event,
      ...payload,
    }));
    return true;
  };

  const broadcastStagePlayerWebSocketEvent = (event, payload = buildStagePlayerStatus()) => {
    for (const socket of stagePlayerWebSockets) {
      sendStagePlayerWebSocketEvent(socket, event, payload);
    }
  };

  const closeStagePlayerWebSockets = (code = 1001, reason = 'Stage player socket closed.') => {
    for (const socket of stagePlayerWebSockets) {
      try {
        socket.close(code, reason);
      } catch (error) {
        logStage('warn', 'Failed to close a Stage player WebSocket.', error);
      }
    }
    stagePlayerWebSockets.clear();

    if (stagePlayerWebSocketServer) {
      try {
        stagePlayerWebSocketServer.close();
      } catch (error) {
        logStage('warn', 'Failed to close Stage player WebSocket server.', error);
      }
      stagePlayerWebSocketServer = null;
    }
  };

  const publishStagePlayerSnapshot = (snapshot, options = {}) => {
    const previousSnapshot = stagePlayerSnapshot;
    stagePlayerSnapshot = normalizeStagePlayerSnapshot(snapshot);
    const nextTrackKey = getStagePlayerTrackKey(stagePlayerSnapshot);
    const nextQueueKey = getStagePlayerQueueKey(stagePlayerSnapshot);
    const nextPlaybackKey = getStagePlayerPlaybackKey(stagePlayerSnapshot);
    const status = buildStagePlayerStatus();
    const forcePlaybackEvent = options && options.forcePlaybackEvent === true;

    if (stagePlayerTrackKey !== null && stagePlayerTrackKey !== nextTrackKey) {
      broadcastStagePlayerWebSocketEvent('TRACK_CHANGED', buildStagePlayerTrackEvent());
    } else if (stagePlayerQueueKey !== null && stagePlayerQueueKey !== nextQueueKey) {
      broadcastStagePlayerWebSocketEvent('QUEUE_UPDATED', buildStagePlayerQueueEvent(previousSnapshot));
    } else if (forcePlaybackEvent || (stagePlayerPlaybackKey !== null && stagePlayerPlaybackKey !== nextPlaybackKey)) {
      broadcastStagePlayerWebSocketEvent('PLAYBACK_UPDATED', buildStagePlayerTime());
    }

    stagePlayerTrackKey = nextTrackKey;
    stagePlayerQueueKey = nextQueueKey;
    stagePlayerPlaybackKey = nextPlaybackKey;
    return status;
  };

  const rejectStageWebSocketUpgrade = (socket, statusCode, message) => {
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  const handleStageWebSocketUpgrade = (req, socket, head) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/stage/player/ws') {
      rejectStageWebSocketUpgrade(socket, 404, 'Not Found');
      return;
    }

    if (!isStageEnabled()) {
      rejectStageWebSocketUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    if (!matchesStageBearerToken(req, requestUrl)) {
      rejectStageWebSocketUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    if (!stagePlayerWebSocketServer) {
      stagePlayerWebSocketServer = new WebSocketServer({ noServer: true });
    }

    stagePlayerWebSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
      stagePlayerWebSockets.add(webSocket);
      webSocket.on('close', () => {
        stagePlayerWebSockets.delete(webSocket);
      });
      sendStagePlayerWebSocketEvent(webSocket, 'STATUS', buildStagePlayerStatus());
    });
  };

  const clearPendingStagePlayerRequests = (pendingRequests, reason, code) => {
    for (const [requestId, pendingRequest] of pendingRequests.entries()) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(new StageApiError(reason, {
        statusCode: 503,
        code,
        details: { requestId },
      }));
    }
    pendingRequests.clear();
  };

  const ensureStageSessionsDirectory = async () => {
    await fsp.mkdir(getStageSessionsDirectory(), { recursive: true });
  };

  const createStageWorkingDirectory = async (sessionId) => {
    const workingDirectory = getStageSessionDirectory(sessionId);
    await fsp.mkdir(workingDirectory, { recursive: true });
    return workingDirectory;
  };

  const removeStageSessionDirectory = async (workingDirectory) => {
    if (!workingDirectory) {
      return;
    }
    try {
      await fsp.rm(workingDirectory, { recursive: true, force: true });
    } catch (error) {
      logStage('warn', 'Failed to remove Stage working directory.', {
        workingDirectory,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const cleanupInactiveStageSessions = async () => {
    const retainedSessionIds = Array.from(stageSessionAssetIndex.keys()).slice(-STAGE_SESSION_RETENTION_LIMIT);
    const keepSessionIds = new Set(retainedSessionIds);
    if (stageActiveSessionId) {
      keepSessionIds.add(stageActiveSessionId);
    }

    for (const [sessionId, sessionAssets] of Array.from(stageSessionAssetIndex.entries())) {
      if (keepSessionIds.has(sessionId)) {
        continue;
      }

      stageSessionAssetIndex.delete(sessionId);
      await removeStageSessionDirectory(sessionAssets.workingDirectory);
    }
  };

  const rememberStageSessionAssets = (sessionId, sessionFiles, coverMimeType = null) => {
    if (!sessionId) {
      return;
    }

    if (stageSessionAssetIndex.has(sessionId)) {
      stageSessionAssetIndex.delete(sessionId);
    }

    stageSessionAssetIndex.set(sessionId, {
      audioPath: sessionFiles?.audioPath || null,
      coverPath: sessionFiles?.coverPath || null,
      coverMimeType: coverMimeType || null,
      workingDirectory: getStageSessionDirectory(sessionId),
    });
  };

  const getStageSessionAssets = (sessionId) => {
    if (!sessionId) {
      return null;
    }

    return stageSessionAssetIndex.get(sessionId) || null;
  };

  const clearPendingExternalPlayRequests = (reason) => {
    for (const [requestId, entry] of Array.from(pendingExternalPlayRequests.entries())) {
      clearTimeout(entry.timer);
      entry.reject(new StageApiError(reason || 'Stage external play request was canceled.', {
        statusCode: 503,
        code: 'STAGE_PLAY_CANCELED',
        details: { requestId },
      }));
      pendingExternalPlayRequests.delete(requestId);
    }
  };

  const clearStageStateData = async () => {
    stageInputVersion += 1;
    clearPendingExternalPlayRequests('Stage state was cleared.');
    stageLyricsSession = null;
    stageMediaSession = null;
    stageActiveEntryKind = null;
    stageActiveSessionId = null;
    stageActiveSessionFiles = {
      audioPath: null,
      coverPath: null,
    };
    return buildStageStatus();
  };

  const clearStageState = async () => {
    await clearStageStateData();
    broadcastStageEvent('stage-session-cleared');
    broadcastStageEvent('stage-session-updated');
    return buildStageStatus();
  };

  const loadMusicMetadata = async () => {
    if (!musicMetadataModulePromise) {
      musicMetadataModulePromise = import('music-metadata');
    }
    return musicMetadataModulePromise;
  };

  const createStageValidationError = (message, code, details) => (
    new StageApiError(message, {
      statusCode: 400,
      code,
      details,
    })
  );

  const sendStageJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  };

  const sendStageBinary = (res, statusCode, buffer, contentType) => {
    res.writeHead(statusCode, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  };

  const sendStageFile = async (req, res, filePath, contentType) => {
    const fileStat = await fsp.stat(filePath);
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';

    if (!rangeHeader) {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': fileStat.size,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const rangeMatch = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
    if (!rangeMatch) {
      sendStageJson(res, 416, { error: 'Invalid byte range.' });
      return;
    }

    const requestedStart = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    const requestedEnd = rangeMatch[2] ? Number(rangeMatch[2]) : fileStat.size - 1;
    const start = Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;
    const end = Number.isFinite(requestedEnd) ? Math.min(fileStat.size - 1, requestedEnd) : fileStat.size - 1;

    if (start > end || start >= fileStat.size) {
      sendStageJson(res, 416, { error: 'Requested range is outside the file.' });
      return;
    }

    res.writeHead(206, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  };

  const readRequestBodyWithLimit = async (req, maxBytes) => {
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        throw new StageApiError('Stage request body exceeded the size limit.', {
          statusCode: 413,
          code: 'STAGE_BODY_TOO_LARGE',
          details: {
            maxBytes,
            totalBytes,
          },
        });
      }
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  };

  const getStageBearerTokenFromRequest = (req, requestUrl = null) => {
    const authorizationHeader = req.headers.authorization;
    if (typeof authorizationHeader === 'string') {
      const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
      if (match) {
        return match[1];
      }
    }

    if (requestUrl) {
      const queryToken = requestUrl.searchParams.get('token');
      if (queryToken) {
        return queryToken;
      }
    }

    return null;
  };

  const matchesStageBearerToken = (req, requestUrl = null) => {
    const requestToken = getStageBearerTokenFromRequest(req, requestUrl);
    const expectedToken = getStageToken();
    return Boolean(requestToken && expectedToken && requestToken === expectedToken);
  };

  const parseStageMultipartPayload = (req, workingDirectory) =>
    new Promise((resolve, reject) => {
      const files = {};
      const fields = {};
      const pendingFileWrites = [];
      const busboy = Busboy({
        headers: req.headers,
        limits: {
          fieldNameSize: 100,
          fieldSize: STAGE_MULTIPART_FIELD_LIMIT_BYTES,
          fields: STAGE_MULTIPART_FIELD_COUNT_LIMIT,
          fileSize: STAGE_MULTIPART_FILE_LIMIT_BYTES,
          files: STAGE_MULTIPART_FILE_COUNT_LIMIT,
          parts: STAGE_MULTIPART_PART_COUNT_LIMIT,
        },
      });

      let isSettled = false;
      const fail = (error) => {
        if (isSettled) {
          return;
        }
        isSettled = true;
        reject(error);
      };

      busboy.on('field', (fieldName, value) => {
        if (typeof fieldName !== 'string' || !fieldName.trim()) {
          return;
        }
        fields[fieldName] = value;
      });

      busboy.on('file', (fieldName, file, fileInfo) => {
        const safeFieldName = normalizeStageText(fieldName);
        if (!safeFieldName) {
          file.resume();
          return;
        }

        const originalFileName = normalizeStageText(fileInfo?.filename) || safeFieldName;
        const contentType = normalizeStageText(fileInfo?.mimeType) || 'application/octet-stream';
        const safeBaseName = path.basename(originalFileName).replace(/[^\w.-]+/g, '_') || safeFieldName;
        const filePath = path.join(workingDirectory, `${safeFieldName}-${Date.now()}-${safeBaseName}`);
        const writeStream = fs.createWriteStream(filePath, { flags: 'wx' });
        let totalBytes = 0;

        file.on('data', (chunk) => {
          totalBytes += chunk.length;
        });

        file.on('limit', () => {
          writeStream.destroy();
          void fsp.rm(filePath, { force: true });
          fail(new StageApiError(`Multipart file ${safeFieldName} exceeded the size limit.`, {
            statusCode: 413,
            code: 'STAGE_FILE_TOO_LARGE',
            details: {
              fieldName: safeFieldName,
              maxBytes: STAGE_MULTIPART_FILE_LIMIT_BYTES,
            },
          }));
        });

        file.on('error', (error) => {
          writeStream.destroy(error);
          fail(error);
        });

        writeStream.on('error', (error) => {
          fail(error);
        });

        file.pipe(writeStream);

        const writeTask = finished(writeStream).then(() => {
          files[safeFieldName] = {
            fieldName: safeFieldName,
            fileName: originalFileName,
            contentType,
            filePath,
            size: totalBytes,
          };
        });

        pendingFileWrites.push(writeTask);
      });

      busboy.on('error', (error) => {
        fail(error);
      });

      busboy.on('finish', async () => {
        try {
          await Promise.all(pendingFileWrites);
          isSettled = true;
          resolve({
            fields,
            files,
            sessionId: path.basename(workingDirectory),
            workingDirectory,
          });
        } catch (error) {
          fail(new StageApiError('Failed to finalize multipart Stage upload.', {
            statusCode: 500,
            code: 'SESSION_COMMIT_FAILED',
            details: {
              reason: error instanceof Error ? error.message : String(error),
            },
          }));
        }
      });

      req.pipe(busboy);
    });

  const parseStagePayloadFromJson = (buffer, workingDirectory) => {
    const raw = buffer.toString('utf-8') || '{}';
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new StageApiError('Failed to parse Stage JSON payload.', {
        statusCode: 400,
        code: 'INVALID_STAGE_JSON',
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
    return {
      fields: {
        title: typeof payload.title === 'string' ? payload.title : '',
        artist: typeof payload.artist === 'string' ? payload.artist : '',
        album: typeof payload.album === 'string' ? payload.album : '',
        coverUrl: typeof payload.coverUrl === 'string' ? payload.coverUrl : '',
        audioUrl: typeof payload.audioUrl === 'string' ? payload.audioUrl : '',
        lyricsText: typeof payload.lyricsText === 'string' ? payload.lyricsText : '',
        lyricsFormat: typeof payload.lyricsFormat === 'string' ? payload.lyricsFormat : '',
      },
      files: {},
      sessionId: path.basename(workingDirectory),
      workingDirectory,
    };
  };

  // Parse uploaded audio in Node so Stage can reuse embedded lyrics and cover art
  // without forcing external tools to send duplicate metadata.
  const extractStageEmbeddedAudioMetadata = async (audioFile) => {
    const { parseFile } = await loadMusicMetadata();
    const parsed = await parseFile(audioFile.filePath, {
      mimeType: audioFile.contentType || undefined,
      path: audioFile.fileName || 'stage-audio',
      size: audioFile.size,
    });

    const collectLyricCandidates = (tags) => {
      const lyricCandidates = [];

      for (const tag of tags) {
        const { text, hasTimeline } = extractLyricText(tag);
        if (typeof text !== 'string' || !text.trim()) {
          continue;
        }

        const normalizedText = normalizeLyricCandidateText(text);
        if (lyricCandidates.some((candidate) => candidate.text === normalizedText)) {
          continue;
        }

        lyricCandidates.push({
          text: normalizedText,
          isTranslation: isTranslationLyricTag(tag),
          hasTimeline,
        });
      }

      return lyricCandidates;
    };

    let lyricCandidates = collectLyricCandidates(parsed.common.lyrics || []);
    if (lyricCandidates.length === 0) {
      const nativeLyricTags = [];
      for (const tags of Object.values(parsed.native || {})) {
        for (const tag of tags) {
          const id = typeof tag.id === 'string' ? tag.id.toLowerCase() : '';
          if (id.includes('lyric') || id.includes('uslt') || id.includes('sylt')) {
            nativeLyricTags.push(tag);
          }
        }
      }
      lyricCandidates = collectLyricCandidates(nativeLyricTags);
    }

    const timedCandidates = lyricCandidates.filter((candidate) => candidate.hasTimeline);
    const lyricSource = timedCandidates.length > 0 ? timedCandidates : lyricCandidates;
    const translationCandidates = lyricSource.filter((candidate) => candidate.isTranslation);
    const originalCandidates = lyricSource.filter((candidate) => !candidate.isTranslation);
    const bestOriginal = chooseBestLyricCandidate(originalCandidates) || chooseBestLyricCandidate(lyricSource);
    const bestTranslation = chooseBestLyricCandidate(
      translationCandidates.filter((candidate) => candidate.text !== bestOriginal?.text),
    );
    const picture = Array.isArray(parsed.common.picture) ? parsed.common.picture[0] : null;

    return {
      title: parsed.common.title,
      artist: parsed.common.artist,
      album: parsed.common.album,
      durationMs: Number.isFinite(parsed.format.duration) ? Math.max(0, Math.floor(parsed.format.duration * 1000)) : null,
      lyrics: bestOriginal?.text,
      translationLyrics: bestTranslation?.text,
      coverBuffer: picture?.data ? Buffer.from(picture.data) : null,
      coverMimeType: picture?.format || null,
    };
  };

  const createStageMediaSessionFromPayload = async (parsedPayload) => {
    const fields = parsedPayload.fields || {};
    const files = parsedPayload.files || {};
    const sessionId = typeof parsedPayload.sessionId === 'string' && parsedPayload.sessionId.trim()
      ? parsedPayload.sessionId.trim()
      : `stage-${Date.now()}-${crypto.randomUUID()}`;
    const workingDirectory = parsedPayload.workingDirectory;
    const requestedTitle = normalizeStageText(fields.title);
    const requestedArtist = normalizeStageText(fields.artist);
    const requestedAlbum = normalizeStageText(fields.album);
    const requestedCoverUrl = normalizeStageText(fields.coverUrl);
    const requestedAudioUrl = normalizeStageText(fields.audioUrl);
    const requestedLyricsText = normalizeStageText(fields.lyricsText);
    const requestedLyricsFormat = normalizeStageText(fields.lyricsFormat);
    const audioFile = files.audioFile || null;
    const lyricsFile = files.lyricsFile || null;
    const coverFile = files.coverFile || null;

    if (requestedLyricsFormat && !isStageLyricsFormat(requestedLyricsFormat)) {
      throw createStageValidationError(
        'Invalid lyricsFormat. Only "lrc", "enhanced-lrc", "vtt", and "yrc" are supported.',
        'INVALID_LYRICS_FORMAT',
        { lyricsFormat: requestedLyricsFormat },
      );
    }

    if ((!requestedAudioUrl && !audioFile) || (requestedAudioUrl && audioFile)) {
      throw createStageValidationError(
        'Provide exactly one audio source: either audioUrl or audioFile.',
        'INVALID_AUDIO_SOURCE',
        {
          hasAudioUrl: Boolean(requestedAudioUrl),
          hasAudioFile: Boolean(audioFile),
        },
      );
    }

    if (requestedLyricsText && lyricsFile) {
      throw createStageValidationError(
        'Provide at most one standalone lyrics source: either lyricsText or lyricsFile.',
        'INVALID_LYRICS_SOURCE',
        {
          hasLyricsText: Boolean(requestedLyricsText),
          hasLyricsFile: Boolean(lyricsFile),
        },
      );
    }

    logStage('info', 'Received Stage media session payload.', {
      hasAudioUrl: Boolean(requestedAudioUrl),
      hasAudioFile: Boolean(audioFile),
      hasLyricsText: Boolean(requestedLyricsText),
      hasLyricsFile: Boolean(lyricsFile),
      hasCoverUrl: Boolean(requestedCoverUrl),
      hasCoverFile: Boolean(coverFile),
    });

    let embeddedMetadata = null;
    if (audioFile) {
      try {
        embeddedMetadata = await extractStageEmbeddedAudioMetadata(audioFile);
      } catch (error) {
        throw new StageApiError(
          'Failed to parse uploaded audio metadata. The file may be corrupted or use an unsupported tagging layout.',
          {
            statusCode: 422,
            code: 'AUDIO_METADATA_PARSE_FAILED',
            details: {
              fileName: audioFile.fileName || null,
              mimeType: audioFile.contentType || null,
              reason: error instanceof Error ? error.message : String(error),
            },
          },
        );
      }
    }

    const sessionVersion = Date.now();
    let resolvedAudioSrc = requestedAudioUrl || '';
    let resolvedCoverUrl = requestedCoverUrl || null;
    let resolvedCoverMimeType = coverFile?.contentType || undefined;
    let resolvedLyricsText = requestedLyricsText;
    let resolvedAudioPath = null;
    let resolvedCoverPath = coverFile?.filePath || null;

    if (audioFile) {
      resolvedAudioSrc = buildStageMediaUrl('audio', sessionVersion);
      resolvedAudioPath = audioFile.filePath;
    }

    if (lyricsFile) {
      resolvedLyricsText = decodeStageLyricsBuffer(await fsp.readFile(lyricsFile.filePath)).trim();
    } else if (!resolvedLyricsText && embeddedMetadata?.lyrics) {
      resolvedLyricsText = normalizeStageText(embeddedMetadata.lyrics);
      logStage('info', 'Using embedded lyrics from uploaded audio metadata.');
    }

    const normalizedResolvedLyricsText = normalizeStageText(resolvedLyricsText);
    const hasResolvedLyrics = Boolean(normalizedResolvedLyricsText);
    const detectedLyricsFormat = hasResolvedLyrics
      ? (requestedLyricsFormat || detectStageLyricsFormat(normalizedResolvedLyricsText))
      : null;

    if (coverFile) {
      resolvedCoverUrl = buildStageSessionMediaUrl(sessionId, 'cover', sessionVersion);
    } else if (!resolvedCoverUrl && embeddedMetadata?.coverBuffer) {
      const extension = path.extname(embeddedMetadata.coverMimeType || '') || '.bin';
      const embeddedCoverPath = path.join(workingDirectory, `embedded-cover${extension}`);
      await fsp.writeFile(embeddedCoverPath, embeddedMetadata.coverBuffer);
      resolvedCoverPath = embeddedCoverPath;
      resolvedCoverUrl = buildStageSessionMediaUrl(sessionId, 'cover', sessionVersion);
      resolvedCoverMimeType = embeddedMetadata.coverMimeType || undefined;
      logStage('info', 'Using embedded cover art from uploaded audio metadata.');
    }

    const nextSession = {
      id: sessionId,
      title: requestedTitle || normalizeStageText(embeddedMetadata?.title) || 'Stage Session',
      artist: requestedArtist || normalizeStageText(embeddedMetadata?.artist) || 'Stage',
      album: requestedAlbum || normalizeStageText(embeddedMetadata?.album) || '',
      durationMs: Number.isFinite(embeddedMetadata?.durationMs) ? embeddedMetadata.durationMs : null,
      coverUrl: resolvedCoverUrl,
      coverArtUrl: resolvedCoverUrl,
      audioUrl: requestedAudioUrl || null,
      audioSrc: resolvedAudioSrc,
      audioMimeType: audioFile?.contentType || undefined,
      coverMimeType: resolvedCoverMimeType,
      lyricsText: normalizedResolvedLyricsText || null,
      lyricsFormat: detectedLyricsFormat || null,
      updatedAt: sessionVersion,
    };

    return {
      mediaSession: nextSession,
      activeSessionId: sessionId,
      activeSessionFiles: {
        audioPath: resolvedAudioPath,
        coverPath: resolvedCoverPath,
      },
      workingDirectory,
    };
  };

  const normalizeStageNeteaseLyricBranch = (value) => {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const lyric = normalizeStageText(value.lyric);
    const pureMusic = typeof value.pureMusic === 'boolean' ? value.pureMusic : undefined;
    if (!lyric && pureMusic === undefined) {
      return null;
    }

    return {
      ...(lyric ? { lyric } : {}),
      ...(pureMusic !== undefined ? { pureMusic } : {}),
    };
  };

  // 外部播放器推来的时钟、长度、封面（stageLyricsInput.cjs）
  const {
    normalizeStageLyricsClock,
    normalizeStageDurationMs,
    normalizeStageLyricsCover,
  } = createStageLyricsInput({ invalid: (message, code) => createStageValidationError(message, code) });

  const normalizeStageLyricSource = (rawLyricSource) => {
    if (!rawLyricSource || typeof rawLyricSource !== 'object') {
      throw createStageValidationError(
        'Stage lyrics payload requires a parser-compatible lyricSource object.',
        'INVALID_STAGE_LYRICS',
      );
    }

    const sourceType = normalizeStageText(rawLyricSource.type);
    if (!sourceType) {
      throw createStageValidationError(
        'Stage lyricSource.type is required.',
        'INVALID_STAGE_LYRICS',
      );
    }

    let lyricSource = null;

    if (sourceType === 'local') {
      const lrcContent = typeof rawLyricSource.lrcContent === 'string' ? rawLyricSource.lrcContent : '';
      const tLrcContent = typeof rawLyricSource.tLrcContent === 'string' ? rawLyricSource.tLrcContent : '';
      const formatHint = normalizeStageText(rawLyricSource.formatHint);
      if (!lrcContent.trim()) {
        throw createStageValidationError(
          'Stage local lyricSource requires lrcContent.',
          'INVALID_STAGE_LYRICS',
        );
      }

      lyricSource = {
        type: 'local',
        lrcContent,
        ...(tLrcContent.trim() ? { tLrcContent } : {}),
        ...(formatHint && isStageLyricsFormat(formatHint) ? { formatHint } : {}),
      };
    } else if (sourceType === 'embedded') {
      const textContent = typeof rawLyricSource.textContent === 'string' ? rawLyricSource.textContent : '';
      const translationContent = typeof rawLyricSource.translationContent === 'string' ? rawLyricSource.translationContent : '';
      const usltTags = Array.isArray(rawLyricSource.usltTags)
        ? rawLyricSource.usltTags
          .map((tag) => {
            const text = typeof tag?.text === 'string' ? tag.text : '';
            if (!text.trim()) {
              return null;
            }

            return {
              text,
              ...(normalizeStageText(tag?.language) ? { language: normalizeStageText(tag.language) } : {}),
              ...(normalizeStageText(tag?.descriptor) ? { descriptor: normalizeStageText(tag.descriptor) } : {}),
            };
          })
          .filter(Boolean)
        : [];

      if (!textContent.trim() && !translationContent.trim() && usltTags.length === 0) {
        throw createStageValidationError(
          'Stage embedded lyricSource requires textContent, translationContent, or usltTags.',
          'INVALID_STAGE_LYRICS',
        );
      }

      lyricSource = {
        type: 'embedded',
        ...(textContent.trim() ? { textContent } : {}),
        ...(translationContent.trim() ? { translationContent } : {}),
        ...(usltTags.length > 0 ? { usltTags } : {}),
      };
    } else if (sourceType === 'navidrome') {
      const plainLyrics = typeof rawLyricSource.plainLyrics === 'string' ? rawLyricSource.plainLyrics : '';
      const structuredLyrics = Array.isArray(rawLyricSource.structuredLyrics)
        ? rawLyricSource.structuredLyrics
          .map((line) => {
            const value = typeof line?.value === 'string' ? line.value : '';
            const start = Number.isFinite(line?.start) ? Number(line.start) : undefined;
            if (!value.trim() && start === undefined) {
              return null;
            }

            return {
              ...(start !== undefined ? { start } : {}),
              ...(value.trim() ? { value } : {}),
            };
          })
          .filter(Boolean)
        : [];

      if (!plainLyrics.trim() && structuredLyrics.length === 0) {
        throw createStageValidationError(
          'Stage navidrome lyricSource requires plainLyrics or structuredLyrics.',
          'INVALID_STAGE_LYRICS',
        );
      }

      lyricSource = {
        type: 'navidrome',
        ...(plainLyrics.trim() ? { plainLyrics } : {}),
        ...(structuredLyrics.length > 0 ? { structuredLyrics } : {}),
      };
    } else if (sourceType === 'netease') {
      const lrc = normalizeStageNeteaseLyricBranch(rawLyricSource.lrc);
      const yrc = normalizeStageNeteaseLyricBranch(rawLyricSource.yrc);
      const ytlrc = normalizeStageNeteaseLyricBranch(rawLyricSource.ytlrc);
      const tlyric = normalizeStageNeteaseLyricBranch(rawLyricSource.tlyric);
      const lrcYrc = normalizeStageNeteaseLyricBranch(rawLyricSource?.lrc?.yrc);
      const lrcYtlrc = normalizeStageNeteaseLyricBranch(rawLyricSource?.lrc?.ytlrc);
      const pureMusic = typeof rawLyricSource.pureMusic === 'boolean' ? rawLyricSource.pureMusic : undefined;

      if (!lrc && !yrc && !ytlrc && !tlyric && !lrcYrc && !lrcYtlrc && pureMusic === undefined) {
        throw createStageValidationError(
          'Stage netease lyricSource requires at least one lyric branch.',
          'INVALID_STAGE_LYRICS',
        );
      }

      lyricSource = {
        type: 'netease',
        ...(lrc || lrcYrc || lrcYtlrc ? {
          lrc: {
            ...(lrc || {}),
            ...(lrcYrc ? { yrc: lrcYrc } : {}),
            ...(lrcYtlrc ? { ytlrc: lrcYtlrc } : {}),
          },
        } : {}),
        ...(yrc ? { yrc } : {}),
        ...(ytlrc ? { ytlrc } : {}),
        ...(tlyric ? { tlyric } : {}),
        ...(pureMusic !== undefined ? { pureMusic } : {}),
      };
    } else {
      throw createStageValidationError(
        'Stage lyricSource.type must be embedded, local, navidrome, or netease.',
        'INVALID_STAGE_LYRICS',
      );
    }

    return lyricSource;
  };

  // /stage/lyrics 的载荷：lyricSource 可以没有（外部播放器先报曲目、歌词晚到或找不到），这时至少要有 title
  const normalizeStageLyricsSessionPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw createStageValidationError(
        'Stage lyrics payload must be a JSON object.',
        'INVALID_STAGE_LYRICS',
      );
    }
    const title = normalizeStageText(payload.title);
    const hasLyricSource = payload.lyricSource !== undefined && payload.lyricSource !== null;
    if (!hasLyricSource && !title) {
      throw createStageValidationError(
        'Stage lyrics payload requires a parser-compatible lyricSource object, or a title for a session without lyrics.',
        'INVALID_STAGE_LYRICS',
      );
    }
    const lyricSource = hasLyricSource ? normalizeStageLyricSource(payload.lyricSource) : null;
    const durationMs = normalizeStageDurationMs(payload.durationMs);
    const clock = payload.positionMs !== undefined && payload.positionMs !== null ? normalizeStageLyricsClock(payload) : null;
    const cover = normalizeStageLyricsCover(payload);

    return {
      session: {
        ...(title ? { title } : {}),
        ...(normalizeStageText(payload.artist) ? { artist: normalizeStageText(payload.artist) } : {}),
        ...(normalizeStageText(payload.album) ? { album: normalizeStageText(payload.album) } : {}),
        ...(lyricSource ? { lyricSource } : {}),
        ...(durationMs ? { durationMs } : {}),
        ...(cover.coverUrl ? { coverUrl: cover.coverUrl } : {}),
        ...(clock ? { clock } : {}),
        updatedAt: Date.now(),
      },
      coverUpload: cover.upload,
    };
  };

  const normalizeStageSearchResult = (song = {}) => {
    const artists = Array.isArray(song.ar)
      ? song.ar.map((artist) => normalizeStageText(artist?.name)).filter(Boolean)
      : Array.isArray(song.artists)
        ? song.artists.map((artist) => normalizeStageText(artist?.name)).filter(Boolean)
        : [];
    const coverUrl = normalizeStageText(
      song?.al?.picUrl ||
      song?.album?.picUrl ||
      song?.simpleSong?.al?.picUrl ||
      song?.simpleSong?.album?.picUrl,
    ) || null;

    return {
      songId: Number(song.id),
      title: normalizeStageText(song.name) || 'Unknown Song',
      artists,
      album: normalizeStageText(song?.al?.name || song?.album?.name) || '',
      durationMs: Number.isFinite(song.dt) ? Math.max(0, Math.floor(song.dt)) : null,
      coverUrl,
    };
  };

  const defaultSearchStageSongs = async (query, limit) => {
    const port = typeof getNeteasePort === 'function' ? Number(getNeteasePort()) : null;
    if (!Number.isInteger(port) || port <= 0) {
      throw new StageApiError('Local Netease API is unavailable.', {
        statusCode: 503,
        code: 'NETEASE_API_UNAVAILABLE',
      });
    }

    const endpoint = `http://127.0.0.1:${port}/cloudsearch?keywords=${encodeURIComponent(query)}&limit=${limit}&offset=0`;
    const response = await fetch(endpoint, { method: 'GET' });
    if (!response.ok) {
      throw new StageApiError('Failed to search songs through the local Netease API.', {
        statusCode: 502,
        code: 'NETEASE_SEARCH_FAILED',
        details: {
          status: response.status,
          endpoint,
        },
      });
    }

    const payload = await response.json();
    const songs = Array.isArray(payload?.result?.songs) ? payload.result.songs : [];
    return songs.map(normalizeStageSearchResult).filter((song) => Number.isFinite(song.songId) && song.songId > 0);
  };

  const requestStageSongPlay = async ({ providerId, songId }, options = {}) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new StageApiError('Folia main window is unavailable for external play requests.', {
        statusCode: 503,
        code: 'STAGE_PLAY_UNAVAILABLE',
      });
    }

    const requestId = `stage-play-${Date.now()}-${crypto.randomUUID()}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingExternalPlayRequests.delete(requestId);
        reject(new StageApiError('Stage external play request timed out.', {
          statusCode: 504,
          code: 'STAGE_PLAY_TIMEOUT',
          details: { requestId, providerId, songId },
        }));
      }, STAGE_PLAY_REQUEST_TIMEOUT_MS);

      pendingExternalPlayRequests.set(requestId, { resolve, reject, timer });
      mainWindow.webContents.send('stage-external-play-request', {
        requestId,
        providerId,
        songId,
        appendToQueue: options.appendToQueue === true,
      });
    });
  };

  const requestStagePlayerRendererAction = async (channel, pendingRequests, requestPrefix, payload, unavailableCode) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new StageApiError('Folia main window is unavailable for Stage player requests.', {
        statusCode: 503,
        code: unavailableCode,
      });
    }

    const requestId = `${requestPrefix}-${Date.now()}-${crypto.randomUUID()}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new StageApiError('Stage player request timed out.', {
          statusCode: 504,
          code: 'STAGE_PLAYER_REQUEST_TIMEOUT',
          details: { requestId },
        }));
      }, STAGE_PLAYER_REQUEST_TIMEOUT_MS);

      pendingRequests.set(requestId, { resolve, reject, timer });
      mainWindow.webContents.send(channel, {
        requestId,
        ...payload,
      });
    });
  };

  const completeStagePlayerRendererRequest = (pendingRequests, { requestId, ok, error, snapshot, result } = {}) => {
    const normalizedRequestId = normalizeStageText(requestId);
    if (!normalizedRequestId) {
      return false;
    }

    const pendingRequest = pendingRequests.get(normalizedRequestId);
    if (!pendingRequest) {
      return false;
    }

    clearTimeout(pendingRequest.timer);
    pendingRequests.delete(normalizedRequestId);

    const previousSnapshot = stagePlayerSnapshot || getFallbackStagePlayerSnapshot();
    if (snapshot) {
      publishStagePlayerSnapshot(snapshot);
    }
    const nextSnapshot = stagePlayerSnapshot || getFallbackStagePlayerSnapshot();

    if (ok) {
      pendingRequest.resolve(withStagePlayerQueueDiffRevisions(result || { ok: true }, previousSnapshot, nextSnapshot));
      return true;
    }

    pendingRequest.reject(new StageApiError(normalizeStageText(error) || 'Renderer rejected the Stage player request.', {
      statusCode: 502,
      code: 'STAGE_PLAYER_REQUEST_REJECTED',
      details: {
        requestId: normalizedRequestId,
      },
    }));
    return true;
  };

  const requestStagePlayerControl = (payload) =>
    requestStagePlayerRendererAction(
      'stage-player-control-request',
      pendingStagePlayerControlRequests,
      'stage-player-control',
      payload,
      'STAGE_PLAYER_CONTROL_UNAVAILABLE',
    );

  const requestStagePlayerQueueOperation = (payload) =>
    requestStagePlayerRendererAction(
      'stage-player-queue-request',
      pendingStagePlayerQueueRequests,
      'stage-player-queue',
      payload,
      'STAGE_PLAYER_QUEUE_UNAVAILABLE',
    );

  // A search at one omni provider runs in the renderer, which holds the providers and their sessions.
  const requestStageProviderSearch = (providerId, query, limit) =>
    requestStagePlayerRendererAction(
      'stage-player-search-request',
      pendingStagePlayerSearchRequests,
      'stage-player-search',
      { providerId, query, limit },
      'STAGE_PLAYER_SEARCH_UNAVAILABLE',
    );

  // One song the renderer found at `providerId`, in the shape the local service's search answers with;
  // null for one without an id to play it by. Its songId is read back from its reference, so it is
  // the same value a play of that reference answers with.
  const normalizeStageProviderSearchResult = (providerId, song = {}) => {
    const rawSongId = typeof song.songId === 'number' && Number.isFinite(song.songId)
      ? String(song.songId)
      : normalizeStageText(song.songId);
    const songRef = rawSongId ? parseStageSongRef(buildStageSongRef(providerId, rawSongId)) : null;
    if (!songRef) {
      return null;
    }

    return {
      songId: songRef.songId,
      title: normalizeStageText(song.title) || 'Unknown Song',
      artists: Array.isArray(song.artists) ? song.artists.map(normalizeStageText).filter(Boolean) : [],
      album: normalizeStageText(song.album),
      durationMs: Number.isFinite(song.durationMs) && song.durationMs > 0 ? Math.floor(song.durationMs) : null,
      coverUrl: normalizeStageText(song.coverUrl) || null,
      provider: providerId,
      songRef: songRef.songRef,
    };
  };

  const completeStagePlayerSearchRequest = ({ requestId, ok, error, songs } = {}) => {
    const normalizedRequestId = normalizeStageText(requestId);
    const pendingRequest = normalizedRequestId ? pendingStagePlayerSearchRequests.get(normalizedRequestId) : null;
    if (!pendingRequest) {
      return false;
    }

    clearTimeout(pendingRequest.timer);
    pendingStagePlayerSearchRequests.delete(normalizedRequestId);

    if (ok) {
      pendingRequest.resolve(Array.isArray(songs) ? songs : []);
      return true;
    }

    pendingRequest.reject(new StageApiError(normalizeStageText(error) || 'Renderer rejected the Stage search request.', {
      statusCode: 502,
      code: 'STAGE_SEARCH_REJECTED',
      details: {
        requestId: normalizedRequestId,
      },
    }));
    return true;
  };

  const completeStagePlayerControlRequest = (result) =>
    completeStagePlayerRendererRequest(pendingStagePlayerControlRequests, result);

  const completeStagePlayerQueueRequest = (result) =>
    completeStagePlayerRendererRequest(pendingStagePlayerQueueRequests, result);

  const completeStageExternalPlayRequest = ({ requestId, ok, error, baseSnapshot, snapshot, result } = {}) => {
    const normalizedRequestId = normalizeStageText(requestId);
    if (!normalizedRequestId) {
      return false;
    }

    const pendingRequest = pendingExternalPlayRequests.get(normalizedRequestId);
    if (!pendingRequest) {
      return false;
    }

    clearTimeout(pendingRequest.timer);
    pendingExternalPlayRequests.delete(normalizedRequestId);

    const previousSnapshot = baseSnapshot || stagePlayerSnapshot || getFallbackStagePlayerSnapshot();
    if (snapshot) {
      publishStagePlayerSnapshot(snapshot);
    }
    const nextSnapshot = stagePlayerSnapshot || getFallbackStagePlayerSnapshot();

    if (ok) {
      pendingRequest.resolve(withStagePlayerQueueDiffRevisions(result || { ok: true }, previousSnapshot, nextSnapshot));
      return true;
    }

    pendingRequest.reject(new StageApiError(normalizeStageText(error) || 'Renderer rejected the Stage play request.', {
      statusCode: 502,
      code: 'STAGE_PLAY_REJECTED',
      details: {
        requestId: normalizedRequestId,
      },
    }));
    return true;
  };

  const readStageJsonPayload = async (req, errorMessage, errorCode) => {
    const requestBody = await readRequestBodyWithLimit(req, STAGE_JSON_BODY_LIMIT_BYTES);
    try {
      return JSON.parse(requestBody.toString('utf-8') || '{}');
    } catch (error) {
      throw new StageApiError(errorMessage, {
        statusCode: 400,
        code: errorCode,
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const handleStagePlayerSearchRequest = async (req, { deprecated = false } = {}) => {
    const payload = await readStageJsonPayload(
      req,
      'Failed to parse Stage player search JSON payload.',
      'INVALID_STAGE_PLAYER_SEARCH_JSON',
    );
    const query = normalizeStageText(payload.query);
    const limit = Number.isFinite(payload.limit) ? Math.max(1, Math.min(50, Math.floor(payload.limit))) : 10;
    if (!query) {
      throw createStageValidationError('Stage player search query is required.', 'INVALID_STAGE_PLAYER_SEARCH_QUERY');
    }
    // Without a provider the search stays on the local service; with one it goes through omni.
    const hasProvider = payload.provider !== undefined && payload.provider !== null;
    const providerId = hasProvider ? normalizeStageText(payload.provider) : STAGE_DEFAULT_SONG_PROVIDER_ID;
    if (hasProvider && !isStageProviderId(providerId)) {
      throw createStageValidationError(
        'Stage player search provider must be an omni provider id.',
        'INVALID_STAGE_PLAYER_SEARCH_PROVIDER',
      );
    }

    let songs;
    if (hasProvider) {
      const found = await requestStageProviderSearch(providerId, query, limit);
      songs = found
        .map((song) => normalizeStageProviderSearchResult(providerId, song))
        .filter(Boolean)
        .slice(0, limit);
    } else {
      const found = searchStageSongs
        ? await searchStageSongs(query, limit)
        : await defaultSearchStageSongs(query, limit);
      songs = found.map((song) => ({
        ...song,
        provider: STAGE_DEFAULT_SONG_PROVIDER_ID,
        songRef: buildStageSongRef(STAGE_DEFAULT_SONG_PROVIDER_ID, song.songId),
      }));
    }

    return withStagePlayerOutsideInMetadata({
      ...(deprecated ? { deprecated: true, replacement: '/stage/player/search' } : {}),
      query,
      provider: providerId,
      songs,
    });
  };

  const handleStagePlayerPlayRequest = async (req, { deprecated = false } = {}) => {
    const payload = await readStageJsonPayload(
      req,
      'Failed to parse Stage player play JSON payload.',
      'INVALID_STAGE_PLAYER_PLAY_JSON',
    );
    const songRef = parseStageSongRef(payload.songId);
    const appendToQueue = payload.appendToQueue === true;
    if (!songRef) {
      throw createStageValidationError(
        'Stage player play payload requires a positive integer songId or a "<provider>:<songId>" reference.',
        'INVALID_STAGE_PLAYER_PLAY_SONG_ID',
      );
    }

    const result = await requestStageSongPlay(songRef, { appendToQueue });
    return withStagePlayerOutsideInMetadata({
      ...(deprecated ? { deprecated: true, replacement: '/stage/player/play' } : {}),
      ok: true,
      ...(result?.changed !== undefined ? { changed: result.changed } : {}),
      ...(result?.deduplicated !== undefined ? { deduplicated: result.deduplicated } : {}),
      ...(result?.affectedCount !== undefined ? { affectedCount: result.affectedCount } : {}),
      ...(result?.diff ? { diff: result.diff } : {}),
      songId: songRef.songId,
      provider: songRef.providerId,
      songRef: songRef.songRef,
      appendToQueue,
    });
  };

  const throwStagePlayerUnsupported = (message, code, details) => {
    throw new StageApiError(message, {
      statusCode: 409,
      code,
      details,
    });
  };

  const ensureStagePlayerControlAllowed = (action) => {
    const status = buildStagePlayerStatus();
    const capabilityKey = STAGE_PLAYER_CONTROL_ACTION_CAPABILITIES[action];
    if (!capabilityKey) {
      throw createStageValidationError('Unsupported Stage player control action.', 'INVALID_STAGE_PLAYER_CONTROL_ACTION', {
        action,
      });
    }

    if (!status.controlCapabilities?.[capabilityKey]) {
      throwStagePlayerUnsupported('Control action is not supported in the current playback context.', 'STAGE_PLAYER_CONTROL_UNSUPPORTED', {
        action,
        playbackContext: status.playbackContext,
      });
    }

    return status;
  };

  const handleStagePlayerControlRequest = async (req) => {
    const payload = await readStageJsonPayload(
      req,
      'Failed to parse Stage player control JSON payload.',
      'INVALID_STAGE_PLAYER_CONTROL_JSON',
    );
    const action = normalizeStageText(payload.action);
    const status = ensureStagePlayerControlAllowed(action);
    let positionMs;
    if (action === 'seek') {
      positionMs = normalizeStageInteger(payload.positionMs, -1);
      if (positionMs < 0) {
        throw createStageValidationError('Stage player seek requires a non-negative positionMs.', 'INVALID_STAGE_PLAYER_SEEK_POSITION');
      }
    }

    await requestStagePlayerControl({
      action,
      ...(positionMs !== undefined ? { positionMs } : {}),
    });

    return withStagePlayerOutsideInMetadata({
      accepted: true,
      action,
      playbackContext: status.playbackContext,
    });
  };

  const ensureStagePlayerQueueAllowed = (action) => {
    const status = buildStagePlayerStatus();
    const capabilityKey = STAGE_PLAYER_QUEUE_ACTION_CAPABILITIES[action];
    if (!capabilityKey) {
      throw createStageValidationError('Unsupported Stage player queue action.', 'INVALID_STAGE_PLAYER_QUEUE_ACTION', {
        action,
      });
    }

    if (!status.queueCapabilities?.[capabilityKey]) {
      throwStagePlayerUnsupported('Queue action is not supported in the current playback context.', 'STAGE_PLAYER_QUEUE_UNSUPPORTED', {
        action,
        playbackContext: status.playbackContext,
      });
    }

    return status;
  };

  const buildStagePlayerQueueStatus = (direction = 'inside-out', requestUrl = null) => {
    const status = buildStagePlayerStatus();
    const snapshot = stagePlayerSnapshot || getFallbackStagePlayerSnapshot();
    const queue = snapshot.queue || getFallbackStagePlayerSnapshot().queue;
    const { offset, limit } = normalizeStagePlayerQueueWindow(requestUrl, queue);
    const items = Array.isArray(queue.items) ? queue.items.slice(offset, offset + limit) : [];
    const nextOffset = offset + items.length < queue.length ? offset + items.length : null;
    const payload = {
      playbackContext: status.playbackContext,
      queueCapabilities: status.queueCapabilities,
      queue: {
        ...buildStagePlayerQueueSummary(snapshot),
        items,
        offset,
        limit,
        returned: items.length,
        hasMore: nextOffset !== null,
        nextOffset,
      },
    };

    return direction === 'outside-in'
      ? withStagePlayerOutsideInMetadata(payload)
      : withStagePlayerInsideOutMetadata(payload);
  };

  const handleStagePlayerQueueRequest = async (req) => {
    const payload = await readStageJsonPayload(
      req,
      'Failed to parse Stage player queue JSON payload.',
      'INVALID_STAGE_PLAYER_QUEUE_JSON',
    );
    const action = normalizeStageText(payload.action);
    const status = ensureStagePlayerQueueAllowed(action);

    // `songIds` wins over `songId` when it names any song; each takes a number or a `<provider>:<songId>`.
    const listedSongs = Array.isArray(payload.songIds)
      ? payload.songIds.map(parseStageSongRef).filter(Boolean)
      : [];
    const singleSong = parseStageSongRef(payload.songId);
    const songs = listedSongs.length > 0 ? listedSongs : singleSong ? [singleSong] : [];

    const result = await requestStagePlayerQueueOperation({
      action,
      songs: songs.length > 0 ? songs.map(({ providerId, songId }) => ({ providerId, songId })) : undefined,
      queueItemId: normalizeStageText(payload.queueItemId) || undefined,
      fromQueueItemId: normalizeStageText(payload.fromQueueItemId) || undefined,
      fromIndex: Number.isInteger(Number(payload.fromIndex)) ? Number(payload.fromIndex) : undefined,
      toIndex: Number.isInteger(Number(payload.toIndex)) ? Number(payload.toIndex) : undefined,
      index: Number.isInteger(Number(payload.index)) ? Number(payload.index) : undefined,
    });

    return withStagePlayerOutsideInMetadata({
      accepted: true,
      action,
      playbackContext: status.playbackContext,
      ...(result?.changed !== undefined ? { changed: result.changed } : {}),
      ...(result?.deduplicated !== undefined ? { deduplicated: result.deduplicated } : {}),
      ...(result?.affectedCount !== undefined ? { affectedCount: result.affectedCount } : {}),
      ...(result?.diff ? { diff: result.diff } : {}),
      queue: buildStagePlayerQueueSummary(stagePlayerSnapshot || getFallbackStagePlayerSnapshot()),
    });
  };

  const handleStageHttpRequest = async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    if (pathname === '/stage/health' && req.method === 'GET') {
      sendStageJson(res, 200, {
        enabled: isStageEnabled(),
        modeEnabled: isStageModeEnabled(),
        source: isStageModeEnabled() ? getStageModeSource() : null,
        port: getConfiguredStagePort(),
        activeEntryKind: stageActiveEntryKind,
      });
      return;
    }

    if (!isStageEnabled()) {
      logStage('warn', `Rejected ${req.method || 'UNKNOWN'} ${pathname} because Stage mode is disabled.`);
      sendStageJson(res, 503, { error: 'Stage mode is disabled.' });
      return;
    }

    if (pathname === '/stage/media/current/audio' && req.method === 'GET') {
      if (stageActiveEntryKind !== 'media' || !stageMediaSession || !stageMediaSession.audioSrc.startsWith('http://127.0.0.1:')) {
        sendStageJson(res, 404, { error: 'No uploaded stage audio is available.' });
        return;
      }

      const audioPath = getCurrentStageMediaPath('audio');
      if (!audioPath) {
        sendStageJson(res, 404, { error: 'No uploaded stage audio is available.' });
        return;
      }

      await sendStageFile(req, res, audioPath, stageMediaSession.audioMimeType || 'application/octet-stream');
      return;
    }

    const sessionCoverMatch = /^\/stage\/media\/session\/([^/]+)\/cover$/i.exec(pathname);
    if (sessionCoverMatch && req.method === 'GET') {
      const requestedSessionId = decodeURIComponent(sessionCoverMatch[1] || '');
      const sessionAssets = getStageSessionAssets(requestedSessionId);
      const coverPath = sessionAssets?.coverPath || null;

      if (!coverPath) {
        sendStageJson(res, 404, { error: 'No uploaded stage cover is available for that session.' });
        return;
      }

      const mimeType = sessionAssets.coverMimeType || (requestedSessionId === stageMediaSession?.id
        ? stageMediaSession.coverMimeType
        : 'application/octet-stream');
      const buffer = await fsp.readFile(coverPath);
      sendStageBinary(res, 200, buffer, mimeType || 'application/octet-stream');
      return;
    }

    if (pathname === '/stage/media/current/cover' && req.method === 'GET') {
      const coverPath = getCurrentStageMediaPath('cover');
      if (!coverPath) {
        sendStageJson(res, 404, { error: 'No uploaded stage cover is available.' });
        return;
      }

      const buffer = await fsp.readFile(coverPath);
      sendStageBinary(res, 200, buffer, stageMediaSession?.coverMimeType || 'application/octet-stream');
      return;
    }

    if (!matchesStageBearerToken(req, requestUrl)) {
      sendStageJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    if (pathname === '/stage/status' && req.method === 'GET') {
      sendStageJson(res, 200, buildStageStatus());
      return;
    }

    if (pathname === '/stage/player/status' && req.method === 'GET') {
      sendStageJson(res, 200, buildStagePlayerStatus());
      return;
    }

    if (pathname === '/stage/player/time' && req.method === 'GET') {
      sendStageJson(res, 200, buildStagePlayerTime());
      return;
    }

    if (pathname === '/stage/player/queue' && req.method === 'GET') {
      sendStageJson(res, 200, buildStagePlayerQueueStatus('inside-out', requestUrl));
      return;
    }

    if (pathname === '/stage/state' && req.method === 'DELETE') {
      await clearStageStateData();
      broadcastStageEvent('stage-session-cleared');
      broadcastStageEvent('stage-session-updated');
      sendStageJson(res, 200, buildStageStatus());
      return;
    }

    if (pathname === '/stage/lyrics' && req.method === 'POST') {
      const requestBody = await readRequestBodyWithLimit(req, STAGE_JSON_BODY_LIMIT_BYTES);
      let payload;
      try {
        payload = JSON.parse(requestBody.toString('utf-8') || '{}');
      } catch (error) {
        throw new StageApiError('Failed to parse Stage lyrics JSON payload.', {
          statusCode: 400,
          code: 'INVALID_STAGE_LYRICS_JSON',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }

      const { session: nextLyricsSession, coverUpload } = normalizeStageLyricsSessionPayload(payload);
      stageInputVersion += 1;
      const pushVersion = stageInputVersion;
      let nextSessionId = null;
      let nextCoverPath = null;
      if (coverUpload) {
        // An uploaded cover lives in its own session directory, served like a media session's cover.
        nextSessionId = `stage-${nextLyricsSession.updatedAt}-${crypto.randomUUID()}`;
        await ensureStageSessionsDirectory();
        const workingDirectory = await createStageWorkingDirectory(nextSessionId);
        nextCoverPath = path.join(workingDirectory, `cover${coverUpload.extension}`);
        try {
          await fsp.writeFile(nextCoverPath, coverUpload.bytes);
        } catch (error) {
          await removeStageSessionDirectory(workingDirectory);
          throw error;
        }
        // Another push (or a clear) came while the cover was written: it is newer, this one is dropped.
        if (pushVersion !== stageInputVersion) {
          await removeStageSessionDirectory(workingDirectory);
          throw new StageApiError('A newer Stage input replaced this lyrics session before it was applied.', {
            statusCode: 409,
            code: 'STAGE_INPUT_SUPERSEDED',
          });
        }
        nextLyricsSession.coverUrl = buildStageSessionMediaUrl(nextSessionId, 'cover', nextLyricsSession.updatedAt);
      }

      stageLyricsSession = nextLyricsSession;
      stageMediaSession = null;
      stageActiveEntryKind = 'lyrics';
      stageActiveSessionId = nextSessionId;
      // The cover is served only from its session's address (in coverUrl), not from the
      // token-free /stage/media/current/cover any page could poll.
      stageActiveSessionFiles = {
        audioPath: null,
        coverPath: null,
      };
      if (nextSessionId) {
        rememberStageSessionAssets(nextSessionId, { audioPath: null, coverPath: nextCoverPath }, coverUpload.mimeType);
        void cleanupInactiveStageSessions();
      }
      broadcastStageEvent('stage-session-updated');
      sendStageJson(res, 200, buildStageStatus());
      return;
    }

    // Moves the clock of the lyrics session on screen, without reloading it: an external player
    // reports where it is whenever it plays, pauses or seeks (and now and then against drift).
    if (pathname === '/stage/lyrics/clock' && req.method === 'POST') {
      const requestBody = await readRequestBodyWithLimit(req, STAGE_JSON_BODY_LIMIT_BYTES);
      let payload;
      try {
        payload = JSON.parse(requestBody.toString('utf-8') || '{}');
      } catch (error) {
        throw new StageApiError('Failed to parse Stage lyrics clock JSON payload.', {
          statusCode: 400,
          code: 'INVALID_STAGE_LYRICS_CLOCK',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw createStageValidationError('Stage lyrics clock payload must be a JSON object.', 'INVALID_STAGE_LYRICS_CLOCK');
      }

      if (stageActiveEntryKind !== 'lyrics' || !stageLyricsSession) {
        throw new StageApiError('No Stage lyrics session is active.', {
          statusCode: 409,
          code: 'STAGE_LYRICS_SESSION_INACTIVE',
        });
      }
      // A clock meant for an earlier session (the player changed track meanwhile) is not applied.
      if (payload.sessionUpdatedAt !== undefined && payload.sessionUpdatedAt !== stageLyricsSession.updatedAt) {
        throw new StageApiError('The Stage lyrics session has changed.', {
          statusCode: 409,
          code: 'STAGE_LYRICS_SESSION_CHANGED',
          details: { sessionUpdatedAt: stageLyricsSession.updatedAt },
        });
      }

      // A session pushed without positionMs runs on Folia's own clock (lyrics bounds, loop mode): it is not driven from outside.
      if (!stageLyricsSession.clock) {
        throw new StageApiError('The Stage lyrics session was pushed without positionMs, so it has no external clock.', {
          statusCode: 409,
          code: 'STAGE_LYRICS_SESSION_UNCLOCKED',
        });
      }

      const clock = normalizeStageLyricsClock(payload, stageLyricsSession.clock);
      const durationMs = normalizeStageDurationMs(payload.durationMs);
      stageLyricsSession = {
        ...stageLyricsSession,
        clock,
        ...(durationMs ? { durationMs } : {}),
      };
      const clockUpdate = {
        sessionUpdatedAt: stageLyricsSession.updatedAt,
        clock,
        ...(stageLyricsSession.durationMs ? { durationMs: stageLyricsSession.durationMs } : {}),
      };
      // Only the clock goes to the window: the session (and its lyrics) did not change.
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stage-lyrics-clock-updated', clockUpdate);
      }
      sendStageJson(res, 200, withStageInputMetadata(clockUpdate));
      return;
    }

    if (pathname === '/stage/session' && req.method === 'POST') {
      stageInputVersion += 1;
      const contentType = req.headers['content-type'] || '';
      const nextWorkingSessionId = `stage-${Date.now()}-${crypto.randomUUID()}`;
      await ensureStageSessionsDirectory();
      const workingDirectory = await createStageWorkingDirectory(nextWorkingSessionId);

      let parsedPayload;
      try {
        if (contentType.includes('multipart/form-data')) {
          parsedPayload = await parseStageMultipartPayload(req, workingDirectory);
        } else {
          const requestBody = await readRequestBodyWithLimit(req, STAGE_JSON_BODY_LIMIT_BYTES);
          parsedPayload = parseStagePayloadFromJson(requestBody, workingDirectory);
        }

        const nextSessionResult = await createStageMediaSessionFromPayload(parsedPayload);
        stageLyricsSession = null;
        stageMediaSession = nextSessionResult.mediaSession;
        stageActiveEntryKind = 'media';
        stageActiveSessionId = nextSessionResult.activeSessionId;
        stageActiveSessionFiles = nextSessionResult.activeSessionFiles;
        rememberStageSessionAssets(nextSessionResult.activeSessionId, nextSessionResult.activeSessionFiles);
        void cleanupInactiveStageSessions();
      } catch (error) {
        await removeStageSessionDirectory(workingDirectory);
        throw error;
      }

      broadcastStageEvent('stage-session-updated');
      sendStageJson(res, 200, buildStageStatus());
      return;
    }

    if (pathname === '/stage/player/search' && req.method === 'POST') {
      sendStageJson(res, 200, await handleStagePlayerSearchRequest(req));
      return;
    }

    if (pathname === '/stage/search' && req.method === 'POST') {
      sendStageJson(res, 200, await handleStagePlayerSearchRequest(req, { deprecated: true }));
      return;
    }

    if (pathname === '/stage/player/play' && req.method === 'POST') {
      sendStageJson(res, 200, await handleStagePlayerPlayRequest(req));
      return;
    }

    if (pathname === '/stage/play' && req.method === 'POST') {
      sendStageJson(res, 200, await handleStagePlayerPlayRequest(req, { deprecated: true }));
      return;
    }

    if (pathname === '/stage/player/control' && req.method === 'POST') {
      sendStageJson(res, 200, await handleStagePlayerControlRequest(req));
      return;
    }

    if (pathname === '/stage/player/queue' && req.method === 'POST') {
      sendStageJson(res, 200, await handleStagePlayerQueueRequest(req));
      return;
    }

    logStage('warn', `Received unsupported Stage route ${req.method || 'UNKNOWN'} ${pathname}.`);
    sendStageJson(res, 404, { error: 'Not found.' });
  };

  const stopStageServer = async () => {
    if (!stageServer) {
      await clearStageStateData();
      closeStagePlayerWebSockets();
      return;
    }

    clearPendingExternalPlayRequests('Stage server stopped.');
    clearPendingStagePlayerRequests(pendingStagePlayerControlRequests, 'Stage server stopped.', 'STAGE_PLAYER_CONTROL_UNAVAILABLE');
    clearPendingStagePlayerRequests(pendingStagePlayerQueueRequests, 'Stage server stopped.', 'STAGE_PLAYER_QUEUE_UNAVAILABLE');
    clearPendingStagePlayerRequests(pendingStagePlayerSearchRequests, 'Stage server stopped.', 'STAGE_PLAYER_SEARCH_UNAVAILABLE');
    closeStagePlayerWebSockets();

    await new Promise((resolve) => {
      stageServer.close((error) => {
        if (error) {
          logStage('warn', 'Failed to stop Stage API server cleanly.', error);
        }
        resolve();
      });
    });

    stageServer = null;
    stageServerListening = false;
    connectionFile.remove();
    stagePlayerSnapshot = null;
    stagePlayerTrackKey = null;
    stagePlayerQueueKey = null;
    await clearStageStateData();
  };

  const startStageServerIfNeeded = async () => {
    if (!isStageEnabled()) {
      return;
    }

    if (stageServer) {
      return;
    }

    await ensureStageSessionsDirectory();
    stagePlayerWebSocketServer = new WebSocketServer({ noServer: true });
    stageServer = http.createServer((req, res) => {
      Promise.resolve(handleStageHttpRequest(req, res)).catch((error) => {
        if (error instanceof StageApiError) {
          sendStageJson(res, error.statusCode, {
            error: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }

        logStage('error', 'Unhandled Stage API request failure.', error);
        sendStageJson(res, 500, {
          error: 'Internal Stage API error.',
          code: 'STAGE_INTERNAL_ERROR',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      });
    });
    stageServer.on('upgrade', handleStageWebSocketUpgrade);

    await new Promise((resolve, reject) => {
      stageServer.once('error', reject);
      stageServer.listen(getConfiguredStagePort(), '127.0.0.1', () => {
        stageServer.off('error', reject);
        stageServerListening = true;
        resolve();
      });
    });

    logStage('info', `Stage API server listening on http://127.0.0.1:${getConfiguredStagePort()}.`);
    writeConnectionFile();
  };

  const syncStageModeState = async () => {
    if (isStageEnabled()) {
      getStageToken({ generateIfMissing: true });
      await startStageServerIfNeeded();
    } else {
      await stopStageServer();
    }

    const status = buildStageStatus();
    broadcastStageEvent('stage-session-updated');
    return status;
  };

  const setStageEnabled = async (enabled) => {
    const nextEnabled = Boolean(enabled);
    store.set(stageModeEnabledSettingKey, nextEnabled);
    if (nextEnabled && !store.has(stageModeSourceSettingKey)) {
      store.set(stageModeSourceSettingKey, 'stage-api');
    }

    const status = await syncStageModeState();
    logStage('info', nextEnabled ? 'Stage mode enabled.' : 'Stage mode disabled.');
    return status;
  };

  const regenerateStageToken = async () => {
    const nextToken = crypto.randomBytes(32).toString('base64url');
    store.set(stageApiTokenSettingKey, nextToken);
    logStage('info', 'Regenerated Stage bearer token.');
    closeStagePlayerWebSockets(1008, 'Stage bearer token changed.');

    if (isStageEnabled()) {
      await startStageServerIfNeeded();
      writeConnectionFile();
    }

    const status = buildStageStatus();
    broadcastStageEvent('stage-session-updated');
    return status;
  };

  // 退出时调：删掉连接文件（服务随进程一起关）
  const dispose = () => {
    connectionFile.remove();
  };

  return {
    dispose,
    buildStageStatus,
    clearStageState,
    clearStageStateData,
    completeStageExternalPlayRequest,
    completeStagePlayerControlRequest,
    completeStagePlayerQueueRequest,
    completeStagePlayerSearchRequest,
    publishStagePlayerSnapshot,
    logStage,
    regenerateStageToken,
    setStageEnabled,
    syncStageModeState,
    startStageServerIfNeeded,
    stopStageServer,
  };
}

module.exports = {
  createStageApi,
};
