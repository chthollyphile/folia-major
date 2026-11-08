import { DEFAULT_SMART_BEAT_SETTINGS, type BeatEffectSetting, type SmartBeatMode, type SmartBeatSettings } from '../../types';
import { BEAT_EFFECT_DEFAULT, BEAT_EFFECT_STRENGTH_MAX, LEGACY_BEAT_LIST_EFFECT_IDS } from './beatEffects';

// src/services/beatFx/smartBeatSettings.ts
// 智能动感模式's settings without their storage: a patch clamped onto them, and the shape they are stored in.
//
// Moved verbatim out of stores/visualizerSettingsPersistence.ts, which keeps the localStorage half and
// re-exports these, so utils (appearanceImportPlan.ts) can use them without importing a store (from the
// PR #750 re-review, 2026-10-19).

/** A strength in 0..2, or `fallback` when it is not a finite number. */
const resolveSmartBeatStrength = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(BEAT_EFFECT_STRENGTH_MAX, Math.max(0, value)) : fallback
);

/** An effect id as stored: `<mode>.<name>`, nothing a hand-edited or imported file could abuse. */
const BEAT_EFFECT_ID = /^[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{1,32}$/;
const MAX_STORED_BEAT_EFFECTS = 64;
/** A part key as stored (BeatEffectSetting `parts`), and how many one effect keeps. */
const BEAT_EFFECT_PART = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_BEAT_EFFECT_PARTS = 8;

/** An effect's part strengths: `incoming`'s valid ones clamped onto `current`'s. Undefined with none. */
const resolveBeatEffectParts = (incoming: unknown, current: Readonly<Record<string, number>> | undefined): Record<string, number> | undefined => {
    const parts: Record<string, number> = { ...(current ?? {}) };
    if (incoming && typeof incoming === 'object') {
        for (const [key, value] of Object.entries(incoming)) {
            if (!BEAT_EFFECT_PART.test(key)) continue;
            if (!(key in parts) && Object.keys(parts).length >= MAX_BEAT_EFFECT_PARTS) continue;
            parts[key] = resolveSmartBeatStrength(value, parts[key] ?? 1);
        }
    }
    return Object.keys(parts).length ? parts : undefined;
};

const SMART_BEAT_MODES: readonly SmartBeatMode[] = ['off', 'cached', 'on'];

/**
 * A 智能动感模式 patch: the mode, any effects' settings (each one partial), and - from settings
 * stored, exported or synced by a build before the three modes - the one switch `enabled`, and from
 * one before effects had their own, the one 轻拍 / 重拍 pair every picture shared.
 */
export interface SmartBeatPatch {
    mode?: SmartBeatMode;
    /**
     * Legacy, read only without a valid `mode`: true is `on`. False is `off` only over `on`: an older
     * build sees `cached` as `enabled: false` (`toStoredSmartBeat`), and syncing that back must not
     * switch `cached` off.
     */
    enabled?: boolean;
    effects?: Readonly<Record<string, Partial<BeatEffectSetting>>>;
    /** Legacy: folded into the beat-list effects (LEGACY_BEAT_LIST_EFFECT_IDS) as their mean. */
    beatIntensity?: number;
    /** Legacy, as `beatIntensity`. */
    downbeatIntensity?: number;
}

/** Clamps a partial 智能动感模式 patch onto `base`; anything missing or malformed keeps base's value. */
export const resolveSmartBeatSettings = (
    patch: SmartBeatPatch | null | undefined,
    base: SmartBeatSettings = DEFAULT_SMART_BEAT_SETTINGS,
): SmartBeatSettings => {
    const effects: Record<string, BeatEffectSetting> = { ...base.effects };
    const legacy = [patch?.beatIntensity, patch?.downbeatIntensity].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (legacy.length && !patch?.effects) {
        // The pair scaled the beat and downbeat layers of the same pictures; one strength per effect is
        // their mean, so a pair left at 1 stays exactly the look it was.
        const strength = resolveSmartBeatStrength(legacy.reduce((sum, value) => sum + value, 0) / legacy.length, 1);
        for (const id of LEGACY_BEAT_LIST_EFFECT_IDS) effects[id] = { ...(effects[id] ?? BEAT_EFFECT_DEFAULT), strength };
    }
    const incoming = patch?.effects && typeof patch.effects === 'object' ? Object.entries(patch.effects) : [];
    for (const [id, value] of incoming) {
        if (!BEAT_EFFECT_ID.test(id) || !value || typeof value !== 'object') continue;
        if (!(id in effects) && Object.keys(effects).length >= MAX_STORED_BEAT_EFFECTS) continue;
        const current = effects[id] ?? BEAT_EFFECT_DEFAULT;
        const parts = resolveBeatEffectParts(value.parts, current.parts);
        effects[id] = {
            on: typeof value.on === 'boolean' ? value.on : current.on,
            strength: resolveSmartBeatStrength(value.strength, current.strength),
            ...(parts ? { parts } : {}),
        };
    }
    return { mode: resolveSmartBeatMode(patch, base.mode), effects };
};

const resolveSmartBeatMode = (patch: SmartBeatPatch | null | undefined, base: SmartBeatMode): SmartBeatMode => {
    if (SMART_BEAT_MODES.includes(patch?.mode as SmartBeatMode)) return patch!.mode as SmartBeatMode;
    if (patch?.enabled === true) return 'on';
    if (patch?.enabled === false && base === 'on') return 'off';
    return base;
};

/**
 * The settings as stored, synced and exported: the mode, and for a build before the three modes the
 * switch it reads - on only for `on`, as such a build would analyse every track; `cached` reads there
 * as off, the nearest it has to "run nothing".
 */
export const toStoredSmartBeat = (settings: SmartBeatSettings): SmartBeatSettings & { enabled: boolean } => ({
    mode: settings.mode,
    enabled: settings.mode === 'on',
    effects: settings.effects,
});
