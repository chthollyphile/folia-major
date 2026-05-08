const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Busboy = require('busboy');
const { finished } = require('stream/promises');
const { WebSocketServer } = require('ws');

// Stage API server and metadata extraction for Electron desktop mode.

const fsp = fs.promises;
const STAGE_REALTIME_PROTOCOL_VERSION = 1;
const STAGE_CONTROL_COLLAPSE_WINDOW_MS = 220;
const STAGE_JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const STAGE_MULTIPART_FIELD_LIMIT_BYTES = 2 * 1024 * 1024;
const STAGE_MULTIPART_FILE_LIMIT_BYTES = 1024 * 1024 * 1024;
const STAGE_MULTIPART_FILE_COUNT_LIMIT = 3;
const STAGE_MULTIPART_PART_COUNT_LIMIT = 10;
const STAGE_MULTIPART_FIELD_COUNT_LIMIT = 10;
const STAGE_SESSION_RETENTION_LIMIT = 12;
const STAGE_CONTROLLER_HEARTBEAT_INTERVAL_MS = 10_000;
const STAGE_CONTROLLER_HEARTBEAT_TIMEOUT_MS = 30_000;
const STAGE_PLAYER_STATE_VALUES = new Set(['IDLE', 'PLAYING', 'PAUSED']);
const STAGE_LOOP_MODE_VALUES = new Set(['off', 'all', 'one']);
const STAGE_CONTROL_REQUEST_VALUES = new Set(['play', 'pause', 'seek', 'next', 'prev', 'set_loop_mode']);

const normalizeStageLoopMode = (value) => (STAGE_LOOP_MODE_VALUES.has(value) ? value : 'off');
const normalizeStagePlayerState = (value) => (STAGE_PLAYER_STATE_VALUES.has(value) ? value : 'IDLE');
const clampStageNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

class StageApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StageApiError';
    this.statusCode = details.statusCode || 400;
    this.code = details.code || 'STAGE_API_ERROR';
    this.details = details.details || null;
  }
}

