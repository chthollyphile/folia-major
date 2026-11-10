const http = require('http');

// electron/lyricApi.cjs
// Serves a sanitized snapshot of the current lyrics to trusted local clients.

function readStoredBoolean(store, key) {
  const value = store.get(key);
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true';
  }
  return Boolean(value);
}

function copyText(value) {
  return typeof value === 'string' && value ? value : undefined;
}

function copyTime(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Where a preview clip starts inside its song, in milliseconds; 0 for a whole song or anything unreadable.
function copyClipStart(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function sanitizeWord(word) {
  return {
    text: copyText(word?.text) ?? '',
    startTime: copyTime(word?.startTime),
    endTime: copyTime(word?.endTime),
  };
}

function sanitizeBackgroundVocal(vocal) {
  const result = {
    text: copyText(vocal?.text) ?? '',
    startTime: copyTime(vocal?.startTime),
    endTime: copyTime(vocal?.endTime),
    words: Array.isArray(vocal?.words) ? vocal.words.map(sanitizeWord) : [],
  };
  const translation = copyText(vocal?.translation);
  const romanization = copyText(vocal?.romanization);
  if (translation) result.translation = translation;
  if (romanization) result.romanization = romanization;
  return result;
}

// Converts the internal rendering model into the stable, renderer-agnostic API shape.
// `clipStartMs` was added to v1 without changing any existing field: `offset` stays the manual offset,
// and a client that knows the new field adds the clip start to the player's position (which is the
// clip's own) to reach the lyric clock.
function sanitizeLyricData(lyrics, offset = 0, clipStartMs = 0) {
  if (!lyrics || typeof lyrics !== 'object' || !Array.isArray(lyrics.lines)) {
    return null;
  }

  const result = {
    offset: copyTime(offset),
    clipStartMs: copyClipStart(clipStartMs),
    lines: lyrics.lines.map((line) => {
      const sanitizedLine = {
        text: copyText(line?.fullText) ?? '',
        startTime: copyTime(line?.startTime),
        endTime: copyTime(line?.endTime),
        words: Array.isArray(line?.words) ? line.words.map(sanitizeWord) : [],
      };
      const translation = copyText(line?.translation);
      const romanization = copyText(line?.romanization);
      const backgroundVocals = Array.isArray(line?.backgroundVocals)
        ? line.backgroundVocals
        : line?.backgroundVocal
          ? [line.backgroundVocal]
          : [];

      if (translation) sanitizedLine.translation = translation;
      if (romanization) sanitizedLine.romanization = romanization;
      if (backgroundVocals.length > 0) {
        sanitizedLine.backgroundVocals = backgroundVocals.map(sanitizeBackgroundVocal);
      }
      return sanitizedLine;
    }),
    wordByWord: Boolean(lyrics.isWordByWord),
  };
  const title = copyText(lyrics.title);
  const artist = copyText(lyrics.artist);
  if (title) result.title = title;
  if (artist) result.artist = artist;
  return result;
}

function createLyricApi({
  store,
  getMainWindow,
  enabledSettingKey,
  port,
}) {
  let server = null;
  let currentLyrics = null;
  let lastError = null;

  const isEnabled = () => readStoredBoolean(store, enabledSettingKey);
  const buildStatus = () => ({
    enabled: isEnabled(),
    running: Boolean(server?.listening),
    port,
    url: isEnabled() ? `http://127.0.0.1:${port}/v1/lyric` : null,
    error: lastError,
  });
  const broadcastStatus = () => {
    const mainWindow = getMainWindow?.();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lyric-api-status-changed', buildStatus());
    }
  };
  const sendJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  };
  const handleRequest = (req, res) => {
    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    if (requestUrl.pathname !== '/v1/lyric') {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    sendJson(res, 200, currentLyrics);
  };

  const start = async () => {
    if (!isEnabled() || server?.listening) {
      return buildStatus();
    }

    const nextServer = http.createServer(handleRequest);
    try {
      await new Promise((resolve, reject) => {
        nextServer.once('error', reject);
        nextServer.listen(port, '127.0.0.1', () => {
          nextServer.off('error', reject);
          resolve();
        });
      });
      server = nextServer;
      lastError = null;
      console.log(`[Lyric API] Listening on http://127.0.0.1:${port}/v1/lyric.`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    broadcastStatus();
    return buildStatus();
  };

  const stop = async () => {
    if (!server) {
      broadcastStatus();
      return buildStatus();
    }
    const activeServer = server;
    server = null;
    await new Promise((resolve) => activeServer.close(() => resolve()));
    broadcastStatus();
    return buildStatus();
  };

  const setEnabled = async (enabled) => {
    store.set(enabledSettingKey, Boolean(enabled));
    lastError = null;
    return enabled ? start() : stop();
  };

  const publishLyricData = (lyrics, offset, clipStartMs) => {
    currentLyrics = sanitizeLyricData(lyrics, offset, clipStartMs);
    return true;
  };

  return {
    buildStatus,
    publishLyricData,
    sanitizeLyricData,
    setEnabled,
    start,
    stop,
  };
}

module.exports = {
  createLyricApi,
  sanitizeLyricData,
};
