const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const Busboy = require('busboy');
const { finished } = require('stream/promises');

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
const STAGE_LYRICS_FORMAT_VALUES = new Set(['lrc', 'enhanced-lrc', 'vtt', 'yrc']);

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
  stageApiTokenSettingKey,
  stageApiPortSettingKey,
  defaultStageApiPort,
  getNeteasePort,
  searchStageSongs,
}) {
  let stageServer = null;
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
  let musicMetadataModulePromise = null;

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

  const buildStageStatus = () => ({
    enabled: isStageEnabled(),
    port: getConfiguredStagePort(),
    token: getStageToken(),
    activeEntryKind: stageActiveEntryKind,
    lyricsSession: stageLyricsSession,
    mediaSession: stageMediaSession,
  });

  const broadcastStageEvent = (channel) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send(channel, buildStageStatus());
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
      resolvedLyricsText = (await fsp.readFile(lyricsFile.filePath, 'utf-8')).trim();
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

  const normalizeStageLyricsSessionPayload = (payload = {}) => {
    const rawLyricSource = payload?.lyricSource;
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

    return {
      ...(normalizeStageText(payload.title) ? { title: normalizeStageText(payload.title) } : {}),
      ...(normalizeStageText(payload.artist) ? { artist: normalizeStageText(payload.artist) } : {}),
      ...(normalizeStageText(payload.album) ? { album: normalizeStageText(payload.album) } : {}),
      lyricSource,
      updatedAt: Date.now(),
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

  const requestStageSongPlay = async (songId) => {
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
          details: { requestId, songId },
        }));
      }, STAGE_PLAY_REQUEST_TIMEOUT_MS);

      pendingExternalPlayRequests.set(requestId, { resolve, reject, timer });
      mainWindow.webContents.send('stage-external-play-request', {
        requestId,
        songId,
      });
    });
  };

  const completeStageExternalPlayRequest = ({ requestId, ok, error } = {}) => {
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

    if (ok) {
      pendingRequest.resolve(true);
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

      const mimeType = requestedSessionId === stageMediaSession?.id
        ? stageMediaSession.coverMimeType
        : 'application/octet-stream';
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

      stageLyricsSession = normalizeStageLyricsSessionPayload(payload);
      stageMediaSession = null;
      stageActiveEntryKind = 'lyrics';
      stageActiveSessionId = null;
      stageActiveSessionFiles = {
        audioPath: null,
        coverPath: null,
      };
      broadcastStageEvent('stage-session-updated');
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

    if (pathname === '/stage/search' && req.method === 'POST') {
      const requestBody = await readRequestBodyWithLimit(req, STAGE_JSON_BODY_LIMIT_BYTES);
      let payload;
      try {
        payload = JSON.parse(requestBody.toString('utf-8') || '{}');
      } catch (error) {
        throw new StageApiError('Failed to parse Stage search JSON payload.', {
          statusCode: 400,
          code: 'INVALID_STAGE_SEARCH_JSON',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }

      const query = normalizeStageText(payload.query);
      const limit = Number.isFinite(payload.limit) ? Math.max(1, Math.min(50, Math.floor(payload.limit))) : 10;
      if (!query) {
        throw createStageValidationError('Stage search query is required.', 'INVALID_STAGE_SEARCH_QUERY');
      }

      const songs = searchStageSongs
        ? await searchStageSongs(query, limit)
        : await defaultSearchStageSongs(query, limit);
      sendStageJson(res, 200, { query, songs });
      return;
    }

    if (pathname === '/stage/play' && req.method === 'POST') {
      const requestBody = await readRequestBodyWithLimit(req, STAGE_JSON_BODY_LIMIT_BYTES);
      let payload;
      try {
        payload = JSON.parse(requestBody.toString('utf-8') || '{}');
      } catch (error) {
        throw new StageApiError('Failed to parse Stage play JSON payload.', {
          statusCode: 400,
          code: 'INVALID_STAGE_PLAY_JSON',
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }

      const songId = Number(payload.songId);
      if (!Number.isInteger(songId) || songId <= 0) {
        throw createStageValidationError('Stage play payload requires a positive integer songId.', 'INVALID_STAGE_PLAY_SONG_ID');
      }

      await requestStageSongPlay(songId);
      sendStageJson(res, 200, { ok: true, songId });
      return;
    }

    logStage('warn', `Received unsupported Stage route ${req.method || 'UNKNOWN'} ${pathname}.`);
    sendStageJson(res, 404, { error: 'Not found.' });
  };

  const stopStageServer = async () => {
    if (!stageServer) {
      await clearStageStateData();
      return;
    }

    clearPendingExternalPlayRequests('Stage server stopped.');

    await new Promise((resolve) => {
      stageServer.close((error) => {
        if (error) {
          logStage('warn', 'Failed to stop Stage API server cleanly.', error);
        }
        resolve();
      });
    });

    stageServer = null;
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
    clearStageState,
    clearStageStateData,
    completeStageExternalPlayRequest,
    logStage,
    regenerateStageToken,
    setStageEnabled,
    startStageServerIfNeeded,
    stopStageServer,
  };
}

module.exports = {
  createStageApi,
};
