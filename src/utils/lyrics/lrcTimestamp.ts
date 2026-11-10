// src/utils/lyrics/lrcTimestamp.ts
// The LRC line time stamp, written in one place. It imports nothing, so a worker can use it.

/**
 * `[mm:ss.xx]` for a time in milliseconds. A negative time is written as zero, the hundredths
 * are cut and not rounded, and minutes past 99 take three digits.
 */
export const formatLrcTimestamp = (timestampMs: number): string => {
    const totalMs = Math.max(0, Math.floor(timestampMs));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const centiseconds = Math.floor((totalMs % 1000) / 10);
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};
