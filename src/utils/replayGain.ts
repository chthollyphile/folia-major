import type { ReplayGainInfo, ReplayGainMode } from '../types';

// src/utils/replayGain.ts

export interface ReplayGainCalculation {
    gainDb: number;
    effectiveGainDb: number;
    peak?: number;
    linearGain: number;
}

export const toFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

export const decibelsToLinearPeak = (decibels: unknown): number | undefined => {
    const value = toFiniteNumber(decibels);
    return value === undefined ? undefined : Math.pow(10, value / 20);
};

// Selects the requested mode, applies album-to-track fallback, and prevents positive gain from clipping.
// 'auto' (智能平衡) decides per song from what it knows of the song: services/volumeBalance.
export const calculateReplayGain = (
    replayGain: ReplayGainInfo | null | undefined,
    mode: Exclude<ReplayGainMode, 'auto'>,
): ReplayGainCalculation => {
    if (!replayGain || mode === 'off') {
        return { gainDb: 0, effectiveGainDb: 0, linearGain: 1 };
    }

    const gainDb = mode === 'album'
        ? toFiniteNumber(replayGain.albumGain) ?? toFiniteNumber(replayGain.trackGain) ?? 0
        : toFiniteNumber(replayGain.trackGain) ?? 0;
    const peak = mode === 'album'
        ? toFiniteNumber(replayGain.albumPeak) ?? toFiniteNumber(replayGain.trackPeak)
        : toFiniteNumber(replayGain.trackPeak);

    let effectiveGainDb = gainDb;
    if (gainDb > 0 && peak !== undefined && peak > 0) {
        const clipSafeGainDb = -20 * Math.log10(peak);
        effectiveGainDb = Math.min(gainDb, clipSafeGainDb);
    }

    return {
        gainDb,
        effectiveGainDb,
        peak,
        linearGain: Math.pow(10, effectiveGainDb / 20),
    };
};
