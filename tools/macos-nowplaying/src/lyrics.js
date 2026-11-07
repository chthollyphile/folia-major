/** Keep only a few recent LRC strings — each can be several KB. */
const LRU_MAX = 8;
/** @type {Map<string, string | null>} */
const cache = new Map();

const UA = 'folia-macos-nowplaying/0.1 (+https://github.com/chthollyphile/folia-major; tools/macos-nowplaying)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(title, artist, durationSec) {
  const dur = Number.isFinite(durationSec) ? Math.round(durationSec) : 0;
  return `${title.trim().toLowerCase()}|${artist.trim().toLowerCase()}|${dur}`;
}

function remember(key, lrc) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, lrc);
  while (cache.size > LRU_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[-–—:].*$/u, '')
    .replace(/\s+/g, '')
    .trim();
}

function pickLrc(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const synced = typeof entry.syncedLyrics === 'string' ? entry.syncedLyrics.trim() : '';
  if (synced) return synced;
  const plain = typeof entry.plainLyrics === 'string' ? entry.plainLyrics.trim() : '';
  if (!plain) return null;
  // Avoid building huge synthetic LRC for long plain text.
  const lines = plain.split('\n').filter(Boolean).slice(0, 200);
  return lines.map((line, i) => `[00:${String(i).padStart(2, '0')}.00]${line}`).join('\n');
}

function scoreCandidate(entry, title, artist, durationSec) {
  const nTitle = normalizeName(title);
  const nArtist = normalizeName(artist);
  const eTitle = normalizeName(entry.trackName);
  const eArtist = normalizeName(entry.artistName);
  let score = 0;
  if (eTitle === nTitle) score += 100;
  else if (eTitle.includes(nTitle) || nTitle.includes(eTitle)) score += 50;
  if (nArtist && eArtist === nArtist) score += 40;
  else if (nArtist && (eArtist.includes(nArtist) || nArtist.includes(eArtist))) score += 20;
  if (Number.isFinite(durationSec) && Number.isFinite(entry.duration)) {
    const delta = Math.abs(Number(entry.duration) - Number(durationSec));
    if (delta <= 2) score += 30;
    else if (delta <= 5) score += 15;
    else if (delta <= 12) score += 5;
    else score -= 20;
  }
  if (entry.syncedLyrics) score += 10;
  return score;
}

async function fetchJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (resp.status === 404) return null;
    if (resp.status === 429) {
      const retryAfter = Number(resp.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }
    if (!resp.ok) return null;
    return resp.json();
  }
  return null;
}

/**
 * Score search hits using metadata only, then keep lyric text from the winner.
 * Avoid retaining full result arrays (each hit can embed a full syncedLyrics blob).
 */
function pickBestFromSearch(results, title, artist, durationSec) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const entry of results) {
    const score = scoreCandidate(entry, title, artist, durationSec);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (!best || bestScore < 60) return null;
  const lrc = pickLrc(best);
  // Drop references to the large results array ASAP.
  return lrc;
}

/**
 * @param {{ title: string, artist: string, album?: string, duration?: number }} track
 * @returns {Promise<{ lrc: string | null, source: string | null }>}
 */
export async function fetchLyrics(track) {
  const title = track.title?.trim() || '';
  const artist = track.artist?.trim() || '';
  if (!title) {
    return { lrc: null, source: null };
  }

  const key = cacheKey(title, artist, track.duration);
  if (cache.has(key)) {
    const lrc = cache.get(key) ?? null;
    return { lrc, source: lrc ? 'lrclib' : null };
  }

  try {
    const getParams = new URLSearchParams({
      track_name: title,
      artist_name: artist || 'Unknown',
    });
    if (track.album?.trim()) getParams.set('album_name', track.album.trim());
    if (Number.isFinite(track.duration) && track.duration > 0) {
      getParams.set('duration', String(Math.round(track.duration)));
    }

    const exact = await fetchJson(`https://lrclib.net/api/get?${getParams}`);
    const exactLrc = pickLrc(exact);
    if (exactLrc) {
      remember(key, exactLrc);
      return { lrc: exactLrc, source: 'lrclib' };
    }

    await sleep(250);

    const searchParams = new URLSearchParams({ track_name: title, artist_name: artist || '' });
    let results = await fetchJson(`https://lrclib.net/api/search?${searchParams}`);
    let lrc = pickBestFromSearch(results, title, artist, track.duration);
    results = null;

    if (!lrc) {
      await sleep(250);
      const qParams = new URLSearchParams({ q: [title, artist].filter(Boolean).join(' ') });
      results = await fetchJson(`https://lrclib.net/api/search?${qParams}`);
      lrc = pickBestFromSearch(results, title, artist, track.duration);
      results = null;
    }

    remember(key, lrc);
    return { lrc, source: lrc ? 'lrclib' : null };
  } catch {
    return { lrc: null, source: null };
  }
}

export function lyricCacheSize() {
  return cache.size;
}
