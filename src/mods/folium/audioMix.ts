import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import type { FoliumContextKind, FoliumAudioMix } from './contract';

const EQ_BAND_COUNT = 10;
const EQ_GAIN_LIMIT_DB = 12;

const clampGain = (value: unknown): number => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(-EQ_GAIN_LIMIT_DB, Math.min(EQ_GAIN_LIMIT_DB, numeric));
};

/**
 * The graph EQ, writable from a mod.
 *
 * The store owns the settings: writing through `handleSetAudioEqualizerSettings` persists them,
 * updates what the equalizer dialog shows, and lets the host's existing effect apply them to the
 * biquads. Writing the biquad gains directly would drift from the store and be overwritten the
 * next time the host applies its settings (measured on 0.7.21).
 */
export const createFoliumAudioMixService = (context: FoliumContextKind): FoliumAudioMix => {
    const available = context === 'main';

    return Object.freeze({
        getEqualizer: (): number[] => (
            available ? [...useAudioSettingsStore.getState().audioEqualizerSettings.gains] : []
        ),
        setEqualizer: (gains: readonly number[], options?: { slot?: number }): void => {
            if (!available || !Array.isArray(gains) || gains.length === 0) return;

            const state = useAudioSettingsStore.getState();
            const current = state.audioEqualizerSettings;
            const next = current.gains
                .slice(0, EQ_BAND_COUNT)
                .map((value, index) => (index < gains.length ? clampGain(gains[index]) : value));

            const slot = options?.slot;
            const customSlots = typeof slot === 'number' && slot >= 0 && slot < current.customSlots.length
                ? current.customSlots.map((entry, index) => (index === slot ? { ...entry, gains: [...next] } : entry))
                : current.customSlots;

            state.handleSetAudioEqualizerSettings({ ...current, enabled: true, gains: next, customSlots });
        },
    });
};
