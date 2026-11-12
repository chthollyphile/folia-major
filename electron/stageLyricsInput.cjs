// electron/stageLyricsInput.cjs
// Stage API 的 POST /stage/lyrics 与 /stage/lyrics/clock 里，外部播放器推来的时钟、曲目长度和封面的校验（stageApi.cjs 用）。
// 只做校验和规整，不碰文件和服务器状态；不合法时交给 invalid(message, code) 抛出 400。

// Cover images a lyrics session may upload inline (POST /stage/lyrics `cover`), by MIME type.
const STAGE_COVER_EXTENSIONS = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
});

/** invalid(message, code) builds the error thrown for a bad field. */
function createStageLyricsInput({ invalid }) {
  // 外部播放器的时钟：它在哪、停没停，Folia 按收到的时刻往前推（positionMs 必填，paused 缺省为在放）
  const normalizeStageLyricsClock = (payload, previousClock = null) => {
    const positionMs = Number(payload?.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      throw invalid(
        'Stage lyrics clock requires a non-negative positionMs.',
        'INVALID_STAGE_LYRICS_CLOCK',
      );
    }
    if (payload.paused !== undefined && typeof payload.paused !== 'boolean') {
      throw invalid(
        'Stage lyrics clock paused must be a boolean.',
        'INVALID_STAGE_LYRICS_CLOCK',
      );
    }
    return {
      positionMs: Math.round(positionMs),
      paused: typeof payload.paused === 'boolean' ? payload.paused : Boolean(previousClock?.paused),
      sampledAtMs: Date.now(),
    };
  };

  const normalizeStageDurationMs = (value) => {
    if (value === undefined || value === null) return null;
    const durationMs = Number(value);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw invalid(
        'Stage durationMs must be a positive number of milliseconds.',
        'INVALID_STAGE_DURATION',
      );
    }
    return Math.round(durationMs);
  };

  // 封面：coverUrl 只收 http(s) 地址；cover 是 base64 的图片字节（外部播放器的封面常是 file://，页面读不到），写进 Stage 的会话目录再由本服务发出去
  const normalizeStageLyricsCover = (payload) => {
    const hasCoverUrl = payload.coverUrl !== undefined && payload.coverUrl !== null && payload.coverUrl !== '';
    const hasCover = payload.cover !== undefined && payload.cover !== null;
    if (hasCoverUrl && hasCover) {
      throw invalid(
        'Provide at most one cover: either coverUrl or cover.',
        'INVALID_STAGE_COVER',
      );
    }
    if (hasCoverUrl) {
      let url = null;
      try {
        url = typeof payload.coverUrl === 'string' && payload.coverUrl.length <= 4096 ? new URL(payload.coverUrl) : null;
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
        throw invalid(
          'Stage coverUrl must be an http(s) URL.',
          'INVALID_STAGE_COVER',
        );
      }
      return { coverUrl: url.href, upload: null };
    }
    if (hasCover) {
      const mimeType = (typeof payload.cover?.mimeType === 'string' ? payload.cover.mimeType.trim() : '').toLowerCase();
      const data = typeof payload.cover?.data === 'string' ? payload.cover.data : '';
      const extension = STAGE_COVER_EXTENSIONS[mimeType];
      const bytes = extension && /^[A-Za-z0-9+/]+={0,2}$/.test(data) ? Buffer.from(data, 'base64') : null;
      if (!bytes || bytes.length === 0) {
        throw invalid(
          'Stage cover requires base64 data and an image mimeType (png, jpeg, webp or gif).',
          'INVALID_STAGE_COVER',
        );
      }
      return { coverUrl: null, upload: { bytes, mimeType, extension } };
    }
    return { coverUrl: null, upload: null };
  };

  return { normalizeStageLyricsClock, normalizeStageDurationMs, normalizeStageLyricsCover };
}

module.exports = {
  STAGE_COVER_EXTENSIONS,
  createStageLyricsInput,
};
