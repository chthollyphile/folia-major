import { PlayerState } from '../types';
import type {
    CappellaAvatarImage,
    CappellaEmojiImage,
    MonetBackgroundImage,
    MonetPortraitImage,
} from '../types';
import type { ObsBrowserSourceClock } from '../types/obsBrowserSource';
import type { ObsBrowserSourceConfig } from '../types/obsBrowserSource';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';

// src/utils/obsBrowserSource.ts
// Pure helpers for the OBS browser source timing and compact audio payloads.

export const OBS_SPECTRUM_BIN_LIMIT = 256;

// The signature is a DEDUPE FINGERPRINT, not a digest. The tracker below only ever compares a
// config against the immediately preceding one, so a 32-bit space is ample - and the property that
// actually matters is that computing it must not allocate a second copy of the config.
//
// It used to: the config was deep-cloned key-by-key and then JSON.stringify'd. Every inlined base64
// asset the config carries (cover, monet background/portrait, cappella emoji + avatar packs, the
// tempera layer pool) was therefore duplicated into one giant string on every republish - and a
// song change republishes 5-6 times, because `config`'s inputs (currentSong, lyrics, the resolved
// cover, theme) each land in a separate React commit. That is what showed up as a ~300MB JS-heap
// spike per track change with the OBS browser source enabled.
//
// So: fold the config into a hash by walking it, allocating nothing but a small sorted key list per
// object, and memoise per node so an asset whose identity did not change is never re-read.
const FINGERPRINT_SEED = 2166136261;
const FNV_PRIME = 16777619;
// Below this, hashing a string outright is cheaper than the memo bookkeeping.
const MEMOIZED_STRING_MIN_LENGTH = 4096;

const foldString = (hash: number, value: string) => {
    let next = hash;
    for (let index = 0; index < value.length; index += 1) {
        next = Math.imul(next ^ value.charCodeAt(index), FNV_PRIME);
    }
    return next;
};

// Memoised per object/array node. Nodes reached here come from React state and are never mutated in
// place, so identity is a sound cache key; entries die with the objects they describe.
const nodeFingerprints = new WeakMap<object, number>();
// `coverUrl` is the one heavy value that reaches the walk as a bare string, so it gets a 1-slot cache.
let lastLongString: string | null = null;
let lastLongStringFingerprint = FINGERPRINT_SEED;

const foldValue = (hash: number, value: unknown): number => {
    if (value === null) return foldString(hash, '\u0000null');
    if (value === undefined) return foldString(hash, '\u0000undefined');

    if (typeof value === 'object') {
        return Math.imul(hash ^ fingerprintNode(value as object), FNV_PRIME);
    }

    if (typeof value === 'string' && value.length >= MEMOIZED_STRING_MIN_LENGTH) {
        if (value !== lastLongString) {
            lastLongStringFingerprint = foldString(FINGERPRINT_SEED, value);
            lastLongString = value;
        }
        return Math.imul(hash ^ lastLongStringFingerprint, FNV_PRIME);
    }

    return foldString(foldString(hash, `\u0000${typeof value}`), String(value));
};

const foldNode = (node: object): number => {
    if (Array.isArray(node)) {
        let hash = foldString(FINGERPRINT_SEED, '\u0000[');
        for (const entry of node) {
            hash = foldValue(hash, entry);
        }
        return foldString(hash, '\u0000]');
    }

    let hash = foldString(FINGERPRINT_SEED, '\u0000{');
    // Sorted so a config assembled with a different key order still signs identically.
    for (const key of Object.keys(node).sort()) {
        const entryValue = (node as Record<string, unknown>)[key];
        if (entryValue === undefined) continue;
        hash = foldValue(foldString(hash, key), entryValue);
    }
    return foldString(hash, '\u0000}');
};

function fingerprintNode(node: object): number {
    const cached = nodeFingerprints.get(node);
    if (cached !== undefined) return cached;

    const fingerprint = foldNode(node);
    nodeFingerprints.set(node, fingerprint);
    return fingerprint;
}

// Builds a deterministic identity for visual configuration while ignoring transport metadata.
export const buildObsBrowserSourceConfigSignature = (config: ObsBrowserSourceConfig) => {
    let hash = FINGERPRINT_SEED;
    for (const key of Object.keys(config).sort()) {
        if (key === 'updatedAt') continue;
        const value = (config as unknown as Record<string, unknown>)[key];
        if (value === undefined) continue;
        hash = foldValue(foldString(hash, key), value);
    }
    return (hash >>> 0).toString(36);
};

export interface ObsBrowserSourceConfigPublication {
    config: ObsBrowserSourceConfig;
    signature: string;
}

// Prevents equivalent or already in-flight visual configurations from being published repeatedly.
export class ObsBrowserSourceConfigPublicationTracker {
    private lastPublishedSignature: string | null = null;
    private pendingSignature: string | null = null;

    prepare(enabled: boolean, config: ObsBrowserSourceConfig): ObsBrowserSourceConfigPublication | null {
        if (!enabled) {
            this.reset();
            return null;
        }

        const signature = buildObsBrowserSourceConfigSignature(config);
        if (signature === this.lastPublishedSignature || signature === this.pendingSignature) {
            return null;
        }

        this.pendingSignature = signature;
        return { config, signature };
    }

