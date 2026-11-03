'use strict';

// electron/dux/titleResolver.cjs
// Apple Music can hand MPRIS a translated or romanized title: "Spring Thief"
// for 春泥棒, "Alka Tail" for アルカテイル. Dux's lyric providers search by the title they get, so a
// miss is often a metadata miss. This asks the public iTunes catalog for the Japanese release and
// returns the original title/artist/album, which the bridge then gives back to Dux.

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const COUNTRIES = ['jp', 'us'];
const FETCH_TIMEOUT_MS = 8000;
const MAX_CANDIDATES = 3;
const MAX_CACHE = 64;
const DURATION_TOLERANCE_SEC = 8;
const VERSION_MARKER = /(?:\b(?:remix|version|ver\.?|instrumental|karaoke|off\s?vocal|game\s?size|short\s?ver|tv\s?size|acoustic|live|remaster(?:ed)?|sped\s?up|slowed|nightcore)\b|カラオケ|インスト|オフボーカル)/i;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const hasCjk = value => CJK.test(String(value ?? ''));

const normalize = value => String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const searchUrl = (title, artist, country) => {
    const term = [title, artist].filter(Boolean).join(' ');
    const query = new URLSearchParams({
        term,
        media: 'music',
        entity: 'song',
        country,
        limit: '10',
    });
    return `${ITUNES_SEARCH}?${query.toString()}`;
};

const durationScore = diffSec => {
    if (!Number.isFinite(diffSec)) return 0;
    if (diffSec <= 1) return 50;
    if (diffSec <= 3) return 30;
    if (diffSec <= 8) return 10;
    return 0;
};

/**
 * Ranks iTunes results for one query. A translated title is the point: results whose title equals
 * the query add nothing, and a candidate must be close in duration or share the artist/album.
 */
