import { DEFAULT_MONET_TUNING, MONET_CHROME_VISIBILITIES, type MonetChromeVisibility, type MonetPortraitSource, type MonetTuning } from '../../../types';
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, type StoredTuningFields } from '../tuningDefinition';
import { monetPortraitActions, type MonetPortraitActions } from './portraitUpload';

// src/components/visualizer/monet/tuning.ts
// Monet's tuning: its defaults, the settings store fields it lives in, where it is stored and how
// a stored value and a change are read, its actions for the listener's own portrait, and the
// renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends
        StoredTuningFields<'monetTuning', 'handleSetMonetTuning', 'handleResetMonetTuning', MonetTuning>,
        MonetPortraitActions {}
}

const fontScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.5, Math.max(0.7, value));
};

const portraitSource = (value: MonetPortraitSource | undefined): MonetPortraitSource => (
    value === 'custom' || value === 'none' ? value : DEFAULT_MONET_TUNING.portraitSource
);

const isChromeVisibility = (value: unknown): value is MonetChromeVisibility => (
    MONET_CHROME_VISIBILITIES.includes(value as MonetChromeVisibility)
);

/**
 * A three-way visibility from the older on/off switch it replaced and its own field: off is hidden
 * whatever the field says (the switch is what older versions read and write); on is the field, or else
 * `fallback` unless that was hidden, when it is the original 'auto'. Something that sets only the switch
 * (a mod, an older appearance code) still turns it off and back on.
 */
export const resolveMonetChromeVisibility = (
    visibility: unknown,
    shown: unknown,
    fallback: MonetChromeVisibility = 'auto',
): MonetChromeVisibility => {
    if (shown === false) return 'hidden';
    if (isChromeVisibility(visibility)) return visibility;
    if (shown === true && fallback === 'hidden') return 'auto';
    return fallback;
};

/** The listener's own description, at most a short line; anything that is not text is none. */
export const MONET_CUSTOM_DESCRIPTION_MAX_LENGTH = 120;
const customDescription = (value: unknown): string => (
    typeof value === 'string' ? value.slice(0, MONET_CUSTOM_DESCRIPTION_MAX_LENGTH) : ''
);

/**
 * A stored tuning, or a part of one, as a whole valid tuning. What is stored under this key may
 * still hold the monet background's settings from before that background had a key of its own:
 * they are passed over here.
 */
export const resolveStoredMonetTuning = (parsed: Partial<MonetTuning> & Record<string, unknown>): MonetTuning => {
    const descriptionVisibility = resolveMonetChromeVisibility(parsed.descriptionVisibility, parsed.showDescription);
    const portraitHangerVisibility = resolveMonetChromeVisibility(parsed.portraitHangerVisibility, parsed.showPortraitDragHanger);
    return {
        keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
        showDescription: descriptionVisibility !== 'hidden',
        descriptionVisibility,
        showAudioVisualization: parsed.showAudioVisualization ?? DEFAULT_MONET_TUNING.showAudioVisualization,
        audioStyle: parsed.audioStyle === 'line' ? 'line' : DEFAULT_MONET_TUNING.audioStyle,
        fontScale: fontScale(
            parsed.fontScale ?? DEFAULT_MONET_TUNING.fontScale,
            DEFAULT_MONET_TUNING.fontScale,
        ),
        portraitSource: portraitSource(parsed.portraitSource),
        portraitOffsetX: typeof parsed.portraitOffsetX === 'number'
            ? Math.min(0, Math.max(-150, parsed.portraitOffsetX))
            : (DEFAULT_MONET_TUNING.portraitOffsetX ?? 0),
        portraitStyle: parsed.portraitStyle === 'rectangular' ? 'rectangular' : DEFAULT_MONET_TUNING.portraitStyle,
        showPortraitDragHanger: portraitHangerVisibility !== 'hidden',
        portraitHangerVisibility,
        // 镜像与自定义描述（#1124）：旧存档没有这两项，就是原来的方向和主题自带的描述。
        mirrorLayout: typeof parsed.mirrorLayout === 'boolean' ? parsed.mirrorLayout : (DEFAULT_MONET_TUNING.mirrorLayout ?? false),
        customDescription: customDescription(parsed.customDescription),
        // 分辨率覆盖（#929）：旧存档没有这一项就是全跟随全局。
        render: normalizeLyricRenderOverride(parsed.render),
    };
};

export default defineVisualizerTuning<MonetTuning>({
    mode: 'monet',
    defaults: DEFAULT_MONET_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        keywordColoringEnabled: MOD_SWITCH,
        showDescription: MOD_SWITCH,
        descriptionVisibility: modChoice(MONET_CHROME_VISIBILITIES),
        portraitHangerVisibility: modChoice(MONET_CHROME_VISIBILITIES),
        showAudioVisualization: MOD_SWITCH,
        audioStyle: modChoice(['bar', 'line']),
        fontScale: modNumber(0.7, 1.5),
        portraitStyle: modChoice(['square', 'rectangular']),
        mirrorLayout: MOD_SWITCH,
    },
    settingsKey: 'monetTuning',
    settingsSetterKey: 'handleSetMonetTuning',
    settingsResetterKey: 'handleResetMonetTuning',
    storage: {
        key: 'monet_tuning',
        read: resolveStoredMonetTuning,
        // A patch that sets only an on/off switch moves its three-way visibility with it (resolveMonetChromeVisibility).
        // The switch is set from the result, so the held one cannot override a visibility the patch chose.
        merge: (held, patch) => {
            const descriptionVisibility = resolveMonetChromeVisibility(patch.descriptionVisibility, patch.showDescription, held.descriptionVisibility);
            const portraitHangerVisibility = resolveMonetChromeVisibility(patch.portraitHangerVisibility, patch.showPortraitDragHanger, held.portraitHangerVisibility);
            return resolveStoredMonetTuning({
                ...held,
                ...patch,
                descriptionVisibility,
                showDescription: descriptionVisibility !== 'hidden',
                portraitHangerVisibility,
                showPortraitDragHanger: portraitHangerVisibility !== 'hidden',
            });
        },
        resetNotice: 'notifications.monetReset',
        actions: monetPortraitActions,
    },
    // The portrait is dragged on the stage itself: the renderer reports the new offset through onMonetTuningChange.
    apply: (props, tuning) => ({ ...props, monetTuning: tuning, onMonetTuningChange: props.onMonetTuningChange ?? props.onVisualizerTuningChange }),
});