    markPublished(signature: string) {
        if (this.pendingSignature !== signature) return;
        this.pendingSignature = null;
        this.lastPublishedSignature = signature;
    }

    markFailed(signature: string) {
        if (this.pendingSignature === signature) this.pendingSignature = null;
    }

    reset() {
        this.lastPublishedSignature = null;
        this.pendingSignature = null;
    }
}

// Keeps pre-background-registry OBS pages responsive until their browser source is refreshed.
export const buildLegacyObsBrowserSourceBackgroundConfig = (
    background: VisualizerBackgroundConfig,
) => ({
    visualizerBackgroundMode: background.mode,
    backgroundOpacity: background.common?.opacity,
    transparentBackground: background.transparent,
    useCoverColorBg: background.common?.useCoverColorBg,
    disableGeometricBackground: background.common?.disableGeometricBackground,
    disableVignette: background.common?.disableVignette,
    monetBackgroundTuning: background.monet?.tuning,
    monetBackgroundImage: background.customImage,
    urlBackgroundList: background.url?.items,
    urlBackgroundSelectedId: background.url?.selectedId,
});

// The wire clock stays in media time so its duration clamp still ends at the clip's end. The
// effective lyric offset is only a published value; the listener's saved manual offset is untouched.
export const buildObsBrowserSourceClock = (
    clock: ObsBrowserSourceClock,
    clipStartMs: number,
): ObsBrowserSourceClock => ({
    ...clock,
    lyricOffsetMs: (clock.lyricOffsetMs ?? 0) - clipStartMs,
});

export const resolveObsBrowserSourceClockTime = (
    clock: ObsBrowserSourceClock | null,
    nowMs = Date.now(),
) => {
    if (!clock) {
        return 0;
    }

    const offsetSec = (clock.lyricOffsetMs || 0) / 1000;

    if (clock.playerState !== PlayerState.PLAYING) {
        return clock.currentTime - offsetSec;
    }

    const elapsed = Math.max(0, (nowMs - clock.sentAtMs) / 1000);
    const nextTime = clock.currentTime + elapsed * (clock.playbackRate || 1);
    return (clock.duration > 0 ? Math.min(clock.duration, nextTime) : nextTime) - offsetSec;
};

/**
 * Decides which visualizer mode the main window renders: while an OBS client is rendering, the
 * main window drops to the lightweight 'still' mode unless the user opted to keep its animation.
 */
export const resolveMainWindowVisualizerMode = <TMode extends string>(
    visualizerMode: TMode,
    isObsBrowserSourceRendering: boolean,
    keepMainWindowAnimation: boolean,
): TMode | 'still' => (
    isObsBrowserSourceRendering && !keepMainWindowAnimation ? 'still' : visualizerMode
);

export const downsampleObsSpectrum = (
    value: Uint8Array | undefined,
    limit = OBS_SPECTRUM_BIN_LIMIT,
) => {
    if (!value || value.length === 0) {
        return [];
    }

    if (value.length <= limit) {
        return Array.from(value);
    }

    const result: number[] = [];
    const bucketSize = value.length / limit;
    for (let bucket = 0; bucket < limit; bucket += 1) {
        const start = Math.floor(bucket * bucketSize);
        const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
        let sum = 0;
        for (let index = start; index < end && index < value.length; index += 1) {
            sum += value[index];
        }
        result.push(Math.round(sum / Math.max(1, end - start)));
    }
    return result;
};

export const isObsBrowserSourceBlobCoverUrl = (coverUrl: string | null | undefined): coverUrl is string => (
    typeof coverUrl === 'string' && coverUrl.startsWith('blob:')
);

const encodeBase64 = (bytes: Uint8Array): string => {
    if (typeof btoa === 'function') {
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
    }

    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }

    throw new Error('No base64 encoder is available in this environment.');
};

const blobToDataUrl = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = blob.type || 'application/octet-stream';
    return `data:${mimeType};base64,${encodeBase64(bytes)}`;
};

type ObsImageAsset = CappellaAvatarImage | CappellaEmojiImage | MonetBackgroundImage | MonetPortraitImage;

// OBS runs in a separate browser context, so blob URLs from the main window are not readable there.
export const resolveObsBrowserSourceCoverUrl = async (
    coverUrl: string | null,
    fetchCover: typeof fetch = fetch,
): Promise<string | null> => {
    if (!isObsBrowserSourceBlobCoverUrl(coverUrl)) {
        return coverUrl;
    }

    const response = await fetchCover(coverUrl);
    const blob = await response.blob();
    return blobToDataUrl(blob);
};

// Rewrites main-window object URLs while preserving the image metadata consumed by visualizers.
export const resolveObsBrowserSourceImageAsset = async <T extends ObsImageAsset>(
    image: T,
    fetchImage: typeof fetch = fetch,
): Promise<T> => ({
    ...image,
    url: await resolveObsBrowserSourceCoverUrl(image.url, fetchImage) ?? image.url,
});

export const resolveObsBrowserSourceImageAssets = async <T extends ObsImageAsset>(
    images: T[] | undefined,
    fetchImage: typeof fetch = fetch,
): Promise<T[]> => Promise.all((images ?? []).map(image => (
    resolveObsBrowserSourceImageAsset(image, fetchImage)
)));