const rankCandidates = (query, results, { artistSearch = true } = {}) => {
    const queryTitle = normalize(query.title);
    const queryArtist = normalize(query.artist);
    const queryAlbum = normalize(query.album);
    const desiredDuration = Number(query.durationSec);
    const queryHasVersionMarker = VERSION_MARKER.test(query.title);
    const ranked = [];

    const items = Array.isArray(results) ? results : [];
    for (let resultIndex = 0; resultIndex < items.length; resultIndex += 1) {
        const item = items[resultIndex];
        const title = typeof item?.trackName === 'string' ? item.trackName.trim() : '';
        const artist = typeof item?.artistName === 'string' ? item.artistName.trim() : '';
        if (!title) continue;
        const sameTitle = normalize(title) === queryTitle;
        const sameArtist = normalize(artist) === queryArtist;
        // The exact pair was already tried; a same-title result can still help when the artist
        // itself was translated (the title did not need resolving).
        if (sameTitle && sameArtist) continue;

        const candidateArtist = normalize(artist);
        const candidateAlbum = normalize(item?.collectionName);
        const candidateDuration = Number(item?.trackTimeMillis) / 1000;
        const durationDiff = Number.isFinite(desiredDuration) && desiredDuration > 0 && Number.isFinite(candidateDuration)
            ? Math.abs(candidateDuration - desiredDuration)
            : null;
        if (durationDiff !== null && durationDiff > DURATION_TOLERANCE_SEC) continue;

        const artistMatched = Boolean(queryArtist && candidateArtist === queryArtist);
        const albumMatched = Boolean(queryAlbum && candidateAlbum && candidateAlbum === queryAlbum);
        // Translated title + translated artist leaves duration as the only link. Accept that link
        // only for the artist-search's top hit whose title is CJK while the query title is not —
        // i.e. the Japanese original behind an English/romaji Apple Music title. A local file Dux
        // cannot find must not get a random same-length song's lyrics.
        const durationOnlyTranslation = Boolean(
            artistSearch
            && resultIndex === 0
            && durationDiff !== null
            && durationDiff <= 1
            && hasCjk(title)
            && !hasCjk(query.title),
        );
        // Same title, different artist: only a script translation (Yorushika ↔ ヨルシカ) or the
        // same album is trustworthy; a same-length cover by another Latin artist is not.
        const artistScriptTranslation = hasCjk(query.artist) !== hasCjk(artist);
        const aligned = artistMatched
            ? (durationDiff === null || durationDiff <= 8)
            : albumMatched
                ? (durationDiff === null || durationDiff <= 3)
                : sameTitle
                    ? (durationDiff !== null && durationDiff <= 5 && (artistScriptTranslation || albumMatched))
                    : durationOnlyTranslation;
        if (!aligned) continue;

        // A remix/live/off-vocal edition has its own timings. Do not switch an unmarked track to
        // one of those; a track already marked as a version keeps its own candidates.
        if (!queryHasVersionMarker && VERSION_MARKER.test(title)) continue;

        let score = durationScore(durationDiff);
        if (artistMatched) score += 30;
        if (albumMatched) score += 10;
        // A different title, or a corrected artist for the same title, is the point of the lookup.
        score += 5;

        ranked.push({
            title,
            artist,
            album: typeof item?.collectionName === 'string' ? item.collectionName : (query.album ?? ''),
            durationSec: Number.isFinite(candidateDuration) && candidateDuration > 0 ? candidateDuration : query.durationSec ?? null,
            score,
            durationDiff,
        });
    }

    const seen = new Set();
    return ranked
        .sort((left, right) => (
            right.score - left.score
            || (left.durationDiff ?? Number.POSITIVE_INFINITY) - (right.durationDiff ?? Number.POSITIVE_INFINITY)
        ))
        .filter(candidate => {
            const key = `${normalize(candidate.title)}|${normalize(candidate.artist)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_CANDIDATES);
};

const createTitleResolver = ({
    fetchImpl = globalThis.fetch,
    timeoutMs = FETCH_TIMEOUT_MS,
    countries = COUNTRIES,
    log = console,
} = {}) => {
    const cache = new Map();

    const remember = (key, candidates) => {
        cache.set(key, candidates);
        while (cache.size > MAX_CACHE) {
            cache.delete(cache.keys().next().value);
        }
        return candidates;
    };

    const search = async (query, country, includeArtist = true, signal = null) => {
        if (signal?.aborted) throw new Error('aborted');
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await fetchImpl(searchUrl(query.title, includeArtist ? query.artist : '', country), {
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`iTunes search failed: HTTP ${response.status}`);
        const body = await response.json();
        return rankCandidates(query, body?.results, { artistSearch: includeArtist });
    };

    /** Original-title candidates for a translated MPRIS title; empty when nothing better is found. */
    const resolve = async (query, { signal = null } = {}) => {
        const title = typeof query?.title === 'string' ? query.title.trim() : '';
        const artist = typeof query?.artist === 'string' ? query.artist.trim() : '';
        if (!title || signal?.aborted) return [];
        const key = [normalize(title), normalize(artist), normalize(query.album), Math.round(Number(query.durationSec) || 0)].join('|');
        if (cache.has(key)) return cache.get(key);

        for (const country of countries) {
            // The artist can be translated too ("Konomi Suzuki" vs 鈴木このみ), so a title-only
            // search follows when the pair finds nothing.
            for (const includeArtist of [true, false]) {
                if (signal?.aborted) return [];
                try {
                    const candidates = await search({ ...query, title, artist }, country, includeArtist, signal);
                    if (candidates.length > 0) {
                        log.info('[Dux] resolved an original title for a translated track', { country, candidates: candidates.length });
                        return remember(key, candidates);
                    }
                } catch (error) {
                    if (signal?.aborted) return [];
                    // iTunes is a best-effort extra source; no lyrics beat a broken lyric request.
                    log.info('[Dux] original-title lookup failed', { country }, error);
                }
            }
        }
        // Do not cache a miss: a transient 403/429/timeout would otherwise pin this track for the
        // rest of the process, while the bridge deliberately retries lyric misses.
        return [];
    };

    return { resolve };
};

module.exports = {
    COUNTRIES,
    MAX_CANDIDATES,
    createTitleResolver,
    normalize,
    rankCandidates,
    searchUrl,
};
