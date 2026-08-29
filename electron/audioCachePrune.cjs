// electron/audioCachePrune.cjs
// Which cached songs to drop when the audio cache outgrows its ceiling. Pure - names and byte
// counts in, names out. The file walking that feeds it lives in main.cjs; this half is separate
// because it is the half that deletes things, and a sort in the wrong direction here would throw
// away the songs the listener plays most while keeping the ones they never returned to.

/** Ceiling used when the renderer does not name one. Roughly a thousand songs. */
const DEFAULT_AUDIO_CACHE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Resolves the ceiling a save should prune back to.
 *
 * Zero is the listener asking for no ceiling and is a real answer, so it is not treated as the
 * missing value - anything else unusable falls back to the default rather than to "keep forever",
 * because an unbounded cache is the state this exists to prevent.
 */
const resolveCacheLimit = (limitBytes) => {
    if (limitBytes === 0) return Infinity;
    return Number.isFinite(limitBytes) && limitBytes > 0 ? limitBytes : DEFAULT_AUDIO_CACHE_LIMIT_BYTES;
};

/**
 * Least recently used first, until what is left fits.
 *
 * `entries` are `{ name, size, usedAt }`, where usedAt is the file's mtime - stamped afresh every
 * time a song is read back for playback, so it means "last played" rather than "first downloaded".
 */
const selectEvictions = (entries, limitBytes) => {
    const limit = resolveCacheLimit(limitBytes);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= limit) return [];

    const evicted = [];
    for (const entry of [...entries].sort((a, b) => a.usedAt - b.usedAt)) {
        if (total <= limit) break;
        evicted.push(entry.name);
        total -= entry.size;
    }
    return evicted;
};

module.exports = { DEFAULT_AUDIO_CACHE_LIMIT_BYTES, resolveCacheLimit, selectEvictions };
