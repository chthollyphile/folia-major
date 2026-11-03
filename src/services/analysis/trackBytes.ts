// src/services/analysis/trackBytes.ts
// One read of a track's bytes for every analyser, and one decode per rate for callers that ask at
// the same time (analysis service plan, phase 1: docs/analysis-service-plan.md).
//
// Three analysers read tracks: automix's profile (automix/profileService.ts), automix's stem
// separation (automix/stems.ts) and 智能动感模式 (beatFx/beatFxSource.ts, its beats and its drum hits).
// They used to read a track each on their own - up to four reads, one of them a stream download - and
// decode it each on their own.
//
// What is kept is the compressed bytes, not the decode. The analysers ask minutes apart (the profile
// and the next track's stems while the track before plays; the drum hits when the track starts), so
// one decode per track would mean holding the decoded audio for minutes: some 85 MB a track at
// 44.1 kHz stereo, against the 5-10 MB of its file - and decoding it again takes under a second. So:
// - bytes: an LRU by analysis key, capped by size (MAX_BYTES), plus a run in flight joined;
// - decode: a run in flight joined per (key, rate), and nothing kept once it answers.
// The two rates stay apart (22.05 kHz for beat_this and the profile, 44.1 kHz for htdemucs): the
// lower one is not derived from the higher, which would make new beat lists differ from stored ones.
//
// Only bytes that are the whole song as the key names it are put here: what the local ladder reads
// (trackAudio.ts: the representation, a media-cache copy that is the song, a local file or URL), a
// stream read that passes the same whole-song check, and automix's full download once it has passed
// its own. A head-only range read (profileService's `readPrefix`) never is. Which sources a caller
// may read stays the caller's: this only remembers what one of them read.
//
// decodeAudioData detaches the buffer it is handed, so the bytes kept here are never handed out:
// every caller gets its own copy (`slice(0)`), a memcpy of a few MB.
//
// From the PR #750 review: the bytes go after IDLE_MS untouched (the models have their idle release;
// these stayed with automix and 智能动感模式 off), and a caller with a copy of its own hands it over
// (`giveTrackBytes`) after asking whether it fits (`trackBytesFit`), instead of copying a file that
// is then thrown away.

/** The bytes kept, across tracks. A few tracks' files: enough for the current and the next. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Untouched this long (nothing kept or read), the bytes go: no analyser has asked for a while. */
const IDLE_MS = 15 * 60 * 1000;

const kept = new Map<string, ArrayBuffer>();
let keptBytes = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Pushes the idle release back; called on every keep and read. */
const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        idleTimer = null;
        if (kept.size) console.info(`[TrackAudio] shared bytes released (idle ${IDLE_MS / 60_000} min), ${(keptBytes / 1048576).toFixed(1)} MB back`);
        kept.clear();
        keptBytes = 0;
    }, IDLE_MS);
};
const reading = new Map<string, Promise<ArrayBuffer | null>>();
const decoding = new Map<string, Promise<AudioBuffer | null>>();
/** When each key was last decoded, for the log line: how far apart the analysers ask. */
const lastDecodedAt = new Map<string, number>();
const MAX_DECODE_TIMES = 64;

/** Where a caller's bytes came from, for the log. */
export type TrackBytesSource = 'kept' | 'joined' | 'read';

/** Whether bytes this long would be kept at all. */
export const trackBytesFit = (byteLength: number): boolean => byteLength > 0 && byteLength <= MAX_BYTES;

const keep = (key: string, bytes: ArrayBuffer) => {
    if (!trackBytesFit(bytes.byteLength)) return;
    touch();
    const previous = kept.get(key);
    if (previous) {
        keptBytes -= previous.byteLength;
        kept.delete(key);
    }
    kept.set(key, bytes);
    keptBytes += bytes.byteLength;
    while (keptBytes > MAX_BYTES) {
        const oldest = kept.keys().next().value;
        if (oldest === undefined) break;
        keptBytes -= kept.get(oldest)!.byteLength;
        kept.delete(oldest);
    }
};

