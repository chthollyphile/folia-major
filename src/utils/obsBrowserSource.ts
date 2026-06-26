import { PlayerState } from '../types';
import type { ObsBrowserSourceClock } from '../types/obsBrowserSource';

// src/utils/obsBrowserSource.ts
// Pure helpers for the OBS browser source timing and compact audio payloads.

export const OBS_SPECTRUM_BIN_LIMIT = 256;

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
