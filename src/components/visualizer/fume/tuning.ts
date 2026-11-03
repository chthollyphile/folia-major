import { DEFAULT_FUME_TUNING, type FumeTuning } from '../../../types';
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/fume/tuning.ts
// Fume's tuning: its defaults, the settings store fields it lives in, where it is stored and how
// a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'fumeTuning', 'handleSetFumeTuning', 'handleResetFumeTuning', FumeTuning> {}
}

/** A finite number kept between `min` and `max`; anything else is the fallback. */
const inRange = (min: number, max: number) => (value: number, fallback: number) => (
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
);

const cameraSpeed = inRange(0.55, 1.85);
const glowIntensity = inRange(0, 1.8);
const backgroundObjectOpacity = inRange(0, 1);
const heroScale = inRange(0.82, 1.32);
const textHoldRatio = inRange(0, 1);

const cameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined) => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

export default defineVisualizerTuning<FumeTuning>({
    mode: 'fume',
    defaults: DEFAULT_FUME_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        hidePrintSymbols: MOD_SWITCH,
        disableGeometricBackground: MOD_SWITCH,
        backgroundObjectOpacity: modNumber(0, 1),
        textHoldRatio: modNumber(0, 1),
        cameraSpeed: modNumber(0.55, 1.85),
        cameraTrackingMode: modChoice(['stepped', 'smooth']),
        glowIntensity: modNumber(0, 1.8),
        heroScale: modNumber(0.82, 1.32),
    },
    settingsKey: 'fumeTuning',
    settingsSetterKey: 'handleSetFumeTuning',
    settingsResetterKey: 'handleResetFumeTuning',
    storage: {
        key: 'fume_tuning',
        read: (stored: Partial<FumeTuning> & { textHoldStyle?: 'standard' | 'dimmed'; }) => {
            // Before the hold was a ratio it was a style: "dimmed" is the half hold.
            const migratedTextHoldRatio = stored.textHoldStyle === 'dimmed'
                ? 0.5
                : DEFAULT_FUME_TUNING.textHoldRatio;
            return {
                hidePrintSymbols: stored.hidePrintSymbols ?? DEFAULT_FUME_TUNING.hidePrintSymbols,
                disableGeometricBackground: stored.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground,
                backgroundObjectOpacity: backgroundObjectOpacity(
                    stored.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
                    DEFAULT_FUME_TUNING.backgroundObjectOpacity,
                ),
                textHoldRatio: textHoldRatio(stored.textHoldRatio ?? migratedTextHoldRatio, DEFAULT_FUME_TUNING.textHoldRatio),
                cameraTrackingMode: cameraTrackingMode(stored.cameraTrackingMode),
                cameraSpeed: cameraSpeed(stored.cameraSpeed ?? DEFAULT_FUME_TUNING.cameraSpeed, DEFAULT_FUME_TUNING.cameraSpeed),
                glowIntensity: glowIntensity(stored.glowIntensity ?? DEFAULT_FUME_TUNING.glowIntensity, DEFAULT_FUME_TUNING.glowIntensity),
                heroScale: heroScale(stored.heroScale ?? DEFAULT_FUME_TUNING.heroScale, DEFAULT_FUME_TUNING.heroScale),
                // 分辨率覆盖（#929）：旧存档没有这一项就是全跟随全局。
                render: normalizeLyricRenderOverride(stored.render),
            };
        },
        merge: (held, patch) => ({
            hidePrintSymbols: patch.hidePrintSymbols ?? held.hidePrintSymbols,
            disableGeometricBackground: patch.disableGeometricBackground ?? held.disableGeometricBackground,
            backgroundObjectOpacity: backgroundObjectOpacity(
                patch.backgroundObjectOpacity ?? held.backgroundObjectOpacity,
                held.backgroundObjectOpacity,
            ),
            textHoldRatio: textHoldRatio(patch.textHoldRatio ?? held.textHoldRatio, held.textHoldRatio),
            cameraTrackingMode: cameraTrackingMode(patch.cameraTrackingMode ?? held.cameraTrackingMode),
            cameraSpeed: cameraSpeed(patch.cameraSpeed ?? held.cameraSpeed, held.cameraSpeed),
            glowIntensity: glowIntensity(patch.glowIntensity ?? held.glowIntensity, held.glowIntensity),
            heroScale: heroScale(patch.heroScale ?? held.heroScale, held.heroScale),
            render: normalizeLyricRenderOverride(patch.render ?? held.render),
        }),
        resetNotice: 'notifications.fumeReset',
    },
    apply: (props, tuning) => ({ ...props, fumeTuning: tuning }),
});