/** A copy of the kept bytes of `key`, or null; marks them as just used. */
export const peekTrackBytes = (key: string): ArrayBuffer | null => {
    const found = kept.get(key);
    if (!found) return null;
    touch();
    kept.delete(key);
    kept.set(key, found);
    return found.slice(0);
};

/**
 * Keeps bytes a caller read some way of its own (a stream, a download) for the others. Only the whole
 * song as `key` names it - see the header. The caller's own buffer is copied, so it may decode it.
 */
export const putTrackBytes = (key: string, bytes: ArrayBuffer): void => {
    keep(key, bytes.slice(0));
};

/** As `putTrackBytes`, for a copy the caller made for this and no longer touches: kept as it is. */
export const giveTrackBytes = (key: string, bytes: ArrayBuffer): void => {
    keep(key, bytes);
};

/**
 * The bytes of `key`: the kept ones, the run in flight joined, or `read` now - kept when it answers.
 * A null answer is not remembered: a later caller reads again. Each caller gets its own copy.
 *
 * The analysers read by different rules (stem separation reads a file its provider keeps, 智能动感模式
 * reads the stream playback resolved), so a run joined that answers null is not this caller's
 * answer: its own `read` runs then. Found by review: the stems joined a beat FX stream read that
 * failed, parked, and missed the provider's wake-up that had already fired.
 */
export const loadTrackBytes = async (
    key: string,
    read: () => Promise<ArrayBuffer | null>,
): Promise<{ bytes: ArrayBuffer | null; source: TrackBytesSource }> => {
    const found = peekTrackBytes(key);
    if (found) return { bytes: found, source: 'kept' };
    const running = reading.get(key);
    if (running) {
        const bytes = await running;
        if (bytes) return { bytes: bytes.slice(0), source: 'joined' };
        const own = await read();
        if (own) keep(key, own.slice(0));
        return { bytes: own, source: 'read' };
    }
    const run = read().then((bytes) => {
        if (bytes) keep(key, bytes.slice(0));
        return bytes;
    });
    reading.set(key, run);
    try {
        const bytes = await run;
        // The reader's own buffer goes to this caller; the joiners and the kept entry have copies.
        return { bytes, source: 'read' };
    } finally {
        if (reading.get(key) === run) reading.delete(key);
    }
};

/**
 * Decodes `bytes` at `sampleRate`, joining a decode of the same key and rate already running. The
 * AudioBuffer is shared by the joiners, so it is read only - every caller here copies what it keeps.
 * Nothing is kept once it answers. `who` and `source` are for the log line only.
 */
export const decodeTrackAtRate = (
    key: string,
    sampleRate: number,
    bytes: ArrayBuffer,
    decode: (bytes: ArrayBuffer, sampleRate: number) => Promise<AudioBuffer | null>,
    who: string,
    source: TrackBytesSource | 'own',
): Promise<AudioBuffer | null> => {
    const decodeKey = `${sampleRate} ${key}`;
    const running = decoding.get(decodeKey);
    if (running) {
        console.info(`[TrackAudio] ${who} joined the ${sampleRate} Hz decode of ${key}`);
        return running;
    }
    const now = performance.now();
    const last = lastDecodedAt.get(decodeKey);
    lastDecodedAt.delete(decodeKey);
    lastDecodedAt.set(decodeKey, now);
    while (lastDecodedAt.size > MAX_DECODE_TIMES) {
        const oldest = lastDecodedAt.keys().next().value;
        if (oldest === undefined) break;
        lastDecodedAt.delete(oldest);
    }
    console.info(`[TrackAudio] ${who} decodes ${key} at ${sampleRate} Hz, bytes ${source}${last === undefined ? '' : `, ${((now - last) / 1000).toFixed(0)}s after the last decode at this rate`}`);
    const run = decode(bytes, sampleRate);
    decoding.set(decodeKey, run);
    void run.finally(() => {
        if (decoding.get(decodeKey) === run) decoding.delete(decodeKey);
    }).catch(() => undefined);
    return run;
};

/** Test-only: forgets everything kept and in flight. */
export const resetTrackBytesForTests = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    kept.clear();
    keptBytes = 0;
    reading.clear();
    decoding.clear();
    lastDecodedAt.clear();
};
