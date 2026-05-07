const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// Stage API server and metadata extraction for Electron desktop mode.

const fsp = fs.promises;
const STAGE_REALTIME_PROTOCOL_VERSION = 1;
const STAGE_CONTROL_COLLAPSE_WINDOW_MS = 220;
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
  let stageRealtimeState = null;
  let stageControllerSocket = null;
  let stageControllerId = null;
  let stageRealtimePlayerId = null;
  let stageRealtimeConnected = false;
  let stageConnectionError = null;
  let pendingDirectionalControl = null;
  let pendingDirectionalTimer = null;
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

  const getStageStorageDirectory = () => path.join(app.getPath('userData'), 'stage', 'current');

  const getStageMediaPath = (kind) => {
    const baseDirectory = getStageStorageDirectory();
    switch (kind) {
      case 'audio':
        return path.join(baseDirectory, 'audio.bin');
      case 'cover':
        return path.join(baseDirectory, 'cover.bin');
      default:
        throw new Error(`Unknown stage media kind: ${kind}`);
    }
  };

  const buildStageMediaUrl = (kind, version) => {
    const baseUrl = `http://127.0.0.1:${getConfiguredStagePort()}/stage/media/current/${kind}`;
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
      durationMs: clampStageNumber(overrides.durationMs, 0),
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
    pendingRequestCount: queuedControlRequests.length + (pendingDirectionalControl ? 1 : 0),
    lastError: stageConnectionError,
  });

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

  const ensureStageStorageDirectory = async () => {
    await fsp.mkdir(getStageStorageDirectory(), { recursive: true });
  };

  const clearStageStorageDirectory = async () => {
    try {
      await fsp.rm(getStageStorageDirectory(), { recursive: true, force: true });
    } catch (error) {
      logStage('warn', 'Failed to clear stage storage directory.', error);
    }
  };

  const clearPendingDirectionalControl = () => {
    if (pendingDirectionalTimer) {
      clearTimeout(pendingDirectionalTimer);
      pendingDirectionalTimer = null;
    }
    pendingDirectionalControl = null;
  };

  const syncLocalStageRealtimeStateFromSession = (session) => {
    if (stageControllerSocket && stageRealtimeState) {
      return;
    }

    stageRealtimeState = buildLocalStageRealtimeStateFromSession(session);
    broadcastStageRealtimeState();
    broadcastStageConnectionState();
  };

  const clearStageSessionData = async () => {
    stageSession = null;
    clearPendingDirectionalControl();
    queuedControlRequests = [];
    stageRealtimeState = null;
    broadcastStageRealtimeState();
    await clearStageStorageDirectory();
    logStage('info', 'Cleared Stage session data.');
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

  const readRequestBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const parseMultipartParts = (buffer, contentType) => {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!boundaryMatch) {
      throw new Error('Missing multipart boundary.');
    }

    const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
    const latin1 = buffer.toString('latin1');
    const segments = latin1.split(boundary).slice(1, -1);
    const fields = {};
    const files = {};

    for (const segment of segments) {
      const normalized = segment.replace(/^\r\n/, '').replace(/\r\n$/, '');
      if (!normalized) {
        continue;
      }

      const separatorIndex = normalized.indexOf('\r\n\r\n');
      if (separatorIndex === -1) {
        continue;
      }

      const rawHeaders = normalized.slice(0, separatorIndex).split('\r\n');
      let bodyText = normalized.slice(separatorIndex + 4);
      if (bodyText.endsWith('\r\n')) {
        bodyText = bodyText.slice(0, -2);
      }

      const headers = {};
      for (const headerLine of rawHeaders) {
        const colonIndex = headerLine.indexOf(':');
        if (colonIndex === -1) continue;
        const headerName = headerLine.slice(0, colonIndex).trim().toLowerCase();
        headers[headerName] = headerLine.slice(colonIndex + 1).trim();
      }

      const disposition = headers['content-disposition'] || '';
      const nameMatch = /name="([^"]+)"/i.exec(disposition);
      if (!nameMatch) {
        continue;
      }

      const fieldName = nameMatch[1];
      const fileNameMatch = /filename="([^"]*)"/i.exec(disposition);

      if (fileNameMatch) {
        files[fieldName] = {
          fileName: path.basename(fileNameMatch[1]),
          contentType: headers['content-type'] || 'application/octet-stream',
          buffer: Buffer.from(bodyText, 'latin1'),
        };
      } else {
        fields[fieldName] = bodyText;
      }
    }

    return { fields, files };
  };

  const parseStagePayloadFromJson = (buffer) => {
    const raw = buffer.toString('utf-8') || '{}';
    const payload = JSON.parse(raw);
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
    const { parseBuffer } = await loadMusicMetadata();
    const parsed = await parseBuffer(audioFile.buffer, {
      mimeType: audioFile.contentType || undefined,
      path: audioFile.fileName || 'stage-audio',
      size: audioFile.buffer.length,
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
        'Invalid lyricsFormat. Only "lrc" and "enhanced-lrc" are supported.',
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

    await clearStageStorageDirectory();
    await ensureStageStorageDirectory();

    const sessionVersion = Date.now();
    let resolvedAudioSrc = requestedAudioUrl || '';
    let resolvedCoverUrl = requestedCoverUrl || null;
    let resolvedCoverMimeType = coverFile?.contentType || undefined;
    let resolvedLyricsText = requestedLyricsText;

    if (audioFile) {
      await fsp.writeFile(getStageMediaPath('audio'), audioFile.buffer);
      resolvedAudioSrc = buildStageMediaUrl('audio', sessionVersion);
    }

    if (lyricsFile) {
      resolvedLyricsText = lyricsFile.buffer.toString('utf-8').trim();
    } else if (!resolvedLyricsText && embeddedMetadata?.lyrics) {
      resolvedLyricsText = normalizeStageText(embeddedMetadata.lyrics);
      logStage('info', 'Using embedded lyrics from uploaded audio metadata.');
    }

    const normalizedResolvedLyricsText = normalizeStageText(resolvedLyricsText);
    const hasResolvedLyrics = Boolean(normalizedResolvedLyricsText);
    const detectedLyricsFormat = hasResolvedLyrics ? (requestedLyricsFormat || detectStageLyricsFormat(normalizedResolvedLyricsText)) : null;

    if (coverFile) {
      await fsp.writeFile(getStageMediaPath('cover'), coverFile.buffer);
      resolvedCoverUrl = buildStageMediaUrl('cover', sessionVersion);
    } else if (!resolvedCoverUrl && embeddedMetadata?.coverBuffer) {
      await fsp.writeFile(getStageMediaPath('cover'), embeddedMetadata.coverBuffer);
      resolvedCoverUrl = buildStageMediaUrl('cover', sessionVersion);
      resolvedCoverMimeType = embeddedMetadata.coverMimeType || undefined;
      logStage('info', 'Using embedded cover art from uploaded audio metadata.');
    }

    const nextSession = {
      id: `stage-${Date.now()}`,
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

    return nextSession;
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

    return {
      revision: Math.max(1, Math.floor(clampStageNumber(source.revision, (stageRealtimeState?.revision || 0) + 1))),
      sessionId: typeof source.sessionId === 'string' ? source.sessionId : stageSession?.id || null,
      tracks: normalizedTracks,
      currentTrackId: typeof source.currentTrackId === 'string' ? source.currentTrackId : fallbackCurrentTrackId,
      playerState: normalizeStagePlayerState(source.playerState),
      currentTimeMs: Math.max(0, Math.floor(clampStageNumber(source.currentTimeMs, 0))),
      durationMs: Math.max(0, Math.floor(clampStageNumber(source.durationMs, 0))),
      loopMode: normalizeStageLoopMode(source.loopMode),
      canGoNext: Boolean(source.canGoNext),
      canGoPrev: Boolean(source.canGoPrev),
      updatedAt: Math.max(1, Math.floor(clampStageNumber(source.updatedAt, Date.now()))),
    };
  };

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
    if (pendingDirectionalControl && pendingDirectionalControl.type !== request.type) {
      const previousDirectionalRequest = pendingDirectionalControl;
      clearPendingDirectionalControl();
      queuedControlRequests.push(previousDirectionalRequest);
    }

    if (request.type === 'next' || request.type === 'prev') {
      if (pendingDirectionalControl && pendingDirectionalControl.type === request.type) {
        broadcastStageConnectionState();
        return true;
      }

      if (!pendingDirectionalControl) {
        pendingDirectionalControl = request;
        pendingDirectionalTimer = setTimeout(() => {
          pendingDirectionalTimer = null;
          if (pendingDirectionalControl) {
            queuedControlRequests.push(pendingDirectionalControl);
            pendingDirectionalControl = null;
            void flushQueuedStageControlRequests();
          }
        }, stageControllerPolicy.collapseWindowMs);
        broadcastStageConnectionState();
        return true;
      }
    }

    queuedControlRequests.push(request);
    broadcastStageConnectionState();
    await flushQueuedStageControlRequests();
    return true;
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

    if (request.type === 'set_loop_mode' && !stageControllerPolicy.allowPlayerLoopModeChange) {
      throw new StageApiError('Stage loop mode cannot be changed from a player instance.', {
        statusCode: 403,
        code: 'STAGE_LOOP_MODE_CHANGE_FORBIDDEN',
      });
    }

    return enqueueStageControlRequest(request);
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
        stageControllerSocket = null;
        stageControllerId = null;
        stageConnectionError = 'Stage controller disconnected.';
        broadcastStageConnectionState();
      }
    });

    socket.on('error', (error) => {
      logStage('warn', 'Stage realtime socket error.', error);
      if (stageControllerSocket === socket) {
        stageConnectionError = error instanceof Error ? error.message : String(error);
        broadcastStageConnectionState();
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

      await sendStageFile(req, res, getStageMediaPath('audio'), stageSession.audioMimeType || 'application/octet-stream');
      return;
    }

    if (pathname === '/stage/media/current/cover' && req.method === 'GET') {
      if (!isCurrentStageMediaUrl(stageSession?.coverArtUrl, 'cover')) {
        logStage('warn', 'Requested Stage cover, but no uploaded cover is available.');
        sendStageJson(res, 404, { error: 'No uploaded stage cover is available.' });
        return;
      }

      const buffer = await fsp.readFile(getStageMediaPath('cover'));
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
      const requestBody = await readRequestBody(req);
      const contentType = req.headers['content-type'] || '';
      const parsedPayload = contentType.includes('multipart/form-data')
        ? parseMultipartParts(requestBody, contentType)
        : parseStagePayloadFromJson(requestBody);

      const nextSession = await createStageSessionFromPayload(parsedPayload);
      stageSession = nextSession;
      syncLocalStageRealtimeStateFromSession(nextSession);
      sendStageRealtimeMessage(stageControllerSocket, 'stage_session', {
        session: nextSession,
      });
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

    clearPendingDirectionalControl();
    queuedControlRequests = [];

    if (stageControllerSocket) {
      try {
        stageControllerSocket.close();
      } catch (_error) {
        // Ignore close errors during shutdown.
      }
      stageControllerSocket = null;
      stageControllerId = null;
    }

    if (stageWebSocketServer) {
      stageWebSocketServer.close();
      stageWebSocketServer = null;
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
    await ensureStageStorageDirectory();

    stageWebSocketServer = new WebSocketServer({ noServer: true });

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
    sendControlRequestFromPlayer,
    setStageEnabled,
    startStageServerIfNeeded,
    stopStageServer,
  };
}

module.exports = {
  createStageApi,
};
