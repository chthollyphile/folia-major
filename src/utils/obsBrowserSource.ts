import { PlayerState } from '../types';
import type {
    CappellaAvatarImage,
    CappellaEmojiImage,
    MonetBackgroundImage,
    MonetPortraitImage,
} from '../types';
import type { ObsBrowserSourceClock } from '../types/obsBrowserSource';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';

// src/utils/obsBrowserSource.ts
// Pure helpers for the OBS browser source timing and compact audio payloads.

export const OBS_SPECTRUM_BIN_LIMIT = 256;

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
