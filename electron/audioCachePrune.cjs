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

/*
 * A source mod's cache entries (api.cache.provideEntries, through the mod system's `sourceCaches`) as the media
 * cache counts them: `mod:<mod id>:<entry id>` (a mod id holds no colon, an entry id may), with the size and the
 * time of last use the mod gave. An entry without a usable id or size is left out: it could not be removed again.
 */
const SOURCE_CACHE_PREFIX = 'mod:';
const sourceCacheEntries = (listed) => (Array.isArray(listed) ? listed : []).flatMap((entry) => {
    const id = entry?.id;
    const size = Number(entry?.size);
    if (typeof entry?.modId !== 'string' || !entry.modId || entry.modId.includes(':')) return [];
    if (typeof id !== 'string' || !id || !Number.isFinite(size) || size < 0) return [];
    const usedAt = Number(entry.usedAt);
    return [{ name: `${SOURCE_CACHE_PREFIX}${entry.modId}:${id}`, size, usedAt: Number.isFinite(usedAt) ? usedAt : 0 }];
});

/** The mod and entry of a name sourceCacheEntries made, or null for any other name. */
const sourceCacheEntryOf = (name) => {
    if (typeof name !== 'string' || !name.startsWith(SOURCE_CACHE_PREFIX)) return null;
    const rest = name.slice(SOURCE_CACHE_PREFIX.length);
    const colon = rest.indexOf(':');
    if (colon <= 0 || colon === rest.length - 1) return null;
    return { modId: rest.slice(0, colon), id: rest.slice(colon + 1) };
};

/*
 * The media cache limit the main window last named (bytes, 0 for none: the listener's setting lives in the renderer),
 * and a source mod's api.cache.requestPrune(limitBytes?) against it. Every audio cache write names the limit
 * (save-audio-cache), and so does the window before a source keeps a file in a cache of its own (set-media-cache-limit).
 * A request with a limit of its own prunes to that; one without prunes to the named limit, and until the window has
 * named one it is left alone, since the host's default (5 GiB) could trim a cache the listener let grow past it.
 * `prune(limitBytes)` is the host's pruning of the whole media cache budget.
 */
const createSourcePruneLimit = (prune) => {
    let namedLimitBytes = null;
    return {
        /** Keeps a limit the window named; anything but a finite number of zero or more is ignored. */
        note: (limitBytes) => {
            if (typeof limitBytes === 'number' && Number.isFinite(limitBytes) && limitBytes >= 0) namedLimitBytes = limitBytes;
        },
        /** The limit the window last named, or null. */
        named: () => namedLimitBytes,
        /** api.cache.requestPrune of a source mod's main entry. */
        pruneForSource: (limitBytes) => {
            if (typeof limitBytes === 'number' && Number.isFinite(limitBytes)) return prune(limitBytes);
            if (namedLimitBytes === null) return undefined;
            return prune(namedLimitBytes);
        },
    };
};

module.exports = { DEFAULT_AUDIO_CACHE_LIMIT_BYTES, createSourcePruneLimit, resolveCacheLimit, selectEvictions, sourceCacheEntries, sourceCacheEntryOf };