function createStageApi({
  app,
  store,
  getMainWindow,
  stageModeEnabledSettingKey,
  stageApiTokenSettingKey,
  stageApiPortSettingKey,
  defaultStageApiPort,
}) {
  let stageServer = null;
  let stageWebSocketServer = null;
  let stageSession = null;
  let stageActiveSessionId = null;
  let stageActiveSessionFiles = {
    audioPath: null,
    coverPath: null,
  };
  const stageSessionAssetIndex = new Map();
  let stageRealtimeState = null;
  let stageControllerSocket = null;
  let stageControllerId = null;
  let stageControllerLastPongAt = null;
  let stageControllerHeartbeatTimer = null;
  let stageRealtimePlayerId = null;
  let stageRealtimeConnected = false;
  let stageConnectionError = null;
  let recentDirectionalControl = null;
  let recentDirectionalTimer = null;
  let queuedControlRequests = [];
  let isProcessingControlQueue = false;
  let musicMetadataModulePromise = null;
  const stageControllerPolicy = {
    collapseWindowMs: STAGE_CONTROL_COLLAPSE_WINDOW_MS,
    allowPlayerLoopModeChange: true,
  };

  const logStage = (level, message, details) => {
    const method = typeof console[level] === 'function' ? console[level] : console.log;
    if (details === undefined) {
      method(`[Stage] ${message}`);
      return;
    }
    method(`[Stage] ${message}`, details);
  };

  const getConfiguredStagePort = () => {
    const storedPort = Number(store.get(stageApiPortSettingKey));
    return Number.isInteger(storedPort) && storedPort > 0 ? storedPort : defaultStageApiPort;
  };

  const isStageEnabled = () => Boolean(store.get(stageModeEnabledSettingKey));

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

  const buildStageTrackFromSession = (session) => ({
    trackId: session?.id || `stage-track-${Date.now()}`,
    title: session?.title || 'Stage Session',
    artist: session?.artist || 'Stage',
    album: session?.album || '',
    coverUrl: session?.coverArtUrl || session?.coverUrl || null,
    durationMs:
      stageRealtimeState?.sessionId === session?.id
        ? stageRealtimeState?.durationMs || session?.durationMs || null
        : session?.durationMs || null,
  });

  const buildLocalStageRealtimeStateFromSession = (session, overrides = {}) => {
    if (!session) {
      return null;
    }

    const previousState = stageRealtimeState;
    const nextRevision = clampStageNumber(previousState?.revision, 0) + 1;
    const nextTrack = buildStageTrackFromSession(session);
    return {
      revision: overrides.revision ?? nextRevision,
      sessionId: session.id,
      tracks: overrides.tracks ?? [nextTrack],
      currentTrackId: overrides.currentTrackId ?? nextTrack.trackId,
      playerState: normalizeStagePlayerState(overrides.playerState ?? previousState?.playerState ?? 'PLAYING'),
      currentTimeMs: clampStageNumber(overrides.currentTimeMs, 0),
      durationMs: clampStageNumber(
        overrides.durationMs ?? previousState?.durationMs ?? session?.durationMs,
        0,
      ),
      loopMode: normalizeStageLoopMode(overrides.loopMode ?? previousState?.loopMode ?? 'off'),
      canGoNext: Boolean(overrides.canGoNext ?? false),
      canGoPrev: Boolean(overrides.canGoPrev ?? false),
      updatedAt: overrides.updatedAt ?? Date.now(),
    };
  };

  const buildStageConnectionState = () => ({
    connected: stageRealtimeConnected,
    playerId: stageRealtimePlayerId,
    hasController: Boolean(stageControllerSocket),
    controllerId: stageControllerId,
    pendingRequestCount: queuedControlRequests.length,
    lastError: stageConnectionError,
  });

  const rememberStageSessionAssets = (sessionId, sessionFiles) => {
    if (!sessionId) {
      return;
    }

    if (stageSessionAssetIndex.has(sessionId)) {
      stageSessionAssetIndex.delete(sessionId);
    }

    stageSessionAssetIndex.set(sessionId, {
      audioPath: sessionFiles?.audioPath || null,
      coverPath: sessionFiles?.coverPath || null,
      workingDirectory: getStageSessionDirectory(sessionId),
    });
  };

  const getStageSessionAssets = (sessionId) => {
    if (!sessionId) {
      return null;
    }

    return stageSessionAssetIndex.get(sessionId) || null;
  };

  const buildStageStatus = () => ({
    enabled: isStageEnabled(),
    port: getConfiguredStagePort(),
    token: getStageToken(),
    hasSession: Boolean(stageSession),
    session: stageSession,
    realtimeState: stageRealtimeState,
    connection: buildStageConnectionState(),
    policy: stageControllerPolicy,
  });

  const broadcastStageEvent = (channel) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send(channel, buildStageStatus());
  };

  const broadcastStageRealtimeState = () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('stage-realtime-state', stageRealtimeState);
  };

  const broadcastStageConnectionState = () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('stage-connection-state', buildStageConnectionState());
  };

  const ensureStageSessionsDirectory = async () => {
    await fsp.mkdir(getStageSessionsDirectory(), { recursive: true });
  };

  const createStageWorkingDirectory = async (sessionId) => {
    const workingDirectory = getStageSessionDirectory(sessionId);
    await fsp.mkdir(workingDirectory, { recursive: true });
    return workingDirectory;
  };

  const removeStageSessionDirectory = async (directoryPath) => {
    if (!directoryPath) {
      return;
    }

    try {
      await fsp.rm(directoryPath, { recursive: true, force: true });
    } catch (error) {
      logStage('warn', 'Failed to remove Stage session directory.', {
        directoryPath,
        error,
      });
    }
  };

  const cleanupInactiveStageSessions = async () => {
    try {
      const sessionRoot = getStageSessionsDirectory();
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
        await removeStageSessionDirectory(sessionAssets?.workingDirectory || getStageSessionDirectory(sessionId));
      }

      const directoryEntries = await fsp.readdir(sessionRoot, { withFileTypes: true });
      await Promise.all(directoryEntries
        .filter((entry) => entry.isDirectory() && !keepSessionIds.has(entry.name))
        .map((entry) => removeStageSessionDirectory(path.join(sessionRoot, entry.name))));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return;
      }

      logStage('warn', 'Failed to cleanup inactive Stage session directories.', error);
    }
  };

  const clearRecentDirectionalControl = () => {
    if (recentDirectionalTimer) {
      clearTimeout(recentDirectionalTimer);
      recentDirectionalTimer = null;
    }
    recentDirectionalControl = null;
  };

  const armDirectionalCollapseWindow = (type) => {
    clearRecentDirectionalControl();
    recentDirectionalControl = {
      type,
      expiresAt: Date.now() + stageControllerPolicy.collapseWindowMs,
    };
    recentDirectionalTimer = setTimeout(() => {
      recentDirectionalTimer = null;
      recentDirectionalControl = null;
      broadcastStageConnectionState();
    }, stageControllerPolicy.collapseWindowMs);
  };

  const shouldCollapseDirectionalControl = (type) => (
    Boolean(
      recentDirectionalControl
      && recentDirectionalControl.type === type
      && recentDirectionalControl.expiresAt > Date.now()
    )
  );

  const syncLocalStageRealtimeStateFromSession = (session) => {
    stageRealtimeState = buildLocalStageRealtimeStateFromSession(session);
    broadcastStageRealtimeState();
    broadcastStageConnectionState();
  };

  const clearStageSessionData = async () => {
    stageSession = null;
    stageActiveSessionId = null;
    stageActiveSessionFiles = {
      audioPath: null,
      coverPath: null,
    };
    clearRecentDirectionalControl();
    queuedControlRequests = [];
    stageRealtimeState = null;
    broadcastStageRealtimeState();
    logStage('info', 'Cleared Stage session data.');
    void cleanupInactiveStageSessions();
    return buildStageStatus();
  };

  const clearStageSession = async () => {
    const status = await clearStageSessionData();
    broadcastStageEvent('stage-session-cleared');
    return status;
  };

  const sendStageJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    });
    res.end(body);
  };

  const sendStageBinary = (res, statusCode, buffer, mimeType) => {
    res.writeHead(statusCode, {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': buffer.length,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
  };

  const parseStageRangeHeader = (rangeHeader, totalSize) => {
    if (typeof rangeHeader !== 'string') {
      return null;
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
      return null;
    }

    const startText = match[1];
    const endText = match[2];
    let start = startText ? Number.parseInt(startText, 10) : NaN;
    let end = endText ? Number.parseInt(endText, 10) : NaN;

    if (Number.isNaN(start) && Number.isNaN(end)) {
      return null;
    }

    if (Number.isNaN(start)) {
      const suffixLength = Number.isNaN(end) ? 0 : end;
      if (suffixLength <= 0) {
        return null;
      }
      start = Math.max(totalSize - suffixLength, 0);
      end = totalSize - 1;
    } else if (Number.isNaN(end)) {
      end = totalSize - 1;
    }

    if (start < 0 || end < start || start >= totalSize) {
      return null;
    }

    return {
      start,
      end: Math.min(end, totalSize - 1),
    };
  };

  // Serve uploaded stage audio with byte-range support so the browser audio element
  // can seek reliably instead of snapping back to the beginning.
  const sendStageFile = async (req, res, filePath, mimeType) => {
    const stat = await fsp.stat(filePath);
    const totalSize = stat.size;
    const byteRange = parseStageRangeHeader(req.headers.range, totalSize);

    if (req.headers.range && !byteRange) {
      res.writeHead(416, {
        'Content-Range': `bytes */${totalSize}`,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    if (byteRange) {
      const { start, end } = byteRange;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Type': mimeType || 'application/octet-stream',
        'Content-Length': chunkSize,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Length': totalSize,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  };

  const isCurrentStageMediaUrl = (value, kind) => {
    if (typeof value !== 'string' || !value) {
      return false;
    }

    const mediaPath = `/stage/media/current/${kind}`;
    try {
      const parsedUrl = new URL(value);
      return parsedUrl.pathname === mediaPath;
    } catch (_error) {
      return value.startsWith(mediaPath) || value.includes(`${mediaPath}?`);
    }
  };

  const getStageBearerTokenFromRequest = (req, requestUrl = null) => {
    const authorizationHeader = req.headers.authorization || '';
    const headerMatch = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
    if (headerMatch?.[1]) {
      return headerMatch[1];
    }

    if (requestUrl?.searchParams?.get('token')) {
      return requestUrl.searchParams.get('token');
    }

    return null;
  };

  const parseStageRealtimeMessage = (raw) => {
    const jsonText = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      throw new Error('Stage realtime message must be a JSON object with a type field.');
    }
    return parsed;
  };

  const sendStageRealtimeMessage = (socket, type, payload = {}) => {
    if (!socket || socket.readyState !== 1) {
      return false;
    }

    socket.send(JSON.stringify({
      type,
      payload,
    }));
    return true;
  };

  const sendStageRealtimeStateToController = () => {
    if (!stageRealtimeState) {
      return false;
    }

    return sendStageRealtimeMessage(stageControllerSocket, 'stage_state', stageRealtimeState);
  };

  const getRequester = (req) => req.socket?.remoteAddress || 'unknown';

  const matchesStageBearerToken = (req) => {
    const token = getStageToken();
    const authorized = Boolean(token && getStageBearerTokenFromRequest(req) === token);
    if (!authorized) {
      logStage('warn', `Rejected unauthorized request for ${req.method || 'UNKNOWN'} ${req.url || '/'}.`, {
        requester: getRequester(req),
      });
    }
    return authorized;
  };

  const readRequestBodyWithLimit = (req, maxBytes) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let totalBytes = 0;
      let exceededLimit = false;

      req.on('data', (chunk) => {
        if (exceededLimit) {
          return;
        }

        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          exceededLimit = true;
          reject(new StageApiError('Stage request body exceeds the supported size limit.', {
            statusCode: 413,
            code: 'PAYLOAD_TOO_LARGE',
            details: {
              maxBytes,
            },
          }));
          req.resume();
          return;
        }

        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!exceededLimit) {
          resolve(Buffer.concat(chunks));
        }
      });
      req.on('error', reject);
    });

  const buildStageUploadedFile = (fieldName, incomingFileName, mimeType, filePath, size) => ({
    fieldName,
    fileName: path.basename(incomingFileName || `${fieldName}.bin`),
    contentType: mimeType || 'application/octet-stream',
    filePath,
    size,
  });

  // Stream multipart uploads directly to disk so large stage audio files do not
  // block the Electron main process with full-buffer parsing.
  const parseStageMultipartPayload = (req, workingDirectory) =>
    new Promise((resolve, reject) => {
      const files = {};
      const fields = {};
      const pendingFileWrites = [];
      let isSettled = false;

      const fail = (error) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        reject(error);
      };

      let busboy;
      try {
        busboy = Busboy({
          headers: req.headers,
          limits: {
            fileSize: STAGE_MULTIPART_FILE_LIMIT_BYTES,
            files: STAGE_MULTIPART_FILE_COUNT_LIMIT,
            fields: STAGE_MULTIPART_FIELD_COUNT_LIMIT,
            fieldSize: STAGE_MULTIPART_FIELD_LIMIT_BYTES,
            parts: STAGE_MULTIPART_PART_COUNT_LIMIT,
          },
        });
      } catch (error) {
        fail(new StageApiError('Failed to initialize multipart parser.', {
          statusCode: 400,
          code: 'MULTIPART_PARSE_FAILED',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }));
        return;
      }

      busboy.on('field', (fieldName, value) => {
        fields[fieldName] = value;
      });

      busboy.on('file', (fieldName, fileStream, info) => {
        if (!info?.filename) {
          fileStream.resume();
          return;
        }

        const safeExtension = path.extname(path.basename(info.filename)) || '.bin';
        const targetFilePath = path.join(workingDirectory, `${fieldName}${safeExtension}`);
        const writeStream = fs.createWriteStream(targetFilePath);
        let fileSize = 0;

        fileStream.on('data', (chunk) => {
          fileSize += chunk.length;
        });

        fileStream.on('limit', () => {
          writeStream.destroy();
          fail(new StageApiError('Uploaded Stage file exceeds the supported size limit.', {
            statusCode: 413,
            code: 'PAYLOAD_TOO_LARGE',
            details: {
              fieldName,
              fileName: info.filename,
              maxBytes: STAGE_MULTIPART_FILE_LIMIT_BYTES,
            },
          }));
        });

        fileStream.on('error', (error) => {
          writeStream.destroy(error);
          fail(new StageApiError('Failed to read uploaded Stage file.', {
            statusCode: 400,
            code: 'MULTIPART_PARSE_FAILED',
            details: {
              fieldName,
              fileName: info.filename,
              reason: error instanceof Error ? error.message : String(error),
            },
          }));
        });

        writeStream.on('error', (error) => {
          fail(new StageApiError('Failed to persist uploaded Stage file.', {
            statusCode: 500,
            code: 'SESSION_COMMIT_FAILED',
            details: {
              fieldName,
              fileName: info.filename,
              reason: error instanceof Error ? error.message : String(error),
            },
          }));
        });

        fileStream.pipe(writeStream);
        const writePromise = finished(writeStream).then(() => {
          files[fieldName] = buildStageUploadedFile(
            fieldName,
            info.filename,
            info.mimeType,
            targetFilePath,
            fileSize,
          );
        });
        pendingFileWrites.push(writePromise);
      });

      busboy.on('filesLimit', () => {
        fail(new StageApiError('Too many uploaded Stage files were provided.', {
          statusCode: 400,
          code: 'INVALID_MULTIPART_FIELDS',
          details: {
            maxFiles: STAGE_MULTIPART_FILE_COUNT_LIMIT,
          },
        }));
      });

      busboy.on('fieldsLimit', () => {
        fail(new StageApiError('Too many multipart Stage fields were provided.', {
          statusCode: 400,
          code: 'INVALID_MULTIPART_FIELDS',
          details: {
            maxFields: STAGE_MULTIPART_FIELD_COUNT_LIMIT,
          },
        }));
      });

      busboy.on('partsLimit', () => {
        fail(new StageApiError('Too many multipart Stage parts were provided.', {
          statusCode: 400,
          code: 'INVALID_MULTIPART_FIELDS',
          details: {
            maxParts: STAGE_MULTIPART_PART_COUNT_LIMIT,
          },
        }));
      });

      busboy.on('error', (error) => {
        fail(new StageApiError('Failed to parse multipart Stage request.', {
          statusCode: 400,
          code: 'MULTIPART_PARSE_FAILED',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }));
      });

      busboy.on('close', async () => {
        if (isSettled) {
          return;
        }

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

  const normalizeStageText = (value) => (typeof value === 'string' ? value.trim() : '');
  const isStageLyricsFormat = (value) => value === 'lrc' || value === 'enhanced-lrc' || value === 'vtt' || value === 'yrc';

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

  const createStageSessionFromPayload = async (parsedPayload) => {
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

    logStage('info', 'Received Stage session payload.', {
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
      resolvedLyricsText = (await fsp.readFile(lyricsFile.filePath, 'utf-8')).trim();
    } else if (!resolvedLyricsText && embeddedMetadata?.lyrics) {
      resolvedLyricsText = normalizeStageText(embeddedMetadata.lyrics);
      logStage('info', 'Using embedded lyrics from uploaded audio metadata.');
    }

    const normalizedResolvedLyricsText = normalizeStageText(resolvedLyricsText);
    const hasResolvedLyrics = Boolean(normalizedResolvedLyricsText);
    const detectedLyricsFormat = hasResolvedLyrics ? (requestedLyricsFormat || detectStageLyricsFormat(normalizedResolvedLyricsText)) : null;

    if (coverFile) {
      resolvedCoverUrl = buildStageSessionMediaUrl(sessionId, 'cover', sessionVersion);
    } else if (!resolvedCoverUrl && embeddedMetadata?.coverBuffer) {
      const embeddedCoverPath = path.join(workingDirectory, `embedded-cover${path.extname(embeddedMetadata.coverMimeType || '') || '.bin'}`);
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

    logStage('info', 'Prepared Stage session.', {
      title: nextSession.title,
      artist: nextSession.artist,
      album: nextSession.album,
      durationMs: nextSession.durationMs,
      lyricsFormat: nextSession.lyricsFormat,
      hasLyrics: Boolean(nextSession.lyricsText),
      lyricsMayRequireFallback: Boolean(nextSession.lyricsText && !nextSession.lyricsFormat),
      metadataFilled: Boolean(embeddedMetadata),
    });

    return {
      session: nextSession,
      activeSessionId: sessionId,
      activeSessionFiles: {
        audioPath: resolvedAudioPath,
        coverPath: resolvedCoverPath,
      },
      workingDirectory,
    };
  };

  const normalizeStageRealtimeState = (input) => {
    const source = input && typeof input === 'object' ? input : {};
    const sourceTracks = Array.isArray(source.tracks) ? source.tracks : [];
    const tracks = sourceTracks.map((track, index) => ({
      trackId: typeof track?.trackId === 'string' && track.trackId.trim()
        ? track.trackId.trim()
        : `${source.sessionId || 'stage'}-track-${index}`,
      title: typeof track?.title === 'string' && track.title.trim() ? track.title.trim() : 'Stage Session',
      artist: typeof track?.artist === 'string' ? track.artist : '',
      album: typeof track?.album === 'string' ? track.album : '',
      coverUrl: typeof track?.coverUrl === 'string' ? track.coverUrl : null,
      durationMs: Number.isFinite(track?.durationMs) ? track.durationMs : null,
    }));

    const fallbackSessionTrack = stageSession ? buildStageTrackFromSession(stageSession) : null;
    const normalizedTracks = tracks.length > 0 ? tracks : (fallbackSessionTrack ? [fallbackSessionTrack] : []);
    const fallbackCurrentTrackId = normalizedTracks[0]?.trackId || null;
    const requestedCurrentTrackId = typeof source.currentTrackId === 'string' ? source.currentTrackId : null;
    const currentTrackId = normalizedTracks.some((track) => track.trackId === requestedCurrentTrackId)
      ? requestedCurrentTrackId
      : fallbackCurrentTrackId;
    const currentTrack = normalizedTracks.find((track) => track.trackId === currentTrackId) || null;

    return {
      revision: Math.max(1, Math.floor(clampStageNumber(source.revision, (stageRealtimeState?.revision || 0) + 1))),
      sessionId: typeof source.sessionId === 'string' ? source.sessionId : stageSession?.id || null,
      tracks: normalizedTracks,
      currentTrackId,
      playerState: normalizeStagePlayerState(source.playerState),
      currentTimeMs: Math.max(0, Math.floor(clampStageNumber(source.currentTimeMs, 0))),
      durationMs: Math.max(0, Math.floor(clampStageNumber(source.durationMs, currentTrack?.durationMs ?? 0))),
      loopMode: normalizeStageLoopMode(source.loopMode),
      canGoNext: Boolean(source.canGoNext),
      canGoPrev: Boolean(source.canGoPrev),
      updatedAt: Math.max(1, Math.floor(clampStageNumber(source.updatedAt, Date.now()))),
    };
  };

  const getCurrentStageRevision = () => Math.max(0, Math.floor(clampStageNumber(stageRealtimeState?.revision, 0)));

  const createStaleControlRequestError = (request, expectedRevision) => (
    new StageApiError('Stage control request is based on a stale revision.', {
      statusCode: 409,
      code: 'STALE_CONTROL_REQUEST',
      details: {
        requestId: request?.requestId || null,
        expectedRevision,
        receivedBaseRevision: Number.isFinite(request?.baseRevision) ? request.baseRevision : null,
      },
    })
  );

  const buildStageControlRequest = (request = {}) => {
    const requestedType = typeof request.type === 'string' ? request.type : '';
    if (!STAGE_CONTROL_REQUEST_VALUES.has(requestedType)) {
      throw new StageApiError('Unsupported Stage control request type.', {
        statusCode: 400,
        code: 'INVALID_STAGE_CONTROL_TYPE',
        details: { type: requestedType || null },
      });
    }

    const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
    return {
      requestId: typeof request.requestId === 'string' && request.requestId.trim()
        ? request.requestId.trim()
        : `stage-request-${Date.now()}`,
      originPlayerId: typeof request.originPlayerId === 'string' && request.originPlayerId.trim()
        ? request.originPlayerId.trim()
        : stageRealtimePlayerId || 'stage-player',
      requestedAt: Math.max(1, Math.floor(clampStageNumber(request.requestedAt, Date.now()))),
      baseRevision: Math.max(0, Math.floor(clampStageNumber(request.baseRevision, 0))),
      type: requestedType,
      payload: {
        timeMs: Number.isFinite(payload.timeMs) ? payload.timeMs : undefined,
        loopMode: payload.loopMode,
      },
    };
  };

  const applyLocalStageControlRequest = (request) => {
    if (!stageSession) {
      return false;
    }

    const baseState = stageRealtimeState || buildLocalStageRealtimeStateFromSession(stageSession);
    if (!baseState) {
      return false;
    }

    const expectedRevision = Math.max(0, Math.floor(baseState.revision || 0));
    if (request.baseRevision !== expectedRevision) {
      throw createStaleControlRequestError(request, expectedRevision);
    }

    let nextState = {
      ...baseState,
      revision: baseState.revision + 1,
      updatedAt: Date.now(),
    };

    switch (request.type) {
      case 'play':
        nextState.playerState = 'PLAYING';
        break;
      case 'pause':
        nextState.playerState = 'PAUSED';
        nextState.currentTimeMs = Math.max(0, Math.floor(clampStageNumber(request.payload?.timeMs, nextState.currentTimeMs)));
        break;
      case 'seek':
        nextState.currentTimeMs = Math.max(0, Math.floor(clampStageNumber(request.payload?.timeMs, nextState.currentTimeMs)));
        break;
      case 'set_loop_mode':
        nextState.loopMode = normalizeStageLoopMode(request.payload?.loopMode);
        break;
      case 'next':
      case 'prev':
        nextState.currentTimeMs = 0;
        break;
      default:
        break;
    }

    stageRealtimeState = nextState;
    broadcastStageRealtimeState();
    broadcastStageConnectionState();
    broadcastStageEvent('stage-session-updated');
    return true;
  };

  const flushQueuedStageControlRequests = async () => {
    if (isProcessingControlQueue) {
      return;
    }

    isProcessingControlQueue = true;
    try {
      while (queuedControlRequests.length > 0) {
        const nextRequest = queuedControlRequests.shift();
        if (!nextRequest) {
          continue;
        }

        if (stageControllerSocket) {
          sendStageRealtimeMessage(stageControllerSocket, 'control_request', nextRequest);
        } else {
          applyLocalStageControlRequest(nextRequest);
        }
      }
    } finally {
      isProcessingControlQueue = false;
      broadcastStageConnectionState();
    }
  };

  const enqueueStageControlRequest = async (request) => {
    if (request.type === 'next' || request.type === 'prev') {
      if (shouldCollapseDirectionalControl(request.type)) {
        logStage('info', 'Collapsed duplicate Stage directional control request.', {
          type: request.type,
          requestId: request.requestId,
          baseRevision: request.baseRevision,
        });
        broadcastStageConnectionState();
        return true;
      }

      armDirectionalCollapseWindow(request.type);
    }

    queuedControlRequests.push(request);
    broadcastStageConnectionState();
    await flushQueuedStageControlRequests();
    return true;
  };

  const resetStageControllerConnection = (reason) => {
    if (stageControllerSocket) {
      try {
        stageControllerSocket.removeAllListeners('pong');
      } catch (_error) {
        // Ignore listener cleanup failures.
      }
    }

    stageControllerSocket = null;
    stageControllerId = null;
    stageControllerLastPongAt = null;
    if (reason) {
      stageConnectionError = reason;
    }
    if (stageRealtimeState?.playerState === 'PLAYING') {
      stageRealtimeState = {
        ...stageRealtimeState,
        revision: stageRealtimeState.revision + 1,
        playerState: 'PAUSED',
        updatedAt: Date.now(),
      };
      broadcastStageRealtimeState();
    }
    broadcastStageConnectionState();
  };

  // Keep the singleton controller slot healthy so abnormal disconnects do not
  // leave behind a ghost connection that blocks the next controller.
  const ensureStageControllerHeartbeat = () => {
    if (stageControllerHeartbeatTimer) {
      return;
    }

    stageControllerHeartbeatTimer = setInterval(() => {
      if (!stageControllerSocket) {
        return;
      }

      if (stageControllerSocket.readyState !== 1) {
        resetStageControllerConnection('Stage controller disconnected.');
        return;
      }

      const lastPongAgeMs = stageControllerLastPongAt ? Date.now() - stageControllerLastPongAt : Infinity;
      if (lastPongAgeMs > STAGE_CONTROLLER_HEARTBEAT_TIMEOUT_MS) {
        logStage('warn', 'Stage controller heartbeat timed out.', {
          controllerId: stageControllerId,
          lastPongAgeMs,
        });
        sendStageRealtimeMessage(stageControllerSocket, 'error', {
          code: 'STAGE_CONTROLLER_TIMEOUT',
          message: 'Stage controller heartbeat timed out.',
          lastPongAgeMs,
        });
        try {
          stageControllerSocket.terminate();
        } catch (_error) {
          // Ignore termination errors during forced cleanup.
        }
        resetStageControllerConnection('Stage controller heartbeat timed out.');
        return;
      }

      try {
        stageControllerSocket.ping();
      } catch (error) {
        logStage('warn', 'Failed to send Stage controller heartbeat ping.', error);
        try {
          stageControllerSocket.terminate();
        } catch (_terminateError) {
          // Ignore termination errors during forced cleanup.
        }
        resetStageControllerConnection('Stage controller heartbeat failed.');
      }
    }, STAGE_CONTROLLER_HEARTBEAT_INTERVAL_MS);
  };

  const connectRealtimePlayer = (sender) => {
    stageRealtimeConnected = true;
    stageRealtimePlayerId = stageRealtimePlayerId || `folia-player-${crypto.randomUUID()}`;
    stageConnectionError = null;
    sender.send('stage-realtime-state', stageRealtimeState);
    sender.send('stage-connection-state', buildStageConnectionState());
    return buildStageConnectionState();
  };

  const disconnectRealtimePlayer = () => {
    stageRealtimeConnected = false;
    broadcastStageConnectionState();
    return buildStageConnectionState();
  };

  const sendControlRequestFromPlayer = async (_sender, rawRequest) => {
    const request = buildStageControlRequest({
      ...rawRequest,
      originPlayerId: stageRealtimePlayerId || rawRequest?.originPlayerId,
    });

    const expectedRevision = getCurrentStageRevision();
    if (request.baseRevision !== expectedRevision) {
      logStage('warn', 'Rejected stale Stage control request from player.', {
        requestId: request.requestId,
        type: request.type,
        expectedRevision,
        receivedBaseRevision: request.baseRevision,
      });
      throw createStaleControlRequestError(request, expectedRevision);
    }

    if (request.type === 'set_loop_mode' && !stageControllerPolicy.allowPlayerLoopModeChange) {
      throw new StageApiError('Stage loop mode cannot be changed from a player instance.', {
        statusCode: 403,
        code: 'STAGE_LOOP_MODE_CHANGE_FORBIDDEN',
      });
    }

    return enqueueStageControlRequest(request);
  };

  // Merge a renderer-confirmed Stage playback snapshot so the controller can
  // start its local clock from Folia's real media state instead of guessing.
  const reportRealtimePlayerState = async (_sender, report = {}) => {
    if (!stageSession || !stageRealtimeState) {
      return buildStageStatus();
    }

    const reportedSessionId = typeof report.sessionId === 'string' ? report.sessionId.trim() : '';
    if (!reportedSessionId || reportedSessionId !== stageSession.id) {
      return buildStageStatus();
    }

    const nextPlayerState = report.playerState
      ? normalizeStagePlayerState(report.playerState)
      : stageRealtimeState.playerState;
    const nextDurationMs = Number.isFinite(report.durationMs)
      ? Math.max(0, Math.floor(report.durationMs))
      : stageRealtimeState.durationMs;
    const nextCurrentTimeMs = Number.isFinite(report.currentTimeMs)
      ? Math.max(0, Math.floor(report.currentTimeMs))
      : stageRealtimeState.currentTimeMs;
    const nextErrorMessage = typeof report.errorMessage === 'string' && report.errorMessage.trim()
      ? report.errorMessage.trim()
      : null;

    const hasMeaningfulChange = (
      nextPlayerState !== stageRealtimeState.playerState
      || nextDurationMs !== stageRealtimeState.durationMs
      || nextCurrentTimeMs !== stageRealtimeState.currentTimeMs
      || Boolean(nextErrorMessage)
    );

    if (!hasMeaningfulChange) {
      return buildStageStatus();
    }

    stageRealtimeState = {
      ...stageRealtimeState,
      playerState: nextPlayerState,
      durationMs: nextDurationMs,
      currentTimeMs: nextCurrentTimeMs,
      updatedAt: Date.now(),
    };

    let didRefineSessionDuration = false;
    if (Number.isFinite(report.durationMs) && Math.floor(report.durationMs) > 0) {
      didRefineSessionDuration = Math.max(0, Math.floor(report.durationMs)) !== (stageSession.durationMs || 0);
      stageSession = {
        ...stageSession,
        durationMs: Math.max(0, Math.floor(report.durationMs)),
      };
    }

    stageConnectionError = nextErrorMessage;
    if (didRefineSessionDuration) {
      sendStageRealtimeMessage(stageControllerSocket, 'stage_session', {
        session: stageSession,
        realtimeState: stageRealtimeState,
      });
    }
    sendStageRealtimeStateToController();
    if (nextErrorMessage) {
      sendStageRealtimeMessage(stageControllerSocket, 'error', {
        code: 'STAGE_RENDERER_PLAYBACK_ERROR',
        message: nextErrorMessage,
        sessionId: stageSession.id,
      });
    }
    broadcastStageRealtimeState();
    broadcastStageConnectionState();
    broadcastStageEvent('stage-session-updated');
    return buildStageStatus();
  };

  const handleStageRealtimeControllerMessage = (socket, message) => {
    if (message.type === 'hello') {
      const role = message.payload?.role;
      if (role !== 'controller') {
        sendStageRealtimeMessage(socket, 'error', {
          code: 'INVALID_STAGE_REALTIME_ROLE',
          message: 'Only controller connections are accepted.',
        });
        socket.close();
        return;
      }

      if (stageControllerSocket && stageControllerSocket !== socket) {
        sendStageRealtimeMessage(socket, 'error', {
          code: 'STAGE_CONTROLLER_ALREADY_CONNECTED',
          message: 'A Stage controller is already connected.',
        });
        socket.close();
        return;
      }

      stageControllerSocket = socket;
      stageControllerId = typeof message.payload?.controllerId === 'string' && message.payload.controllerId.trim()
        ? message.payload.controllerId.trim()
        : `stage-controller-${Date.now()}`;
      stageControllerLastPongAt = Date.now();
      stageConnectionError = null;
      sendStageRealtimeMessage(socket, 'hello_ack', {
        protocolVersion: STAGE_REALTIME_PROTOCOL_VERSION,
        role: 'player-host',
        session: stageSession,
        realtimeState: stageRealtimeState,
        policy: stageControllerPolicy,
        playerId: stageRealtimePlayerId,
      });
      broadcastStageConnectionState();
      broadcastStageEvent('stage-session-updated');
      return;
    }

    if (socket !== stageControllerSocket) {
      sendStageRealtimeMessage(socket, 'error', {
        code: 'STAGE_REALTIME_NOT_READY',
        message: 'Controller hello is required before sending Stage realtime messages.',
      });
      return;
    }

    if (message.type === 'stage_state') {
      const nextRealtimeState = normalizeStageRealtimeState(message.payload || {});
      if (stageRealtimeState && nextRealtimeState.revision <= stageRealtimeState.revision) {
        logStage('warn', 'Ignored stale Stage realtime state revision.', {
          incomingRevision: nextRealtimeState.revision,
          currentRevision: stageRealtimeState.revision,
        });
        return;
      }

      stageRealtimeState = nextRealtimeState;
      broadcastStageRealtimeState();
      broadcastStageConnectionState();
      return;
    }

    if (message.type === 'error') {
      stageConnectionError = typeof message.payload?.message === 'string'
        ? message.payload.message
        : 'Stage controller reported an unknown error.';
      broadcastStageConnectionState();
      return;
    }

    logStage('warn', `Received unsupported Stage realtime message type ${message.type}.`);
  };

  const handleStageRealtimeConnection = (socket, req, requestUrl) => {
    stageConnectionError = null;
    sendStageRealtimeMessage(socket, 'server_hello', {
      protocolVersion: STAGE_REALTIME_PROTOCOL_VERSION,
      session: stageSession,
      realtimeState: stageRealtimeState,
      policy: stageControllerPolicy,
      playerId: stageRealtimePlayerId,
      requester: getRequester(req),
      tokenSource: getStageBearerTokenFromRequest(req, requestUrl) ? 'provided' : 'missing',
    });

    socket.on('pong', () => {
      if (socket === stageControllerSocket) {
        stageControllerLastPongAt = Date.now();
        stageConnectionError = null;
        broadcastStageConnectionState();
      }
    });

    socket.on('message', (rawMessage) => {
      try {
        const message = parseStageRealtimeMessage(rawMessage);
        handleStageRealtimeControllerMessage(socket, message);
      } catch (error) {
        logStage('warn', 'Failed to parse Stage realtime message.', error);
        sendStageRealtimeMessage(socket, 'error', {
          code: 'INVALID_STAGE_REALTIME_MESSAGE',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.on('close', () => {
      if (stageControllerSocket === socket) {
        resetStageControllerConnection('Stage controller disconnected.');
      }
    });

    socket.on('error', (error) => {
      logStage('warn', 'Stage realtime socket error.', error);
      if (stageControllerSocket === socket) {
        resetStageControllerConnection(error instanceof Error ? error.message : String(error));
      }
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
        port: getConfiguredStagePort(),
        controllerConnected: Boolean(stageControllerSocket),
        connectedPlayers: stageRealtimeConnected ? 1 : 0,
        lastControllerPongAt: stageControllerLastPongAt,
      });
      return;
    }

    if (!isStageEnabled()) {
      logStage('warn', `Rejected ${req.method || 'UNKNOWN'} ${pathname} because Stage mode is disabled.`);
      sendStageJson(res, 503, { error: 'Stage mode is disabled.' });
      return;
    }

    if (pathname === '/stage/media/current/audio' && req.method === 'GET') {
      if (!isCurrentStageMediaUrl(stageSession?.audioSrc, 'audio')) {
        logStage('warn', 'Requested Stage audio, but no uploaded audio is available.');
        sendStageJson(res, 404, { error: 'No uploaded stage audio is available.' });
        return;
      }

      const audioPath = getCurrentStageMediaPath('audio');
      if (!audioPath) {
        sendStageJson(res, 404, { error: 'No uploaded stage audio is available.' });
        return;
      }

      await sendStageFile(req, res, audioPath, stageSession.audioMimeType || 'application/octet-stream');
      return;
    }

    const sessionCoverMatch = /^\/stage\/media\/session\/([^/]+)\/cover$/i.exec(pathname);
    if (sessionCoverMatch && req.method === 'GET') {
      const requestedSessionId = decodeURIComponent(sessionCoverMatch[1] || '');
      const sessionAssets = getStageSessionAssets(requestedSessionId);
      const coverPath = sessionAssets?.coverPath || null;

      if (!coverPath) {
        logStage('warn', 'Requested Stage session cover, but no cover is available for that session.', {
          sessionId: requestedSessionId,
        });
        sendStageJson(res, 404, { error: 'No uploaded stage cover is available for that session.' });
        return;
      }

      const mimeType = requestedSessionId === stageSession?.id
        ? stageSession.coverMimeType
        : 'application/octet-stream';
      const buffer = await fsp.readFile(coverPath);
      sendStageBinary(res, 200, buffer, mimeType || 'application/octet-stream');
      return;
    }

    if (pathname === '/stage/media/current/cover' && req.method === 'GET') {
      const coverPath = getCurrentStageMediaPath('cover');
      if (!coverPath) {
        logStage('warn', 'Requested Stage cover, but no uploaded cover is available.');
        sendStageJson(res, 404, { error: 'No uploaded stage cover is available.' });
        return;
      }

      const buffer = await fsp.readFile(coverPath);
      sendStageBinary(res, 200, buffer, stageSession.coverMimeType || 'application/octet-stream');
      return;
    }

    if (!matchesStageBearerToken(req)) {
      sendStageJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    if (pathname === '/stage/session' && req.method === 'DELETE') {
      await clearStageSessionData();
      sendStageRealtimeMessage(stageControllerSocket, 'stage_session_cleared', {});
      broadcastStageRealtimeState();
      broadcastStageConnectionState();
      broadcastStageEvent('stage-session-cleared');
      sendStageJson(res, 200, buildStageStatus());
      return;
    }

    if (pathname === '/stage/session' && req.method === 'POST') {
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

        const nextSessionResult = await createStageSessionFromPayload(parsedPayload);
        stageSession = nextSessionResult.session;
        stageActiveSessionId = nextSessionResult.activeSessionId;
        stageActiveSessionFiles = nextSessionResult.activeSessionFiles;
        rememberStageSessionAssets(nextSessionResult.activeSessionId, nextSessionResult.activeSessionFiles);
        syncLocalStageRealtimeStateFromSession(nextSessionResult.session);
        void cleanupInactiveStageSessions();
      } catch (error) {
        await removeStageSessionDirectory(workingDirectory);
        throw error;
      }

      sendStageRealtimeMessage(stageControllerSocket, 'stage_session', {
        session: stageSession,
        realtimeState: stageRealtimeState,
      });
      sendStageRealtimeStateToController();
      broadcastStageRealtimeState();
      broadcastStageConnectionState();
      broadcastStageEvent('stage-session-updated');
      sendStageJson(res, 200, buildStageStatus());
      return;
    }

    logStage('warn', `Received unsupported Stage route ${req.method || 'UNKNOWN'} ${pathname}.`);
    sendStageJson(res, 404, { error: 'Not found.' });
  };

  const stopStageServer = async () => {
    if (!stageServer) {
      return;
    }

    clearRecentDirectionalControl();
    queuedControlRequests = [];

    if (stageControllerSocket) {
      try {
        stageControllerSocket.close();
      } catch (_error) {
        // Ignore close errors during shutdown.
      }
      resetStageControllerConnection('Stage controller disconnected.');
    }

    if (stageWebSocketServer) {
      stageWebSocketServer.close();
      stageWebSocketServer = null;
    }

    if (stageControllerHeartbeatTimer) {
      clearInterval(stageControllerHeartbeatTimer);
      stageControllerHeartbeatTimer = null;
    }

    await new Promise((resolve, reject) => {
      stageServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    stageServer = null;
    stageConnectionError = null;
    broadcastStageConnectionState();
    logStage('info', 'Stopped Stage API server.');
  };

  const startStageServerIfNeeded = async () => {
    if (!isStageEnabled()) {
      return;
    }

    if (stageServer) {
      return;
    }

    getStageToken({ generateIfMissing: true });
    await ensureStageSessionsDirectory();

    stageWebSocketServer = new WebSocketServer({ noServer: true });
    ensureStageControllerHeartbeat();

    stageServer = http.createServer((req, res) => {
      handleStageHttpRequest(req, res).catch((error) => {
        logStage('error', 'Request handling failed.', error);
        if (error instanceof StageApiError) {
          sendStageJson(res, error.statusCode, {
            error: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }
        sendStageJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    stageServer.on('upgrade', (req, socket, head) => {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== '/stage/ws') {
        socket.destroy();
        return;
      }

      if (!isStageEnabled()) {
        socket.destroy();
        return;
      }

      const token = getStageToken();
      if (!token || getStageBearerTokenFromRequest(req, requestUrl) !== token) {
        logStage('warn', 'Rejected unauthorized Stage realtime upgrade request.', {
          requester: getRequester(req),
        });
        socket.destroy();
        return;
      }

      stageWebSocketServer.handleUpgrade(req, socket, head, (ws) => {
        handleStageRealtimeConnection(ws, req, requestUrl);
      });
    });

    await new Promise((resolve, reject) => {
      stageServer.once('error', reject);
      stageServer.listen(getConfiguredStagePort(), '127.0.0.1', () => {
        stageServer.off('error', reject);
        resolve();
      });
    });

    logStage('info', `Stage API server listening on http://127.0.0.1:${getConfiguredStagePort()}.`);
  };

  const setStageEnabled = async (enabled) => {
    const nextEnabled = Boolean(enabled);
    store.set(stageModeEnabledSettingKey, nextEnabled);

    if (nextEnabled) {
      getStageToken({ generateIfMissing: true });
      await startStageServerIfNeeded();
      logStage('info', 'Stage mode enabled.');
    } else {
      await stopStageServer();
      logStage('info', 'Stage mode disabled.');
    }

    const status = buildStageStatus();
    broadcastStageEvent('stage-session-updated');
    return status;
  };

  const regenerateStageToken = async () => {
    const nextToken = crypto.randomBytes(32).toString('base64url');
    store.set(stageApiTokenSettingKey, nextToken);
    logStage('info', 'Regenerated Stage bearer token.');

    if (isStageEnabled()) {
      await startStageServerIfNeeded();
    }

    const status = buildStageStatus();
    broadcastStageEvent('stage-session-updated');
    return status;
  };

  return {
    buildStageStatus,
    clearStageSession,
    clearStageSessionData,
    connectRealtimePlayer,
    disconnectRealtimePlayer,
    logStage,
    regenerateStageToken,
    reportRealtimePlayerState,
    sendControlRequestFromPlayer,
    setStageEnabled,
    startStageServerIfNeeded,
    stopStageServer,
  };
}

module.exports = {
  createStageApi,
};
